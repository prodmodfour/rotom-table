import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { AbilityFrequencyDeclaration } from '#shared/abilityAutomation/frequency'
import type { AbilityDeclarationOptionValue } from '#shared/abilityAutomation/declarationIntent'
import type { AbilityMechanicOperation } from '#shared/abilityAutomation/mechanics'
import {
  AA080_DREEPY_MAXIMUM,
  AA080_DREEPY_MOVEMENT_SPEED,
  AA080_DREEPY_TAG,
  AA080_DREEPY_TEMPLATE_ID,
  AA080_ENTITY_CLEARANCE,
  AA080_ENTITY_FOOTPRINT,
  AA080_MINI_NOSE_MAXIMUM,
  AA080_MINI_NOSE_MOVEMENT_SPEED,
  AA080_MINI_NOSE_TAG,
  AA080_MINI_NOSE_TEMPLATE_ID,
  AA080_MINI_NOSE_TETHER_METERS,
  aa080EntityIsActive,
  aa080IsDreepyEntity,
  aa080IsMiniNoseEntity,
} from '#shared/abilityAutomation/aa080'
import {
  createEmptyAbilityEntityState,
  parseAbilityEntityState,
  type AbilityEntityCell,
  type AbilityEntityEntry,
} from '#shared/abilityAutomation/entities'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import type { MapFieldEffects } from '~/types/map'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { AnyLiveSheet } from '~/utils/sheetMutations'
import { applyAbilityHpToSheet } from '../capabilityHpInvariants'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import { footprintsOverlap, isAnchorWithinBounds } from '~/utils/gridGeometry'
import { formatDamageBase } from '~/utils/moveAutomation'
import { resolveInstantMoveAutomation } from '~/utils/moveAutomationInstant'
import { mapWithTemporaryHpForPlacement } from '~/utils/mapTemporaryHitPoints'
import {
  createMoveStateChangePlan,
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  type MoveStateChangeInput,
  type MoveStateChangePlan,
} from '../../moveAutomation/plan'
import { planEncounterMoveResourceCosts } from '../../moveAutomation/planMoveResources'
import { applyMapGlobalField } from '../../moveAutomation/fieldMapState'
import type { AuthoritativeAbilityContext } from '../context'
import { planAbilityFrequencyPayment } from '../usage'
import { planAbilityTimingPayment } from '../timing'
import { reduceAbilityEntityCommand, type AbilityEntityCommand } from '../entities'

const DAILY_FREQUENCY = Object.freeze({
  raw: 'Daily', actionText: '', kind: 'daily', uses: 1, exceptionId: null,
} satisfies AbilityFrequencyDeclaration)
const SCENE_X2_FREQUENCY = Object.freeze({
  raw: 'Scene x2', actionText: '', kind: 'scene', uses: 2, exceptionId: null,
} satisfies AbilityFrequencyDeclaration)
const SCENE_X3_FREQUENCY = Object.freeze({
  raw: 'Scene x3', actionText: '', kind: 'scene', uses: 3, exceptionId: null,
} satisfies AbilityFrequencyDeclaration)

export interface Aa080ActivatedExecution {
  readonly plan: MoveStateChangePlan
  readonly presentationKey: string
  readonly controllerPresentationValues?: readonly string[]
}
export class Aa080ActivatedExecutionError extends Error {
  constructor(detail: string) { super(detail); this.name = 'Aa080ActivatedExecutionError' }
}
const fail = (detail: string): never => { throw new Aa080ActivatedExecutionError(detail) }

const selectedValues = (
  choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[],
  declarationId: string,
): readonly AbilityDeclarationOptionValue[] => choices.find(choice => choice.declarationId === declarationId)
  ?.options.map(option => option.value) ?? []
