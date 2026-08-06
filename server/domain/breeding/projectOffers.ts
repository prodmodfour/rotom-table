import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  parseCampaignOperationOfferDeclarationV1,
  type CampaignOperationOfferDeclarationV1,
  type CampaignOperationOfferV1,
} from '#shared/campaignOperationOffers'
import type {
  BreedingActorAuthorityV1,
  BreedingBreederAuthorityEvidenceV1,
  BreedingTrainerControlEvidenceV1,
} from '#shared/breeding/authorization'
import {
  parseBreedingOperationCommandV1,
  type BreedingOperationCommandV1,
} from '#shared/breeding/operations'
import {
  parseBreedingProjectCampaignOfferAuthorityV1,
  type BreedingProjectCampaignOfferAuthorityV1,
} from '#shared/breeding/projectOffers'
import {
  createCampaignOperationOfferV1,
  parseAuthoritativeCampaignOperationOfferV1,
} from '../campaignOperationOffers'
import {
  parseAuthoritativeBreedingActorAuthorityV1,
  parseAuthoritativeBreedingBreederAuthorityEvidenceV1,
  parseAuthoritativeBreedingTrainerControlEvidenceV1,
} from './authorization'
import {
  createBreedingOperationCommandHash,
} from './operations'
import { parseAuthoritativeBreedingReferenceVersionSnapshotV1 } from './readSets'

export type BreedingProjectOfferCommandV1 = Extract<
  BreedingOperationCommandV1,
  { readonly commandKind: 'create-breeding-project' | 'preview-breeding' }
>
export interface ProjectBreedingCampaignOperationOfferInput {
  readonly command: unknown
  readonly actorAuthority: unknown
  readonly ownerTrainerControl: unknown | null
  readonly breederTrainerControl: unknown | null
  readonly breederAuthority: unknown | null
  readonly referenceVersions: unknown
  readonly atCampaignMinute: number
  readonly securityPolicyDefinitionSha256: string
}
export interface ConsumeBreedingProjectCampaignOperationOfferInput
  extends ProjectBreedingCampaignOperationOfferInput {
  readonly declaration: unknown
}
export interface ConsumedBreedingProjectCampaignOperationOfferV1 {
  readonly offer: CampaignOperationOfferV1
  readonly authority: BreedingProjectCampaignOfferAuthorityV1
  readonly declaration: CampaignOperationOfferDeclarationV1
  readonly command: BreedingProjectOfferCommandV1
}

export type BreedingProjectCampaignOfferAuthorityErrorCode =
  | 'breeding.project-offer.command-unavailable'
  | 'breeding.project-offer.stale-authority'
  | 'breeding.project-offer.unauthorized'
  | 'breeding.project-offer.unavailable'
  | 'breeding.project-offer.declaration-mismatch'
  | 'breeding.project-offer.hash-mismatch'
export class BreedingProjectCampaignOfferAuthorityError extends Error {
  readonly code: BreedingProjectCampaignOfferAuthorityErrorCode
  constructor(code: BreedingProjectCampaignOfferAuthorityErrorCode, message: string) {
    super(message)
    this.name = 'BreedingProjectCampaignOfferAuthorityError'
    this.code = code
  }
}

const SHA256 = /^[0-9a-f]{64}$/u
const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')
const strictCampaignMinute = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) >= Number.MAX_SAFE_INTEGER) {
    throw new BreedingProjectCampaignOfferAuthorityError(
      'breeding.project-offer.stale-authority',
      'Campaign offer authority requires a current nonnegative campaign minute.',
    )
  }
  return Number(value)
}
const strictHash = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new BreedingProjectCampaignOfferAuthorityError(
      'breeding.project-offer.hash-mismatch',
      `${label} must be a lowercase SHA-256 digest.`,
    )
  }
  return value
}
const authorityDefinition = (
  value: BreedingProjectCampaignOfferAuthorityV1,
): Omit<BreedingProjectCampaignOfferAuthorityV1, 'authorityDefinitionSha256'> => {
  const { authorityDefinitionSha256: _hash, ...definition } = value
  return definition
}
const exact = (left: unknown, right: unknown): boolean => (
  stableJsonStringify(left) === stableJsonStringify(right)
)

