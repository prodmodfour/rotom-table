import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { BreedingAuthorizationReceiptV1, BreedingTrainerControlEvidenceV1 } from '#shared/breeding/authorization'
import { parsePokemonEggDocumentV1, type PokemonEggDocumentV1 } from '#shared/breeding/egg'
import {
  parsePokemonEggTransferConsentV1,
  parsePokemonEggTransferProjectionV1,
  type PokemonEggTransferConsentStatusV1,
  type PokemonEggTransferConsentV1,
  type PokemonEggTransferProjectionV1,
} from '#shared/breeding/eggTransfer'
import {
  parseBreedingOperationIdSyntax,
  parsePokemonEggTransferConsentIdSyntax,
} from '#shared/breeding/ids'
import { parseBreedingOperationCommandV1 } from '#shared/breeding/operations'
import {
  createBreedingAuthorizationReceiptV1,
  parseAuthoritativeBreedingActorAuthorityV1,
  parseAuthoritativeBreedingTrainerControlEvidenceV1,
} from './authorization'
import { createBreedingOperationCommandHash } from './operations'
import { validateBreedingOperationReadSetCompleteness } from './readSets'

export const POKEMON_EGG_TRANSFER_POLICY_DEFINITION = Object.freeze({
  schemaVersion: 1,
  policyId: 'pokemon-egg-transfer-consent-policy-v1',
  allowedEggStatuses: Object.freeze(['incubating', 'ready']),
  consentRoles: Object.freeze(['source-gift', 'recipient-acceptance']),
  requiredActiveConsentCount: 2,
  maximumConsentDurationCampaignMinutes: 43_200,
  expiryBoundary: 'invalid-at-equality',
  gmOverride: 'cannot-replace-either-positive-consent',
  mutation: Object.freeze({
    egg: 'owner-revision-update-minute-last-operation-only',
    consents: 'consume-both-in-same-transaction',
    incubationReadinessBlueprint: 'preserve-exactly',
  }),
  storage: Object.freeze({
    custodyObservation: 'non-mutating',
    campaignClock: 'continues',
    mapEncounterBrowserWallClock: 'never-authority',
  }),
  privacy: Object.freeze({
    invitation: 'coarse-targeted-projection-only',
    formerOwnerAfterCommit: 'refresh-removal-signal-only',
    recipientBeforeConsent: 'no-blueprint-parent-breeder-source-or-provider-data',
    realtime: 'restricted-refresh-events-only',
  }),
  clientAuthority: 'none',
})

const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')
const withoutHash = <Value extends { readonly definitionSha256: string }>(value: Value): Omit<Value, 'definitionSha256'> => {
  const { definitionSha256: _definitionSha256, ...definition } = value
  return definition
}
const same = (left: unknown, right: unknown): boolean => stableJsonStringify(left) === stableJsonStringify(right)

export const POKEMON_EGG_TRANSFER_POLICY_DEFINITION_SHA256 = sha256(POKEMON_EGG_TRANSFER_POLICY_DEFINITION)

export type PokemonEggTransferAuthorityErrorCode =
  | 'breeding.egg-transfer.hash-mismatch'
  | 'breeding.egg-transfer.invalid-authority'
  | 'breeding.egg-transfer.stale-authority'
  | 'breeding.egg-transfer.consent-unavailable'
  | 'breeding.egg-transfer.contract-drift'

export class PokemonEggTransferAuthorityError extends Error {
  readonly code: PokemonEggTransferAuthorityErrorCode
  readonly path: string

  constructor(code: PokemonEggTransferAuthorityErrorCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'PokemonEggTransferAuthorityError'
    this.code = code
    this.path = path
  }
}

