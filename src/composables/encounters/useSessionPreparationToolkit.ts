import { computed, onMounted, ref } from 'vue'
import { GM_CAMPAIGN_TOOLKIT_CHANNEL, isGmCampaignToolkitInvalidationV1 } from '#shared/gmToolkit/realtime'
import type { SessionPreparationDocumentV1, SessionPreparationLibraryProjectionV1 } from '#shared/gmToolkit/sessionPreparation'
import type { SessionPreparationContentV1, SessionPreparationMutationProjectionV1 } from '#shared/gmToolkit/sessionPreparationOperations'
import type { WildGenerationCommitProjectionV1 } from '#shared/gmToolkit/generation'
import type { NpcGenerationCommitProjectionV1 } from '#shared/gmToolkit/npcGeneration'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { MapSummary } from '~/types/map'
import type { EncounterTableLibraryProjectionV1, GmEncounterTableListResponseV1 } from '~/types/gmCampaignToolkit'
import { useApiClient } from '~/composables/useApiClient'
import { useRealtimeChannel, type RealtimeEvent } from '~/composables/useRealtime'
import { getErrorMessage } from '~/utils/errorMessages'
import { ENCOUNTER_API_PATHS, GM_TOOLKIT_API_PATHS, MAP_API_PATHS, SHEET_API_PATHS } from '~/utils/apiRoutes'

type DeepMutable<Value> = Value extends readonly (infer Item)[] ? DeepMutable<Item>[] : Value extends object ? { -readonly [Key in keyof Value]: DeepMutable<Value[Key]> } : Value
export type EditableSessionPreparationContent = DeepMutable<SessionPreparationContentV1>
interface PreparationListResponse { readonly schemaVersion: 1; readonly preparations: readonly SessionPreparationLibraryProjectionV1[] }
interface PreparationDetailResponse { readonly schemaVersion: 1; readonly preparation: SessionPreparationDocumentV1 }
interface SheetListResponse { readonly pokemonSheets: CharacterSheet[]; readonly trainerSheets: TrainerSheet[] }
interface PackageCandidate {
  readonly kind: 'wild-package' | 'npc-package'; readonly packageId: string; readonly label: string; readonly detail: string
}
let sequence = 0
const operationId = (): string => { sequence += 1; return `session-preparation-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${sequence}`}` }
const entryId = (kind: 'scene' | 'candidate' | 'handout' | 'decision'): string => `${kind}:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${++sequence}`}`
const toContent = (document: SessionPreparationDocumentV1): EditableSessionPreparationContent => JSON.parse(JSON.stringify({ title: document.title, scheduledFor: document.scheduledFor, playerOverview: document.playerOverview, gmNotes: document.gmNotes, scenes: document.scenes, handouts: document.handouts, unresolvedDecisions: document.unresolvedDecisions })) as EditableSessionPreparationContent
const conflictMessage = (value: string): boolean => /changed|revision|already accepted|conflict|stale/i.test(value)

export interface SessionPreparationToolkitOptions {
  readonly initialPreparationId?: string | null
  readonly enabled?: boolean
}

