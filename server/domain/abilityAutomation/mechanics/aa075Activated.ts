import { createHash } from 'node:crypto'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { AbilityDeclarationOptionValue } from '#shared/abilityAutomation/declarationIntent'
import type { AbilityFrequencyDeclaration } from '#shared/abilityAutomation/frequency'
import type { AbilityMechanicOperation } from '#shared/abilityAutomation/mechanics'
import {
  AA075_ICE_FACE_FORM_MARKER_CAPABILITY,
  AA075_ILLUSION_ACTIVE_CAPABILITY_PREFIX,
  AA075_ILLUSION_MARK_PREFIX,
  AA075_ILLUSION_ROUND_USE_CAPABILITY,
  aa075ActiveIllusionEffect,
  aa075IllusionMarks,
  aa075IllusionUsedThisRound,
} from '#shared/abilityAutomation/aa075'
import {
  createEmptyAbilityOwnedState,
  parseAbilityOwnedState,
  type AbilityOwnedState,
  type AbilityOwnedStateEntry,
} from '#shared/abilityAutomation/ownedState'
import {
  createEmptyEncounterState,
  parseEncounterState,
  type EncounterState,
} from '#shared/moveAutomation/encounterState'
import { parseEncounterEffect, type EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import { parseEncounterZone, type EncounterBarrierZone, type EncounterZoneCell } from '#shared/moveAutomation/encounterZones'
import type { AnyLiveSheet } from '~/utils/sheetMutations'
import { applyHpToSheet } from '~/utils/sheetMutations'
import { computeTickValue } from '~/utils/ptuHp'
import { deepCloneJson } from '~/utils/serialization'
import {
  createMoveStateChangePlan,
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  type MoveStateChangeInput,
  type MoveStateChangePlan,
} from '../../moveAutomation/plan'
import { planEncounterMoveResourceCosts } from '../../moveAutomation/planMoveResources'
import { createMoveAutomationWeatherResolver } from '../../moveAutomation/weather'
import { authoritativeAbilityHealingBlocked } from '../healingPrevention'
import { createAa075IceFaceTemporaryHpMarker } from './aa075TemporaryHpIntegration'
import type { AuthoritativeAbilityContext } from '../context'
import { reduceAbilityOwnedStateCommand } from '../ownedState'
import { planAbilityFrequencyPayment } from '../usage'

const DAILY_X5_FREQUENCY = Object.freeze({
  raw: 'Daily x5', actionText: '', kind: 'daily', uses: 5, exceptionId: null,
} satisfies AbilityFrequencyDeclaration)
const SCENE_FREQUENCY = Object.freeze({
  raw: 'Scene', actionText: '', kind: 'scene', uses: 1, exceptionId: null,
} satisfies AbilityFrequencyDeclaration)

export class Aa075ActivatedExecutionError extends Error {
  constructor(detail: string) { super(detail); this.name = 'Aa075ActivatedExecutionError' }
}
const fail = (detail: string): never => { throw new Aa075ActivatedExecutionError(detail) }
const hash = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)

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
  readonly resource: 'free' | 'swift' | 'standard'
}) => planEncounterMoveResourceCosts({
  map: input.context.map,
  placementId: input.context.actor.placement.id,
  canonicalMoveId: `ability:${input.canonicalId}`,
  moveKey: `ability:${input.canonicalId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
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
  readonly resource: 'standard'
}): EncounterState => {
  const action = payAction(input)
  const context: AuthoritativeAbilityContext = {
    ...input.context,
    map: { ...input.context.map, encounterState: action.currentEncounterState },
  }
  const frequency = planAbilityFrequencyPayment({
    context,
    frequency: SCENE_FREQUENCY,
    abilityInstanceId: effectiveInstanceId(context, input.canonicalId),
    clauseId: 'base',
    operationId: `${input.operationId}:frequency`,
    sceneId: context.map.encounterState?.history.sceneId ?? undefined,
  })
  const change = frequency.plan.changes.find(candidate => candidate.kind === 'encounter-state')
    ?? fail(`${input.canonicalId} did not produce its Scene payment.`)
  return parseEncounterState(change.current)
}

const hailActive = (context: AuthoritativeAbilityContext): boolean => (
  createMoveAutomationWeatherResolver(context.map, {
    subjectPlacementId: context.actor.placement.id,
  }).active().some(weather => weather.kind === 'hail')
)

const iceBody = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
}): Aa075ActivatedExecution => {
  const token = input.context.actor.token
  const maximumHp = Math.max(1, token.fullMaxHp ?? token.maxHp)
  if (token.currentHp * 2 >= maximumHp && !hailActive(input.context)) {
    fail('Ice Body requires the user to be below 50% Hit Points or in Hailing Weather.')
  }
  const action = payAction({ ...input, canonicalId: 'Ice Body', resource: 'swift' })
  const frequency = planAbilityFrequencyPayment({
    context: input.context,
    frequency: DAILY_X5_FREQUENCY,
    abilityInstanceId: effectiveInstanceId(input.context, 'Ice Body'),
    clauseId: 'base',
    operationId: `${input.operationId}:frequency`,
    dayKey: input.context.actor.sheet.sheet.abilityUsage?.dayKey ?? 'campaign-day:initial',
  })
  const payment = frequency.plan.changes.find(change => change.kind === 'sheet-state')
    ?? fail('Ice Body did not produce its Daily payment.')
  const previous = deepCloneJson(input.context.actor.sheet.sheet) as AnyLiveSheet
  const paidSheet = deepCloneJson(payment.current) as AnyLiveSheet
  const healing = computeTickValue(maximumHp)
  const currentHp = authoritativeAbilityHealingBlocked({
    map: input.context.map,
    placementId: input.context.actor.placement.id,
  }) ? token.currentHp : Math.min(maximumHp, token.currentHp + healing)
  const current = applyHpToSheet(
    input.context.actor.sheet.kind,
    paidSheet,
    currentHp,
    token.injuries ?? 0,
  )
  current.revision = nextRevision(input.context.actor.sheet.revision)
  return Object.freeze({
    plan: createMoveStateChangePlan([
      encounterChange({
        ...input,
        reasonCode: 'ability.aa075.ice-body.action',
        current: action.currentEncounterState,
      }),
      {
        kind: 'sheet-state',
        scope: {
          kind: 'sheet', sheetKind: input.context.actor.sheet.kind,
          sheetSlug: input.context.actor.sheet.slug,
        },
        expectedRevision: input.context.actor.sheet.revision,
        sourceOperationId: input.operationId,
        reasonCode: 'ability.aa075.ice-body.heal-and-frequency',
        previous,
        current,
        changedFields: currentHp === token.currentHp ? ['abilityUsage'] : ['abilityUsage', 'hp'],
        compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
      },
    ]),
    presentationKey: currentHp === token.currentHp
      ? 'ability.aa075.ice-body.no-healing'
      : 'ability.aa075.ice-body.healed',
  })
}

const iceFaceMarker = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
}): EncounterEffect => createAa075IceFaceTemporaryHpMarker({
  map: input.context.map,
  placementId: input.context.actor.placement.id,
  sourceOperationId: input.operationId,
  sourceAbilityInstanceId: effectiveInstanceId(input.context, 'Ice Face'),
})

const iceFace = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
}): Aa075ActivatedExecution => {
  if (!hailActive(input.context)) fail('Ice Face may restore its face only in Hailing Weather.')
  const action = payAction({ ...input, canonicalId: 'Ice Face', resource: 'standard' })
  const activeScene = input.context.map.activeScene ?? fail('Ice Face requires an active Scene.')
  const previousTemporary = input.context.map.temporaryHitPoints
  const base = previousTemporary
    && previousTemporary.scene.name === activeScene.name
    && previousTemporary.scene.startedAt === activeScene.startedAt
    ? previousTemporary
    : { scene: { ...activeScene }, byPlacementId: {} }
  const actorId = input.context.actor.placement.id
  const currentTemporaryHp = base.byPlacementId[actorId] ?? 0
  const granted = computeTickValue(input.context.actor.token.fullMaxHp ?? input.context.actor.token.maxHp) * 2
  const nextTemporaryHp = authoritativeAbilityHealingBlocked({ map: input.context.map, placementId: actorId })
    ? currentTemporaryHp
    : Math.max(currentTemporaryHp, granted)
  const paid = parseEncounterState(action.currentEncounterState)
  const priorMarker = paid.effects.filter(effect => !(
    effect.kind === 'capability'
    && effect.payload.capabilityId === AA075_ICE_FACE_FORM_MARKER_CAPABILITY
    && effect.affected.placementIds.includes(actorId)
  ))
  const currentEncounter = nextTemporaryHp > currentTemporaryHp
    ? parseEncounterState({ ...paid, effects: [...priorMarker, iceFaceMarker(input)] })
    : paid
  const changes: MoveStateChangeInput[] = [encounterChange({
    ...input,
    reasonCode: 'ability.aa075.ice-face.action-and-form',
    current: currentEncounter,
  })]
  if (nextTemporaryHp !== currentTemporaryHp) changes.push({
    kind: 'map-temporary-hit-points',
    scope: { kind: 'map', mapSlug: input.context.map.slug },
    expectedRevision: normalizeRevision(input.context.map.revision),
    sourceOperationId: `${input.operationId}:temporary-hp`,
    reasonCode: 'ability.aa075.ice-face.temporary-hp',
    previous: deepCloneJson(previousTemporary),
    current: {
      scene: { ...base.scene },
      byPlacementId: { ...base.byPlacementId, [actorId]: nextTemporaryHp },
    },
    compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  })
  return Object.freeze({
    plan: createMoveStateChangePlan(changes),
    presentationKey: nextTemporaryHp === currentTemporaryHp
      ? 'ability.aa075.ice-face.no-op'
      : 'ability.aa075.ice-face.restored',
  })
}

const cellKey = (cell: EncounterZoneCell): string => `${cell.x}:${cell.y}:${cell.z}`
const sameCell = (left: EncounterZoneCell, right: EncounterZoneCell): boolean => (
  left.x === right.x && left.y === right.y && left.z === right.z
)
const adjacentCells = (left: EncounterZoneCell, right: EncounterZoneCell): boolean => (
  left.y === right.y
  && Math.abs(left.x - right.x) + Math.abs(left.z - right.z) === 1
)

const validateIceShieldCells = (
  context: AuthoritativeAbilityContext,
  cells: readonly EncounterZoneCell[],
): void => {
  if (cells.length < 1 || cells.length > 3 || new Set(cells.map(cellKey)).size !== cells.length) {
    fail('Ice Shield requires one through three distinct issued segments.')
  }
  if (cells.some(cell => (
    !Number.isSafeInteger(cell.x) || !Number.isSafeInteger(cell.y) || !Number.isSafeInteger(cell.z)
    || cell.x < 0 || cell.x >= context.map.dimensions.x
    || cell.y < 0 || cell.y + 1 >= context.map.dimensions.y
    || cell.z < 0 || cell.z >= context.map.dimensions.z
  ))) fail('Ice Shield received an out-of-bounds segment.')
  const connected = new Set<number>([0])
  let changed = true
  while (changed) {
    changed = false
    cells.forEach((cell, index) => {
      if (connected.has(index)) return
      if ([...connected].some(other => adjacentCells(cell, cells[other]!))) {
        connected.add(index)
        changed = true
      }
    })
  }
  if (connected.size !== cells.length) fail('Every Ice Shield segment must be continuous with another segment.')
  const actor = context.actor.token
  const actorAdjacent = cells.some(cell => (
    cell.y === actor.position.y
    && cell.x >= actor.position.x - 1 && cell.x <= actor.position.x + actor.base
    && cell.z >= actor.position.z - 1 && cell.z <= actor.position.z + actor.base
    && !(cell.x >= actor.position.x && cell.x < actor.position.x + actor.base
      && cell.z >= actor.position.z && cell.z < actor.position.z + actor.base)
  ))
  if (!actorAdjacent) fail('At least one Ice Shield segment must be adjacent to the user.')
  const occupied = new Set<string>()
  for (const placement of context.placements) {
    const token = context.queries.tokens.get(placement.id)
    if (!token) continue
    for (let x = token.position.x; x < token.position.x + token.base; x += 1) {
      for (let y = token.position.y; y < token.position.y + token.clearance; y += 1) {
        for (let z = token.position.z; z < token.position.z + token.base; z += 1) occupied.add(`${x}:${y}:${z}`)
      }
    }
  }
  for (const zone of context.map.encounterState?.zones ?? []) {
    if (zone.kind !== 'barrier' || zone.geometry.kind !== 'cells') continue
    const anchor = zone.geometry.cells[0]
    if (!anchor) continue
    for (let offset = 0; offset < zone.payload.height; offset += 1) {
      occupied.add(`${anchor.x}:${anchor.y + offset}:${anchor.z}`)
    }
  }
  if (cells.some(cell => occupied.has(cellKey(cell)) || occupied.has(`${cell.x}:${cell.y + 1}:${cell.z}`))) {
    fail('Ice Shield segments cannot overlap a token or existing Barrier.')
  }
}

const iceShield = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa075ActivatedExecution => {
  const cells = selectedValues(input.choices, 'activate.segments').map(value => (
    value.kind === 'cell' ? value.cell : fail('Ice Shield requires issued segment cells.')
  ))
  validateIceShieldCells(input.context, cells)
  const paid = paySceneAction({ ...input, canonicalId: 'Ice Shield', resource: 'standard' })
  const sideId = input.context.actor.placement.sideId ?? null
  const zones = [...paid.zones]
  for (const [index, cell] of cells.entries()) {
    const suffix = hash(input.context.actor.placement.id, input.context.resolutionId, cellKey(cell))
    zones.push(parseEncounterZone({
      id: `ability.ice-shield.segment.${suffix}`,
      kind: 'barrier',
      source: {
        kind: 'operation', operationId: `${input.operationId}:segment:${index + 1}`,
        moveId: 'ability.ice-shield', placementId: input.context.actor.placement.id,
      },
      sideId,
      geometry: { kind: 'cells', cells: [{ ...cell }] },
      layer: 1,
      duration: { kind: 'scene', remaining: null },
      stacking: { kind: 'independent', maxLayers: null },
      hooks: { entry: [], exit: [] },
      modifiers: { targeting: [], damage: [], movement: [] },
      tags: ['ability', 'aa075', 'ice-shield', 'barrier', 'blocking-terrain'],
      payload: {
        barrierId: 'ice-shield', currentHitPoints: 10, maximumHitPoints: 10,
        damageReduction: 5, height: 2, typeIds: ['ice'],
      },
    }) as EncounterBarrierZone)
  }
  return Object.freeze({
    plan: createMoveStateChangePlan([encounterChange({
      ...input,
      reasonCode: 'ability.aa075.ice-shield.created',
      current: { ...paid, zones },
    })]),
    presentationKey: 'ability.aa075.ice-shield.created',
  })
}

const ownedStateFrom = (encounter: EncounterState): AbilityOwnedState => parseAbilityOwnedState(
  encounter.abilityOwnedState ?? createEmptyAbilityOwnedState(),
)

const illusionAction = (operation: string): 'free' | 'standard' => (
  operation === 'mark-creature' || operation === 'mark-object'
  || operation === 'replace-creature' || operation === 'replace-object'
    ? 'standard'
    : 'free'
)

const illusionMarkIdentity = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operation: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): { readonly markId: string; readonly targetPlacementIds: readonly string[] } => {
  const creature = input.operation === 'mark-creature' || input.operation === 'replace-creature'
  if (creature) {
    const declarationId = `${input.operation}.target`
    const selected = selectedValues(input.choices, declarationId)[0]
    const placementId = selected?.kind === 'token'
      ? selected.placementId
      : fail('Illusion requires one issued creature mark target.')
    if (!input.context.queries.placements.get(placementId)) fail('Illusion creature mark target disappeared.')
    return {
      markId: `${AA075_ILLUSION_MARK_PREFIX}creature.${placementId}`,
      targetPlacementIds: [placementId],
    }
  }
  const declarationId = `${input.operation}.cell`
  const selected = selectedValues(input.choices, declarationId)[0]
  const cell = selected?.kind === 'cell' ? selected.cell : fail('Illusion requires one issued object cell.')
  if (!input.context.map.voxels.some(voxel => sameCell(voxel, cell))) {
    fail('Illusion object mark must still identify an authoritative map object cell.')
  }
  return {
    markId: `${AA075_ILLUSION_MARK_PREFIX}object.${cell.x}.${cell.y}.${cell.z}`,
    targetPlacementIds: [],
  }
}

const illusionEffect = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly stateId: string
  readonly instanceId: string
}): EncounterEffect => parseEncounterEffect({
  id: `ability.illusion.active.${hash(input.context.actor.placement.id, input.instanceId)}`,
  kind: 'capability',
  source: {
    operationId: input.operationId,
    moveId: 'ability.illusion',
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
  tags: ['ability', 'aa075', 'illusion', 'appearance'],
  payload: { capabilityId: `${AA075_ILLUSION_ACTIVE_CAPABILITY_PREFIX}${input.stateId}`, action: 'grant' },
  dispel: { policy: 'matching-tags', tags: ['illusion', 'appearance'] },
  transferPolicy: 'expire',
  suppression: { sources: [] },
})

const illusionRoundUseEffect = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly instanceId: string
}): EncounterEffect => parseEncounterEffect({
  id: `ability.illusion.round-use.${hash(input.context.actor.placement.id, input.instanceId)}`,
  kind: 'capability',
  source: {
    operationId: input.operationId,
    moveId: 'ability.illusion',
    placementId: input.context.actor.placement.id,
  },
  affected: { placementIds: [input.context.actor.placement.id], sideIds: [], cells: [] },
  createdRound: Math.max(1, input.context.map.initiative?.round ?? 1),
  createdTurn: Math.max(0, input.context.map.encounterState?.history.currentTurn?.turn ?? 0),
  duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
  stacks: 1,
  charges: null,
  stackPolicy: { kind: 'replace', maxStacks: null },
  chargePolicy: { kind: 'none', amount: null },
  tags: ['ability', 'aa075', 'illusion', 'round-use'],
  payload: { capabilityId: AA075_ILLUSION_ROUND_USE_CAPABILITY, action: 'grant' },
  dispel: { policy: 'matching-tags', tags: ['illusion', 'round-use'] },
  transferPolicy: 'expire',
  suppression: { sources: [] },
})

const selectedIllusionMark = (input: {
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
  readonly declarationId: string
  readonly marks: readonly AbilityOwnedStateEntry[]
}): AbilityOwnedStateEntry => {
  const selected = selectedValues(input.choices, input.declarationId)[0]
  const stateId = selected?.kind === 'branch' ? selected.branchId : fail('Illusion requires one issued mark.')
  return input.marks.find(mark => mark.stateId === stateId)
    ?? fail('Illusion selected mark is stale or no longer owned by the user.')
}

const illusion = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operation: AbilityMechanicOperation
  readonly operationId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa075ActivatedExecution => {
  const operation = String(input.operation.config.operation)
  const instanceId = effectiveInstanceId(input.context, 'Illusion')
  const action = payAction({
    ...input,
    canonicalId: 'Illusion',
    resource: illusionAction(operation),
  })
  let encounter = parseEncounterState(action.currentEncounterState)
  let state = ownedStateFrom(encounter)
  let marks = aa075IllusionMarks({
    entries: state.entries,
    ownerPlacementId: input.context.actor.placement.id,
    sourceAbilityInstanceId: instanceId,
  })
  const capacity = Math.max(1, Math.min(6, input.context.actor.token.focusSkillRankValue
    ?? fail('Illusion requires an authoritative Focus Rank.')))

  if (operation.startsWith('mark-') || operation.startsWith('replace-')) {
    if (operation.startsWith('mark-') && marks.length >= capacity) {
      fail('Illusion is at its Focus Rank mark capacity; an old mark must be explicitly forfeited.')
    }
    if (operation.startsWith('replace-')) {
      const oldMark = selectedIllusionMark({
        choices: input.choices,
        declarationId: `${operation}.old-mark`,
        marks,
      })
      state = reduceAbilityOwnedStateCommand(state, {
        operationId: `${input.operationId}:forfeit`,
        kind: 'remove',
        stateId: oldMark.stateId,
        expectedVersion: oldMark.version,
      }).state
      const active = aa075ActiveIllusionEffect(encounter.effects, input.context.actor.placement.id)
      if (active?.payload.capabilityId === `${AA075_ILLUSION_ACTIVE_CAPABILITY_PREFIX}${oldMark.stateId}`) {
        encounter = parseEncounterState({
          ...encounter,
          effects: encounter.effects.filter(effect => effect.id !== active.id),
        })
      }
      marks = marks.filter(mark => mark.stateId !== oldMark.stateId)
    }
    const identity = illusionMarkIdentity({ context: input.context, operation, choices: input.choices })
    if (marks.some(mark => mark.payload.kind === 'mark' && mark.payload.markId === identity.markId)) {
      fail('Illusion cannot mark the same target more than once.')
    }
    const stateId = `aa075.illusion.state.${hash(input.context.actor.placement.id, instanceId, identity.markId)}`
    state = reduceAbilityOwnedStateCommand(state, {
      operationId: `${input.operationId}:create`,
      kind: 'create',
      stateId,
      expectedVersion: null,
      entry: {
        stateId,
        ownerPlacementId: input.context.actor.placement.id,
        sourceAbilityInstanceId: instanceId,
        canonicalId: 'Illusion',
        targetPlacementIds: identity.targetPlacementIds,
        lifecycle: { kind: 'source-ability', targetPolicy: null },
        payload: { kind: 'mark', markId: identity.markId },
      },
    }).state
    encounter = parseEncounterState({ ...encounter, abilityOwnedState: state })
    return Object.freeze({
      plan: createMoveStateChangePlan([encounterChange({
        ...input,
        reasonCode: 'ability.aa075.illusion.marked',
        current: encounter,
      })]),
      presentationKey: 'ability.aa075.illusion.marked',
    })
  }

  if (operation === 'assume') {
    if (aa075IllusionUsedThisRound(encounter.effects, input.context.actor.placement.id)) {
      fail('Illusion may assume a marked appearance only once per round.')
    }
    const mark = selectedIllusionMark({ choices: input.choices, declarationId: 'assume.mark', marks })
    const retained = encounter.effects.filter(effect => !(
      effect.affected.placementIds.includes(input.context.actor.placement.id)
      && effect.kind === 'capability'
      && (effect.payload.capabilityId.startsWith(AA075_ILLUSION_ACTIVE_CAPABILITY_PREFIX)
        || effect.payload.capabilityId === AA075_ILLUSION_ROUND_USE_CAPABILITY)
    ))
    encounter = parseEncounterState({
      ...encounter,
      effects: [
        ...retained,
        illusionEffect({ ...input, stateId: mark.stateId, instanceId }),
        illusionRoundUseEffect({ ...input, instanceId }),
      ],
    })
    return Object.freeze({
      plan: createMoveStateChangePlan([encounterChange({
        ...input,
        reasonCode: 'ability.aa075.illusion.assumed',
        current: encounter,
      })]),
      presentationKey: 'ability.aa075.illusion.assumed',
    })
  }

  if (operation === 'dismiss') {
    const active = aa075ActiveIllusionEffect(encounter.effects, input.context.actor.placement.id)
      ?? fail('Illusion has no active appearance to dismiss.')
    encounter = parseEncounterState({
      ...encounter,
      effects: encounter.effects.filter(effect => effect.id !== active.id),
    })
    return Object.freeze({
      plan: createMoveStateChangePlan([encounterChange({
        ...input,
        reasonCode: 'ability.aa075.illusion.dismissed',
        current: encounter,
      })]),
      presentationKey: 'ability.aa075.illusion.dismissed',
    })
  }
  return fail(`Illusion operation ${operation} is unsupported.`)
}

export interface Aa075ActivatedExecution {
  readonly plan: MoveStateChangePlan
  readonly presentationKey: string
}

export const executeAa075ActivatedMechanic = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operation: AbilityMechanicOperation
  readonly operationId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa075ActivatedExecution => {
  if (input.operation.mechanicId === 'aa075.ice-body') return iceBody(input)
  if (input.operation.mechanicId === 'aa075.ice-face') return iceFace(input)
  if (input.operation.mechanicId === 'aa075.ice-shield') return iceShield(input)
  if (input.operation.mechanicId === 'aa075.illusion') return illusion(input)
  return fail(`AA-075 mechanic ${input.operation.mechanicId} is not directly invocable.`)
}
