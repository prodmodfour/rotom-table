import { describe, expect, it } from 'vitest'
import {
  createEmptyIsometricRenderMetricsSnapshot,
  createEmptySampledWebGLRendererInfo,
  createRenderFrameReasonCounts,
  type IsometricRenderMetricsSnapshot,
} from '~/utils/isometric/renderMetrics'
import {
  createRenderMetricsOverlayViewModel,
  formatRenderMetricCount,
  formatRenderMetricDuration,
} from '~/utils/isometric/renderMetricsOverlay'

describe('render metrics overlay view model', () => {
  it('formats empty stub metrics for the hidden-by-default overlay shell', () => {
    const viewModel = createRenderMetricsOverlayViewModel(createEmptyIsometricRenderMetricsSnapshot())

    expect(viewModel.sampledAtLabel).toBe('stub sample')
    expect(viewModel.frameRows).toEqual(expect.arrayContaining([
      { key: 'frame-count', label: 'Frames', value: '0' },
      { key: 'render-count', label: 'Renders', value: '0' },
      { key: 'last-frame-duration', label: 'Last frame', value: '—' },
    ]))
    expect(viewModel.lastReasonLabels).toEqual([])
    expect(viewModel.reasonRows).toEqual([])
    expect(viewModel.pointerRows).toEqual(expect.arrayContaining([
      { key: 'pointer-move-events', label: 'Pointermove events', value: '0' },
      { key: 'raycasts', label: 'Raycasts', value: '0' },
      { key: 'pathfinding-requests', label: 'Pathfinding requests', value: '0' },
    ]))
    expect(viewModel.hasRendererInfo).toBe(false)
    expect(viewModel.rendererRows).toEqual([
      { key: 'renderer-info', label: 'Renderer info', value: 'pending' },
    ])
  })

  it('shows frame timing and reason summaries when optional metrics are supplied', () => {
    const snapshot: IsometricRenderMetricsSnapshot = {
      ...createEmptyIsometricRenderMetricsSnapshot(123.4),
      rendererInfo: null,
      frames: {
        frameCount: 5,
        renderCount: 4,
        activeAnimationFrameCount: 2,
        totalFrameDurationMs: 41,
        averageFrameDurationMs: 8.2,
        maxFrameDurationMs: 16.8,
        lastFrameDurationMs: 7.6,
        lastFrameHadActiveAnimation: true,
        lastFrameReasons: ['resize', 'animation'],
        reasonCounts: createRenderFrameReasonCounts(['resize', 'resize', 'animation']),
      },
    }

    const viewModel = createRenderMetricsOverlayViewModel(snapshot)

    expect(viewModel.sampledAtLabel).toBe('123 ms')
    expect(viewModel.lastReasonLabels).toEqual(['Renderer resize', 'Active animation frame'])
    expect(viewModel.frameRows).toEqual(expect.arrayContaining([
      { key: 'average-frame-duration', label: 'Average frame', value: '8.2 ms' },
      { key: 'max-frame-duration', label: 'Max frame', value: '16.8 ms' },
      { key: 'active-animation', label: 'Active animation', value: 'yes' },
    ]))
    expect(viewModel.reasonRows).toEqual([
      { key: 'resize', label: 'Renderer resize', value: '2' },
      { key: 'animation', label: 'Active animation frame', value: '1' },
    ])
  })

  it('shows pointer interaction summaries when optional metrics are supplied', () => {
    const snapshot = createEmptyIsometricRenderMetricsSnapshot(180)
    snapshot.pointerInteractions.pointerMoveEventCount = 9
    snapshot.pointerInteractions.pointerMoveFrameCount = 4
    snapshot.pointerInteractions.coalescedPointerMoveEventCount = 9
    snapshot.pointerInteractions.lastPointerMoveFrameCoalescedEventCount = 3
    snapshot.pointerInteractions.raycastCount = 6
    snapshot.pointerInteractions.raycastCounts['token-pick'] = 2
    snapshot.pointerInteractions.raycastCounts['movement-plane'] = 1
    snapshot.pointerInteractions.pathfindingRequestCount = 5

    const viewModel = createRenderMetricsOverlayViewModel(snapshot)

    expect(viewModel.pointerRows).toEqual(expect.arrayContaining([
      { key: 'pointer-move-events', label: 'Pointermove events', value: '9' },
      { key: 'pointer-move-frames', label: 'Processed pointer frames', value: '4' },
      { key: 'coalesced-pointer-move-events', label: 'Coalesced move events', value: '9' },
      { key: 'last-pointer-frame-events', label: 'Last pointer frame events', value: '3' },
      { key: 'raycasts', label: 'Raycasts', value: '6' },
      { key: 'raycast-token-pick', label: 'Token pick raycasts', value: '2' },
      { key: 'raycast-movement-plane', label: 'Movement plane raycasts', value: '1' },
      { key: 'pathfinding-requests', label: 'Pathfinding requests', value: '5' },
    ]))
  })

  it('includes renderer rows without sampling renderer state itself', () => {
    const rendererInfo = createEmptySampledWebGLRendererInfo(50)
    rendererInfo.memory.geometries = 3
    rendererInfo.memory.textures = 7
    rendererInfo.render.calls = 11
    rendererInfo.render.triangles = 120
    rendererInfo.render.frame = 9
    rendererInfo.programs.count = 4
    rendererInfo.autoReset = true

    const viewModel = createRenderMetricsOverlayViewModel({
      ...createEmptyIsometricRenderMetricsSnapshot(50),
      rendererInfo,
    })

    expect(viewModel.hasRendererInfo).toBe(true)
    expect(viewModel.rendererRows).toEqual(expect.arrayContaining([
      { key: 'draw-calls', label: 'Draw calls', value: '11' },
      { key: 'triangles', label: 'Triangles', value: '120' },
      { key: 'geometries', label: 'Geometries', value: '3' },
      { key: 'textures', label: 'Textures', value: '7' },
      { key: 'programs', label: 'Programs', value: '4' },
      { key: 'auto-reset', label: 'Auto reset', value: 'yes' },
    ]))
  })

  it('keeps overlay formatting defensive for optional values', () => {
    expect(formatRenderMetricCount(null)).toBe('—')
    expect(formatRenderMetricCount(Number.POSITIVE_INFINITY)).toBe('0')
    expect(formatRenderMetricCount(12.9)).toBe('12')
    expect(formatRenderMetricDuration(null)).toBe('—')
    expect(formatRenderMetricDuration(Number.NaN)).toBe('—')
    expect(formatRenderMetricDuration(4)).toBe('4.0 ms')
  })
})