const fail = (code: PokemonEggTransferAuthorityErrorCode, path: string, message: string): never => {
  throw new PokemonEggTransferAuthorityError(code, path, message)
}
const campaignMinute = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    return fail('breeding.egg-transfer.invalid-authority', path, 'must be one non-negative safe campaign minute.')
  }
  return value as number
}
const trainerFact = (value: unknown, path: string): {
  readonly slug: string
  readonly revision: number
  readonly definitionSha256: string
} => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.egg-transfer.invalid-authority', path, 'must be one plain current Trainer fact.')
  }
  const row = value as Record<string, unknown>
  if (Object.keys(row).length !== 3 || !Object.hasOwn(row, 'slug')
    || !Object.hasOwn(row, 'revision') || !Object.hasOwn(row, 'definitionSha256')) {
    return fail('breeding.egg-transfer.invalid-authority', path, 'must contain exactly slug, revision, and definitionSha256.')
  }
  for (const field of ['slug', 'revision', 'definitionSha256']) {
    const descriptor = Object.getOwnPropertyDescriptor(row, field)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.egg-transfer.invalid-authority', `${path}.${field}`, 'must be an enumerable data field.')
    }
  }
  if (typeof row.slug !== 'string' || !/^[a-z0-9-]+$/.test(row.slug)
    || !Number.isSafeInteger(row.revision) || (row.revision as number) < 0
    || typeof row.definitionSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(row.definitionSha256)) {
    return fail('breeding.egg-transfer.invalid-authority', path, 'must identify one exact current Trainer revision and hash.')
  }
  return Object.freeze({
    slug: row.slug,
    revision: row.revision as number,
    definitionSha256: row.definitionSha256,
  })
}

export const pokemonEggTransferConsentDefinitionSha256 = (value: unknown): string => {
  const consent = parsePokemonEggTransferConsentV1(value)
  return sha256(withoutHash(consent))
}

export const parseAuthoritativePokemonEggTransferConsentV1 = (
  value: unknown,
  path = 'pokemonEggTransferConsent',
): PokemonEggTransferConsentV1 => {
  const consent = parsePokemonEggTransferConsentV1(value, path)
  if (pokemonEggTransferConsentDefinitionSha256(consent) !== consent.definitionSha256) {
    return fail('breeding.egg-transfer.hash-mismatch', `${path}.definitionSha256`, 'does not match the strict transfer consent.')
  }
  return consent
}

export const isPokemonEggTransferConsentCurrentlyUsable = (
  consentValue: unknown,
  input: {
    readonly eggId: string
    readonly eggRevision: number
    readonly sourceTrainerSlug: string
    readonly destinationTrainerSlug: string
    readonly atCampaignMinute: number
  },
): boolean => {
  const consent = parseAuthoritativePokemonEggTransferConsentV1(consentValue)
  return consent.status === 'active'
    && consent.eggId === input.eggId
    && consent.eggRevision === input.eggRevision
    && consent.sourceTrainerSlug === input.sourceTrainerSlug
    && consent.destinationTrainerSlug === input.destinationTrainerSlug
    && input.atCampaignMinute >= consent.grantedAtCampaignMinute
    && input.atCampaignMinute < consent.expiresAtCampaignMinute
}

