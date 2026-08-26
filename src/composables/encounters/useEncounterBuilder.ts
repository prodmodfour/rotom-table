import { computed, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import {
  ENCOUNTER_BUILDER_SCHEMA_VERSION,
  type EncounterBuilderCastMember,
  type EncounterBuilderHandoffProjectionV1,
  type EncounterBuilderHandoffV2,
  type LaunchEncounterBuilderRequest,
  type LaunchEncounterBuilderResult,
} from '#shared/encounterDocuments/builder'
import { ENCOUNTER_RECIPES, encounterRecipe } from '#shared/encounterDocuments/recipes'
import type { EncounterRecipeId } from '#shared/encounterDocuments/model'
import { slugify } from '#shared/paths'
import { ENCOUNTER_WORKSPACE_API_PATHS, GM_TOOLKIT_API_PATHS, MAP_API_PATHS } from '~/utils/apiRoutes'
import { getClientId } from '~/utils/clientId'
import type { MapSummary, TabletopMap } from '~/types/map'
import { useApiClient } from '~/composables/useApiClient'

export interface EncounterBuilderDraftMember extends EncounterBuilderCastMember {
  readonly displayName: string
  readonly displayLevel: number | null
  readonly placementIntent: {
    readonly kind: 'builder-default' | 'map-zone'
    readonly zoneLabel: string | null
  }
}

export interface UseEncounterBuilderOptions {
  readonly handoff?: MaybeRefOrGetter<EncounterBuilderHandoffV2 | null>
  /** Compatibility for existing accepted wild-package links. */
  readonly packageId?: MaybeRefOrGetter<string>
  readonly maps: MaybeRefOrGetter<readonly MapSummary[]>
  readonly initialMapSlug?: string
  readonly loadMap?: (slug: string) => Promise<TabletopMap>
  readonly loadHandoff?: (handoff: EncounterBuilderHandoffV2) => Promise<EncounterBuilderHandoffProjectionV1>
  readonly launch?: (request: LaunchEncounterBuilderRequest) => Promise<LaunchEncounterBuilderResult>
}

let launchSequence = 0
const newLaunchId = (): string => {
  launchSequence += 1
  return `launch-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${launchSequence}`}`
}
const sameHandoff = (left: EncounterBuilderHandoffV2 | null, right: EncounterBuilderHandoffV2 | null): boolean => (
  left?.kind === right?.kind && left?.documentId === right?.documentId
  && left?.expectedRevision === right?.expectedRevision && left?.sceneId === right?.sceneId
)

export const useEncounterBuilder = (options: UseEncounterBuilderOptions) => {
  const { getJson, postJson } = useApiClient()
  const loadMap = options.loadMap ?? (async (slug: string) => (
    await getJson<{ map: TabletopMap }>(MAP_API_PATHS.load, { params: { slug } })
  ).map)
  const loadHandoff = options.loadHandoff ?? (async (handoff: EncounterBuilderHandoffV2) => (
    await getJson<{ handoff: EncounterBuilderHandoffProjectionV1 }>(GM_TOOLKIT_API_PATHS.builderHandoff, {
      params: {
        kind: handoff.kind,
        documentId: handoff.documentId,
        expectedRevision: handoff.expectedRevision,
        ...(handoff.sceneId ? { sceneId: handoff.sceneId } : {}),
      },
    })
  ).handoff)
  const launchRequest = options.launch ?? ((request: LaunchEncounterBuilderRequest) => (
    postJson<LaunchEncounterBuilderResult>(ENCOUNTER_WORKSPACE_API_PATHS.launch, request)
  ))
  const sourceHandoff = computed<EncounterBuilderHandoffV2 | null>(() => {
    if (options.handoff) return toValue(options.handoff)
    const packageId = options.packageId ? toValue(options.packageId).trim() : ''
    return packageId ? { kind: 'wild-package', documentId: packageId, expectedRevision: 0, sceneId: null } : null
  })
  const allMaps = computed(() => [...toValue(options.maps)])
  const handoffProjection = ref<EncounterBuilderHandoffProjectionV1 | null>(null)
  const packageLoading = ref(false)
  const packageError = ref<string | null>(null)
  const mapSlug = ref(options.initialMapSlug ?? allMaps.value[0]?.slug ?? '')
  const map = ref<TabletopMap | null>(null)
  const mapError = ref<string | null>(null)
  const mapLoading = ref(false)
  const recipeId = ref<EncounterRecipeId>('wild-pack')
  const recipe = computed(() => encounterRecipe(recipeId.value))
  const name = ref('New encounter')
  const encounterId = ref('new-encounter')
  const presentationStage = ref(recipe.value.stage)
  const tacticalPresentation = ref(recipe.value.tactical)
  const startInitiative = ref(true)
  const publicStakes = ref('')
  const gmStakes = ref('')
  const notes = ref('')
  const cast = ref<EncounterBuilderDraftMember[]>([])
  const launching = ref(false)
  const error = ref<string | null>(null)
  const result = ref<LaunchEncounterBuilderResult | null>(null)
  const pendingLaunchId = ref<string | null>(null)

  const storyLocked = computed(() => handoffProjection.value?.defaults.storyLocked ?? false)
  const sides = computed(() => Object.values(map.value?.encounterState?.sides ?? {})
    .filter(side => side.status === 'active')
    .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id)))
  const canLaunch = computed(() => Boolean(
    !launching.value && handoffProjection.value && map.value && cast.value.length > 0
    && encounterId.value.trim() && name.value.trim(),
  ))

  const applyDefaultSides = (): void => {
    const available = new Set(sides.value.map(side => side.id))
    const fallback = sides.value[0]?.id ?? null
    cast.value = cast.value.map(member => ({
      ...member,
      sideId: member.sideId && available.has(member.sideId) ? member.sideId : fallback,
    }))
  }

  const applyHandoff = (loaded: EncounterBuilderHandoffProjectionV1): void => {
    handoffProjection.value = loaded
    recipeId.value = loaded.defaults.recipe
    const sourceRecipe = encounterRecipe(loaded.defaults.recipe)
    name.value = loaded.defaults.name
    encounterId.value = slugify(loaded.defaults.name) || 'new-encounter'
    presentationStage.value = sourceRecipe.stage
    tacticalPresentation.value = sourceRecipe.tactical
    publicStakes.value = loaded.defaults.publicStakes ?? ''
    gmStakes.value = loaded.defaults.gmStakes ?? ''
    notes.value = loaded.defaults.notes ?? ''
    cast.value = loaded.cast.map((row, index) => ({
      castId: `cast-${index + 1}`,
      sheet: row.sheet,
      sourceCandidateId: row.sourceCandidateId,
      sideId: sides.value[0]?.id ?? null,
      role: sourceRecipe.defaultRole,
      hidden: sourceRecipe.hideNewCast,
      displayName: row.displayName,
      displayLevel: row.displayLevel,
      placementIntent: row.placementIntent,
    }))
    if (loaded.defaults.map) mapSlug.value = loaded.defaults.map.slug
    applyDefaultSides()
  }

  const loadSource = async (): Promise<void> => {
    const selected = sourceHandoff.value
    handoffProjection.value = null
    cast.value = []
    packageError.value = null
    if (!selected) {
      packageError.value = 'Open Encounter Builder from an accepted package or a ready preparation scene.'
      return
    }
    packageLoading.value = true
    try {
      const loaded = await loadHandoff(selected)
      if (!sameHandoff(selected, sourceHandoff.value)) return
      applyHandoff(loaded)
    } catch (cause) {
      if (sameHandoff(selected, sourceHandoff.value)) packageError.value = cause instanceof Error ? cause.message : 'Builder handoff could not be loaded.'
    } finally {
      if (sameHandoff(selected, sourceHandoff.value)) packageLoading.value = false
    }
  }

  const updateMember = (castId: string, patch: Partial<Pick<EncounterBuilderDraftMember, 'sideId' | 'role' | 'hidden'>>): void => {
    cast.value = cast.value.map(member => member.castId === castId ? { ...member, ...patch } : member)
  }
  const removeMember = (castId: string): void => { cast.value = cast.value.filter(member => member.castId !== castId) }

  const loadSelectedMap = async (): Promise<void> => {
    const selected = mapSlug.value
    if (!selected) { map.value = null; return }
    mapLoading.value = true
    mapError.value = null
    try {
      const loaded = await loadMap(selected)
      if (selected !== mapSlug.value) return
      const required = handoffProjection.value?.defaults.map
      if (required?.slug === selected && (loaded.revision ?? 0) !== required.expectedRevision) {
        map.value = null
        mapError.value = 'Prepared battlefield changed. Reopen this scene in Session prep and select the current map revision.'
        return
      }
      map.value = loaded
      applyDefaultSides()
    } catch (cause) {
      if (selected === mapSlug.value) { map.value = null; mapError.value = cause instanceof Error ? cause.message : 'Battlefield could not be loaded.' }
    } finally { if (selected === mapSlug.value) mapLoading.value = false }
  }

  const launch = async (): Promise<LaunchEncounterBuilderResult | null> => {
    if (!canLaunch.value || !handoffProjection.value || !map.value) return null
    launching.value = true
    error.value = null
    result.value = null
    pendingLaunchId.value ??= newLaunchId()
    const request: LaunchEncounterBuilderRequest = {
      schemaVersion: ENCOUNTER_BUILDER_SCHEMA_VERSION,
      launchId: pendingLaunchId.value,
      encounterId: encounterId.value.trim(),
      name: name.value.trim(),
      recipe: recipeId.value,
      mapSlug: mapSlug.value,
      expectedMapRevision: map.value.revision ?? 0,
      clientId: getClientId(),
      startInitiative: startInitiative.value,
      presentation: { stage: presentationStage.value, tactical: tacticalPresentation.value },
      handoff: handoffProjection.value.handoff,
      cast: cast.value.map(({ displayName: _displayName, displayLevel: _displayLevel, placementIntent: _placementIntent, ...member }) => member),
      publicStakes: publicStakes.value.trim() || null,
      gmStakes: gmStakes.value.trim() || null,
      notes: notes.value.trim() || null,
    }
    try { result.value = await launchRequest(request); return result.value }
    catch (cause) { error.value = cause instanceof Error ? cause.message : 'Encounter launch failed.'; return null }
    finally { launching.value = false }
  }

  watch(allMaps, () => {
    if (allMaps.value.length === 0) return
    if (!allMaps.value.some(entry => entry.slug === mapSlug.value)) mapSlug.value = allMaps.value[0]!.slug
  }, { immediate: true })
  watch(sourceHandoff, () => { void loadSource() }, { immediate: true, deep: true })
  watch(recipeId, () => {
    presentationStage.value = recipe.value.stage
    tacticalPresentation.value = recipe.value.tactical
    cast.value = cast.value.map(member => ({ ...member, role: recipe.value.defaultRole, hidden: recipe.value.hideNewCast }))
  })
  watch(name, value => { encounterId.value = slugify(value) || 'new-encounter' })
  watch(mapSlug, () => { void loadSelectedMap() }, { immediate: true })
  watch([encounterId, name, recipeId, mapSlug, presentationStage, tacticalPresentation, startInitiative, publicStakes, gmStakes, notes, cast], () => {
    pendingLaunchId.value = null
  }, { deep: true })

  return Object.freeze({
    recipes: ENCOUNTER_RECIPES,
    recipeId,
    recipe,
    name,
    encounterId,
    presentationStage,
    tacticalPresentation,
    startInitiative,
    sourceHandoff,
    packageId: computed(() => sourceHandoff.value?.documentId ?? ''),
    generatedPackage: handoffProjection,
    handoffProjection,
    storyLocked,
    packageLoading,
    packageError,
    mapSlug,
    maps: allMaps,
    map,
    mapLoading,
    mapError,
    sides,
    publicStakes,
    gmStakes,
    notes,
    cast,
    launching,
    error,
    result,
    canLaunch,
    updateMember,
    removeMember,
    launch,
    reloadPackage: loadSource,
  })
}
