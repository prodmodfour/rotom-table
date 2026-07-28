import { computed, onBeforeUnmount, ref, type Ref } from 'vue'
import {
  parseAcceptedEncounterPresentation,
  type AcceptedEncounterPresentation,
  type EncounterScreenReaderAnnouncement,
} from '#shared/encounterPresentation'

export interface UseEncounterPresentationRuntimeOptions {
  readonly historyLimit?: number
  readonly vfxLifetimeMs?: number
}

/**
 * Presentation-only sequencing. It never mutates map/sheet state and may safely
 * drop hints; authoritative state always arrives through patches/snapshots.
 */
export const useEncounterPresentationRuntime = (
  options: UseEncounterPresentationRuntimeOptions = {},
) => {
  const historyLimit = options.historyLimit ?? 100
  const vfxLifetimeMs = options.vfxLifetimeMs ?? 1_600
  const accepted = ref<readonly AcceptedEncounterPresentation[]>([])
  const activeVfxPresentations = ref<readonly AcceptedEncounterPresentation[]>([])
  const announcement = ref<EncounterScreenReaderAnnouncement | null>(null)
  const seen = new Set<string>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const reducedMotion: Ref<boolean> = ref(false)
  let mediaQuery: MediaQueryList | null = null

  if (import.meta.client) {
    mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    reducedMotion.value = mediaQuery.matches
    const update = (event: MediaQueryListEvent): void => { reducedMotion.value = event.matches }
    mediaQuery.addEventListener('change', update)
    onBeforeUnmount(() => mediaQuery?.removeEventListener('change', update))
  }

  const ordered = (values: readonly AcceptedEncounterPresentation[]) => [...values].sort((left, right) => (
    left.revision - right.revision
    || left.causal.depth - right.causal.depth
    || left.causal.sequence - right.causal.sequence
    || left.presentationId.localeCompare(right.presentationId)
  ))

  const ingest = (value: unknown, playVfx = true): AcceptedEncounterPresentation => {
    const presentation = parseAcceptedEncounterPresentation(value)
    if (seen.has(presentation.presentationId)) return presentation
    seen.add(presentation.presentationId)
    accepted.value = ordered([...accepted.value, presentation]).slice(-historyLimit)
    announcement.value = presentation.announcements.at(-1) ?? null
    if (playVfx && presentation.vfx.length > 0) {
      activeVfxPresentations.value = ordered([...activeVfxPresentations.value, presentation])
      const timer = setTimeout(() => {
        timers.delete(timer)
        activeVfxPresentations.value = activeVfxPresentations.value
          .filter(candidate => candidate.presentationId !== presentation.presentationId)
      }, reducedMotion.value ? Math.min(vfxLifetimeMs, 350) : vfxLifetimeMs)
      timers.add(timer)
    }
    return presentation
  }

  const replaceSnapshotHistory = (values: readonly AcceptedEncounterPresentation[]): void => {
    const parsedById = new Map<string, AcceptedEncounterPresentation>()
    for (const value of values) {
      const presentation = parseAcceptedEncounterPresentation(value)
      parsedById.set(presentation.presentationId, presentation)
    }
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
    activeVfxPresentations.value = []
    seen.clear()
    const next = ordered([...parsedById.values()]).slice(-historyLimit)
    for (const presentation of next) seen.add(presentation.presentationId)
    accepted.value = next
    announcement.value = next.at(-1)?.announcements.at(-1) ?? null
  }

  const clear = (): void => {
    accepted.value = []
    activeVfxPresentations.value = []
    announcement.value = null
    seen.clear()
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
  }

  onBeforeUnmount(clear)

  return Object.freeze({
    accepted,
    activeVfxPresentations,
    announcement,
    reducedMotion: computed(() => reducedMotion.value),
    ingest,
    replaceSnapshotHistory,
    clear,
  })
}
