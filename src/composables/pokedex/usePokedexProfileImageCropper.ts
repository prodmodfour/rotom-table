import { computed, ref, watch } from 'vue'
import { getErrorMessage } from '~/utils/errorMessages'
import type { PokedexProfileImageUpdateResponse } from '~/utils/pokedex/admin'
import type { PokedexEntryDetail } from '~/utils/pokedex/entryIndex'

interface BooleanRef {
  readonly value: boolean
}

interface EntryRef {
  readonly value: PokedexEntryDetail | null
}

export interface UsePokedexProfileImageCropperOptions {
  isGm: BooleanRef
  selectedEntry: EntryRef
  updateProfileImage: (slug: string, imageDataUrl: string) => Promise<PokedexProfileImageUpdateResponse>
}

const withCacheBuster = (url: string | null, version: number): string | null => {
  if (!url || version <= 0) return url
  const joiner = url.includes('?') ? '&' : '?'
  return `${url}${joiner}v=${version}`
}

export const usePokedexProfileImageCropper = ({
  isGm,
  selectedEntry,
  updateProfileImage,
}: UsePokedexProfileImageCropperOptions) => {
  const isOpen = ref(false)
  const isSaving = ref(false)
  const errorMessage = ref<string | null>(null)
  const statusMessage = ref<string | null>(null)
  const profileImageVersion = ref(0)

  const selectedSourceImageUrl = computed(() => selectedEntry.value?.spriteUrl ?? null)
  const selectedProfileImageUrl = computed(() => withCacheBuster(
    selectedEntry.value?.profileSpriteUrl ?? null,
    profileImageVersion.value,
  ))
  const canOpen = computed(() => Boolean(isGm.value && selectedEntry.value?.spriteUrl && selectedEntry.value?.profileSpriteUrl))

  const resetMessages = (): void => {
    errorMessage.value = null
    statusMessage.value = null
  }

  const close = (): void => {
    if (isSaving.value) return
    isOpen.value = false
  }

  const open = (): void => {
    if (!canOpen.value) return
    resetMessages()
    isOpen.value = true
  }

  const saveProfileImage = async (imageDataUrl: string): Promise<void> => {
    const currentEntry = selectedEntry.value
    if (!isGm.value || !currentEntry || isSaving.value) return

    resetMessages()
    isSaving.value = true

    try {
      const result = await updateProfileImage(currentEntry.slug, imageDataUrl)
      profileImageVersion.value = Date.now()
      statusMessage.value = `Updated ${result.species} profile image.`
    } catch (error) {
      errorMessage.value = getErrorMessage(error, { fallback: 'Unable to update profile image.' })
    } finally {
      isSaving.value = false
    }
  }

  watch(() => selectedEntry.value?.slug ?? null, (nextSlug, previousSlug) => {
    if (!previousSlug || nextSlug === previousSlug) return
    isOpen.value = false
    resetMessages()
  })

  watch(() => isGm.value, (nextIsGm) => {
    if (nextIsGm) return
    isOpen.value = false
    resetMessages()
  })

  return {
    canOpen,
    close,
    currentProfileImageUrl: selectedProfileImageUrl,
    errorMessage,
    isOpen,
    isSaving,
    open,
    saveProfileImage,
    sourceImageUrl: selectedSourceImageUrl,
    statusMessage,
  }
}