export const parseAuthoritativeBreedingProjectCampaignOfferAuthorityV1 = (
  value: unknown,
  path = 'breedingProjectCampaignOfferAuthority',
): BreedingProjectCampaignOfferAuthorityV1 => {
  const authority = parseBreedingProjectCampaignOfferAuthorityV1(value, path)
  parseAuthoritativeCampaignOperationOfferV1(authority.offer, `${path}.offer`)
  if (sha256(authorityDefinition(authority)) !== authority.authorityDefinitionSha256) {
    throw new BreedingProjectCampaignOfferAuthorityError(
      'breeding.project-offer.hash-mismatch',
      `${path}.authorityDefinitionSha256 does not match the exact server authority record.`,
    )
  }
  return authority
}

const projectCommand = (actor: BreedingActorAuthorityV1, commandInput: unknown): BreedingProjectOfferCommandV1 => {
  const command = (() => {
    try { return parseBreedingOperationCommandV1(commandInput) }
    catch {
      throw new BreedingProjectCampaignOfferAuthorityError(
        'breeding.project-offer.command-unavailable',
        'Campaign offers support only strict Breeding Project preview or creation commands.',
      )
    }
  })()
  if (command.commandKind !== 'preview-breeding' && command.commandKind !== 'create-breeding-project') {
    throw new BreedingProjectCampaignOfferAuthorityError(
      'breeding.project-offer.command-unavailable',
      'Campaign offers support only Breeding Project preview or creation.',
    )
  }
  if (command.actor.profileId !== actor.commandActorProfileId
    || command.actor.selectedTrainerSlug !== actor.selectedTrainerSlug) {
    throw new BreedingProjectCampaignOfferAuthorityError(
      'breeding.project-offer.unauthorized',
      'The projected command actor and selected Trainer must match current authenticated authority.',
    )
  }
  return command
}

const currentPlayerControls = (input: {
  readonly actor: BreedingActorAuthorityV1
  readonly command: BreedingProjectOfferCommandV1
  readonly ownerTrainerControl: unknown | null
  readonly breederTrainerControl: unknown | null
  readonly minute: number
}): readonly [BreedingTrainerControlEvidenceV1, BreedingTrainerControlEvidenceV1] => {
  if (input.ownerTrainerControl === null || input.breederTrainerControl === null) {
    throw new BreedingProjectCampaignOfferAuthorityError(
      'breeding.project-offer.unauthorized',
      'Owner offers require current Profile control of owner and Breeder Trainers.',
    )
  }
  const owner = parseAuthoritativeBreedingTrainerControlEvidenceV1(input.ownerTrainerControl)
  const breeder = parseAuthoritativeBreedingTrainerControlEvidenceV1(input.breederTrainerControl)
  const profileId = input.actor.authenticatedProfileId
  if (!profileId || input.actor.selectedTrainerSlug !== input.command.payload.ownerTrainerSlug
    || owner.profileId !== profileId || breeder.profileId !== profileId
    || owner.trainerSheetSlug !== input.command.payload.ownerTrainerSlug
    || breeder.trainerSheetSlug !== input.command.payload.breederTrainerSlug
    || owner.profileDefinitionSha256 !== input.actor.profileDefinitionSha256
    || breeder.profileDefinitionSha256 !== input.actor.profileDefinitionSha256
    || owner.evaluatedAtCampaignMinute !== input.minute
    || breeder.evaluatedAtCampaignMinute !== input.minute) {
    throw new BreedingProjectCampaignOfferAuthorityError(
      'breeding.project-offer.unauthorized',
      'Owner and Breeder Trainer control must match the exact current Profile, command, and revisions.',
    )
  }
  return Object.freeze([owner, breeder])
}

