import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { deepCloneJson } from '~/utils/serialization'
import { reconcileCapabilityRuntimeSourceLoss } from '../domain/capabilityAutomation/sourceLoss'
import { setupMapSaveRealtimeAppendInputs } from '../realtime/setupDocumentRealtime'
import type { RotomDatabase } from '../storage/database'
import type { MapRepository } from '../storage/mapRepository'
import type {
  PersistedRealtimeEvent,
  RealtimeEventRepository,
} from '../storage/realtimeEventRepository'
import {
  SheetRevisionConflictError,
  type SheetRepository,
  type SheetRevisionExpectation,
} from '../storage/sheetRepository'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export interface CapabilitySourceLossSheets {
  readonly pokemon: ReadonlyMap<string, CharacterSheet>
  readonly trainer: ReadonlyMap<string, TrainerSheet>
}

export interface PersistCapabilitySourceLossOnLoadInput {
  readonly map: TabletopMap
  readonly revision: number
  readonly sheets: CapabilitySourceLossSheets
}

export interface PersistCapabilitySourceLossOnLoadDependencies {
  readonly database: Pick<RotomDatabase, 'withTransaction'>
  readonly mapRepository: Partial<Pick<MapRepository<TabletopMap>, 'getBySlug' | 'applyLivePlayUpdate'>>
  readonly sheetRepository: Partial<Pick<SheetRepository<Record<string, unknown>>, 'assertRevisions'>>
  readonly realtimeEventRepository?: Pick<RealtimeEventRepository, 'appendMany'>
  readonly now?: () => number
}

export interface PersistCapabilitySourceLossOnLoadResult {
  readonly map: TabletopMap
  readonly revision: number
  readonly changed: boolean
  /** Publish only after the caller's outer transaction commits. */
  readonly persistedRealtimeEvents: readonly PersistedRealtimeEvent[]
}

export class CapabilitySourceLossLoadConflictError extends UseCaseHttpError<409> {
  constructor(message = 'Capability source-loss cleanup raced authoritative state; refresh and retry.') {
    super(409, message)
  }
}

const placedSheetRevisionExpectations = (
  map: TabletopMap,
  sheets: CapabilitySourceLossSheets,
): readonly SheetRevisionExpectation[] => {
  const byReference = new Map<string, SheetRevisionExpectation>()
  for (const placement of map.placements) {
    const sheet = placement.sheetKind === 'pokemon'
      ? sheets.pokemon.get(placement.sheetSlug)
      : sheets.trainer.get(placement.sheetSlug)
    if (!sheet) continue
    const expectation: SheetRevisionExpectation = {
      kind: placement.sheetKind,
      slug: placement.sheetSlug,
      revision: normalizeRevision(sheet.revision),
    }
    const key = `${expectation.kind}:${expectation.slug}`
    const previous = byReference.get(key)
    if (previous && previous.revision !== expectation.revision) {
      throw new CapabilitySourceLossLoadConflictError(
        `Capability source-loss cleanup observed conflicting revisions for ${expectation.kind} sheet ${expectation.slug}.`,
      )
    }
    byReference.set(key, expectation)
  }
  return [...byReference.values()]
}

const cleanupTimestamp = (input: PersistCapabilitySourceLossOnLoadInput, now: () => number): number => {
  const timestamp = Math.max(input.map.updatedAt ?? 0, now())
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new Error('Capability source-loss cleanup timestamp must be a safe non-negative integer.')
  }
  return timestamp
}

/**
 * Persist load-time source-loss cleanup as one raw-authority CAS write.
 *
 * The caller may already own a wider SQLite transaction; nested transaction
 * calls join that boundary. Sheet revisions, the map CAS, read-back
 * verification, and durable realtime replay rows therefore commit together.
 * A race never falls back to returning the in-memory cleanup.
 */
export const persistCapabilitySourceLossOnLoad = (
  input: PersistCapabilitySourceLossOnLoadInput,
  dependencies: PersistCapabilitySourceLossOnLoadDependencies,
): PersistCapabilitySourceLossOnLoadResult => {
  const revision = normalizeRevision(input.revision)
  if (normalizeRevision(input.map.revision) !== revision) {
    throw new CapabilitySourceLossLoadConflictError(
      'Capability source-loss cleanup map and row revisions do not match.',
    )
  }
  const reconciledMap = reconcileCapabilityRuntimeSourceLoss({
    map: input.map,
    sheets: input.sheets,
  })
  if (reconciledMap === input.map) {
    return {
      map: input.map,
      revision,
      changed: false,
      persistedRealtimeEvents: [],
    }
  }

  const applyLivePlayUpdate = dependencies.mapRepository.applyLivePlayUpdate
  const getBySlug = dependencies.mapRepository.getBySlug
  const assertRevisions = dependencies.sheetRepository.assertRevisions
  const realtimeEventRepository = dependencies.realtimeEventRepository
  if (!applyLivePlayUpdate || !getBySlug || !assertRevisions || !realtimeEventRepository) {
    throw new CapabilitySourceLossLoadConflictError(
      'Capability source-loss cleanup requires transactional map CAS, sheet read-set, and replay storage.',
    )
  }

  const expectations = placedSheetRevisionExpectations(input.map, input.sheets)
  const timestamp = cleanupTimestamp(input, dependencies.now ?? Date.now)
  return dependencies.database.withTransaction(() => {
    try {
      assertRevisions(expectations)
    } catch (error) {
      if (error instanceof SheetRevisionConflictError) {
        throw new CapabilitySourceLossLoadConflictError(
          'A Capability source sheet changed before source-loss cleanup could commit.',
        )
      }
      throw error
    }

    const applied = applyLivePlayUpdate({
      slug: input.map.slug,
      expectedRevision: revision,
      nextMap: { ...reconciledMap, revision, updatedAt: timestamp },
    })
    if (applied !== 'applied') throw new CapabilitySourceLossLoadConflictError()

    const persistedMap = getBySlug(input.map.slug)
    const persistedRevision = nextRevision(revision)
    if (!persistedMap || normalizeRevision(persistedMap.revision) !== persistedRevision) {
      throw new CapabilitySourceLossLoadConflictError(
        'Capability source-loss cleanup could not verify its authoritative map revision.',
      )
    }
    // Do not publish or return a partially cleaned document if repository
    // normalization reintroduced any source-owned state.
    if (reconcileCapabilityRuntimeSourceLoss({ map: persistedMap, sheets: input.sheets }) !== persistedMap) {
      throw new CapabilitySourceLossLoadConflictError(
        'Capability source-loss cleanup did not persist a closed authoritative state.',
      )
    }

    const persistedRealtimeEvents = realtimeEventRepository.appendMany(
      setupMapSaveRealtimeAppendInputs(deepCloneJson(persistedMap)).map(event => ({ ...event, timestamp })),
    )
    return {
      map: persistedMap,
      revision: persistedRevision,
      changed: true,
      persistedRealtimeEvents,
    }
  })
}
