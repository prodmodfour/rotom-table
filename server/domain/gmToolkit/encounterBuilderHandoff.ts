import type {
  EncounterBuilderHandoffProjectionV1,
  EncounterBuilderHandoffV2,
  EncounterBuilderSheetKind,
} from '#shared/encounterDocuments/builder'
import type { EncounterRecipeId } from '#shared/encounterDocuments/model'
import type { SessionPreparationEncounterCandidateV1, SessionPreparationSceneV1 } from '#shared/gmToolkit/sessionPreparation'
import { createSqliteGmNpcGenerationRepository, type GmNpcGenerationRepository } from '../../storage/gmNpcGenerationRepository'
import { createSqliteGmSessionPreparationRepository, type GmSessionPreparationRepository } from '../../storage/gmSessionPreparationRepository'
import { createSqliteGmWildGenerationRepository, type GmWildGenerationRepository } from '../../storage/gmWildGenerationRepository'
import { createSqliteMapRepository, type MapRepository } from '../../storage/mapRepository'
import { createSqliteSheetRepository, type PersistedSheet, type SheetRepository } from '../../storage/sheetRepository'
import type { RotomDatabase } from '../../storage/database'
import { UseCaseHttpError } from '../../utils/useCaseErrors'

export class EncounterBuilderHandoffError extends UseCaseHttpError<400 | 404 | 409> {}

export interface EncounterBuilderHandoffRepositories {
  readonly database: RotomDatabase
  readonly wild: GmWildGenerationRepository
  readonly npc: GmNpcGenerationRepository
  readonly preparations: GmSessionPreparationRepository
  readonly sheets: Pick<SheetRepository<Record<string, unknown>>, 'getByRef'>
  readonly maps: Pick<MapRepository, 'get'>
}

export interface ResolvedEncounterBuilderHandoff {
  readonly projection: EncounterBuilderHandoffProjectionV1
  readonly allowedCast: ReadonlyMap<string, { readonly sourceCandidateId: string | null }>
  readonly preparation: {
    readonly preparationId: string
    readonly expectedRevision: number
    readonly sceneId: string
  } | null
}

interface ResolvedCastRow {
  readonly sheet: { readonly kind: EncounterBuilderSheetKind; readonly slug: string; readonly expectedRevision: number }
  readonly sourceCandidateId: string | null
  readonly displayName: string
  readonly displayLevel: number | null
  readonly placementIntent: { readonly kind: 'builder-default' | 'map-zone'; readonly zoneLabel: string | null }
}

const stableId = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/
const campaignSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const fail = (statusCode: 400 | 404 | 409, message: string): never => { throw new EncounterBuilderHandoffError(statusCode, message) }
const keyFor = (kind: EncounterBuilderSheetKind, slug: string): string => `${kind}:${slug}`
const defaultPlacement = Object.freeze({ kind: 'builder-default' as const, zoneLabel: null })

export const parseEncounterBuilderHandoffReference = (value: unknown): EncounterBuilderHandoffV2 => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(400, 'Builder handoff must be an object.')
  const row = value as Record<string, unknown>
  const expected = new Set(['kind', 'documentId', 'expectedRevision', 'sceneId'])
  if (Object.keys(row).length !== expected.size || Object.keys(row).some(field => !expected.has(field))) return fail(400, 'Builder handoff has unsupported or missing fields.')
  if (row.kind !== 'wild-package' && row.kind !== 'npc-package' && row.kind !== 'session-preparation') return fail(400, 'Builder handoff kind is unknown.')
  if (typeof row.documentId !== 'string' || !stableId.test(row.documentId)) return fail(400, 'Builder handoff document identity is invalid.')
  if (!Number.isSafeInteger(row.expectedRevision) || Number(row.expectedRevision) < 0) return fail(400, 'Builder handoff revision is invalid.')
  const sceneId = row.sceneId === null ? null : typeof row.sceneId === 'string' && stableId.test(row.sceneId) ? row.sceneId : fail(400, 'Builder scene identity is invalid.')
  if ((row.kind === 'session-preparation') !== (sceneId !== null)) return fail(400, 'Only preparation handoffs identify a scene.')
  return Object.freeze({ kind: row.kind, documentId: row.documentId, expectedRevision: Number(row.expectedRevision), sceneId })
}

