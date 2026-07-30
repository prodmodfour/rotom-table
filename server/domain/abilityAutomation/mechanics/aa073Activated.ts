import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { AbilityFrequencyDeclaration } from '#shared/abilityAutomation/frequency'
import { AA073_HAY_FEVER_IMMUNE_TYPES } from '#shared/abilityAutomation/aa073'
import type { AbilityDeclarationOptionValue, AbilityDeclarationDirection } from '#shared/abilityAutomation/declarationIntent'
import type { AbilityMechanicOperation } from '#shared/abilityAutomation/mechanics'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { MapFieldEffects } from '~/types/map'
import type { AnyLiveSheet } from '~/utils/sheetMutations'
import { applyConditionsToSheet } from '~/utils/sheetMutations'
import { computeTickValue, normalizeInjuryCount } from '~/utils/ptuHp'
import { computePtuInjuryAutomation } from '~/utils/ptuInjuries'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import { normalizeConditionNames } from '~/utils/statusConditions'
import { getVoxelMaterialDefinition } from '~/utils/mapMaterials'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import {
  buildMoveAutomationAreaTemplateCells,
  tokensInMoveAutomationArea,
} from '~/utils/moveAutomationAreaTemplates'
import type { MoveAutomationAreaDirection } from '~/types/moveAutomation'
import { applyAbilityHpToSheet } from '../capabilityHpInvariants'
import { findMove } from '~~/data/ptuReference'
import {
  createMoveStateChangePlan,
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  type MoveSheetStateField,
  type MoveStateChangeInput,
  type MoveStateChangePlan,
} from '../../moveAutomation/plan'
import { planEncounterMoveResourceCosts } from '../../moveAutomation/planMoveResources'
import { applyMapGlobalField } from '../../moveAutomation/fieldMapState'
import { createMoveAutomationWeatherResolver } from '../../moveAutomation/weather'
import type { AuthoritativeAbilityContext } from '../context'
import { authoritativeAbilityHealingBlocked } from '../healingPrevention'
import { planAbilityFrequencyPayment } from '../usage'

const SCENE_FREQUENCY = Object.freeze({
  raw: 'Scene', actionText: '', kind: 'scene', uses: 1, exceptionId: null,
} satisfies AbilityFrequencyDeclaration)
const SCENE_X3_FREQUENCY = Object.freeze({
  raw: 'Scene x3', actionText: '', kind: 'scene', uses: 3, exceptionId: null,
} satisfies AbilityFrequencyDeclaration)
const DAILY_FREQUENCY = Object.freeze({
  raw: 'Daily', actionText: '', kind: 'daily', uses: 1, exceptionId: null,
} satisfies AbilityFrequencyDeclaration)

export class Aa073ActivatedExecutionError extends Error {
  constructor(detail: string) { super(detail); this.name = 'Aa073ActivatedExecutionError' }
}
const fail = (detail: string): never => { throw new Aa073ActivatedExecutionError(detail) }

const selectedValues = (
  choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[],
  declarationId: string,
): readonly AbilityDeclarationOptionValue[] => choices.find(choice => choice.declarationId === declarationId)
  ?.options.map(option => option.value) ?? []

const effectiveInstanceId = (context: AuthoritativeAbilityContext, canonicalId: string): string => (
  context.actor.effectiveAbilities.find(ability => ability.effective && ability.canonicalId === canonicalId)?.instanceId
  ?? fail(`${canonicalId} effective instance disappeared.`)
)

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

