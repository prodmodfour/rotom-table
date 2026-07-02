import {
  reviewedDoubleStrikeScript,
  reviewedFiveStrikeScript,
  reviewedMoveScriptFromCanonical,
  reviewedPowerTripScript,
  reviewedSingleTargetConditionScript,
  targetStageSuggestions,
} from '~/utils/move-automation/scriptFactories'
import {
  HELPING_HAND_CONDITION,
  SUPERSONIC_ACCURACY_PENALTY_CONDITION,
  YAWN_CONDITION,
} from '~/utils/moveAutomationSpecialConditions'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { ReviewedTargetStageDefinition } from '~/utils/move-automation/scriptFactories'

const ACUPRESSURE_STAGE_BOOSTS: readonly ReviewedTargetStageDefinition[] = [
  { key: 'atk', delta: 2, label: 'Acupressure raises Attack: +2 Attack CS', optional: true },
  { key: 'def', delta: 2, label: 'Acupressure raises Defense: +2 Defense CS', optional: true },
  { key: 'satk', delta: 2, label: 'Acupressure raises Special Attack: +2 Special Attack CS', optional: true },
  { key: 'sdef', delta: 2, label: 'Acupressure raises Special Defense: +2 Special Defense CS', optional: true },
  { key: 'spd', delta: 2, label: 'Acupressure raises Speed: +2 Speed CS', optional: true },
  { key: 'acc', delta: 2, label: 'Acupressure raises Accuracy: +2 Accuracy CS', optional: true },
]

const reviewedAcupressureScript = (version = 1): MoveAutomationScript => reviewedMoveScriptFromCanonical('Acupressure', version, {
  targetMode: 'one-target',
  targetCount: 1,
  stageSuggestions: targetStageSuggestions(ACUPRESSURE_STAGE_BOOSTS),
  randomStageSuggestion: {
    kind: 'roll-table',
    rollFormula: '1d6',
    label: 'Acupressure',
    entries: ACUPRESSURE_STAGE_BOOSTS.map((boost, index) => ({
      roll: index + 1,
      stageSuggestionIndex: index,
      label: boost.label,
    })),
  },
  automationNotes: [
    'Acupressure rolls 1d6 automatically after a successful accuracy roll and applies the matching +2 Combat Stage boost.',
    'The range includes Self; select the user token in the targeting overlay to apply Acupressure to itself.',
  ],
})

const reviewedAbsorbScript = (version = 1): MoveAutomationScript => reviewedMoveScriptFromCanonical('Absorb', version, {
  targetMode: 'one-target',
  targetCount: 1,
  hpSuggestions: [{
    recipient: 'user',
    mode: 'heal-percent-damage-dealt',
    percent: 50,
    label: 'Absorb heals user for half damage dealt',
  }],
})

const reviewedTakeDownScript = (version = 1): MoveAutomationScript => reviewedMoveScriptFromCanonical('Take Down', version, {
  targetMode: 'one-target',
  targetCount: 1,
  hpSuggestions: [{
    recipient: 'user',
    mode: 'recoil-percent-damage-dealt',
    percent: 100 / 3,
    rounding: 'floor',
    label: 'Recoil 1/3',
  }],
  conditionSuggestions: [{
    recipient: 'target',
    condition: 'Tripped',
    action: 'add',
    label: 'Trip Maneuver succeeds',
    optional: true,
  }],
  automationNotes: [
    'Take Down grants an optional Free Action Trip Maneuver after the hit; automation applies Tripped only if that opposed maneuver succeeds.',
    'Recoil is calculated from damage dealt after defenses, weakness/resistance, and other mitigation; Rock Head and Magic Guard prevent this recoil HP loss.',
    'Reckless Damage Base bonuses are not inferred; adjust the move DB before use if that Ability applies.',
  ],
})

