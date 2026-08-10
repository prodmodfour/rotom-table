import type { AuthRole } from '#shared/auth'
import {
  BREEDING_WORKSHOP_ACTIVITY_CARD_LIMIT,
  parseBreedingWorkshopActivityRequestV1,
  type BreedingWorkshopActivityProjectionV1,
  type BreedingWorkshopActivityRequestV1,
  type BreedingWorkshopConsentStatus,
  type BreedingWorkshopProjectParentV1,
} from '#shared/breeding/workshopActivity'
import { parseBreedingConsentRecordV1, type BreedingConsentRecordV1 } from '#shared/breeding/ledgers'
import { parseBreedingProjectDocumentV1, type BreedingProjectDocumentV1 } from '#shared/breeding/project'
import { parsePokemonEggDocumentV1, type PokemonEggDocumentV1 } from '#shared/breeding/egg'
import { parsePokemonEggTransferConsentV1, type PokemonEggTransferConsentV1 } from '#shared/breeding/eggTransfer'
import { parseBreedingConflictScopeV1, type BreedingConflictScopeV1 } from '#shared/breeding/operations'
import { normalizePlayerProfile, type PlayerProfile } from '#shared/playerProfiles'
import {
  breedingWorkshopEggHistory,
  breedingWorkshopEggProgress,
  breedingWorkshopEggTransfer,
  breedingWorkshopProjectHistory,
  breedingWorkshopProjectProgress,
  breedingWorkshopRecoverySummary,
  createBreedingWorkshopActivityProjectionV1,
} from '../domain/breeding/workshopActivity'
import {
  canonicalBreedingAbilityIdentity,
  canonicalBreedingSpeciesIdentity,
} from '../domain/breeding/canonicalIds'
import { breedingNature } from '../domain/breeding/natures'
import { createSqliteBreedingConsentRepository } from '../storage/breedingConsentRepository'
import { createSqliteBreedingOperationRepository, type BreedingOperationLedgerRecord } from '../storage/breedingOperationRepository'
import { createSqliteBreedingProjectRepository } from '../storage/breedingProjectRepository'
import { createSqliteCampaignClockRepository } from '../storage/campaignClockRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqlitePokemonEggRepository } from '../storage/pokemonEggRepository'
import { createSqlitePokemonEggTransferConsentRepository } from '../storage/pokemonEggTransferConsentRepository'
import { createSqliteSheetRepository, type PersistedSheet, type SheetRepository } from '../storage/sheetRepository'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class LoadBreedingWorkshopActivityError extends UseCaseHttpError<400 | 403 | 409> {}

type ActivitySheetRepository = Pick<SheetRepository<Record<string, unknown>>, 'getByRef'> & { readonly database?: RotomDatabase }
type ActivityProjectRepository = Pick<ReturnType<typeof createSqliteBreedingProjectRepository>, 'listByOwner'> & { readonly database?: RotomDatabase }
type ActivityEggRepository = Pick<ReturnType<typeof createSqlitePokemonEggRepository>, 'listByOwner'> & { readonly database?: RotomDatabase }
type ActivityConsentRepository = Pick<ReturnType<typeof createSqliteBreedingConsentRepository>, 'listByProject'> & { readonly database?: RotomDatabase }
type ActivityTransferRepository = Pick<ReturnType<typeof createSqlitePokemonEggTransferConsentRepository>, 'listByEgg'> & { readonly database?: RotomDatabase }
type ActivityOperationRepository = Pick<ReturnType<typeof createSqliteBreedingOperationRepository>, 'listPending'> & { readonly database?: RotomDatabase }
type ActivityClockRepository = Pick<ReturnType<typeof createSqliteCampaignClockRepository>, 'get'> & { readonly database?: RotomDatabase }