const payAction = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly canonicalId: string
  readonly resource: 'swift' | 'free'
}) => planEncounterMoveResourceCosts({
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

const paySceneAction = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly canonicalId: string
  readonly resource: 'swift' | 'free'
  readonly frequency: AbilityFrequencyDeclaration
}) => {
  const action = payAction(input)
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

const fieldExecution = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
}): Aa073ActivatedExecution => {
  const paid = paySceneAction({
    ...input, canonicalId: 'Grassy Surge', resource: 'swift', frequency: SCENE_X3_FREQUENCY,
  })
  const reduced = applyMapGlobalField({
    map: { ...input.context.map, encounterState: paid },
    kind: 'terrain',
    fieldId: 'grassy',
    source: {
      kind: 'operation', operationId: input.operationId,
      moveId: 'ability.grassy-surge', placementId: input.context.actor.placement.id,
    },
    sideId: input.context.actor.placement.sideId ?? null,
    duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
    replacementGroup: 'field.terrain.grassy', replacementScope: 'kind', sourceLabel: 'Grassy Surge',
  })
  const changes: MoveStateChangeInput[] = [encounterChange({
    ...input, reasonCode: 'ability.aa073.grassy-surge.field-applied',
    current: reduced.map.encounterState,
  })]
  const previousFields: MapFieldEffects = input.context.map.fieldEffects
    ?? { weather: [], terrains: [], rooms: [] }
  const currentFields: MapFieldEffects = reduced.map.fieldEffects
    ?? { weather: [], terrains: [], rooms: [] }
  if (!sameJsonValue(previousFields, currentFields)) changes.push({
    kind: 'map-field-effects',
    scope: { kind: 'map', mapSlug: input.context.map.slug },
    expectedRevision: normalizeRevision(input.context.map.revision),
    sourceOperationId: `${input.operationId}:field-projection`,
    reasonCode: 'ability.aa073.grassy-surge.field-projection',
    previous: deepCloneJson(previousFields), current: deepCloneJson(currentFields),
    compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  })
  return Object.freeze({
    plan: createMoveStateChangePlan(changes),
    presentationKey: 'ability.aa073.grassy-surge.applied',
  })
}

const deepWaterTags = (context: AuthoritativeAbilityContext, x: number, z: number): boolean => (
  context.map.voxels.some((voxel) => {
    if (voxel.x !== x || voxel.z !== z
      || voxel.y < context.actor.token.position.y - 1
      || voxel.y >= context.actor.token.position.y + context.actor.token.clearance) return false
    const material = getVoxelMaterialDefinition(voxel)
    const tags = new Set([...(material.tags ?? []), ...(voxel.tags ?? [])]
      .map(tag => tag.trim().toLowerCase()))
    return tags.has('water') && (tags.has('deep') || voxel.materialId === 'deep_water')
  })
)

export const aa073ActorFullySubmerged = (context: AuthoritativeAbilityContext): boolean => {
  for (let x = context.actor.token.position.x; x < context.actor.token.position.x + context.actor.token.base; x += 1) {
    for (let z = context.actor.token.position.z; z < context.actor.token.position.z + context.actor.token.base; z += 1) {
      if (!deepWaterTags(context, x, z)) return false
    }
  }
  return true
}

const gulpExecution = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
}): Aa073ActivatedExecution => {
  if (!aa073ActorFullySubmerged(input.context)) {
    fail('Gulp requires the user to be fully submerged in deep water for the reviewed Extended Action.')
  }
  const frequency = planAbilityFrequencyPayment({
    context: input.context,
    frequency: DAILY_FREQUENCY,
    abilityInstanceId: effectiveInstanceId(input.context, 'Gulp'),
    clauseId: 'base',
    operationId: `${input.operationId}:frequency`,
    dayKey: input.context.actor.sheet.sheet.abilityUsage?.dayKey ?? 'campaign-day:initial',
  })
  const payment = frequency.plan.changes.find(change => change.kind === 'sheet-state')
    ?? fail('Gulp did not produce its Daily payment.')
  const previous = deepCloneJson(input.context.actor.sheet.sheet) as AnyLiveSheet
  const paidSheet = deepCloneJson(payment.current) as AnyLiveSheet
  const token = input.context.actor.token
  const maximumHp = token.fullMaxHp ?? token.maxHp
  const healing = Math.floor(maximumHp / 4)
  const currentHp = authoritativeAbilityHealingBlocked({
    map: input.context.map, placementId: input.context.actor.placement.id,
  }) ? token.currentHp : Math.min(maximumHp, token.currentHp + healing)
  const injuries = Math.max(0, normalizeInjuryCount(token.injuries) - 1)
  const current = applyAbilityHpToSheet({
    context: input.context,
    placementId: input.context.actor.placement.id,
    sheet: paidSheet,
    currentHp,
    injuries,
  })
  current.revision = nextRevision(input.context.actor.sheet.revision)
  const hpChanged = currentHp !== token.currentHp || injuries !== normalizeInjuryCount(token.injuries)
  return Object.freeze({
    plan: createMoveStateChangePlan([{
      kind: 'sheet-state',
      scope: {
        kind: 'sheet', sheetKind: input.context.actor.sheet.kind,
        sheetSlug: input.context.actor.sheet.slug,
      },
      expectedRevision: input.context.actor.sheet.revision,
      sourceOperationId: input.operationId,
      reasonCode: 'ability.aa073.gulp.heal-and-remove-injury',
      previous, current,
      changedFields: hpChanged ? ['abilityUsage', 'hp'] : ['abilityUsage'],
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    }]),
    presentationKey: hpChanged ? 'ability.aa073.gulp.healed' : 'ability.aa073.gulp.no-op',
  })
}

