import { stableJsonStringify } from '#shared/automation/stableJson'
import type { BreedingActorAuthorityV1 } from '#shared/breeding/authorization'
import type { BreedingBreederEdgeHandoffV1 } from '#shared/breeding/breederEdgeHandoff'
import { isSlug } from '#shared/paths'
import {
  parseAuthoritativeBreedingActorAuthorityV1,
  parseAuthoritativeBreedingTrainerControlEvidenceV1,
} from '../domain/breeding/authorization'
import {
  createBreedingBreederEdgeHandoffV1,
  type BreedingBreederEdgeHandoffDependencies,
} from '../domain/breeding/breederEdgeHandoff'
import { createSqliteCampaignClockRepository } from '../storage/campaignClockRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqliteSheetRepository } from '../storage/sheetRepository'

export interface ResolveCurrentBreedingBreederEdgeHandoffInputV1 {
  readonly breederTrainerSlug: unknown
  readonly expectedTrainerSheetRevision: unknown
  readonly checkpoint: unknown
  readonly actorAuthority: unknown
  readonly breederTrainerControl: unknown | null
}

export interface ResolveCurrentBreedingBreederEdgeHandoffOptions extends BreedingBreederEdgeHandoffDependencies {
  readonly database?: RotomDatabase
  readonly validateCurrentGmAuthority?: (actor: BreedingActorAuthorityV1) => boolean
}

export type ResolveCurrentBreedingBreederEdgeHandoffErrorCode =
  | 'breeding.breeder-edge-handoff-use-case.invalid-request'
  | 'breeding.breeder-edge-handoff-use-case.invalid-authority'
  | 'breeding.breeder-edge-handoff-use-case.stale-authority'
  | 'breeding.breeder-edge-handoff-use-case.unavailable'

export class ResolveCurrentBreedingBreederEdgeHandoffError extends Error {
  readonly code: ResolveCurrentBreedingBreederEdgeHandoffErrorCode

  constructor(code: ResolveCurrentBreedingBreederEdgeHandoffErrorCode, message: string) {
    super(message)
    this.name = 'ResolveCurrentBreedingBreederEdgeHandoffError'
    this.code = code
  }
}

const fail = (code: ResolveCurrentBreedingBreederEdgeHandoffErrorCode, message: string): never => {
  throw new ResolveCurrentBreedingBreederEdgeHandoffError(code, message)
}
const promiseLike = (value: unknown): value is PromiseLike<unknown> => (
  (typeof value === 'object' || typeof value === 'function') && value !== null
  && typeof (value as { readonly then?: unknown }).then === 'function'
)
const exact = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.breeder-edge-handoff-use-case.invalid-request', 'Breeder Edge handoff request must be a plain exact object.')
  }
  const row = value as Record<string, unknown>
  const fields = [
    'breederTrainerSlug',
    'expectedTrainerSheetRevision',
    'checkpoint',
    'actorAuthority',
    'breederTrainerControl',
  ]
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field))
    || Object.getOwnPropertyNames(row).some(field => !allowed.has(field))) {
    return fail('breeding.breeder-edge-handoff-use-case.invalid-request', 'Breeder Edge handoff request must contain exactly the declared fields.')
  }
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(row, field)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.breeder-edge-handoff-use-case.invalid-request', `Breeder Edge handoff request ${field} must be an enumerable data field.`)
    }
  }
  return row
}

