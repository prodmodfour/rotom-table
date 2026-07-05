/**
 * Intent-only constants for the persistent UV-based fake-lighting pass on
 * normal world sprites. These values stay subtle so Pokémon gain a little
 * isometric shape without looking visibly recoloured.
 */
export const WORLD_SPRITE_ISO_LIGHTING_TOP_BRIGHTNESS_BOOST = 0.06
export const WORLD_SPRITE_ISO_LIGHTING_LOWER_FRONT_DARKENING = 0.055
export const WORLD_SPRITE_ISO_LIGHTING_SIDE_TO_SIDE_BIAS = 0.035
export const WORLD_SPRITE_ISO_LIGHTING_FOOT_BASE_DARKENING = 0.04
export const WORLD_SPRITE_ISO_LIGHTING_MIN_BRIGHTNESS_MULTIPLIER = 0.86
export const WORLD_SPRITE_ISO_LIGHTING_MAX_BRIGHTNESS_MULTIPLIER = 1.08
export const WORLD_SPRITE_ISO_LIGHTING_SHADER_CACHE_KEY = 'world-sprite-iso-lighting-v2'

export interface WorldSpriteIsoLightingShape {
  topBrightnessBoost: number
  lowerFrontDarkening: number
  sideToSideBias: number
  footBaseDarkening: number
  minBrightnessMultiplier: number
  maxBrightnessMultiplier: number
}

export const WORLD_SPRITE_ISO_LIGHTING_SHAPE = Object.freeze({
  topBrightnessBoost: WORLD_SPRITE_ISO_LIGHTING_TOP_BRIGHTNESS_BOOST,
  lowerFrontDarkening: WORLD_SPRITE_ISO_LIGHTING_LOWER_FRONT_DARKENING,
  sideToSideBias: WORLD_SPRITE_ISO_LIGHTING_SIDE_TO_SIDE_BIAS,
  footBaseDarkening: WORLD_SPRITE_ISO_LIGHTING_FOOT_BASE_DARKENING,
  minBrightnessMultiplier: WORLD_SPRITE_ISO_LIGHTING_MIN_BRIGHTNESS_MULTIPLIER,
  maxBrightnessMultiplier: WORLD_SPRITE_ISO_LIGHTING_MAX_BRIGHTNESS_MULTIPLIER,
}) satisfies Readonly<WorldSpriteIsoLightingShape>

export interface WorldSpriteIsoLightingShader {
  vertexShader: string
  fragmentShader: string
  uniforms: Record<string, { value: unknown }>
}

export interface WorldSpriteIsoLightingRuntime {
  readonly mirrorXUniform: { value: number }
}

export const createWorldSpriteIsoLightingRuntime = (
  mirroredX = false,
): WorldSpriteIsoLightingRuntime => ({
  mirrorXUniform: { value: mirroredX ? 1 : 0 },
})

export const setWorldSpriteIsoLightingMirrorX = (
  runtime: WorldSpriteIsoLightingRuntime | null | undefined,
  mirroredX: boolean,
): void => {
  if (!runtime) return
  runtime.mirrorXUniform.value = mirroredX ? 1 : 0
}