const selectedCells = (choices: Parameters<typeof selectedValues>[0], declarationId: string): readonly AbilityEntityCell[] => (
  selectedValues(choices, declarationId).map(value => value.kind === 'cell'
    ? value.cell
    : fail(`${declarationId} requires only issued cells.`))
)
const selectedTokenId = (choices: Parameters<typeof selectedValues>[0], declarationId: string): string => {
  const values = selectedValues(choices, declarationId)
  const value = values[0]
  if (values.length !== 1 || value?.kind !== 'token') fail(`${declarationId} requires one issued token.`)
  return (value as { readonly kind: 'token'; readonly placementId: string }).placementId
}
const effectiveInstanceId = (context: AuthoritativeAbilityContext, canonicalId: string): string => (
  context.actor.effectiveAbilities.find(ability => ability.effective && ability.canonicalId === canonicalId)?.instanceId
  ?? fail(`${canonicalId} effective instance disappeared.`)
)
const baseEncounter = (context: AuthoritativeAbilityContext) => parseEncounterState(
  context.map.encounterState ?? createEmptyEncounterState(),
)
const entityState = (encounter: ReturnType<typeof baseEncounter>) => parseAbilityEntityState(
  encounter.abilityEntities ?? createEmptyAbilityEntityState(),
)
const entityEntries = (context: AuthoritativeAbilityContext, predicate: (entry: AbilityEntityEntry) => boolean) => (
  entityState(baseEncounter(context)).entries.filter(entry => entry.ownerPlacementId === context.actor.placement.id && predicate(entry))
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
  previous: baseEncounter(input.context),
  current: parseEncounterState(input.current),
  compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
})

const payAction = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly canonicalId: string
  readonly resource: 'standard' | 'swift'
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

const paidEncounter = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly canonicalId: string
  readonly action?: 'standard' | 'swift'
  readonly frequency?: AbilityFrequencyDeclaration
}): { readonly encounter: ReturnType<typeof baseEncounter>; readonly sheetChanges: readonly MoveStateChangeInput[] } => {
  const action = input.action ? payAction({ ...input, resource: input.action }) : null
  const initialEncounter = action?.currentEncounterState ?? baseEncounter(input.context)
  if (!input.frequency) return { encounter: parseEncounterState(initialEncounter), sheetChanges: [] }
  const paymentContext: AuthoritativeAbilityContext = {
    ...input.context,
    map: { ...input.context.map, encounterState: initialEncounter },
  }
  const frequency = planAbilityFrequencyPayment({
    context: paymentContext,
    frequency: input.frequency,
    abilityInstanceId: effectiveInstanceId(input.context, input.canonicalId),
    clauseId: 'base',
    operationId: `${input.operationId}:frequency`,
    ...(input.frequency.kind === 'daily'
      ? { dayKey: input.context.actor.sheet.sheet.abilityUsage?.dayKey ?? 'campaign-day:initial' }
      : { sceneId: initialEncounter.history.sceneId ?? undefined }),
  })
  const encounter = frequency.plan.changes.find(change => change.kind === 'encounter-state')
  return {
    encounter: parseEncounterState(encounter?.kind === 'encounter-state' ? encounter.current : initialEncounter),
    sheetChanges: frequency.plan.changes.flatMap((change): MoveStateChangeInput[] => {
      if (change.kind !== 'sheet-state') return []
      const { id: _id, order: _order, ...inputChange } = change
      return [inputChange]
    }),
  }
}

const applyEntityCommands = (
  encounter: ReturnType<typeof baseEncounter>,
  commands: readonly AbilityEntityCommand[],
): ReturnType<typeof baseEncounter> => {
  let current = encounter
  for (const command of commands) {
    const reduced = reduceAbilityEntityCommand(
      current.abilityEntities ?? createEmptyAbilityEntityState(),
      command,
    )
    current = parseEncounterState({ ...current, abilityEntities: reduced.state })
  }
  return current
}

