import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import {
  abilityUsageResourceKey,
  createEmptyAbilityDailyUsageLedger,
  createEmptyAbilitySceneUsageLedger,
  parseAbilityDailyUsageLedger,
  parseAbilitySceneUsageLedger,
  type AbilityDailyUsageLedger,
  type AbilitySceneUsageLedger,
  type AbilityUsageEntry,
} from '#shared/abilityAutomation/resources'
import type {
  AbilityFrequencyDeclaration,
  AbilityFrequencyExceptionClause,
} from '#shared/abilityAutomation/frequency'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import {
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  createMoveStateChangePlan,
  type MoveStateChange,
  type MoveStateChangeInput,
  type MoveStateChangePlan,
} from '../moveAutomation/plan'
import type { AuthoritativeAbilityContext } from './context'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'

export type AbilityFrequencyPaymentStatus = 'not-required' | 'paid' | 'duplicate'

export interface AbilityFrequencyPaymentResult {
  readonly status: AbilityFrequencyPaymentStatus
  readonly period: 'at-will' | 'scene' | 'daily'
  readonly spent: number
  readonly limit: number | null
  readonly remaining: number | null
  readonly plan: MoveStateChangePlan
}

export type AbilityFrequencyPaymentErrorCode =
  | 'invalid-frequency'
  | 'missing-exception-clause'
  | 'clause-mismatch'
  | 'unsupported-period'
  | 'scene-id-mismatch'
  | 'day-key-mismatch'
  | 'resource-conflict'
  | 'operation-id-conflict'
  | 'uses-exhausted'
  | 'ability-instance-missing'
  | 'payment-plan-conflict'

export class AbilityFrequencyPaymentError extends Error {
  readonly code: AbilityFrequencyPaymentErrorCode

  constructor(code: AbilityFrequencyPaymentErrorCode, detail: string) {
    super(detail)
    this.name = 'AbilityFrequencyPaymentError'
    this.code = code
  }
}

const fail = (code: AbilityFrequencyPaymentErrorCode, detail: string): never => {
  throw new AbilityFrequencyPaymentError(code, detail)
}

const paymentPeriod = (input: {
  readonly frequency: AbilityFrequencyDeclaration
  readonly exceptionClause?: AbilityFrequencyExceptionClause
}): { readonly period: 'at-will' | 'scene' | 'daily' | 'round'; readonly limit: number | null } => {
  if (input.frequency.kind === 'static') {
    return fail('invalid-frequency', 'Static abilities do not spend a frequency resource.')
  }
  if (input.frequency.kind === 'at-will') return { period: 'at-will', limit: null }
  if (input.frequency.kind === 'scene' || input.frequency.kind === 'daily') {
    return { period: input.frequency.kind, limit: input.frequency.uses }
  }
  const clause = input.exceptionClause
    ?? fail('missing-exception-clause', 'Exceptional frequency payment requires a reviewed clause.')
  return { period: clause.period, limit: clause.uses }
}

const resourceIdentity = (
  context: AuthoritativeAbilityContext,
  ownerId: string,
  abilityInstanceId: string,
  clauseId: string,
): Pick<AbilityUsageEntry, 'ownerId' | 'abilityInstanceId' | 'canonicalId' | 'clauseId'> => ({
  ownerId,
  abilityInstanceId,
  canonicalId: context.runtime.canonicalId,
  clauseId,
})

const matchingEntry = (
  entries: readonly AbilityUsageEntry[],
  identity: Pick<AbilityUsageEntry, 'ownerId' | 'abilityInstanceId' | 'canonicalId' | 'clauseId'>,
): AbilityUsageEntry | null => {
  const key = abilityUsageResourceKey({ ...identity, limit: 1, spent: 0, operationIds: [] })
  return entries.find(entry => abilityUsageResourceKey(entry) === key) ?? null
}

