/**
 * Developer-only data model for Track 1 isometric render instrumentation.
 *
 * These types and helpers intentionally do not read browser state, sample a
 * Three.js renderer, or render UI. Runtime code can opt into filling this
 * model only when debug instrumentation is enabled.
 */
export const ISOMETRIC_RENDER_FRAME_REASONS = [
  'initial',
  'manual',
  'resize',
  'camera',
  'scene-state',
  'terrain',
  'tokens',
  'token-texture',
  'token-style',
  'movement-preview',
  'build-preview',
  'hazard-preview',
  'targeting',
  'field-effect',
  'weather',
  'layer-visibility',
  'pointer',
  'animation',
  'hidden-tab-resume',
  'debug',
] as const

export type RenderFrameReason = typeof ISOMETRIC_RENDER_FRAME_REASONS[number]

export type RenderFrameReasonCounts = Partial<Record<RenderFrameReason, number>>

export const ISOMETRIC_RENDER_FRAME_REASON_LABELS: Record<RenderFrameReason, string> = {
  initial: 'Initial render',
  manual: 'Manual render request',
  resize: 'Renderer resize',
  camera: 'Camera or controls changed',
  'scene-state': 'Map scene state changed',
  terrain: 'Terrain changed',
  tokens: 'Token objects changed',
  'token-texture': 'Token texture loaded',
  'token-style': 'Token style or HUD changed',
  'movement-preview': 'Movement preview changed',
  'build-preview': 'Build preview changed',
  'hazard-preview': 'Hazard preview changed',
  targeting: 'Targeting state changed',
  'field-effect': 'Field effect changed',
  weather: 'Weather changed',
  'layer-visibility': 'Layer visibility changed',
  pointer: 'Pointer interaction changed',
  animation: 'Active animation frame',
  'hidden-tab-resume': 'Hidden tab resumed',
  debug: 'Debug instrumentation',
}

const ISOMETRIC_RENDER_FRAME_REASON_SET = new Set<string>(ISOMETRIC_RENDER_FRAME_REASONS)

export interface RenderFrameTimingMetrics {
  frameCount: number
  renderCount: number
  activeAnimationFrameCount: number
  totalFrameDurationMs: number
  averageFrameDurationMs: number | null
  maxFrameDurationMs: number
  lastFrameDurationMs: number | null
  lastFrameHadActiveAnimation: boolean
  lastFrameReasons: RenderFrameReason[]
  reasonCounts: RenderFrameReasonCounts
}

export interface SampledWebGLRendererMemoryInfo {
  geometries: number
  textures: number
}

export interface SampledWebGLRendererRenderInfo {
  calls: number
  frame: number
  lines: number
  points: number
  triangles: number
}

export interface SampledWebGLRendererProgramInfo {
  /** Null means the renderer did not expose program details for this sample. */
  count: number | null
}

export interface SampledWebGLRendererInfo {
  sampledAtMs: number
  autoReset: boolean | null
  memory: SampledWebGLRendererMemoryInfo
  render: SampledWebGLRendererRenderInfo
  programs: SampledWebGLRendererProgramInfo
}

export interface IsometricRenderMetricsSnapshot {
  /** Marker to keep this model scoped to explicit debug/developer instrumentation. */
  devOnly: true
  sampledAtMs: number
  frames: RenderFrameTimingMetrics
  rendererInfo: SampledWebGLRendererInfo | null
}

export const isRenderFrameReason = (value: unknown): value is RenderFrameReason => (
  typeof value === 'string' && ISOMETRIC_RENDER_FRAME_REASON_SET.has(value)
)

export const createEmptyRenderFrameReasonCounts = (): RenderFrameReasonCounts => ({})

export const incrementRenderFrameReasonCount = (
  counts: RenderFrameReasonCounts,
  reason: RenderFrameReason,
  increment = 1,
): RenderFrameReasonCounts => ({
  ...counts,
  [reason]: (counts[reason] ?? 0) + increment,
})

export const createRenderFrameReasonCounts = (
  reasons: Iterable<RenderFrameReason> = [],
): RenderFrameReasonCounts => {
  let counts = createEmptyRenderFrameReasonCounts()

  for (const reason of reasons) {
    counts = incrementRenderFrameReasonCount(counts, reason)
  }

  return counts
}

export const createEmptyRenderFrameTimingMetrics = (): RenderFrameTimingMetrics => ({
  frameCount: 0,
  renderCount: 0,
  activeAnimationFrameCount: 0,
  totalFrameDurationMs: 0,
  averageFrameDurationMs: null,
  maxFrameDurationMs: 0,
  lastFrameDurationMs: null,
  lastFrameHadActiveAnimation: false,
  lastFrameReasons: [],
  reasonCounts: createEmptyRenderFrameReasonCounts(),
})

export const createEmptySampledWebGLRendererInfo = (sampledAtMs = 0): SampledWebGLRendererInfo => ({
  sampledAtMs,
  autoReset: null,
  memory: {
    geometries: 0,
    textures: 0,
  },
  render: {
    calls: 0,
    frame: 0,
    lines: 0,
    points: 0,
    triangles: 0,
  },
  programs: {
    count: null,
  },
})

export const createEmptyIsometricRenderMetricsSnapshot = (
  sampledAtMs = 0,
): IsometricRenderMetricsSnapshot => ({
  devOnly: true,
  sampledAtMs,
  frames: createEmptyRenderFrameTimingMetrics(),
  rendererInfo: null,
})
