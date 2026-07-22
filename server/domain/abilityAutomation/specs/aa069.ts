import type { AbilitySpecV1Registration } from '../registry'
import {
  abilityMechanicOperation as mechanic,
  moveAbilityTarget,
  noAbilityTarget,
  reviewedAbilitySpec,
  reviewedActivatedAbilitySpec as activatedSpec,
  reviewedStaticAbilitySpec as staticSpec,
  reviewedTriggeredAbilitySpec as triggeredSpec,
} from './reviewedSpecBuilder'

const hpBelowHalfPredicate = {
  kind: 'ability-hp-fact' as const,
  changeKinds: ['damage', 'drain', 'recoil', 'cost', 'set'] as const,
  faintTransitions: [] as const,
  ownerRole: 'subject' as const,
  massiveDamage: 'any' as const,
  crossedZero: 'any' as const,
  injuryChange: 'any' as const,
  temporaryChange: 'any' as const,
  hpThreshold: 'below-half' as const,
  minimumAppliedAmount: 1,
}

const physicalHitPredicate = {
  kind: 'ability-move-fact' as const,
  timings: ['accuracy-resolved'] as const,
  moveTypes: [] as const,
  damageClasses: ['physical'] as const,
  keywordsAny: [] as const,
  keywordsAll: [] as const,
  userRelation: 'other' as const,
  targetRelation: 'hit' as const,
}

export const ELECTRODASH_ABILITY_SPEC = activatedSpec('Electrodash', 'aa069.electrodash', {
  action: 'swift', frequency: 'scene-x2', sprintAction: 'free', movementMultiplier: 1.5,
  duration: 'turn',
}, noAbilityTarget('activate'), ['action', 'mode.activated', 'movement', 'scene'])

export const EMERGENCY_EXIT_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Emergency Exit', mechanicId: 'aa069.emergency-exit',
  config: {
    action: 'free', frequency: 'scene', trigger: 'drops-below-half-hp',
    recall: true, replacement: 'trainer-choice', initiativePolicy: 'inherit-if-unacted',
  },
  eventKind: 'hp', checkpoint: 'post-effect', predicate: hpBelowHalfPredicate,
  tags: ['action', 'choice', 'hp-threshold', 'reaction', 'scene', 'switch', 'triggered'],
})

export const EMPOWER_ABILITY_SPEC = activatedSpec('Empower', 'aa069.empower', {
  action: 'swift', frequency: 'scene', grantedMoveAction: 'free',
  moveFilter: 'self-targeting-status', duration: 'turn-or-use',
}, moveAbilityTarget('activate'), ['action', 'choice', 'mode.activated', 'move-overlay', 'scene'])

export const ENDURING_RAGE_ABILITY_SPEC = staticSpec('Enduring Rage', 'aa069.enduring-rage', {
  condition: 'enraged', preventCureRolls: true, damageReduction: 5,
}, ['condition', 'damage', 'damage-reduction', 'save-check', 'static'])

export const ENFEEBLING_LIPS_ABILITY_SPEC = staticSpec('Enfeebling Lips', 'aa069.enfeebling-lips', {
  connectionMoveId: 'Lovely Kiss', affectedMoveId: 'Lovely Kiss', statChoice: 'combat-stat',
  stageDelta: -2, trigger: 'successful-hit',
}, ['choice', 'connection', 'move-overlay', 'stage', 'static'])

export const EXPLOIT_ABILITY_SPEC = staticSpec('Exploit', 'aa069.exploit', {
  trigger: 'super-effective-damage', damageRollBonus: 5,
}, ['damage', 'move-overlay', 'static', 'type'])

export const FABULOUS_TRIM_ABILITY_SPEC = reviewedAbilitySpec({
  canonicalId: 'Fabulous Trim',
  modes: [{ id: 'style', kind: 'activated' }],
  targeting: [{
    id: 'style.trim', modeId: 'style', kind: 'branch', minSelections: 1, maxSelections: 1,
    selector: null, predicate: null,
  }],
  phases: [{ modeId: 'style', phase: 'effect', operations: [mechanic('style.mechanic', 'aa069.fabulous-trim', {
    action: 'extended', persistence: 'sheet', parameterId: 'trim',
    trimIds: ['star', 'diamond', 'heart', 'pharaoh', 'kabuki', 'la-reine', 'matron', 'dandy', 'debutante'],
    grantedAbilityIds: ['Celebrate', 'Defiant', 'Cute Tears', 'Sand Veil', 'Inner Focus', 'Intimidate', 'Friend Guard', 'Moxie', 'Confidence'],
  })] }],
  tags: ['ability-grant', 'branch', 'form', 'mode.activated', 'persistent'],
})