const spendLedger = <Ledger extends AbilitySceneUsageLedger | AbilityDailyUsageLedger>(input: {
  readonly ledger: Ledger
  readonly identity: Pick<AbilityUsageEntry, 'ownerId' | 'abilityInstanceId' | 'canonicalId' | 'clauseId'>
  readonly limit: number
  readonly operationId: string
}): { readonly status: 'paid' | 'duplicate'; readonly ledger: Ledger; readonly entry: AbilityUsageEntry } => {
  const operationEntry = input.ledger.entries.find(entry => entry.operationIds.includes(input.operationId))
  const existing = matchingEntry(input.ledger.entries, input.identity)
  if (operationEntry) {
    if (existing !== operationEntry) {
      fail('operation-id-conflict', `Operation ${input.operationId} already paid another resource.`)
    }
    return { status: 'duplicate', ledger: input.ledger, entry: operationEntry }
  }
  if (existing && existing.limit !== input.limit) {
    fail('resource-conflict', 'Ability usage limit changed within one authoritative period.')
  }
  if ((existing?.spent ?? 0) >= input.limit) {
    fail('uses-exhausted', `${input.identity.canonicalId} has no uses remaining.`)
  }
  const nextEntry: AbilityUsageEntry = {
    ...input.identity,
    limit: input.limit,
    spent: (existing?.spent ?? 0) + 1,
    operationIds: [...(existing?.operationIds ?? []), input.operationId],
  }
  const entries = existing
    ? input.ledger.entries.map(entry => entry === existing ? nextEntry : entry)
    : [...input.ledger.entries, nextEntry]
  return { status: 'paid', ledger: { ...input.ledger, entries } as Ledger, entry: nextEntry }
}

const result = (
  status: AbilityFrequencyPaymentStatus,
  period: 'at-will' | 'scene' | 'daily',
  entry: AbilityUsageEntry | null,
  plan = createMoveStateChangePlan([]),
): AbilityFrequencyPaymentResult => Object.freeze({
  status,
  period,
  spent: entry?.spent ?? 0,
  limit: entry?.limit ?? null,
  remaining: entry ? entry.limit - entry.spent : null,
  plan,
})

/** Plan one idempotent frequency payment without mutating map or sheet state. */
export const planAbilityFrequencyPayment = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly frequency: AbilityFrequencyDeclaration
  readonly exceptionClause?: AbilityFrequencyExceptionClause
  readonly abilityInstanceId: string
  readonly clauseId: string
  readonly operationId: string
  readonly sceneId?: string
  readonly dayKey?: string
}): AbilityFrequencyPaymentResult => {
  const { context } = input
  const effectiveAbility = context.actor.effectiveAbilities.find(ability => (
    ability.instanceId === input.abilityInstanceId
    && ability.canonicalId === context.runtime.canonicalId
  )) ?? fail(
    'ability-instance-missing',
    'Frequency payment ability instance is not on the actor projection.',
  )
  if (input.frequency.kind === 'exceptional') {
    if (!input.exceptionClause || input.exceptionClause.id !== input.clauseId) {
      fail('clause-mismatch', 'Exceptional payment must use its reviewed clause ID.')
    }
  }
  else if (input.exceptionClause || input.clauseId !== 'base') {
    fail('clause-mismatch', 'Canonical frequency payment must use the base clause.')
  }
  const resource = paymentPeriod(input)
  if (resource.period === 'round') fail('unsupported-period', 'Round resources are owned by AA-023.')
  if (resource.period === 'at-will') return result('not-required', 'at-will', null)
  const limit = resource.limit
    ?? fail('invalid-frequency', `${resource.period} frequency requires a finite limit.`)
  if (resource.period === 'scene') {
    const identity = resourceIdentity(
      context,
      context.actor.placement.id,
      input.abilityInstanceId,
      input.clauseId,
    )
    const sceneId = input.sceneId
      ?? fail('scene-id-mismatch', 'Scene payment requires an authoritative scene ID.')
    const previousEncounter = parseEncounterState(
      context.map.encounterState ?? createEmptyEncounterState(),
    )
    const previousLedger = parseAbilitySceneUsageLedger(
      previousEncounter.abilityUsage ?? createEmptyAbilitySceneUsageLedger(),
    )
    if (previousLedger.sceneId !== null && previousLedger.sceneId !== sceneId) {
      fail('scene-id-mismatch', 'Scene usage belongs to a different scene lifecycle.')
    }
    const spent = spendLedger({
      ledger: { ...previousLedger, sceneId },
      identity,
      limit,
      operationId: input.operationId,
    })
    if (spent.status === 'duplicate') return result('duplicate', 'scene', spent.entry)
    const currentEncounter = parseEncounterState({
      ...previousEncounter,
      abilityUsage: parseAbilitySceneUsageLedger(spent.ledger),
    })
    const plan = createMoveStateChangePlan([{
      kind: 'encounter-state',
      scope: { kind: 'encounter', mapSlug: context.map.slug },
      expectedRevision: normalizeRevision(context.map.revision),
      sourceOperationId: input.operationId,
      reasonCode: 'ability-frequency.scene-spent',
      previous: previousEncounter,
      current: currentEncounter,
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    }])
    return result('paid', 'scene', spent.entry, plan)
  }

  const lastingAbilityId = effectiveAbility.sourceKind === 'base'
    ? `base:${context.runtime.canonicalId}`
    : input.abilityInstanceId
  const identity = resourceIdentity(
    context,
    `sheet:${context.actor.sheet.kind}:${context.actor.sheet.slug}`,
    lastingAbilityId,
    input.clauseId,
  )
  const dayKey = input.dayKey
    ?? fail('day-key-mismatch', 'Daily payment requires an authoritative campaign-day key.')
  const previousSheet = context.actor.sheet.sheet
  const previousLedger = parseAbilityDailyUsageLedger(
    previousSheet.abilityUsage ?? createEmptyAbilityDailyUsageLedger(),
  )
  if (previousLedger.dayKey !== null && previousLedger.dayKey !== dayKey) {
    fail('day-key-mismatch', 'Daily usage belongs to a different campaign day lifecycle.')
  }
  const spent = spendLedger({
    ledger: { ...previousLedger, dayKey },
    identity,
    limit,
    operationId: input.operationId,
  })
  if (spent.status === 'duplicate') return result('duplicate', 'daily', spent.entry)
  const currentSheet = {
    ...deepCloneJson(previousSheet),
    abilityUsage: parseAbilityDailyUsageLedger(spent.ledger),
    revision: nextRevision(context.actor.sheet.revision),
  }
  const plan = createMoveStateChangePlan([{
    kind: 'sheet-state',
    scope: {
      kind: 'sheet',
      sheetKind: context.actor.sheet.kind,
      sheetSlug: context.actor.sheet.slug,
    },
    expectedRevision: context.actor.sheet.revision,
    sourceOperationId: input.operationId,
    reasonCode: 'ability-frequency.daily-spent',
    previous: deepCloneJson(previousSheet),
    current: currentSheet,
    changedFields: ['abilityUsage'],
    compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  }])
  return result('paid', 'daily', spent.entry, plan)
}

