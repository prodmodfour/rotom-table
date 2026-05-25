import {
  ISOMETRIC_POINTER_RAYCAST_KIND_LABELS,
  ISOMETRIC_POINTER_RAYCAST_KINDS,
  ISOMETRIC_RENDER_FRAME_REASON_LABELS,
  ISOMETRIC_RENDER_FRAME_REASONS,
  type IsometricRenderMetricsSnapshot,
  type PointerInteractionMetrics,
  type RenderFrameReason,
  type RenderFrameTimingMetrics,
  type SampledWebGLRendererInfo,
} from '~/utils/isometric/renderMetrics'

export interface RenderMetricsOverlayRow {
  key: string
  label: string
  value: string
  title?: string
}

export interface RenderMetricsOverlayViewModel {
  sampledAtLabel: string
  frameRows: RenderMetricsOverlayRow[]
  lastReasonLabels: string[]
  reasonRows: RenderMetricsOverlayRow[]
  pointerRows: RenderMetricsOverlayRow[]
  rendererRows: RenderMetricsOverlayRow[]
  hasRendererInfo: boolean
}

const sanitizeMetricNumber = (value: number): number => (
  Number.isFinite(value) ? Math.max(0, value) : 0
)

export const formatRenderMetricCount = (value: number | null | undefined): string => {
  if (value == null) return '—'

  return String(Math.trunc(sanitizeMetricNumber(value)))
}

export const formatRenderMetricDuration = (value: number | null | undefined): string => {
  if (value == null || !Number.isFinite(value)) return '—'

  return `${sanitizeMetricNumber(value).toFixed(1)} ms`
}

const formatRenderMetricBoolean = (value: boolean | null | undefined): string => {
  if (value == null) return '—'

  return value ? 'yes' : 'no'
}

const formatSampleTimestamp = (sampledAtMs: number): string => {
  if (!Number.isFinite(sampledAtMs) || sampledAtMs <= 0) return 'stub sample'

  return `${Math.round(sampledAtMs)} ms`
}

const frameReasonLabel = (reason: RenderFrameReason): string => ISOMETRIC_RENDER_FRAME_REASON_LABELS[reason]

export const createRenderMetricsFrameRows = (
  frames: RenderFrameTimingMetrics,
): RenderMetricsOverlayRow[] => ([
  { key: 'frame-count', label: 'Frames', value: formatRenderMetricCount(frames.frameCount) },
  { key: 'render-count', label: 'Renders', value: formatRenderMetricCount(frames.renderCount) },
  {
    key: 'active-animation-frames',
    label: 'Animated frames',
    value: formatRenderMetricCount(frames.activeAnimationFrameCount),
  },
  {
    key: 'last-frame-duration',
    label: 'Last frame',
    value: formatRenderMetricDuration(frames.lastFrameDurationMs),
  },
  {
    key: 'average-frame-duration',
    label: 'Average frame',
    value: formatRenderMetricDuration(frames.averageFrameDurationMs),
  },
  {
    key: 'max-frame-duration',
    label: 'Max frame',
    value: formatRenderMetricDuration(frames.maxFrameDurationMs),
  },
  {
    key: 'active-animation',
    label: 'Active animation',
    value: formatRenderMetricBoolean(frames.lastFrameHadActiveAnimation),
  },
])

export const createRenderMetricsReasonRows = (
  frames: RenderFrameTimingMetrics,
): RenderMetricsOverlayRow[] => (
  ISOMETRIC_RENDER_FRAME_REASONS
    .map((reason) => {
      const count = frames.reasonCounts[reason] ?? 0

      return {
        key: reason,
        label: frameReasonLabel(reason),
        value: formatRenderMetricCount(count),
      }
    })
    .filter((row) => row.value !== '0')
)

export const createRenderMetricsPointerRows = (
  pointerInteractions: PointerInteractionMetrics,
): RenderMetricsOverlayRow[] => [
  {
    key: 'pointer-move-events',
    label: 'Pointermove events',
    value: formatRenderMetricCount(pointerInteractions.pointerMoveEventCount),
  },
  {
    key: 'pointer-move-frames',
    label: 'Processed pointer frames',
    value: formatRenderMetricCount(pointerInteractions.pointerMoveFrameCount),
  },
  {
    key: 'coalesced-pointer-move-events',
    label: 'Coalesced move events',
    value: formatRenderMetricCount(pointerInteractions.coalescedPointerMoveEventCount),
  },
  {
    key: 'last-pointer-frame-events',
    label: 'Last pointer frame events',
    value: formatRenderMetricCount(pointerInteractions.lastPointerMoveFrameCoalescedEventCount),
  },
  {
    key: 'raycasts',
    label: 'Raycasts',
    value: formatRenderMetricCount(pointerInteractions.raycastCount),
  },
  ...ISOMETRIC_POINTER_RAYCAST_KINDS.map((kind) => ({
    key: `raycast-${kind}`,
    label: ISOMETRIC_POINTER_RAYCAST_KIND_LABELS[kind],
    value: formatRenderMetricCount(pointerInteractions.raycastCounts[kind] ?? 0),
  })),
  {
    key: 'pathfinding-requests',
    label: 'Pathfinding requests',
    value: formatRenderMetricCount(pointerInteractions.pathfindingRequestCount),
  },
]

export const createRenderMetricsRendererRows = (
  rendererInfo: SampledWebGLRendererInfo | null,
): RenderMetricsOverlayRow[] => {
  if (!rendererInfo) {
    return [{ key: 'renderer-info', label: 'Renderer info', value: 'pending' }]
  }

  return [
    { key: 'draw-calls', label: 'Draw calls', value: formatRenderMetricCount(rendererInfo.render.calls) },
    { key: 'triangles', label: 'Triangles', value: formatRenderMetricCount(rendererInfo.render.triangles) },
    { key: 'lines', label: 'Lines', value: formatRenderMetricCount(rendererInfo.render.lines) },
    { key: 'points', label: 'Points', value: formatRenderMetricCount(rendererInfo.render.points) },
    { key: 'render-frame', label: 'Renderer frame', value: formatRenderMetricCount(rendererInfo.render.frame) },
    { key: 'geometries', label: 'Geometries', value: formatRenderMetricCount(rendererInfo.memory.geometries) },
    { key: 'textures', label: 'Textures', value: formatRenderMetricCount(rendererInfo.memory.textures) },
    { key: 'programs', label: 'Programs', value: formatRenderMetricCount(rendererInfo.programs.count) },
    { key: 'auto-reset', label: 'Auto reset', value: formatRenderMetricBoolean(rendererInfo.autoReset) },
  ]
}

export const createRenderMetricsOverlayViewModel = (
  snapshot: IsometricRenderMetricsSnapshot,
): RenderMetricsOverlayViewModel => ({
  sampledAtLabel: formatSampleTimestamp(snapshot.sampledAtMs),
  frameRows: createRenderMetricsFrameRows(snapshot.frames),
  lastReasonLabels: snapshot.frames.lastFrameReasons.map(frameReasonLabel),
  reasonRows: createRenderMetricsReasonRows(snapshot.frames),
  pointerRows: createRenderMetricsPointerRows(snapshot.pointerInteractions),
  rendererRows: createRenderMetricsRendererRows(snapshot.rendererInfo),
  hasRendererInfo: Boolean(snapshot.rendererInfo),
})