const sheetChange = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly placementId: string
  readonly previous: AnyLiveSheet
  readonly current: AnyLiveSheet
  readonly changedFields: readonly MoveSheetStateField[]
  readonly reasonCode: string
}): MoveStateChangeInput => {
  const placement = input.context.queries.placements.get(input.placementId)
    ?? fail(`Ability target ${input.placementId} disappeared.`)
  const resolved = input.context.queries.sheets.forPlacement(placement)
    ?? fail(`Ability target ${input.placementId} lost its sheet.`)
  input.current.revision = nextRevision(resolved.revision)
  return {
    kind: 'sheet-state',
    scope: { kind: 'sheet', sheetKind: resolved.kind, sheetSlug: resolved.slug },
    expectedRevision: resolved.revision,
    sourceOperationId: input.operationId,
    reasonCode: input.reasonCode,
    previous: input.previous,
    current: input.current,
    changedFields: [...input.changedFields],
    compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  }
}

const healerExecution = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa073ActivatedExecution => {
  const selected = selectedValues(input.choices, 'activate.target')[0]
  const targetId = selected?.kind === 'token'
    ? selected.placementId
    : fail('Healer requires one issued adjacent target.')
  const targetPlacement = input.context.queries.placements.get(targetId) ?? fail('Healer target disappeared.')
  const target = input.context.queries.tokens.get(targetId) ?? fail('Healer target token disappeared.')
  const resolved = input.context.queries.sheets.forPlacement(targetPlacement) ?? fail('Healer target sheet disappeared.')
  const distance = ptuGridDistanceBetweenFootprints(input.context.actor.token, target)
  if (distance > 1 || targetId === input.context.actor.placement.id
    || input.context.queries.relationships.relation(
      input.context.actor.placement.id,
      targetId,
    ) !== 'ally') fail('Healer target is no longer an adjacent ally.')
  const paid = paySceneAction({
    ...input, canonicalId: 'Healer', resource: 'free', frequency: SCENE_FREQUENCY,
  })
  const previous = deepCloneJson(resolved.sheet) as AnyLiveSheet
  const current = applyConditionsToSheet(resolved.kind, previous, [])
  const effects = paid.effects.flatMap((effect): EncounterEffect[] => {
    if (effect.kind !== 'condition' || effect.payload.action !== 'apply'
      || !effect.affected.placementIds.includes(targetId)) return [effect]
    const placementIds = effect.affected.placementIds.filter(id => id !== targetId)
    return placementIds.length === 0 && effect.affected.sideIds.length === 0 && effect.affected.cells.length === 0
      ? []
      : [{ ...effect, affected: { ...effect.affected, placementIds } }]
  })
  const changes: MoveStateChangeInput[] = [encounterChange({
    ...input, reasonCode: 'ability.aa073.healer.resources-and-effects', current: { ...paid, effects },
  })]
  if (!sameJsonValue(previous, current)) changes.push(sheetChange({
    ...input, placementId: targetId, previous, current, changedFields: ['conditions'],
    reasonCode: 'ability.aa073.healer.cure-all-status',
  }))
  return Object.freeze({
    plan: createMoveStateChangePlan(changes),
    presentationKey: 'ability.aa073.healer.applied',
  })
}

const DIRECTION_BY_ID: Readonly<Record<AbilityDeclarationDirection, MoveAutomationAreaDirection>> = Object.freeze({
  north: 'north', northeast: 'north-east', east: 'east', southeast: 'south-east',
  south: 'south', southwest: 'south-west', west: 'west', northwest: 'north-west',
  up: 'up', down: 'down',
})

