import { createHash } from 'node:crypto'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { PokemonTypeId } from '#shared/pokemonTypes'
import type { AbilityFrequencyDeclaration } from '#shared/abilityAutomation/frequency'
import type { AbilityDeclarationOptionValue } from '#shared/abilityAutomation/declarationIntent'
import type { AbilityMechanicOperation } from '#shared/abilityAutomation/mechanics'
import {
  AA071_FOREST_LORD_ORIGIN_CAPABILITY,
  AA071_FOX_FIRE_WISP_CAPABILITY,
  AA071_WEATHER_TYPE_BY_KIND,
  aa071ForecastCapabilityId,
  aa071ForewarnMoveCapabilityId,
  isAa071FullyGrownTreeCell,
} from '#shared/abilityAutomation/aa071'
import { reviewedAbilityConnectionMoveNames } from '#shared/abilityAutomation/connections'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import { parseEncounterEffect, type EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { GridAnchor } from '~/types/map'
import type { AnyLiveSheet } from '~/utils/sheetMutations'
import { applyCombatStagesToSheet } from '~/utils/sheetMutations'
import { clampCombatStage, normalizeCombatStages } from '~/utils/combatStages'
import { deepCloneJson } from '~/utils/serialization'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import { findMove } from '~~/data/ptuReference'
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
const SCENE_X2_FREQUENCY = Object.freeze({
  raw: 'Scene x2', actionText: '', kind: 'scene', uses: 2, exceptionId: null,
} satisfies AbilityFrequencyDeclaration)

export class Aa071ActivatedExecutionError extends Error {
  constructor(detail: string) { super(detail); this.name = 'Aa071ActivatedExecutionError' }
}
const fail = (detail: string): never => { throw new Aa071ActivatedExecutionError(detail) }
const shortHash = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)

const selectedValues = (
  choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[],
  declarationId: string,
): readonly AbilityDeclarationOptionValue[] => choices.find(choice => choice.declarationId === declarationId)
  ?.options.map(option => option.value) ?? []

const effectiveInstanceId = (
  context: AuthoritativeAbilityContext,
  canonicalId: string,
): string => context.actor.effectiveAbilities.find(ability => (
  ability.effective && ability.canonicalId === canonicalId
))?.instanceId ?? fail(`${canonicalId} effective instance disappeared.`)

const payAction = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly canonicalId: string
  readonly resource: 'standard' | 'swift' | 'shift' | 'free'
  readonly frequency: AbilityFrequencyDeclaration
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
  const context: AuthoritativeAbilityContext = {
    ...input.context,
    map: { ...input.context.map, encounterState: action.currentEncounterState },
  }
  const frequency = planAbilityFrequencyPayment({
    context,
    frequency: input.frequency,
    abilityInstanceId: effectiveInstanceId(context, input.canonicalId),
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

const capabilityEffect = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly id: string
  readonly moveId: string
  readonly affectedPlacementId: string
  readonly affectedCells?: readonly GridAnchor[]
  readonly duration: EncounterEffect['duration']
  readonly tags: readonly string[]
  readonly capabilityId: string
  readonly value?: number
}): EncounterEffect => parseEncounterEffect({
  id: input.id,
  kind: 'capability',
  source: {
    operationId: input.operationId,
    moveId: input.moveId,
    placementId: input.context.actor.placement.id,
  },
  affected: {
    placementIds: [input.affectedPlacementId], sideIds: [],
    cells: (input.affectedCells ?? []).map(cell => ({ ...cell })),
  },
  createdRound: Math.max(1, input.context.map.initiative?.round ?? 1),
  createdTurn: input.context.map.encounterState?.history.currentTurn?.turn ?? 0,
  duration: input.duration,
  stacks: 1,
  charges: null,
  stackPolicy: { kind: 'replace', maxStacks: null },
  chargePolicy: { kind: 'none', amount: null },
  tags: [...input.tags],
  payload: {
    capabilityId: input.capabilityId,
    action: 'grant',
    ...(input.value === undefined ? {} : { value: input.value }),
  },
  dispel: { policy: 'matching-tags', tags: [...input.tags] },
  transferPolicy: 'expire',
  suppression: { sources: [] },
}, input.id)