const WORLD_SPRITE_ISO_LIGHTING_VERTEX_VARYING = 'varying vec2 vWorldSpriteIsoUv;'
const WORLD_SPRITE_ISO_LIGHTING_VERTEX_ASSIGNMENT = 'vWorldSpriteIsoUv = uv;'
const WORLD_SPRITE_ISO_LIGHTING_FRAGMENT_HELPERS = `
varying vec2 vWorldSpriteIsoUv;
uniform float worldSpriteIsoTopBrightnessBoost;
uniform float worldSpriteIsoLowerFrontDarkening;
uniform float worldSpriteIsoSideToSideBias;
uniform float worldSpriteIsoFootBaseDarkening;
uniform float worldSpriteIsoMinBrightnessMultiplier;
uniform float worldSpriteIsoMaxBrightnessMultiplier;
uniform float worldSpriteIsoMirrorX;

vec2 worldSpriteIsoLightingUv(vec2 uv) {
  return vec2(mix(uv.x, 1.0 - uv.x, worldSpriteIsoMirrorX), uv.y);
}

float worldSpriteIsoLightingMultiplier(vec2 uv) {
  vec2 lightingUv = worldSpriteIsoLightingUv(uv);
  float upperLight = smoothstep(0.45, 1.0, lightingUv.y);
  float lowerFront = 1.0 - smoothstep(0.0, 0.58, lightingUv.y);
  float sideShadow = smoothstep(0.28, 1.0, lightingUv.x);
  float footGrounding = 1.0 - smoothstep(0.0, 0.22, lightingUv.y);
  float multiplier = 1.0
    + (upperLight * worldSpriteIsoTopBrightnessBoost)
    - (lowerFront * worldSpriteIsoLowerFrontDarkening)
    - (sideShadow * worldSpriteIsoSideToSideBias)
    - (footGrounding * worldSpriteIsoFootBaseDarkening);
  return clamp(
    multiplier,
    worldSpriteIsoMinBrightnessMultiplier,
    worldSpriteIsoMaxBrightnessMultiplier
  );
}
`.trim()
const WORLD_SPRITE_ISO_LIGHTING_FRAGMENT_APPLICATION =
  'diffuseColor.rgb *= worldSpriteIsoLightingMultiplier(vWorldSpriteIsoUv);'
const WORLD_SPRITE_ISO_LIGHTING_UNIFORM_VALUES = {
  worldSpriteIsoTopBrightnessBoost: WORLD_SPRITE_ISO_LIGHTING_SHAPE.topBrightnessBoost,
  worldSpriteIsoLowerFrontDarkening: WORLD_SPRITE_ISO_LIGHTING_SHAPE.lowerFrontDarkening,
  worldSpriteIsoSideToSideBias: WORLD_SPRITE_ISO_LIGHTING_SHAPE.sideToSideBias,
  worldSpriteIsoFootBaseDarkening: WORLD_SPRITE_ISO_LIGHTING_SHAPE.footBaseDarkening,
  worldSpriteIsoMinBrightnessMultiplier: WORLD_SPRITE_ISO_LIGHTING_SHAPE.minBrightnessMultiplier,
  worldSpriteIsoMaxBrightnessMultiplier: WORLD_SPRITE_ISO_LIGHTING_SHAPE.maxBrightnessMultiplier,
} satisfies Record<string, number>

const appendAfterShaderChunk = (source: string, chunk: string, snippet: string): string => {
  if (source.includes(snippet)) return source
  return source.replace(chunk, `${chunk}\n\t${snippet}`)
}

export const applyWorldSpriteIsoLightingShader = (
  shader: WorldSpriteIsoLightingShader,
  runtime: WorldSpriteIsoLightingRuntime = createWorldSpriteIsoLightingRuntime(),
): void => {
  for (const [name, value] of Object.entries(WORLD_SPRITE_ISO_LIGHTING_UNIFORM_VALUES)) {
    shader.uniforms[name] = { value }
  }
  shader.uniforms.worldSpriteIsoMirrorX = runtime.mirrorXUniform

  shader.vertexShader = appendAfterShaderChunk(
    shader.vertexShader,
    '#include <common>',
    WORLD_SPRITE_ISO_LIGHTING_VERTEX_VARYING,
  )
  shader.vertexShader = appendAfterShaderChunk(
    shader.vertexShader,
    '#include <uv_vertex>',
    WORLD_SPRITE_ISO_LIGHTING_VERTEX_ASSIGNMENT,
  )
  shader.fragmentShader = appendAfterShaderChunk(
    shader.fragmentShader,
    '#include <common>',
    WORLD_SPRITE_ISO_LIGHTING_FRAGMENT_HELPERS,
  )
  shader.fragmentShader = appendAfterShaderChunk(
    shader.fragmentShader,
    '#include <map_fragment>',
    WORLD_SPRITE_ISO_LIGHTING_FRAGMENT_APPLICATION,
  )
}
