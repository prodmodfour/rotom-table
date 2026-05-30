/**
 * Generic visual effect families supported by the reusable VFX layer.
 *
 * These strings describe renderer concepts only. They are not move automation
 * script kinds, canonical move names, or gameplay rule branches. Future
 * per-move animation overrides should choose from these generic kinds before a
 * later milestone adds bespoke choreography.
 */
export const MOVE_VFX_KIND = {
  projectile: 'projectile',
  beam: 'beam',
  arc: 'arc',
  meleeLunge: 'melee-lunge',
  selfPulse: 'self-pulse',
  targetFlash: 'target-flash',
  impactRing: 'impact-ring',
  areaPulse: 'area-pulse',
  radialBurst: 'radial-burst',
  lineSweep: 'line-sweep',
  coneSweep: 'cone-sweep',
  dash: 'dash',
  miss: 'miss',
  crit: 'crit',
  status: 'status',
  healing: 'healing',
  buffDebuff: 'buff-debuff',
} as const

/** Generic renderer effect category, independent from move rule/script kinds. */
export type MoveVfxKind = (typeof MOVE_VFX_KIND)[keyof typeof MOVE_VFX_KIND]

/** Alias used by animation planners and future override registries. */
export type MoveAnimationEffectKind = MoveVfxKind