export const encounterBuilderHandoffRepositories = (database: RotomDatabase): EncounterBuilderHandoffRepositories => Object.freeze({
  database,
  wild: createSqliteGmWildGenerationRepository(database),
  npc: createSqliteGmNpcGenerationRepository(database),
  preparations: createSqliteGmSessionPreparationRepository(database),
  sheets: createSqliteSheetRepository<Record<string, unknown>>(database),
  maps: createSqliteMapRepository(database),
})

const storedSheet = (
  repositories: EncounterBuilderHandoffRepositories,
  kind: EncounterBuilderSheetKind,
  slug: string,
  revision: number,
): PersistedSheet => {
  const stored = repositories.sheets.getByRef(kind, slug)
  if (!stored) return fail(404, `Accepted ${kind} sheet “${slug}” is missing.`)
  if (stored.revision !== revision) return fail(409, `Accepted ${kind} sheet “${slug}” changed. Refresh or rebuild the source package.`)
  return stored
}

const sheetDisplay = (stored: PersistedSheet, fallback: string): { readonly name: string; readonly level: number | null } => {
  const document = stored.sheet
  const name = [document.name, document.nickname, document.species, document.speciesId].find(value => typeof value === 'string' && value.trim())
  const level = Number.isSafeInteger(document.level) && Number(document.level) >= 0 ? Number(document.level) : null
  return { name: typeof name === 'string' ? name : fallback, level }
}

const checkedCastRow = (
  repositories: EncounterBuilderHandoffRepositories,
  input: {
    readonly kind: EncounterBuilderSheetKind
    readonly slug: string
    readonly revision: number
    readonly sourceCandidateId: string | null
    readonly displayName?: string
    readonly displayLevel?: number | null
    readonly placementIntent?: ResolvedCastRow['placementIntent']
  },
): ResolvedCastRow => {
  const stored = storedSheet(repositories, input.kind, input.slug, input.revision)
  const display = sheetDisplay(stored, input.slug)
  return Object.freeze({
    sheet: Object.freeze({ kind: input.kind, slug: input.slug, expectedRevision: input.revision }),
    sourceCandidateId: input.sourceCandidateId,
    displayName: input.displayName || display.name,
    displayLevel: input.displayLevel ?? display.level,
    placementIntent: Object.freeze(input.placementIntent ?? defaultPlacement),
  })
}

const wildRows = (
  repositories: EncounterBuilderHandoffRepositories,
  packageId: string,
  placementIntent: ResolvedCastRow['placementIntent'] = defaultPlacement,
): { readonly label: string; readonly rows: readonly ResolvedCastRow[] } => {
  const record = repositories.wild.getByPackageId(packageId)
  if (!record) return fail(404, 'Accepted wild package is missing.')
  const candidates = new Map(record.result.candidates.map(candidate => [candidate.candidateId, candidate]))
  return Object.freeze({
    label: record.result.table.name,
    rows: Object.freeze(record.result.sheets.map(ref => {
      const candidate = candidates.get(ref.candidateId)
      if (!candidate) return fail(409, 'Accepted wild package contradicts its candidate receipt.')
      return checkedCastRow(repositories, {
        kind: ref.kind,
        slug: ref.slug,
        revision: ref.revision,
        sourceCandidateId: ref.candidateId,
        displayName: candidate.speciesId,
        displayLevel: candidate.level,
        placementIntent,
      })
    })),
  })
}

