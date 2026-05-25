export interface CoalescedPointerEventData {
  clientX: number
  clientY: number
  pageX: number
  pageY: number
  screenX: number
  screenY: number
  movementX: number
  movementY: number
  button: number
  buttons: number
  pointerId: number
  pointerType: string
  isPrimary: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  timeStamp: number
}

export type PointerEventDataSource = Pick<PointerEvent, 'clientX' | 'clientY'> &
  Partial<Pick<PointerEvent,
    | 'pageX'
    | 'pageY'
    | 'screenX'
    | 'screenY'
    | 'movementX'
    | 'movementY'
    | 'button'
    | 'buttons'
    | 'pointerId'
    | 'pointerType'
    | 'isPrimary'
    | 'altKey'
    | 'ctrlKey'
    | 'metaKey'
    | 'shiftKey'
    | 'timeStamp'
  >>

export type PointerEventCoalescerFrameCallback = (timestampMs: number) => void

export type PointerEventCoalescerRequestAnimationFrame = (
  callback: PointerEventCoalescerFrameCallback,
) => number

export type PointerEventCoalescerCancelAnimationFrame = (frameHandle: number) => void

export interface CoalescedPointerEventFrame<
  TPointerData extends object = CoalescedPointerEventData,
> {
  timestampMs: number
  event: Readonly<TPointerData>
  coalescedEventCount: number
}

export interface PointerEventCoalescerOptions<
  TPointerData extends object = CoalescedPointerEventData,
> {
  processFrame: (frame: CoalescedPointerEventFrame<TPointerData>) => void
  copyEventData?: (event: PointerEvent) => TPointerData
  requestAnimationFrame?: PointerEventCoalescerRequestAnimationFrame
  cancelAnimationFrame?: PointerEventCoalescerCancelAnimationFrame
}

export interface PointerEventCoalescerSnapshot<
  TPointerData extends object = CoalescedPointerEventData,
> {
  isFramePending: boolean
  hasPendingEvent: boolean
  pendingEventCount: number
  latestEvent: Readonly<TPointerData> | null
  isDisposed: boolean
}

export interface PointerEventCoalescer<
  TPointerData extends object = CoalescedPointerEventData,
> {
  queue: (event: PointerEvent) => PointerEventCoalescerSnapshot<TPointerData>
  cancel: () => PointerEventCoalescerSnapshot<TPointerData>
  dispose: () => PointerEventCoalescerSnapshot<TPointerData>
  snapshot: () => PointerEventCoalescerSnapshot<TPointerData>
}

const browserSafeRequestAnimationFrame: PointerEventCoalescerRequestAnimationFrame = (callback) => {
  const requestFrame = globalThis.requestAnimationFrame

  if (typeof requestFrame === 'function') {
    return requestFrame.call(globalThis, callback)
  }

  return globalThis.setTimeout(() => callback(Date.now()), 16) as unknown as number
}

const browserSafeCancelAnimationFrame: PointerEventCoalescerCancelAnimationFrame = (frameHandle) => {
  const cancelFrame = globalThis.cancelAnimationFrame

  if (typeof cancelFrame === 'function') {
    cancelFrame.call(globalThis, frameHandle)
    return
  }

  globalThis.clearTimeout(frameHandle as unknown as ReturnType<typeof setTimeout>)
}

const finiteNumberOrZero = (value: unknown): number => (
  typeof value === 'number' && Number.isFinite(value) ? value : 0
)

const stringOrEmpty = (value: unknown): string => (
  typeof value === 'string' ? value : ''
)

const cloneEventData = <TPointerData extends object>(eventData: TPointerData | null): TPointerData | null => (
  eventData ? { ...eventData } : null
)

export const copyCoalescedPointerEventData = (
  event: PointerEventDataSource,
): CoalescedPointerEventData => ({
  clientX: finiteNumberOrZero(event.clientX),
  clientY: finiteNumberOrZero(event.clientY),
  pageX: finiteNumberOrZero(event.pageX),
  pageY: finiteNumberOrZero(event.pageY),
  screenX: finiteNumberOrZero(event.screenX),
  screenY: finiteNumberOrZero(event.screenY),
  movementX: finiteNumberOrZero(event.movementX),
  movementY: finiteNumberOrZero(event.movementY),
  button: finiteNumberOrZero(event.button),
  buttons: finiteNumberOrZero(event.buttons),
  pointerId: finiteNumberOrZero(event.pointerId),
  pointerType: stringOrEmpty(event.pointerType),
  isPrimary: event.isPrimary === true,
  altKey: event.altKey === true,
  ctrlKey: event.ctrlKey === true,
  metaKey: event.metaKey === true,
  shiftKey: event.shiftKey === true,
  timeStamp: finiteNumberOrZero(event.timeStamp),
})

export const createPointerEventCoalescer = <
  TPointerData extends object = CoalescedPointerEventData,
>({
  processFrame,
  copyEventData,
  requestAnimationFrame = browserSafeRequestAnimationFrame,
  cancelAnimationFrame = browserSafeCancelAnimationFrame,
}: PointerEventCoalescerOptions<TPointerData>): PointerEventCoalescer<TPointerData> => {
  const resolveEventData = (copyEventData ?? copyCoalescedPointerEventData) as unknown as (
    event: PointerEvent,
  ) => TPointerData
  let frameHandle: number | null = null
  let latestEvent: TPointerData | null = null
  let pendingEventCount = 0
  let isDisposed = false

  const snapshot = (): PointerEventCoalescerSnapshot<TPointerData> => ({
    isFramePending: frameHandle !== null,
    hasPendingEvent: latestEvent !== null,
    pendingEventCount,
    latestEvent: cloneEventData(latestEvent),
    isDisposed,
  })

  const cancelFrameHandle = () => {
    if (frameHandle === null) return

    cancelAnimationFrame(frameHandle)
    frameHandle = null
  }

  const scheduleFrame = () => {
    if (isDisposed || frameHandle !== null || latestEvent === null) return

    frameHandle = requestAnimationFrame(runFrame)
  }

  const clearPendingEvent = () => {
    latestEvent = null
    pendingEventCount = 0
  }

  const runFrame = (timestampMs: number) => {
    frameHandle = null

    if (isDisposed || latestEvent === null) return

    const event = latestEvent
    const coalescedEventCount = pendingEventCount
    clearPendingEvent()

    processFrame({
      timestampMs,
      event: cloneEventData(event) ?? event,
      coalescedEventCount,
    })
  }

  const queue = (event: PointerEvent): PointerEventCoalescerSnapshot<TPointerData> => {
    if (isDisposed) return snapshot()

    latestEvent = resolveEventData(event)
    pendingEventCount += 1
    scheduleFrame()

    return snapshot()
  }

  const cancel = (): PointerEventCoalescerSnapshot<TPointerData> => {
    cancelFrameHandle()
    clearPendingEvent()

    return snapshot()
  }

  const dispose = (): PointerEventCoalescerSnapshot<TPointerData> => {
    cancel()
    isDisposed = true

    return snapshot()
  }

  return {
    queue,
    cancel,
    dispose,
    snapshot,
  }
}
