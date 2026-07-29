import { createHash } from 'node:crypto'
import {
  CAPABILITY_WEAPON_MOVES,
  type CapabilityWeaponMoveName,
} from '#shared/capabilityAutomation/weaponMoves'
import type { MoveSpecV2Runtime } from '../moveAutomation/registry'
import { validateMoveSpec } from '../moveAutomation/validateSpec'
import { CAPABILITY_WEAPON_MOVE_HANDLER_ID } from '../moveAutomation/handlers/capabilityWeaponMoves'
import {
  createReviewedMoveSpec,
  multiTargeting,
  singleTargeting,
} from '../moveAutomation/specs/reviewedSpecBuilder'

const SOURCE_MODULE = 'server/domain/capabilityAutomation/weaponMoveRuntime.ts'
const SOURCE_SHA256 = createHash('sha256')
  .update(JSON.stringify(CAPABILITY_WEAPON_MOVES), 'utf8')
  .digest('hex')

const targetingFor = (canonicalId: CapabilityWeaponMoveName) => canonicalId === 'Backswing'
  ? multiTargeting(2, 2)
  : canonicalId === 'Double Swipe'
    ? multiTargeting(1, 2)
    : singleTargeting()

const capabilityIdsFor = (canonicalId: CapabilityWeaponMoveName): readonly string[] => (
  canonicalId === 'Wounding Strike' || canonicalId === 'Bleed!'
    ? ['hp.typed', 'lifecycle.effects', 'targeting.authoritative']
    : ['targeting.authoritative']
)

const runtimeFor = (canonicalId: CapabilityWeaponMoveName): MoveSpecV2Runtime => {
  const definition = validateMoveSpec(createReviewedMoveSpec({
    canonicalId,
    targeting: targetingFor(canonicalId),
    operations: [],
    registeredHandlerId: CAPABILITY_WEAPON_MOVE_HANDLER_ID,
    tags: ['capability-weapon-move', 'native-v2'],
  }), {
    capabilityIds: capabilityIdsFor(canonicalId),
    rulesetVersion: {
      rulesetId: 'rotom-table-capability-weapon-moves-v1',
      canonicalizationVersion: 1,
      sourceDataSha256: SOURCE_SHA256,
    },
  })
  return Object.freeze({
    canonicalId,
    kind: 'movespec-v2',
    version: definition.spec.version,
    definitionHash: definition.definitionHash,
    sourceModule: SOURCE_MODULE,
    definition,
  })
}

export const CAPABILITY_WEAPON_MOVE_RUNTIMES: ReadonlyMap<CapabilityWeaponMoveName, MoveSpecV2Runtime> = (
  new Map((Object.keys(CAPABILITY_WEAPON_MOVES) as CapabilityWeaponMoveName[])
    .map(canonicalId => [canonicalId, runtimeFor(canonicalId)]))
)