export const createPokemonEggTransferConsentV1 = (input: {
  readonly consentId: unknown
  readonly role: 'source-gift' | 'recipient-acceptance'
  readonly egg: unknown
  readonly sourceTrainer: unknown
  readonly destinationTrainer: unknown
  readonly trainerControl: unknown
  readonly counterpartConsent: unknown | null
  readonly grantedAtCampaignMinute: unknown
  readonly expiresAtCampaignMinute: unknown
}): PokemonEggTransferConsentV1 => {
  const egg = parsePokemonEggDocumentV1(input.egg)
  const source = trainerFact(input.sourceTrainer, 'sourceTrainer')
  const destination = trainerFact(input.destinationTrainer, 'destinationTrainer')
  const control = parseAuthoritativeBreedingTrainerControlEvidenceV1(input.trainerControl)
  const grantedAt = campaignMinute(input.grantedAtCampaignMinute, 'grantedAtCampaignMinute')
  const expiresAt = campaignMinute(input.expiresAtCampaignMinute, 'expiresAtCampaignMinute')
  const parsedConsentId = parsePokemonEggTransferConsentIdSyntax(input.consentId)
    ?? fail('breeding.egg-transfer.invalid-authority', 'consentId', 'must be one Egg-transfer consent ID.')
  if (!['incubating', 'ready'].includes(egg.status) || egg.hatchOperationId !== null
    || egg.ownerTrainerSlug !== source.slug || source.slug === destination.slug
    || grantedAt < egg.updatedAtCampaignMinute
    || control.evaluatedAtCampaignMinute !== grantedAt
    || expiresAt <= grantedAt
    || expiresAt - grantedAt > POKEMON_EGG_TRANSFER_POLICY_DEFINITION.maximumConsentDurationCampaignMinutes) {
    return fail('breeding.egg-transfer.stale-authority', 'consent', 'must bind a transferable current Egg, distinct Trainers, current campaign time, and bounded future expiry.')
  }
  const expectedTrainer = input.role === 'source-gift' ? source : destination
  if (control.trainerSheetSlug !== expectedTrainer.slug
    || control.trainerSheetRevision !== expectedTrainer.revision
    || control.trainerSheetDefinitionSha256 !== expectedTrainer.definitionSha256) {
    return fail('breeding.egg-transfer.invalid-authority', 'trainerControl', 'must bind the exact consenting Trainer revision and document.')
  }
  let counterpartConsentId = null
  if (input.role === 'source-gift') {
    if (input.counterpartConsent !== null) {
      return fail('breeding.egg-transfer.invalid-authority', 'counterpartConsent', 'a source gift creates the first consent and cannot cite a counterpart.')
    }
  }
  else {
    const counterpart = parseAuthoritativePokemonEggTransferConsentV1(input.counterpartConsent, 'counterpartConsent')
    if (counterpart.role !== 'source-gift'
      || !isPokemonEggTransferConsentCurrentlyUsable(counterpart, {
        eggId: egg.eggId,
        eggRevision: egg.revision,
        sourceTrainerSlug: source.slug,
        destinationTrainerSlug: destination.slug,
        atCampaignMinute: grantedAt,
      })
      || counterpart.expiresAtCampaignMinute !== expiresAt) {
      return fail('breeding.egg-transfer.consent-unavailable', 'counterpartConsent', 'recipient acceptance requires the exact active source gift at the same expiry.')
    }
    counterpartConsentId = counterpart.consentId
  }
  const definition = {
    schemaVersion: 1 as const,
    consentId: parsedConsentId,
    revision: 0 as const,
    status: 'active' as const,
    role: input.role,
    eggId: egg.eggId,
    eggRevision: egg.revision,
    sourceTrainerSlug: source.slug,
    destinationTrainerSlug: destination.slug,
    consentingProfileId: control.profileId,
    consentingTrainerSlug: expectedTrainer.slug,
    consentingTrainerRevision: expectedTrainer.revision,
    consentingTrainerDefinitionSha256: expectedTrainer.definitionSha256,
    trainerControlDefinitionSha256: control.definitionSha256,
    counterpartConsentId,
    grantedAtCampaignMinute: grantedAt,
    expiresAtCampaignMinute: expiresAt,
    settlementOperationId: null,
    settledAtCampaignMinute: null,
  }
  return parseAuthoritativePokemonEggTransferConsentV1({
    ...definition,
    definitionSha256: sha256(definition),
  })
}

export const settlePokemonEggTransferConsentV1 = (input: {
  readonly consent: unknown
  readonly status: Exclude<PokemonEggTransferConsentStatusV1, 'active'>
  readonly operationId: unknown
  readonly settledAtCampaignMinute: unknown
}): PokemonEggTransferConsentV1 => {
  const consent = parseAuthoritativePokemonEggTransferConsentV1(input.consent)
  const operationId = parseBreedingOperationIdSyntax(input.operationId)
    ?? fail('breeding.egg-transfer.invalid-authority', 'operationId', 'must be one Breeding operation ID.')
  const settledAt = campaignMinute(input.settledAtCampaignMinute, 'settledAtCampaignMinute')
  if (consent.status !== 'active' || settledAt < consent.grantedAtCampaignMinute
    || (input.status === 'consumed' && settledAt >= consent.expiresAtCampaignMinute)
    || (input.status === 'expired' && settledAt < consent.expiresAtCampaignMinute)) {
    return fail('breeding.egg-transfer.consent-unavailable', 'consent', 'only one active consent may settle once at a status-valid campaign checkpoint.')
  }
  const definition = {
    ...withoutHash(consent),
    revision: 1 as const,
    status: input.status,
    settlementOperationId: operationId,
    settledAtCampaignMinute: settledAt,
  }
  return parseAuthoritativePokemonEggTransferConsentV1({
    ...definition,
    definitionSha256: sha256(definition),
  })
}

