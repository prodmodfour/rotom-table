import { computeAnchoredTooltipPosition, type TooltipPlacement } from '~/utils/anchoredTooltip'

const TOOLTIP_ID = 'rotom-styled-title-tooltip'
const TOOLTIP_TEXT_ATTRIBUTE = 'data-styled-tooltip'
const TOOLTIP_ARIA_LABEL_ATTRIBUTE = 'data-styled-tooltip-aria-label'
const TOOLTIP_SKIP_SELECTOR = '[data-native-tooltip], [data-native-title], [data-styled-tooltip-skip]'
const TITLE_SELECTOR = '[title]'

export interface StyledTitleTooltipController {
  start: () => void
  destroy: () => void
  refresh: (root?: ParentNode) => void
}

const isHtmlElement = (element: Element): element is HTMLElement => {
  const view = element.ownerDocument.defaultView
  return Boolean(view?.HTMLElement && element instanceof view.HTMLElement)
}

const isElementEligible = (element: Element): element is HTMLElement => {
  if (!isHtmlElement(element)) return false
  if (element.id === TOOLTIP_ID || element.closest(`#${TOOLTIP_ID}`)) return false
  return !element.closest(TOOLTIP_SKIP_SELECTOR)
}

const tooltipSelector = () => `[${TOOLTIP_TEXT_ATTRIBUTE}]`

const findClosestElement = (target: EventTarget | null, selector: string): Element | null => {
  return target instanceof Element ? target.closest(selector) : null
}