const currentBreederAuthority = (input: {
  readonly value: unknown | null
  readonly breederControl: BreedingTrainerControlEvidenceV1
  readonly minute: number
}): BreedingBreederAuthorityEvidenceV1 | null => {
  if (input.value === null) return null
  const authority = parseAuthoritativeBreedingBreederAuthorityEvidenceV1(input.value)
  if (authority.breederTrainerSlug !== input.breederControl.trainerSheetSlug
    || authority.breederTrainerRevision !== input.breederControl.trainerSheetRevision
    || authority.breederTrainerDefinitionSha256 !== input.breederControl.trainerSheetDefinitionSha256
    || authority.accessMode !== 'profile-control'
    || authority.accessEvidenceDefinitionSha256 !== input.breederControl.definitionSha256
    || authority.edgeCanonicalId !== 'Breeder'
    || authority.evaluatedAtCampaignMinute !== input.minute) {
    throw new BreedingProjectCampaignOfferAuthorityError(
      'breeding.project-offer.unauthorized',
      'Breeder permission must be exact current effective Edge evidence for the controlled Trainer.',
    )
  }
  return authority
}

export const projectBreedingProjectCampaignOperationOfferV1 = (
  input: ProjectBreedingCampaignOperationOfferInput,
): BreedingProjectCampaignOfferAuthorityV1 => {
  const minute = strictCampaignMinute(input.atCampaignMinute)
  const actor = parseAuthoritativeBreedingActorAuthorityV1(input.actorAuthority)
  const command = projectCommand(actor, input.command)
  const references = parseAuthoritativeBreedingReferenceVersionSnapshotV1(input.referenceVersions)
  const securityPolicyDefinitionSha256 = strictHash(
    input.securityPolicyDefinitionSha256,
    'securityPolicyDefinitionSha256',
  )
  if (actor.evaluatedAtCampaignMinute !== minute
    || command.ruleset.rulesetId !== references.rulesetId
    || command.ruleset.definitionSha256 !== references.rulesetDefinitionSha256
    || command.payload.optionSnapshotDefinitionSha256
      !== references.campaignOptionSnapshotDefinitionSha256) {
    throw new BreedingProjectCampaignOfferAuthorityError(
      'breeding.project-offer.stale-authority',
      'Offer authority, command ruleset, references, and campaign minute must be exact current values.',
    )
  }

  let ownerControl: BreedingTrainerControlEvidenceV1 | null = null
  let breederControl: BreedingTrainerControlEvidenceV1 | null = null
  let breederAuthority: BreedingBreederAuthorityEvidenceV1 | null = null
  if (actor.role === 'gm') {
    if (input.ownerTrainerControl !== null || input.breederTrainerControl !== null
      || input.breederAuthority !== null) {
      throw new BreedingProjectCampaignOfferAuthorityError(
        'breeding.project-offer.unauthorized',
        'GM system offers reject extraneous player-control or Breeder Edge evidence.',
      )
    }
  }
  else {
    ;[ownerControl, breederControl] = currentPlayerControls({
      actor,
      command,
      ownerTrainerControl: input.ownerTrainerControl,
      breederTrainerControl: input.breederTrainerControl,
      minute,
    })
    breederAuthority = currentBreederAuthority({
      value: input.breederAuthority,
      breederControl,
      minute,
    })
  }

  const commandSha256 = createBreedingOperationCommandHash(command)
  const available = actor.role === 'gm' || breederAuthority !== null
  const actionId = command.commandKind === 'preview-breeding'
    ? 'breeding.project.preview'
    : 'breeding.project.create'
  const offer = createCampaignOperationOfferV1({
    identityMaterial: {
      workspaceId: 'breeding',
      actionId,
      commandOperationId: command.operationId,
      commandSha256,
      actorAuthorityDefinitionSha256: actor.definitionSha256,
      ownerTrainerControlDefinitionSha256: ownerControl?.definitionSha256 ?? null,
      breederTrainerControlDefinitionSha256: breederControl?.definitionSha256 ?? null,
      breederAuthorityDefinitionSha256: breederAuthority?.definitionSha256 ?? null,
      referenceVersionsDefinitionSha256: references.definitionSha256,
      securityPolicyDefinitionSha256,
      issuedAtCampaignMinute: minute,
    },
    definition: {
      audience: actor.role === 'gm' ? 'gm' : 'owner',
      role: 'campaign-operation',
      workspaceId: 'breeding',
      operationFamilyId: 'breeding-project',
      actionId,
      actor: actor.role === 'gm'
        ? { kind: 'campaign', resourceId: 'campaign', revision: null }
        : {
            kind: 'trainer-sheet',
            resourceId: ownerControl!.trainerSheetSlug,
            revision: ownerControl!.trainerSheetRevision,
          },
      source: actor.role === 'gm'
        ? { kind: 'system', canonicalId: 'breeding.v1' }
        : { kind: 'edge', canonicalId: 'Breeder' },
      availability: available
        ? { status: 'available', reasonId: null }
        : { status: 'unavailable', reasonId: 'breeding.offer.breeder-edge-required' },
      requiredInputKinds: command.commandKind === 'preview-breeding'
        ? ['parent-pair', 'project-options']
        : ['confirmation', 'parent-pair', 'project-options'],
      presentation: command.commandKind === 'preview-breeding'
        ? {
            labelId: 'breeding.project.preview.label',
            descriptionId: 'breeding.project.preview.description',
            tone: 'neutral',
          }
        : {
            labelId: 'breeding.project.create.label',
            descriptionId: 'breeding.project.create.description',
            tone: 'primary',
          },
      issuedAtCampaignMinute: minute,
      expiresAtCampaignMinute: minute + 1,
    },
  })
  const definition = {
    schemaVersion: 1 as const,
    offer,
    commandOperationId: command.operationId,
    commandSha256,
    actorAuthorityDefinitionSha256: actor.definitionSha256,
    ownerTrainerControlDefinitionSha256: ownerControl?.definitionSha256 ?? null,
    breederTrainerControlDefinitionSha256: breederControl?.definitionSha256 ?? null,
    breederAuthorityDefinitionSha256: breederAuthority?.definitionSha256 ?? null,
    referenceVersionsDefinitionSha256: references.definitionSha256,
    securityPolicyDefinitionSha256,
  }
  return parseAuthoritativeBreedingProjectCampaignOfferAuthorityV1({
    ...definition,
    authorityDefinitionSha256: sha256(definition),
  })
}