export const validatePokemonEggTransferConsentSuccessor = (
  previousValue: unknown,
  nextValue: unknown,
): PokemonEggTransferConsentV1 => {
  const previous = parseAuthoritativePokemonEggTransferConsentV1(previousValue, 'previousConsent')
  const next = parseAuthoritativePokemonEggTransferConsentV1(nextValue, 'nextConsent')
  const expected = settlePokemonEggTransferConsentV1({
    consent: previous,
    status: next.status === 'active'
      ? fail('breeding.egg-transfer.contract-drift', 'nextConsent.status', 'a successor must settle the active consent.')
      : next.status,
    operationId: next.settlementOperationId,
    settledAtCampaignMinute: next.settledAtCampaignMinute,
  })
  if (!same(expected, next)) {
    return fail('breeding.egg-transfer.contract-drift', 'nextConsent', 'must be the exact one-step terminal successor.')
  }
  return next
}

export interface ResolvedPokemonEggTransferAgreementV1 {
  readonly sourceConsent: PokemonEggTransferConsentV1
  readonly recipientConsent: PokemonEggTransferConsentV1
  readonly definitionSha256: string
}

export const resolvePokemonEggTransferAgreementV1 = (input: {
  readonly egg: unknown
  readonly destinationTrainerSlug: string
  readonly consents: readonly unknown[]
  readonly atCampaignMinute: unknown
}): ResolvedPokemonEggTransferAgreementV1 => {
  const egg = parsePokemonEggDocumentV1(input.egg)
  const at = campaignMinute(input.atCampaignMinute, 'atCampaignMinute')
  if (!Array.isArray(input.consents) || Object.getPrototypeOf(input.consents) !== Array.prototype
    || input.consents.length !== 2 || Object.getOwnPropertySymbols(input.consents).length > 0
    || Object.getOwnPropertyNames(input.consents).length !== 3) {
    return fail('breeding.egg-transfer.invalid-authority', 'consents', 'must contain exactly two plain consent records.')
  }
  for (let index = 0; index < input.consents.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(input.consents, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.egg-transfer.invalid-authority', `consents[${index}]`, 'must be one enumerable data entry.')
    }
  }
  const parsed = input.consents.map((value, index) => parseAuthoritativePokemonEggTransferConsentV1(value, `consents[${index}]`))
  const source = parsed.find(value => value.role === 'source-gift')
  const recipient = parsed.find(value => value.role === 'recipient-acceptance')
  if (!source || !recipient || source.consentId === recipient.consentId
    || recipient.counterpartConsentId !== source.consentId
    || source.expiresAtCampaignMinute !== recipient.expiresAtCampaignMinute
    || source.sourceTrainerSlug !== recipient.sourceTrainerSlug
    || source.destinationTrainerSlug !== recipient.destinationTrainerSlug
    || source.eggId !== recipient.eggId || source.eggRevision !== recipient.eggRevision
    || !isPokemonEggTransferConsentCurrentlyUsable(source, {
      eggId: egg.eggId,
      eggRevision: egg.revision,
      sourceTrainerSlug: egg.ownerTrainerSlug,
      destinationTrainerSlug: input.destinationTrainerSlug,
      atCampaignMinute: at,
    })
    || !isPokemonEggTransferConsentCurrentlyUsable(recipient, {
      eggId: egg.eggId,
      eggRevision: egg.revision,
      sourceTrainerSlug: egg.ownerTrainerSlug,
      destinationTrainerSlug: input.destinationTrainerSlug,
      atCampaignMinute: at,
    })) {
    return fail('breeding.egg-transfer.consent-unavailable', 'consents', 'must be the exact current active source gift and linked recipient acceptance.')
  }
  const definition = { sourceConsent: source, recipientConsent: recipient }
  return Object.freeze({ ...definition, definitionSha256: sha256(definition) })
}

