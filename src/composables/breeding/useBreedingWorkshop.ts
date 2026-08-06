import { computed, ref, shallowRef } from 'vue'
import {
  BREEDING_WORKSHOP_API_PATH,
  verifyBreedingWorkshopProjectionV1,
  type BreedingWorkshopOwnershipContextV1,
  type BreedingWorkshopProjectionV1,
} from '#shared/breeding/workshop'
import { getErrorMessage } from '~/utils/errorMessages'
import { playerProfileSwitchRoute } from '~/utils/playerProfileNavigation'

const routeQueryString = (value: unknown): string | null => (
  typeof value === 'string' && value.length > 0 ? value : null
)

export const useBreedingWorkshop = () => {
  const route = useRoute()
  const router = useRouter()
  const { isPlayer } = useAuth()
  const { getJson } = useApiClient()
  const profiles = usePlayerProfiles()
  const projection = shallowRef<BreedingWorkshopProjectionV1 | null>(null)
  const ownershipContexts = ref<readonly BreedingWorkshopOwnershipContextV1[]>([])
  const loading = ref(false)
  const loadingMore = ref(false)
  const error = ref<string | null>(null)
  let loadSequence = 0

  const selectedOwnershipContext = computed(() => projection.value?.selectedOwnershipContext ?? null)
  const profileSwitchPath = computed(() => playerProfileSwitchRoute(route.fullPath))
  const hasMoreOwnershipContexts = computed(() => projection.value?.nextOwnershipCursor !== null)

  const mergeContexts = (
    current: readonly BreedingWorkshopOwnershipContextV1[],
    next: readonly BreedingWorkshopOwnershipContextV1[],
  ): readonly BreedingWorkshopOwnershipContextV1[] => {
    const bySlug = new Map(current.map(context => [context.trainerSheetSlug, context]))
    next.forEach(context => bySlug.set(context.trainerSheetSlug, context))
    return Object.freeze([...bySlug.values()].sort((left, right) => (
      left.trainerSheetSlug < right.trainerSheetSlug
        ? -1
        : left.trainerSheetSlug > right.trainerSheetSlug ? 1 : 0
    )))
  }

  const load = async (options: {
    readonly append?: boolean
    readonly ownershipCursor?: string | null
    readonly trainerSheetSlug?: string | null
  } = {}): Promise<void> => {
    const append = options.append === true
    const sequence = ++loadSequence
    if (append) loadingMore.value = true
    else loading.value = true
    error.value = null
    try {
      const requestedTrainerSlug = Object.hasOwn(options, 'trainerSheetSlug')
        ? options.trainerSheetSlug ?? null
        : selectedOwnershipContext.value?.trainerSheetSlug
          ?? routeQueryString(route.query.trainer)
      const raw = await getJson<unknown>(BREEDING_WORKSHOP_API_PATH, {
        params: {
          profileId: isPlayer.value ? profiles.selectedProfileId.value : undefined,
          trainerSheetSlug: requestedTrainerSlug ?? undefined,
          ownershipCursor: options.ownershipCursor ?? undefined,
        },
      })
      const parsed = await verifyBreedingWorkshopProjectionV1(raw)
      if (sequence !== loadSequence) return
      projection.value = parsed
      ownershipContexts.value = append
        ? mergeContexts(ownershipContexts.value, parsed.ownershipContexts)
        : parsed.ownershipContexts
    }
    catch (cause) {
      if (sequence !== loadSequence) return
      error.value = getErrorMessage(cause)
    }
    finally {
      if (sequence === loadSequence) {
        loading.value = false
        loadingMore.value = false
      }
    }
  }

  const initialize = async (): Promise<void> => {
    if (isPlayer.value) {
      profiles.loadRememberedProfile()
      try {
        await profiles.reloadProfiles({ silent: true, clearMissingSelection: true })
      }
      catch {
        // The Workshop request presents the actionable profile or load error.
      }
    }
    await load({ trainerSheetSlug: routeQueryString(route.query.trainer) })
  }

  const selectOwnershipContext = async (trainerSheetSlug: string): Promise<void> => {
    await load({ trainerSheetSlug })
    if (error.value || selectedOwnershipContext.value?.trainerSheetSlug !== trainerSheetSlug) return
    await router.replace({
      query: {
        ...route.query,
        trainer: trainerSheetSlug,
      },
    })
  }

  const loadMoreOwnershipContexts = async (): Promise<void> => {
    const cursor = projection.value?.nextOwnershipCursor
    if (!cursor || loadingMore.value) return
    await load({
      append: true,
      ownershipCursor: cursor,
      trainerSheetSlug: selectedOwnershipContext.value?.trainerSheetSlug ?? null,
    })
  }

  const reload = async (): Promise<void> => {
    ownershipContexts.value = []
    await load({ trainerSheetSlug: routeQueryString(route.query.trainer) })
  }

  const reloadForProfile = async (): Promise<void> => {
    ownershipContexts.value = []
    const { trainer: _trainer, ...query } = route.query
    await router.replace({ query })
    await load({ trainerSheetSlug: null })
  }

  return {
    projection,
    ownershipContexts,
    selectedOwnershipContext,
    loading,
    loadingMore,
    error,
    profileSwitchPath,
    hasMoreOwnershipContexts,
    selectedProfileId: profiles.selectedProfileId,
    initialize,
    reload,
    reloadForProfile,
    selectOwnershipContext,
    loadMoreOwnershipContexts,
  }
}