export const resolveCurrentBreedingBreederEdgeHandoff = (
  inputValue: ResolveCurrentBreedingBreederEdgeHandoffInputV1,
  options: ResolveCurrentBreedingBreederEdgeHandoffOptions = {},
): BreedingBreederEdgeHandoffV1 => {
  const input = exact(inputValue)
  if (!isSlug(input.breederTrainerSlug) || (input.breederTrainerSlug as string).length > 160
    || !Number.isSafeInteger(input.expectedTrainerSheetRevision)
    || (input.expectedTrainerSheetRevision as number) < 0
    || (input.expectedTrainerSheetRevision as number) > 2_147_483_647) {
    return fail('breeding.breeder-edge-handoff-use-case.invalid-request', 'Breeder Trainer identity and expected revision must be canonical bounded values.')
  }
  const actor = parseAuthoritativeBreedingActorAuthorityV1(input.actorAuthority)
  const database = options.database ?? getRotomDatabase()
  const clockRepository = createSqliteCampaignClockRepository(database)
  const sheetRepository = createSqliteSheetRepository(database)
  const clock = clockRepository.get()
  if (actor.evaluatedAtCampaignMinute !== clock.campaignMinute) {
    return fail('breeding.breeder-edge-handoff-use-case.stale-authority', 'Actor authority must use the exact current campaign minute.')
  }
  let accessMode: 'profile-control' | 'gm-authority'
  let accessEvidenceDefinitionSha256: string
  if (actor.role === 'gm') {
    if (input.breederTrainerControl !== null) {
      return fail('breeding.breeder-edge-handoff-use-case.invalid-authority', 'GM Breeder authority rejects extraneous Profile control evidence.')
    }
    if (typeof options.validateCurrentGmAuthority !== 'function') {
      return fail('breeding.breeder-edge-handoff-use-case.invalid-authority', 'A current server-owned GM verifier is required.')
    }
    let verified: unknown
    try { verified = options.validateCurrentGmAuthority(actor) }
    catch { return fail('breeding.breeder-edge-handoff-use-case.invalid-authority', 'Current GM verification failed closed.') }
    if (promiseLike(verified) || verified !== true) {
      return fail('breeding.breeder-edge-handoff-use-case.invalid-authority', 'Current authenticated GM authority is required.')
    }
    accessMode = 'gm-authority'
    accessEvidenceDefinitionSha256 = actor.definitionSha256
  }
  else {
    if (options.validateCurrentGmAuthority !== undefined) {
      return fail('breeding.breeder-edge-handoff-use-case.invalid-authority', 'Player Breeder authority rejects extraneous GM verification callbacks.')
    }
    if (input.breederTrainerControl === null) {
      return fail('breeding.breeder-edge-handoff-use-case.invalid-authority', 'Current Profile control of the Breeder Trainer is required.')
    }
    const control = parseAuthoritativeBreedingTrainerControlEvidenceV1(input.breederTrainerControl)
    if (actor.authenticatedProfileId === null
      || control.profileId !== actor.authenticatedProfileId
      || control.profileDefinitionSha256 !== actor.profileDefinitionSha256
      || control.trainerSheetSlug !== input.breederTrainerSlug
      || control.evaluatedAtCampaignMinute !== clock.campaignMinute) {
      return fail('breeding.breeder-edge-handoff-use-case.invalid-authority', 'Breeder Trainer control must match the current authenticated Profile and campaign minute.')
    }
    accessMode = 'profile-control'
    accessEvidenceDefinitionSha256 = control.definitionSha256
  }
  const trainer = sheetRepository.get('trainer', input.breederTrainerSlug as string)
  if (!trainer) {
    return fail('breeding.breeder-edge-handoff-use-case.unavailable', 'The current Breeder Trainer is unavailable.')
  }
  if (trainer.revision !== input.expectedTrainerSheetRevision) {
    return fail('breeding.breeder-edge-handoff-use-case.stale-authority', 'The Breeder Trainer revision changed before handoff resolution.')
  }
  const handoff = createBreedingBreederEdgeHandoffV1({
    trainerSheet: {
      slug: trainer.slug,
      revision: trainer.revision,
      document: trainer.document,
    },
    accessMode,
    accessEvidenceDefinitionSha256,
    evaluatedAtCampaignMinute: clock.campaignMinute,
    checkpoint: input.checkpoint,
  }, {
    ...(options.resolveEffectiveEdges ? { resolveEffectiveEdges: options.resolveEffectiveEdges } : {}),
    ...(options.resolveTrainerSkills ? { resolveTrainerSkills: options.resolveTrainerSkills } : {}),
    ...(options.planTrainerEdgeCampaignOperation
      ? { planTrainerEdgeCampaignOperation: options.planTrainerEdgeCampaignOperation }
      : {}),
    ...(options.validateFeatureGrantedBreeder
      ? { validateFeatureGrantedBreeder: options.validateFeatureGrantedBreeder }
      : {}),
  })
  if (actor.role === 'player') {
    const control = parseAuthoritativeBreedingTrainerControlEvidenceV1(input.breederTrainerControl)
    if (control.trainerSheetRevision !== handoff.breederAuthority.breederTrainerRevision
      || control.trainerSheetDefinitionSha256 !== handoff.breederAuthority.breederTrainerDefinitionSha256
      || control.definitionSha256 !== handoff.breederAuthority.accessEvidenceDefinitionSha256) {
      return fail('breeding.breeder-edge-handoff-use-case.stale-authority', 'Profile control does not bind the exact current Breeder Trainer document.')
    }
  }
  const currentClock = clockRepository.get()
  const currentTrainer = sheetRepository.get('trainer', trainer.slug)
  if (currentClock.revision !== clock.revision || currentClock.campaignMinute !== clock.campaignMinute
    || !currentTrainer || currentTrainer.revision !== trainer.revision
    || stableJsonStringify(currentTrainer.document) !== stableJsonStringify(trainer.document)) {
    return fail('breeding.breeder-edge-handoff-use-case.stale-authority', 'Breeder Trainer or campaign clock changed during handoff resolution.')
  }
  return handoff
}