export const pokemonEggTransferEffectiveEvidenceSha256 = (input: {
  readonly egg: PokemonEggDocumentV1
  readonly agreement: ResolvedPokemonEggTransferAgreementV1
  readonly sourceControl: BreedingTrainerControlEvidenceV1
  readonly destinationControl: BreedingTrainerControlEvidenceV1
}): string => sha256({
  eggId: input.egg.eggId,
  eggRevision: input.egg.revision,
  agreementDefinitionSha256: input.agreement.definitionSha256,
  sourceControlDefinitionSha256: input.sourceControl.definitionSha256,
  destinationControlDefinitionSha256: input.destinationControl.definitionSha256,
})

export const authorizePokemonEggTransferV1 = (input: {
  readonly command: unknown
  readonly readSet: unknown
  readonly actorAuthority: unknown
  readonly egg: unknown
  readonly agreement: ResolvedPokemonEggTransferAgreementV1
  readonly sourceControl: unknown
  readonly destinationControl: unknown
  readonly gmAuthorityVerified: boolean
  readonly securityPolicyDefinitionSha256: string
}): BreedingAuthorizationReceiptV1 => {
  const command = parseBreedingOperationCommandV1(input.command)
  if (command.commandKind !== 'transfer-egg') {
    return fail('breeding.egg-transfer.invalid-authority', 'command.commandKind', 'must be transfer-egg.')
  }
  const readSet = validateBreedingOperationReadSetCompleteness(command, input.readSet)
  const actor = parseAuthoritativeBreedingActorAuthorityV1(input.actorAuthority)
  const egg = parsePokemonEggDocumentV1(input.egg)
  const sourceControl = parseAuthoritativeBreedingTrainerControlEvidenceV1(input.sourceControl, 'sourceControl')
  const destinationControl = parseAuthoritativeBreedingTrainerControlEvidenceV1(input.destinationControl, 'destinationControl')
  const agreement = resolvePokemonEggTransferAgreementV1({
    egg,
    destinationTrainerSlug: command.payload.destinationTrainerSlug,
    consents: [input.agreement.sourceConsent, input.agreement.recipientConsent],
    atCampaignMinute: readSet.capturedAtCampaignMinute,
  })
  const actorMatches = actor.commandActorProfileId === command.actor.profileId
    && actor.selectedTrainerSlug === command.actor.selectedTrainerSlug
    && actor.evaluatedAtCampaignMinute === readSet.capturedAtCampaignMinute
  const playerParticipant = actor.role === 'player' && (
    (actor.authenticatedProfileId === sourceControl.profileId
      && actor.profileDefinitionSha256 === sourceControl.profileDefinitionSha256
      && actor.selectedTrainerSlug === sourceControl.trainerSheetSlug)
    ||
    (actor.authenticatedProfileId === destinationControl.profileId
      && actor.profileDefinitionSha256 === destinationControl.profileDefinitionSha256
      && actor.selectedTrainerSlug === destinationControl.trainerSheetSlug)
  )
  const controlsMatch = sourceControl.profileId === agreement.sourceConsent.consentingProfileId
    && sourceControl.trainerSheetSlug === egg.ownerTrainerSlug
    && sourceControl.trainerSheetRevision === agreement.sourceConsent.consentingTrainerRevision
    && sourceControl.trainerSheetDefinitionSha256 === agreement.sourceConsent.consentingTrainerDefinitionSha256
    && destinationControl.profileId === agreement.recipientConsent.consentingProfileId
    && destinationControl.trainerSheetSlug === command.payload.destinationTrainerSlug
    && destinationControl.trainerSheetRevision === agreement.recipientConsent.consentingTrainerRevision
    && destinationControl.trainerSheetDefinitionSha256 === agreement.recipientConsent.consentingTrainerDefinitionSha256
    && sourceControl.evaluatedAtCampaignMinute === readSet.capturedAtCampaignMinute
    && destinationControl.evaluatedAtCampaignMinute === readSet.capturedAtCampaignMinute
  const authorized = actorMatches && controlsMatch
    && ((actor.role === 'player' && playerParticipant && input.gmAuthorityVerified === false)
      || (actor.role === 'gm' && input.gmAuthorityVerified === true))
  const evidenceDefinitionHashes = [
    actor.definitionSha256,
    sourceControl.definitionSha256,
    destinationControl.definitionSha256,
    agreement.sourceConsent.definitionSha256,
    agreement.recipientConsent.definitionSha256,
    agreement.definitionSha256,
    POKEMON_EGG_TRANSFER_POLICY_DEFINITION_SHA256,
  ]
  return createBreedingAuthorizationReceiptV1({
    operationId: command.operationId,
    commandSha256: createBreedingOperationCommandHash(command),
    commandKind: command.commandKind,
    actorAuthorityDefinitionSha256: actor.definitionSha256,
    readSetDefinitionSha256: readSet.definitionSha256,
    evidenceDefinitionHashes,
    gmOverrideIds: [],
    authorized,
    reasonId: authorized
      ? 'breeding.authorization.authorized'
      : controlsMatch
        ? 'breeding.authorization.actor-mismatch'
        : 'breeding.authorization.consent-required',
    evaluatedAtCampaignMinute: readSet.capturedAtCampaignMinute,
    securityPolicyDefinitionSha256: input.securityPolicyDefinitionSha256,
  })
}

