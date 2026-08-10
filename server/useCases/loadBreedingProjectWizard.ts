import { createHash } from 'node:crypto'
import rulesetJson from '../../data/breeding-automation/ruleset.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { AuthRole } from '#shared/auth'
import type { BreedingActorAuthorityV1 } from '#shared/breeding/authorization'
import {
  parseBreedingParentDiscoveryProjectionV1,
  type BreedingParentSelectionRefV1,
} from '#shared/breeding/parentDiscovery'
import {
  parseBreedingProjectWizardRequestV1,
  type BreedingProjectWizardProjectionV1,
  type BreedingProjectWizardRequestV1,
  type BreedingProjectWizardTrainerContextV1,
} from '#shared/breeding/projectWizard'
import { normalizePlayerProfile, type PlayerProfile } from '#shared/playerProfiles'
import { createBreedingActorAuthorityV1 } from '../domain/breeding/authorization'
import {
  DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT,
  parseBreedingCampaignOptionSnapshotV1,
  type BreedingCampaignOptionSnapshotV1,
} from '../domain/breeding/campaignOptions'
import { parseBreedingOperationCommandV1 } from '#shared/breeding/operations'
import {
  createBreedingProjectWizardProjectionV1,
} from '../domain/breeding/projectWizard'
import { createSqliteCampaignClockRepository } from '../storage/campaignClockRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import {
  createSqliteSheetRepository,
  type SheetRepository,
} from '../storage/sheetRepository'
import {
  BreedingParentDiscoveryAuthorityError,
  discoverBreedingParentsV1,
} from './discoverBreedingParents'
import {
  loadBreedingWorkshop,
} from './loadBreedingWorkshop'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class LoadBreedingProjectWizardError extends UseCaseHttpError<400 | 403 | 409> {}

type WizardSheetRepository = Pick<
  SheetRepository<Record<string, unknown>>,
  'get' | 'getByRef' | 'list'
> & { readonly database?: RotomDatabase }
type WizardClockRepository = Pick<
  ReturnType<typeof createSqliteCampaignClockRepository>,
  'get'
> & { readonly database?: RotomDatabase }

export interface LoadBreedingProjectWizardInput {
  readonly role: AuthRole
  readonly playerProfile: unknown | null
  readonly request: unknown
}

export interface LoadBreedingProjectWizardDependencies {
  readonly database?: RotomDatabase
  readonly sheetRepository?: WizardSheetRepository
  readonly clockRepository?: WizardClockRepository
  readonly resolveCurrentCampaignOptions?: () => unknown
}

export interface LoadedBreedingProjectWizardAuthorityV1 {
  readonly projection: BreedingProjectWizardProjectionV1
  readonly request: BreedingProjectWizardRequestV1
  readonly actorAuthority: BreedingActorAuthorityV1
  readonly campaignOptions: BreedingCampaignOptionSnapshotV1
  readonly playerProfile: PlayerProfile | null
  readonly database: RotomDatabase
  readonly sheetRepository: WizardSheetRepository
}

const AUTHENTICATION_POLICY = Object.freeze({
  schemaVersion: 1 as const,
  policyId: 'breeding-project-wizard-authentication-v1' as const,
  roleSource: 'authenticated-http-role' as const,
  playerSource: 'current-selected-Profile' as const,
  gmSource: 'current-campaign-role' as const,
})
const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')
const AUTHENTICATION_POLICY_DEFINITION_SHA256 = sha256(AUTHENTICATION_POLICY)
const fail = (status: 400 | 403 | 409, message: string): never => {
  throw new LoadBreedingProjectWizardError(status, message)
}
const assertDatabase = (
  database: RotomDatabase,
  repository: { readonly database?: RotomDatabase },
  label: string,
): void => {
  if (repository.database && repository.database !== database) {
    fail(409, `${label} must use the Project wizard database connection`)
  }
}
const invoke = <Value>(label: string, callback: () => Value): Value => {
  let value: Value
  try { value = callback() }
  catch (error) {
    if (error instanceof LoadBreedingProjectWizardError) throw error
    return fail(409, `${label} is unavailable`)
  }
  if (value && typeof value === 'object' && typeof (value as { then?: unknown }).then === 'function') {
    return fail(409, `${label} must be synchronous`)
  }
  return value
}
const operationId = (material: unknown): `breeding-operation:v1:${string}` => (
  `breeding-operation:v1:${sha256(material).slice(0, 32)}`
)
const actorParentRefs = (
  selected: readonly BreedingParentSelectionRefV1[],
): readonly [BreedingParentSelectionRefV1, BreedingParentSelectionRefV1] => {
  if (selected.length === 2) return Object.freeze([selected[0]!, selected[1]!])
  const used = new Set(selected.map(ref => ref.pokemonSheetSlug))
  const placeholders: BreedingParentSelectionRefV1[] = [...selected]
  for (const slug of ['wizard-parent-placeholder-a', 'wizard-parent-placeholder-b', 'wizard-parent-placeholder-c']) {
    if (placeholders.length === 2) break
    if (!used.has(slug)) placeholders.push(Object.freeze({ pokemonSheetSlug: slug, expectedSheetRevision: 0 }))
  }
  return Object.freeze([placeholders[0]!, placeholders[1]!])
}
const trainerContext = (
  value: NonNullable<ReturnType<typeof loadBreedingWorkshop>['selectedOwnershipContext']>,
): BreedingProjectWizardTrainerContextV1 => {
  if (value.availability !== 'available' || value.trainerRevision === null) {
    return fail(409, 'Selected Project wizard Trainer context is unavailable')
  }
  return Object.freeze({
    trainerSheetSlug: value.trainerSheetSlug,
    trainerRevision: value.trainerRevision,
    displayName: value.displayName,
  })
}