const npcRows = (
  repositories: EncounterBuilderHandoffRepositories,
  packageId: string,
  placementIntent: ResolvedCastRow['placementIntent'] = defaultPlacement,
): { readonly label: string; readonly rows: readonly ResolvedCastRow[] } => {
  const record = repositories.npc.getByPackageId(packageId)
  if (!record) return fail(404, 'Accepted NPC package is missing.')
  const result = record.result
  const pokemon = new Map(result.pokemonCandidates.map(candidate => [candidate.candidateId, candidate]))
  const trainer = checkedCastRow(repositories, {
    kind: result.trainer.kind,
    slug: result.trainer.slug,
    revision: result.trainer.revision,
    sourceCandidateId: result.trainer.candidateId,
    displayName: result.trainerCandidate.name,
    displayLevel: result.trainerCandidate.level,
    placementIntent,
  })
  const roster = result.roster.map(ref => {
    const candidate = pokemon.get(ref.candidateId)
    if (!candidate) return fail(409, 'Accepted NPC package contradicts its roster receipt.')
    return checkedCastRow(repositories, {
      kind: ref.kind,
      slug: ref.slug,
      revision: ref.revision,
      sourceCandidateId: ref.candidateId,
      displayName: candidate.speciesId,
      displayLevel: candidate.level,
      placementIntent,
    })
  })
  return Object.freeze({ label: result.trainerCandidate.name, rows: Object.freeze([trainer, ...roster]) })
}

const candidateRows = (
  repositories: EncounterBuilderHandoffRepositories,
  candidate: SessionPreparationEncounterCandidateV1,
): readonly ResolvedCastRow[] => {
  const placementIntent = candidate.placementIntent
  if (candidate.source.kind === 'wild-package') return wildRows(repositories, candidate.source.packageId, placementIntent).rows
  if (candidate.source.kind === 'npc-package') return npcRows(repositories, candidate.source.packageId, placementIntent).rows
  if (candidate.source.kind === 'encounter-table') {
    return fail(409, `Selected candidate “${candidate.label}” is an encounter table, not committed sheets. Generate and commit it before opening Builder.`)
  }
  return Object.freeze(candidate.source.sheets.map(ref => checkedCastRow(repositories, {
    kind: ref.kind,
    slug: ref.slug,
    revision: ref.revision,
    sourceCandidateId: candidate.candidateId,
    placementIntent,
  })))
}

const sessionNotes = (scene: SessionPreparationSceneV1, selected: readonly SessionPreparationEncounterCandidateV1[]): string | null => {
  const sections: string[] = []
  if (scene.gmNotes) sections.push(scene.gmNotes)
  for (const candidate of selected) {
    const details = [
      candidate.gmNotes,
      candidate.placementIntent.kind === 'map-zone' ? `Placement intent: ${candidate.placementIntent.zoneLabel}.` : '',
    ].filter(Boolean).join(' · ')
    if (details) sections.push(`${candidate.label}: ${details}`)
  }
  const notes = sections.join(' — ')
  if (notes.length > 20_000) return fail(409, 'Selected scene notes exceed the Encounter Document limit. Shorten candidate or scene notes before launch.')
  return notes || null
}

const uniqueRows = (rows: readonly ResolvedCastRow[]): readonly ResolvedCastRow[] => {
  if (!rows.length) return fail(409, 'The handoff contains no committed ordinary sheets to stage.')
  if (rows.length > 30) return fail(409, 'The handoff exceeds the Builder cast limit of 30 sheets.')
  const keys = rows.map(row => keyFor(row.sheet.kind, row.sheet.slug))
  if (new Set(keys).size !== keys.length) return fail(409, 'The handoff selects the same ordinary sheet more than once. Exclude the duplicate source before launch.')
  return rows
}

const projection = (input: {
  readonly handoff: EncounterBuilderHandoffV2
  readonly label: string
  readonly sceneLabel: string | null
  readonly name: string
  readonly recipe: EncounterRecipeId
  readonly map: { readonly slug: string; readonly expectedRevision: number } | null
  readonly publicStakes: string | null
  readonly gmStakes: string | null
  readonly notes: string | null
  readonly storyLocked: boolean
  readonly rows: readonly ResolvedCastRow[]
}): EncounterBuilderHandoffProjectionV1 => Object.freeze({
  schemaVersion: 1,
  handoff: input.handoff,
  source: Object.freeze({ label: input.label, sceneLabel: input.sceneLabel }),
  defaults: Object.freeze({
    name: input.name,
    recipe: input.recipe,
    map: input.map ? Object.freeze(input.map) : null,
    publicStakes: input.publicStakes,
    gmStakes: input.gmStakes,
    notes: input.notes,
    storyLocked: input.storyLocked,
  }),
  cast: Object.freeze(input.rows),
})

