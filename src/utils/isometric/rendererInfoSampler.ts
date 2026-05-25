import type { SampledWebGLRendererInfo } from './renderMetrics'

export interface WebGLRendererInfoMemoryLike {
  geometries?: unknown
  textures?: unknown
}

export interface WebGLRendererInfoRenderLike {
  calls?: unknown
  frame?: unknown
  lines?: unknown
  points?: unknown
  triangles?: unknown
}

export interface WebGLRendererInfoLike {
  autoReset?: unknown
  memory?: WebGLRendererInfoMemoryLike | null
  render?: WebGLRendererInfoRenderLike | null
  programs?: unknown
}

export interface WebGLRendererInfoSourceLike {
  info?: WebGLRendererInfoLike | null
}

export interface SampleWebGLRendererInfoOptions {
  /** Deterministic timestamp override for tests or externally batched samples. */
  sampledAtMs?: number
  /** Injectable clock used when sampledAtMs is not provided. */
  now?: () => number
}

const readFiniteNumber = (value: unknown): number => (
  typeof value === 'number' && Number.isFinite(value) ? value : 0
)

const resolveSampledAtMs = ({ sampledAtMs, now = Date.now }: SampleWebGLRendererInfoOptions): number => (
  typeof sampledAtMs === 'number' && Number.isFinite(sampledAtMs) ? sampledAtMs : now()
)

/**
 * Copies the serialisable counters exposed by Three.js `renderer.info` into the
 * developer-only metrics model without retaining renderer-owned references.
 */
export const sampleWebGLRendererInfo = (
  renderer: WebGLRendererInfoSourceLike | null | undefined,
  options: SampleWebGLRendererInfoOptions = {},
): SampledWebGLRendererInfo | null => {
  const info = renderer?.info

  if (!info) {
    return null
  }

  const memory = info.memory ?? {}
  const render = info.render ?? {}

  return {
    sampledAtMs: resolveSampledAtMs(options),
    autoReset: typeof info.autoReset === 'boolean' ? info.autoReset : null,
    memory: {
      geometries: readFiniteNumber(memory.geometries),
      textures: readFiniteNumber(memory.textures),
    },
    render: {
      calls: readFiniteNumber(render.calls),
      frame: readFiniteNumber(render.frame),
      lines: readFiniteNumber(render.lines),
      points: readFiniteNumber(render.points),
      triangles: readFiniteNumber(render.triangles),
    },
    programs: {
      count: Array.isArray(info.programs) ? info.programs.length : null,
    },
  }
}
