import { createHash } from 'node:crypto'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { AbilityDeclarationOptionValue } from '#shared/abilityAutomation/declarationIntent'
import type { AbilityFrequencyDeclaration } from '#shared/abilityAutomation/frequency'
import type { AbilityMechanicOperation } from '#shared/abilityAutomation/mechanics'
import type { PokemonTypeId } from '#shared/pokemonTypes'
import {
  AA079_MIMICRY_FIELD_TAGS,
  AA079_MIMICRY_FIELD_TYPES,
  AA079_MIMICRY_WEATHER_TYPE,
  type Aa079MemoryWipeMode,
} from '#shared/abilityAutomation/aa079'
import { createEmptyAbilityOwnedState, parseAbilityOwnedState } from '#shared/abilityAutomation/ownedState'
import { createEmptyEncounterState, parseEncounterState, type EncounterState } from '#shared/moveAutomation/encounterState'
import { parseEncounterEffect, type EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { TabletopMap } from '~/types/map'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { AnyLiveSheet } from '~/utils/sheetMutations'
import { applyConditionsToSheet } from '~/utils/sheetMutations'
import { addAppliedCondition } from '~/utils/conditionApplication'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import { gridFootprintCells } from '~/utils/gridGeometry'
import { getMaterialDefinition } from '~/utils/mapMaterials'
import { moveAutomationConditionImmunitySource } from '~/utils/moveAutomationConditionImmunity'
import { normalizeConditionNames } from '~/utils/statusConditions'
import { planEncounterMoveResourceCosts } from '../../moveAutomation/planMoveResources'
import {
  createMoveStateChangePlan,
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  type MoveSheetStateField,
  type MoveStateChangeInput,
  type MoveStateChangePlan,
} from '../../moveAutomation/plan'
import { createMoveAutomationWeatherResolver } from '../../moveAutomation/weather'
import type { AuthoritativeAbilityContext } from '../context'
import { planAbilityMovement } from '../movement'
import { reduceAbilityOwnedStateCommand } from '../ownedState'
import { planAbilityFrequencyPayment } from '../usage'

const SCENE_FREQUENCY = Object.freeze({
  raw: 'Scene', actionText: '', kind: 'scene', uses: 1, exceptionId: null,
} satisfies AbilityFrequencyDeclaration)
const SCENE_X3_FREQUENCY = Object.freeze({
  raw: 'Scene x3', actionText: '', kind: 'scene', uses: 3, exceptionId: null,
} satisfies AbilityFrequencyDeclaration)

export class Aa079ActivatedExecutionError extends Error {
  constructor(detail: string) { super(detail); this.name = 'Aa079ActivatedExecutionError' }
}
const fail = (detail: string): never => { throw new Aa079ActivatedExecutionError(detail) }
const shortHash = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)

const selectedValue = (
  choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[],
  declarationId: string,
): AbilityDeclarationOptionValue | null => choices.find(choice => choice.declarationId === declarationId)
  ?.options[0]?.value ?? null

const selectedToken = (
  choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[],
  declarationId: string,
): string => {
  const value = selectedValue(choices, declarationId)
  return value?.kind === 'token' ? value.placementId : fail(`${declarationId} requires one issued target.`)
}

const selectedBranch = (
  choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[],
  declarationId: string,
): string => {
  const value = selectedValue(choices, declarationId)
  return value?.kind === 'branch' ? value.branchId : fail(`${declarationId} requires one issued branch.`)
}

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

const contextWithMap = (
  context: AuthoritativeAbilityContext,
  map: TabletopMap,
): AuthoritativeAbilityContext => ({ ...context, map })

const mapWithEncounter = (map: TabletopMap, encounter: EncounterState): TabletopMap => ({
  ...map,
  encounterState: encounter,
})