export const useSessionPreparationToolkit = (options: SessionPreparationToolkitOptions = {}) => {
  const { getJson, postJson } = useApiClient()
  const preparations = ref<SessionPreparationLibraryProjectionV1[]>([])
  const selectedId = ref<string | null>(null)
  const selected = ref<SessionPreparationDocumentV1 | null>(null)
  const draft = ref<EditableSessionPreparationContent | null>(null)
  const tables = ref<EncounterTableLibraryProjectionV1[]>([])
  const maps = ref<MapSummary[]>([])
  const trainers = ref<TrainerSheet[]>([])
  const pokemon = ref<CharacterSheet[]>([])
  const pendingPackage = ref<PackageCandidate | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)
  const conflict = ref<string | null>(null)
  const announcement = ref('')
  const search = ref('')
  const status = ref<'active' | 'all' | SessionPreparationDocumentV1['lifecycle']>('active')
  const pendingOperation = ref<{ key: string; id: string } | null>(null)

  const visiblePreparations = computed(() => {
    const query = search.value.trim().toLocaleLowerCase()
    return preparations.value.filter(row => (status.value === 'all' || (status.value === 'active' ? !['archived', 'cancelled'].includes(row.lifecycle) : row.lifecycle === status.value)) && (!query || row.title.toLocaleLowerCase().includes(query)))
  })
  const dirty = computed(() => Boolean(selected.value && draft.value && JSON.stringify(toContent(selected.value)) !== JSON.stringify(draft.value)))
  const readinessReasons = computed(() => {
    const value = draft.value; if (!value) return ['Choose a preparation.']
    const reasons: string[] = []
    if (!value.scenes.length) reasons.push('Add at least one scene.')
    const open = value.unresolvedDecisions.filter(row => row.state === 'open').length
    if (open) reasons.push(`Resolve ${open} open decision${open === 1 ? '' : 's'}.`)
    const options = value.scenes.flatMap(row => row.encounterCandidates).filter(row => row.selection === 'option').length
    if (options) reasons.push(`Review ${options} encounter option${options === 1 ? '' : 's'}.`)
    if (dirty.value) reasons.push('Save current changes.')
    return reasons
  })
  const canEdit = computed(() => selected.value?.lifecycle === 'draft' || selected.value?.lifecycle === 'review')
  const canReady = computed(() => selected.value?.lifecycle === 'review' && readinessReasons.value.length === 0)

  const nextOperation = (key: string): string => {
    if (pendingOperation.value?.key === key) return pendingOperation.value.id
    const id = operationId(); pendingOperation.value = { key, id }; return id
  }
  const loadDetail = async (id: string): Promise<void> => {
    loading.value = true; error.value = null
    try {
      const response = await getJson<PreparationDetailResponse>(GM_TOOLKIT_API_PATHS.sessionPreparation(id))
      selected.value = response.preparation; selectedId.value = id; draft.value = toContent(response.preparation); conflict.value = null
    } catch (caught) { error.value = getErrorMessage(caught) }
    finally { loading.value = false }
  }
  const refresh = async (preserve = true): Promise<void> => {
    loading.value = true; error.value = null
    try {
      const [prepResponse, tableResponse, mapResponse, sheetResponse] = await Promise.all([
        getJson<PreparationListResponse>(GM_TOOLKIT_API_PATHS.sessionPreparations),
        getJson<GmEncounterTableListResponseV1>(ENCOUNTER_API_PATHS.list),
        getJson<{ maps: MapSummary[] }>(MAP_API_PATHS.list),
        getJson<SheetListResponse>(SHEET_API_PATHS.list),
      ])
      preparations.value = [...prepResponse.preparations]; tables.value = tableResponse.tables.filter(row => row.status === 'active'); maps.value = mapResponse.maps; trainers.value = sheetResponse.trainerSheets; pokemon.value = sheetResponse.pokemonSheets
      const currentExists = prepResponse.preparations.some(row => row.preparationId === selectedId.value)
      const initialExists = prepResponse.preparations.some(row => row.preparationId === options.initialPreparationId)
      const next = preserve && currentExists
        ? selectedId.value
        : initialExists ? options.initialPreparationId! : prepResponse.preparations[0]?.preparationId ?? null
      if (next && (next !== selected.value?.preparationId || prepResponse.preparations.find(row => row.preparationId === next)?.revision !== selected.value?.revision)) await loadDetail(next)
      if (!next) { selectedId.value = null; selected.value = null; draft.value = null }
    } catch (caught) { error.value = getErrorMessage(caught) }
    finally { loading.value = false }
  }
  const selectPreparation = async (row: SessionPreparationLibraryProjectionV1): Promise<void> => {
    if (dirty.value && !globalThis.confirm?.('Discard unsaved session preparation changes?')) return
    await loadDetail(row.preparationId)
  }
  const mutate = async (kind: string, body: Record<string, unknown>, message: string): Promise<SessionPreparationMutationProjectionV1 | null> => {
    saving.value = true; error.value = null; conflict.value = null
    const key = `${kind}:${JSON.stringify(body)}`; const opId = nextOperation(key)
    try {
      const result = await postJson<SessionPreparationMutationProjectionV1>(GM_TOOLKIT_API_PATHS.mutateSessionPreparation, { schemaVersion: 1, kind, operationId: opId, ...body })
      pendingOperation.value = null; selected.value = result.preparation; selectedId.value = result.preparation.preparationId; draft.value = toContent(result.preparation)
      announcement.value = result.exactRetry ? `${message} Original result recovered without duplicate changes.` : message
      await refresh(true); return result
    } catch (caught) {
      const message = getErrorMessage(caught); if (conflictMessage(message)) conflict.value = message; else error.value = message; return null
    } finally { saving.value = false }
  }
  const createPreparation = async (title: string): Promise<boolean> => Boolean(await mutate('create', { title: title.trim(), scheduledFor: null }, 'Session preparation created.'))
  const save = async (): Promise<boolean> => {
    if (!selected.value || !draft.value || !canEdit.value) return false
    return Boolean(await mutate('save', { preparationId: selected.value.preparationId, expectedRevision: selected.value.revision, content: draft.value }, 'Session preparation saved.'))
  }
  const transition = async (target: 'draft' | 'review' | 'ready'): Promise<void> => {
    if (!selected.value) return
    await mutate('transition', { preparationId: selected.value.preparationId, expectedRevision: selected.value.revision, target }, target === 'ready' ? 'Session is ready for Builder assembly.' : `Session moved to ${target}.`)
  }
  const copySelected = async (): Promise<void> => {
    if (!selected.value) return
    await mutate('copy', { sourcePreparationId: selected.value.preparationId, expectedSourceRevision: selected.value.revision, title: `${selected.value.title} copy` }, 'Session preparation copied.')
  }
  const importScenes = async (sourcePreparationId: string, sceneIds: readonly string[]): Promise<void> => {
    if (!selected.value) return
    const source = preparations.value.find(row => row.preparationId === sourcePreparationId); if (!source) return
    await mutate('import-scenes', { preparationId: selected.value.preparationId, expectedRevision: selected.value.revision, sourcePreparationId, expectedSourceRevision: source.revision, sceneIds }, `${sceneIds.length} scene${sceneIds.length === 1 ? '' : 's'} imported.`)
  }
  const importAllScenes = async (sourcePreparationId: string): Promise<void> => {
    if (!sourcePreparationId || sourcePreparationId === selected.value?.preparationId) return
    try {
      const response = await getJson<PreparationDetailResponse>(GM_TOOLKIT_API_PATHS.sessionPreparation(sourcePreparationId))
      if (!response.preparation.scenes.length) { error.value = 'That preparation has no scenes to import.'; return }
      await importScenes(sourcePreparationId, response.preparation.scenes.map(row => row.sceneId))
    } catch (caught) { error.value = getErrorMessage(caught) }
  }
  const terminate = async (kind: 'archive' | 'cancel'): Promise<void> => {
    if (!selected.value || !globalThis.confirm?.(`${kind === 'archive' ? 'Archive' : 'Cancel'} “${selected.value.title}”? Its history will be preserved.`)) return
    await mutate(kind, { preparationId: selected.value.preparationId, expectedRevision: selected.value.revision }, kind === 'archive' ? 'Session preparation archived.' : 'Session preparation cancelled.')
  }
  const addScene = (): void => { if (!draft.value || !canEdit.value) return; draft.value.scenes.push({ sceneId: entryId('scene'), title: 'Untitled scene', playerSummary: '', gmNotes: '', map: null, encounterCandidates: [] }) }
  const removeScene = (index: number): void => { draft.value?.scenes.splice(index, 1) }
  const moveScene = (index: number, offset: -1 | 1): void => { const rows = draft.value?.scenes; if (!rows) return; const target = index + offset; if (target < 0 || target >= rows.length) return; const [row] = rows.splice(index, 1); rows.splice(target, 0, row!) }
  const addTableCandidate = (sceneIndex: number, tableId: string): void => {
    const target = draft.value?.scenes[sceneIndex]; const table = tables.value.find(row => row.tableId === tableId); if (!target || !table) return
    target.encounterCandidates.push({ candidateId: entryId('candidate'), label: table.name, selection: 'option', source: { kind: 'encounter-table', tableId: table.tableId, revision: table.revision }, placementIntent: { kind: 'builder-default', zoneLabel: null }, gmNotes: '' })
  }
  const addExistingSheetCandidate = (sceneIndex: number, kind: 'trainer' | 'pokemon', slug: string): void => {
    const target = draft.value?.scenes[sceneIndex]
    const trainer = kind === 'trainer' ? trainers.value.find(sheet => sheet.slug === slug) : null
    const pokemonSheet = kind === 'pokemon' ? pokemon.value.find(sheet => sheet.slug === slug) : null
    const row = trainer ?? pokemonSheet
    if (!target || !row) return
    const label = trainer?.name || pokemonSheet?.nickname || pokemonSheet?.species || (kind === 'trainer' ? 'Trainer' : 'Pokémon')
    target.encounterCandidates.push({ candidateId: entryId('candidate'), label, selection: 'option', source: { kind: 'existing-sheets', sheets: [{ kind, slug: row.slug, revision: row.revision ?? 0 }] }, placementIntent: { kind: 'builder-default', zoneLabel: null }, gmNotes: '' })
  }
  const addPendingPackage = (sceneIndex: number): void => {
    const target = draft.value?.scenes[sceneIndex]; const packageRow = pendingPackage.value; if (!target || !packageRow) return
    target.encounterCandidates.push({ candidateId: entryId('candidate'), label: packageRow.label, selection: 'option', source: { kind: packageRow.kind, packageId: packageRow.packageId }, placementIntent: { kind: 'builder-default', zoneLabel: null }, gmNotes: '' }); pendingPackage.value = null
  }
  const removeCandidate = (sceneIndex: number, candidateIndex: number): void => { draft.value?.scenes[sceneIndex]?.encounterCandidates.splice(candidateIndex, 1) }
  const addHandout = (): void => { draft.value?.handouts.push({ handoutId: entryId('handout'), title: 'Untitled handout', playerText: '', gmNotes: '', release: 'withheld' }) }
  const removeHandout = (index: number): void => { draft.value?.handouts.splice(index, 1) }
  const addDecision = (): void => { draft.value?.unresolvedDecisions.push({ decisionId: entryId('decision'), headline: 'Unresolved decision', prompt: '', state: 'open', resolution: null }) }
  const removeDecision = (index: number): void => { draft.value?.unresolvedDecisions.splice(index, 1) }
  const setDecisionState = (index: number, resolved: boolean): void => { const row = draft.value?.unresolvedDecisions[index]; if (!row) return; row.state = resolved ? 'resolved' : 'open'; row.resolution = resolved ? (row.resolution || 'Resolved during preparation review.') : null }
  const loadPackage = async (kind: 'wild' | 'npc', packageId: string): Promise<void> => {
    if (!packageId) return
    try {
      if (kind === 'wild') {
        const response = await getJson<{ package: WildGenerationCommitProjectionV1 }>(GM_TOOLKIT_API_PATHS.wildPackage(packageId)); pendingPackage.value = { kind: 'wild-package', packageId, label: `${response.package.table.name} wild encounter`, detail: `${response.package.sheets.length} generated Pokémon` }
      } else {
        const response = await getJson<{ package: NpcGenerationCommitProjectionV1 }>(GM_TOOLKIT_API_PATHS.npcPackage(packageId)); pendingPackage.value = { kind: 'npc-package', packageId, label: response.package.trainerCandidate.name, detail: `Trainer with ${response.package.roster.length} owned Pokémon` }
      }
    } catch (caught) { error.value = getErrorMessage(caught) }
  }
  const reloadAfterConflict = async (): Promise<void> => { pendingOperation.value = null; if (selectedId.value) await loadDetail(selectedId.value) }

  useRealtimeChannel(GM_CAMPAIGN_TOOLKIT_CHANNEL, (event: RealtimeEvent) => {
    if (event.type !== 'session-preparation-invalidated' || !isGmCampaignToolkitInvalidationV1(event.data)) return
    if (event.data.documentId === selectedId.value && dirty.value) { conflict.value = 'This preparation changed in another GM tab. Reload before applying more changes.'; return }
    void refresh(true)
  })
  onMounted(() => { if (options.enabled !== false) void refresh(false) })
  return { preparations, visiblePreparations, selected, selectedId, draft, tables, maps, trainers, pokemon, pendingPackage, loading, saving, error, conflict, announcement, search, status, dirty, readinessReasons, canEdit, canReady, refresh, selectPreparation, createPreparation, save, transition, copySelected, importScenes, importAllScenes, terminate, addScene, removeScene, moveScene, addTableCandidate, addExistingSheetCandidate, addPendingPackage, removeCandidate, addHandout, removeHandout, addDecision, removeDecision, setDecisionState, loadPackage, reloadAfterConflict }
}
