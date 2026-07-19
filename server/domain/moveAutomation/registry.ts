import manifestJson from '../../../data/move-automation/manifest.json'
import {
  validateMoveAutomationRuntimeRegistrations,
  type MoveAutomationManifest,
  type MoveAutomationRuntimeRegistrationReference,
} from '#shared/moveAutomation/manifest'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import {
  EXPLICIT_MOVE_AUTOMATION_REGISTRY_SOURCES,
  type ExplicitMoveAutomationRegistrySource,
} from '~/utils/move-automation/registry'
import {
  REGISTERED_MOVE_HANDLER_REGISTRY,
  type RegisteredMoveHandlerRegistry,
} from './handlers/registry'
import { hashLegacyMoveAutomationDefinition } from './legacyV1Definition'
import {
  validateMoveSpec,
  type ValidatedMoveSpecDefinition,
} from './validateSpec'
import { ABSORB_MOVE_SPEC_REGISTRATION } from './specs/absorb'
import { ASTONISH_MOVE_SPEC_REGISTRATION } from './specs/astonish'
import { DARK_VOID_MOVE_SPEC_REGISTRATION } from './specs/darkVoid'
import { DOUBLE_KICK_MOVE_SPEC_REGISTRATION } from './specs/doubleKick'
import { DRAGON_RAGE_MOVE_SPEC_REGISTRATION } from './specs/dragonRage'
import { EMBER_MOVE_SPEC_REGISTRATION } from './specs/ember'
import { FURY_ATTACK_MOVE_SPEC_REGISTRATION } from './specs/furyAttack'
import { FURY_CUTTER_MOVE_SPEC_REGISTRATION } from './specs/furyCutter'
import { FURY_SWIPES_MOVE_SPEC_REGISTRATION } from './specs/furySwipes'
import { FAKE_OUT_MOVE_SPEC_REGISTRATION } from './specs/fakeOut'
import { HELPING_HAND_MOVE_SPEC_REGISTRATION } from './specs/helpingHand'
import { HYPER_BEAM_MOVE_SPEC_REGISTRATION } from './specs/hyperBeam'
import { KNOCK_OFF_MOVE_SPEC_REGISTRATION } from './specs/knockOff'
import { PIN_MISSILE_MOVE_SPEC_REGISTRATION } from './specs/pinMissile'
import { POWER_TRIP_MOVE_SPEC_REGISTRATION } from './specs/powerTrip'
import { REFLECT_MOVE_SPEC_REGISTRATION } from './specs/reflect'
import { SAND_ATTACK_MOVE_SPEC_REGISTRATION } from './specs/sandAttack'
import { SAND_TOMB_MOVE_SPEC_REGISTRATION } from './specs/sandTomb'
import { SCRATCH_MOVE_SPEC_REGISTRATION } from './specs/scratch'
import { SWORDS_DANCE_MOVE_SPEC_REGISTRATION } from './specs/swordsDance'
import { SUPERSONIC_MOVE_SPEC_REGISTRATION } from './specs/supersonic'
import { SWEET_SCENT_MOVE_SPEC_REGISTRATION } from './specs/sweetScent'
import { SYNTHESIS_MOVE_SPEC_REGISTRATION } from './specs/synthesis'
import { TACKLE_MOVE_SPEC_REGISTRATION } from './specs/tackle'
import { TAKE_DOWN_MOVE_SPEC_REGISTRATION } from './specs/takeDown'
import { THUNDER_WAVE_MOVE_SPEC_REGISTRATION } from './specs/thunderWave'
import { TOPSY_TURVY_MOVE_SPEC_REGISTRATION } from './specs/topsyTurvy'
import { TOXIC_MOVE_SPEC_REGISTRATION } from './specs/toxic'
import { U_TURN_MOVE_SPEC_REGISTRATION } from './specs/uTurn'
import { YAWN_MOVE_SPEC_REGISTRATION } from './specs/yawn'

export interface LegacyV1MoveAutomationAdapter extends MoveAutomationRuntimeRegistrationReference {
  readonly kind: 'legacy-v1'
  /** Exact reviewed v1 object; contextual legacy modifiers are applied downstream as before. */
  readonly script: MoveAutomationScript
}

export interface MoveSpecV2Runtime extends MoveAutomationRuntimeRegistrationReference {
  readonly kind: 'movespec-v2'
  readonly definition: ValidatedMoveSpecDefinition
}

export type RegisteredMoveAutomationRuntime =
  | LegacyV1MoveAutomationAdapter
  | MoveSpecV2Runtime

/** Repository registration for a v2 spec. The manifest supplies capabilities and rules provenance. */
export interface MoveSpecV2Registration {
  readonly canonicalId: string
  readonly sourceModule: string
  readonly spec: unknown
}