const validateDistinctCells = (cells: readonly AbilityEntityCell[]): void => {
  const keys = cells.map(cell => `${cell.x}:${cell.y}:${cell.z}`)
  if (new Set(keys).size !== keys.length) fail('Issued entity cells must be distinct.')
}
const validateOpenCells = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly cells: readonly AbilityEntityCell[]
  readonly maximumOwnerRange: number
  readonly exactAdjacent?: boolean
  readonly ignoredEntityIds?: ReadonlySet<string>
}): void => {
  for (const cell of input.cells) {
    if (!isAnchorWithinBounds(cell, {
      base: AA080_ENTITY_FOOTPRINT, clearance: AA080_ENTITY_CLEARANCE,
    }, input.context.map.dimensions)) fail('Issued entity cell is outside authoritative map bounds.')
    const distance = ptuGridDistanceBetweenFootprints(input.context.actor.token, {
      position: cell, base: AA080_ENTITY_FOOTPRINT, clearance: AA080_ENTITY_CLEARANCE,
    })
    if (distance > input.maximumOwnerRange || (input.exactAdjacent && distance !== 1)) {
      fail('Issued entity cell no longer satisfies its owner-relative placement range.')
    }
    const collision = input.context.tokens.find(token => footprintsOverlap(
      cell, AA080_ENTITY_FOOTPRINT, AA080_ENTITY_CLEARANCE,
      token.position, token.base, token.clearance,
    ))
    if (collision) fail(`Issued entity cell overlaps placement ${collision.id}.`)
    const entityCollision = input.context.abilityEntities.entries.find(entity => (
      aa080EntityIsActive(entity)
      && !input.ignoredEntityIds?.has(entity.entityId)
      && footprintsOverlap(
        cell, AA080_ENTITY_FOOTPRINT, AA080_ENTITY_CLEARANCE,
        entity.position, entity.base, entity.clearance,
      )
    ))
    if (entityCollision) fail(`Issued entity cell overlaps ability entity ${entityCollision.entityId}.`)
  }
}
const validateTether = (context: AuthoritativeAbilityContext, cells: readonly AbilityEntityCell[]): void => {
  for (const cell of cells) {
    if (ptuGridDistanceBetweenFootprints(context.actor.token, {
      position: cell, base: AA080_ENTITY_FOOTPRINT, clearance: AA080_ENTITY_CLEARANCE,
    }) > AA080_MINI_NOSE_TETHER_METERS) fail('Mini-Nose destination exceeds its authoritative 5-meter tether.')
  }
}

const assignReachableCells = (
  entries: readonly AbilityEntityEntry[],
  cells: readonly AbilityEntityCell[],
): readonly AbilityEntityCell[] => {
  const orderedCells = [...cells].sort((left, right) => (
    left.y - right.y || left.z - right.z || left.x - right.x
  ))
  const assign = (
    index: number,
    remaining: readonly AbilityEntityCell[],
    selected: readonly AbilityEntityCell[],
  ): readonly AbilityEntityCell[] | null => {
    if (index >= entries.length) return selected
    const entry = entries[index]!
    for (let cellIndex = 0; cellIndex < remaining.length; cellIndex += 1) {
      const cell = remaining[cellIndex]!
      if (ptuGridDistanceBetweenFootprints(entry, { ...entry, position: cell }) > entry.movementSpeed) continue
      const result = assign(
        index + 1,
        remaining.filter((_candidate, candidateIndex) => candidateIndex !== cellIndex),
        [...selected, cell],
      )
      if (result) return result
    }
    return null
  }
  return assign(0, orderedCells, [])
    ?? fail('Issued entity destinations have no authoritative movement-speed assignment.')
}
const entityId = (ownerId: string, kind: 'mini-nose' | 'dreepy', index: number) => `ability.${kind}.${ownerId}.${index + 1}`
const entityDraft = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
  readonly canonicalId: 'Mini-Noses' | 'Missile Launch'
  readonly entityId: string
  readonly cell: AbilityEntityCell
  readonly maximumHp: number
}): Omit<AbilityEntityEntry, 'version' | 'createdOperationId' | 'lastOperationId'> => ({
  entityId: input.entityId,
  kind: 'subordinate',
  labelKey: input.canonicalId === 'Mini-Noses' ? 'ability.mini-noses.entity' : 'ability.missile-launch.dreepy',
  ownerPlacementId: input.context.actor.placement.id,
  sourceAbilityInstanceId: input.abilityInstanceId,
  canonicalId: input.canonicalId,
  sourceOperationId: input.operationId,
  controller: { kind: 'source-controller', id: input.context.actor.placement.id },
  sideId: input.context.actor.placement.sideId ?? null,
  position: input.cell,
  base: AA080_ENTITY_FOOTPRINT,
  clearance: AA080_ENTITY_CLEARANCE,
  occupancy: 'non-blocking',
  targetability: 'targetable',
  movementMode: 'controlled',
  movementSpeed: input.canonicalId === 'Mini-Noses' ? AA080_MINI_NOSE_MOVEMENT_SPEED : AA080_DREEPY_MOVEMENT_SPEED,
  maximumHp: input.maximumHp,
  currentHp: input.maximumHp,
  damageReduction: 0,
  duration: { kind: 'source-presence' },
  tags: input.canonicalId === 'Mini-Noses'
    ? ['aa080', AA080_MINI_NOSE_TAG, 'levitate-4', 'ranged-origin']
    : ['aa080', AA080_DREEPY_TAG, 'dragon', 'missile-launch'],
  payload: {
    kind: 'subordinate',
    templateId: input.canonicalId === 'Mini-Noses' ? AA080_MINI_NOSE_TEMPLATE_ID : AA080_DREEPY_TEMPLATE_ID,
    initiativePolicy: 'none',
  },
})