export interface LoadBreedingWorkshopActivityInput {
  readonly role: AuthRole
  readonly playerProfile: unknown | null
  readonly request: unknown
}
export interface LoadBreedingWorkshopActivityDependencies {
  readonly database?: RotomDatabase
  readonly sheetRepository?: ActivitySheetRepository
  readonly projectRepository?: ActivityProjectRepository
  readonly eggRepository?: ActivityEggRepository
  readonly consentRepository?: ActivityConsentRepository
  readonly transferRepository?: ActivityTransferRepository
  readonly operationRepository?: ActivityOperationRepository
  readonly clockRepository?: ActivityClockRepository
}

const FORMAT_CONTROLS = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069]/gu
const CONTROLS = /[\u0000-\u001f\u007f]/gu
const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0
const fail = (status: 400 | 403 | 409, message: string): never => {
  throw new LoadBreedingWorkshopActivityError(status, message)
}
const plainRecord = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null)
    || Object.getOwnPropertySymbols(value).length > 0) return false
  return Object.getOwnPropertyNames(value).every((field) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, field)
    return descriptor?.enumerable === true && 'value' in descriptor
  })
}
const strictDenseArray = <Value>(
  value: unknown,
  maximumLength: number,
  label: string,
): readonly Value[] => {
  if (!Array.isArray(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > maximumLength
    || Object.getOwnPropertySymbols(value).length > 0
    || Object.getOwnPropertyNames(value).length !== value.length + 1) {
    return fail(409, `${label} is malformed`)
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) return fail(409, `${label} is malformed`)
  }
  return value as readonly Value[]
}
const safeDisplayName = (value: unknown, fallback: string): string => {
  const raw = typeof value === 'string' ? value : ''
  const cleaned = raw.normalize('NFKC')
    .replace(FORMAT_CONTROLS, '')
    .replace(CONTROLS, ' ')
    .replace(/[<>]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
  return Array.from(cleaned || fallback)
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint < 0xD800 || codePoint > 0xDFFF
    })
    .slice(0, 120)
    .join('')
    .trim() || fallback
}
const strictProfile = (value: unknown): PlayerProfile => {
  if (!plainRecord(value)
    || Object.keys(value).sort(compare).join('\0')
      !== ['displayName', 'id', 'linkedCharacters', 'schemaVersion'].sort(compare).join('\0')
    || !Array.isArray(value.linkedCharacters)
    || Object.getPrototypeOf(value.linkedCharacters) !== Array.prototype
    || value.linkedCharacters.length > 128
    || Object.getOwnPropertySymbols(value.linkedCharacters).length > 0
    || Object.getOwnPropertyNames(value.linkedCharacters).length !== value.linkedCharacters.length + 1) {
    return fail(400, 'Selected player Profile authority is malformed')
  }
  for (let index = 0; index < value.linkedCharacters.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value.linkedCharacters, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)
      || !plainRecord(descriptor.value)
      || Object.keys(descriptor.value).sort(compare).join('\0')
        !== ['sheetKind', 'sheetSlug'].sort(compare).join('\0')) {
      return fail(400, 'Selected player Profile authority is malformed')
    }
  }
  try { return normalizePlayerProfile(value) }
  catch { return fail(400, 'Selected player Profile authority is malformed') }
}
const assertRepositoryDatabase = (
  database: RotomDatabase,
  repository: { readonly database?: RotomDatabase },
  label: string,
): void => {
  if (repository.database && repository.database !== database) {
    fail(409, `${label} must use the Workshop activity database connection`)
  }
}
const validateSheet = (sheet: PersistedSheet | null, kind: 'trainer' | 'pokemon', slug: string): PersistedSheet | null => {
  if (!sheet) return null
  if (!plainRecord(sheet)
    || Object.keys(sheet).sort(compare).join('\0') !== ['kind', 'revision', 'sheet', 'slug', 'updatedAt'].join('\0')
    || sheet.kind !== kind || sheet.slug !== slug || !plainRecord(sheet.sheet)
    || sheet.sheet.slug !== slug || sheet.sheet.revision !== sheet.revision
    || sheet.sheet.updatedAt !== sheet.updatedAt
    || !Number.isSafeInteger(sheet.revision) || sheet.revision < 0
    || !Number.isSafeInteger(sheet.updatedAt) || sheet.updatedAt < 0) {
    return fail(409, `${kind === 'trainer' ? 'Trainer' : 'Pokémon'} activity reference is malformed`)
  }
  return sheet
}
const parseRepositoryRows = <Value>(
  values: readonly unknown[],
  parse: (value: unknown, path: string) => Value,
  label: string,
): readonly Value[] => {
  try { return Object.freeze(values.map((value, index) => parse(value, `${label}[${index}]`))) }
  catch { return fail(409, `${label} is malformed`) }
}
const consentStatus = (
  project: BreedingProjectDocumentV1,
  parentIndex: 0 | 1,
  values: readonly BreedingConsentRecordV1[],
  campaignMinute: number,
): BreedingWorkshopConsentStatus => {
  const parent = project.parentRefs[parentIndex]
  if (parent.ownerTrainerSlug === project.ownerTrainerSlug) return 'not-required'
  const matching = values.filter(consent => consent.parentSheetSlug === parent.pokemonSheetSlug
    && consent.parentSheetRevision === parent.expectedSheetRevision)
    .sort((left, right) => right.grantedAtCampaignMinute - left.grantedAtCampaignMinute
      || compare(right.consentId, left.consentId))
  if (matching.filter(consent => consent.status === 'active').length > 1) {
    return fail(409, 'Breeding Project consent history contains contradictory active grants')
  }
  const latest = matching[0]
  if (!latest) return 'waiting'
  if (latest.status === 'active') {
    return latest.expiresAtCampaignMinute !== null && campaignMinute >= latest.expiresAtCampaignMinute
      ? 'expired'
      : 'active'
  }
  return latest.status === 'expired' ? 'expired' : 'revoked'
}
interface PendingActivityOperation {
  readonly scopes: readonly BreedingConflictScopeV1[]
  readonly createdAtCampaignMinute: number
}
const parsePendingActivityOperation = (value: unknown, path: string): PendingActivityOperation => {
  if (!plainRecord(value) || !Object.hasOwn(value, 'scopes') || !Object.hasOwn(value, 'createdAtCampaignMinute')) {
    return fail(409, 'Pending breeding operation directory is malformed')
  }
  const scopes = strictDenseArray<unknown>(value.scopes, 128, `${path}.scopes`)
  let parsedScopes: readonly BreedingConflictScopeV1[]
  try { parsedScopes = Object.freeze(scopes.map((scope, index) => parseBreedingConflictScopeV1(scope, `${path}.scopes[${index}]`))) }
  catch { return fail(409, 'Pending breeding operation directory is malformed') }
  const createdAtCampaignMinute = value.createdAtCampaignMinute
  if (typeof createdAtCampaignMinute !== 'number'
    || !Number.isSafeInteger(createdAtCampaignMinute) || createdAtCampaignMinute < 0) {
    return fail(409, 'Pending breeding operation directory is malformed')
  }
  return Object.freeze({ scopes: parsedScopes, createdAtCampaignMinute })
}
const pendingFor = (
  operations: readonly PendingActivityOperation[],
  aggregateKind: 'breeding-project' | 'pokemon-egg',
  aggregateId: string,
): readonly PendingActivityOperation[] => operations.filter(operation => operation.scopes.some((scope) => {
  if (aggregateKind === 'breeding-project') return scope.kind === aggregateKind && scope.projectId === aggregateId
  return scope.kind === aggregateKind && scope.eggId === aggregateId
}))
const currentTransfer = (
  egg: PokemonEggDocumentV1,
  values: readonly PokemonEggTransferConsentV1[],
  campaignMinute: number,
) => {
  const sources = values.filter(consent => consent.role === 'source-gift'
    && consent.status === 'active'
    && consent.eggRevision === egg.revision
    && consent.sourceTrainerSlug === egg.ownerTrainerSlug)
  if (sources.length > 1) return fail(409, 'Egg transfer authority contains contradictory active source offers')
  const source = sources[0] ?? null
  const recipients = source
    ? values.filter(consent => consent.role === 'recipient-acceptance'
      && consent.status === 'active'
      && consent.counterpartConsentId === source.consentId)
    : []
  if (recipients.length > 1) return fail(409, 'Egg transfer authority contains contradictory active recipient approvals')
  const recipient = recipients[0] ?? null
  if (source && (source.grantedAtCampaignMinute > campaignMinute
    || recipient && (recipient.eggId !== source.eggId
      || recipient.eggRevision !== source.eggRevision
      || recipient.sourceTrainerSlug !== source.sourceTrainerSlug
      || recipient.destinationTrainerSlug !== source.destinationTrainerSlug
      || recipient.expiresAtCampaignMinute !== source.expiresAtCampaignMinute
      || recipient.grantedAtCampaignMinute < source.grantedAtCampaignMinute
      || recipient.grantedAtCampaignMinute > campaignMinute))) {
    return fail(409, 'Egg transfer authority contains contradictory participant approvals')
  }
  const transferSettlementMinutes = values
    .filter(consent => consent.role === 'source-gift' && consent.status === 'consumed'
      && consent.settledAtCampaignMinute !== null)
    .map(consent => consent.settledAtCampaignMinute!)
  return Object.freeze({
    source,
    recipient,
    transferSettlementMinutes: Object.freeze(transferSettlementMinutes),
    generatedAtCampaignMinute: campaignMinute,
  })
}