const forecast = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa071ActivatedExecution => {
  const selected = selectedValues(input.choices, 'choose-weather.type')[0]
  const typeId = selected?.kind === 'type'
    ? selected.typeId
    : fail('Forecast requires one issued weather Type choice.')
  const activeTypes = [...new Set(createMoveAutomationWeatherResolver(input.context.map, {
    subjectPlacementId: input.context.actor.placement.id,
  }).active()
    .map(weather => AA071_WEATHER_TYPE_BY_KIND[weather.kind]))]
  const legalTypes: readonly PokemonTypeId[] = activeTypes.length === 0 ? ['normal'] : activeTypes
  if (!legalTypes.includes(typeId)) fail('Forecast choice no longer corresponds to active weather.')
  const previous = parseEncounterState(input.context.map.encounterState ?? createEmptyEncounterState())
  const instanceId = effectiveInstanceId(input.context, 'Forecast')
  const retained = previous.effects.filter(effect => !(
    effect.kind === 'capability'
    && effect.tags.includes('aa071')
    && effect.tags.includes('forecast')
    && effect.affected.placementIds.includes(input.context.actor.placement.id)
  ))
  const effect = capabilityEffect({
    ...input,
    id: `ability.forecast.type.${shortHash(input.context.actor.placement.id, instanceId, typeId)}`,
    moveId: 'ability.forecast',
    affectedPlacementId: input.context.actor.placement.id,
    duration: { kind: 'scene', remaining: null },
    tags: ['ability', 'aa071', 'forecast'],
    capabilityId: aa071ForecastCapabilityId(typeId),
  })
  return Object.freeze({
    plan: createMoveStateChangePlan([encounterChange({
      ...input,
      reasonCode: 'ability.aa071.forecast.type-selected',
      current: { ...previous, effects: [...retained, effect] },
    })]),
    presentationKey: 'ability.aa071.forecast.type-selected',
  })
}

const forestLord = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa071ActivatedExecution => {
  const selected = selectedValues(input.choices, 'activate.tree')[0]
  const cell = selected?.kind === 'cell' ? selected.cell : fail('Forest Lord requires one issued tree cell.')
  if (!isAa071FullyGrownTreeCell(input.context.map, cell)) {
    fail('Forest Lord selected cell is no longer a fully-grown tree.')
  }
  if (ptuGridDistanceBetweenFootprints(input.context.actor.token, {
    position: cell, base: 1, clearance: 1,
  }) > 10) fail('Forest Lord tree is farther than 10 meters from the user.')
  const paid = payAction({
    ...input, canonicalId: 'Forest Lord', resource: 'shift', frequency: SCENE_X2_FREQUENCY,
  })
  const instanceId = effectiveInstanceId(input.context, 'Forest Lord')
  const effectId = `ability.forest-lord.origin.${shortHash(input.context.actor.placement.id, instanceId)}`
  const retained = paid.effects.filter(effect => effect.id !== effectId)
  const effect = capabilityEffect({
    ...input,
    id: effectId,
    moveId: 'ability.forest-lord',
    affectedPlacementId: input.context.actor.placement.id,
    affectedCells: [cell],
    duration: { kind: 'turns', subject: 'source', boundary: 'end', remaining: 1 },
    tags: ['ability', 'aa071', 'forest-lord', 'virtual-origin'],
    capabilityId: AA071_FOREST_LORD_ORIGIN_CAPABILITY,
  })
  return Object.freeze({
    plan: createMoveStateChangePlan([encounterChange({
      ...input,
      reasonCode: 'ability.aa071.forest-lord.origin-prepared',
      current: { ...paid, effects: [...retained, effect] },
    })]),
    presentationKey: 'ability.aa071.forest-lord.origin-prepared',
  })
}

