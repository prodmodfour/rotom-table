import { isSlug } from '../paths'
import { isSheetKind, type SheetKind } from '../sheets'

export const SESSION_PREPARATION_SCHEMA_VERSION = 1 as const
export const SESSION_PREPARATION_LIFECYCLES = ['draft', 'review', 'ready', 'launched', 'archived', 'cancelled'] as const
export type SessionPreparationLifecycleV1 = typeof SESSION_PREPARATION_LIFECYCLES[number]
export const SESSION_PREPARATION_LIMITS = Object.freeze({ scenes: 20, linkedDocuments: 50, candidatesPerScene: 20, handouts: 50, decisions: 50 } as const)

export interface SessionPreparationSheetRefV1 { readonly kind: SheetKind; readonly slug: string; readonly revision: number }
export interface SessionPreparationMapRefV1 { readonly slug: string; readonly revision: number }
export type SessionPreparationCandidateSourceV1 =
  | { readonly kind: 'wild-package'; readonly packageId: string }
  | { readonly kind: 'npc-package'; readonly packageId: string }
  | { readonly kind: 'encounter-table'; readonly tableId: string; readonly revision: number }
  | { readonly kind: 'existing-sheets'; readonly sheets: readonly SessionPreparationSheetRefV1[] }
export interface SessionPreparationEncounterCandidateV1 {
  readonly candidateId: string
  readonly label: string
  readonly selection: 'option' | 'selected' | 'excluded'
  readonly source: SessionPreparationCandidateSourceV1
  readonly placementIntent: { readonly kind: 'builder-default' | 'map-zone'; readonly zoneLabel: string | null }
  readonly gmNotes: string
}
export interface SessionPreparationSceneV1 {
  readonly sceneId: string
  readonly title: string
  readonly playerSummary: string
  readonly gmNotes: string
  readonly map: SessionPreparationMapRefV1 | null
  readonly encounterCandidates: readonly SessionPreparationEncounterCandidateV1[]
}
export interface SessionPreparationHandoutV1 {
  readonly handoutId: string
  readonly title: string
  readonly playerText: string
  readonly gmNotes: string
  readonly release: 'withheld' | 'on-launch'
}
export interface SessionPreparationDecisionV1 {
  readonly decisionId: string
  readonly headline: string
  readonly prompt: string
  readonly state: 'open' | 'resolved'
  readonly resolution: string | null
}
export interface SessionPreparationLaunchRefV1 {
  readonly launchId: string
  readonly sceneId: string
  readonly encounterId: string
  readonly mapSlug: string
  readonly launchedAt: string
}
export interface SessionPreparationDocumentV1 {
  readonly schemaVersion: 1
  readonly preparationId: string
  readonly revision: number
  readonly lifecycle: SessionPreparationLifecycleV1
  readonly title: string
  readonly scheduledFor: string | null
  readonly playerOverview: string
  readonly gmNotes: string
  readonly scenes: readonly SessionPreparationSceneV1[]
  readonly handouts: readonly SessionPreparationHandoutV1[]
  readonly unresolvedDecisions: readonly SessionPreparationDecisionV1[]
  readonly launches: readonly SessionPreparationLaunchRefV1[]
  readonly provenance: { readonly kind: 'campaign-authored' | 'copy'; readonly sourcePreparationId: string | null; readonly sourceRevision: number | null }
  readonly createdAt: string
  readonly updatedAt: string
}
export interface SessionPreparationLibraryProjectionV1 {
  readonly schemaVersion: 1; readonly preparationId: string; readonly revision: number; readonly lifecycle: SessionPreparationLifecycleV1
  readonly title: string; readonly scheduledFor: string | null; readonly sceneCount: number; readonly openDecisionCount: number; readonly selectedCandidateCount: number; readonly updatedAt: string
}
export interface SessionPreparationPublicProjectionV1 {
  readonly schemaVersion: 1; readonly preparationId: string; readonly revision: number; readonly lifecycle: 'launched' | 'archived'; readonly title: string
  readonly scheduledFor: string | null; readonly playerOverview: string
  readonly scenes: readonly { readonly sceneId: string; readonly title: string; readonly playerSummary: string }[]
  readonly handouts: readonly { readonly handoutId: string; readonly title: string; readonly playerText: string }[]
}

