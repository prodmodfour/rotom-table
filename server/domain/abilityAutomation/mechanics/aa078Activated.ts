import { createHash } from 'node:crypto'
import { normalizeRevision } from '#shared/sessionRevisions'
import type { AbilityDeclarationOptionValue } from '#shared/abilityAutomation/declarationIntent'
import type { AbilityFrequencyDeclaration } from '#shared/abilityAutomation/frequency'
import type { AbilityMechanicOperation } from '#shared/abilityAutomation/mechanics'
import {
  AA078_LIGHTNING_KICKS_MARK_ID,
  AA078_LIQUID_VOICE_OPTION_BY_ID,
  AA078_MAELSTROM_PULSE_MARK_ID,
  aa078OwnedMarks,
} from '#shared/abilityAutomation/aa078'
import {
  createEmptyAbilityOwnedState,
  parseAbilityOwnedState,
} from '#shared/abilityAutomation/ownedState'
import {
  createEmptyEncounterState,
  parseEncounterState,
  type EncounterState,
} from '#shared/moveAutomation/encounterState'
import { planEncounterMoveResourceCosts } from '../../moveAutomation/planMoveResources'
import {
  createMoveStateChangePlan,
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  type MoveStateChangeInput,
  type MoveStateChangePlan,
} from '../../moveAutomation/plan'
import type { AuthoritativeAbilityContext } from '../context'
import { reduceAbilityOwnedStateCommand } from '../ownedState'
import { planAbilityFrequencyPayment } from '../usage'

const SCENE_FREQUENCY = Object.freeze({
  raw: 'Scene', actionText: '', kind: 'scene', uses: 1, exceptionId: null,
} satisfies AbilityFrequencyDeclaration)
const SCENE_X2_FREQUENCY = Object.freeze({
  raw: 'Scene x2', actionText: '', kind: 'scene', uses: 2, exceptionId: null,
} satisfies AbilityFrequencyDeclaration)

export class Aa078ActivatedExecutionError extends Error {
  constructor(detail: string) { super(detail); this.name = 'Aa078ActivatedExecutionError' }
}
const fail = (detail: string): never => { throw new Aa078ActivatedExecutionError(detail) }
const shortHash = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)

const effectiveInstanceId = (context: AuthoritativeAbilityContext, canonicalId: string): string => (
  context.actor.effectiveAbilities.find(ability => ability.effective && ability.canonicalId === canonicalId)?.instanceId
  ?? fail(`${canonicalId} effective instance disappeared.`)
)

const encounterChange = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly reasonCode: string
  readonly current: EncounterState
}): MoveStateChangeInput => ({
  kind: 'encounter-state',
  scope: { kind: 'encounter', mapSlug: input.context.map.slug },
  expectedRevision: normalizeRevision(input.context.map.revision),
  sourceOperationId: input.operationId,
  reasonCode: input.reasonCode,
  previous: parseEncounterState(input.context.map.encounterState ?? createEmptyEncounterState()),
  current: input.current,
  compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
})

const contextWithEncounter = (
  context: AuthoritativeAbilityContext,
  encounterState: EncounterState,
): AuthoritativeAbilityContext => ({ ...context, map: { ...context.map, encounterState } })

