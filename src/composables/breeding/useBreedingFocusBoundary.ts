import { nextTick, onBeforeUnmount, watch, type Ref } from 'vue'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export interface BreedingFocusBoundaryOptions {
  readonly active: Readonly<Ref<boolean>>
  readonly container: Readonly<Ref<HTMLElement | null>>
  readonly initialFocus?: Readonly<Ref<HTMLElement | null>>
  readonly trap: boolean
}

export interface BreedingFocusBoundary {
  readonly handleFocusBoundaryKeydown: (event: KeyboardEvent) => void
}

const focusableChildren = (container: HTMLElement): readonly HTMLElement[] => [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
  .filter(element => !element.hidden && element.getAttribute('aria-hidden') !== 'true' && !element.closest('[inert]'))

const focusWithoutScroll = (element: HTMLElement): void => {
  try { element.focus({ preventScroll: true }) }
  catch { element.focus() }
}

/**
 * Keeps Workshop overlays keyboard-contained and returns focus to the control
 * that opened them. It owns presentation focus only and never submits or
 * interprets a breeding command.
 */
export const useBreedingFocusBoundary = (options: BreedingFocusBoundaryOptions): BreedingFocusBoundary => {
  let returnTarget: HTMLElement | null = null

  const restore = async (): Promise<void> => {
    const target = returnTarget
    returnTarget = null
    await nextTick()
    if (target?.isConnected) focusWithoutScroll(target)
  }

  const focusIntoBoundary = (): void => {
    const container = options.container.value
    if (!container || !options.active.value) return
    const current = typeof document === 'undefined' ? null : document.activeElement
    if (current && container.contains(current)) return
    const target = options.initialFocus?.value ?? focusableChildren(container)[0] ?? container
    focusWithoutScroll(target)
  }

  watch(options.active, async (active, wasActive) => {
    if (active && !wasActive) {
      if (typeof document === 'undefined') return
      const current = document.activeElement
      returnTarget = current instanceof HTMLElement ? current : null
      await nextTick()
      focusIntoBoundary()
      return
    }
    if (!active && wasActive) await restore()
  }, { flush: 'post', immediate: true })
  watch(options.container, (container, previous) => {
    if (container && !previous) focusIntoBoundary()
  }, { flush: 'post' })

  onBeforeUnmount(() => {
    if (returnTarget?.isConnected) focusWithoutScroll(returnTarget)
    returnTarget = null
  })

  const handleFocusBoundaryKeydown = (event: KeyboardEvent): void => {
    if (!options.trap || !options.active.value || event.key !== 'Tab') return
    const container = options.container.value
    if (!container) return
    const focusable = focusableChildren(container)
    if (focusable.length === 0) {
      event.preventDefault()
      focusWithoutScroll(container)
      return
    }
    const first = focusable[0]!
    const last = focusable.at(-1)!
    const current = typeof document === 'undefined' ? null : document.activeElement
    if (!container.contains(current)) {
      event.preventDefault()
      focusWithoutScroll(event.shiftKey ? last : first)
    } else if (event.shiftKey && current === first) {
      event.preventDefault()
      focusWithoutScroll(last)
    } else if (!event.shiftKey && current === last) {
      event.preventDefault()
      focusWithoutScroll(first)
    }
  }

  return Object.freeze({ handleFocusBoundaryKeydown })
}
