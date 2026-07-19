import {
  reviewedSingleTargetConditionAndStageScript,
  reviewedSingleTargetConditionScript,
} from '~/utils/move-automation/scriptFactories'
import type { MoveAutomationScript } from '~/types/moveAutomation'

export const REVIEWED_SINGLE_TARGET_CONDITION_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map([
  ['Astonish', reviewedSingleTargetConditionScript('Astonish', [{ condition: 'Flinch', label: 'Flinch on 15+', threshold: '15+' }], 1, {
    automationNotes: ['Astonish’s once-per-scene automatic Flinch against an unaware target is not inferred; apply Flinch manually if that clause applies.'],
  })],
  ['Confusion', reviewedSingleTargetConditionScript('Confusion', [{ condition: 'Confused', label: 'Confused on 19+', threshold: '19+' }])],
  ['Dizzy Punch', reviewedSingleTargetConditionScript('Dizzy Punch', [{ condition: 'Confused', label: 'Confused on 17+', threshold: '17+' }])],
  ['Flame Wheel', reviewedSingleTargetConditionScript('Flame Wheel', [{ condition: 'Burned', label: 'Burned on 19+', threshold: '19+' }])],
  ['Flatter', reviewedSingleTargetConditionAndStageScript('Flatter',
    [{ condition: 'Confused', label: 'Confused' }],
    [{ key: 'satk', delta: 1, label: 'Flatter raises Special Attack: +1 Special Attack CS' }],
  )],
  ['Iron Head', reviewedSingleTargetConditionScript('Iron Head', [{ condition: 'Flinch', label: 'Flinch on 15+', threshold: '15+' }])],
  ['Mountain Gale', reviewedSingleTargetConditionScript('Mountain Gale', [{ condition: 'Flinch', label: 'Flinch on 15+', threshold: '15+' }])],
  ['Nuzzle', reviewedSingleTargetConditionScript('Nuzzle', [{ condition: 'Paralysis', label: 'Paralysis' }])],
  ['Poison Fang', reviewedSingleTargetConditionScript('Poison Fang', [{ condition: 'Badly Poisoned', label: 'Badly Poisoned on 17+', threshold: '17+' }])],
  ['Poison Sting', reviewedSingleTargetConditionScript('Poison Sting', [{ condition: 'Poisoned', label: 'Poisoned on 17+', threshold: '17+' }], 2)],
  ['Poison Tail', reviewedSingleTargetConditionScript('Poison Tail', [{ condition: 'Poisoned', label: 'Poisoned on 19+', threshold: '19+' }])],
  ['Psybeam', reviewedSingleTargetConditionScript('Psybeam', [{ condition: 'Confused', label: 'Confused on 19+', threshold: '19+' }])],
  ['Rock Climb', reviewedSingleTargetConditionScript('Rock Climb', [{ condition: 'Confused', label: 'Confused on 17+', threshold: '17+' }])],
  ['Rolling Kick', reviewedSingleTargetConditionScript('Rolling Kick', [{ condition: 'Flinch', label: 'Flinch on 15+', threshold: '15+' }])],
  ['Sacred Fire', reviewedSingleTargetConditionScript('Sacred Fire', [{ condition: 'Burned', label: 'Burned on even roll', threshold: 'even roll' }])],
  ['Sand Attack', reviewedSingleTargetConditionScript('Sand Attack', [{ condition: 'Blindness', label: 'Blindness' }])],
  ['Signal Beam', reviewedSingleTargetConditionScript('Signal Beam', [{ condition: 'Confused', label: 'Confused on 19+', threshold: '19+' }])],
  ['Spark', reviewedSingleTargetConditionScript('Spark', [{ condition: 'Paralysis', label: 'Paralysis on 15+', threshold: '15+' }])],
  ['Swagger', reviewedSingleTargetConditionAndStageScript('Swagger',
    [{ condition: 'Confused', label: 'Confused' }],
    [{ key: 'atk', delta: 2, label: 'Swagger raises Attack: +2 Attack CS' }],
  )],
  ['Taunt', reviewedSingleTargetConditionScript('Taunt', [{ condition: 'Rage', label: 'Enraged' }])],
  ['Water Pulse', reviewedSingleTargetConditionScript('Water Pulse', [{ condition: 'Confused', label: 'Confused on 17+', threshold: '17+' }])],
  ['Zen Headbutt', reviewedSingleTargetConditionScript('Zen Headbutt', [{ condition: 'Flinch', label: 'Flinch on 15+', threshold: '15+' }])],
])
