import { computed, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import {
  ENCOUNTER_BUILDER_SCHEMA_VERSION,
  type EncounterBuilderCastMember,
  type LaunchEncounterBuilderRequest,
  type LaunchEncounterBuilderResult,
} from '#shared/encounterDocuments/builder'
import { ENCOUNTER_RECIPES, encounterRecipe } from '#shared/encounterDocuments/recipes'
import type { EncounterRecipeId } from '#shared/encounterDocuments/model'
import { slugify } from '#shared/paths'
import { rollEncounters, tablesInRegionFromEntries, encounterRegionsForEntries } from '~/utils/encounterTables'
import { DEFAULT_ENCOUNTER_OUT_ROOT } from '~/utils/encounterGeneration'
import { ENCOUNTER_WORKSPACE_API_PATHS, MAP_API_PATHS } from '~/utils/apiRoutes'
import { getClientId } from '~/utils/clientId'
import type { EncounterTableEntry, RolledEncounter } from '~/types/encounterTable'
import type { MapSummary, TabletopMap } from '~/types/map'
import { useApiClient } from '~/composables/useApiClient'

export interface EncounterBuilderDraftMember extends EncounterBuilderCastMember {
  readonly locked: boolean
}

export interface UseEncounterBuilderOptions {
  readonly entries: MaybeRefOrGetter<readonly EncounterTableEntry[]>
  readonly maps: MaybeRefOrGetter<readonly MapSummary[]>
  readonly initialMapSlug?: string
  readonly initialRegion?: string
  readonly initialTable?: string
  readonly random?: () => number
  readonly loadMap?: (slug: string) => Promise<TabletopMap>
  readonly launch?: (request: LaunchEncounterBuilderRequest) => Promise<LaunchEncounterBuilderResult>
}

const launchId = (): string => `launch-${globalThis.crypto.randomUUID()}`
const MAX_NON_NOTHING_ROLL_ATTEMPTS = 4_096
const cloneMember = (member: EncounterBuilderDraftMember): EncounterBuilderDraftMember => ({ ...member })

export const useEncounterBuilder = (options: UseEncounterBuilderOptions) => {
  const { getJson, postJson } = useApiClient()
  const random = options.random ?? Math.random
  const loadMap = options.loadMap ?? (async (slug: string) => (
    await getJson<{ map: TabletopMap }>(MAP_API_PATHS.load, { params: { slug } })
  ).map)
  const launchRequest = options.launch ?? ((request: LaunchEncounterBuilderRequest) => (
    postJson<LaunchEncounterBuilderResult>(ENCOUNTER_WORKSPACE_API_PATHS.launch, request)
  ))
  const allEntries = computed(() => [...toValue(options.entries)])
  const allMaps = computed(() => [...toValue(options.maps)])
  const regions = computed(() => encounterRegionsForEntries(allEntries.value))
  const region = ref(options.initialRegion ?? allEntries.value[0]?.region ?? '')
  const tableKey = ref(options.initialTable ?? allEntries.value.find(entry => entry.region === region.value)?.key ?? '')
  const tables = computed(() => tablesInRegionFromEntries(allEntries.value, region.value))
  const table = computed(() => tables.value.find(entry => entry.key === tableKey.value) ?? null)
  const mapSlug = ref(options.initialMapSlug ?? allMaps.value[0]?.slug ?? '')
  const map = ref<TabletopMap | null>(null)
  const mapError = ref<string | null>(null)
  const mapLoading = ref(false)
  const recipeId = ref<EncounterRecipeId>('wild-pack')
  const recipe = computed(() => encounterRecipe(recipeId.value))
  const name = ref('New encounter')
  const encounterId = ref('new-encounter')
  const count = ref(recipe.value.defaultCount.minimum)
  const presentationStage = ref(recipe.value.stage)
  const tacticalPresentation = ref(recipe.value.tactical)
  const startInitiative = ref(true)
  const outRoot = ref(DEFAULT_ENCOUNTER_OUT_ROOT)
  const publicStakes = ref('')
  const gmStakes = ref('')
  const notes = ref('')
  const cast = ref<EncounterBuilderDraftMember[]>([])
  const launching = ref(false)
  const error = ref<string | null>(null)
  const result = ref<LaunchEncounterBuilderResult | null>(null)
  const pendingLaunchId = ref<string | null>(null)

  const sides = computed(() => Object.values(map.value?.encounterState?.sides ?? {})
    .filter(side => side.status === 'active')
    .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id)))
  const canLaunch = computed(() => Boolean(
    !launching.value && map.value && table.value && cast.value.length > 0
    && encounterId.value.trim() && name.value.trim(),
  ))

  const rollOne = (): RolledEncounter | null => {
    if (!table.value) return null
    for (let attempt = 0; attempt < MAX_NON_NOTHING_ROLL_ATTEMPTS; attempt += 1) {
      const rolled = rollEncounters(table.value.table, 1, random)[0]
      if (rolled) return rolled
    }
    return null
  }
  const draftMember = (rolled: RolledEncounter, index: number, prior?: EncounterBuilderDraftMember): EncounterBuilderDraftMember => ({
    castId: prior?.castId ?? `cast-${index + 1}`,
    species: rolled.species,
    level: rolled.level,
    roll: rolled.roll,
    sideId: prior?.sideId ?? sides.value[0]?.id ?? null,
    role: prior?.role ?? recipe.value.defaultRole,
    hidden: prior?.hidden ?? recipe.value.hideNewCast,
    locked: prior?.locked ?? false,
  })
  const rollCast = (): void => {
    const next: EncounterBuilderDraftMember[] = []
    for (let index = 0; index < Math.max(1, Math.min(30, Math.trunc(count.value))); index += 1) {
      const prior = cast.value[index]
      if (prior?.locked) {
        next.push(cloneMember(prior))
        continue
      }
      const rolled = rollOne()
      if (rolled) next.push(draftMember(rolled, index, prior))
    }
    cast.value = next
  }
  const toggleLock = (castId: string): void => {
    cast.value = cast.value.map(member => member.castId === castId ? { ...member, locked: !member.locked } : member)
  }
  const rerollMember = (castId: string): void => {
    cast.value = cast.value.map((member, index) => {
      if (member.castId !== castId || member.locked) return member
      const rolled = rollOne()
      return rolled ? draftMember(rolled, index, member) : member
    })
  }
  const updateMember = (castId: string, patch: Partial<Omit<EncounterBuilderDraftMember, 'castId' | 'locked'>>): void => {
    cast.value = cast.value.map(member => member.castId === castId ? { ...member, ...patch } : member)
  }
  const removeMember = (castId: string): void => {
    cast.value = cast.value.filter(member => member.castId !== castId)
    count.value = Math.max(1, cast.value.length)
  }

  const loadSelectedMap = async (): Promise<void> => {
    const selected = mapSlug.value
    if (!selected) {
      map.value = null
      return
    }
    mapLoading.value = true
    mapError.value = null
    try {
      const loaded = await loadMap(selected)
      if (selected === mapSlug.value) {
        map.value = loaded
        const availableSideIds = new Set(Object.values(loaded.encounterState?.sides ?? {})
          .filter(side => side.status === 'active')
          .map(side => side.id))
        const defaultSideId = [...availableSideIds][0] ?? null
        cast.value = cast.value.map(member => ({
          ...member,
          sideId: member.sideId && availableSideIds.has(member.sideId) ? member.sideId : defaultSideId,
        }))
      }
    }
    catch (cause) {
      if (selected === mapSlug.value) {
        map.value = null
        mapError.value = cause instanceof Error ? cause.message : 'Battlefield could not be loaded.'
      }
    }
    finally { if (selected === mapSlug.value) mapLoading.value = false }
  }

  const launch = async (): Promise<LaunchEncounterBuilderResult | null> => {
    if (!canLaunch.value || !table.value) return null
    launching.value = true
    error.value = null
    result.value = null
    pendingLaunchId.value ??= launchId()
    const request: LaunchEncounterBuilderRequest = {
      schemaVersion: ENCOUNTER_BUILDER_SCHEMA_VERSION,
      launchId: pendingLaunchId.value,
      encounterId: encounterId.value.trim(),
      name: name.value.trim(),
      recipe: recipeId.value,
      mapSlug: mapSlug.value,
      clientId: getClientId(),
      startInitiative: startInitiative.value,
      presentation: { stage: presentationStage.value, tactical: tacticalPresentation.value },
      source: { region: region.value, table: tableKey.value, outRoot: outRoot.value },
      cast: cast.value.map(({ locked: _locked, ...member }) => ({ ...member })),
      publicStakes: publicStakes.value.trim() || null,
      gmStakes: gmStakes.value.trim() || null,
      notes: notes.value.trim() || null,
    }
    try {
      result.value = await launchRequest(request)
      return result.value
    }
    catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Encounter launch failed.'
      return null
    }
    finally { launching.value = false }
  }

  watch(allEntries, () => {
    if (allEntries.value.length === 0) return
    if (!regions.value.includes(region.value)) region.value = regions.value[0] ?? ''
    if (!tables.value.some(entry => entry.key === tableKey.value)) tableKey.value = tables.value[0]?.key ?? ''
  }, { immediate: true })
  watch(allMaps, () => {
    if (allMaps.value.length === 0) return
    if (!allMaps.value.some(entry => entry.slug === mapSlug.value)) mapSlug.value = allMaps.value[0]!.slug
  }, { immediate: true })
  watch(region, () => {
    if (!tables.value.some(entry => entry.key === tableKey.value)) tableKey.value = tables.value[0]?.key ?? ''
  })
  watch(recipeId, () => {
    count.value = recipe.value.defaultCount.minimum
    presentationStage.value = recipe.value.stage
    tacticalPresentation.value = recipe.value.tactical
    cast.value = cast.value.map(member => ({ ...member, role: recipe.value.defaultRole, hidden: recipe.value.hideNewCast }))
    rollCast()
  })
  watch(name, value => { encounterId.value = slugify(value) || 'new-encounter' })
  watch(mapSlug, () => { void loadSelectedMap() }, { immediate: true })
  watch([encounterId, name, recipeId, mapSlug, region, tableKey, presentationStage, tacticalPresentation, startInitiative, outRoot, publicStakes, gmStakes, notes, cast], () => {
    pendingLaunchId.value = null
  }, { deep: true })
  watch([table, count], () => { if (table.value && cast.value.length === 0) rollCast() }, { immediate: true })

  return Object.freeze({
    recipes: ENCOUNTER_RECIPES,
    recipeId,
    recipe,
    name,
    encounterId,
    count,
    presentationStage,
    tacticalPresentation,
    startInitiative,
    region,
    regions,
    tableKey,
    tables,
    table,
    mapSlug,
    maps: allMaps,
    map,
    mapLoading,
    mapError,
    sides,
    outRoot,
    publicStakes,
    gmStakes,
    notes,
    cast,
    launching,
    error,
    result,
    canLaunch,
    rollCast,
    toggleLock,
    rerollMember,
    updateMember,
    removeMember,
    launch,
  })
}