const forewarn = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa071ActivatedExecution => {
  const selected = selectedValues(input.choices, 'activate.target')[0]
  const targetId = selected?.kind === 'token' ? selected.placementId : fail('Forewarn requires one issued foe target.')
  if (input.context.queries.relationships.relation(input.context.actor.placement.id, targetId) !== 'enemy') {
    fail('Forewarn target is no longer a foe.')
  }
  const placement = input.context.queries.placements.get(targetId) ?? fail('Forewarn target disappeared.')
  const sheet = input.context.queries.sheets.forPlacement(placement) ?? fail('Forewarn target sheet disappeared.')
  const authoredMoves = (sheet.sheet.movelist ?? []).flatMap(move => (
    typeof move.name === 'string' && move.name.trim() ? [move.name.trim()] : []
  ))
  const connectedMoves = reviewedAbilityConnectionMoveNames(
    input.context.queries.effectiveAbilities.activeForPlacement(targetId).map(ability => ability.canonicalId),
    authoredMoves,
  )
  const known = [...new Set([...authoredMoves, ...connectedMoves])].flatMap((moveName) => {
    const move = findMove(moveName)
    return move && typeof move.damage_base === 'number' && move.damage_base > 0
      ? [{ canonicalId: move.name, damageBase: move.damage_base }]
      : []
  })
  const maximum = Math.max(0, ...known.map(move => move.damageBase))
  const revealed = known.filter(move => move.damageBase === maximum)
    .sort((left, right) => left.canonicalId.localeCompare(right.canonicalId))
  if (revealed.length === 0) fail('Forewarn target knows no Move with a Damage Dice Roll.')
  const paid = payAction({
    ...input, canonicalId: 'Forewarn', resource: 'free', frequency: SCENE_FREQUENCY,
  })
  const instanceId = effectiveInstanceId(input.context, 'Forewarn')
  const effects = revealed.map(({ canonicalId }) => {
    const capabilityId = aa071ForewarnMoveCapabilityId(canonicalId)
    return capabilityEffect({
      ...input,
      id: `ability.forewarn.penalty.${shortHash(instanceId, targetId, canonicalId)}`,
      moveId: 'ability.forewarn',
      affectedPlacementId: targetId,
      duration: { kind: 'scene', remaining: null },
      tags: ['ability', 'aa071', 'forewarn', 'accuracy-penalty'],
      capabilityId,
      value: 2,
    })
  })
  const effectIds = new Set(effects.map(effect => effect.id))
  return Object.freeze({
    plan: createMoveStateChangePlan([encounterChange({
      ...input,
      reasonCode: 'ability.aa071.forewarn.moves-revealed',
      current: {
        ...paid,
        effects: [...paid.effects.filter(effect => !effectIds.has(effect.id)), ...effects],
      },
    })]),
    presentationKey: 'ability.forewarn.moves-revealed',
    controllerPresentationValues: Object.freeze(revealed.map(move => move.canonicalId)),
  })
}

const foxFire = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
}): Aa071ActivatedExecution => {
  const paid = payAction({
    ...input, canonicalId: 'Fox Fire', resource: 'standard', frequency: SCENE_FREQUENCY,
  })
  const instanceId = effectiveInstanceId(input.context, 'Fox Fire')
  const prefix = `ability.fox-fire.wisp.${shortHash(input.context.actor.placement.id, instanceId)}`
  const retained = paid.effects.filter(effect => !effect.id.startsWith(`${prefix}.`))
  const wisps = Array.from({ length: 3 }, (_, index) => capabilityEffect({
    ...input,
    id: `${prefix}.${index + 1}`,
    moveId: 'ability.fox-fire',
    affectedPlacementId: input.context.actor.placement.id,
    duration: { kind: 'scene', remaining: null },
    tags: ['ability', 'aa071', 'fox-fire', 'fire-wisp'],
    capabilityId: AA071_FOX_FIRE_WISP_CAPABILITY,
    value: 1,
  }))
  return Object.freeze({
    plan: createMoveStateChangePlan([encounterChange({
      ...input,
      reasonCode: 'ability.aa071.fox-fire.wisps-created',
      current: { ...paid, effects: [...retained, ...wisps] },
    })]),
    presentationKey: 'ability.aa071.fox-fire.wisps-created',
  })
}

