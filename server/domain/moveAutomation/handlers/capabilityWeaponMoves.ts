import { MOVE_SPEC_PHASES } from '#shared/moveAutomation/spec'
import type {
  MoveEffectOperation,
  MoveTemporaryEffectOperation,
} from '#shared/moveAutomation/effects'
import { capabilityWeaponMoveName } from '#shared/capabilityAutomation/weaponMoves'
import type {
  RegisteredMoveHandlerContext,
  RegisteredMoveHandlerRegistration,
} from './registry'
import {
  reviewedDamage,
  reviewedDirectHp,
  reviewedMultiHit,
  standardAccuracy,
  standardTerminalOperations,
} from '../specs/reviewedSpecBuilder'

export const CAPABILITY_WEAPON_MOVE_HANDLER_ID = 'capability.weapon-moves' as const

const slugFor = (name: string): string => name
  .normalize('NFKD')
  .replace(/[’']/g, '')
  .replace(/[^A-Za-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .toLocaleLowerCase('en-US')

const ordered = (operations: readonly MoveEffectOperation[]): readonly MoveEffectOperation[] => (
  [...operations].sort((left, right) => (
    MOVE_SPEC_PHASES.indexOf(left.phase) - MOVE_SPEC_PHASES.indexOf(right.phase)
  ))
)

const resolvedDamageBase = (context: RegisteredMoveHandlerContext): number => {
  const entry = context.queries.resolveActorMoveEntry(context.intent.moveName)
  if (!entry.ok || entry.entry.script.damageBase === null) {
    throw new Error(`${context.intent.moveName} did not resolve an authoritative weapon Damage Base.`)
  }
  return entry.entry.script.damageBase
}

const bleedSchedule = (slug: string): MoveTemporaryEffectOperation => ({
  id: `${slug}.bleed-three-turns`,
  kind: 'temporary-effect',
  source: { kind: 'operation', id: `${slug}.damage` },
  recipients: { kind: 'hit-targets' },
  phase: 'schedule',
  reasonCode: `${slug}.bleed-three-turns`,
  payload: {
    action: 'add',
    effectId: 'capability-weapon.bleed',
    recipientScope: 'placements',
    definition: {
      kind: 'capability',
      duration: { kind: 'turns', subject: 'target', boundary: 'start', remaining: 3 },
      stacks: 1,
      charges: 3,
      stackPolicy: { kind: 'replace', maxStacks: null },
      chargePolicy: { kind: 'consume-on-trigger', amount: 1 },
      tags: ['capability-weapon-move', 'bleed', 'start-turn-tick'],
      payload: { capabilityId: 'weapon-move-bleed', action: 'grant' },
      dispel: { policy: 'matching-tags', tags: ['capability-weapon-move', 'bleed'] },
      transferPolicy: 'expire',
    },
  },
})

const run = (context: RegisteredMoveHandlerContext) => {
  const canonicalId = capabilityWeaponMoveName(context.intent.moveName)
  if (!canonicalId) throw new Error(`Unknown capability weapon Move ${context.intent.moveName}.`)
  const slug = slugFor(canonicalId)
  const damageBase = resolvedDamageBase(context)
  let operations: readonly MoveEffectOperation[]

  if (canonicalId === 'Cheap Shot') {
    const damage = reviewedDamage({
      slug,
      damageBase,
      damageClass: 'physical',
      moveType: 'normal',
      recipients: 'attacked-targets',
      accuracyRollId: null,
      criticalRollId: null,
    })
    operations = [{
      ...damage,
      source: { kind: 'move', id: `move.${slug}` },
    }, ...standardTerminalOperations(slug)]
  }
  else if (canonicalId === 'Double Swipe' && context.selectedPlacements.length === 1) {
    operations = [
      reviewedMultiHit({
        slug,
        damageBase,
        damageClass: 'physical',
        moveType: 'normal',
        count: { kind: 'fixed', hits: 2 },
        accuracy: {
          kind: 'per-hit',
          rollId: `${slug}.accuracy-roll`,
          formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
          stopOnMiss: false,
        },
      }),
      ...standardTerminalOperations(slug),
    ]
  }
  else {
    operations = [
      standardAccuracy(slug),
      reviewedDamage({
        slug,
        damageBase,
        damageClass: 'physical',
        moveType: 'normal',
      }),
      ...(canonicalId === 'Wounding Strike'
        ? [reviewedDirectHp({
            slug,
            id: 'tick-loss',
            recipients: 'hit-targets',
            calculation: { kind: 'percent-max', percent: 10 },
            sourceOperationId: `${slug}.damage`,
          })]
        : []),
      ...(canonicalId === 'Bleed!' ? [bleedSchedule(slug)] : []),
      ...standardTerminalOperations(slug),
    ]
  }

  return {
    operations: ordered(operations),
    traceEntries: [{
      kind: 'predicate' as const,
      phase: 'declare' as const,
      predicateId: `capability-weapon.${slug}.source`,
      outcome: true,
      reasonCode: 'capability-weapon.source-authorized',
      input: {
        canonicalId,
        selectedTargetCount: context.selectedPlacements.length,
        damageBase,
      },
    }],
  }
}

export const CAPABILITY_WEAPON_MOVE_HANDLER_REGISTRATION: RegisteredMoveHandlerRegistration = Object.freeze({
  id: CAPABILITY_WEAPON_MOVE_HANDLER_ID,
  version: 1,
  run,
})