const deployEntities = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
  readonly choices: Parameters<typeof selectedValues>[0]
  readonly canonicalId: 'Mini-Noses' | 'Missile Launch'
  readonly declarationId: string
  readonly minimum: number
  readonly maximum: number
  readonly maximumHp: number
}): Aa080ActivatedExecution => {
  const cells = selectedCells(input.choices, input.declarationId)
  if (cells.length < input.minimum || cells.length > input.maximum) fail(`${input.canonicalId} selected an invalid entity count.`)
  validateDistinctCells(cells)
  validateOpenCells({
    context: input.context,
    cells,
    maximumOwnerRange: input.canonicalId === 'Mini-Noses' ? 1 : 6,
    ...(input.canonicalId === 'Mini-Noses' ? { exactAdjacent: true } : {}),
  })
  if (input.canonicalId === 'Mini-Noses') validateTether(input.context, cells)
  const prior = entityEntries(input.context, input.canonicalId === 'Mini-Noses' ? aa080IsMiniNoseEntity : aa080IsDreepyEntity)
  const active = prior.filter(aa080EntityIsActive)
  if (input.canonicalId === 'Missile Launch' && active.length > 0) {
    fail('Missile Launch entities are already deployed.')
  }
  const destroyed = prior.filter(entity => !aa080EntityIsActive(entity)).sort((a, b) => a.entityId.localeCompare(b.entityId))
  const reclaimed = input.canonicalId === 'Mini-Noses' ? destroyed.slice(0, 1) : destroyed
  const unavailableDestroyed = destroyed.length - reclaimed.length
  const available = input.maximum - active.length - unavailableDestroyed
  if (cells.length > available) fail(`Mini-Noses has only ${available} grown entities after one authoritative 24-hour regrowth.`)
  const paid = paidEncounter({
    ...input,
    action: 'standard',
    frequency: input.canonicalId === 'Mini-Noses' ? DAILY_FREQUENCY : SCENE_X2_FREQUENCY,
  })
  const removals = reclaimed.map((entry, index): AbilityEntityCommand => ({
    operationId: `${input.operationId}:regrow:${index + 1}`,
    kind: 'remove', entityId: entry.entityId, expectedVersion: entry.version,
  }))
  const occupiedIds = new Set(prior.filter(entry => !reclaimed.includes(entry)).map(entry => entry.entityId))
  const availableIds = Array.from({ length: input.maximum }, (_, index) => entityId(
    input.context.actor.placement.id,
    input.canonicalId === 'Mini-Noses' ? 'mini-nose' : 'dreepy',
    index,
  )).filter(id => !occupiedIds.has(id))
  const creations = cells.map((cell, index): AbilityEntityCommand => {
    const id = availableIds[index] ?? fail(`${input.canonicalId} exhausted its stable entity identities.`)
    return {
      operationId: `${input.operationId}:create:${index + 1}`,
      kind: 'create', entityId: id, expectedVersion: null,
      entity: entityDraft({ ...input, entityId: id, cell, maximumHp: input.maximumHp }),
    }
  })
  const commands = [...removals, ...creations]
  const current = applyEntityCommands(paid.encounter, commands)
  return Object.freeze({
    plan: createMoveStateChangePlan([
      encounterChange({
        ...input,
        current,
        reasonCode: input.canonicalId === 'Mini-Noses'
          ? 'ability.aa080.mini-noses.deployed'
          : 'ability.aa080.missile-launch.deployed',
      }),
      ...paid.sheetChanges,
    ]),
    presentationKey: input.canonicalId === 'Mini-Noses'
      ? 'ability.aa080.mini-noses.deployed'
      : 'ability.aa080.missile-launch.deployed',
    controllerPresentationValues: commands.map(command => command.entityId),
  })
}

