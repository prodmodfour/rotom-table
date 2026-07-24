import { createHash } from 'node:crypto'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { AbilityFrequencyDeclaration } from '#shared/abilityAutomation/frequency'
import type { AbilityMechanicOperation } from '#shared/abilityAutomation/mechanics'
import type { AbilityDeclarationOptionValue } from '#shared/abilityAutomation/declarationIntent'
import { AA070_FLUTTER_NO_FLANK_CAPABILITY } from '#shared/abilityAutomation/aa070'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import { parseEncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { CombatStageKey, CombatStageMap } from '~/types/combatStages'
import type { AnyLiveSheet } from '~/utils/sheetMutations'
import { applyCombatStagesToSheet } from '~/utils/sheetMutations'
import { clampCombatStage, normalizeCombatStages } from '~/utils/combatStages'
import { normalizeConditionNames } from '~/utils/statusConditions'
import { deepCloneJson } from '~/utils/serialization'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import {
  createMoveStateChangePlan,
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  type MoveStateChangeInput,
  type MoveStateChangePlan,
} from '../../moveAutomation/plan'
import { planEncounterMoveResourceCosts } from '../../moveAutomation/planMoveResources'
import { createMoveAutomationWeatherResolver } from '../../moveAutomation/weather'
import type { AuthoritativeAbilityContext } from '../context'
import { planAbilityFrequencyPayment } from '../usage'

const SCENE_FREQUENCY = Object.freeze({
  raw: 'Scene', actionText: '', kind: 'scene', uses: 1, exceptionId: null,
} satisfies AbilityFrequencyDeclaration)

export class Aa070ActivatedExecutionError extends Error {
  constructor(detail: string) { super(detail); this.name = 'Aa070ActivatedExecutionError' }
}
const fail = (detail: string): never => { throw new Aa070ActivatedExecutionError(detail) }
const hash = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 24)

const selectedValues = (
  choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[],
  declarationId: string,
): readonly AbilityDeclarationOptionValue[] => choices.find(choice => choice.declarationId === declarationId)
  ?.options.map(option => option.value) ?? []

const payAction = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly canonicalId: string
  readonly resource: 'swift' | 'shift'
  readonly frequency: AbilityFrequencyDeclaration | null
}) => {
  const action = planEncounterMoveResourceCosts({
    map: input.context.map,
    placementId: input.context.actor.placement.id,
    canonicalMoveId: `ability:${input.canonicalId}`,
    moveKey: `ability:${input.canonicalId.toLowerCase().replaceAll(' ', '-')}`,
    range: `${input.resource} action`,
    resolutionId: input.context.resolutionId,
    sourceOperationId: `${input.operationId}:action`,
    movement: null,
    reviewedCosts: [{
      id: `ability.action.${input.resource}`, phase: 'pay',
      cost: { kind: 'action-resource', resource: input.resource, amount: 1 },
    }],
    allowLegacyFallback: false,
    minimumPhaseExclusive: null,
    maximumPhaseInclusive: 'pay',
  })
  if (!input.frequency) return parseEncounterState(action.currentEncounterState)
  const context: AuthoritativeAbilityContext = {
    ...input.context,
    map: { ...input.context.map, encounterState: action.currentEncounterState },
  }
  const frequency = planAbilityFrequencyPayment({
    context,
    frequency: input.frequency,
    abilityInstanceId: context.runtime.canonicalId === input.canonicalId
      ? context.actor.effectiveAbilities.find(ability => ability.effective
        && ability.canonicalId === input.canonicalId)?.instanceId
        ?? fail(`${input.canonicalId} effective instance disappeared.`)
      : fail(`${input.canonicalId} runtime identity changed.`),
    clauseId: 'base',
    operationId: `${input.operationId}:frequency`,
    sceneId: context.map.encounterState?.history.sceneId ?? undefined,
  })
  const change = frequency.plan.changes.find(candidate => candidate.kind === 'encounter-state')
  return parseEncounterState(change?.kind === 'encounter-state'
    ? change.current
    : action.currentEncounterState)
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

const stageMap = (
  current: CombatStageMap,
  selected: readonly CombatStageKey[],
  delta: number,
): CombatStageMap => Object.freeze({
  ...current,
  ...Object.fromEntries(selected.map(stage => [stage, clampCombatStage(current[stage] + delta)])),
}) as CombatStageMap

const stageSheetChange = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly placementId: string
  readonly operationId: string
  readonly reasonCode: string
  readonly selected: readonly CombatStageKey[]
  readonly delta: number
}): MoveStateChangeInput => {
  const placement = input.context.placements.find(candidate => candidate.id === input.placementId)
    ?? fail(`Stage recipient ${input.placementId} disappeared.`)
  const resolved = input.context.queries.sheets.forPlacement(placement)
    ?? fail(`Stage recipient sheet ${placement.sheetKind}/${placement.sheetSlug} disappeared.`)
  const token = input.context.tokens.find(candidate => candidate.id === placement.id)
    ?? fail(`Stage recipient token ${placement.id} disappeared.`)
  const previous = deepCloneJson(resolved.sheet) as AnyLiveSheet
  const stages = stageMap(normalizeCombatStages(token.combatStages), input.selected, input.delta)
  const current = applyCombatStagesToSheet(resolved.kind, previous, stages) as AnyLiveSheet
  current.revision = nextRevision(resolved.revision)
  return {
    kind: 'sheet-state',
    scope: { kind: 'sheet', sheetKind: resolved.kind, sheetSlug: resolved.slug },
    expectedRevision: resolved.revision,
    sourceOperationId: `${input.operationId}:${placement.id}`,
    reasonCode: input.reasonCode,
    previous,
    current,
    changedFields: ['combatStages'],
    compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  }
}

