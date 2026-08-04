import type { TabletopMap } from '~/types/map'
import type { EncounterDocument } from '../encounterDocuments/model'

export const ENCOUNTER_WORKSPACE_SUMMARY_SCHEMA_VERSION = 1 as const

export type EncounterWorkspaceSummaryState = 'live' | 'ready' | 'empty'

export interface EncounterWorkspaceSummary {
  readonly schemaVersion: typeof ENCOUNTER_WORKSPACE_SUMMARY_SCHEMA_VERSION
  readonly encounterId: string
  readonly mapSlug: string
  readonly documentBacked: boolean
  readonly encounterRevision: number | null
  readonly lifecycle: EncounterDocument['lifecycle'] | null
  readonly recipe: EncounterDocument['recipe'] | null
  readonly name: string
  readonly folder: string
  readonly revision: number
  readonly updatedAt: number | null
  readonly playerVisible: boolean
  readonly state: EncounterWorkspaceSummaryState
  readonly participantCount: number
  readonly sideCount: number
  readonly round: number
  readonly currentParticipantId: string | null
  readonly scene: {
    readonly active: boolean
    readonly name: string | null
    readonly startedAt: number | null
  }
}

export interface EncounterWorkspaceSummaryList {
  readonly schemaVersion: typeof ENCOUNTER_WORKSPACE_SUMMARY_SCHEMA_VERSION
  readonly summaries: readonly EncounterWorkspaceSummary[]
}

const nonNegativeInteger = (value: unknown, fallback = 0): number => (
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : fallback
)

export const summarizeMapBackedEncounter = (map: TabletopMap): EncounterWorkspaceSummary => {
  const participantCount = map.placements.length
  const round = nonNegativeInteger(map.initiative?.round)
  const active = Boolean(map.activeScene) || Boolean(map.initiative?.activeId) || round > 0
  return {
    schemaVersion: ENCOUNTER_WORKSPACE_SUMMARY_SCHEMA_VERSION,
    encounterId: map.slug,
    mapSlug: map.slug,
    documentBacked: false,
    encounterRevision: null,
    lifecycle: null,
    recipe: null,
    name: map.name,
    folder: map.folder?.trim() ?? '',
    revision: nonNegativeInteger(map.revision),
    updatedAt: Number.isFinite(map.updatedAt) && Number(map.updatedAt) >= 0 ? Number(map.updatedAt) : null,
    playerVisible: map.playerVisible === true,
    state: participantCount === 0 ? 'empty' : active ? 'live' : 'ready',
    participantCount,
    sideCount: new Set(map.placements.map(placement => placement.sideId).filter(Boolean)).size,
    round,
    currentParticipantId: map.initiative?.activeId?.trim() || null,
    scene: map.activeScene
      ? { active: true, name: map.activeScene.name?.trim() || null, startedAt: nonNegativeInteger(map.activeScene.startedAt) }
      : { active: false, name: null, startedAt: null },
  }
}

export const summarizeEncounterDocument = (
  document: EncounterDocument,
  map: TabletopMap,
  options: { readonly includeHidden: boolean },
): EncounterWorkspaceSummary => {
  const hidden = new Set(document.hiddenParticipantIds)
  const visiblePlacements = options.includeHidden
    ? map.placements
    : map.placements.filter(placement => !hidden.has(placement.id))
  const mapSummary = summarizeMapBackedEncounter({ ...map, placements: visiblePlacements })
  return {
    ...mapSummary,
    encounterId: document.encounterId,
    documentBacked: true,
    encounterRevision: document.revision,
    lifecycle: document.lifecycle,
    recipe: document.recipe,
    name: document.name,
    updatedAt: Math.max(document.updatedAt, mapSummary.updatedAt ?? 0),
    state: document.lifecycle === 'active' || document.lifecycle === 'paused'
      ? 'live'
      : visiblePlacements.length === 0 ? 'empty' : 'ready',
    currentParticipantId: mapSummary.currentParticipantId && !options.includeHidden && hidden.has(mapSummary.currentParticipantId)
      ? null
      : mapSummary.currentParticipantId,
  }
}

export const sortEncounterWorkspaceSummaries = (
  summaries: readonly EncounterWorkspaceSummary[],
): EncounterWorkspaceSummary[] => [...summaries].sort((left, right) => {
  const stateOrder: Readonly<Record<EncounterWorkspaceSummaryState, number>> = { live: 0, ready: 1, empty: 2 }
  return stateOrder[left.state] - stateOrder[right.state]
    || (right.updatedAt ?? 0) - (left.updatedAt ?? 0)
    || left.name.localeCompare(right.name)
    || left.mapSlug.localeCompare(right.mapSlug)
})