const stageLoweringBlocker = (
  context: AuthoritativeAbilityContext,
  targetId: string,
): string | null => {
  if (context.queries.relationships.relation(context.actor.placement.id, targetId) === 'enemy'
    && context.queries.effectiveAbilities.has(targetId, 'Full Metal Body')) return 'Full Metal Body'
  const recipient = context.queries.tokens.get(targetId)
  if (!recipient) return 'missing target'
  const providers = context.queries.placements.all().filter((placement) => {
    const token = context.queries.tokens.get(placement.id)
    return token
      && context.queries.effectiveAbilities.has(placement.id, 'Flower Veil')
      && ptuGridDistanceBetweenFootprints(token, recipient) <= 5
  })
  const protectedRecipient = providers.some(provider => provider.id === targetId)
    || recipient.defenderTypes.some(type => type.trim().toLowerCase() === 'grass')
  return protectedRecipient && providers.length > 0 ? 'Flower Veil' : null
}

const frighten = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa071ActivatedExecution => {
  const selected = selectedValues(input.choices, 'activate.target')[0]
  const targetId = selected?.kind === 'token' ? selected.placementId : fail('Frighten requires one issued target.')
  const placement = input.context.queries.placements.get(targetId) ?? fail('Frighten target disappeared.')
  const resolved = input.context.queries.sheets.forPlacement(placement) ?? fail('Frighten target sheet disappeared.')
  const target = input.context.queries.tokens.get(targetId) ?? fail('Frighten target token disappeared.')
  const paid = payAction({
    ...input, canonicalId: 'Frighten', resource: 'swift', frequency: SCENE_FREQUENCY,
  })
  const blocker = stageLoweringBlocker(input.context, targetId)
  const changes: MoveStateChangeInput[] = [encounterChange({
    ...input,
    reasonCode: blocker ? 'ability.aa071.frighten.prevented' : 'ability.aa071.frighten.resources',
    current: paid,
  })]
  if (!blocker) {
    const previous = deepCloneJson(resolved.sheet) as AnyLiveSheet
    const stages = normalizeCombatStages(target.combatStages)
    const current = applyCombatStagesToSheet(resolved.kind, previous, {
      ...stages,
      spd: clampCombatStage(stages.spd - 2),
    }) as AnyLiveSheet
    current.revision = nextRevision(resolved.revision)
    changes.push({
      kind: 'sheet-state',
      scope: { kind: 'sheet', sheetKind: resolved.kind, sheetSlug: resolved.slug },
      expectedRevision: resolved.revision,
      sourceOperationId: `${input.operationId}:${targetId}`,
      reasonCode: 'ability.aa071.frighten.speed-lowered',
      previous,
      current,
      changedFields: ['combatStages'],
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    })
  }
  return Object.freeze({
    plan: createMoveStateChangePlan(changes),
    presentationKey: blocker
      ? 'ability.aa071.frighten.prevented'
      : 'ability.aa071.frighten.applied',
  })
}

export interface Aa071ActivatedExecution {
  readonly plan: MoveStateChangePlan
  readonly presentationKey: string
  readonly controllerPresentationValues?: readonly string[]
}

export const executeAa071ActivatedMechanic = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operation: AbilityMechanicOperation
  readonly operationId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa071ActivatedExecution | null => {
  if (input.operation.mechanicId === 'aa071.forecast') return forecast(input)
  if (input.operation.mechanicId === 'aa071.forest-lord') return forestLord(input)
  if (input.operation.mechanicId === 'aa071.forewarn') return forewarn(input)
  if (input.operation.mechanicId === 'aa071.fox-fire') return foxFire(input)
  if (input.operation.mechanicId === 'aa071.frighten') return frighten(input)
  return null
}