export interface MoveAutomationRuntimeRegistry {
  readonly size: number
  /** Exact audited handlers used while validating these runtime definitions. */
  readonly handlerRegistry: RegisteredMoveHandlerRegistry
  /** Resolve only the runtime selected by server-owned semantic manifest metadata. */
  resolve(canonicalId: string): RegisteredMoveAutomationRuntime | null
  entries(): readonly RegisteredMoveAutomationRuntime[]
}

export type MoveAutomationRuntimeRegistryValidationCode =
  | 'duplicate-id'
  | 'canonical-id-mismatch'
  | 'unknown-canonical-id'

export class MoveAutomationRuntimeRegistryValidationError extends Error {
  readonly code: MoveAutomationRuntimeRegistryValidationCode
  readonly canonicalId: string

  constructor(
    code: MoveAutomationRuntimeRegistryValidationCode,
    canonicalId: string,
    message: string,
  ) {
    super(message)
    this.name = 'MoveAutomationRuntimeRegistryValidationError'
    this.code = code
    this.canonicalId = canonicalId
  }
}

export interface CreateMoveAutomationRuntimeRegistryOptions {
  readonly manifest: MoveAutomationManifest
  readonly legacySources?: readonly ExplicitMoveAutomationRegistrySource[]
  readonly moveSpecs?: readonly MoveSpecV2Registration[]
  readonly handlerRegistry?: RegisteredMoveHandlerRegistry
}

const fail = (
  code: MoveAutomationRuntimeRegistryValidationCode,
  canonicalId: string,
  message: string,
): never => {
  throw new MoveAutomationRuntimeRegistryValidationError(code, canonicalId, message)
}

const runtimeRegistrationReference = (
  runtime: RegisteredMoveAutomationRuntime,
): MoveAutomationRuntimeRegistrationReference => ({
  canonicalId: runtime.canonicalId,
  kind: runtime.kind,
  version: runtime.version,
  definitionHash: runtime.definitionHash,
  sourceModule: runtime.sourceModule,
})

const buildLegacyAdapters = (
  sources: readonly ExplicitMoveAutomationRegistrySource[],
): readonly LegacyV1MoveAutomationAdapter[] => {
  const adapters: LegacyV1MoveAutomationAdapter[] = []
  const canonicalIds = new Set<string>()
  for (const { sourceModule, scripts } of sources) {
    for (const [canonicalId, script] of scripts) {
      if (canonicalId !== script.moveName) {
        fail(
          'canonical-id-mismatch',
          canonicalId,
          `Legacy registry key ${JSON.stringify(canonicalId)} in ${sourceModule} does not match script moveName ${JSON.stringify(script.moveName)}.`,
        )
      }
      if (canonicalIds.has(canonicalId)) {
        fail(
          'duplicate-id',
          canonicalId,
          `Legacy v1 runtime is registered more than once for ${JSON.stringify(canonicalId)}.`,
        )
      }
      canonicalIds.add(canonicalId)
      adapters.push(Object.freeze({
        canonicalId,
        kind: 'legacy-v1',
        version: script.version,
        definitionHash: hashLegacyMoveAutomationDefinition(script),
        sourceModule,
        script,
      }))
    }
  }
  return adapters
}

const buildMoveSpecRuntimes = (
  manifest: MoveAutomationManifest,
  registrations: readonly MoveSpecV2Registration[],
  handlerRegistry: RegisteredMoveHandlerRegistry,
): readonly MoveSpecV2Runtime[] => {
  const manifestByCanonicalId = new Map(
    manifest.moves.map(record => [record.canonicalId, record]),
  )
  const canonicalIds = new Set<string>()
  return registrations.map((registration) => {
    if (canonicalIds.has(registration.canonicalId)) {
      return fail(
        'duplicate-id',
        registration.canonicalId,
        `MoveSpec v2 runtime is registered more than once for ${JSON.stringify(registration.canonicalId)}.`,
      )
    }
    canonicalIds.add(registration.canonicalId)

    const manifestRecord = manifestByCanonicalId.get(registration.canonicalId)
    if (!manifestRecord) {
      return fail(
        'unknown-canonical-id',
        registration.canonicalId,
        `MoveSpec registration ${JSON.stringify(registration.canonicalId)} has no semantic manifest row.`,
      )
    }
    const definition = validateMoveSpec(registration.spec, {
      capabilityIds: manifestRecord.capabilityTags,
      rulesetVersion: manifestRecord.rulesProvenance,
      handlerRegistry,
    })
    if (definition.spec.canonicalId !== registration.canonicalId) {
      return fail(
        'canonical-id-mismatch',
        registration.canonicalId,
        `MoveSpec registration key ${JSON.stringify(registration.canonicalId)} does not match spec canonicalId ${JSON.stringify(definition.spec.canonicalId)}.`,
      )
    }

    return Object.freeze({
      canonicalId: registration.canonicalId,
      kind: 'movespec-v2' as const,
      version: definition.spec.version,
      definitionHash: definition.definitionHash,
      sourceModule: registration.sourceModule,
      definition,
    })
  })
}

/**
 * Build the authoritative dual registry. Both generations may coexist for a
 * canonical move during migration, but resolution exposes only the exact
 * version/hash/source selected by the server-owned manifest.
 */
