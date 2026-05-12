import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { computeAnchoredTooltipPosition, type TooltipPlacement } from '~/utils/anchoredTooltip'

export interface TooltipComponentRef {
  rootEl: HTMLElement | null
}

export const useAnchoredTooltip = (canShow: () => boolean) => {
  const anchorEl = ref<HTMLElement | null>(null)
  const tooltipComponent = ref<TooltipComponentRef | null>(null)
  const isTooltipVisible = ref(false)
  const tooltipReady = ref(false)
  const tooltipPlacement = ref<TooltipPlacement>('bottom')
  const tooltipPosition = ref({ top: -9999, left: -9999 })
  const tooltipStyle = computed(() => ({
    top: `${tooltipPosition.value.top}px`,
    left: `${tooltipPosition.value.left}px`,
  }))

  let animationFrame: number | null = null
  let listenersAttached = false

  const updateTooltipPosition = () => {
    const tooltipEl = tooltipComponent.value?.rootEl
    if (typeof window === 'undefined' || !anchorEl.value || !tooltipEl || !isTooltipVisible.value) return

    const { top, left, placement } = computeAnchoredTooltipPosition(
      anchorEl.value.getBoundingClientRect(),
      tooltipEl.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
    )

    tooltipPosition.value = { top, left }
    tooltipPlacement.value = placement
    tooltipReady.value = true
  }

  const scheduleTooltipUpdate = () => {
    if (typeof window === 'undefined' || animationFrame !== null) return
    animationFrame = window.requestAnimationFrame(() => {
      animationFrame = null
      updateTooltipPosition()
    })
  }

  const addTooltipListeners = () => {
    if (typeof window === 'undefined' || listenersAttached) return
    window.addEventListener('resize', scheduleTooltipUpdate, { passive: true })
    window.addEventListener('scroll', scheduleTooltipUpdate, true)
    listenersAttached = true
  }

  const removeTooltipListeners = () => {
    if (typeof window === 'undefined' || !listenersAttached) return
    window.removeEventListener('resize', scheduleTooltipUpdate)
    window.removeEventListener('scroll', scheduleTooltipUpdate, true)
    listenersAttached = false
  }

  const cancelTooltipFrame = () => {
    if (typeof window !== 'undefined' && animationFrame !== null) {
      window.cancelAnimationFrame(animationFrame)
      animationFrame = null
    }
  }

  const showTooltip = async () => {
    if (!canShow()) return
    isTooltipVisible.value = true
    tooltipReady.value = false
    addTooltipListeners()
    await nextTick()
    updateTooltipPosition()
  }

  const hideTooltipNow = () => {
    cancelTooltipFrame()
    isTooltipVisible.value = false
    tooltipReady.value = false
    removeTooltipListeners()
  }

  onBeforeUnmount(() => {
    hideTooltipNow()
  })

  return {
    anchorEl,
    tooltipComponent,
    isTooltipVisible,
    tooltipReady,
    tooltipPlacement,
    tooltipStyle,
    showTooltip,
    hideTooltipNow,
    updateTooltipPosition,
  }
}