const shiftEntities = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly choices: Parameters<typeof selectedValues>[0]
  readonly canonicalId: 'Mini-Noses' | 'Missile Launch'
  readonly declarationId: string
}): Aa080ActivatedExecution => {
  const predicate = input.canonicalId === 'Mini-Noses' ? aa080IsMiniNoseEntity : aa080IsDreepyEntity
  const entries = entityEntries(input.context, predicate).filter(aa080EntityIsActive).sort((a, b) => a.entityId.localeCompare(b.entityId))
  const cells = selectedCells(input.choices, input.declarationId)
  if (entries.length === 0 || cells.length !== entries.length) fail(`${input.canonicalId} must move every active entity exactly once.`)
  validateDistinctCells(cells)
  validateOpenCells({
    context: input.context,
    cells,
    maximumOwnerRange: input.canonicalId === 'Mini-Noses' ? AA080_MINI_NOSE_TETHER_METERS : 1_000_000,
    ignoredEntityIds: new Set(entries.map(entry => entry.entityId)),
  })
  if (input.canonicalId === 'Mini-Noses') validateTether(input.context, cells)
  const assignedCells = assignReachableCells(entries, cells)
  const paid = input.canonicalId === 'Mini-Noses'
    ? (() => {
        const encounter = baseEncounter(input.context)
        const currentTurn = encounter.history.currentTurn
          ?? fail('Mini-Noses may Shift only during its owner’s authoritative turn.')
        if (currentTurn.placementId !== input.context.actor.placement.id) {
          fail('Mini-Noses may Shift only during its owner’s authoritative turn.')
        }
        const sceneId = encounter.history.sceneId ?? fail('Mini-Noses requires an active authoritative scene.')
        const timing = planAbilityTimingPayment({
          context: input.context,
          cursor: {
            sceneId,
            roundId: `round:${currentTurn.round}`,
            roundSequence: currentTurn.round,
            turnId: `turn:${currentTurn.round}:${currentTurn.turn}:${currentTurn.placementId}`,
            turnSequence: currentTurn.turn,
          },
          abilityInstanceId: effectiveInstanceId(input.context, 'Mini-Noses'),
          operationId: `${input.operationId}:round-shift`,
          constraint: { id: 'mini-noses-shift', kind: 'round', limit: 1 },
        })
        const change = timing.plan.changes.find(candidate => candidate.kind === 'encounter-state')
          ?? fail('Mini-Noses timing payment did not produce authoritative encounter state.')
        return { encounter: parseEncounterState(change.current), sheetChanges: [] as readonly MoveStateChangeInput[] }
      })()
    : paidEncounter({ ...input, action: 'swift' })
  const commands = entries.map((entry, index): AbilityEntityCommand => ({
    operationId: `${input.operationId}:move:${index + 1}`,
    kind: 'move', entityId: entry.entityId, expectedVersion: entry.version,
    position: assignedCells[index]!,
  }))
  const current = applyEntityCommands(paid.encounter, commands)
  return Object.freeze({
    plan: createMoveStateChangePlan([encounterChange({
      ...input,
      current,
      reasonCode: input.canonicalId === 'Mini-Noses'
        ? 'ability.aa080.mini-noses.shifted'
        : 'ability.aa080.missile-launch.shifted',
    })]),
    presentationKey: input.canonicalId === 'Mini-Noses'
      ? 'ability.aa080.mini-noses.shifted'
      : 'ability.aa080.missile-launch.shifted',
  })
}

