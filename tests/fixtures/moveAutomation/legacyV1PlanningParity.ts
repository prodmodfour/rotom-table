import type { ResolveMoveIntent } from '#shared/livePlayMoveResolution'
import type { CharacterSheet } from '~/types/characterSheet'
import type { MapFieldEffects, MapHazardV2, SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { cloneMapFieldEffects } from '~/utils/mapFieldEffects'
import { sameJsonValue } from '~/utils/serialization'
import {
  planAuthoritativeMoveState,
  type AuthoritativeMoveSheetWritePlan,
  type AuthoritativeMoveStatePlan,
} from '~~/server/domain/planAuthoritativeMoveState'
import type { MoveStateChangePlan } from '~~/server/domain/moveAutomation/plan'
import { createFiniteAuthoritativeMoveRandomStream } from '~~/server/domain/moveAutomation/random'

export interface LegacyV1PlanningFixture {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets?: ReadonlyMap<string, TrainerSheet>
  readonly intent: ResolveMoveIntent
  readonly randomValues?: readonly number[]
  readonly maxMoveLogEntries?: number
}

export interface LegacyV1PlanningState {
  readonly map: TabletopMap
  readonly pokemonSheets: readonly (readonly [string, CharacterSheet])[]
  readonly trainerSheets: readonly (readonly [string, TrainerSheet])[]
}

export interface LegacyV1PlanProjection {
  readonly previousMap: TabletopMap
  readonly nextMap: TabletopMap
  readonly sheetWrites: readonly AuthoritativeMoveSheetWritePlan[]
}

export interface AdaptedV1PlanProjection {
  readonly previousMap: TabletopMap
  readonly revision: number
  readonly plannedAt: number
  readonly stateChanges: MoveStateChangePlan
}

export interface LegacyV1ProjectionParityResult {
  readonly legacyState: LegacyV1PlanningState
  readonly adaptedState: LegacyV1PlanningState
  readonly normalizedLegacyState: unknown
  readonly normalizedAdaptedState: unknown
}

export interface LegacyV1PlanningParityResult extends LegacyV1ProjectionParityResult {
  readonly legacyPlan: AuthoritativeMoveStatePlan
  readonly adaptedPlan: AuthoritativeMoveStatePlan
  readonly normalizedLegacyEvidence: unknown
  readonly normalizedAdaptedEvidence: unknown
}

const LEGACY_PLANNED_AT = 1_900_000_000_101
const ADAPTED_PLANNED_AT = 1_900_000_000_202

const clone = <Value>(value: Value): Value => structuredClone(value)

const sortedSheetEntries = <Sheet extends CharacterSheet | TrainerSheet>(
  sheets: ReadonlyMap<string, Sheet>,
): Array<readonly [string, Sheet]> => [...sheets.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([slug, sheet]) => [slug, clone(sheet)] as const)

export const createLegacyV1PlanningState = (
  map: TabletopMap,
  pokemonSheets: ReadonlyMap<string, CharacterSheet>,
  trainerSheets: ReadonlyMap<string, TrainerSheet> = new Map<string, TrainerSheet>(),
): LegacyV1PlanningState => ({
  map: clone(map),
  pokemonSheets: sortedSheetEntries(pokemonSheets),
  trainerSheets: sortedSheetEntries(trainerSheets),
})

const mutableSheetMaps = (state: LegacyV1PlanningState): {
  readonly pokemon: Map<string, CharacterSheet>
  readonly trainer: Map<string, TrainerSheet>
} => ({
  pokemon: new Map(state.pokemonSheets.map(([slug, sheet]) => [slug, clone(sheet)])),
  trainer: new Map(state.trainerSheets.map(([slug, sheet]) => [slug, clone(sheet)])),
})

const failParity = (message: string): never => {
  throw new Error(`Legacy v1 planning parity fixture: ${message}`)
}

const assertSameValue = (label: string, actual: unknown, expected: unknown): void => {
  if (!sameJsonValue(actual, expected)) failParity(`${label} does not match the planned previous value.`)
}

const replaceOptionalMapValue = <Key extends 'temporaryHitPoints' | 'moveUsage' | 'metadata'>(
  map: TabletopMap,
  key: Key,
  value: TabletopMap[Key],
): void => {
  if (value === undefined) delete map[key]
  else map[key] = clone(value) as TabletopMap[Key]
}

const currentPlacement = (
  map: TabletopMap,
  placementId: string,
): SheetPlacement | null => map.placements.find(placement => placement.id === placementId) ?? null

const replacePlacement = (
  map: TabletopMap,
  placementId: string,
  current: SheetPlacement | null,
): void => {
  const index = map.placements.findIndex(placement => placement.id === placementId)
  if (current === null) {
    if (index >= 0) map.placements.splice(index, 1)
    return
  }
  if (index >= 0) map.placements.splice(index, 1, clone(current))
  else map.placements.push(clone(current))
}

const assertMapScope = (
  map: TabletopMap,
  mapSlug: string,
): void => {
  if (map.slug !== mapSlug) failParity(`state change for map ${mapSlug} was applied to ${map.slug}.`)
}

const applyAdaptedChanges = (
  state: LegacyV1PlanningState,
  projection: AdaptedV1PlanProjection,
): LegacyV1PlanningState => {
  assertSameValue('adapted previous map', state.map, projection.previousMap)
  const map = clone(state.map)
  const sheets = mutableSheetMaps(state)

  for (const [index, change] of projection.stateChanges.changes.entries()) {
    if (change.order !== index) failParity(`state change ${change.id} has non-canonical order ${change.order}.`)

    switch (change.kind) {
      case 'map-temporary-hit-points':
        assertMapScope(map, change.scope.mapSlug)
        assertSameValue(change.kind, map.temporaryHitPoints, change.previous)
        replaceOptionalMapValue(map, 'temporaryHitPoints', change.current)
        break
      case 'map-move-usage':
        assertMapScope(map, change.scope.mapSlug)
        assertSameValue(change.kind, map.moveUsage, change.previous)
        replaceOptionalMapValue(map, 'moveUsage', change.current)
        break
      case 'map-hazards':
        assertMapScope(map, change.scope.mapSlug)
        assertSameValue(change.kind, map.hazards ?? [], change.previous)
        map.hazards = clone(change.current) as MapHazardV2[]
        break
      case 'map-field-effects':
        assertMapScope(map, change.scope.mapSlug)
        assertSameValue(change.kind, cloneMapFieldEffects(map.fieldEffects), change.previous)
        map.fieldEffects = clone(change.current) as MapFieldEffects
        break
      case 'map-metadata':
        assertMapScope(map, change.scope.mapSlug)
        assertSameValue(change.kind, map.metadata, change.previous)
        replaceOptionalMapValue(map, 'metadata', change.current)
        break
      case 'placement-state': {
        assertMapScope(map, change.scope.mapSlug)
        const previous = currentPlacement(map, change.scope.placementId)
        assertSameValue(`${change.kind}:${change.scope.placementId}`, previous, change.previous)
        replacePlacement(map, change.scope.placementId, change.current)
        break
      }
      case 'sheet-state': {
        const sheetMap = change.scope.sheetKind === 'pokemon' ? sheets.pokemon : sheets.trainer
        const previous = sheetMap.get(change.scope.sheetSlug)
          ?? failParity(`sheet ${change.scope.sheetKind}/${change.scope.sheetSlug} is missing.`)
        assertSameValue(`${change.kind}:${change.scope.sheetSlug}`, previous, change.previous)
        if (change.scope.sheetKind === 'pokemon') {
          sheets.pokemon.set(change.scope.sheetSlug, clone(change.current) as CharacterSheet)
        }
        else {
          sheets.trainer.set(change.scope.sheetSlug, clone(change.current) as TrainerSheet)
        }
        break
      }
      case 'encounter-state':
      case 'group-inventory-state':
        failParity(`legacy v1 projection unexpectedly contains ${change.kind}.`)
    }
  }

  map.revision = projection.revision
  map.updatedAt = projection.plannedAt
  return createLegacyV1PlanningState(map, sheets.pokemon, sheets.trainer)
}

export const materializeLegacyV1PlanningState = (
  initial: LegacyV1PlanningState,
  projection: LegacyV1PlanProjection,
): LegacyV1PlanningState => {
  assertSameValue('legacy previous map', initial.map, projection.previousMap)
  const sheets = mutableSheetMaps(initial)

  for (const write of projection.sheetWrites) {
    const sheetMap = write.kind === 'pokemon' ? sheets.pokemon : sheets.trainer
    const previous = sheetMap.get(write.slug)
      ?? failParity(`legacy sheet ${write.kind}/${write.slug} is missing.`)
    assertSameValue(`legacy sheet ${write.kind}/${write.slug}`, previous, write.previousSheet)
    if (write.kind === 'pokemon') sheets.pokemon.set(write.slug, clone(write.nextSheet) as CharacterSheet)
    else sheets.trainer.set(write.slug, clone(write.nextSheet) as TrainerSheet)
  }

  return createLegacyV1PlanningState(projection.nextMap, sheets.pokemon, sheets.trainer)
}

export const materializeAdaptedV1PlanningState = (
  initial: LegacyV1PlanningState,
  projection: AdaptedV1PlanProjection,
): LegacyV1PlanningState => applyAdaptedChanges(initial, projection)

const GENERATED_ID_PATTERN = /^(?:legacy|adapted)-generated-id-(\d+)$/
const GENERATED_TIMESTAMP_KEYS = new Set(['at', 'updatedAt'])

export const normalizeLegacyV1PlanningValue = (
  value: unknown,
  plannedAt: number,
  key = '',
): unknown => {
  if (typeof value === 'number' && value === plannedAt && GENERATED_TIMESTAMP_KEYS.has(key)) {
    return '<planned-at>'
  }
  if (typeof value === 'string' && key === 'id') {
    const generated = GENERATED_ID_PATTERN.exec(value)
    if (generated) return `<generated-id-${generated[1]}>`
  }
  if (Array.isArray(value)) {
    return value.map(entry => normalizeLegacyV1PlanningValue(entry, plannedAt))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entry]) => [
      entryKey,
      normalizeLegacyV1PlanningValue(entry, plannedAt, entryKey),
    ]))
  }
  return value
}

