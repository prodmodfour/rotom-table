import { createHash } from 'node:crypto'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { AbilityDeclarationOptionValue } from '#shared/abilityAutomation/declarationIntent'
import type { AbilityFrequencyDeclaration } from '#shared/abilityAutomation/frequency'
import type { AbilityMechanicOperation } from '#shared/abilityAutomation/mechanics'
import { createEmptyAbilityTransformationState } from '#shared/abilityAutomation/transformations'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import type { EncounterEffect, EncounterEffectDuration } from '#shared/moveAutomation/encounterEffects'
import { parseEncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { PokemonTypeId } from '#shared/pokemonTypes'
import type { CharacterSheet } from '~/types/characterSheet'
import type { MapFieldEffects } from '~/types/map'
import type { CombatStageKey, CombatStageMap } from '~/types/combatStages'
import {
  applyCombatStagesToSheet,
  applyConditionsToSheet,
  applyHpToSheet,
  type AnyLiveSheet,
} from '~/utils/sheetMutations'
import { clampCombatStage } from '~/utils/combatStages'
import { computeTickValue } from '~/utils/ptuHp'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import { deepCloneJson } from '~/utils/serialization'
import { normalizeConditionName, normalizeConditionNames } from '~/utils/statusConditions'
import { abilityIsCopyable } from '../effectiveAbilities'
import { reduceAbilityTransformationCommand } from '../transformations'
import { applyMapGlobalField } from '../../moveAutomation/fieldMapState'
import {
  createMoveStateChangePlan,
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  type MoveStateChangeInput,
  type MoveStateChangePlan,
} from '../../moveAutomation/plan'
import { planEncounterMoveResourceCosts } from '../../moveAutomation/planMoveResources'
import type { AuthoritativeAbilityContext } from '../context'
import { planAbilityFrequencyPayment } from '../usage'
import { authoritativeAbilityHealingBlocked } from '../healingPrevention'
import { aa084PowerConstructBlocksTemporaryHp } from './aa084StaticIntegration'
import { aa064ContraryRequestedValue } from './aa064StageIntegration'

export interface Aa085To100ActivatedExecution {
  readonly plan: MoveStateChangePlan
  readonly presentationKey: string
  readonly controllerPresentationValues?: readonly string[]
}

export class Aa085To100ActivatedExecutionError extends Error {
  constructor(detail: string) {
    super(detail)
    this.name = 'Aa085To100ActivatedExecutionError'
  }
}

const fail = (detail: string): never => { throw new Aa085To100ActivatedExecutionError(detail) }
const hash = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)

interface DirectRule {
  readonly action: 'free' | 'full' | 'shift' | 'standard' | 'swift'
  readonly extraAction?: 'standard' | 'swift'
  readonly frequency: 'at-will' | 'daily' | 'daily-x5' | 'scene' | 'scene-x2' | 'scene-x3'
}

const DIRECT_RULES: Readonly<Record<string, DirectRule>> = Object.freeze({
  'Psychic Surge': { action: 'swift', frequency: 'scene-x3' },
  Pumpkingrab: { action: 'standard', frequency: 'scene' },
  'Quick Cloak': { action: 'standard', frequency: 'at-will' },
  'Quick Curl': { action: 'free', extraAction: 'standard', frequency: 'scene' },
  'Rain Dish': { action: 'swift', frequency: 'daily-x5' },
  Rally: { action: 'swift', frequency: 'scene' },
  'Regal Challenge': { action: 'swift', frequency: 'scene' },
  'Root Down': { action: 'shift', frequency: 'at-will' },
  'Sand Stream': { action: 'swift', frequency: 'scene-x3' },
  Schooling: { action: 'free', frequency: 'daily' },
  'Screen Cleaner': { action: 'standard', frequency: 'daily' },
  Shackle: { action: 'swift', frequency: 'scene' },
  'Shadow Tag': { action: 'free', frequency: 'scene' },
  'Shed Skin': { action: 'swift', frequency: 'scene' },
  'Shell Shield': { action: 'free', extraAction: 'standard', frequency: 'scene' },
  'Snow Warning': { action: 'free', frequency: 'scene' },
  Snuggle: { action: 'standard', frequency: 'scene' },
  'Splendorous Rider': { action: 'swift', frequency: 'scene-x2' },
  Starlight: { action: 'swift', frequency: 'daily' },
  Starswirl: { action: 'swift', frequency: 'scene' },
  'Strange Tempo': { action: 'standard', frequency: 'at-will' },
  'Suction Cups': { action: 'shift', frequency: 'at-will' },
  Sunglow: { action: 'swift', frequency: 'daily' },
  Symbiosis: { action: 'swift', frequency: 'scene' },
  'Targeting System': { action: 'free', extraAction: 'swift', frequency: 'scene' },
  'Toxic Boost': { action: 'swift', frequency: 'scene' },
  'Toxic Nourishment': { action: 'swift', frequency: 'scene' },
  Trace: { action: 'free', frequency: 'scene' },
  Unnerve: { action: 'swift', frequency: 'at-will' },
  'Zen Mode': { action: 'swift', frequency: 'scene' },
  'Zen Snowed': { action: 'swift', frequency: 'scene' },
})

const frequencyDeclaration = (frequency: DirectRule['frequency']): AbilityFrequencyDeclaration | null => {
  if (frequency === 'at-will') return null
  const daily = frequency.startsWith('daily')
  const uses = frequency.endsWith('x5') ? 5
    : frequency.endsWith('x3') ? 3
      : frequency.endsWith('x2') ? 2 : 1
  return {
    raw: `${daily ? 'Daily' : 'Scene'}${uses > 1 ? ` x${uses}` : ''}`,
    actionText: '', kind: daily ? 'daily' : 'scene', uses, exceptionId: null,
  }
}

const contextWithEncounter = (
  context: AuthoritativeAbilityContext,
  encounterState: ReturnType<typeof parseEncounterState>,
): AuthoritativeAbilityContext => ({
  ...context,
  map: { ...context.map, encounterState },
})

interface PaidState {
  readonly encounter: ReturnType<typeof parseEncounterState>
  readonly sheet: AnyLiveSheet | null
}