const actionAndFrequency = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly canonicalId: string
  readonly action: 'free' | 'swift' | 'standard' | null
  readonly frequency?: AbilityFrequencyDeclaration
}): { readonly map: TabletopMap; readonly encounter: EncounterState } => {
  let map = input.context.map
  if (input.action !== null) {
    map = planEncounterMoveResourceCosts({
      map,
      placementId: input.context.actor.placement.id,
      canonicalMoveId: `ability:${input.canonicalId}`,
      moveKey: `ability:${input.canonicalId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      range: `${input.action} action`,
      resolutionId: input.context.resolutionId,
      sourceOperationId: `${input.operationId}:action`,
      movement: null,
      reviewedCosts: [{
        id: `ability.action.${input.action}`,
        phase: 'pay',
        cost: { kind: 'action-resource', resource: input.action, amount: 1 },
      }],
      allowLegacyFallback: false,
      minimumPhaseExclusive: null,
      maximumPhaseInclusive: 'pay',
    }).nextMap
  }
  const paymentContext = contextWithMap(input.context, map)
  const payment = planAbilityFrequencyPayment({
    context: paymentContext,
    frequency: input.frequency ?? SCENE_FREQUENCY,
    abilityInstanceId: effectiveInstanceId(paymentContext, input.canonicalId),
    clauseId: 'base',
    operationId: `${input.operationId}:frequency`,
    sceneId: paymentContext.map.encounterState?.history.sceneId ?? undefined,
  })
  const change = payment.plan.changes.find(candidate => candidate.kind === 'encounter-state')
    ?? fail(`${input.canonicalId} did not produce its Scene payment.`)
  const encounter = parseEncounterState(change.current)
  return { map: mapWithEncounter(map, encounter), encounter }
}

const materializeMovementPlan = (map: TabletopMap, plan: MoveStateChangePlan): TabletopMap => {
  let current = map
  for (const change of plan.changes) {
    if (change.kind === 'placement-state') {
      const placement = change.current ?? fail('Magnet Pull cannot remove its target placement.')
      current = {
        ...current,
        placements: current.placements.map(candidate => candidate.id === placement.id ? placement : candidate),
      }
    }
    else if (change.kind === 'encounter-state') current = mapWithEncounter(current, parseEncounterState(change.current))
    else if (change.kind === 'map-metadata') current = { ...current, metadata: change.current }
  }
  return current
}

const nonEncounterMovementChanges = (plan: MoveStateChangePlan): MoveStateChangeInput[] => plan.changes
  .filter(change => change.kind !== 'encounter-state')
  .map(({ id: _id, order: _order, ...change }) => change)

const magnetConstraint = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly targetId: string
  readonly kind: 'maximum' | 'minimum'
}): EncounterEffect => parseEncounterEffect({
  id: `ability.magnet-pull.${input.kind}.${shortHash(input.operationId, input.targetId, input.kind)}`,
  kind: 'capability',
  source: {
    operationId: input.operationId,
    moveId: 'ability.magnet-pull',
    placementId: input.context.actor.placement.id,
  },
  affected: { placementIds: [input.targetId], sideIds: [], cells: [] },
  createdRound: Math.max(1, input.context.map.initiative?.round ?? 1),
  createdTurn: Math.max(0, input.context.map.encounterState?.history.currentTurn?.turn ?? 0),
  duration: { kind: 'turns', subject: 'source', boundary: 'end', remaining: 2 },
  stacks: 1,
  charges: null,
  stackPolicy: { kind: 'replace', maxStacks: null },
  chargePolicy: { kind: 'none', amount: null },
  tags: ['ability', 'aa079', 'magnet-pull', `magnet-pull-${input.kind}`],
  payload: { capabilityId: `movement.constraint.magnet-pull-${input.kind}`, action: 'grant' },
  dispel: { policy: 'matching-tags', tags: ['magnet-pull', `magnet-pull-${input.kind}`] },
  transferPolicy: 'expire',
  suppression: { sources: [] },
})

const magnetPull = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa079ActivatedExecution => {
  const targetId = selectedToken(input.choices, 'activate.target')
  const planId = selectedBranch(input.choices, 'activate.plan')
  const target = input.context.queries.tokens.get(targetId) ?? fail('Magnet Pull target disappeared.')
  const weightClass = Math.max(1, Math.floor(target.weightClass ?? 1))
  const maximumDisplacement = Math.max(0, 6 - weightClass)
  const movementMatch = /^(push|pull)-(\d+)-and-(maximum|minimum)-range:max-(\d+)$/.exec(planId)
  const rangeOnly = planId === 'maximum-and-minimum-range'
  if (!movementMatch && !rangeOnly) fail('Magnet Pull received an unsupported two-effect plan.')
  const displacement = movementMatch ? Number(movementMatch[2]) : null
  const issuedMaximum = movementMatch ? Number(movementMatch[4]) : null
  if (issuedMaximum !== null && issuedMaximum !== maximumDisplacement) {
    fail('Magnet Pull selected plan no longer matches the target Weight Class.')
  }
  if (displacement !== null && (!Number.isSafeInteger(displacement)
    || displacement < 0 || displacement > maximumDisplacement)) {
    fail('Magnet Pull displacement exceeds 6 minus the target Weight Class.')
  }

  const paid = actionAndFrequency({
    ...input,
    canonicalId: 'Magnet Pull',
    action: 'swift',
    frequency: SCENE_X3_FREQUENCY,
  })
  let map = paid.map
  let movementPlan: MoveStateChangePlan | null = null
  if (movementMatch && displacement !== null && displacement > 0) {
    const actorPosition = input.context.actor.placement.position
    const targetPosition = target.position
    const away = {
      x: Math.sign(targetPosition.x - actorPosition.x),
      y: Math.sign(targetPosition.y - actorPosition.y),
      z: Math.sign(targetPosition.z - actorPosition.z),
    }
    if (away.x === 0 && away.y === 0 && away.z === 0) fail('Magnet Pull cannot derive a direct displacement vector.')
    const direction = movementMatch[1] === 'push'
      ? away
      : { x: -away.x, y: -away.y, z: -away.z }
    const movement = planAbilityMovement({
      context: contextWithMap(input.context, map),
      command: {
        operationId: `${input.operationId}:displacement`,
        kind: 'displacement',
        placementId: targetId,
        movementMode: 'forced',
        vector: direction,
        requestedDistance: displacement,
        distancePolicy: 'up-to-distance',
      },
      userName: input.context.actor.token.species,
    })
    if (movement.status !== 'completed') fail('Magnet Pull opened an unsupported movement interrupt window.')
    movementPlan = movement.plan
    map = materializeMovementPlan(map, movement.plan)
  }

  const constraintKinds: ('maximum' | 'minimum')[] = rangeOnly
    ? ['maximum', 'minimum']
    : [movementMatch![3] as 'maximum' | 'minimum']
  const encounter = parseEncounterState(map.encounterState ?? paid.encounter)
  const retained = encounter.effects.filter(effect => !(
    effect.tags.includes('magnet-pull')
    && effect.affected.placementIds.includes(targetId)
    && effect.source.placementId === input.context.actor.placement.id
    && constraintKinds.some(kind => effect.tags.includes(`magnet-pull-${kind}`))
  ))
  const effects = constraintKinds.map(kind => magnetConstraint({ ...input, targetId, kind }))
  const current = parseEncounterState({ ...encounter, effects: [...retained, ...effects] })
  return Object.freeze({
    plan: createMoveStateChangePlan([
      ...(movementPlan ? nonEncounterMovementChanges(movementPlan) : []),
      encounterChange({
        ...input,
        reasonCode: 'ability.aa079.magnet-pull.action-frequency-movement-and-constraints',
        current,
      }),
    ]),
    presentationKey: 'ability.aa079.magnet-pull.applied',
  })
}

const targetSheetChange = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly targetId: string
  readonly previous: CharacterSheet | TrainerSheet
  readonly current: CharacterSheet | TrainerSheet
  readonly changedFields: readonly MoveSheetStateField[]
  readonly reasonCode: string
}): MoveStateChangeInput => {
  const placement = input.context.queries.placements.get(input.targetId)
    ?? fail('Ability target placement disappeared.')
  return {
    kind: 'sheet-state',
    scope: { kind: 'sheet', sheetKind: placement.sheetKind, sheetSlug: placement.sheetSlug },
    expectedRevision: normalizeRevision(input.previous.revision),
    sourceOperationId: input.operationId,
    reasonCode: input.reasonCode,
    previous: input.previous,
    current: { ...input.current, revision: nextRevision(normalizeRevision(input.previous.revision)) },
    changedFields: [...input.changedFields],
    compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  }
}

const memoryWipe = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa079ActivatedExecution => {
  const mode = input.context.request.modeId as Aa079MemoryWipeMode
  if (!['swift', 'standard', 'extended'].includes(mode)) fail('Memory Wipe mode is unsupported.')
  const targetId = selectedToken(input.choices, `${mode}.target`)
  const placement = input.context.queries.placements.get(targetId) ?? fail('Memory Wipe target disappeared.')
  const resolved = input.context.queries.sheets.forPlacement(placement) ?? fail('Memory Wipe target sheet disappeared.')
  const paid = actionAndFrequency({
    ...input,
    canonicalId: 'Memory Wipe',
    action: mode === 'extended' ? null : mode,
  })
  const changes: MoveStateChangeInput[] = [encounterChange({
    ...input,
    reasonCode: `ability.aa079.memory-wipe.${mode}.payment`,
    current: paid.encounter,
  })]

  if (mode === 'swift' || mode === 'standard') {
    const previous = deepCloneJson(resolved.sheet) as AnyLiveSheet
    const token = input.context.queries.tokens.get(targetId) ?? fail('Memory Wipe target token disappeared.')
    const effectiveTarget = {
      ...token,
      abilityNames: input.context.queries.effectiveAbilities.activeForPlacement(targetId)
        .map(ability => ability.canonicalId),
    }
    let conditions = normalizeConditionNames(token.conditions)
    if (mode === 'swift') {
      const lastMove = input.context.queries.history.lastCompletedMove(targetId)
        ?? fail('Memory Wipe target has no authoritative last Move to disable.')
      conditions = normalizeConditionNames([...conditions, `Disabled: ${lastMove.canonicalId}`])
    }
    else {
      for (const condition of ['Flinch', 'Paralysis'] as const) {
        if (moveAutomationConditionImmunitySource(condition, effectiveTarget) !== null) continue
        conditions = addAppliedCondition(conditions, condition)
      }
    }
    const current = applyConditionsToSheet(resolved.kind, previous, conditions)
    if (!sameJsonValue(previous, current)) changes.unshift(targetSheetChange({
      ...input,
      targetId,
      previous,
      current,
      changedFields: ['conditions'],
      reasonCode: `ability.aa079.memory-wipe.${mode}.conditions`,
    }))
  }
  else {
    const minutesId = selectedBranch(input.choices, 'extended.minutes')
    const match = /^minutes-(\d+)$/.exec(minutesId)
    const minutes = match ? Number(match[1]) : 0
    if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 10) {
      fail('Memory Wipe extended duration must be from 1 through 10 minutes.')
    }
    const stateId = `aa079.memory-wipe.${shortHash(input.operationId, targetId, String(minutes))}`
    const reduced = reduceAbilityOwnedStateCommand(
      paid.encounter.abilityOwnedState ?? createEmptyAbilityOwnedState(),
      {
        operationId: `${input.operationId}:memory-mark`,
        kind: 'create',
        stateId,
        expectedVersion: null,
        entry: {
          stateId,
          ownerPlacementId: input.context.actor.placement.id,
          sourceAbilityInstanceId: effectiveInstanceId(input.context, 'Memory Wipe'),
          canonicalId: 'Memory Wipe',
          targetPlacementIds: [targetId],
          lifecycle: { kind: 'scene', targetPolicy: null },
          payload: { kind: 'mark', markId: `aa079.memory-wipe.erased-${minutes}-minutes-within-30` },
        },
      },
    )
    changes.splice(0, changes.length, encounterChange({
      ...input,
      reasonCode: 'ability.aa079.memory-wipe.extended-memory-erased',
      current: parseEncounterState({
        ...paid.encounter,
        abilityOwnedState: parseAbilityOwnedState(reduced.state),
      }),
    }))
  }

  return Object.freeze({
    plan: createMoveStateChangePlan(changes),
    presentationKey: `ability.aa079.memory-wipe.${mode}`,
  })
}

const mimicryFieldTags = (context: AuthoritativeAbilityContext): ReadonlySet<string> => {
  const footprint = gridFootprintCells(context.actor.token.position, context.actor.token)
  const horizontal = new Set(footprint.map(cell => `${cell.x}:${cell.z}`))
  const topByCell = new Map<string, AuthoritativeAbilityContext['map']['voxels'][number]>()
  for (const voxel of context.map.voxels) {
    const key = `${voxel.x}:${voxel.z}`
    if (!horizontal.has(key) || voxel.y > context.actor.token.position.y) continue
    const current = topByCell.get(key)
    if (!current || voxel.y > current.y) topByCell.set(key, voxel)
  }
  const tags = new Set<string>()
  for (const voxel of topByCell.values()) {
    const definition = getMaterialDefinition(voxel.materialId)
    for (const rawTag of [...(definition.tags ?? []), ...(voxel.tags ?? [])]) {
      const tag = rawTag.trim().toLowerCase()
      if (tag) tags.add(tag)
    }
  }
  return tags
}

const mimicryTypes = (context: AuthoritativeAbilityContext): readonly PokemonTypeId[] => {
  const tags = mimicryFieldTags(context)
  const field = Object.entries(AA079_MIMICRY_FIELD_TAGS).flatMap(([fieldId, evidenceTags]) => (
    evidenceTags.some(tag => tags.has(tag))
      ? [...AA079_MIMICRY_FIELD_TYPES[fieldId as keyof typeof AA079_MIMICRY_FIELD_TYPES]]
      : []
  ))
  const weather = createMoveAutomationWeatherResolver(context.map, {
    subjectPlacementId: context.actor.placement.id,
  }).active().flatMap(entry => {
    const typeId = AA079_MIMICRY_WEATHER_TYPE[entry.kind as keyof typeof AA079_MIMICRY_WEATHER_TYPE]
    return typeId ? [typeId] : []
  })
  return Object.freeze([...new Set([...field, ...weather])] as PokemonTypeId[])
}

export const aa079MimicryTypeOptions = mimicryTypes

const mimicry = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa079ActivatedExecution => {
  const selected = selectedValue(input.choices, 'activate.type')
  const typeId = selected?.kind === 'type' ? selected.typeId : fail('Mimicry requires one issued type.')
  if (!mimicryTypes(input.context).includes(typeId)) fail('Mimicry selected type no longer matches the authoritative field.')
  const paid = actionAndFrequency({ ...input, canonicalId: 'Mimicry', action: 'free' })
  const effect = parseEncounterEffect({
    id: `ability.mimicry.type.${shortHash(input.operationId, typeId)}`,
    kind: 'creature-rule-overlay',
    source: {
      operationId: input.operationId,
      moveId: 'ability.mimicry',
      placementId: input.context.actor.placement.id,
    },
    affected: { placementIds: [input.context.actor.placement.id], sideIds: [], cells: [] },
    createdRound: Math.max(1, input.context.map.initiative?.round ?? 1),
    createdTurn: Math.max(0, input.context.map.encounterState?.history.currentTurn?.turn ?? 0),
    duration: { kind: 'scene', remaining: null },
    stacks: 1,
    charges: null,
    stackPolicy: { kind: 'replace', maxStacks: null },
    chargePolicy: { kind: 'none', amount: null },
    tags: ['ability', 'aa079', 'mimicry', 'type'],
    payload: {
      domain: 'type', action: 'replace', values: [typeId],
      referencePlacementId: null, suppressionScope: null,
    },
    dispel: { policy: 'matching-tags', tags: ['mimicry', 'type'] },
    transferPolicy: 'expire',
    suppression: { sources: [] },
  })
  const retained = paid.encounter.effects.filter(candidate => !(
    candidate.tags.includes('mimicry')
    && candidate.affected.placementIds.includes(input.context.actor.placement.id)
  ))
  return Object.freeze({
    plan: createMoveStateChangePlan([encounterChange({
      ...input,
      reasonCode: 'ability.aa079.mimicry.type-replaced',
      current: parseEncounterState({ ...paid.encounter, effects: [...retained, effect] }),
    })]),
    presentationKey: 'ability.aa079.mimicry.type-replaced',
  })
}

export interface Aa079ActivatedExecution {
  readonly plan: MoveStateChangePlan
  readonly presentationKey: string
}

export const executeAa079ActivatedMechanic = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operation: AbilityMechanicOperation
  readonly operationId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa079ActivatedExecution => {
  if (input.operation.mechanicId === 'aa079.magnet-pull') return magnetPull(input)
  if (input.operation.mechanicId === 'aa079.memory-wipe') return memoryWipe(input)
  if (input.operation.mechanicId === 'aa079.mimicry') return mimicry(input)
  return fail(`AA-079 mechanic ${input.operation.mechanicId} is not a direct activated adapter.`)
}