/**
 * Builds the non-mutating Project wizard from current campaign authority. It
 * accepts Trainer and parent selectors only; every mechanic and eventual
 * creation confirmation remains a later server rebuild.
 */
export const loadBreedingProjectWizardAuthority = (
  input: LoadBreedingProjectWizardInput,
  dependencies: LoadBreedingProjectWizardDependencies = {},
): LoadedBreedingProjectWizardAuthorityV1 => {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.getPrototypeOf(input) !== Object.prototype
    || Object.getOwnPropertySymbols(input).length > 0
    || Object.getOwnPropertyNames(input).length !== 3
    || !['role', 'playerProfile', 'request'].every(field => Object.hasOwn(input, field))
    || Object.getOwnPropertyNames(input).some((field) => {
      const descriptor = Object.getOwnPropertyDescriptor(input, field)
      return descriptor?.enumerable !== true || !('value' in descriptor)
    })) {
    return fail(400, 'Breeding Project wizard request is malformed')
  }
  if (input.role !== 'gm' && input.role !== 'player') {
    return fail(403, 'Breeding Project wizard requires an authenticated campaign role')
  }
  const request = (() => {
    try { return parseBreedingProjectWizardRequestV1(input.request) }
    catch { return fail(400, 'Breeding Project wizard request is malformed') }
  })()
  if (input.role === 'gm') {
    if (input.playerProfile !== null || request.profileId !== null) {
      return fail(400, 'GM Project wizard requests cannot adopt a player Profile')
    }
  }
  else if (input.playerProfile === null) {
    return fail(403, 'Breeding Project wizard requires a selected player Profile')
  }

  const database = dependencies.database ?? getRotomDatabase()
  const sheets = dependencies.sheetRepository
    ?? createSqliteSheetRepository<Record<string, unknown>>(database)
  const clock = dependencies.clockRepository ?? createSqliteCampaignClockRepository(database)
  assertDatabase(database, sheets, 'Sheet repository')
  assertDatabase(database, clock, 'Campaign clock repository')

  const workshopInput = {
    role: input.role,
    playerProfile: input.playerProfile,
  } as const
  const destinationWorkshop = loadBreedingWorkshop({
    ...workshopInput,
    query: { trainerSheetSlug: request.destinationTrainerSlug, ownershipCursor: null },
  }, { database, sheetRepository: sheets, clockRepository: clock })
  const breederWorkshop = request.breederTrainerSlug === request.destinationTrainerSlug
    ? destinationWorkshop
    : loadBreedingWorkshop({
        ...workshopInput,
        query: { trainerSheetSlug: request.breederTrainerSlug, ownershipCursor: null },
      }, { database, sheetRepository: sheets, clockRepository: clock })
  const destination = trainerContext(destinationWorkshop.selectedOwnershipContext
    ?? fail(403, 'Selected Project destination is unavailable'))
  const breeder = trainerContext(breederWorkshop.selectedOwnershipContext
    ?? fail(403, 'Selected Project Breeder is unavailable'))
  if (destinationWorkshop.generatedAtCampaignMinute !== breederWorkshop.generatedAtCampaignMinute) {
    return fail(409, 'Project wizard campaign authority changed during projection')
  }

  const playerProfile: PlayerProfile | null = input.role === 'player'
    ? normalizePlayerProfile(input.playerProfile)
    : null
  if (input.role === 'player' && request.profileId !== playerProfile?.id) {
    return fail(403, 'Breeding Project wizard Profile selection is stale')
  }
  const currentClock = invoke('Campaign clock authority', () => clock.get())
  if (!Number.isSafeInteger(currentClock.campaignMinute)
    || currentClock.campaignMinute < 0
    || currentClock.campaignMinute !== destinationWorkshop.generatedAtCampaignMinute) {
    return fail(409, 'Project wizard campaign authority changed during projection')
  }
  const campaignOptions = (() => {
    try {
      return parseBreedingCampaignOptionSnapshotV1(invoke(
        'Current Breeding campaign options',
        dependencies.resolveCurrentCampaignOptions
          ?? (() => DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT),
      ))
    }
    catch (error) {
      if (error instanceof LoadBreedingProjectWizardError) throw error
      return fail(409, 'Current Breeding campaign options are unavailable')
    }
  })()
  const parentRefs = actorParentRefs(request.parentRefs)
  const command = parseBreedingOperationCommandV1({
    schemaVersion: 1,
    operationId: operationId({
      kind: 'project-wizard-parent-preview',
      role: input.role,
      profileDefinition: playerProfile ? sha256(playerProfile) : null,
      destinationTrainerSlug: destination.trainerSheetSlug,
      breederTrainerSlug: breeder.trainerSheetSlug,
      parentRefs,
      campaignMinute: currentClock.campaignMinute,
      campaignOptionSnapshotDefinitionSha256: campaignOptions.definitionSha256,
    }),
    commandKind: 'preview-breeding',
    actor: {
      profileId: playerProfile?.id ?? 'campaign-gm',
      selectedTrainerSlug: destination.trainerSheetSlug,
    },
    ruleset: {
      rulesetId: rulesetJson.rulesetId,
      definitionSha256: rulesetJson.definitionSha256,
    },
    scopes: [],
    payload: {
      ownerTrainerSlug: destination.trainerSheetSlug,
      breederTrainerSlug: breeder.trainerSheetSlug,
      parentRefs,
      optionSnapshotDefinitionSha256: campaignOptions.definitionSha256,
    },
  })
  const actor = createBreedingActorAuthorityV1({
    role: input.role,
    command,
    authenticatedPrincipalSha256: sha256({
      role: input.role,
      profileId: playerProfile?.id ?? null,
      authenticationPolicyDefinitionSha256: AUTHENTICATION_POLICY_DEFINITION_SHA256,
    }),
    authenticationPolicyDefinitionSha256: AUTHENTICATION_POLICY_DEFINITION_SHA256,
    profile: playerProfile,
    evaluatedAtCampaignMinute: currentClock.campaignMinute,
  })
  const parentDiscovery = (() => {
    try {
      return parseBreedingParentDiscoveryProjectionV1(discoverBreedingParentsV1({
        sheets,
        actorAuthority: actor,
        profile: playerProfile,
        campaignOptions,
        atCampaignMinute: currentClock.campaignMinute,
        filter: {
          schemaVersion: 1,
          trainerSheetSlug: input.role === 'player' ? destination.trainerSheetSlug : null,
          rosterFields: ['boxed-pokemon', 'current-team'],
          availability: 'all',
          speciesIds: [],
        },
        selection: { schemaVersion: 1, parentRefs: request.parentRefs },
      }))
    }
    catch (error) {
      if (error instanceof BreedingParentDiscoveryAuthorityError) {
        if (error.code === 'breeding.parent-discovery.unauthorized') {
          return fail(403, 'Breeding parent selection is unavailable')
        }
        if (error.code === 'breeding.parent-discovery.stale-selection') {
          return fail(409, 'Breeding parent selection is stale or unavailable')
        }
      }
      return fail(409, 'Breeding parent directory is unavailable')
    }
  })()

  const selectedCandidates = new Map(parentDiscovery.trainerSheets
    .flatMap(trainer => trainer.candidates)
    .map(candidate => [candidate.parentSheetSlug, candidate] as const))
  const consentStatus = request.parentRefs.length !== 2
    ? 'selection-incomplete' as const
    : request.parentRefs.some(ref => selectedCandidates.get(ref.pokemonSheetSlug)?.ownerTrainerSlug
      !== destination.trainerSheetSlug)
      ? 'review-required' as const
      : 'not-required' as const
  const reviewStatus = request.parentRefs.length !== 2
    ? 'selection-incomplete' as const
    : parentDiscovery.compatibilityPreview?.status === 'requires-validation'
      ? 'requires-final-validation' as const
      : 'pair-unavailable' as const

  const projection = createBreedingProjectWizardProjectionV1({
    audience: input.role === 'gm' ? 'gm' : 'owner',
    generatedAtCampaignMinute: currentClock.campaignMinute,
    destination,
    breeder,
    parentDiscovery,
    timeline: {
      timeAuthority: 'campaign-clock',
      initialCampaignMinutes: 240,
      breederCheckDifficultyClass: 12,
      additionalCampaignMinutes: 240,
      minimumCampaignMinutesBeforeEgg: 480,
    },
    consentStatus,
    reviewStatus,
  })
  return Object.freeze({
    projection,
    request,
    actorAuthority: actor,
    campaignOptions,
    playerProfile,
    database,
    sheetRepository: sheets,
  })
}

export const loadBreedingProjectWizard = (
  input: LoadBreedingProjectWizardInput,
  dependencies: LoadBreedingProjectWizardDependencies = {},
): BreedingProjectWizardProjectionV1 => loadBreedingProjectWizardAuthority(input, dependencies).projection
