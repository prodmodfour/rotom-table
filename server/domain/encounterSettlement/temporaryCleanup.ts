import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  parseEncounterSettlementDocument,
  type EncounterSettlementAuthorityRef,
  type EncounterSettlementCleanupEntry,
  type EncounterSettlementCleanupKind,
  type EncounterSettlementDocument,
} from '#shared/encounterSettlement/document'
import {
  parseEncounterState,
  type EncounterState,
} from '#shared/moveAutomation/encounterState'
import {
  parseEncounterEffect,
  type EncounterEffect,
} from '#shared/moveAutomation/encounterEffects'
import {
  parseEncounterZone,
  type EncounterZone,
} from '#shared/moveAutomation/encounterZones'
import {
  parseMapGroundItem,
  type MapGroundItem,
} from '#shared/moveAutomation/groundItems'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetKind, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { deepCloneJson } from '~/utils/serialization'
import {
  materializeMapGlobalFieldZones,
  projectGlobalFieldZonesToMapEffects,
} from '../moveAutomation/fieldMapState'
import { createEncounterEndLifecycleEvent } from '../moveAutomation/durationLifecycle'
import {
  planEncounterLifecycle,
  type EncounterLifecyclePlan,
  type EncounterLifecycleSheetWrite,
} from '../moveAutomation/planInitiativeLifecycle'

export const ENCOUNTER_SETTLEMENT_CLEANUP_SOURCE_IDS = Object.freeze({
  encounterResources: 'map:encounter-resources',
  initiative: 'map:initiative',
  encounterItems: 'map:encounter-items',
} as const)

export type EncounterSettlementCleanupAction =
  | 'reset'
  | 'expire'
  | 'preserve'
  | 'transform'
  | 'exclude'

export type EncounterSettlementCleanupPreviewAction =
  | EncounterSettlementCleanupAction
  | 'pending'

export interface EncounterSettlementCleanupSheetAuthority {
  readonly kind: SheetKind
  readonly slug: string
  readonly revision: number
  readonly document: CharacterSheet | TrainerSheet
}

export interface EncounterSettlementCleanupAuthorization {
  readonly status: 'allowed' | 'denied'
  readonly authority: EncounterSettlementAuthorityRef
  readonly reasonId: string | null
}

export type EncounterSettlementCleanupTransformation =
  | {
      readonly cleanupId: string
      readonly sourceId: string
      readonly kind: 'effect'
      readonly authority: EncounterSettlementAuthorityRef
      readonly nextEffect: EncounterEffect
    }
  | {
      readonly cleanupId: string
      readonly sourceId: string
      readonly kind: 'zone'
      readonly authority: EncounterSettlementAuthorityRef
      readonly nextZone: EncounterZone
    }
  | {
      readonly cleanupId: string
      readonly sourceId: string
      readonly kind: 'ground-item'
      readonly authority: EncounterSettlementAuthorityRef
      readonly nextGroundItem: MapGroundItem
    }

export interface EncounterSettlementCleanupAuthoritySnapshot {
  readonly completeness: 'authoritative-current'
  readonly map: TabletopMap
  readonly sheetsComplete: true
  readonly sheets: readonly EncounterSettlementCleanupSheetAuthority[]
  /** Reservations are derived from pending operation records; active entries block rather than being silently abandoned. */
  readonly activeReservationOperationIds: readonly string[]
  readonly transformationsComplete: true
  readonly transformations: readonly EncounterSettlementCleanupTransformation[]
  readonly authorization: EncounterSettlementCleanupAuthorization
  readonly writeTimestamp: number
}

export type EncounterSettlementCleanupSourceKind =
  | 'effect'
  | 'zone'
  | 'ground-item'
  | 'combat-stage-sheet'
  | 'encounter-resources'
  | 'initiative'
  | 'reservation'
  | 'encounter-item'

export interface EncounterSettlementCleanupPreviewEntry {
  readonly cleanupId: string
  readonly cleanupKind: EncounterSettlementCleanupKind
  readonly sourceId: string
  readonly sourceKind: EncounterSettlementCleanupSourceKind
  readonly action: EncounterSettlementCleanupPreviewAction
  readonly resultCode: string
  readonly changed: boolean
}

export interface EncounterSettlementCleanupBlocker {
  readonly kind: 'open-decision' | 'active-reservation' | 'pending-encounter-item' | 'authorization-denied'
  readonly cleanupId: string | null
  readonly sourceId: string | null
  readonly reasonId: string | null
}

export interface EncounterSettlementCleanupMapWrite {
  readonly mapSlug: string
  readonly expectedRevision: number
  readonly revision: number
  readonly beforeDefinitionSha256: string
  readonly afterDefinitionSha256: string
  readonly nextMap: TabletopMap
}