export const runLegacyV1ProjectionParity = (options: {
  readonly initial: LegacyV1PlanningState
  readonly legacy: LegacyV1PlanProjection
  readonly adapted: AdaptedV1PlanProjection
  readonly legacyPlannedAt: number
}): LegacyV1ProjectionParityResult => {
  const legacyState = materializeLegacyV1PlanningState(clone(options.initial), options.legacy)
  const adaptedState = materializeAdaptedV1PlanningState(clone(options.initial), options.adapted)
  return {
    legacyState,
    adaptedState,
    normalizedLegacyState: normalizeLegacyV1PlanningValue(legacyState, options.legacyPlannedAt),
    normalizedAdaptedState: normalizeLegacyV1PlanningValue(adaptedState, options.adapted.plannedAt),
  }
}

const planningEvidence = (plan: AuthoritativeMoveStatePlan): unknown => ({
  resolution: plan.resolution,
  previousUsage: plan.previousUsage,
  usage: plan.usage,
  sheetReads: plan.sheetReads,
})

const runPlan = (
  fixture: LegacyV1PlanningFixture,
  variant: 'legacy' | 'adapted',
  plannedAt: number,
): {
  readonly initial: LegacyV1PlanningState
  readonly plan: AuthoritativeMoveStatePlan
} => {
  const map = clone(fixture.map)
  const pokemonSheets = new Map(sortedSheetEntries(fixture.pokemonSheets))
  const trainerSheets = new Map(sortedSheetEntries(
    fixture.trainerSheets ?? new Map<string, TrainerSheet>(),
  ))
  const initial = createLegacyV1PlanningState(map, pokemonSheets, trainerSheets)
  let idSequence = 0
  const plan = planAuthoritativeMoveState({
    map,
    pokemonSheets,
    trainerSheets,
    intent: clone(fixture.intent),
    random: createFiniteAuthoritativeMoveRandomStream(fixture.randomValues ?? []),
    now: () => plannedAt,
    idFactory: () => `${variant}-generated-id-${++idSequence}`,
    ...(fixture.maxMoveLogEntries === undefined
      ? {}
      : { maxMoveLogEntries: fixture.maxMoveLogEntries }),
  })

  assertSameValue(`${variant} planner input`, createLegacyV1PlanningState(map, pokemonSheets, trainerSheets), initial)
  return { initial, plan }
}

