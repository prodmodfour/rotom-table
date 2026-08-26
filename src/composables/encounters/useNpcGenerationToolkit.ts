import { computed, onMounted, ref, watch } from 'vue'
import type { NpcArchetypeLibraryProjectionV1 } from '#shared/gmToolkit/npcArchetypes'
import type { NpcGenerationCommitProjectionV1, NpcGenerationPreviewProjectionV1 } from '#shared/gmToolkit/npcGeneration'
import { useApiClient } from '~/composables/useApiClient'
import { getErrorMessage } from '~/utils/errorMessages'
import { GM_TOOLKIT_API_PATHS } from '~/utils/apiRoutes'

interface NpcArchetypeListResponseV1 {
  readonly schemaVersion: 1
  readonly archetypes: readonly NpcArchetypeLibraryProjectionV1[]
}
let sequence = 0
const operationId = (): string => {
  sequence += 1
  return `npc-generation-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${sequence}`}`
}

export const useNpcGenerationToolkit = () => {
  const { getJson, postJson } = useApiClient()
  const archetypes = ref<NpcArchetypeLibraryProjectionV1[]>([])
  const archetypeId = ref('')
  const name = ref('')
  const identity = ref('')
  const tactics = ref('')
  const notes = ref('')
  const rosterCount = ref(0)
  const loading = ref(false)
  const previewing = ref(false)
  const committing = ref(false)
  const error = ref<string | null>(null)
  const announcement = ref('')
  const preview = ref<NpcGenerationPreviewProjectionV1 | null>(null)
  const committed = ref<NpcGenerationCommitProjectionV1 | null>(null)
  const currentOperationId = ref(operationId())

  const selectedArchetype = computed(() => archetypes.value.find(row => row.archetypeId === archetypeId.value) ?? null)
  const canPreview = computed(() => selectedArchetype.value !== null
    && name.value.trim().length > 0 && name.value.trim() === name.value && name.value.length <= 120
    && identity.value.length <= 2000 && tactics.value.length <= 2000 && notes.value.length <= 4000
    && Number.isInteger(rosterCount.value) && rosterCount.value >= 0 && rosterCount.value <= selectedArchetype.value.rosterCount
    && !previewing.value && !committing.value)
  const canCommit = computed(() => preview.value !== null && !committing.value)

  const clearPreview = (): void => {
    preview.value = null
    committed.value = null
    currentOperationId.value = operationId()
  }
  const loadArchetypes = async (): Promise<void> => {
    loading.value = true
    error.value = null
    try {
      const response = await getJson<NpcArchetypeListResponseV1>(GM_TOOLKIT_API_PATHS.npcArchetypes)
      archetypes.value = response.archetypes.filter(row => row.status === 'active')
      if (!archetypes.value.some(row => row.archetypeId === archetypeId.value)) archetypeId.value = archetypes.value[0]?.archetypeId ?? ''
    } catch (caught) { error.value = getErrorMessage(caught) }
    finally { loading.value = false }
  }
  const requestPreview = async (): Promise<void> => {
    const archetype = selectedArchetype.value
    if (!archetype || !canPreview.value) return
    previewing.value = true
    error.value = null
    committed.value = null
    try {
      const result = await postJson<NpcGenerationPreviewProjectionV1>(GM_TOOLKIT_API_PATHS.npcGeneration, {
        schemaVersion: 1,
        mode: 'preview',
        operationId: currentOperationId.value,
        archetypeId: archetype.archetypeId,
        expectedArchetypeRevision: archetype.revision,
        rosterCount: rosterCount.value,
        guided: { name: name.value, identity: identity.value, tactics: tactics.value, notes: notes.value },
      })
      preview.value = result
      announcement.value = `Preview ready for ${result.trainer.name} with ${result.roster.length} owned Pokémon. Nothing has been saved.`
    } catch (caught) { error.value = getErrorMessage(caught) }
    finally { previewing.value = false }
  }
  const commitPackage = async (): Promise<void> => {
    if (!preview.value || !canCommit.value) return
    committing.value = true
    error.value = null
    try {
      const result = await postJson<NpcGenerationCommitProjectionV1>(GM_TOOLKIT_API_PATHS.npcGeneration, {
        schemaVersion: 1,
        mode: 'commit',
        operationId: currentOperationId.value,
        previewToken: preview.value.previewToken,
        trainerFolder: 'generated/npcs',
        pokemonFolder: 'generated/npcs/rosters',
      })
      committed.value = result
      announcement.value = result.exactRetry
        ? 'The original NPC package was recovered. No duplicate sheets were created.'
        : `${result.trainerCandidate.name} and ${result.roster.length} owned Pokémon were committed as ordinary campaign sheets.`
    } catch (caught) { error.value = getErrorMessage(caught) }
    finally { committing.value = false }
  }
  const startAnother = (): void => {
    clearPreview()
    name.value = ''
    identity.value = ''
    tactics.value = ''
    notes.value = ''
    rosterCount.value = selectedArchetype.value?.rosterCount ?? 0
    error.value = null
  }

  watch(selectedArchetype, (next, previous) => {
    if (next?.archetypeId !== previous?.archetypeId) rosterCount.value = next?.rosterCount ?? 0
  }, { immediate: true })
  watch([archetypeId, name, identity, tactics, notes, rosterCount], () => {
    if (preview.value && !committing.value && !committed.value) clearPreview()
  })
  onMounted(() => { void loadArchetypes() })

  return {
    archetypes, archetypeId, selectedArchetype, name, identity, tactics, notes, rosterCount,
    loading, previewing, committing, error, announcement, preview, committed, canPreview, canCommit,
    loadArchetypes, requestPreview, commitPackage, startAnother,
  }
}
