import { describe, expect, it } from 'vitest'
import { ISOMETRIC_RENDER_FRAME_REASONS } from '~/utils/isometric/renderMetrics'
import {
  ISOMETRIC_CSS3D_RENDER_INVALIDATION_REASONS,
  ISOMETRIC_RENDER_DIRTY_LAYERS,
  ISOMETRIC_RENDER_INVALIDATION_REASON_LAYERS,
  ISOMETRIC_RENDER_INVALIDATION_REASONS,
  ISOMETRIC_RENDER_INVALIDATION_REASON_LABELS,
  ISOMETRIC_WEBGL_RENDER_INVALIDATION_REASONS,
  appendRenderInvalidationReason,
  createIsometricRenderDirtyLayers,
  createRenderInvalidationReasons,
  hasRenderInvalidationReason,
  isIsometricRenderDirtyLayer,
  isRenderInvalidationReason,
  mergeIsometricRenderDirtyLayers,
  mergeRenderInvalidationReasons,
  renderInvalidationLayersIncludeCss3D,
  renderInvalidationLayersIncludeWebGL,
  renderInvalidationReasonAffectsCss3D,
  renderInvalidationReasonAffectsWebGL,
  resolveRenderInvalidationLayers,
  resolveRenderInvalidationReasonLayers,
  type RenderInvalidationReason,
} from '~/utils/isometric/renderInvalidation'

const generatedReasons = function* (): Generator<RenderInvalidationReason> {
  yield 'pointer'
  yield 'resize'
  yield 'pointer'
  yield 'camera'
}

describe('render invalidation reasons', () => {
  it('defines labelled invalidation reasons for scheduler and metrics use', () => {
    expect(new Set(ISOMETRIC_RENDER_INVALIDATION_REASONS).size)
      .toBe(ISOMETRIC_RENDER_INVALIDATION_REASONS.length)
    expect(Object.keys(ISOMETRIC_RENDER_INVALIDATION_REASON_LABELS).sort()).toEqual(
      [...ISOMETRIC_RENDER_INVALIDATION_REASONS].sort(),
    )
    expect(ISOMETRIC_RENDER_INVALIDATION_REASON_LABELS.resize).toContain('resize')
    expect(ISOMETRIC_RENDER_INVALIDATION_REASON_LABELS['hidden-tab-resume']).toContain('Hidden tab')
    expect(ISOMETRIC_RENDER_FRAME_REASONS).toBe(ISOMETRIC_RENDER_INVALIDATION_REASONS)
  })

  it('narrows unknown values to known invalidation reasons and dirty layers', () => {
    expect(isRenderInvalidationReason('camera')).toBe(true)
    expect(isRenderInvalidationReason('hazards')).toBe(true)
    expect(isRenderInvalidationReason('token-texture')).toBe(true)
    expect(isRenderInvalidationReason('controller-build-note')).toBe(false)
    expect(isRenderInvalidationReason(undefined)).toBe(false)

    expect(isIsometricRenderDirtyLayer('webgl')).toBe(true)
    expect(isIsometricRenderDirtyLayer('css3d')).toBe(true)
    expect(isIsometricRenderDirtyLayer('canvas2d')).toBe(false)
  })

  it('classifies invalidation reasons by WebGL and CSS3D dirty layers', () => {
    expect(new Set(ISOMETRIC_RENDER_DIRTY_LAYERS).size).toBe(ISOMETRIC_RENDER_DIRTY_LAYERS.length)
    expect(ISOMETRIC_RENDER_INVALIDATION_REASON_LAYERS.camera).toEqual(['webgl', 'css3d'])
    expect(ISOMETRIC_RENDER_INVALIDATION_REASON_LAYERS.weather).toEqual(['webgl'])
    expect(ISOMETRIC_RENDER_INVALIDATION_REASON_LAYERS['token-style']).toEqual(['webgl', 'css3d'])
    expect(ISOMETRIC_RENDER_INVALIDATION_REASON_LAYERS.animation).toEqual(['webgl'])

    const webglReasons: readonly RenderInvalidationReason[] = ISOMETRIC_WEBGL_RENDER_INVALIDATION_REASONS
    const css3DReasons: readonly RenderInvalidationReason[] = ISOMETRIC_CSS3D_RENDER_INVALIDATION_REASONS

    for (const reason of ISOMETRIC_RENDER_INVALIDATION_REASONS) {
      expect(resolveRenderInvalidationReasonLayers(reason).length).toBeGreaterThan(0)
      expect(renderInvalidationReasonAffectsWebGL(reason)).toBe(webglReasons.includes(reason))
      expect(renderInvalidationReasonAffectsCss3D(reason)).toBe(css3DReasons.includes(reason))
    }
  })

  it('merges dirty layers from reasons while preserving first-seen order', () => {
    expect(resolveRenderInvalidationLayers(['weather', 'camera', 'token-style'])).toEqual(['webgl', 'css3d'])
    expect(resolveRenderInvalidationLayers(['camera', 'weather'])).toEqual(['webgl', 'css3d'])
    expect(resolveRenderInvalidationLayers(['weather', 'field-effect'])).toEqual(['webgl'])

    const layers = createIsometricRenderDirtyLayers(['css3d', 'webgl', 'css3d'])
    expect(layers).toEqual(['css3d', 'webgl'])
    expect(mergeIsometricRenderDirtyLayers(['webgl'], undefined, ['css3d', 'webgl'])).toEqual(['webgl', 'css3d'])
    expect(renderInvalidationLayersIncludeWebGL(layers)).toBe(true)
    expect(renderInvalidationLayersIncludeCss3D(layers)).toBe(true)
  })

  it('creates deduplicated reason arrays from iterables while preserving first-seen order', () => {
    expect(createRenderInvalidationReasons(generatedReasons())).toEqual([
      'pointer',
      'resize',
      'camera',
    ])
    expect(createRenderInvalidationReasons()).toEqual([])
  })

  it('merges multiple reason groups without mutating source collections', () => {
    const first: RenderInvalidationReason[] = ['resize', 'tokens', 'resize']
    const second = new Set<RenderInvalidationReason>(['tokens', 'weather', 'debug'])

    const merged = mergeRenderInvalidationReasons(
      first,
      undefined,
      second,
      null,
      ['camera', 'weather'],
    )

    expect(merged).toEqual(['resize', 'tokens', 'weather', 'debug', 'camera'])
    expect(merged).not.toBe(first)
    expect(first).toEqual(['resize', 'tokens', 'resize'])
    expect([...second]).toEqual(['tokens', 'weather', 'debug'])
  })

  it('appends one reason immutably and leaves duplicates deduplicated', () => {
    const reasons: RenderInvalidationReason[] = ['resize', 'tokens']

    const appended = appendRenderInvalidationReason(reasons, 'camera')
    const duplicate = appendRenderInvalidationReason(reasons, 'resize')

    expect(appended).toEqual(['resize', 'tokens', 'camera'])
    expect(duplicate).toEqual(['resize', 'tokens'])
    expect(appended).not.toBe(reasons)
    expect(duplicate).not.toBe(reasons)
    expect(reasons).toEqual(['resize', 'tokens'])
  })

  it('checks reason membership without requiring arrays', () => {
    expect(hasRenderInvalidationReason(generatedReasons(), 'camera')).toBe(true)
    expect(hasRenderInvalidationReason(generatedReasons(), 'weather')).toBe(false)
  })
})