export interface EncounterSettlementCleanupSheetWrite extends EncounterLifecycleSheetWrite {
  readonly beforeDefinitionSha256: string
  readonly afterDefinitionSha256: string
}

export interface EncounterSettlementCleanupPlan {
  readonly complete: boolean
  readonly authorityDefinitionSha256: string
  readonly document: EncounterSettlementDocument
  readonly previews: readonly EncounterSettlementCleanupPreviewEntry[]
  readonly blockers: readonly EncounterSettlementCleanupBlocker[]
  readonly mapWrite: EncounterSettlementCleanupMapWrite | null
  readonly sheetWrites: readonly EncounterSettlementCleanupSheetWrite[]
  readonly lifecycle: EncounterLifecyclePlan | null
}

export interface EncounterSettlementCleanupApplicableWrites {
  readonly mapWrite: EncounterSettlementCleanupMapWrite | null
  readonly sheetWrites: readonly EncounterSettlementCleanupSheetWrite[]
}

export type EncounterSettlementCleanupErrorCode =
  | 'incomplete-authority'
  | 'invalid-map-authority'
  | 'invalid-sheet-authority'
  | 'invalid-cleanup-source'
  | 'duplicate-cleanup-source'
  | 'incomplete-cleanup-coverage'
  | 'invalid-cleanup-action'
  | 'invalid-cleanup-transformation'
  | 'stale-cleanup-entry'
  | 'terminal-cleanup-state'
  | 'stale-cleanup-plan'