const hayFeverExecution = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa073ActivatedExecution => {
  const actorId = input.context.actor.placement.id
  const history = input.context.map.encounterState?.history
  const lastMove = history?.lastCompletedMoves.find(entry => entry.actorPlacementId === actorId)
  const statusMoveTrigger = Boolean(
    history?.actedThisTurnPlacementIds.includes(actorId)
    && lastMove
    && findMove(lastMove.canonicalId)?.damage_class === 'Status',
  )
  const asleepTrigger = history?.currentTurn?.placementId === actorId
    && normalizeConditionNames(input.context.actor.token.conditions).includes('Sleep')
  if (!statusMoveTrigger && !asleepTrigger) {
    fail('Hay Fever requires a Status Move use this turn or an Asleep user ending its turn.')
  }
  const forbiddenWeather = new Set(['rainy', 'sandstorm', 'hail'])
  if (createMoveAutomationWeatherResolver(input.context.map).active()
    .some(weather => forbiddenWeather.has(weather.kind))) {
    fail('Hay Fever cannot be activated in Rain, Sandstorm, or Hail.')
  }
  const mode = input.context.request.modeId
  const directionValue = selectedValues(input.choices, 'close-blast.direction')[0]
  const direction = directionValue?.kind === 'direction'
    ? DIRECTION_BY_ID[directionValue.directionId]
    : null
  if (mode === 'close-blast' && !direction) fail('Hay Fever Close Blast requires one issued direction.')
  const cells = buildMoveAutomationAreaTemplateCells({
    template: mode === 'burst'
      ? { kind: 'burst', size: 2, label: 'Burst 2' }
      : { kind: 'close-blast', size: 3, label: 'Close Blast 3' },
    user: input.context.actor.token,
    ...(direction ? { direction } : {}),
    bounds: input.context.map.dimensions,
  })
  const targets = tokensInMoveAutomationArea({
    cells, tokens: input.context.tokens, excludeIds: [],
  }).filter(token => !token.defenderTypes.some(type => (
    (AA073_HAY_FEVER_IMMUNE_TYPES as readonly string[]).includes(type.trim().toLowerCase())
  )))
  const paid = payAction({ ...input, canonicalId: 'Hay Fever', resource: 'swift' })
  const changes: MoveStateChangeInput[] = [encounterChange({
    ...input, reasonCode: `ability.aa073.hay-fever.${mode}.action`, current: paid.currentEncounterState,
  })]
  const changedSheets = new Set<string>()
  for (const token of targets) {
    const placement = input.context.queries.placements.get(token.id)
    const resolved = placement ? input.context.queries.sheets.forPlacement(placement) : null
    if (!placement || !resolved) continue
    const key = `${resolved.kind}:${resolved.slug}`
    if (changedSheets.has(key)) fail('Hay Fever cannot mutate one backing sheet through multiple placements.')
    changedSheets.add(key)
    const previous = deepCloneJson(resolved.sheet) as AnyLiveSheet
    const tick = computeTickValue(token.fullMaxHp ?? token.maxHp)
    const currentHp = Math.max(0, token.currentHp - tick)
    if (currentHp === token.currentHp) continue
    const injury = computePtuInjuryAutomation({
      beforeHp: token.currentHp, afterHp: currentHp,
      fullMaxHp: token.fullMaxHp ?? token.maxHp,
      currentInjuries: normalizeInjuryCount(token.injuries), source: 'hp-loss',
    })
    const current = applyAbilityHpToSheet({
      context: input.context,
      placementId: token.id,
      sheet: previous,
      currentHp,
      injuries: injury.injuries,
    })
    changes.push(sheetChange({
      ...input, placementId: token.id, previous, current, changedFields: ['hp'],
      reasonCode: `ability.aa073.hay-fever.${mode}.tick-loss`,
    }))
  }
  return Object.freeze({
    plan: createMoveStateChangePlan(changes),
    presentationKey: `ability.aa073.hay-fever.${mode}.applied`,
  })
}

export interface Aa073ActivatedExecution {
  readonly plan: MoveStateChangePlan
  readonly presentationKey: string
}

export const executeAa073ActivatedMechanic = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operation: AbilityMechanicOperation
  readonly operationId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa073ActivatedExecution | null => {
  if (input.operation.mechanicId === 'aa073.grassy-surge') return fieldExecution(input)
  if (input.operation.mechanicId === 'aa073.gulp') return gulpExecution(input)
  if (input.operation.mechanicId === 'aa073.hay-fever') return hayFeverExecution(input)
  if (input.operation.mechanicId === 'aa073.healer') return healerExecution(input)
  return null
}