const appendDescribedBy = (element: HTMLElement, id: string) => {
  const ids = (element.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter(Boolean)

  if (!ids.includes(id)) {
    element.setAttribute('aria-describedby', [...ids, id].join(' '))
  }
}

const removeDescribedBy = (element: HTMLElement, id: string) => {
  const ids = (element.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter((value) => value && value !== id)

  if (ids.length) {
    element.setAttribute('aria-describedby', ids.join(' '))
  } else {
    element.removeAttribute('aria-describedby')
  }
}

const isNodeInside = (container: Node, possibleChild: EventTarget | null): boolean => {
  return possibleChild instanceof Node && container.contains(possibleChild)
}

const ensureAccessibleLabel = (element: HTMLElement, title: string) => {
  if (element.hasAttribute(TOOLTIP_ARIA_LABEL_ATTRIBUTE)) {
    element.setAttribute('aria-label', title)
    return
  }

  if (element.hasAttribute('aria-label') || element.hasAttribute('aria-labelledby')) return
  if (element.textContent?.trim()) return

  element.setAttribute(TOOLTIP_ARIA_LABEL_ATTRIBUTE, '')
  element.setAttribute('aria-label', title)
}

const clearAccessibleLabel = (element: HTMLElement) => {
  if (!element.hasAttribute(TOOLTIP_ARIA_LABEL_ATTRIBUTE)) return

  element.removeAttribute(TOOLTIP_ARIA_LABEL_ATTRIBUTE)
  element.removeAttribute('aria-label')
}

export const createStyledTitleTooltipController = (
  documentRef: Document = document,
): StyledTitleTooltipController => {
  const windowRef = documentRef.defaultView
  const suppressedPlaceholderUpdates = new WeakSet<HTMLElement>()

  let tooltipEl: HTMLDivElement | null = null
  let activeAnchor: HTMLElement | null = null
  let observer: MutationObserver | null = null
  let started = false
  let activeTrigger: 'pointer' | 'focus' | null = null
  let positionFrame: number | null = null
  let readyFrame: number | null = null
  let pointerMoveFrame: number | null = null
  let lastPointerMove: { clientX: number; clientY: number } | null = null
  let viewportListenersAttached = false

  const cancelFrame = (frame: number | null) => {
    if (windowRef && frame !== null) {
      windowRef.cancelAnimationFrame(frame)
    }
  }

  const ensureTooltipElement = () => {
    if (tooltipEl?.isConnected) return tooltipEl

    const existing = documentRef.getElementById(TOOLTIP_ID)
    tooltipEl = windowRef?.HTMLDivElement && existing instanceof windowRef.HTMLDivElement
      ? existing
      : documentRef.createElement('div')
    tooltipEl.id = TOOLTIP_ID
    tooltipEl.className = 'app-title-tooltip'
    tooltipEl.setAttribute('role', 'tooltip')
    tooltipEl.setAttribute('aria-hidden', 'true')
    tooltipEl.style.top = '-9999px'
    tooltipEl.style.left = '-9999px'

    if (!tooltipEl.isConnected) {
      documentRef.body.appendChild(tooltipEl)
    }

    return tooltipEl
  }

  const addViewportListeners = () => {
    if (!windowRef || viewportListenersAttached) return
    windowRef.addEventListener('resize', schedulePositionUpdate, { passive: true })
    windowRef.addEventListener('scroll', schedulePositionUpdate, true)
    viewportListenersAttached = true
  }

  const removeViewportListeners = () => {
    if (!windowRef || !viewportListenersAttached) return
    windowRef.removeEventListener('resize', schedulePositionUpdate)
    windowRef.removeEventListener('scroll', schedulePositionUpdate, true)
    viewportListenersAttached = false
  }

  const setPlacementClass = (placement: TooltipPlacement) => {
    const element = ensureTooltipElement()
    element.classList.toggle('app-title-tooltip--top', placement === 'top')
    element.classList.toggle('app-title-tooltip--bottom', placement === 'bottom')
  }

  const updateTooltipPosition = (ready = true) => {
    if (!windowRef || !activeAnchor || !tooltipEl) return

    const { top, left, placement } = computeAnchoredTooltipPosition(
      activeAnchor.getBoundingClientRect(),
      tooltipEl.getBoundingClientRect(),
      { width: windowRef.innerWidth, height: windowRef.innerHeight },
    )

    tooltipEl.style.top = `${top}px`
    tooltipEl.style.left = `${left}px`
    setPlacementClass(placement)

    if (ready) {
      tooltipEl.classList.add('app-title-tooltip--ready')
    }
  }

  function schedulePositionUpdate() {
    if (!windowRef || positionFrame !== null) return
    positionFrame = windowRef.requestAnimationFrame(() => {
      positionFrame = null
      updateTooltipPosition()
    })
  }

  const clearTooltipData = (element: HTMLElement) => {
    element.removeAttribute(TOOLTIP_TEXT_ATTRIBUTE)
    clearAccessibleLabel(element)
    if (activeAnchor === element) {
      hideTooltip()
    }
  }

  const captureTitle = (element: Element): HTMLElement | null => {
    if (!isElementEligible(element)) return null

    const title = element.getAttribute('title')
    if (title == null) return null

    if (title === '' && element.hasAttribute(TOOLTIP_TEXT_ATTRIBUTE)) {
      return element
    }

    if (!title.trim()) {
      clearTooltipData(element)
      return null
    }

    element.setAttribute(TOOLTIP_TEXT_ATTRIBUTE, title)
    ensureAccessibleLabel(element, title)
    if (observer) {
      suppressedPlaceholderUpdates.add(element)
    }
    element.setAttribute('title', '')

    if (activeAnchor === element) {
      showTooltip(element, activeTrigger ?? 'pointer')
    }

    return element
  }

  const refresh = (root: ParentNode = documentRef.body) => {
    if (!root) return

    if (root instanceof Element) {
      captureTitle(root)
    }

    root.querySelectorAll(TITLE_SELECTOR).forEach((element) => {
      captureTitle(element)
    })
  }

  const resolveAnchor = (target: EventTarget | null): HTMLElement | null => {
    const titleElement = findClosestElement(target, TITLE_SELECTOR)
    if (titleElement) {
      const captured = captureTitle(titleElement)
      if (captured) return captured
    }

    const existing = findClosestElement(target, tooltipSelector())
    return existing && isElementEligible(existing) ? existing : null
  }

  function showTooltip(anchor: HTMLElement, trigger: 'pointer' | 'focus' = 'pointer') {
    const text = anchor.getAttribute(TOOLTIP_TEXT_ATTRIBUTE)
    if (!text) return

    cancelFrame(readyFrame)
    readyFrame = null
    cancelFrame(positionFrame)
    positionFrame = null

    if (activeAnchor && activeAnchor !== anchor) {
      removeDescribedBy(activeAnchor, TOOLTIP_ID)
    }

    activeAnchor = anchor
    activeTrigger = trigger
    const element = ensureTooltipElement()
    element.textContent = text
    element.setAttribute('aria-hidden', 'false')
    element.classList.remove('app-title-tooltip--ready')
    element.style.top = '-9999px'
    element.style.left = '-9999px'

    appendDescribedBy(anchor, TOOLTIP_ID)
    addViewportListeners()
    updateTooltipPosition(false)

    if (windowRef) {
      readyFrame = windowRef.requestAnimationFrame(() => {
        readyFrame = null
        updateTooltipPosition()
      })
    } else {
      updateTooltipPosition()
    }
  }

  function hideTooltip() {
    cancelFrame(readyFrame)
    cancelFrame(positionFrame)
    cancelFrame(pointerMoveFrame)
    readyFrame = null
    positionFrame = null
    pointerMoveFrame = null
    lastPointerMove = null

    if (activeAnchor) {
      removeDescribedBy(activeAnchor, TOOLTIP_ID)
      activeAnchor = null
    }
    activeTrigger = null

    removeViewportListeners()

    if (!tooltipEl) return
    tooltipEl.classList.remove('app-title-tooltip--ready')
    tooltipEl.setAttribute('aria-hidden', 'true')
    tooltipEl.textContent = ''
    tooltipEl.style.top = '-9999px'
    tooltipEl.style.left = '-9999px'
  }

  const onPointerOver = (event: PointerEvent) => {
    const anchor = resolveAnchor(event.target)
    if (!anchor || anchor === activeAnchor) return
    showTooltip(anchor, 'pointer')
  }

  const syncTooltipToPointer = () => {
    pointerMoveFrame = null
    const pointer = lastPointerMove
    lastPointerMove = null

    if (!pointer || activeTrigger === 'focus') return

    const hoveredElement = documentRef.elementFromPoint(pointer.clientX, pointer.clientY)
    const anchor = resolveAnchor(hoveredElement)

    if (anchor) {
      if (anchor !== activeAnchor) {
        showTooltip(anchor, 'pointer')
      }
      return
    }

    if (activeAnchor) {
      hideTooltip()
    }
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!windowRef || activeTrigger === 'focus') return

    lastPointerMove = { clientX: event.clientX, clientY: event.clientY }
    if (pointerMoveFrame !== null) return

    pointerMoveFrame = windowRef.requestAnimationFrame(syncTooltipToPointer)
  }

  const onPointerOut = (event: PointerEvent) => {
    if (activeTrigger === 'focus') return
    if (!activeAnchor || !isNodeInside(activeAnchor, event.target)) return
    if (isNodeInside(activeAnchor, event.relatedTarget)) return
    hideTooltip()
  }

  const onFocusIn = (event: FocusEvent) => {
    const anchor = resolveAnchor(event.target)
    if (!anchor) return
    showTooltip(anchor, 'focus')
  }

  const onFocusOut = (event: FocusEvent) => {
    if (!activeAnchor || !isNodeInside(activeAnchor, event.target)) return
    if (isNodeInside(activeAnchor, event.relatedTarget)) return
    hideTooltip()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      hideTooltip()
    }
  }

  const observeTitleMutations = () => {
    if (!windowRef || observer || !documentRef.body) return

    observer = new windowRef.MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes' && record.attributeName === 'title' && record.target instanceof Element) {
          const element = record.target
          if (!isElementEligible(element)) continue

          const currentTitle = element.getAttribute('title')
          if (currentTitle === '' && suppressedPlaceholderUpdates.has(element)) {
            suppressedPlaceholderUpdates.delete(element)
            continue
          }

          if (currentTitle == null || currentTitle === '') {
            clearTooltipData(element)
            continue
          }

          captureTitle(element)
        }

        if (record.type === 'childList') {
          record.removedNodes.forEach((node) => {
            if (activeAnchor && node instanceof Node && node.contains(activeAnchor)) {
              hideTooltip()
            }
          })

          record.addedNodes.forEach((node) => {
            if (node instanceof Element) {
              refresh(node)
            }
          })
        }
      }
    })

    observer.observe(documentRef.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['title'],
    })
  }

  const start = () => {
    if (started || !documentRef.body) return
    started = true

    refresh(documentRef.body)
    observeTitleMutations()

    documentRef.addEventListener('pointerover', onPointerOver, true)
    documentRef.addEventListener('pointermove', onPointerMove, true)
    documentRef.addEventListener('pointerout', onPointerOut, true)
    documentRef.addEventListener('focusin', onFocusIn, true)
    documentRef.addEventListener('focusout', onFocusOut, true)
    documentRef.addEventListener('keydown', onKeyDown, true)
  }

  const destroy = () => {
    if (!started) return
    started = false

    hideTooltip()
    cancelFrame(pointerMoveFrame)
    pointerMoveFrame = null
    lastPointerMove = null
    observer?.disconnect()
    observer = null

    documentRef.removeEventListener('pointerover', onPointerOver, true)
    documentRef.removeEventListener('pointermove', onPointerMove, true)
    documentRef.removeEventListener('pointerout', onPointerOut, true)
    documentRef.removeEventListener('focusin', onFocusIn, true)
    documentRef.removeEventListener('focusout', onFocusOut, true)
    documentRef.removeEventListener('keydown', onKeyDown, true)

    tooltipEl?.remove()
    tooltipEl = null
  }

  return {
    start,
    destroy,
    refresh,
  }
}
