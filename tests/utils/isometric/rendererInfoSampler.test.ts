import { describe, expect, it } from 'vitest'
import { sampleWebGLRendererInfo } from '~/utils/isometric/rendererInfoSampler'

const createRendererInfoSource = () => ({
  info: {
    autoReset: false,
    memory: {
      geometries: 12,
      textures: 4,
    },
    render: {
      calls: 9,
      frame: 88,
      lines: 7,
      points: 6,
      triangles: 1234,
    },
    programs: [{ id: 'basic' }, { id: 'sprite' }],
  },
})

describe('WebGL renderer info sampler', () => {
  it('copies renderer.info counters into the render metrics model', () => {
    const renderer = createRendererInfoSource()

    expect(sampleWebGLRendererInfo(renderer, { sampledAtMs: 9876 })).toEqual({
      sampledAtMs: 9876,
      autoReset: false,
      memory: {
        geometries: 12,
        textures: 4,
      },
      render: {
        calls: 9,
        frame: 88,
        lines: 7,
        points: 6,
        triangles: 1234,
      },
      programs: {
        count: 2,
      },
    })
  })

  it('uses an injectable clock when no explicit timestamp is provided', () => {
    const sample = sampleWebGLRendererInfo(createRendererInfoSource(), { now: () => 321 })

    expect(sample?.sampledAtMs).toBe(321)
  })

  it('returns null when no renderer info is available', () => {
    expect(sampleWebGLRendererInfo(null, { sampledAtMs: 1 })).toBeNull()
    expect(sampleWebGLRendererInfo(undefined, { sampledAtMs: 1 })).toBeNull()
    expect(sampleWebGLRendererInfo({}, { sampledAtMs: 1 })).toBeNull()
    expect(sampleWebGLRendererInfo({ info: null }, { sampledAtMs: 1 })).toBeNull()
  })

  it('falls back safely for missing or non-finite renderer.info fields', () => {
    const sample = sampleWebGLRendererInfo({
      info: {
        autoReset: 'yes',
        memory: {
          geometries: Number.NaN,
          textures: Number.POSITIVE_INFINITY,
        },
        render: {
          calls: '3',
          frame: undefined,
          lines: null,
          points: Number.NEGATIVE_INFINITY,
          triangles: 0,
        },
        programs: null,
      },
    }, { sampledAtMs: Number.NaN, now: () => 55 })

    expect(sample).toEqual({
      sampledAtMs: 55,
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
  })

  it('does not retain renderer-owned nested info objects', () => {
    const renderer = createRendererInfoSource()
    const sample = sampleWebGLRendererInfo(renderer, { sampledAtMs: 1 })

    expect(sample?.memory).not.toBe(renderer.info.memory)
    expect(sample?.render).not.toBe(renderer.info.render)
    expect(sample?.programs).not.toBe(renderer.info.programs)

    renderer.info.memory.geometries = 99
    renderer.info.render.calls = 99
    renderer.info.programs.push({ id: 'later' })

    expect(sample?.memory.geometries).toBe(12)
    expect(sample?.render.calls).toBe(9)
    expect(sample?.programs.count).toBe(2)
  })
})