export class SessionPreparationContractError extends Error {
  constructor(readonly path: string, message: string) { super(`${path}: ${message}`); this.name = 'SessionPreparationContractError' }
}
const fail = (path: string, message: string): never => { throw new SessionPreparationContractError(path, message) }
const object = (value: unknown, path: string): Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : fail(path, 'must be an object')
const exact = (row: Record<string, unknown>, fields: readonly string[], path: string): void => { const expected = new Set(fields); if (Object.keys(row).length !== expected.size || Object.keys(row).some(key => !expected.has(key))) fail(path, 'has unsupported or missing fields') }
const integer = (value: unknown, path: string): number => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : fail(path, 'must be a non-negative safe integer')
const text = (value: unknown, path: string, max: number, required = false): string => {
  if (typeof value !== 'string' || value.length > max || value.trim() !== value || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || (required && !value)) return fail(path, `must be ${required ? 'non-empty ' : ''}bounded text`)
  return value
}
const stableId = (value: unknown, path: string, pattern: RegExp = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/): string => typeof value === 'string' && pattern.test(value) ? value : fail(path, 'must be a stable bounded ID')
const revision = (value: unknown, path: string): number => integer(value, path)
const iso = (value: unknown, path: string): string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value ? value : fail(path, 'must be a normalized ISO instant')
const nullableIso = (value: unknown, path: string): string | null => value === null ? null : iso(value, path)
const array = (value: unknown, path: string, max: number): unknown[] => Array.isArray(value) && value.length <= max ? value : fail(path, `must be an array of at most ${max} entries`)
const unique = (values: readonly string[], path: string): void => { if (new Set(values).size !== values.length) fail(path, 'must use unique stable identities') }
const sheetRef = (value: unknown, path: string): SessionPreparationSheetRefV1 => {
  const row = object(value, path); exact(row, ['kind', 'slug', 'revision'], path)
  if (!isSheetKind(row.kind) || typeof row.slug !== 'string' || !isSlug(row.slug)) fail(path, 'must reference an ordinary Trainer or Pokémon sheet')
  return Object.freeze({ kind: row.kind as SheetKind, slug: row.slug as string, revision: revision(row.revision, `${path}.revision`) })
}
const mapRef = (value: unknown, path: string): SessionPreparationMapRefV1 => {
  const row = object(value, path); exact(row, ['slug', 'revision'], path)
  if (typeof row.slug !== 'string' || !isSlug(row.slug)) fail(`${path}.slug`, 'must be an ordinary map slug')
  return Object.freeze({ slug: row.slug as string, revision: revision(row.revision, `${path}.revision`) })
}
const candidateSource = (value: unknown, path: string): SessionPreparationCandidateSourceV1 => {
  const row = object(value, path)
  if (row.kind === 'wild-package') { exact(row, ['kind', 'packageId'], path); return Object.freeze({ kind: 'wild-package', packageId: stableId(row.packageId, `${path}.packageId`, /^wild-package:v1:[a-f0-9]{32}$/) }) }
  if (row.kind === 'npc-package') { exact(row, ['kind', 'packageId'], path); return Object.freeze({ kind: 'npc-package', packageId: stableId(row.packageId, `${path}.packageId`, /^npc-package:v1:[a-f0-9]{32}$/) }) }
  if (row.kind === 'encounter-table') { exact(row, ['kind', 'tableId', 'revision'], path); return Object.freeze({ kind: 'encounter-table', tableId: stableId(row.tableId, `${path}.tableId`, /^encounter-table:v1:[a-z0-9]+(?:-[a-z0-9]+)*$/), revision: revision(row.revision, `${path}.revision`) }) }
  if (row.kind === 'existing-sheets') {
    exact(row, ['kind', 'sheets'], path)
    const sheets = array(row.sheets, `${path}.sheets`, 30).map((entry, index) => sheetRef(entry, `${path}.sheets[${index}]`))
    if (!sheets.length) fail(`${path}.sheets`, 'must contain at least one sheet')
    unique(sheets.map(sheet => `${sheet.kind}:${sheet.slug}`), `${path}.sheets`)
    return Object.freeze({ kind: 'existing-sheets', sheets: Object.freeze(sheets) })
  }
  return fail(`${path}.kind`, 'is not a supported typed source')
}
const encounterCandidate = (value: unknown, path: string): SessionPreparationEncounterCandidateV1 => {
  const row = object(value, path); exact(row, ['candidateId', 'label', 'selection', 'source', 'placementIntent', 'gmNotes'], path)
  if (!['option', 'selected', 'excluded'].includes(String(row.selection))) fail(`${path}.selection`, 'is unknown')
  const placement = object(row.placementIntent, `${path}.placementIntent`); exact(placement, ['kind', 'zoneLabel'], `${path}.placementIntent`)
  if (placement.kind !== 'builder-default' && placement.kind !== 'map-zone') fail(`${path}.placementIntent.kind`, 'is unknown')
  const zoneLabel = placement.zoneLabel === null ? null : text(placement.zoneLabel, `${path}.placementIntent.zoneLabel`, 120, true)
  if ((placement.kind === 'map-zone') !== (zoneLabel !== null)) fail(`${path}.placementIntent.zoneLabel`, 'must be present only for map-zone placement')
  return Object.freeze({ candidateId: stableId(row.candidateId, `${path}.candidateId`), label: text(row.label, `${path}.label`, 160, true), selection: row.selection as SessionPreparationEncounterCandidateV1['selection'], source: candidateSource(row.source, `${path}.source`), placementIntent: Object.freeze({ kind: placement.kind as 'builder-default' | 'map-zone', zoneLabel }), gmNotes: text(row.gmNotes, `${path}.gmNotes`, 4000) })
}
const scene = (value: unknown, path: string): SessionPreparationSceneV1 => {
  const row = object(value, path); exact(row, ['sceneId', 'title', 'playerSummary', 'gmNotes', 'map', 'encounterCandidates'], path)
  const candidates = array(row.encounterCandidates, `${path}.encounterCandidates`, SESSION_PREPARATION_LIMITS.candidatesPerScene).map((entry, index) => encounterCandidate(entry, `${path}.encounterCandidates[${index}]`))
  unique(candidates.map(candidate => candidate.candidateId), `${path}.encounterCandidates`)
  return Object.freeze({ sceneId: stableId(row.sceneId, `${path}.sceneId`), title: text(row.title, `${path}.title`, 160, true), playerSummary: text(row.playerSummary, `${path}.playerSummary`, 4000), gmNotes: text(row.gmNotes, `${path}.gmNotes`, 8000), map: row.map === null ? null : mapRef(row.map, `${path}.map`), encounterCandidates: Object.freeze(candidates) })
}
const handout = (value: unknown, path: string): SessionPreparationHandoutV1 => {
  const row = object(value, path); exact(row, ['handoutId', 'title', 'playerText', 'gmNotes', 'release'], path)
  if (row.release !== 'withheld' && row.release !== 'on-launch') fail(`${path}.release`, 'is unknown')
  return Object.freeze({ handoutId: stableId(row.handoutId, `${path}.handoutId`), title: text(row.title, `${path}.title`, 160, true), playerText: text(row.playerText, `${path}.playerText`, 12000), gmNotes: text(row.gmNotes, `${path}.gmNotes`, 4000), release: row.release as 'withheld' | 'on-launch' })
}
const decision = (value: unknown, path: string): SessionPreparationDecisionV1 => {
  const row = object(value, path); exact(row, ['decisionId', 'headline', 'prompt', 'state', 'resolution'], path)
  if (row.state !== 'open' && row.state !== 'resolved') fail(`${path}.state`, 'is unknown')
  const resolutionText = row.resolution === null ? null : text(row.resolution, `${path}.resolution`, 4000, true)
  if ((row.state === 'resolved') !== (resolutionText !== null)) fail(`${path}.resolution`, 'must be present exactly when resolved')
  return Object.freeze({ decisionId: stableId(row.decisionId, `${path}.decisionId`), headline: text(row.headline, `${path}.headline`, 160, true), prompt: text(row.prompt, `${path}.prompt`, 2000, true), state: row.state as 'open' | 'resolved', resolution: resolutionText })
}
const launchRef = (value: unknown, path: string): SessionPreparationLaunchRefV1 => {
  const row = object(value, path); exact(row, ['launchId', 'sceneId', 'encounterId', 'mapSlug', 'launchedAt'], path)
  if (typeof row.mapSlug !== 'string' || !isSlug(row.mapSlug)) fail(`${path}.mapSlug`, 'must be an ordinary map slug')
  return Object.freeze({ launchId: stableId(row.launchId, `${path}.launchId`), sceneId: stableId(row.sceneId, `${path}.sceneId`), encounterId: stableId(row.encounterId, `${path}.encounterId`), mapSlug: row.mapSlug as string, launchedAt: iso(row.launchedAt, `${path}.launchedAt`) })
}

