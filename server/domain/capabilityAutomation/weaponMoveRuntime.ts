import {
  CAPABILITY_WEAPON_MOVES,
  type CapabilityWeaponMoveName,
} from '#shared/capabilityAutomation/weaponMoves'
import { MOVE_RULESET_PROVENANCE } from '#shared/moveAutomation/ruleset'
import type { MoveSpecV2Runtime } from '../moveAutomation/registry'
import { validateMoveSpec } from '../moveAutomation/validateSpec'
import { CAPABILITY_WEAPON_MOVE_HANDLER_ID } from '../moveAutomation/handlers/capabilityWeaponMoves'
import {
  createReviewedMoveSpec,
  multiTargeting,
  singleTargeting,
} from '../moveAutomation/specs/reviewedSpecBuilder'

const SOURCE_MODULE = 'server/domain/capabilityAutomation/weaponMoveRuntime.ts'

const targetingFor = (canonicalId: CapabilityWeaponMoveName) => canonicalId === 'Backswing'
  ? multiTargeting(2, 2)
  : canonicalId === 'Double Swipe'
    ? multiTargeting(1, 2)
    : canonicalId === 'Triple Threat'
      ? multiTargeting(3, 3)
      : singleTargeting()

const capabilityIdsFor = (canonicalId: CapabilityWeaponMoveName): readonly string[] => (
  canonicalId === 'Wounding Strike' || canonicalId === 'Bleed!' || canonicalId === 'Gouge'
    ? ['hp.typed', 'lifecycle.effects', 'targeting.authoritative']
    : canonicalId === 'Bash!' || canonicalId === 'Titanic Slam'
      ? ['lifecycle.effects', 'targeting.authoritative']
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
      rulesetId: MOVE_RULESET_PROVENANCE.rulesetId,
      canonicalizationVersion: MOVE_RULESET_PROVENANCE.canonicalization.version,
      sourceDataSha256: MOVE_RULESET_PROVENANCE.sourceData.sha256,
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