const flareBoost = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
}): Aa070ActivatedExecution => {
  if (!normalizeConditionNames(input.context.actor.token.conditions).includes('Burned')) {
    return fail('Flare Boost requires the user to be Burned.')
  }
  const encounter = payAction({
    ...input, canonicalId: 'Flare Boost', resource: 'swift', frequency: SCENE_FREQUENCY,
  })
  return Object.freeze({
    plan: createMoveStateChangePlan([
      encounterChange({
        ...input, reasonCode: 'ability.aa070.flare-boost.resources', current: encounter,
      }),
      stageSheetChange({
        ...input, placementId: input.context.actor.placement.id,
        reasonCode: 'ability.aa070.flare-boost.stages', selected: ['atk', 'satk'], delta: 3,
      }),
    ]),
    presentationKey: 'ability.aa070.flare-boost.applied',
  })
}

const sunny = (context: AuthoritativeAbilityContext): boolean => (
  createMoveAutomationWeatherResolver(context.map, {
    subjectPlacementId: context.actor.placement.id,
  }).active().some(weather => weather.kind === 'sunny')
)

const STAT_KEYS: Readonly<Record<string, CombatStageKey>> = Object.freeze({
  attack: 'atk', defense: 'def', 'special-attack': 'satk',
  'special-defense': 'sdef', speed: 'spd',
})

const flowerGift = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa070ActivatedExecution => {
  const maximumHp = Math.max(1, input.context.actor.token.fullMaxHp ?? input.context.actor.token.maxHp)
  if (!sunny(input.context) && input.context.actor.token.currentHp * 2 >= maximumHp) {
    return fail('Flower Gift requires Sunny Weather or HP below 50%.')
  }
  const selected = selectedValues(input.choices, 'activate.stats').map((value) => (
    value.kind === 'stat' ? STAT_KEYS[value.statId] ?? fail('Flower Gift received an unsupported Stat.')
      : fail('Flower Gift requires two issued Stat choices.')
  ))
  if (selected.length !== 2 || new Set(selected).size !== 2) {
    return fail('Flower Gift requires exactly two distinct Stats.')
  }
  const encounter = payAction({
    ...input, canonicalId: 'Flower Gift', resource: 'swift', frequency: SCENE_FREQUENCY,
  })
  const actorId = input.context.actor.placement.id
  const recipients = input.context.placements.filter((placement) => {
    const token = input.context.tokens.find(candidate => candidate.id === placement.id)
    return token && (placement.id === actorId
      || ptuGridDistanceBetweenFootprints(input.context.actor.token, token) <= 2)
  })
  return Object.freeze({
    plan: createMoveStateChangePlan([
      encounterChange({ ...input, reasonCode: 'ability.aa070.flower-gift.resources', current: encounter }),
      ...recipients.map(placement => stageSheetChange({
        ...input,
        placementId: placement.id,
        reasonCode: 'ability.aa070.flower-gift.stages',
        selected,
        delta: placement.id === actorId ? 2 : 1,
      })),
    ]),
    presentationKey: 'ability.aa070.flower-gift.applied',
  })
}