export const parseSessionPreparationDocumentV1 = (value: unknown): SessionPreparationDocumentV1 => {
  const root = object(value, 'sessionPreparation')
  exact(root, ['schemaVersion', 'preparationId', 'revision', 'lifecycle', 'title', 'scheduledFor', 'playerOverview', 'gmNotes', 'scenes', 'handouts', 'unresolvedDecisions', 'launches', 'provenance', 'createdAt', 'updatedAt'], 'sessionPreparation')
  if (root.schemaVersion !== 1 || !(SESSION_PREPARATION_LIFECYCLES as readonly unknown[]).includes(root.lifecycle)) fail('sessionPreparation', 'must be a supported schema-v1 preparation')
  const scenes = array(root.scenes, 'sessionPreparation.scenes', SESSION_PREPARATION_LIMITS.scenes).map((entry, index) => scene(entry, `sessionPreparation.scenes[${index}]`))
  const handouts = array(root.handouts, 'sessionPreparation.handouts', SESSION_PREPARATION_LIMITS.handouts).map((entry, index) => handout(entry, `sessionPreparation.handouts[${index}]`))
  const decisions = array(root.unresolvedDecisions, 'sessionPreparation.unresolvedDecisions', SESSION_PREPARATION_LIMITS.decisions).map((entry, index) => decision(entry, `sessionPreparation.unresolvedDecisions[${index}]`))
  const launches = array(root.launches, 'sessionPreparation.launches', SESSION_PREPARATION_LIMITS.scenes).map((entry, index) => launchRef(entry, `sessionPreparation.launches[${index}]`))
  unique(scenes.map(row => row.sceneId), 'sessionPreparation.scenes'); unique(handouts.map(row => row.handoutId), 'sessionPreparation.handouts'); unique(decisions.map(row => row.decisionId), 'sessionPreparation.unresolvedDecisions'); unique(launches.map(row => row.launchId), 'sessionPreparation.launches')
  unique(scenes.flatMap(row => row.encounterCandidates.map(candidate => candidate.candidateId)), 'sessionPreparation candidate identities')
  const linkedDocuments = scenes.reduce((count, row) => count + (row.map ? 1 : 0) + row.encounterCandidates.reduce((total, candidate) => total + (candidate.source.kind === 'existing-sheets' ? candidate.source.sheets.length : 1), 0), 0)
  if (linkedDocuments > SESSION_PREPARATION_LIMITS.linkedDocuments) fail('sessionPreparation.scenes', `may reference at most ${SESSION_PREPARATION_LIMITS.linkedDocuments} linked documents`)
  const provenance = object(root.provenance, 'sessionPreparation.provenance'); exact(provenance, ['kind', 'sourcePreparationId', 'sourceRevision'], 'sessionPreparation.provenance')
  if (provenance.kind !== 'campaign-authored' && provenance.kind !== 'copy') fail('sessionPreparation.provenance.kind', 'is unknown')
  const sourcePreparationId = provenance.sourcePreparationId === null ? null : stableId(provenance.sourcePreparationId, 'sessionPreparation.provenance.sourcePreparationId', /^session-preparation:v1:[a-z0-9]+(?:-[a-z0-9]+)*$/)
  const sourceRevision = provenance.sourceRevision === null ? null : revision(provenance.sourceRevision, 'sessionPreparation.provenance.sourceRevision')
  if ((provenance.kind === 'copy') !== (sourcePreparationId !== null && sourceRevision !== null)) fail('sessionPreparation.provenance', 'copy provenance requires an immutable source; authored provenance forbids one')
  const createdAt = iso(root.createdAt, 'sessionPreparation.createdAt'); const updatedAt = iso(root.updatedAt, 'sessionPreparation.updatedAt')
  if (Date.parse(updatedAt) < Date.parse(createdAt)) fail('sessionPreparation.updatedAt', 'must not precede creation')
  const lifecycle = root.lifecycle as SessionPreparationLifecycleV1
  if (lifecycle === 'launched' && !launches.length) fail('sessionPreparation.launches', 'launched preparation requires immutable launch evidence')
  if (lifecycle !== 'launched' && lifecycle !== 'archived' && launches.length) fail('sessionPreparation.launches', 'launch evidence is permitted only after launch')
  return Object.freeze({ schemaVersion: 1, preparationId: stableId(root.preparationId, 'sessionPreparation.preparationId', /^session-preparation:v1:[a-z0-9]+(?:-[a-z0-9]+)*$/), revision: revision(root.revision, 'sessionPreparation.revision'), lifecycle, title: text(root.title, 'sessionPreparation.title', 160, true), scheduledFor: nullableIso(root.scheduledFor, 'sessionPreparation.scheduledFor'), playerOverview: text(root.playerOverview, 'sessionPreparation.playerOverview', 8000), gmNotes: text(root.gmNotes, 'sessionPreparation.gmNotes', 16000), scenes: Object.freeze(scenes), handouts: Object.freeze(handouts), unresolvedDecisions: Object.freeze(decisions), launches: Object.freeze(launches), provenance: Object.freeze({ kind: provenance.kind as 'campaign-authored' | 'copy', sourcePreparationId, sourceRevision }), createdAt, updatedAt })
}