export const resolveEncounterBuilderHandoff = (
  value: unknown,
  repositories: EncounterBuilderHandoffRepositories,
): ResolvedEncounterBuilderHandoff => {
  const handoff = parseEncounterBuilderHandoffReference(value)
  let resolvedProjection: EncounterBuilderHandoffProjectionV1
  let preparation: ResolvedEncounterBuilderHandoff['preparation'] = null

  if (handoff.kind === 'wild-package') {
    if (handoff.expectedRevision !== 0) return fail(409, 'Accepted wild package revision changed.')
    const source = wildRows(repositories, handoff.documentId)
    const rows = uniqueRows(source.rows)
    resolvedProjection = projection({ handoff, label: source.label, sceneLabel: null, name: `${source.label} encounter`, recipe: 'wild-pack', map: null, publicStakes: null, gmStakes: null, notes: null, storyLocked: false, rows })
  } else if (handoff.kind === 'npc-package') {
    if (handoff.expectedRevision !== 0) return fail(409, 'Accepted NPC package revision changed.')
    const source = npcRows(repositories, handoff.documentId)
    const rows = uniqueRows(source.rows)
    resolvedProjection = projection({ handoff, label: source.label, sceneLabel: null, name: `${source.label} encounter`, recipe: 'trainer-duel', map: null, publicStakes: null, gmStakes: null, notes: null, storyLocked: false, rows })
  } else {
    const document = repositories.preparations.get(handoff.documentId)
    if (!document) return fail(404, 'Session preparation is missing.')
    if (document.revision !== handoff.expectedRevision) return fail(409, 'Session preparation changed. Return to Session prep and reopen this scene.')
    if (document.lifecycle !== 'ready' && document.lifecycle !== 'launched') return fail(409, 'Session preparation must be Ready for Builder before launch.')
    const scene = document.scenes.find(row => row.sceneId === handoff.sceneId)
    if (!scene) return fail(404, 'Prepared scene is missing.')
    if (document.launches.some(row => row.sceneId === scene.sceneId)) return fail(409, 'This prepared scene already has immutable launch evidence.')
    if (scene.map) {
      if (!campaignSlug.test(scene.map.slug)) return fail(409, 'Prepared scene map identity is invalid.')
      const map = repositories.maps.get(scene.map.slug)
      if (!map) return fail(404, 'Prepared scene map is missing.')
      if (map.revision !== scene.map.revision) return fail(409, 'Prepared scene map changed. Reopen review and select its current revision.')
    }
    const selected = scene.encounterCandidates.filter(candidate => candidate.selection === 'selected')
    const rows = uniqueRows(selected.flatMap(candidate => candidateRows(repositories, candidate)))
    const kinds = new Set(selected.map(candidate => candidate.source.kind))
    const recipe: EncounterRecipeId = kinds.size === 1 && kinds.has('wild-package')
      ? 'wild-pack'
      : kinds.size === 1 && kinds.has('npc-package') ? 'trainer-duel' : 'blank'
    resolvedProjection = projection({
      handoff,
      label: document.title,
      sceneLabel: scene.title,
      name: scene.title,
      recipe,
      map: scene.map ? { slug: scene.map.slug, expectedRevision: scene.map.revision } : null,
      publicStakes: scene.playerSummary || null,
      gmStakes: null,
      notes: sessionNotes(scene, selected),
      storyLocked: true,
      rows,
    })
    preparation = Object.freeze({ preparationId: document.preparationId, expectedRevision: document.revision, sceneId: scene.sceneId })
  }

  const allowedCast = new Map(resolvedProjection.cast.map(row => [keyFor(row.sheet.kind, row.sheet.slug), Object.freeze({ sourceCandidateId: row.sourceCandidateId })]))
  return Object.freeze({ projection: resolvedProjection, allowedCast, preparation })
}