export const projectPokemonEggTransferV1 = (input: {
  readonly sourceConsent: unknown
  readonly recipientConsent: unknown | null
  readonly audience: 'source-owner' | 'recipient'
  readonly generatedAtCampaignMinute: unknown
}): PokemonEggTransferProjectionV1 => {
  const source = parseAuthoritativePokemonEggTransferConsentV1(input.sourceConsent)
  const recipient = input.recipientConsent === null
    ? null
    : parseAuthoritativePokemonEggTransferConsentV1(input.recipientConsent)
  const generatedAt = campaignMinute(input.generatedAtCampaignMinute, 'generatedAtCampaignMinute')
  if (recipient && (recipient.role !== 'recipient-acceptance'
    || recipient.counterpartConsentId !== source.consentId
    || recipient.eggId !== source.eggId || recipient.eggRevision !== source.eggRevision
    || recipient.sourceTrainerSlug !== source.sourceTrainerSlug
    || recipient.destinationTrainerSlug !== source.destinationTrainerSlug)) {
    return fail('breeding.egg-transfer.invalid-authority', 'recipientConsent', 'must be the linked acceptance for this source gift.')
  }
  const state = source.status === 'consumed'
    ? 'transferred' as const
    : source.status === 'revoked'
      ? 'revoked' as const
      : source.status === 'expired' || generatedAt >= source.expiresAtCampaignMinute
        ? 'expired' as const
        : recipient?.status === 'active'
          ? 'accepted' as const
          : 'offered' as const
  return parsePokemonEggTransferProjectionV1({
    schemaVersion: 1,
    audience: input.audience,
    offerConsentId: source.consentId,
    eggId: source.eggId,
    eggRevision: source.eggRevision,
    state,
    counterpartyTrainerSlug: input.audience === 'source-owner'
      ? source.destinationTrainerSlug
      : source.sourceTrainerSlug,
    canAccept: state === 'offered' && input.audience === 'recipient',
    canTransfer: state === 'accepted',
    canRevoke: state === 'offered' || state === 'accepted',
    expiresAtCampaignMinute: source.expiresAtCampaignMinute,
    generatedAtCampaignMinute: generatedAt,
  })
}