const MISSILE_SCRIPT: MoveAutomationScript = Object.freeze({
  kind: 'explicit', moveName: 'Missile Launch', version: 1,
  targetMode: 'one-target', targetCount: 1,
  damaging: true, requiresAccuracy: true, damageBase: 5,
  damageClass: 'Physical', type: 'Dragon', ac: 2,
  range: 'Melee, 1 Target', effect: '', keywords: [], criticalRange: 20,
  conditionSuggestions: [], stageSuggestions: [], hpSuggestions: [],
  fieldSuggestions: [], hazardSuggestions: [], automationNotes: [],
})
const missileCollision = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly choices: Parameters<typeof selectedValues>[0]
}): Aa080ActivatedExecution => {
  const targetId = selectedTokenId(input.choices, 'collision.target')
  const target = input.context.queries.tokens.get(targetId) ?? fail('Missile Launch collision target disappeared.')
  if (targetId === input.context.actor.placement.id) {
    fail('Missile Launch collision target must be another creature.')
  }
  const cells = selectedCells(input.choices, 'collision.destination')
  if (cells.length !== 1) fail('Missile Launch collision requires one issued destination.')
  const cell = cells[0]!
  const entry = entityEntries(input.context, aa080IsDreepyEntity)
    .filter(entity => aa080EntityIsActive(entity)
      && ptuGridDistanceBetweenFootprints(entity, { ...entity, position: cell }) <= AA080_DREEPY_MOVEMENT_SPEED)
    .sort((a, b) => a.entityId.localeCompare(b.entityId))[0]
    ?? fail('No active Dreepy can reach the issued collision destination.')
  if (ptuGridDistanceBetweenFootprints({ ...entry, position: cell }, target) > 0) {
    fail('Missile Launch destination no longer collides with its issued target.')
  }
  const entityCollision = input.context.abilityEntities.entries.find(candidate => (
    candidate.entityId !== entry.entityId
    && aa080EntityIsActive(candidate)
    && footprintsOverlap(
      cell, entry.base, entry.clearance,
      candidate.position, candidate.base, candidate.clearance,
    )
  ))
  if (entityCollision) fail(`Missile Launch collision overlaps ability entity ${entityCollision.entityId}.`)
  const paid = paidEncounter({ ...input, canonicalId: 'Missile Launch', action: 'swift' })
  const movedEntryState = applyEntityCommands(paid.encounter, [{
    operationId: `${input.operationId}:move`, kind: 'move', entityId: entry.entityId,
    expectedVersion: entry.version, position: cell,
  }])
  const movedEntry = entityState(movedEntryState).entries.find(candidate => candidate.entityId === entry.entityId)
    ?? fail('Moved Dreepy disappeared before its canonical collision.')
  const moved = applyEntityCommands(movedEntryState, [{
    operationId: `${input.operationId}:collision-destroy`, kind: 'remove', entityId: movedEntry.entityId,
    expectedVersion: movedEntry.version,
  }])
  const targetAbilities = input.context.queries.effectiveAbilities.activeForPlacement(targetId).map(ability => ability.canonicalId)
  const user: SpawnedPokemon = {
    ...input.context.actor.token,
    position: cell,
    abilityNames: input.context.actor.effectiveAbilities
      .filter(ability => ability.effective)
      .map(ability => ability.canonicalId),
  }
  const result = resolveInstantMoveAutomation({
    script: MISSILE_SCRIPT,
    user,
    target: { ...target, abilityNames: [...targetAbilities] },
    damageFormula: formatDamageBase(5),
    randomRoller: input.context.random,
    idFactory: () => `${input.operationId}:collision`,
  })
  const changes: MoveStateChangeInput[] = [encounterChange({
    ...input,
    current: moved,
    reasonCode: 'ability.aa080.missile-launch.collision',
  })]
  const hp = result.transaction.hpUpdates.find(update => update.id === targetId)
  if (hp) {
    const placement = input.context.queries.placements.get(targetId) ?? fail('Missile Launch target placement disappeared.')
    const resolved = input.context.queries.sheets.forPlacement(placement) ?? fail('Missile Launch target sheet disappeared.')
    const previous = deepCloneJson(resolved.sheet) as AnyLiveSheet
    const injuries = hp.injuries ?? target.injuries ?? 0
    const hitPointsChanged = hp.currentHp !== target.currentHp || injuries !== (target.injuries ?? 0)
    if (hitPointsChanged) {
      const current = applyAbilityHpToSheet({
        context: input.context,
        placementId: targetId,
        sheet: previous,
        currentHp: hp.currentHp,
        injuries,
      })
      current.revision = nextRevision(resolved.revision)
      changes.push({
        kind: 'sheet-state',
        scope: { kind: 'sheet', sheetKind: resolved.kind, sheetSlug: resolved.slug },
        expectedRevision: resolved.revision,
        sourceOperationId: `${input.operationId}:collision-damage`,
        reasonCode: 'ability.aa080.missile-launch.damage',
        previous, current, changedFields: ['hp'],
        compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
      })
    }
    if (hp.temporaryHp !== undefined) {
      const projected = mapWithTemporaryHpForPlacement(input.context.map, targetId, hp.temporaryHp)
      changes.push({
        kind: 'map-temporary-hit-points',
        scope: { kind: 'map', mapSlug: input.context.map.slug },
        expectedRevision: normalizeRevision(input.context.map.revision),
        sourceOperationId: `${input.operationId}:collision-temporary-hp`,
        reasonCode: 'ability.aa080.missile-launch.temporary-hp',
        previous: deepCloneJson(input.context.map.temporaryHitPoints),
        current: deepCloneJson(projected.temporaryHitPoints),
        compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
      })
    }
  }
  return Object.freeze({
    plan: createMoveStateChangePlan(changes),
    presentationKey: result.feedback.hit
      ? 'ability.aa080.missile-launch.hit'
      : 'ability.aa080.missile-launch.missed',
    controllerPresentationValues: [entry.entityId, targetId],
  })
}