/**
 * Projects current owner/GM cards only after rebuilding selected Trainer
 * authority. Aggregate identities authorize no access, and foreign parent
 * identities remain structurally absent from owner cards.
 */
export const loadBreedingWorkshopActivity = (
  input: LoadBreedingWorkshopActivityInput,
  dependencies: LoadBreedingWorkshopActivityDependencies = {},
): BreedingWorkshopActivityProjectionV1 => {
  if (!plainRecord(input)
    || Object.keys(input).sort(compare).join('\0') !== ['playerProfile', 'request', 'role'].sort(compare).join('\0')) {
    return fail(400, 'Breeding Workshop activity request is malformed')
  }
  if (input.role !== 'gm' && input.role !== 'player') {
    return fail(403, 'Breeding Workshop activity requires an authenticated campaign role')
  }
  let request: BreedingWorkshopActivityRequestV1
  try { request = parseBreedingWorkshopActivityRequestV1(input.request) }
  catch { return fail(400, 'Breeding Workshop activity request is malformed') }
  if ((input.role === 'gm') !== (request.profileId === null)
    || (input.role === 'gm') !== (input.playerProfile === null)) {
    return fail(400, 'Breeding Workshop activity Profile context is contradictory')
  }
  const profile = input.role === 'player' ? strictProfile(input.playerProfile) : null
  if (profile && (profile.id !== request.profileId
    || profile.linkedCharacters.filter(link => link.sheetKind === 'trainer'
      && link.sheetSlug === request.trainerSheetSlug).length !== 1)) {
    return fail(403, 'Requested Breeding Workshop activity ownership context is unavailable')
  }

  const database = dependencies.database ?? getRotomDatabase()
  const sheets = dependencies.sheetRepository ?? createSqliteSheetRepository<Record<string, unknown>>(database)
  const projects = dependencies.projectRepository ?? createSqliteBreedingProjectRepository(database)
  const eggs = dependencies.eggRepository ?? createSqlitePokemonEggRepository(database)
  const consents = dependencies.consentRepository ?? createSqliteBreedingConsentRepository(database)
  const transfers = dependencies.transferRepository ?? createSqlitePokemonEggTransferConsentRepository(database)
  const operations = dependencies.operationRepository ?? createSqliteBreedingOperationRepository(database)
  const clock = dependencies.clockRepository ?? createSqliteCampaignClockRepository(database)
  for (const [repository, label] of [
    [sheets, 'Sheet repository'], [projects, 'Project repository'], [eggs, 'Egg repository'],
    [consents, 'Consent repository'], [transfers, 'Transfer repository'],
    [operations, 'Operation repository'], [clock, 'Campaign clock repository'],
  ] as const) assertRepositoryDatabase(database, repository, label)

  const campaignMinute = clock.get().campaignMinute
  if (!Number.isSafeInteger(campaignMinute) || campaignMinute < 0) {
    return fail(409, 'Campaign clock authority is malformed')
  }
  const trainer = validateSheet(sheets.getByRef('trainer', request.trainerSheetSlug), 'trainer', request.trainerSheetSlug)
    ?? fail(409, 'Selected Trainer activity context is unavailable')
  const projectRows = parseRepositoryRows(
    strictDenseArray<unknown>(
      projects.listByOwner(request.trainerSheetSlug, BREEDING_WORKSHOP_ACTIVITY_CARD_LIMIT + 1),
      BREEDING_WORKSHOP_ACTIVITY_CARD_LIMIT + 1,
      'Breeding Project activity directory',
    ),
    parseBreedingProjectDocumentV1,
    'Breeding Project activity directory',
  )
  const eggRows = parseRepositoryRows(
    strictDenseArray<unknown>(
      eggs.listByOwner(request.trainerSheetSlug, BREEDING_WORKSHOP_ACTIVITY_CARD_LIMIT + 1),
      BREEDING_WORKSHOP_ACTIVITY_CARD_LIMIT + 1,
      'Pokémon Egg activity directory',
    ),
    parsePokemonEggDocumentV1,
    'Pokémon Egg activity directory',
  )
  if (projectRows.some(project => project.ownerTrainerSlug !== request.trainerSheetSlug)
    || eggRows.some(egg => egg.ownerTrainerSlug !== request.trainerSheetSlug)) {
    return fail(409, 'Workshop activity directory returned foreign aggregate authority')
  }
  const pendingRows = strictDenseArray<BreedingOperationLedgerRecord>(
    operations.listPending(100),
    100,
    'Pending breeding operation directory',
  )
  if (pendingRows.length === 100) return fail(409, 'Pending breeding operation directory exceeds the bounded Workshop view')
  const pending = Object.freeze(pendingRows.map((operation, index) => (
    parsePendingActivityOperation(operation, `pendingOperations[${index}]`)
  )))

  const nameFor = (kind: 'trainer' | 'pokemon', slug: string, fallback: string): string => {
    const sheet = validateSheet(sheets.getByRef(kind, slug), kind, slug)
    return safeDisplayName(sheet?.sheet.name, fallback)
  }
  const projectCards = projectRows.slice(0, BREEDING_WORKSHOP_ACTIVITY_CARD_LIMIT).map((project) => {
    const projectConsents = parseRepositoryRows(
      strictDenseArray<unknown>(
        consents.listByProject(project.projectId, 100),
        100,
        'Breeding Project consent history',
      ),
      parseBreedingConsentRecordV1,
      'Breeding Project consent history',
    )
    if (projectConsents.length === 100 || projectConsents.some(consent => consent.projectId !== project.projectId
      || !project.parentRefs.some(parent => parent.pokemonSheetSlug === consent.parentSheetSlug))) {
      return fail(409, 'Breeding Project consent history exceeds or contradicts the bounded card view')
    }
    const cardParents = project.parentRefs.map((parent, index) => {
      const parentIndex = index as 0 | 1
      const owned = parent.ownerTrainerSlug === project.ownerTrainerSlug
      const canIdentify = input.role === 'gm' || owned
      return Object.freeze({
        parentIndex,
        relationship: owned ? 'owned' as const : 'participating' as const,
        displayName: canIdentify
          ? nameFor('pokemon', parent.pokemonSheetSlug, `Parent ${index + 1}`)
          : 'Participating parent',
        pokemonSheetSlug: canIdentify ? parent.pokemonSheetSlug : null,
        consentStatus: consentStatus(project, parentIndex, projectConsents, campaignMinute),
      })
    }) as unknown as readonly [BreedingWorkshopProjectParentV1, BreedingWorkshopProjectParentV1]
    const recovery = breedingWorkshopRecoverySummary(
      pendingFor(pending, 'breeding-project', project.projectId).map(operation => operation.createdAtCampaignMinute),
    )
    return Object.freeze({
      aggregateKind: 'breeding-project' as const,
      projectId: project.projectId,
      revision: project.revision,
      status: project.status,
      breederDisplayName: nameFor('trainer', project.breederTrainerSlug, 'Breeder'),
      parents: cardParents,
      progress: breedingWorkshopProjectProgress(project),
      history: breedingWorkshopProjectHistory(project),
      recovery,
      createdAtCampaignMinute: project.createdAtCampaignMinute,
      updatedAtCampaignMinute: project.updatedAtCampaignMinute,
      statusChangedAtCampaignMinute: project.statusChangedAtCampaignMinute,
    })
  })
  const eggCards = eggRows.slice(0, BREEDING_WORKSHOP_ACTIVITY_CARD_LIMIT).map((egg) => {
    const transferRows = parseRepositoryRows(
      strictDenseArray<unknown>(
        transfers.listByEgg(egg.eggId, 32),
        32,
        'Pokémon Egg transfer history',
      ),
      parsePokemonEggTransferConsentV1,
      'Pokémon Egg transfer history',
    )
    if (transferRows.length === 32 || transferRows.some(consent => consent.eggId !== egg.eggId)) {
      return fail(409, 'Pokémon Egg transfer history exceeds or contradicts the bounded card view')
    }
    const transferAuthority = currentTransfer(egg, transferRows, campaignMinute)
    const recovery = breedingWorkshopRecoverySummary(
      pendingFor(pending, 'pokemon-egg', egg.eggId).map(operation => operation.createdAtCampaignMinute),
    )
    const species = canonicalBreedingSpeciesIdentity(egg.offspring.speciesId)
      ?? fail(409, 'Pokémon Egg Species presentation authority is unavailable')
    const nature = breedingNature(egg.offspring.nature.valueId)
      ?? fail(409, 'Pokémon Egg Nature presentation authority is unavailable')
    const ability = canonicalBreedingAbilityIdentity(egg.offspring.ability.valueId)
      ?? fail(409, 'Pokémon Egg Ability presentation authority is unavailable')
    return Object.freeze({
      aggregateKind: 'pokemon-egg' as const,
      eggId: egg.eggId,
      revision: egg.revision,
      status: egg.status,
      sourceKind: egg.source.kind,
      speciesName: safeDisplayName(species.sourceName, 'Pokémon'),
      natureName: safeDisplayName(nature.label, 'Unknown Nature'),
      abilityName: safeDisplayName(ability.sourceName, 'Unknown Ability'),
      genderId: egg.offspring.gender.valueId,
      startingLevel: egg.offspring.startingLevel,
      progress: breedingWorkshopEggProgress(egg),
      history: breedingWorkshopEggHistory(egg, transferAuthority.transferSettlementMinutes),
      recovery,
      transfer: breedingWorkshopEggTransfer({
        egg,
        sourceConsent: transferAuthority.source,
        recipientConsent: transferAuthority.recipient,
        generatedAtCampaignMinute: campaignMinute,
        recovery,
      }),
      childSheetSlug: egg.childSheetSlug,
      createdAtCampaignMinute: egg.createdAtCampaignMinute,
      updatedAtCampaignMinute: egg.updatedAtCampaignMinute,
      statusChangedAtCampaignMinute: egg.statusChangedAtCampaignMinute,
    })
  })

  return createBreedingWorkshopActivityProjectionV1({
    audience: input.role === 'gm' ? 'gm' : 'owner',
    trainer: {
      trainerSheetSlug: trainer.slug,
      trainerRevision: trainer.revision,
      displayName: safeDisplayName(trainer.sheet.name, trainer.slug),
    },
    generatedAtCampaignMinute: campaignMinute,
    projectsTruncated: projectRows.length > BREEDING_WORKSHOP_ACTIVITY_CARD_LIMIT,
    eggsTruncated: eggRows.length > BREEDING_WORKSHOP_ACTIVITY_CARD_LIMIT,
    projects: Object.freeze(projectCards),
    eggs: Object.freeze(eggCards),
  })
}