const sameScope = (left: MoveStateChange, right: MoveStateChange): boolean => (
  JSON.stringify(left.scope) === JSON.stringify(right.scope)
)

/** Merge a fresh payment into disjoint effects so one state plan commits both. */
export const attachAbilityFrequencyPayment = (
  effects: MoveStateChangePlan,
  payment: AbilityFrequencyPaymentResult,
): MoveStateChangePlan => {
  if (payment.status === 'duplicate') {
    fail('payment-plan-conflict', 'Duplicate payment must replay its stored resolution, not reapply effects.')
  }
  if (payment.plan.changes.length === 0) return effects
  if (payment.status !== 'paid' || payment.plan.changes.length !== 1) {
    fail('payment-plan-conflict', 'Fresh frequency payment must own exactly one state change.')
  }
  const paymentChange = payment.plan.changes[0]!
  const matching = effects.changes.find(change => sameScope(change, paymentChange))
  if (!matching) {
    return createMoveStateChangePlan([paymentChange, ...effects.changes])
  }
  if (
    matching.kind !== paymentChange.kind
    || matching.expectedRevision !== paymentChange.expectedRevision
    || !sameJsonValue(matching.previous, paymentChange.previous)
  ) {
    fail('payment-plan-conflict', 'Payment and effects did not observe the same resource revision.')
  }

  let merged: MoveStateChangeInput
  if (matching.kind === 'sheet-state' && paymentChange.kind === 'sheet-state') {
    const overlap = matching.changedFields.filter(field => paymentChange.changedFields.includes(field))
    if (overlap.length > 0) {
      fail('payment-plan-conflict', `Payment and effects both change ${overlap.join(', ')}.`)
    }
    merged = {
      ...matching,
      sourceOperationId: paymentChange.sourceOperationId,
      reasonCode: 'ability.atomic-payment-and-effects',
      current: {
        ...matching.current,
        abilityUsage: paymentChange.current.abilityUsage,
      },
      changedFields: [...paymentChange.changedFields, ...matching.changedFields],
    }
  }
  else if (matching.kind === 'encounter-state' && paymentChange.kind === 'encounter-state') {
    merged = {
      ...matching,
      sourceOperationId: paymentChange.sourceOperationId,
      reasonCode: 'ability.atomic-payment-and-effects',
      current: {
        ...matching.current,
        abilityUsage: paymentChange.current.abilityUsage,
      },
    }
  }
  else {
    return fail('payment-plan-conflict', 'Payment scope cannot merge with this effect change kind.')
  }

  return createMoveStateChangePlan(
    effects.changes.map(change => change === matching ? merged : change),
  )
}