export const createMoveAutomationRuntimeRegistry = (
  options: CreateMoveAutomationRuntimeRegistryOptions,
): MoveAutomationRuntimeRegistry => {
  const handlerRegistry = options.handlerRegistry ?? REGISTERED_MOVE_HANDLER_REGISTRY
  const legacyAdapters = buildLegacyAdapters(options.legacySources ?? [])
  const moveSpecRuntimes = buildMoveSpecRuntimes(
    options.manifest,
    options.moveSpecs ?? [],
    handlerRegistry,
  )
  const allRuntimes: readonly RegisteredMoveAutomationRuntime[] = [
    ...legacyAdapters,
    ...moveSpecRuntimes,
  ]

  validateMoveAutomationRuntimeRegistrations(
    options.manifest,
    allRuntimes.map(runtimeRegistrationReference),
  )

  const legacyByCanonicalId = new Map(
    legacyAdapters.map(runtime => [runtime.canonicalId, runtime]),
  )
  const moveSpecByCanonicalId = new Map(
    moveSpecRuntimes.map(runtime => [runtime.canonicalId, runtime]),
  )
  const selected = new Map<string, RegisteredMoveAutomationRuntime>()

  for (const record of options.manifest.moves) {
    const runtime = record.runtime.kind === 'legacy-v1'
      ? legacyByCanonicalId.get(record.canonicalId)
      : record.runtime.kind === 'movespec-v2'
        ? moveSpecByCanonicalId.get(record.canonicalId)
        : undefined
    if (runtime) selected.set(record.canonicalId, runtime)
  }

  return Object.freeze({
    size: selected.size,
    handlerRegistry,
    resolve: (canonicalId: string) => selected.get(canonicalId) ?? null,
    entries: () => Object.freeze([...selected.values()]),
  })
}

/** Native v2 definitions are added here only after their manifest metadata is reviewed. */
export const REVIEWED_MOVE_SPEC_V2_REGISTRATIONS: readonly MoveSpecV2Registration[] = Object.freeze([
  ABSORB_MOVE_SPEC_REGISTRATION,
  ASTONISH_MOVE_SPEC_REGISTRATION,
  DARK_VOID_MOVE_SPEC_REGISTRATION,
  DOUBLE_KICK_MOVE_SPEC_REGISTRATION,
  DRAGON_RAGE_MOVE_SPEC_REGISTRATION,
  EMBER_MOVE_SPEC_REGISTRATION,
  FURY_ATTACK_MOVE_SPEC_REGISTRATION,
  FURY_CUTTER_MOVE_SPEC_REGISTRATION,
  FURY_SWIPES_MOVE_SPEC_REGISTRATION,
  FAKE_OUT_MOVE_SPEC_REGISTRATION,
  HELPING_HAND_MOVE_SPEC_REGISTRATION,
  HYPER_BEAM_MOVE_SPEC_REGISTRATION,
  KNOCK_OFF_MOVE_SPEC_REGISTRATION,
  PIN_MISSILE_MOVE_SPEC_REGISTRATION,
  POWER_TRIP_MOVE_SPEC_REGISTRATION,
  REFLECT_MOVE_SPEC_REGISTRATION,
  SAND_ATTACK_MOVE_SPEC_REGISTRATION,
  SAND_TOMB_MOVE_SPEC_REGISTRATION,
  SCRATCH_MOVE_SPEC_REGISTRATION,
  SWORDS_DANCE_MOVE_SPEC_REGISTRATION,
  SUPERSONIC_MOVE_SPEC_REGISTRATION,
  SWEET_SCENT_MOVE_SPEC_REGISTRATION,
  SYNTHESIS_MOVE_SPEC_REGISTRATION,
  TACKLE_MOVE_SPEC_REGISTRATION,
  TAKE_DOWN_MOVE_SPEC_REGISTRATION,
  THUNDER_WAVE_MOVE_SPEC_REGISTRATION,
  TOPSY_TURVY_MOVE_SPEC_REGISTRATION,
  TOXIC_MOVE_SPEC_REGISTRATION,
  U_TURN_MOVE_SPEC_REGISTRATION,
  YAWN_MOVE_SPEC_REGISTRATION,
])

export const MOVE_AUTOMATION_RUNTIME_REGISTRY = createMoveAutomationRuntimeRegistry({
  manifest: manifestJson as unknown as MoveAutomationManifest,
  legacySources: EXPLICIT_MOVE_AUTOMATION_REGISTRY_SOURCES,
  moveSpecs: REVIEWED_MOVE_SPEC_V2_REGISTRATIONS,
})

/** No runtime kind is accepted here: clients can identify only the canonical move. */
export const registeredMoveAutomationRuntimeFor = (
  canonicalId: string,
): RegisteredMoveAutomationRuntime | null =>
  MOVE_AUTOMATION_RUNTIME_REGISTRY.resolve(canonicalId)