const paidState = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
  readonly skipFrequency?: boolean
}): PaidState => {
  const rule = DIRECT_RULES[input.canonicalId] ?? fail(`No direct rule for ${input.canonicalId}.`)
  const reviewedCosts = [rule.action, ...(rule.extraAction ? [rule.extraAction] : [])].map(
    (resource, index) => ({
      id: `ability.action.${resource}.${index}`,
      phase: 'pay' as const,
      cost: { kind: 'action-resource' as const, resource, amount: 1 },
    }),
  )
  const action = planEncounterMoveResourceCosts({
    map: input.context.map,
    placementId: input.context.actor.placement.id,
    canonicalMoveId: `ability:${input.canonicalId}`,
    moveKey: `ability:${input.canonicalId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    range: `${rule.action} action`,
    resolutionId: input.context.resolutionId,
    sourceOperationId: `${input.operationId}:action`,
    movement: null,
    reviewedCosts,
    allowLegacyFallback: false,
    minimumPhaseExclusive: null,
    maximumPhaseInclusive: 'pay',
  }).currentEncounterState
  const frequency = input.skipFrequency ? null : frequencyDeclaration(rule.frequency)
  if (!frequency) return { encounter: action, sheet: null }
  const paidContext = contextWithEncounter(input.context, action)
  const payment = planAbilityFrequencyPayment({
    context: paidContext,
    frequency,
    abilityInstanceId: input.abilityInstanceId,
    clauseId: 'base',
    operationId: `${input.operationId}:frequency`,
    ...(frequency.kind === 'scene'
      ? { sceneId: action.history.sceneId ?? undefined }
      : { dayKey: input.context.actor.sheet.sheet.abilityUsage?.dayKey ?? 'campaign-day:initial' }),
  })
  const encounterChange = payment.plan.changes.find(change => change.kind === 'encounter-state')
  const sheetChange = payment.plan.changes.find(change => change.kind === 'sheet-state')
  return {
    encounter: encounterChange?.kind === 'encounter-state'
      ? parseEncounterState(encounterChange.current)
      : action,
    sheet: sheetChange?.kind === 'sheet-state'
      ? deepCloneJson(sheetChange.current) as AnyLiveSheet
      : null,
  }
}

const encounterChange = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly reasonCode: string
  readonly current: unknown
}): MoveStateChangeInput => ({
  kind: 'encounter-state',
  scope: { kind: 'encounter', mapSlug: input.context.map.slug },
  expectedRevision: normalizeRevision(input.context.map.revision),
  sourceOperationId: input.operationId,
  reasonCode: input.reasonCode,
  previous: parseEncounterState(input.context.map.encounterState ?? createEmptyEncounterState()),
  current: parseEncounterState(input.current),
  compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
})

const sheetChange = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly reasonCode: string
  readonly resolved: AuthoritativeAbilityContext['actor']['sheet']
  readonly current: AnyLiveSheet
  readonly changedFields: readonly ('abilityUsage' | 'combatStages' | 'conditions' | 'hp')[]
}): MoveStateChangeInput => ({
  kind: 'sheet-state',
  scope: {
    kind: 'sheet', sheetKind: input.resolved.kind, sheetSlug: input.resolved.slug,
  },
  expectedRevision: input.resolved.revision,
  sourceOperationId: input.operationId,
  reasonCode: input.reasonCode,
  previous: deepCloneJson(input.resolved.sheet),
  current: input.current,
  changedFields: input.changedFields,
  compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
})

const selected = (
  choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[],
  declarationId: string,
): AbilityDeclarationOptionValue | null => choices.find(choice => choice.declarationId === declarationId)
  ?.options[0]?.value ?? null

const targetId = (input: {
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): string => {
  const value = selected(input.choices, 'activate.target')
  return value?.kind === 'token' ? value.placementId : fail('The ability requires one issued target.')
}

const actorSheetWithPayment = (
  input: { readonly context: AuthoritativeAbilityContext },
  paid: PaidState,
): AnyLiveSheet => deepCloneJson(paid.sheet ?? input.context.actor.sheet.sheet) as AnyLiveSheet

const effect = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly canonicalId: string
  readonly affectedIds: readonly string[]
  readonly kind: EncounterEffect['kind']
  readonly tags: readonly string[]
  readonly payload: EncounterEffect['payload']
  readonly duration: EncounterEffectDuration
  readonly cells?: readonly { readonly x: number; readonly y: number; readonly z: number }[]
}): EncounterEffect => parseEncounterEffect({
  id: `ability.${input.canonicalId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${hash(
    input.operationId, ...input.affectedIds, ...input.tags,
  )}`,
  kind: input.kind,
  source: {
    operationId: input.operationId,
    moveId: `ability.${input.canonicalId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    placementId: input.context.actor.placement.id,
  },
  affected: {
    placementIds: [...input.affectedIds], sideIds: [], cells: input.cells ?? [],
  },
  createdRound: Math.max(1, input.context.map.initiative?.round ?? 1),
  createdTurn: Math.max(0, input.context.map.encounterState?.history.currentTurn?.turn ?? 0),
  duration: input.duration,
  stacks: 1,
  charges: null,
  stackPolicy: { kind: 'replace', maxStacks: null },
  chargePolicy: { kind: 'none', amount: null },
  tags: ['ability', 'remaining-catalog', ...input.tags],
  payload: input.payload,
  dispel: { policy: 'matching-tags', tags: [...input.tags] },
  transferPolicy: 'expire',
  suppression: { sources: [] },
}, `ability.${input.canonicalId}`)

const withEffect = (
  encounter: ReturnType<typeof parseEncounterState>,
  nextEffect: EncounterEffect,
): ReturnType<typeof parseEncounterState> => parseEncounterState({
  ...encounter,
  effects: [
    ...encounter.effects.filter(candidate => candidate.id !== nextEffect.id),
    nextEffect,
  ],
})

const field = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
  readonly kind: 'terrain' | 'weather'
  readonly fieldId: 'psychic' | 'sandstorm' | 'hail'
  readonly rounds: number
}): Aa085To100ActivatedExecution => {
  const paid = paidState(input)
  const reduced = applyMapGlobalField({
    map: { ...input.context.map, encounterState: paid.encounter },
    kind: input.kind,
    fieldId: input.fieldId,
    source: {
      kind: 'operation', operationId: input.operationId,
      moveId: `ability.${input.canonicalId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      placementId: input.context.actor.placement.id,
    },
    sideId: input.context.actor.placement.sideId ?? null,
    duration: { kind: 'rounds', boundary: 'end', remaining: input.rounds },
    replacementGroup: input.kind === 'weather'
      ? 'field.weather'
      : `field.terrain.${input.fieldId}`,
    replacementScope: input.kind === 'weather' ? 'category' : 'kind',
    sourceLabel: input.canonicalId,
  })
  const changes: MoveStateChangeInput[] = [encounterChange({
    ...input, reasonCode: `ability.${input.canonicalId}.field`,
    current: reduced.map.encounterState,
  })]
  const previousFields: MapFieldEffects = input.context.map.fieldEffects
    ?? { weather: [], terrains: [], rooms: [] }
  const currentFields: MapFieldEffects = reduced.map.fieldEffects
    ?? { weather: [], terrains: [], rooms: [] }
  if (JSON.stringify(previousFields) !== JSON.stringify(currentFields)) changes.push({
    kind: 'map-field-effects',
    scope: { kind: 'map', mapSlug: input.context.map.slug },
    expectedRevision: normalizeRevision(input.context.map.revision),
    sourceOperationId: `${input.operationId}:field`,
    reasonCode: `ability.${input.canonicalId}.field-projection`,
    previous: deepCloneJson(previousFields), current: deepCloneJson(currentFields),
    compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  })
  if (paid.sheet) changes.push(sheetChange({
    ...input, resolved: input.context.actor.sheet,
    reasonCode: `ability.${input.canonicalId}.frequency`,
    current: paid.sheet, changedFields: ['abilityUsage'],
  }))
  return {
    plan: createMoveStateChangePlan(changes),
    presentationKey: `ability.${input.canonicalId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.field-applied`,
  }
}

const actorSheetExecution = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
  readonly apply: (sheet: AnyLiveSheet) => { readonly sheet: AnyLiveSheet; readonly fields: readonly ('combatStages' | 'conditions' | 'hp')[] }
}): Aa085To100ActivatedExecution => {
  const paid = paidState(input)
  const applied = input.apply(actorSheetWithPayment(input, paid))
  applied.sheet.revision = nextRevision(input.context.actor.sheet.revision)
  const fields = [...new Set([
    ...(paid.sheet ? ['abilityUsage' as const] : []), ...applied.fields,
  ])]
  return {
    plan: createMoveStateChangePlan([
      encounterChange({
        ...input, reasonCode: `ability.${input.canonicalId}.action-frequency`, current: paid.encounter,
      }),
      sheetChange({
        ...input, resolved: input.context.actor.sheet,
        reasonCode: `ability.${input.canonicalId}.sheet-effect`,
        current: applied.sheet, changedFields: fields,
      }),
    ]),
    presentationKey: `ability.${input.canonicalId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.applied`,
  }
}

const temporaryHpChange = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly additions: Readonly<Record<string, number>>
}): MoveStateChangeInput => {
  const scene = input.context.map.activeScene ?? fail('Temporary Hit Points require an active Scene.')
  const previous = input.context.map.temporaryHitPoints
  const currentBase = previous
    && previous.scene.name === scene.name
    && previous.scene.startedAt === scene.startedAt
    ? previous : { scene: { ...scene }, byPlacementId: {} }
  const byPlacementId = { ...currentBase.byPlacementId }
  for (const [placementId, amount] of Object.entries(input.additions)) {
    if (amount <= 0
      || authoritativeAbilityHealingBlocked({ map: input.context.map, placementId })
      || aa084PowerConstructBlocksTemporaryHp({
        context: input.context, placementId,
      })) continue
    byPlacementId[placementId] = (byPlacementId[placementId] ?? 0) + amount
  }
  return {
    kind: 'map-temporary-hit-points',
    scope: { kind: 'map', mapSlug: input.context.map.slug },
    expectedRevision: normalizeRevision(input.context.map.revision),
    sourceOperationId: `${input.operationId}:temporary-hp`,
    reasonCode: 'ability.remaining.temporary-hp',
    previous: deepCloneJson(previous),
    current: { scene: { ...currentBase.scene }, byPlacementId },
    compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  }
}

const pumpkingrab = (input: ExecuteInput): Aa085To100ActivatedExecution => {
  const id = targetId(input)
  const target = input.context.queries.tokens.get(id) ?? fail('Pumpkingrab target disappeared.')
  if (input.context.queries.relationships.relation(input.context.actor.placement.id, id) !== 'enemy'
    || ptuGridDistanceBetweenFootprints(input.context.actor.token, target) > 1) {
    fail('Pumpkingrab requires an adjacent foe.')
  }
  const paid = paidState({ ...input, canonicalId: 'Pumpkingrab' })
  const grapple = effect({
    ...input, canonicalId: 'Pumpkingrab', affectedIds: [input.context.actor.placement.id, id],
    kind: 'capability', tags: ['aa085-pumpkingrab', 'grapple', 'dominance'],
    payload: { capabilityId: 'aa085.pumpkingrab.dominant-grapple', action: 'grant' },
    duration: { kind: 'scene', remaining: null },
    cells: [target.position],
  })
  return {
    plan: createMoveStateChangePlan([encounterChange({
      ...input, reasonCode: 'ability.pumpkingrab.dominant-grapple',
      current: withEffect(paid.encounter, grapple),
    })]),
    presentationKey: 'ability.pumpkingrab.dominant-grapple',
  }
}

const quickCloak = (input: ExecuteInput): Aa085To100ActivatedExecution => {
  const species = 'species' in input.context.actor.sheet.sheet
    ? input.context.actor.sheet.sheet.species.trim().toLowerCase() : ''
  if (!species.includes('burmy')) fail('Quick Cloak may be used only by Burmy.')
  const typeValue = selected(input.choices, 'activate.type')
  const typeId = typeValue?.kind === 'type' ? typeValue.typeId : fail('Quick Cloak requires a cloak Type.')
  if (!['grass', 'ground', 'steel'].includes(typeId)) fail('Quick Cloak supports only Plant, Sandy, or Trash materials.')
  const paid = paidState({ ...input, canonicalId: 'Quick Cloak' })
  const cloak = effect({
    ...input, canonicalId: 'Quick Cloak', affectedIds: [input.context.actor.placement.id],
    kind: 'creature-rule-overlay', tags: ['aa085-quick-cloak', `cloak-${typeId}`],
    payload: {
      domain: 'type', action: 'add', values: [typeId as PokemonTypeId],
      referencePlacementId: null, suppressionScope: null,
    },
    duration: { kind: 'scene', remaining: null },
  })
  const current = parseEncounterState({
    ...paid.encounter,
    effects: [
      ...paid.encounter.effects.filter(candidate => !(
        candidate.tags.includes('aa085-quick-cloak')
        && candidate.affected.placementIds.includes(input.context.actor.placement.id)
      )),
      cloak,
    ],
  })
  return {
    plan: createMoveStateChangePlan([encounterChange({
      ...input, reasonCode: 'ability.quick-cloak.created', current,
    })]),
    presentationKey: 'ability.quick-cloak.created',
    controllerPresentationValues: [typeId],
  }
}

const shield = (
  input: ExecuteInput,
  canonicalId: 'Quick Curl' | 'Shell Shield',
): Aa085To100ActivatedExecution => {
  const paid = paidState({ ...input, canonicalId })
  let sheet = actorSheetWithPayment(input, paid)
  const stages: CombatStageMap = {
    ...input.context.actor.token.combatStages,
    def: clampCombatStage(input.context.actor.token.combatStages.def + 1),
  }
  sheet = applyCombatStagesToSheet(input.context.actor.sheet.kind, sheet, stages)
  sheet.revision = nextRevision(input.context.actor.sheet.revision)
  const dr = effect({
    ...input, canonicalId, affectedIds: [input.context.actor.placement.id],
    kind: 'numeric-modifier', tags: ['aa085to100-shield', canonicalId === 'Quick Curl' ? 'quick-curl' : 'shell-shield'],
    payload: { attribute: 'damage-reduction', operation: 'add', value: 10, rounding: 'none' },
    duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
  })
  return {
    plan: createMoveStateChangePlan([
      encounterChange({ ...input, reasonCode: `ability.${canonicalId}.shield`, current: withEffect(paid.encounter, dr) }),
      sheetChange({
        ...input, resolved: input.context.actor.sheet, reasonCode: `ability.${canonicalId}.defense`,
        current: sheet, changedFields: [...(paid.sheet ? ['abilityUsage' as const] : []), 'combatStages'],
      }),
    ]),
    presentationKey: `ability.${canonicalId.toLowerCase().replaceAll(' ', '-')}.shield`,
  }
}

const rainDish = (input: ExecuteInput): Aa085To100ActivatedExecution => {
  const maximum = Math.max(1, input.context.actor.token.fullMaxHp ?? input.context.actor.token.maxHp)
  const rainy = (input.context.map.fieldEffects?.weather ?? []).some(weather => weather.kind === 'rainy')
  if (authoritativeAbilityHealingBlocked({
    map: input.context.map,
    placementId: input.context.actor.placement.id,
  })) fail('Rain Dish healing is blocked.')
  if (input.context.actor.token.currentHp * 2 >= maximum && !rainy) {
    fail('Rain Dish requires Rain or less than 50% Hit Points.')
  }
  return actorSheetExecution({
    ...input, canonicalId: 'Rain Dish',
    apply: (sheet) => ({
      sheet: applyHpToSheet(
        input.context.actor.sheet.kind, sheet,
        Math.min(maximum, input.context.actor.token.currentHp + computeTickValue(maximum)),
        input.context.actor.token.injuries ?? 0,
      ),
      fields: ['hp'],
    }),
  })
}

const markerExecution = (input: ExecuteInput, options: {
  readonly canonicalId: string
  readonly affectedIds: readonly string[]
  readonly tag: string
  readonly capabilityId: string
  readonly duration: EncounterEffectDuration
  readonly cells?: readonly { readonly x: number; readonly y: number; readonly z: number }[]
  readonly extraTags?: readonly string[]
}): Aa085To100ActivatedExecution => {
  const paid = paidState({ ...input, canonicalId: options.canonicalId })
  const marker = effect({
    ...input, canonicalId: options.canonicalId, affectedIds: options.affectedIds,
    kind: 'capability', tags: [options.tag, ...(options.extraTags ?? [])],
    payload: { capabilityId: options.capabilityId, action: 'grant' },
    duration: options.duration, cells: options.cells,
  })
  const changes: MoveStateChangeInput[] = [encounterChange({
    ...input, reasonCode: `ability.${options.canonicalId}.marker`,
    current: withEffect(paid.encounter, marker),
  })]
  if (paid.sheet) changes.push(sheetChange({
    ...input, resolved: input.context.actor.sheet,
    reasonCode: `ability.${options.canonicalId}.frequency`,
    current: paid.sheet, changedFields: ['abilityUsage'],
  }))
  return {
    plan: createMoveStateChangePlan(changes),
    presentationKey: `ability.${options.canonicalId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.applied`,
  }
}

const regalChallenge = (input: ExecuteInput): Aa085To100ActivatedExecution => {
  const id = targetId(input)
  const target = input.context.queries.tokens.get(id) ?? fail('Regal Challenge target disappeared.')
  if (ptuGridDistanceBetweenFootprints(input.context.actor.token, target) > 10) {
    fail('Regal Challenge requires a target within 10 metres.')
  }
  const branch = selected(input.choices, 'activate.branch')
  const branchId = branch?.kind === 'branch' ? branch.branchId : fail('Regal Challenge requires a response branch.')
  const paid = paidState({ ...input, canonicalId: 'Regal Challenge' })
  if (branchId === 'defiance') {
    const marker = effect({
      ...input, canonicalId: 'Regal Challenge',
      affectedIds: [input.context.actor.placement.id], kind: 'capability',
      tags: ['aa086-regal-challenge-defiance'],
      payload: { capabilityId: 'aa086.regal-challenge.defiance-damage', action: 'grant' },
      duration: { kind: 'scene', remaining: null },
    })
    return {
      plan: createMoveStateChangePlan([encounterChange({
        ...input, reasonCode: 'ability.regal-challenge.defiance',
        current: withEffect(paid.encounter, marker),
      })]),
      presentationKey: 'ability.regal-challenge.defiance',
    }
  }
  if (branchId !== 'deference') fail('Regal Challenge response branch is invalid.')
  const statChoice = selected(input.choices, 'activate.stat')
  const stat = statChoice?.kind === 'stat'
    ? statChoice.statId as CombatStageKey : fail('Regal Challenge requires a Stat choice for Deference.')
  const placement = input.context.queries.placements.get(id) ?? fail('Regal Challenge target placement disappeared.')
  const resolved = input.context.queries.sheets.forPlacement(placement)
    ?? fail('Regal Challenge target sheet disappeared.')
  const current = target.combatStages[stat]
  const requested = aa064ContraryRequestedValue({
    recipientId: id, current, unboundedRequested: current - 3,
    abilities: {
      has: (placementId, canonicalId) => input.context.queries.effectiveAbilities
        .has(placementId, canonicalId),
    },
  })
  let sheet = applyCombatStagesToSheet(
    resolved.kind, deepCloneJson(resolved.sheet) as AnyLiveSheet,
    { ...target.combatStages, [stat]: clampCombatStage(requested) },
  )
  sheet.revision = nextRevision(resolved.revision)
  const marker = effect({
    ...input, canonicalId: 'Regal Challenge', affectedIds: [id], kind: 'capability',
    tags: ['aa086-regal-challenge-deference'],
    payload: { capabilityId: 'aa086.regal-challenge.lose-next-shift', action: 'grant' },
    duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 1 },
  })
  return {
    plan: createMoveStateChangePlan([
      encounterChange({
        ...input, reasonCode: 'ability.regal-challenge.deference',
        current: withEffect(paid.encounter, marker),
      }),
      sheetChange({
        ...input,
        resolved: { ...resolved, sheet: resolved.sheet },
        reasonCode: 'ability.regal-challenge.deference-stages',
        current: sheet, changedFields: ['combatStages'],
      }),
    ]),
    presentationKey: 'ability.regal-challenge.deference',
  }
}

const schooling = (input: ExecuteInput): Aa085To100ActivatedExecution => {
  const species = 'species' in input.context.actor.sheet.sheet
    ? input.context.actor.sheet.sheet.species.trim().toLowerCase() : ''
  if (!species.includes('wishiwashi')) fail('Schooling may be used only by Wishiwashi.')
  const paid = paidState({ ...input, canonicalId: 'Schooling' })
  const actorId = input.context.actor.placement.id
  const form = effect({
    ...input, canonicalId: 'Schooling', affectedIds: [actorId],
    kind: 'creature-rule-overlay', tags: ['aa088-schooling', 'school-form', 'blocks-temporary-hp'],
    payload: { domain: 'form', action: 'replace', value: 'wishiwashi-school-forme', referencePlacementId: null },
    duration: { kind: 'scene', remaining: null },
  })
  const maximum = Math.max(1, input.context.actor.token.fullMaxHp ?? input.context.actor.token.maxHp)
  const changes: MoveStateChangeInput[] = [
    encounterChange({ ...input, reasonCode: 'ability.schooling.form', current: withEffect(paid.encounter, form) }),
    temporaryHpChange({ ...input, additions: { [actorId]: Math.floor(maximum / 2) } }),
  ]
  if (paid.sheet) changes.push(sheetChange({
    ...input, resolved: input.context.actor.sheet, reasonCode: 'ability.schooling.frequency',
    current: paid.sheet, changedFields: ['abilityUsage'],
  }))
  return { plan: createMoveStateChangePlan(changes), presentationKey: 'ability.schooling.school-form' }
}

const screenCleaner = (input: ExecuteInput): Aa085To100ActivatedExecution => {
  const paid = paidState({ ...input, canonicalId: 'Screen Cleaner' })
  const current = parseEncounterState({
    ...paid.encounter,
    effects: paid.encounter.effects.filter(candidate => !candidate.tags.includes('blessing')),
  })
  const changes: MoveStateChangeInput[] = [encounterChange({
    ...input, reasonCode: 'ability.screen-cleaner.remove-blessings', current,
  })]
  if (paid.sheet) changes.push(sheetChange({
    ...input, resolved: input.context.actor.sheet, reasonCode: 'ability.screen-cleaner.frequency',
    current: paid.sheet, changedFields: ['abilityUsage'],
  }))
  return { plan: createMoveStateChangePlan(changes), presentationKey: 'ability.screen-cleaner.removed' }
}

const shedSkin = (input: ExecuteInput): Aa085To100ActivatedExecution => {
  const branch = selected(input.choices, 'activate.branch')
  const requested = branch?.kind === 'branch'
    ? normalizeConditionName(branch.branchId.replace(/^condition[.:]/, '').replaceAll('-', ' '))
    : null
  const eligible = normalizeConditionNames(input.context.actor.token.conditions)
    .filter(condition => ['Paralysis', 'Frozen', 'Burned', 'Poisoned', 'Badly Poisoned', 'Sleep'].includes(condition))
  const condition = requested && eligible.includes(requested) ? requested : eligible[0]
  if (!condition) fail('Shed Skin requires an eligible Status Condition.')
  return actorSheetExecution({
    ...input, canonicalId: 'Shed Skin',
    apply: sheet => ({
      sheet: applyConditionsToSheet(
        input.context.actor.sheet.kind, sheet,
        normalizeConditionNames(input.context.actor.token.sheetConditions)
          .filter(candidate => candidate !== condition),
      ),
      fields: ['conditions'],
    }),
  })
}

const snuggle = (input: ExecuteInput): Aa085To100ActivatedExecution => {
  const id = targetId(input)
  const target = input.context.queries.tokens.get(id) ?? fail('Snuggle target disappeared.')
  if (ptuGridDistanceBetweenFootprints(input.context.actor.token, target) > 1) {
    fail('Snuggle requires an adjacent target.')
  }
  const paid = paidState({ ...input, canonicalId: 'Snuggle' })
  const actorTick = computeTickValue(input.context.actor.token.fullMaxHp ?? input.context.actor.token.maxHp)
  const targetTick = computeTickValue(target.fullMaxHp ?? target.maxHp)
  return {
    plan: createMoveStateChangePlan([
      encounterChange({ ...input, reasonCode: 'ability.snuggle.frequency', current: paid.encounter }),
      temporaryHpChange({ ...input, additions: {
        [input.context.actor.placement.id]: actorTick * 2,
        [id]: targetTick * 2,
      } }),
    ]),
    presentationKey: 'ability.snuggle.temporary-hp',
  }
}

const luminous = (
  input: ExecuteInput,
  canonicalId: 'Starlight' | 'Sunglow',
): Aa085To100ActivatedExecution => {
  const actorId = input.context.actor.placement.id
  const tag = canonicalId === 'Starlight' ? 'aa092-luminous' : 'aa093-radiant'
  const existing = input.context.map.encounterState?.effects.some(candidate => (
    candidate.tags.includes(tag) && candidate.affected.placementIds.includes(actorId)
  ))
  if (!existing) return markerExecution(input, {
    canonicalId, affectedIds: [actorId], tag,
    capabilityId: canonicalId === 'Starlight' ? 'aa092.starlight.luminous' : 'aa093.sunglow.radiant',
    duration: { kind: 'scene', remaining: null },
  })
  const paid = paidState({ ...input, canonicalId, skipFrequency: true })
  const stages = { ...input.context.actor.token.combatStages }
  if (canonicalId === 'Starlight') stages.sdef = clampCombatStage(stages.sdef + 2)
  else stages.atk = clampCombatStage(stages.atk + 2)
  let sheet = applyCombatStagesToSheet(
    input.context.actor.sheet.kind, actorSheetWithPayment(input, paid), stages,
  )
  sheet.revision = nextRevision(input.context.actor.sheet.revision)
  const boost = effect({
    ...input, canonicalId, affectedIds: [actorId], kind: 'numeric-modifier',
    tags: [canonicalId === 'Starlight' ? 'aa092-starlight-evasion' : 'aa093-sunglow-accuracy'],
    payload: {
      attribute: canonicalId === 'Starlight' ? 'evasion' : 'accuracy',
      operation: 'add', value: 2, rounding: 'none',
    },
    duration: { kind: 'scene', remaining: null },
  })
  const current = parseEncounterState({
    ...paid.encounter,
    effects: [
      ...paid.encounter.effects.filter(candidate => !(
        candidate.tags.includes(tag) && candidate.affected.placementIds.includes(actorId)
      )),
      boost,
    ],
  })
  return {
    plan: createMoveStateChangePlan([
      encounterChange({ ...input, reasonCode: `ability.${canonicalId}.expended`, current }),
      sheetChange({
        ...input, resolved: input.context.actor.sheet, reasonCode: `ability.${canonicalId}.stages`,
        current: sheet, changedFields: [...(paid.sheet ? ['abilityUsage' as const] : []), 'combatStages'],
      }),
    ]),
    presentationKey: `ability.${canonicalId.toLowerCase()}.expended`,
  }
}

const strangeTempo = (input: ExecuteInput): Aa085To100ActivatedExecution => {
  if (!normalizeConditionNames(input.context.actor.token.conditions).includes('Confused')) {
    fail('Strange Tempo requires Confusion for its Standard Action branch.')
  }
  const statValue = selected(input.choices, 'activate.stat')
  const stat = statValue?.kind === 'stat' ? statValue.statId : fail('Strange Tempo requires a Stat choice.')
  return actorSheetExecution({
    ...input, canonicalId: 'Strange Tempo',
    apply: original => {
      let sheet = applyConditionsToSheet(
        input.context.actor.sheet.kind, original,
        normalizeConditionNames(input.context.actor.token.sheetConditions).filter(value => value !== 'Confused'),
      )
      const stages = {
        ...input.context.actor.token.combatStages,
        [stat]: clampCombatStage(input.context.actor.token.combatStages[stat as CombatStageKey] + 2),
      }
      sheet = applyCombatStagesToSheet(input.context.actor.sheet.kind, sheet, stages)
      return { sheet, fields: ['conditions', 'combatStages'] }
    },
  })
}

const toxicBoost = (input: ExecuteInput): Aa085To100ActivatedExecution => {
  const conditions = normalizeConditionNames(input.context.actor.token.conditions)
  if (!conditions.includes('Poisoned') && !conditions.includes('Badly Poisoned')) {
    fail('Toxic Boost requires Poisoned or Badly Poisoned.')
  }
  return actorSheetExecution({
    ...input, canonicalId: 'Toxic Boost',
    apply: sheet => ({
      sheet: applyCombatStagesToSheet(input.context.actor.sheet.kind, sheet, {
        ...input.context.actor.token.combatStages,
        atk: clampCombatStage(input.context.actor.token.combatStages.atk + 3),
        satk: clampCombatStage(input.context.actor.token.combatStages.satk + 3),
      }),
      fields: ['combatStages'],
    }),
  })
}

const toxicNourishment = (input: ExecuteInput): Aa085To100ActivatedExecution => {
  const id = targetId(input)
  const placement = input.context.queries.placements.get(id) ?? fail('Toxic Nourishment target disappeared.')
  const target = input.context.queries.tokens.get(id) ?? fail('Toxic Nourishment target disappeared.')
  if (ptuGridDistanceBetweenFootprints(input.context.actor.token, target) > 1) {
    fail('Toxic Nourishment requires an adjacent target.')
  }
  const conditions = normalizeConditionNames(target.conditions)
  if (!conditions.some(condition => ['Poisoned', 'Badly Poisoned'].includes(condition))) {
    fail('Toxic Nourishment requires a Poisoned target.')
  }
  const resolved = input.context.queries.sheets.forPlacement(placement)
    ?? fail('Toxic Nourishment target sheet disappeared.')
  const paid = paidState({ ...input, canonicalId: 'Toxic Nourishment' })
  let targetSheet = applyConditionsToSheet(
    resolved.kind, deepCloneJson(resolved.sheet) as AnyLiveSheet,
    normalizeConditionNames(target.sheetConditions)
      .filter(condition => !['Poisoned', 'Badly Poisoned'].includes(condition)),
  )
  targetSheet.revision = nextRevision(resolved.revision)
  const actorMaximum = Math.max(1, input.context.actor.token.fullMaxHp ?? input.context.actor.token.maxHp)
  return {
    plan: createMoveStateChangePlan([
      encounterChange({ ...input, reasonCode: 'ability.toxic-nourishment.frequency', current: paid.encounter }),
      sheetChange({
        ...input,
        resolved: { kind: resolved.kind, slug: resolved.slug, revision: resolved.revision, sheet: resolved.sheet },
        reasonCode: 'ability.toxic-nourishment.cure', current: targetSheet,
        changedFields: ['conditions'],
      }),
      temporaryHpChange({ ...input, additions: {
        [input.context.actor.placement.id]: computeTickValue(actorMaximum) * 3,
      } }),
    ]),
    presentationKey: 'ability.toxic-nourishment.applied',
  }
}

const trace = (input: ExecuteInput): Aa085To100ActivatedExecution => {
  const id = targetId(input)
  const selectedAbility = selected(input.choices, 'activate.ability')
  const instanceId = selectedAbility?.kind === 'ability'
    ? selectedAbility.abilityInstanceId : fail('Trace requires an issued Ability choice.')
  const copied = input.context.queries.effectiveAbilities.activeForPlacement(id)
    .find(candidate => candidate.instanceId === instanceId)
    ?? fail('Trace selected Ability is no longer effective.')
  if (!abilityIsCopyable(copied.canonicalId)) fail(`${copied.canonicalId} cannot be copied.`)
  const paid = paidState({ ...input, canonicalId: 'Trace' })
  const snapshotId = `ability.trace.copy.${hash(input.context.actor.placement.id, input.operationId)}`
  const transformation = reduceAbilityTransformationCommand(
    paid.encounter.abilityTransformations ?? createEmptyAbilityTransformationState(),
    {
      operationId: `${input.operationId}:trace`, kind: 'create', snapshotId, expectedVersion: null,
      snapshot: {
        snapshotId, kind: 'copy', placementId: input.context.actor.placement.id,
        ownerPlacementId: input.context.actor.placement.id,
        sourceAbilityInstanceId: input.abilityInstanceId,
        canonicalId: 'Trace', sourceOperationId: input.operationId,
        duration: { kind: 'scene' },
        mechanics: {
          formId: null, abilityPolicy: 'add', abilities: [{
            instanceId: `copied:${snapshotId}:0`, canonicalId: copied.canonicalId,
            definitionHash: copied.definitionHash, sourcePlacementId: id,
            parameterStatus: copied.parameterStatus,
            parameterData: copied.parameterData,
          }],
          moves: [], typeIds: [], footprint: null, weightClass: null, capabilityTags: [],
        },
        copyBase: { sourcePlacementId: id, sourceRevision: 0, sourceReadSha256: hash(id, copied.instanceId) },
        presentation: {
          public: { presentationId: snapshotId, labelKey: 'ability.trace.copied', formId: null, assetId: null },
          private: null,
        },
      },
    },
  )
  const current = parseEncounterState({
    ...paid.encounter, abilityTransformations: transformation.state,
  })
  return {
    plan: createMoveStateChangePlan([encounterChange({
      ...input, reasonCode: 'ability.trace.copied', current,
    })]),
    presentationKey: 'ability.trace.copied',
    controllerPresentationValues: [copied.canonicalId],
  }
}

const zen = (
  input: ExecuteInput,
  canonicalId: 'Zen Mode' | 'Zen Snowed',
): Aa085To100ActivatedExecution => {
  const species = 'species' in input.context.actor.sheet.sheet
    ? input.context.actor.sheet.sheet.species.trim().toLowerCase() : ''
  if (!species.includes('darmanitan')) fail(`${canonicalId} may be used only by Darmanitan.`)
  if (canonicalId === 'Zen Snowed' && !species.includes('galar')) {
    fail('Zen Snowed requires Galarian Darmanitan.')
  }
  if (canonicalId === 'Zen Mode' && species.includes('galar')) {
    fail('Zen Mode requires non-Galarian Darmanitan.')
  }
  const paid = paidState({ ...input, canonicalId })
  const actorId = input.context.actor.placement.id
  const formId = canonicalId === 'Zen Mode' ? 'darmanitan-zen-mode' : 'galarian-darmanitan-zen-mode'
  const form = effect({
    ...input, canonicalId, affectedIds: [actorId], kind: 'creature-rule-overlay',
    tags: [canonicalId === 'Zen Mode' ? 'aa100-zen-mode' : 'aa100-zen-snowed'],
    payload: { domain: 'form', action: 'replace', value: formId, referencePlacementId: null },
    duration: { kind: 'scene', remaining: null },
  })
  return {
    plan: createMoveStateChangePlan([encounterChange({
      ...input, reasonCode: `ability.${canonicalId}.form`, current: withEffect(paid.encounter, form),
    })]),
    presentationKey: `ability.${canonicalId.toLowerCase().replaceAll(' ', '-')}.form`,
  }
}

interface ExecuteInput {
  readonly context: AuthoritativeAbilityContext
  readonly operation: AbilityMechanicOperation
  readonly operationId: string
  readonly abilityInstanceId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}

/** Execute all direct declarations from AA-085 through AA-100. */
export const executeAa085To100ActivatedMechanic = (
  input: ExecuteInput,
): Aa085To100ActivatedExecution | null => {
  if (!/^aa(?:08[5-9]|09[0-9]|100)\./.test(input.operation.mechanicId)) return null
  if (input.context.actor.token.currentHp <= 0) fail('The ability cannot be used while Fainted.')
  const canonicalId = input.context.runtime.canonicalId
  if (!DIRECT_RULES[canonicalId]) return null
  if (canonicalId === 'Psychic Surge') return field({ ...input, canonicalId, kind: 'terrain', fieldId: 'psychic', rounds: 1 })
  if (canonicalId === 'Sand Stream') return field({ ...input, canonicalId, kind: 'weather', fieldId: 'sandstorm', rounds: 1 })
  if (canonicalId === 'Snow Warning') return field({ ...input, canonicalId, kind: 'weather', fieldId: 'hail', rounds: 5 })
  if (canonicalId === 'Pumpkingrab') return pumpkingrab(input)
  if (canonicalId === 'Quick Cloak') return quickCloak(input)
  if (canonicalId === 'Quick Curl' || canonicalId === 'Shell Shield') return shield(input, canonicalId)
  if (canonicalId === 'Rain Dish') return rainDish(input)
  if (canonicalId === 'Rally') {
    const actorId = input.context.actor.placement.id
    const recipients = input.context.queries.tokens.all().filter(token => (
      (token.id === actorId || input.context.queries.relationships.relation(actorId, token.id) === 'ally')
      && ptuGridDistanceBetweenFootprints(input.context.actor.token, token) <= 10
      && !normalizeConditionNames(token.conditions).some(condition => (
        ['Sleep', 'Paralysis', 'Stuck', 'Fainted'].includes(condition)
      ))
    )).map(token => token.id)
    return markerExecution(input, {
      canonicalId, affectedIds: recipients, tag: 'aa086-rally-free-disengage',
      capabilityId: 'aa086.rally.free-disengage', duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 1 },
    })
  }
  if (canonicalId === 'Regal Challenge') return regalChallenge(input)
  if (canonicalId === 'Root Down') {
    if (!normalizeConditionNames(input.context.actor.token.conditions).some(condition => condition.includes('Ingrain'))) {
      fail('Root Down requires the Ingrain Coat.')
    }
    return markerExecution(input, {
      canonicalId, affectedIds: [input.context.actor.placement.id], tag: 'aa087-root-down-dr',
      capabilityId: 'aa087.root-down.damage-reduction-5',
      duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
    })
  }
  if (canonicalId === 'Schooling') return schooling(input)
  if (canonicalId === 'Screen Cleaner') return screenCleaner(input)
  if (canonicalId === 'Shackle') {
    const actorId = input.context.actor.placement.id
    const foes = input.context.queries.tokens.all().filter(token => (
      input.context.queries.relationships.relation(actorId, token.id) === 'enemy'
      && ptuGridDistanceBetweenFootprints(input.context.actor.token, token) <= 3
    )).map(token => token.id)
    return markerExecution(input, {
      canonicalId, affectedIds: foes, tag: 'aa088-shackle-half-movement',
      capabilityId: 'aa088.shackle.half-movement',
      duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 1 },
    })
  }
  if (canonicalId === 'Shadow Tag') {
    const id = targetId(input)
    const target = input.context.queries.tokens.get(id) ?? fail('Shadow Tag target disappeared.')
    return markerExecution(input, {
      canonicalId, affectedIds: [id], tag: 'aa089-shadow-tag',
      capabilityId: 'aa089.shadow-tag.pinned',
      duration: { kind: 'turns', subject: 'target', boundary: 'start', remaining: 5 },
      cells: [target.position],
    })
  }
  if (canonicalId === 'Shed Skin') return shedSkin(input)
  if (canonicalId === 'Snuggle') return snuggle(input)
  if (canonicalId === 'Splendorous Rider') {
    const move = selected(input.choices, 'activate.move')
    const moveId = move?.kind === 'move' ? move.canonicalMoveId : fail('Splendorous Rider requires one Mount Move.')
    return markerExecution(input, {
      canonicalId, affectedIds: [input.context.actor.placement.id],
      tag: `aa091-splendorous-rider:${moveId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      capabilityId: 'aa091.splendorous-rider.temporary-move',
      duration: { kind: 'turns', subject: 'source', boundary: 'end', remaining: 1 },
    })
  }
  if (canonicalId === 'Starlight' || canonicalId === 'Sunglow') return luminous(input, canonicalId)
  if (canonicalId === 'Starswirl') return markerExecution(input, {
    canonicalId, affectedIds: [input.context.actor.placement.id], tag: 'aa092-starswirl-rapid-spin',
    capabilityId: 'aa092.starswirl.rapid-spin-swift',
    duration: { kind: 'turns', subject: 'source', boundary: 'end', remaining: 1 },
  })
  if (canonicalId === 'Strange Tempo') return strangeTempo(input)
  if (canonicalId === 'Suction Cups') return markerExecution(input, {
    canonicalId, affectedIds: [input.context.actor.placement.id], tag: 'aa093-suction-cups-dr',
    capabilityId: 'aa093.suction-cups.damage-reduction-5',
    duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
  })
  if (canonicalId === 'Symbiosis') {
    const id = targetId(input)
    const itemChoice = selected(input.choices, 'activate.item')
    const itemId = itemChoice?.kind === 'item' ? itemChoice.itemId
      : fail('Symbiosis requires one issued Held Item choice.')
    const reference = input.context.queries.items.requirements()
      .flatMap(requirement => input.context.queries.items.referencesForRequirement(requirement.id))
      .find(candidate => candidate.itemId === itemId)
      ?? fail('Symbiosis selected item disappeared.')
    if (reference.kind !== 'pokemon-held'
      || reference.owner.slug !== input.context.actor.sheet.slug) {
      fail('Symbiosis must share one of the user’s Held Items.')
    }
    return markerExecution(input, {
      canonicalId, affectedIds: [id], tag: 'aa094-symbiosis-shared-item',
      extraTags: [`aa094-symbiosis-item:${reference.canonicalItemId}`],
      capabilityId: 'aa094.symbiosis.shared-held-item', duration: { kind: 'scene', remaining: null },
    })
  }
  if (canonicalId === 'Targeting System') {
    const id = targetId(input)
    const target = input.context.queries.tokens.get(id)
      ?? fail('Targeting System target disappeared.')
    if (ptuGridDistanceBetweenFootprints(input.context.actor.token, target) > 10) {
      fail('Targeting System requires a target within 10 metres.')
    }
    return markerExecution(input, {
      canonicalId,
      affectedIds: [input.context.actor.placement.id, id],
      tag: 'aa094-targeting-system-lock-on',
      capabilityId: 'aa094.targeting-system.lock-on',
      duration: { kind: 'turns', subject: 'source', boundary: 'end', remaining: 1 },
    })
  }
  if (canonicalId === 'Toxic Boost') return toxicBoost(input)
  if (canonicalId === 'Toxic Nourishment') return toxicNourishment(input)
  if (canonicalId === 'Trace') return trace(input)
  if (canonicalId === 'Unnerve') {
    const id = targetId(input)
    return markerExecution(input, {
      canonicalId, affectedIds: [id], tag: 'aa097-unnerve',
      capabilityId: 'aa097.unnerve.block-stages-and-digestion',
      duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
    })
  }
  if (canonicalId === 'Zen Mode' || canonicalId === 'Zen Snowed') return zen(input, canonicalId)
  return null
}