const reviewedYawnScript = (version = 1): MoveAutomationScript => reviewedSingleTargetConditionScript('Yawn', [
  { condition: YAWN_CONDITION, label: 'Yawn drowsy marker' },
], version, {
  requiresAccuracy: false,
  automationNotes: [
    'Yawn cannot miss; automation applies a removable Yawn marker instead of immediate Sleep.',
    'At the end of the target’s next turn, replace the Yawn marker with Sleep unless an immunity or other rule prevents Sleep.',
  ],
})

export const REVIEWED_ADDITIONAL_SINGLE_TARGET_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map([
  ['Absorb', reviewedAbsorbScript()],
  ['Acupressure', reviewedAcupressureScript()],
  ['Fake Out', reviewedSingleTargetConditionScript('Fake Out', [{ condition: 'Flinch', label: 'Fake Out flinches on hit' }], 1, {
    automationNotes: ['Fake Out’s Priority/Flinch clause is only legal upon joining an encounter; automation applies Flinch on hit assuming that requirement is met.'],
  })],
  ['Fury Cutter', reviewedMoveScriptFromCanonical('Fury Cutter', 1, {
    targetMode: 'one-target',
    targetCount: 1,
    automationNotes: ['Fury Cutter’s consecutive same-target Damage Base scaling is not inferred; update the move DB manually before use if the chain has advanced.'],
  })],
  ['Helping Hand', reviewedSingleTargetConditionScript('Helping Hand', [{ condition: HELPING_HAND_CONDITION, label: 'Helping Hand bonus' }], 1, {
    requiresAccuracy: false,
    automationNotes: ['Helping Hand creates a removable marker; remove it after the target consumes the +2 Accuracy/+10 Damage bonus or the round ends.'],
  })],
  ['Double Kick', reviewedDoubleStrikeScript('Double Kick')],
  ['Fury Attack', reviewedFiveStrikeScript('Fury Attack')],
  ['Fury Swipes', reviewedFiveStrikeScript('Fury Swipes')],
  ['Knock Off', reviewedMoveScriptFromCanonical('Knock Off', 1, {
    targetMode: 'one-target',
    targetCount: 1,
    automationNotes: [
      'On hit, choose one of the target’s Held Items or Accessory Slot Items; the chosen item is knocked to the ground.',
      'Equipment slots and ground item placement are not tracked by this transaction, so update the sheet/map item manually after damage resolves.',
    ],
  })],
  ['Pin Missile', reviewedFiveStrikeScript('Pin Missile')],
  ['Power Trip', reviewedPowerTripScript()],
  ['Sand Tomb', reviewedSingleTargetConditionScript('Sand Tomb', [
    { condition: 'Slowed', label: 'Vortex slows target' },
    { condition: 'Trapped', label: 'Vortex traps target' },
  ], 1, {
    automationNotes: ['Vortex tick damage and the end-of-turn dispel checks (20, 14, 8, 2, then wears off) are tracked by note, not automatic turn processing.'],
  })],
  ['Supersonic', reviewedSingleTargetConditionScript('Supersonic', [
    { condition: 'Confused', label: 'Confused on hit' },
    { condition: SUPERSONIC_ACCURACY_PENALTY_CONDITION, label: 'Supersonic miss accuracy penalty', applyWhen: 'miss' },
  ])],
  ['Tackle', reviewedMoveScriptFromCanonical('Tackle', 1, {
    targetMode: 'one-target',
    targetCount: 1,
    automationNotes: ['Tackle pushes the target 2 meters after damage; move the target token manually after the automated hit resolves.'],
  })],
  ['Take Down', reviewedTakeDownScript()],
  ['Torment', reviewedSingleTargetConditionScript('Torment', [{ condition: 'Suppressed', label: 'Suppressed' }])],
  ['U-Turn', reviewedMoveScriptFromCanonical('U-Turn', 1, {
    targetMode: 'one-target',
    targetCount: 1,
    conditionSuggestions: [],
    automationNotes: [
      'On hit, the user is recalled immediately after damage and may send out a new Pokémon; perform the token recall/send-out after the automated damage resolves.',
      'U-Turn explicitly allows a Trapped user to be recalled.',
    ],
  })],
  ['Yawn', reviewedYawnScript()],
])