export const runLegacyV1PlanningParity = (
  fixture: LegacyV1PlanningFixture,
): LegacyV1PlanningParityResult => {
  const sourceBefore = createLegacyV1PlanningState(
    fixture.map,
    fixture.pokemonSheets,
    fixture.trainerSheets,
  )
  const legacy = runPlan(fixture, 'legacy', LEGACY_PLANNED_AT)
  const adapted = runPlan(fixture, 'adapted', ADAPTED_PLANNED_AT)
  assertSameValue(
    'source fixture',
    createLegacyV1PlanningState(fixture.map, fixture.pokemonSheets, fixture.trainerSheets),
    sourceBefore,
  )

  const projected = runLegacyV1ProjectionParity({
    initial: sourceBefore,
    legacy: legacy.plan,
    adapted: {
      previousMap: adapted.plan.previousMap,
      revision: adapted.plan.revision,
      plannedAt: ADAPTED_PLANNED_AT,
      stateChanges: adapted.plan.stateChanges,
    },
    legacyPlannedAt: LEGACY_PLANNED_AT,
  })

  return {
    ...projected,
    legacyPlan: legacy.plan,
    adaptedPlan: adapted.plan,
    normalizedLegacyEvidence: normalizeLegacyV1PlanningValue(
      planningEvidence(legacy.plan),
      LEGACY_PLANNED_AT,
    ),
    normalizedAdaptedEvidence: normalizeLegacyV1PlanningValue(
      planningEvidence(adapted.plan),
      ADAPTED_PLANNED_AT,
    ),
  }
}