export const FADE_AWAY_ABILITY_SPEC = reviewedAbilitySpec({
  canonicalId: 'Fade Away',
  modes: [{ id: 'activate', kind: 'activated' }, { id: 'interrupt', kind: 'triggered' }],
  subscriptions: [{
    id: 'interrupt.subscription', modeId: 'interrupt', eventKind: 'move',
    checkpoint: 'pre-effect', response: 'optional', priority: 120,
    oncePerCausalChain: true, predicate: physicalHitPredicate,
  }],
  targeting: [...noAbilityTarget('activate'), ...noAbilityTarget('interrupt')],
  phases: [
    { modeId: 'activate', phase: 'effect', operations: [mechanic('activate.mechanic', 'aa069.fade-away', {
      branch: 'activate', action: 'standard', frequency: 'scene', invisibleUntil: 'next-turn-start',
      immediateShift: true, trigger: 'manual', avoidDamageAndEffects: false,
    })] },
    { modeId: 'interrupt', phase: 'effect', operations: [mechanic('interrupt.mechanic', 'aa069.fade-away', {
      branch: 'interrupt', action: 'standard', frequency: 'scene', trigger: 'hit-by-physical-attack',
      avoidDamageAndEffects: true, invisibleUntil: 'next-turn-start', immediateShift: true,
    })] },
  ],
  tags: ['action', 'capability', 'interrupt', 'movement', 'reaction', 'scene'],
})

export const FAIRY_AURA_ABILITY_SPEC = staticSpec('Fairy Aura', 'aa069.fairy-aura', {
  affectedRelationships: ['self', 'ally'], moveType: 'fairy', damageBaseBonus: 1,
}, ['ally', 'aura', 'damage', 'damage-base', 'static', 'type'])

export const FASHION_DESIGNER_ABILITY_SPEC = activatedSpec('Fashion Designer', 'aa069.fashion-designer', {
  action: 'extended', frequency: 'daily', craftQuantity: 1,
  itemIds: ['lucky-leaf', 'tasty-reeds', 'dew-cup', 'thorn-mantle', 'chewy-cluster', 'decorative-twine'],
}, [{
  id: 'activate.item', modeId: 'activate', kind: 'branch', minSelections: 1, maxSelections: 1,
  selector: null, predicate: null,
}], ['action', 'choice', 'craft', 'daily', 'item', 'mode.activated'])

export const FIERY_CRASH_ABILITY_SPEC = staticSpec('Fiery Crash', 'aa069.fiery-crash', {
  keyword: 'dash', choices: ['damage-base-plus-2', 'fire-type'],
  fireBurnThreshold: 19, existingBurnRangeBonus: 2,
}, ['choice', 'condition', 'damage', 'damage-base', 'move-overlay', 'static', 'type'])

export const FILTER_ABILITY_SPEC = staticSpec('Filter', 'aa069.filter', {
  trigger: 'super-effective-damage', damageReduction: 5,
}, ['damage', 'damage-reduction', 'defensive', 'static', 'type'])

export const AA069_ABILITY_SPECS = Object.freeze([
  ELECTRODASH_ABILITY_SPEC, EMERGENCY_EXIT_ABILITY_SPEC, EMPOWER_ABILITY_SPEC,
  ENDURING_RAGE_ABILITY_SPEC, ENFEEBLING_LIPS_ABILITY_SPEC, EXPLOIT_ABILITY_SPEC,
  FABULOUS_TRIM_ABILITY_SPEC, FADE_AWAY_ABILITY_SPEC, FAIRY_AURA_ABILITY_SPEC,
  FASHION_DESIGNER_ABILITY_SPEC, FIERY_CRASH_ABILITY_SPEC, FILTER_ABILITY_SPEC,
])

export const AA069_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = Object.freeze(
  AA069_ABILITY_SPECS.map(spec => ({
    canonicalId: spec.canonicalId,
    version: 1,
    sourceModule: 'server/domain/abilityAutomation/specs/aa069.ts',
    spec,
  })),
)