export const assertSessionPreparationReady = (value: SessionPreparationDocumentV1): SessionPreparationDocumentV1 => {
  const document = parseSessionPreparationDocumentV1(value)
  if (!document.scenes.length) fail('sessionPreparation.scenes', 'ready preparation requires at least one scene')
  if (document.unresolvedDecisions.some(row => row.state === 'open')) fail('sessionPreparation.unresolvedDecisions', 'resolve every open decision before readying the session')
  if (document.scenes.some(row => row.encounterCandidates.some(candidate => candidate.selection === 'option'))) fail('sessionPreparation.scenes', 'review every encounter option before readying the session')
  return document
}
export const projectSessionPreparationForLibrary = (value: SessionPreparationDocumentV1): SessionPreparationLibraryProjectionV1 => {
  const document = parseSessionPreparationDocumentV1(value)
  return Object.freeze({ schemaVersion: 1, preparationId: document.preparationId, revision: document.revision, lifecycle: document.lifecycle, title: document.title, scheduledFor: document.scheduledFor, sceneCount: document.scenes.length, openDecisionCount: document.unresolvedDecisions.filter(row => row.state === 'open').length, selectedCandidateCount: document.scenes.flatMap(row => row.encounterCandidates).filter(row => row.selection === 'selected').length, updatedAt: document.updatedAt })
}
export const projectSessionPreparationForPublic = (value: SessionPreparationDocumentV1): SessionPreparationPublicProjectionV1 | null => {
  const document = parseSessionPreparationDocumentV1(value)
  if (document.lifecycle !== 'launched' && document.lifecycle !== 'archived') return null
  return Object.freeze({ schemaVersion: 1, preparationId: document.preparationId, revision: document.revision, lifecycle: document.lifecycle, title: document.title, scheduledFor: document.scheduledFor, playerOverview: document.playerOverview, scenes: Object.freeze(document.scenes.map(row => Object.freeze({ sceneId: row.sceneId, title: row.title, playerSummary: row.playerSummary }))), handouts: Object.freeze(document.handouts.filter(row => row.release === 'on-launch').map(row => Object.freeze({ handoutId: row.handoutId, title: row.title, playerText: row.playerText }))) })
}