const flutter = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
}): Aa070ActivatedExecution => {
  const encounter = payAction({
    ...input, canonicalId: 'Flutter', resource: 'shift', frequency: null,
  })
  const instanceId = input.context.actor.effectiveAbilities.find(candidate => (
    candidate.effective && candidate.canonicalId === 'Flutter'
  ))?.instanceId ?? fail('Flutter effective instance disappeared.')
  const effectSuffix = hash(`${input.context.actor.placement.id}:${instanceId}`)
  const evasionEffectId = `ability.flutter.evasion.${effectSuffix}`
  const noFlankEffectId = `ability.flutter.no-flank.${effectSuffix}`
  const common = {
    source: {
      operationId: input.operationId, moveId: 'ability.flutter',
      placementId: input.context.actor.placement.id,
    },
    affected: {
      placementIds: [input.context.actor.placement.id], sideIds: [],
      cells: [{ ...input.context.actor.placement.position }],
    },
    createdRound: Math.max(1, input.context.map.initiative?.round ?? 1),
    createdTurn: input.context.map.encounterState?.history.currentTurn?.turn ?? 0,
    duration: { kind: 'turns' as const, subject: 'target' as const, boundary: 'end' as const, remaining: 2 },
    stacks: 1, charges: null,
    stackPolicy: { kind: 'replace' as const, maxStacks: null },
    chargePolicy: { kind: 'none' as const, amount: null },
    dispel: { policy: 'matching-tags' as const, tags: ['flutter'] },
    transferPolicy: 'expire' as const, suppression: { sources: [] },
  }
  const evasion = parseEncounterEffect({
    ...common,
    id: evasionEffectId,
    kind: 'numeric-modifier', tags: ['ability', 'aa070', 'flutter', 'evasion'],
    payload: { attribute: 'evasion', operation: 'add', value: 3, rounding: 'none' },
  }, 'ability.flutter.evasion')
  const noFlank = parseEncounterEffect({
    ...common,
    id: noFlankEffectId,
    kind: 'capability', tags: ['ability', 'aa070', 'flutter', 'cannot-be-flanked'],
    payload: { capabilityId: AA070_FLUTTER_NO_FLANK_CAPABILITY, action: 'grant' },
  }, 'ability.flutter.noFlank')
  const current = parseEncounterState({
    ...encounter,
    effects: [
      ...encounter.effects.filter(effect => effect.id !== evasionEffectId && effect.id !== noFlankEffectId),
      evasion,
      noFlank,
    ],
  })
  return Object.freeze({
    plan: createMoveStateChangePlan([encounterChange({
      ...input, reasonCode: 'ability.aa070.flutter.applied', current,
    })]),
    presentationKey: 'ability.aa070.flutter.applied',
  })
}

export interface Aa070ActivatedExecution {
  readonly plan: MoveStateChangePlan
  readonly presentationKey: string
}

export const executeAa070ActivatedMechanic = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operation: AbilityMechanicOperation
  readonly operationId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa070ActivatedExecution | null => {
  if (input.operation.mechanicId === 'aa070.flare-boost') return flareBoost(input)
  if (input.operation.mechanicId === 'aa070.flower-gift') return flowerGift(input)
  if (input.operation.mechanicId === 'aa070.flutter') return flutter(input)
  return null
}