const mistySurge = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
}): Aa080ActivatedExecution => {
  const paid = paidEncounter({
    ...input, canonicalId: 'Misty Surge', action: 'swift', frequency: SCENE_X3_FREQUENCY,
  })
  const reduced = applyMapGlobalField({
    map: { ...input.context.map, encounterState: paid.encounter },
    kind: 'terrain', fieldId: 'misty',
    source: {
      kind: 'operation', operationId: input.operationId,
      moveId: 'ability.misty-surge', placementId: input.context.actor.placement.id,
    },
    sideId: input.context.actor.placement.sideId ?? null,
    duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
    replacementGroup: 'field.terrain.misty', replacementScope: 'kind', sourceLabel: 'Misty Surge',
  })
  const previousFields: MapFieldEffects = input.context.map.fieldEffects ?? { weather: [], terrains: [], rooms: [] }
  const currentFields: MapFieldEffects = reduced.map.fieldEffects ?? { weather: [], terrains: [], rooms: [] }
  const changes: MoveStateChangeInput[] = [encounterChange({
    ...input, current: reduced.map.encounterState,
    reasonCode: 'ability.aa080.misty-surge.field-applied',
  })]
  if (!sameJsonValue(previousFields, currentFields)) changes.push({
    kind: 'map-field-effects',
    scope: { kind: 'map', mapSlug: input.context.map.slug },
    expectedRevision: normalizeRevision(input.context.map.revision),
    sourceOperationId: `${input.operationId}:field-projection`,
    reasonCode: 'ability.aa080.misty-surge.field-projection',
    previous: deepCloneJson(previousFields), current: deepCloneJson(currentFields),
    compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  })
  return Object.freeze({
    plan: createMoveStateChangePlan(changes),
    presentationKey: 'ability.aa080.misty-surge.applied',
  })
}

export const executeAa080ActivatedMechanic = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operation: AbilityMechanicOperation
  readonly operationId: string
  readonly abilityInstanceId: string
  readonly choices: Parameters<typeof selectedValues>[0]
}): Aa080ActivatedExecution | null => {
  if (input.context.actor.token.currentHp <= 0) fail(`${input.context.runtime.canonicalId} cannot be activated while its user is Fainted.`)
  switch (input.operation.mechanicId) {
    case 'aa080.mini-noses':
      return input.context.request.modeId === 'deploy'
        ? deployEntities({ ...input, canonicalId: 'Mini-Noses', declarationId: 'deploy.cells', minimum: 1, maximum: AA080_MINI_NOSE_MAXIMUM, maximumHp: Math.max(1, input.context.actor.token.level) })
        : input.context.request.modeId === 'shift'
          ? shiftEntities({ ...input, canonicalId: 'Mini-Noses', declarationId: 'shift.cells' })
          : fail('Mini-Noses mode is unsupported.')
    case 'aa080.missile-launch':
      return input.context.request.modeId === 'deploy'
        ? deployEntities({ ...input, canonicalId: 'Missile Launch', declarationId: 'deploy.cells', minimum: AA080_DREEPY_MAXIMUM, maximum: AA080_DREEPY_MAXIMUM, maximumHp: 1 })
        : input.context.request.modeId === 'shift'
          ? shiftEntities({ ...input, canonicalId: 'Missile Launch', declarationId: 'shift.cells' })
          : input.context.request.modeId === 'collision'
            ? missileCollision(input)
            : fail('Missile Launch mode is unsupported.')
    case 'aa080.misty-surge':
      return mistySurge(input)
    default:
      return null
  }
}