export class EncounterSettlementCleanupError extends Error {
  constructor(
    readonly code: EncounterSettlementCleanupErrorCode,
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`)
    this.name = 'EncounterSettlementCleanupError'
  }
}

interface ResolvedSource {
  readonly sourceId: string
  readonly sourceKind: EncounterSettlementCleanupSourceKind
  readonly effect?: EncounterEffect
  readonly zone?: EncounterZone
  readonly groundItem?: MapGroundItem
  readonly sheet?: EncounterSettlementCleanupSheetAuthority
}

interface PlannedSourceAction {
  readonly entry: EncounterSettlementCleanupEntry
  readonly source: ResolvedSource
  readonly action: EncounterSettlementCleanupAction | null
  readonly transformation: EncounterSettlementCleanupTransformation | null
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/
const ACTIONS = new Set<EncounterSettlementCleanupAction>([
  'reset', 'expire', 'preserve', 'transform', 'exclude',
])
const SHEET_SOURCE_PREFIX = 'sheet:'
const MAX_AUTHORITY_ROWS = 4_096

const fail = (
  code: EncounterSettlementCleanupErrorCode,
  path: string,
  message: string,
): never => {
  throw new EncounterSettlementCleanupError(code, path, message)
}

const isId = (value: unknown): value is string => typeof value === 'string' && ID.test(value)
const nonNegativeInteger = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const jsonValue = <Value>(value: Value, path: string): Value => {
  try {
    return JSON.parse(JSON.stringify(value)) as Value
  }
  catch {
    return fail('incomplete-authority', path, 'must be JSON-serializable authority.')
  }
}
const hashJson = (value: unknown, path: string): string => createHash('sha256')
  .update(stableJsonStringify(jsonValue(value, path), {
    path,
    limits: {
      maxDepth: 64,
      maxNodes: 1_000_000,
      maxObjectFields: 20_000,
      maxArrayEntries: 100_000,
      maxStringLength: 200_000,
    },
  }))
  .digest('hex')

const authorityKey = (authority: EncounterSettlementAuthorityRef): string => (
  `${authority.kind}\u0000${authority.id}\u0000${authority.revision}`
)
const sheetKey = (kind: SheetKind, slug: string): string => `${kind}\u0000${slug}`
const sheetSourceId = (kind: SheetKind, slug: string): string => `${SHEET_SOURCE_PREFIX}${kind}:${slug}`
const transformationKey = (cleanupId: string, sourceId: string): string => `${cleanupId}\u0000${sourceId}`

const authorityEvidence = (authority: EncounterSettlementCleanupAuthoritySnapshot): string => hashJson({
  completeness: authority.completeness,
  map: authority.map,
  sheetsComplete: authority.sheetsComplete,
  sheets: [...authority.sheets].sort((left, right) => sheetKey(left.kind, left.slug).localeCompare(sheetKey(right.kind, right.slug))),
  activeReservationOperationIds: [...authority.activeReservationOperationIds].sort(),
  transformationsComplete: authority.transformationsComplete,
  transformations: [...authority.transformations].sort((left, right) => (
    transformationKey(left.cleanupId, left.sourceId).localeCompare(transformationKey(right.cleanupId, right.sourceId))
  )),
  authorization: authority.authorization,
  writeTimestamp: authority.writeTimestamp,
}, 'cleanupAuthority')

const mapRevision = (map: TabletopMap): number => nonNegativeInteger(map.revision) ? map.revision : 0

const validateAuthority = (
  settlement: EncounterSettlementDocument,
  authority: EncounterSettlementCleanupAuthoritySnapshot,
): {
  readonly map: TabletopMap
  readonly state: EncounterState
  readonly sheets: ReadonlyMap<string, EncounterSettlementCleanupSheetAuthority>
  readonly transformations: ReadonlyMap<string, EncounterSettlementCleanupTransformation>
} => {
  if (!authority || authority.completeness !== 'authoritative-current'
    || authority.sheetsComplete !== true || authority.transformationsComplete !== true
    || !Array.isArray(authority.sheets) || !Array.isArray(authority.transformations)
    || !Array.isArray(authority.activeReservationOperationIds)) {
    return fail('incomplete-authority', 'authority', 'must contain one complete current cleanup authority read.')
  }
  if (authority.sheets.length > MAX_AUTHORITY_ROWS || authority.transformations.length > MAX_AUTHORITY_ROWS
    || authority.activeReservationOperationIds.length > MAX_AUTHORITY_ROWS) {
    fail('incomplete-authority', 'authority', `cannot exceed ${MAX_AUTHORITY_ROWS} rows per cleanup authority list.`)
  }
  const map = deepCloneJson(authority.map)
  const revision = mapRevision(map)
  if (!map || map.slug !== settlement.encounter.linkedMapSlug
    || revision !== settlement.encounter.linkedMapRevision
    || revision >= Number.MAX_SAFE_INTEGER
    || !nonNegativeInteger(authority.writeTimestamp)
    || (nonNegativeInteger(map.updatedAt) && authority.writeTimestamp < Number(map.updatedAt))) {
    fail('invalid-map-authority', 'authority.map', 'must be the exact current linked writable map revision and monotonic timestamp.')
  }
  const state: EncounterState = (() => {
    try {
      return materializeMapGlobalFieldZones(map)
    }
    catch (error) {
      return fail('invalid-map-authority', 'authority.map.encounterState', error instanceof Error ? error.message : 'is malformed.')
    }
  })()

  const sheets = new Map<string, EncounterSettlementCleanupSheetAuthority>()
  authority.sheets.forEach((row, index) => {
    const path = `authority.sheets[${index}]`
    if (!row || (row.kind !== 'pokemon' && row.kind !== 'trainer') || !isId(row.slug)
      || !nonNegativeInteger(row.revision) || !row.document || typeof row.document !== 'object'
      || String((row.document as { slug?: unknown }).slug ?? row.slug) !== row.slug
      || Number((row.document as { revision?: unknown }).revision ?? row.revision) !== row.revision) {
      fail('invalid-sheet-authority', path, 'must be one exact current Pokémon or Trainer sheet document and revision.')
    }
    const key = sheetKey(row.kind, row.slug)
    if (sheets.has(key)) fail('invalid-sheet-authority', path, 'duplicates one sheet authority.')
    sheets.set(key, Object.freeze({
      kind: row.kind,
      slug: row.slug,
      revision: row.revision,
      document: deepCloneJson(row.document),
    }))
  })
  map.placements.forEach((placement, index) => {
    if (!sheets.has(sheetKey(placement.sheetKind, placement.sheetSlug))) {
      fail('invalid-sheet-authority', `authority.map.placements[${index}]`, 'has no exact backing sheet authority for cleanup.')
    }
  })

  const reservations = authority.activeReservationOperationIds
  if (reservations.some(id => !isId(id)) || new Set(reservations).size !== reservations.length) {
    fail('incomplete-authority', 'authority.activeReservationOperationIds', 'must contain unique stable pending operation identities.')
  }

  const transformations = new Map<string, EncounterSettlementCleanupTransformation>()
  authority.transformations.forEach((raw, index) => {
    const path = `authority.transformations[${index}]`
    if (!raw || !isId(raw.cleanupId) || !isId(raw.sourceId)
      || !['effect', 'zone', 'ground-item'].includes(raw.kind)
      || !raw.authority || !isId(raw.authority.id) || !nonNegativeInteger(raw.authority.revision)) {
      fail('invalid-cleanup-transformation', path, 'must be one exact authority-bound cleanup transformation.')
    }
    const parsed: EncounterSettlementCleanupTransformation = (() => {
      try {
        return raw.kind === 'effect'
          ? { ...raw, nextEffect: parseEncounterEffect(raw.nextEffect, `${path}.nextEffect`) }
          : raw.kind === 'zone'
            ? { ...raw, nextZone: parseEncounterZone(raw.nextZone, `${path}.nextZone`) }
            : { ...raw, nextGroundItem: parseMapGroundItem(raw.nextGroundItem, `${path}.nextGroundItem`) }
      }
      catch (error) {
        return fail('invalid-cleanup-transformation', path, error instanceof Error ? error.message : 'contains malformed transformed state.')
      }
    })()
    const key = transformationKey(parsed.cleanupId, parsed.sourceId)
    if (transformations.has(key)) fail('invalid-cleanup-transformation', path, 'duplicates one cleanup source transformation.')
    transformations.set(key, Object.freeze(parsed))
  })

  const authorization = authority.authorization
  if (!authorization || !['allowed', 'denied'].includes(authorization.status)
    || authorization.authority?.kind !== 'map'
    || authorization.authority.id !== map.slug
    || authorization.authority.revision !== revision
    || (authorization.status === 'denied') !== (authorization.reasonId !== null)
    || (authorization.reasonId !== null && !isId(authorization.reasonId))) {
    fail('invalid-map-authority', 'authority.authorization', 'must be one exact GM cleanup authorization for the current map revision.')
  }
  return { map, state, sheets, transformations }
}

const actionFromEntry = (
  settlement: EncounterSettlementDocument,
  entry: EncounterSettlementCleanupEntry,
): EncounterSettlementCleanupAction | null => {
  if (entry.state === 'applied' || entry.receiptId !== null) {
    return fail('stale-cleanup-entry', entry.cleanupId, 'applied cleanup evidence cannot be replanned outside terminal replay.')
  }
  if (entry.state === 'excluded') return 'exclude'
  if (entry.state === 'proposed') return null
  if (entry.behavior !== 'require-decision') return entry.behavior
  if (!entry.decisionId) return fail('invalid-cleanup-action', entry.cleanupId, 'requires one bounded cleanup decision.')
  const decision = settlement.decisions.find(row => row.decisionId === entry.decisionId)
  if (!decision || decision.kind !== 'cleanup'
    || !decision.subjects.some(subject => subject.kind === 'cleanup' && subject.id === entry.cleanupId)) {
    return fail('invalid-cleanup-action', entry.cleanupId, 'does not resolve through its exact bounded cleanup decision.')
  }
  if (decision.status !== 'accepted' || !decision.selectedOptionId) return null
  const selected = decision.options.find(option => option.optionId === decision.selectedOptionId)
  if (!selected) return fail('invalid-cleanup-action', entry.cleanupId, 'selected cleanup option is absent from the accepted offer.')
  if (selected.effect === 'exclude') return 'exclude'
  if (selected.effect === 'transform') return 'transform'
  if ((selected.effect === 'accept' || selected.effect === 'waive')
    && selected.valueId && ACTIONS.has(selected.valueId as EncounterSettlementCleanupAction)
    && selected.valueId !== 'exclude') {
    return selected.valueId as EncounterSettlementCleanupAction
  }
  return fail('invalid-cleanup-action', entry.cleanupId, 'selected option must declare reset, expire, preserve, transform, or exclusion semantics.')
}

const sourceAllowedForKind = (
  kind: EncounterSettlementCleanupKind,
  sourceKind: EncounterSettlementCleanupSourceKind,
): boolean => {
  if (kind === 'combat-stages') return sourceKind === 'combat-stage-sheet'
  if (kind === 'temporary-effects') return sourceKind === 'effect'
  if (kind === 'encounter-resources') return sourceKind === 'encounter-resources'
  if (kind === 'reservations') return sourceKind === 'reservation'
  if (kind === 'zones') return sourceKind === 'zone'
  if (kind === 'ground-items') return sourceKind === 'ground-item'
  if (kind === 'duration-effects') return sourceKind === 'effect' || sourceKind === 'zone'
  if (kind === 'encounter-items') {
    return sourceKind === 'effect' || sourceKind === 'ground-item' || sourceKind === 'encounter-item'
  }
  return sourceKind === 'initiative'
}

const isEncounterExpiringDuration = (duration: { readonly kind: string }): boolean => (
  duration.kind === 'turns' || duration.kind === 'rounds' || duration.kind === 'encounter'
)

const expectedSourceDirectory = (input: {
  readonly map: TabletopMap
  readonly state: EncounterState
  readonly sheets: ReadonlyMap<string, EncounterSettlementCleanupSheetAuthority>
  readonly activeReservationOperationIds: readonly string[]
}): ReadonlyMap<string, ResolvedSource> => {
  const directory = new Map<string, ResolvedSource>()
  const add = (source: ResolvedSource): void => {
    if (directory.has(source.sourceId)) {
      fail('invalid-cleanup-source', source.sourceId, 'is ambiguous across authoritative cleanup source kinds.')
    }
    directory.set(source.sourceId, Object.freeze(source))
  }
  for (const effect of input.state.effects) add({ sourceId: effect.id, sourceKind: 'effect', effect })
  for (const zone of input.state.zones) add({ sourceId: zone.id, sourceKind: 'zone', zone })
  for (const groundItem of input.state.groundItems) add({ sourceId: groundItem.id, sourceKind: 'ground-item', groundItem })
  for (const sheet of input.sheets.values()) {
    add({ sourceId: sheetSourceId(sheet.kind, sheet.slug), sourceKind: 'combat-stage-sheet', sheet })
  }
  add({ sourceId: ENCOUNTER_SETTLEMENT_CLEANUP_SOURCE_IDS.encounterResources, sourceKind: 'encounter-resources' })
  if (input.map.initiative !== undefined) {
    add({ sourceId: ENCOUNTER_SETTLEMENT_CLEANUP_SOURCE_IDS.initiative, sourceKind: 'initiative' })
  }
  for (const operationId of input.activeReservationOperationIds) {
    add({ sourceId: operationId, sourceKind: 'reservation' })
  }
  const pendingItems = input.state.itemExploration?.repelPositioning ?? []
  if (pendingItems.length > 0) {
    add({ sourceId: ENCOUNTER_SETTLEMENT_CLEANUP_SOURCE_IDS.encounterItems, sourceKind: 'encounter-item' })
  }
  return directory
}

const assertEntryAuthority = (
  entry: EncounterSettlementCleanupEntry,
  source: ResolvedSource,
  map: TabletopMap,
): void => {
  const revision = mapRevision(map)
  if (source.sheet && entry.authority.kind === 'sheet') {
    if (entry.authority.id !== source.sheet.slug || entry.authority.revision !== source.sheet.revision) {
      fail('invalid-cleanup-source', entry.cleanupId, 'sheet cleanup authority does not match its exact source revision.')
    }
    return
  }
  if (entry.authority.revision !== revision) {
    fail('invalid-cleanup-source', entry.cleanupId, 'map-owned cleanup authority is stale for the linked map revision.')
  }
}

const transformationFor = (input: {
  readonly entry: EncounterSettlementCleanupEntry
  readonly source: ResolvedSource
  readonly action: EncounterSettlementCleanupAction | null
  readonly transformations: ReadonlyMap<string, EncounterSettlementCleanupTransformation>
  readonly settlement: EncounterSettlementDocument
}): EncounterSettlementCleanupTransformation | null => {
  const key = transformationKey(input.entry.cleanupId, input.source.sourceId)
  const transform = input.transformations.get(key) ?? null
  if (input.action !== 'transform') {
    if (transform) fail('invalid-cleanup-transformation', key, 'exists for a cleanup action that is not transform.')
    return null
  }
  if (!transform) return fail('invalid-cleanup-transformation', key, 'is required by transform cleanup behavior.')
  if (input.source.sourceKind !== transform.kind) {
    fail('invalid-cleanup-transformation', key, 'must retain the exact effect, zone, or ground-item source kind.')
  }
  const nextId = transform.kind === 'effect' ? transform.nextEffect.id
    : transform.kind === 'zone' ? transform.nextZone.id : transform.nextGroundItem.id
  if (nextId !== input.source.sourceId) {
    fail('invalid-cleanup-transformation', key, 'must retain the exact stable source identity.')
  }
  if (input.entry.behavior === 'require-decision' && input.entry.decisionId) {
    const decision = input.settlement.decisions.find(row => row.decisionId === input.entry.decisionId)
    const selected = decision?.options.find(option => option.optionId === decision.selectedOptionId)
    if (selected?.authority === null || authorityKey(selected!.authority!) !== authorityKey(transform.authority)) {
      fail('invalid-cleanup-transformation', key, 'must match the authority pinned by the accepted transform option.')
    }
  }
  return transform
}

const assertActionMatchesSource = (planned: PlannedSourceAction): void => {
  const { action, entry, source } = planned
  if (action === null || action === 'exclude') return
  if (source.sourceKind === 'combat-stage-sheet' && action !== 'reset') {
    fail('invalid-cleanup-action', entry.cleanupId, 'combat stages can only reset at encounter end.')
  }
  if (source.sourceKind === 'encounter-resources' && action !== 'reset') {
    fail('invalid-cleanup-action', entry.cleanupId, 'encounter resources can only reset at encounter end.')
  }
  if (source.sourceKind === 'initiative' && action !== 'reset') {
    fail('invalid-cleanup-action', entry.cleanupId, 'initiative can only reset at encounter end.')
  }
  if (source.sourceKind === 'reservation' && action !== 'expire') {
    fail('invalid-cleanup-action', entry.cleanupId, 'an active encounter reservation can only expire through its owning operation lifecycle.')
  }
  if (source.sourceKind === 'encounter-item') {
    fail('invalid-cleanup-action', entry.cleanupId, 'pending encounter-item decisions must resolve before cleanup rather than being silently removed.')
  }
  if ((source.sourceKind === 'effect' || source.sourceKind === 'zone')
    && action === 'preserve'
    && isEncounterExpiringDuration((source.effect ?? source.zone)!.duration)) {
    fail('invalid-cleanup-action', entry.cleanupId, 'turn, round, and encounter duration authority cannot be preserved after encounter end.')
  }
  if ((source.sourceKind === 'effect' || source.sourceKind === 'zone' || source.sourceKind === 'ground-item')
    && action === 'reset') {
    fail('invalid-cleanup-action', entry.cleanupId, 'this exact source requires preserve, expire, or authority-backed transform semantics.')
  }
}

const resultCodeFor = (planned: PlannedSourceAction): string => (
  `cleanup.${planned.entry.kind}.${planned.action ?? 'pending'}.${planned.source.sourceKind}`
)

const changedByAction = (planned: PlannedSourceAction, lifecycle: EncounterLifecyclePlan): boolean => {
  const { action, source } = planned
  if (action === null || action === 'exclude' || action === 'preserve') return false
  if (source.sourceKind === 'combat-stage-sheet') {
    return lifecycle.sheetWrites.some(write => write.kind === source.sheet!.kind && write.slug === source.sheet!.slug)
  }
  if (source.sourceKind === 'encounter-resources') {
    return JSON.stringify(lifecycle.previousEncounterState.turnResources) !== JSON.stringify(lifecycle.currentEncounterState.turnResources)
      || JSON.stringify(lifecycle.previousEncounterState.history) !== JSON.stringify(lifecycle.currentEncounterState.history)
      || lifecycle.previousEncounterState.pendingResolutionSummaries.length > 0
  }
  if (source.sourceKind === 'initiative') return true
  return action === 'expire' || action === 'transform'
}

const reconcileCollection = <Value extends { readonly id: string }>(input: {
  readonly original: readonly Value[]
  readonly lifecycle?: readonly Value[]
  readonly actions: ReadonlyMap<string, PlannedSourceAction>
  readonly transformed: (planned: PlannedSourceAction) => Value
}): readonly Value[] => {
  const lifecycleById = new Map((input.lifecycle ?? input.original).map(row => [row.id, row]))
  const result: Value[] = []
  const originalIds = new Set(input.original.map(row => row.id))
  for (const original of input.original) {
    const planned = input.actions.get(original.id)
      ?? fail('incomplete-cleanup-coverage', original.id, 'has no deterministic cleanup action.')
    if (planned.action === 'expire' || planned.action === 'exclude') continue
    if (planned.action === 'transform') result.push(input.transformed(planned))
    else result.push(lifecycleById.get(original.id) ?? original)
  }
  for (const row of lifecycleById.values()) if (!originalIds.has(row.id)) result.push(row)
  return result
}

const cleanupOperationId = (settlement: EncounterSettlementDocument, map: TabletopMap): string => (
  `settlement-cleanup:v1:${createHash('sha256')
    .update(settlement.settlementId).update('\u0000').update(map.slug)
    .update('\u0000').update(String(mapRevision(map))).digest('hex').slice(0, 32)}`
)

const cleanupLifecycle = (input: {
  readonly settlement: EncounterSettlementDocument
  readonly map: TabletopMap
  readonly sheets: ReadonlyMap<string, EncounterSettlementCleanupSheetAuthority>
  readonly writeTimestamp: number
}): EncounterLifecyclePlan => planEncounterLifecycle({
  map: input.map,
  events: [createEncounterEndLifecycleEvent({
    mapSlug: input.map.slug,
    operationId: cleanupOperationId(input.settlement, input.map),
    reason: 'completed',
  })],
  time: input.writeTimestamp,
  loadSheets: () => ({
    pokemonSheets: new Map([...input.sheets.values()].flatMap(row => (
      row.kind === 'pokemon' ? [[row.slug, row.document as CharacterSheet] as const] : []
    ))),
    trainerSheets: new Map([...input.sheets.values()].flatMap(row => (
      row.kind === 'trainer' ? [[row.slug, row.document as TrainerSheet] as const] : []
    ))),
  }),
})

const lifecycleSheetWrites = (
  writes: readonly EncounterLifecycleSheetWrite[],
): readonly EncounterSettlementCleanupSheetWrite[] => Object.freeze(writes.map(write => Object.freeze({
  ...deepCloneJson(write),
  beforeDefinitionSha256: hashJson(write.previousSheet, `cleanupSheetBefore.${write.kind}.${write.slug}`),
  afterDefinitionSha256: hashJson(write.nextSheet, `cleanupSheetAfter.${write.kind}.${write.slug}`),
})))

export const planEncounterSettlementTemporaryCleanup = (input: {
  readonly settlement: unknown
  readonly authority: EncounterSettlementCleanupAuthoritySnapshot
}): EncounterSettlementCleanupPlan => {
  const settlement = parseEncounterSettlementDocument(input.settlement)
  if (settlement.status === 'committing' || settlement.status === 'completed' || settlement.status === 'cancelled'
    || settlement.completion.state !== 'open') {
    return fail('terminal-cleanup-state', 'settlement', 'cannot re-plan temporary cleanup after settlement commit has begun.')
  }
  const validated = validateAuthority(settlement, input.authority)
  const sources = expectedSourceDirectory({
    map: validated.map,
    state: validated.state,
    sheets: validated.sheets,
    activeReservationOperationIds: input.authority.activeReservationOperationIds,
  })
  const transformations = validated.transformations
  const seenSources = new Set<string>()
  const planned: PlannedSourceAction[] = []
  const blockers: EncounterSettlementCleanupBlocker[] = []

  for (const [entryIndex, entry] of settlement.temporaryCleanup.entries()) {
    for (const [sourceIndex, sourceId] of entry.sourceIds.entries()) {
      const path = `settlement.temporaryCleanup[${entryIndex}].sourceIds[${sourceIndex}]`
      if (seenSources.has(sourceId)) fail('duplicate-cleanup-source', path, 'must be owned by exactly one cleanup entry.')
      seenSources.add(sourceId)
      const source = sources.get(sourceId)
        ?? fail('invalid-cleanup-source', path, 'does not resolve to one authoritative cleanup source.')
      if (!sourceAllowedForKind(entry.kind, source.sourceKind)) {
        fail('invalid-cleanup-source', path, 'does not resolve to the exact authoritative source kind declared by this cleanup entry.')
      }
      assertEntryAuthority(entry, source, validated.map)
      const action = actionFromEntry(settlement, entry)
      const transformation = transformationFor({
        entry, source, action, transformations, settlement,
      })
      const row = Object.freeze({ entry, source, action, transformation })
      assertActionMatchesSource(row)
      planned.push(row)
      if (action === null) blockers.push(Object.freeze({
        kind: 'open-decision', cleanupId: entry.cleanupId, sourceId, reasonId: null,
      }))
      if (source.sourceKind === 'reservation') blockers.push(Object.freeze({
        kind: 'active-reservation', cleanupId: entry.cleanupId, sourceId, reasonId: null,
      }))
      if (source.sourceKind === 'encounter-item') blockers.push(Object.freeze({
        kind: 'pending-encounter-item', cleanupId: entry.cleanupId, sourceId, reasonId: null,
      }))
    }
  }
  for (const sourceId of sources.keys()) {
    if (!seenSources.has(sourceId)) {
      fail('incomplete-cleanup-coverage', sourceId, 'must appear exactly once in the complete temporary-cleanup snapshot.')
    }
  }
  for (const key of transformations.keys()) {
    if (!planned.some(row => transformationKey(row.entry.cleanupId, row.source.sourceId) === key)) {
      fail('invalid-cleanup-transformation', key, 'does not belong to one current cleanup source.')
    }
  }
  if (input.authority.authorization.status === 'denied') blockers.push(Object.freeze({
    kind: 'authorization-denied', cleanupId: null, sourceId: null,
    reasonId: input.authority.authorization.reasonId,
  }))
  blockers.sort((left, right) => (
    `${left.kind}:${left.cleanupId ?? ''}:${left.sourceId ?? ''}`
      .localeCompare(`${right.kind}:${right.cleanupId ?? ''}:${right.sourceId ?? ''}`)
  ))

  const lifecycle = cleanupLifecycle({
    settlement,
    map: { ...validated.map, encounterState: deepCloneJson(validated.state) },
    sheets: validated.sheets,
    writeTimestamp: input.authority.writeTimestamp,
  })
  const actionsBySource = new Map(planned.map(row => [row.source.sourceId, row]))
  const nextEffects = reconcileCollection({
    original: validated.state.effects,
    lifecycle: lifecycle.currentEncounterState.effects,
    actions: actionsBySource,
    transformed: row => (row.transformation as Extract<EncounterSettlementCleanupTransformation, { kind: 'effect' }>).nextEffect,
  })
  const nextZones = reconcileCollection({
    original: validated.state.zones,
    lifecycle: lifecycle.currentEncounterState.zones,
    actions: actionsBySource,
    transformed: row => (row.transformation as Extract<EncounterSettlementCleanupTransformation, { kind: 'zone' }>).nextZone,
  })
  const nextGroundItems = reconcileCollection({
    original: validated.state.groundItems,
    actions: actionsBySource,
    transformed: row => (row.transformation as Extract<EncounterSettlementCleanupTransformation, { kind: 'ground-item' }>).nextGroundItem,
  })
  const nextState = parseEncounterState({
    ...lifecycle.currentEncounterState,
    effects: nextEffects,
    zones: nextZones,
    groundItems: nextGroundItems,
  })
  let nextMap: TabletopMap = {
    ...deepCloneJson(lifecycle.nextMap),
    encounterState: deepCloneJson(nextState),
    fieldEffects: projectGlobalFieldZonesToMapEffects({
      previous: validated.map.fieldEffects,
      state: nextState,
    }),
  }
  if (actionsBySource.get(ENCOUNTER_SETTLEMENT_CLEANUP_SOURCE_IDS.initiative)?.action === 'reset') {
    nextMap = {
      ...nextMap,
      placements: nextMap.placements.map((placement) => {
        const reset = { ...placement }
        delete reset.initiative
        return reset
      }),
    }
    nextMap.initiative = { activeId: null, round: 1 }
  }
  const beforeComparable = { ...deepCloneJson(validated.map), revision: 0, updatedAt: 0 }
  const afterComparable = { ...deepCloneJson(nextMap), revision: 0, updatedAt: 0 }
  const mapChanged = hashJson(beforeComparable, 'cleanupMapComparable') !== hashJson(afterComparable, 'cleanupMapComparable')
  if (mapChanged) {
    nextMap = {
      ...nextMap,
      revision: mapRevision(validated.map) + 1,
      updatedAt: input.authority.writeTimestamp,
    }
  }
  const mapWrite: EncounterSettlementCleanupMapWrite | null = mapChanged ? Object.freeze({
    mapSlug: validated.map.slug,
    expectedRevision: mapRevision(validated.map),
    revision: mapRevision(validated.map) + 1,
    beforeDefinitionSha256: hashJson(validated.map, 'cleanupMapBefore'),
    afterDefinitionSha256: hashJson(nextMap, 'cleanupMapAfter'),
    nextMap: deepCloneJson(nextMap),
  }) : null
  const sheetWrites = lifecycleSheetWrites(lifecycle.sheetWrites)
  const previews = planned.map(row => Object.freeze({
    cleanupId: row.entry.cleanupId,
    cleanupKind: row.entry.kind,
    sourceId: row.source.sourceId,
    sourceKind: row.source.sourceKind,
    action: row.action ?? 'pending',
    resultCode: resultCodeFor(row),
    changed: changedByAction(row, lifecycle),
  })).sort((left, right) => (
    `${left.cleanupId}:${left.sourceId}`.localeCompare(`${right.cleanupId}:${right.sourceId}`)
  ))
  const complete = blockers.length === 0
  return Object.freeze({
    complete,
    authorityDefinitionSha256: authorityEvidence(input.authority),
    document: settlement,
    previews: Object.freeze(previews),
    blockers: Object.freeze(blockers),
    mapWrite: complete ? mapWrite : null,
    sheetWrites: complete ? sheetWrites : Object.freeze([]),
    lifecycle: complete ? lifecycle : null,
  })
}

export const applyEncounterSettlementTemporaryCleanupPlan = (input: {
  readonly plan: EncounterSettlementCleanupPlan
  readonly currentAuthority: EncounterSettlementCleanupAuthoritySnapshot
}): EncounterSettlementCleanupApplicableWrites => {
  if (!input.plan.complete || input.plan.lifecycle === null
    || input.plan.authorityDefinitionSha256 !== authorityEvidence(input.currentAuthority)) {
    return fail('stale-cleanup-plan', 'plan', 'complete cleanup authority changed before application.')
  }
  if (input.plan.mapWrite) {
    const currentRevision = mapRevision(input.currentAuthority.map)
    if (currentRevision !== input.plan.mapWrite.expectedRevision
      || input.plan.mapWrite.revision !== currentRevision + 1
      || input.plan.mapWrite.beforeDefinitionSha256 !== hashJson(input.currentAuthority.map, 'cleanupMapBefore')
      || input.plan.mapWrite.afterDefinitionSha256 !== hashJson(input.plan.mapWrite.nextMap, 'cleanupMapAfter')) {
      fail('stale-cleanup-plan', 'plan.mapWrite', 'current map authority no longer matches the deterministic cleanup preview.')
    }
  }
  const currentSheets = new Map(input.currentAuthority.sheets.map(row => [sheetKey(row.kind, row.slug), row]))
  for (const write of input.plan.sheetWrites) {
    const current = currentSheets.get(sheetKey(write.kind, write.slug))
    if (!current || current.revision !== write.expectedRevision
      || write.revision !== write.expectedRevision + 1
      || write.beforeDefinitionSha256 !== hashJson(current.document, `cleanupSheetBefore.${write.kind}.${write.slug}`)
      || write.afterDefinitionSha256 !== hashJson(write.nextSheet, `cleanupSheetAfter.${write.kind}.${write.slug}`)) {
      fail('stale-cleanup-plan', `plan.sheetWrites.${write.kind}.${write.slug}`, 'current sheet authority no longer matches the deterministic cleanup preview.')
    }
  }
  return Object.freeze({
    mapWrite: input.plan.mapWrite,
    sheetWrites: input.plan.sheetWrites,
  })
}