const payFreeAction = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly canonicalId: string
}): EncounterState => planEncounterMoveResourceCosts({
  map: input.context.map,
  placementId: input.context.actor.placement.id,
  canonicalMoveId: `ability:${input.canonicalId}`,
  moveKey: `ability:${input.canonicalId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  range: 'Free Action',
  resolutionId: input.context.resolutionId,
  sourceOperationId: `${input.operationId}:action`,
  movement: null,
  reviewedCosts: [{
    id: 'ability.action.free', phase: 'pay',
    cost: { kind: 'action-resource', resource: 'free', amount: 1 },
  }],
  allowLegacyFallback: false,
  minimumPhaseExclusive: null,
  maximumPhaseInclusive: 'pay',
}).currentEncounterState

const payFrequency = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly encounter: EncounterState
  readonly operationId: string
  readonly canonicalId: string
  readonly frequency: AbilityFrequencyDeclaration | null
}): EncounterState => {
  if (input.frequency === null) return input.encounter
  const context = contextWithEncounter(input.context, input.encounter)
  const payment = planAbilityFrequencyPayment({
    context,
    frequency: input.frequency,
    abilityInstanceId: effectiveInstanceId(context, input.canonicalId),
    clauseId: 'base',
    operationId: `${input.operationId}:frequency`,
    sceneId: context.map.encounterState?.history.sceneId ?? undefined,
  })
  const change = payment.plan.changes.find(candidate => candidate.kind === 'encounter-state')
    ?? fail(`${input.canonicalId} did not produce its Scene payment.`)
  return parseEncounterState(change.current)
}

const selectedLiquidVoiceMarkId = (
  choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[],
): string => {
  const selected = choices.find(choice => choice.declarationId === 'activate.mode')?.options[0]?.value
  if (selected?.kind !== 'branch') return fail('Liquid Voice requires one issued mode choice.')
  return AA078_LIQUID_VOICE_OPTION_BY_ID[
    selected.branchId as keyof typeof AA078_LIQUID_VOICE_OPTION_BY_ID
  ] ?? fail('Liquid Voice received an unsupported mode choice.')
}

const armMove = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly canonicalId: 'Lightning Kicks' | 'Liquid Voice' | 'Maelstrom Pulse'
  readonly markId: string
  readonly frequency: AbilityFrequencyDeclaration | null
}): Aa078ActivatedExecution => {
  const abilityInstanceId = effectiveInstanceId(input.context, input.canonicalId)
  if (aa078OwnedMarks({
    entries: input.context.map.encounterState?.abilityOwnedState?.entries,
    ownerPlacementId: input.context.actor.placement.id,
    canonicalId: input.canonicalId,
    markIds: new Set(input.canonicalId === 'Liquid Voice'
      ? Object.values(AA078_LIQUID_VOICE_OPTION_BY_ID)
      : [input.markId]),
  }).length > 0) fail(`${input.canonicalId} already has an unspent Move declaration.`)

  const action = payFreeAction(input)
  const paid = payFrequency({ ...input, encounter: action })
  const slug = input.canonicalId.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const stateId = `aa078.${slug}.${shortHash(input.operationId, input.context.actor.placement.id)}`
  const reduced = reduceAbilityOwnedStateCommand(
    paid.abilityOwnedState ?? createEmptyAbilityOwnedState(),
    {
      operationId: `${input.operationId}:${slug}-mark`,
      kind: 'create', stateId, expectedVersion: null,
      entry: {
        stateId,
        ownerPlacementId: input.context.actor.placement.id,
        sourceAbilityInstanceId: abilityInstanceId,
        canonicalId: input.canonicalId,
        targetPlacementIds: [],
        lifecycle: { kind: 'source-ability', targetPolicy: null },
        payload: { kind: 'mark', markId: input.markId },
      },
    },
  )
  const current = parseEncounterState({
    ...paid,
    abilityOwnedState: parseAbilityOwnedState(reduced.state),
  })
  return Object.freeze({
    plan: createMoveStateChangePlan([encounterChange({
      context: input.context,
      operationId: input.operationId,
      reasonCode: `ability.aa078.${slug}.action-frequency-and-mark`,
      current,
    })]),
    presentationKey: `ability.aa078.${slug}.armed`,
  })
}

export interface Aa078ActivatedExecution {
  readonly plan: MoveStateChangePlan
  readonly presentationKey: string
}

export const executeAa078ActivatedMechanic = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operation: AbilityMechanicOperation
  readonly operationId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa078ActivatedExecution => {
  if (input.operation.mechanicId === 'aa078.lightning-kicks') return armMove({
    ...input, canonicalId: 'Lightning Kicks', markId: AA078_LIGHTNING_KICKS_MARK_ID,
    frequency: SCENE_FREQUENCY,
  })
  if (input.operation.mechanicId === 'aa078.liquid-voice') return armMove({
    ...input, canonicalId: 'Liquid Voice', markId: selectedLiquidVoiceMarkId(input.choices),
    frequency: null,
  })
  if (input.operation.mechanicId === 'aa078.maelstrom-pulse') return armMove({
    ...input, canonicalId: 'Maelstrom Pulse', markId: AA078_MAELSTROM_PULSE_MARK_ID,
    frequency: SCENE_X2_FREQUENCY,
  })
  return fail(`AA-078 mechanic ${input.operation.mechanicId} is not a direct activated adapter.`)
}