export const consumeBreedingProjectCampaignOperationOfferV1 = (
  input: ConsumeBreedingProjectCampaignOperationOfferInput,
): ConsumedBreedingProjectCampaignOperationOfferV1 => {
  const declaration = parseCampaignOperationOfferDeclarationV1(input.declaration)
  const authority = projectBreedingProjectCampaignOperationOfferV1(input)
  const command = projectCommand(
    parseAuthoritativeBreedingActorAuthorityV1(input.actorAuthority),
    input.command,
  )
  if (authority.offer.availability.status !== 'available') {
    throw new BreedingProjectCampaignOfferAuthorityError(
      'breeding.project-offer.unavailable',
      'Unavailable campaign-operation offers cannot be consumed.',
    )
  }
  if (declaration.offerId !== authority.offer.offerId
    || declaration.offerDefinitionSha256 !== authority.offer.offerDefinitionSha256
    || declaration.operationId !== authority.commandOperationId) {
    throw new BreedingProjectCampaignOfferAuthorityError(
      'breeding.project-offer.declaration-mismatch',
      'Campaign operation declaration must reuse the exact current server-projected offer and operation identities.',
    )
  }
  return Object.freeze({ offer: authority.offer, authority, declaration, command })
}

export const assertBreedingProjectCampaignOfferAuthorityExactReplayV1 = (
  existingValue: unknown,
  replayedValue: unknown,
): BreedingProjectCampaignOfferAuthorityV1 => {
  const existing = parseAuthoritativeBreedingProjectCampaignOfferAuthorityV1(existingValue, 'existingAuthority')
  const replayed = parseAuthoritativeBreedingProjectCampaignOfferAuthorityV1(replayedValue, 'replayedAuthority')
  if (!exact(existing, replayed)) {
    throw new BreedingProjectCampaignOfferAuthorityError(
      'breeding.project-offer.declaration-mismatch',
      'Campaign offer authority permits exact stable-JSON replay only.',
    )
  }
  return existing
}
