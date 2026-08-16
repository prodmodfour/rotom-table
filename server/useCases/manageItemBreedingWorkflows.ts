import { createHash } from 'node:crypto'
import { createError } from 'h3'
import rulesetJson from '../../data/breeding-automation/ruleset.json'
import securityPolicyJson from '../../data/breeding-automation/security-policy.json'
import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { StrictJsonObject } from '#shared/automation/strictJson'
import {
  parseBreedingOperationIdSyntax,
  parseBreedingReadSetIdSyntax,
  parsePokemonEggIdSyntax,
  type BreedingOperationId,
  type BreedingReadSetId,
  type PokemonEggId,
} from '#shared/breeding/ids'
import {
  ItemBreedingWorkflowValidationError,
  parseItemBreedingOperationCommand,
  parseItemBreedingOperationResult,
  parseItemBreedingState,
  parseItemBreedingWorkflowPostRequest,
  type CreateArtificialEggCommandV1,
  type ItemBreedingOperationCommandV1,
  type ItemBreedingOperationResultV1,
  type ItemBreedingSourcePreviewV1,
  type ItemBreedingWorkflowPostRequestV1,
  type ItemBreedingWorkflowProjectionV1,
  type PreviewArtificialRequestV1,
  type PreviewFossilRequestV1,
  type RestoreFossilCommandV1,
} from '#shared/breeding/itemWorkflows'
import { parseBreedingOperationCommandV1, type BreedingOperationCommandV1 } from '#shared/breeding/operations'
import type { BreedingDependencyEvidenceV1, BreedingReadResourceV1 } from '#shared/breeding/readSets'
import { playerProfileCanControlTokenSheet } from '#shared/playerProfileTokenControl'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  BREEDING_ARTIFICIAL_EGG_POLICY_DEFINITION_SHA256,
  breedingArtificialEggDependencyEvidenceV1,
  breedingArtificialEggOfferId,
  breedingArtificialEggOfferOptionId,
  breedingArtificialEggSpeciesIdV1,
  createBreedingArtificialEggOptionOffersV1,
  createBreedingArtificialEggSourceAuthorityV1,
  playingGodContributionV1,
  type BreedingArtificialEggOfferSlot,
} from '../domain/breeding/artificialEgg'
import { createBreedingActorAuthorityV1, createBreedingAuthorizationReceiptV1 } from '../domain/breeding/authorization'
import { DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT } from '../domain/breeding/campaignOptions'
import { createCurrentBreedingReferenceVersionSnapshotV1 } from '../domain/breeding/currentReferences'
import { createBreedingFeatureProviderHandoffV1 } from '../domain/breeding/featureProviderHandoff'
import {
  BREEDING_FOSSIL_EGG_POLICY_DEFINITION_SHA256,
  breedingFossilEggDependencyEvidenceV1,
  breedingFossilOfferId,
  breedingFossilOfferOptionId,
  createBreedingFossilEggOptionOffersV1,
  createBreedingFossilReanimationAuthorityV1,
  createBreedingFossilSourceAuthorityV1,
} from '../domain/breeding/fossilEgg'
import {
  BREEDING_ITEM_WORKFLOW_CAPACITY,
  BREEDING_ITEM_WORKFLOW_DEFINITION_SHA256,
  buildItemBreedingProjectionAuthority,
  choicesFromOffers,
  fossilOfferChoiceValues,
  resolveProjectedSourceChoices,
  type ItemBreedingProjectionAuthority,
} from '../domain/breeding/itemWorkflows'
import { createBreedingEggWarmerItemHandoffV1 } from '../domain/breeding/modifierProviderHandoff'
import { createBreedingOperationCommandHash } from '../domain/breeding/operations'
import { createBreedingOperationReadSetV1 } from '../domain/breeding/readSets'
import { compiledBreedingSpeciesSpec } from '../domain/breeding/registry'
import { canonicalBreedingSpeciesIdentity } from '../domain/breeding/canonicalIds'
import { setupSheetSaveRealtimeAppendInputs } from '../realtime/setupDocumentRealtime'
import {
  defaultPersistedRealtimeEventPublisher,
  defaultPersistedRealtimePublicationFailureReporter,
  publishPersistedRealtimeEventsAfterCommit,
  type PersistedRealtimeEventPublisher,
  type PersistedRealtimePublicationFailureReporter,
} from '../realtime/persistedBatchPublication'
import { createSqliteCampaignClockRepository, type CampaignClockRepository } from '../storage/campaignClockRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import {
  createSqliteItemBreedingOperationRepository,
  type ItemBreedingOperationRepository,
} from '../storage/itemBreedingOperationRepository'
import { createSqlitePokemonEggRepository } from '../storage/pokemonEggRepository'
import { createSqliteRealtimeEventRepository, type RealtimeEventRepository } from '../storage/realtimeEventRepository'
import { createSqliteSheetRepository, type SheetRepository } from '../storage/sheetRepository'
import { createBreedingArtificialEgg } from './createBreedingArtificialEgg'
import { createBreedingFossilEgg } from './createBreedingFossilEgg'

const SECURITY = securityPolicyJson as { readonly definitionSha256: string }
const RULESET = Object.freeze({
  rulesetId: rulesetJson.rulesetId,
  definitionSha256: rulesetJson.definitionSha256,
})
const OFFER_LIFETIME = 500
const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0
const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const strictEvidence = (value: Record<string, unknown>): StrictJsonObject => value as unknown as StrictJsonObject
const fail = (statusCode: number, statusMessage: string): never => { throw createError({ statusCode, statusMessage }) }
const derivedHex = (namespace: string, operationId: string): string => createHash('sha256')
  .update(`${namespace}\0${operationId}`).digest('hex').slice(0, 32)
const innerOperationId = (operationId: string): BreedingOperationId => parseBreedingOperationIdSyntax(
  `breeding-operation:v1:${derivedHex('item-breeding-operation', operationId)}`,
)!
const eggId = (operationId: string): PokemonEggId => parsePokemonEggIdSyntax(
  `pokemon-egg:v1:${derivedHex('item-breeding-egg', operationId)}`,
)!
const readSetId = (operationId: string): BreedingReadSetId => parseBreedingReadSetIdSyntax(
  `breeding-read-set:v1:${derivedHex('item-breeding-read-set', operationId)}`,
)!
const fossilSourceId = (operationId: string): string => `fossil:item-restoration:${derivedHex('item-breeding-fossil-source', operationId)}`

interface Dependencies {
  readonly database?: RotomDatabase
  readonly sheetRepository?: Pick<SheetRepository<Record<string, unknown>>, 'get' | 'applyLivePlayUpdate'> & { readonly database?: RotomDatabase }
  readonly operationRepository?: ItemBreedingOperationRepository
  readonly campaignClockRepository?: CampaignClockRepository
  readonly realtimeEventRepository?: Pick<RealtimeEventRepository, 'appendMany'> & { readonly database?: RotomDatabase }
  readonly now?: () => number
  readonly publishPersistedRealtimeEvent?: PersistedRealtimeEventPublisher
  readonly reportAfterCommitPublicationFailure?: PersistedRealtimePublicationFailureReporter
}
export interface ItemBreedingRequestAuthority {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly clientId?: string
}

const databaseFrom = (dependencies: Dependencies): RotomDatabase => {
  const candidates = [dependencies.sheetRepository?.database, dependencies.operationRepository?.database,
    dependencies.campaignClockRepository?.database, dependencies.realtimeEventRepository?.database]
    .filter((value): value is RotomDatabase => Boolean(value))
  const database = dependencies.database ?? candidates[0] ?? getRotomDatabase()
  if (candidates.some(value => value !== database)) throw new Error('Breeding-item repositories must share one RotomDatabase.')
  return database
}
const storedTrainer = (repository: NonNullable<Dependencies['sheetRepository']>, slug: string) => {
  const stored = repository.get('trainer', slug) ?? fail(404, 'The selected Trainer sheet is missing.')
  const document = structuredClone(stored.document) as unknown as TrainerSheet
  if (stored.slug !== slug || document.slug !== slug || document.revision !== stored.revision) {
    fail(409, 'The selected Trainer sheet authority is malformed.')
  }
  return Object.freeze({ slug, revision: stored.revision, document })
}
const authorizeTrainer = (authority: ItemBreedingRequestAuthority, trainer: { readonly document: TrainerSheet }): void => {
  if (authority.role === 'gm') return
  if (authority.role !== 'player' || !playerProfileCanControlTokenSheet(
    authority.playerProfile, 'trainer', trainer.document.slug, { linkedTrainerSheets: [trainer.document] },
  )) fail(403, 'This principal does not control the selected breeding Trainer.')
}
const principalKey = (authority: ItemBreedingRequestAuthority): string => authority.role === 'player'
  ? `player:${authority.playerProfile?.id ?? 'missing-profile'}` : authority.role
const principalSha256 = (authority: ItemBreedingRequestAuthority): string => sha256({
  principalKey: principalKey(authority), securityPolicyDefinitionSha256: SECURITY.definitionSha256,
})
const audience = (authority: ItemBreedingRequestAuthority): 'gm' | 'owner' => authority.role === 'gm' ? 'gm' : 'owner'

const provisionalProjection = (input: {
  readonly authority: ItemBreedingRequestAuthority
  readonly trainer: ReturnType<typeof storedTrainer>
  readonly database: RotomDatabase
  readonly campaignMinute: number
  readonly commandsBlocked?: boolean
  readonly fossilPrerequisiteReason?: string | null
  readonly artificialPrerequisiteReason?: string | null
}): ItemBreedingProjectionAuthority => buildItemBreedingProjectionAuthority({
  audience: audience(input.authority),
  trainer: input.trainer,
  eggs: createSqlitePokemonEggRepository(input.database).listByOwner(input.trainer.slug),
  campaignMinute: input.campaignMinute,
  commandsBlocked: input.commandsBlocked,
  fossilPrerequisiteReason: input.fossilPrerequisiteReason,
  artificialPrerequisiteReason: input.artificialPrerequisiteReason,
})

const probeReasons = (input: {
  readonly authority: ItemBreedingRequestAuthority
  readonly projection: ItemBreedingProjectionAuthority
  readonly trainer: ReturnType<typeof storedTrainer>
  readonly campaignMinute: number
}): { readonly fossil: string | null, readonly artificial: string | null } => {
  if (input.authority.role !== 'gm') return { fossil: null, artificial: null }
  let fossil: string | null = null
  const source = input.projection.fossilSources.values().next().value
  const machine = input.projection.machines.values().next().value
  if (source && machine) {
    try {
      const sourceAuthority = createBreedingFossilSourceAuthorityV1({
        eggId: `pokemon-egg:v1:${'0'.repeat(32)}`, sourceId: 'fossil:item-restoration:probe',
        ownerTrainerSheet: input.trainer,
        custody: { inventoryEntryId: source.inventoryEntryId, unitOrdinal: source.unitOrdinal },
        capturedAtCampaignMinute: input.campaignMinute,
      })
      createBreedingFossilReanimationAuthorityV1({
        ownerTrainerSheet: input.trainer, sourceAuthority,
        reanimationMachineCustody: { inventoryEntryId: machine.inventoryEntryId, unitOrdinal: machine.unitOrdinal },
        capturedAtCampaignMinute: input.campaignMinute,
      })
    }
    catch { fossil = 'Paleontologist and its current Skill prerequisite are required.' }
  }
  let artificial: string | null = null
  const chemistry = input.projection.chemistrySets.values().next().value
  if (chemistry) {
    try {
      const feature = createBreedingFeatureProviderHandoffV1({
        trainerSheet: input.trainer, accessMode: 'gm-authority',
        accessEvidenceDefinitionSha256: principalSha256(input.authority),
        checkpoint: 'egg-acceptance', capturedAtCampaignMinute: input.campaignMinute, facilityClaims: [],
      })
      createBreedingArtificialEggSourceAuthorityV1({
        eggId: `pokemon-egg:v1:${'1'.repeat(32)}`, ownerTrainerSheet: input.trainer,
        createdByGmProfileId: 'campaign-gm', featureProviderHandoff: feature,
        chemistryCustody: { inventoryEntryId: chemistry.inventoryEntryId, unitOrdinal: chemistry.unitOrdinal },
        capturedAtCampaignMinute: input.campaignMinute,
      })
    }
    catch { artificial = 'Playing God with one reviewed Species choice is required.' }
  }
  return Object.freeze({ fossil, artificial })
}

const currentProjection = (input: {
  readonly authority: ItemBreedingRequestAuthority
  readonly trainerSlug: string
  readonly expectedRevision?: number
  readonly dependencies?: Dependencies
}): { readonly database: RotomDatabase, readonly trainer: ReturnType<typeof storedTrainer>, readonly clock: ReturnType<CampaignClockRepository['get']>, readonly authority: ItemBreedingProjectionAuthority } => {
  const dependencies = input.dependencies ?? {}
  const database = databaseFrom(dependencies)
  const sheets = dependencies.sheetRepository ?? createSqliteSheetRepository<Record<string, unknown>>(database)
  const clock = (dependencies.campaignClockRepository ?? createSqliteCampaignClockRepository(database)).get()
  const trainer = storedTrainer(sheets, input.trainerSlug)
  authorizeTrainer(input.authority, trainer)
  if (input.expectedRevision !== undefined && trainer.revision !== input.expectedRevision) {
    fail(409, 'The breeding Trainer sheet changed. Refresh before retrying.')
  }
  const first = provisionalProjection({ authority: input.authority, trainer, database, campaignMinute: clock.campaignMinute })
  const reasons = probeReasons({ authority: input.authority, projection: first, trainer, campaignMinute: clock.campaignMinute })
  return Object.freeze({
    database, trainer, clock,
    authority: provisionalProjection({ authority: input.authority, trainer, database, campaignMinute: clock.campaignMinute,
      fossilPrerequisiteReason: reasons.fossil, artificialPrerequisiteReason: reasons.artificial }),
  })
}

export const loadItemBreedingWorkflows = (input: {
  readonly authority: ItemBreedingRequestAuthority
  readonly trainerSheetSlug: string
}, dependencies: Dependencies = {}): ItemBreedingWorkflowProjectionV1 => currentProjection({
  authority: input.authority, trainerSlug: input.trainerSheetSlug, dependencies,
}).authority.projection

const clockHash = (clock: { readonly revision: number, readonly campaignMinute: number, readonly lastOperationId: string | null }): string => sha256({
  schemaVersion: 1, revision: clock.revision, campaignMinute: clock.campaignMinute, lastOperationId: clock.lastOperationId,
})
const presentResource = (input: {
  readonly resourceKind: BreedingReadResourceV1['resourceKind']
  readonly resourceId: string
  readonly revision: number
  readonly definitionSha256: string
  readonly purposes: readonly BreedingReadResourceV1['purposes'][number][]
  readonly observedCampaignMinute?: number | null
}): BreedingReadResourceV1 => Object.freeze({
  resourceKind: input.resourceKind, resourceId: input.resourceId, existence: 'present',
  revision: input.revision, definitionSha256: input.definitionSha256,
  observedCampaignMinute: input.observedCampaignMinute ?? null,
  purposes: Object.freeze([...input.purposes].sort(compare)),
})
const absentEggResource = (id: string): BreedingReadResourceV1 => Object.freeze({
  resourceKind: 'pokemon-egg', resourceId: id, existence: 'absent', revision: null,
  definitionSha256: null, observedCampaignMinute: null,
  purposes: Object.freeze(['conflict']) as BreedingReadResourceV1['purposes'],
})
const dependencyAttestation = (dependencies: readonly BreedingDependencyEvidenceV1[]): BreedingDependencyEvidenceV1 => Object.freeze({
  providerKind: 'system', providerId: 'breeding-effective-dependency-set-v1', subjectKind: 'campaign',
  subjectId: 'campaign', subjectRevision: null, checkpoint: 'authorization',
  providerDefinitionSha256: SECURITY.definitionSha256, effectiveEvidenceSha256: sha256(dependencies),
})
const buildReadSet = (input: {
  readonly outerOperationId: string
  readonly command: Extract<BreedingOperationCommandV1, { readonly commandKind: 'create-source-egg' }>
  readonly trainer: ReturnType<typeof storedTrainer>
  readonly clock: ReturnType<CampaignClockRepository['get']>
  readonly offers: readonly { readonly offerId: string, readonly definitionSha256: string }[]
  readonly dependencies: readonly BreedingDependencyEvidenceV1[]
}) => {
  const references = createCurrentBreedingReferenceVersionSnapshotV1(DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT)
  return createBreedingOperationReadSetV1({
    readSetId: readSetId(input.outerOperationId), operationId: input.command.operationId,
    commandSha256: createBreedingOperationCommandHash(input.command), commandKind: 'create-source-egg',
    capturedAtCampaignMinute: input.clock.campaignMinute,
    resources: [
      presentResource({ resourceKind: 'campaign-clock', resourceId: 'campaign-clock', revision: input.clock.revision,
        definitionSha256: clockHash(input.clock), observedCampaignMinute: input.clock.campaignMinute, purposes: ['campaign-time'] }),
      absentEggResource(input.command.payload.eggId),
      presentResource({ resourceKind: 'trainer-sheet', resourceId: input.trainer.slug, revision: input.trainer.revision,
        definitionSha256: sha256(input.trainer.document), purposes: ['authorization','conflict','mechanics'] }),
      ...input.offers.map(offer => presentResource({ resourceKind: 'breeding-offer', resourceId: offer.offerId,
        revision: 0, definitionSha256: offer.definitionSha256, purposes: ['mechanics'] })),
    ],
    referenceVersions: references,
    dependencyEvidence: [dependencyAttestation(input.dependencies), ...input.dependencies],
    writeExpectations: input.command.scopes,
  })
}
type SourceEggCommand = Extract<BreedingOperationCommandV1, { readonly commandKind: 'create-source-egg' }>
const parseSourceEggCommand = (value: unknown): SourceEggCommand => {
  const command = parseBreedingOperationCommandV1(value)
  return command.commandKind === 'create-source-egg'
    ? command
    : fail(409, 'The breeding-item workflow constructed an invalid source-Egg command.')
}
const actorFor = (authority: ItemBreedingRequestAuthority, command: BreedingOperationCommandV1, minute: number) => createBreedingActorAuthorityV1({
  role: 'gm', command, authenticatedPrincipalSha256: principalSha256(authority),
  authenticationPolicyDefinitionSha256: SECURITY.definitionSha256, profile: null,
  evaluatedAtCampaignMinute: minute,
})

interface FossilContext {
  readonly command: Extract<BreedingOperationCommandV1, { readonly commandKind: 'create-source-egg' }>
  readonly source: ReturnType<typeof createBreedingFossilSourceAuthorityV1>
  readonly reanimation: ReturnType<typeof createBreedingFossilReanimationAuthorityV1>
  readonly feature: ReturnType<typeof createBreedingFeatureProviderHandoffV1>
  readonly actor: ReturnType<typeof createBreedingActorAuthorityV1>
  readonly choices: ReturnType<typeof fossilOfferChoiceValues>
  readonly offers: ReturnType<typeof createBreedingFossilEggOptionOffersV1>
  readonly selectedInnerOptionIds: readonly string[]
}
const fossilSlots = (operationId: string) => ([
  { slot:'nature', offerId:breedingFossilOfferId(operationId,'nature'), label:'Nature', minimum:1, maximum:1 },
  { slot:'primary-ability', offerId:breedingFossilOfferId(operationId,'primary-ability'), label:'Basic Ability', minimum:1, maximum:1 },
  { slot:'gender', offerId:breedingFossilOfferId(operationId,'gender'), label:'Gender', minimum:1, maximum:1 },
  { slot:'restoration-extra-ability', offerId:breedingFossilOfferId(operationId,'restoration-extra-ability'), label:'Fossil Restoration Ability', minimum:1, maximum:1 },
  { slot:'prehistoric-bond-stat', offerId:breedingFossilOfferId(operationId,'prehistoric-bond-stat'), label:'Prehistoric Bond tied stat', minimum:0, maximum:1, description:'Select only when the Nature-adjusted highest Base Stat is tied.' },
  { slot:'hatch-duration', offerId:breedingFossilOfferId(operationId,'hatch-duration'), label:'Hatch duration', minimum:1, maximum:1 },
  { slot:'baby-template', offerId:breedingFossilOfferId(operationId,'baby-template'), label:'Baby Template', minimum:1, maximum:1 },
] as const)
const buildFossilContext = (input: {
  readonly request: PreviewFossilRequestV1 | RestoreFossilCommandV1
  readonly authority: ItemBreedingRequestAuthority
  readonly current: ReturnType<typeof currentProjection>
}): FossilContext => {
  if (input.authority.role !== 'gm') fail(403, 'Only a GM may designate and restore a Fossil.')
  if (!input.current.authority.projection.fossil.availability.enabled) fail(409, input.current.authority.projection.fossil.availability.unavailableReason ?? 'Fossil restoration is unavailable.')
  const sourceUnit = input.current.authority.fossilSources.get(input.request.fossilSourceOptionId)
    ?? fail(409, 'A Fossil source, Reanimation Machine, or Species option changed. Refresh before retrying.')
  const machine = input.current.authority.machines.get(input.request.machineOptionId)
    ?? fail(409, 'A Fossil source, Reanimation Machine, or Species option changed. Refresh before retrying.')
  const species = input.current.authority.species.get(input.request.speciesOptionId)
    ?? fail(409, 'A Fossil source, Reanimation Machine, or Species option changed. Refresh before retrying.')
  const innerId = innerOperationId(input.request.operationId)
  const futureEggId = eggId(input.request.operationId)
  const source = createBreedingFossilSourceAuthorityV1({
    eggId: futureEggId, sourceId: fossilSourceId(input.request.operationId), ownerTrainerSheet: input.current.trainer,
    custody: { inventoryEntryId: sourceUnit.inventoryEntryId, unitOrdinal: sourceUnit.unitOrdinal },
    capturedAtCampaignMinute: input.current.clock.campaignMinute,
  })
  const reanimation = createBreedingFossilReanimationAuthorityV1({
    ownerTrainerSheet: input.current.trainer, sourceAuthority: source,
    reanimationMachineCustody: { inventoryEntryId: machine.inventoryEntryId, unitOrdinal: machine.unitOrdinal },
    capturedAtCampaignMinute: input.current.clock.campaignMinute,
  })
  const provisional = parseSourceEggCommand({
    schemaVersion:1, operationId:innerId, commandKind:'create-source-egg',
    actor:{profileId:'campaign-gm',selectedTrainerSlug:null}, ruleset:RULESET,
    scopes:[{kind:'pokemon-egg',eggId:futureEggId,expectedRevision:null},
      {kind:'trainer-sheet',sheetSlug:input.current.trainer.slug,expectedRevision:input.current.trainer.revision,fields:['inventory']}],
    payload:{eggId:futureEggId,ownerTrainerSlug:input.current.trainer.slug,
      source:{kind:'fossil',sourceId:source.sourceId,evidenceDefinitionSha256:source.definitionSha256},
      speciesOptionId: breedingFossilOfferOptionId(innerId, 'species', species.speciesId),
      resolutions:{selectedOptionIds:[],requestedRollKinds:[]}},
  })
  const baseCommand = provisional
  const actor = actorFor(input.authority, baseCommand, input.current.clock.campaignMinute)
  const feature = createBreedingFeatureProviderHandoffV1({
    trainerSheet: input.current.trainer, accessMode:'gm-authority',
    accessEvidenceDefinitionSha256:actor.definitionSha256, checkpoint:'hatch-transaction',
    capturedAtCampaignMinute:input.current.clock.campaignMinute,facilityClaims:[],
  })
  const choices = fossilOfferChoiceValues({ speciesId: species.speciesId, featureProviderHandoff: feature })
  const tentativeOffers = createBreedingFossilEggOptionOffersV1({ command:baseCommand,sourceAuthority:source,
    trainerSheetRevision:input.current.trainer.revision,campaignOptionSnapshot:DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT,
    choices,issuedAtCampaignMinute:input.current.clock.campaignMinute,
    expiresAtCampaignMinute:input.current.clock.campaignMinute+OFFER_LIFETIME })
  const selectedInnerOptionIds = 'selectedOptionIds' in input.request
    ? resolveProjectedSourceChoices({ operationId:input.request.operationId,offers:tentativeOffers,
      slots:fossilSlots(innerId),selectedOptionIds:input.request.selectedOptionIds }) : []
  const command = parseSourceEggCommand({ ...baseCommand, payload:{...baseCommand.payload,
    resolutions:{selectedOptionIds:[...selectedInnerOptionIds].sort(compare),requestedRollKinds:[]}} })
  const finalActor = actorFor(input.authority, command, input.current.clock.campaignMinute)
  const finalFeature = createBreedingFeatureProviderHandoffV1({
    trainerSheet:input.current.trainer,accessMode:'gm-authority',accessEvidenceDefinitionSha256:finalActor.definitionSha256,
    checkpoint:'hatch-transaction',capturedAtCampaignMinute:input.current.clock.campaignMinute,facilityClaims:[],
  })
  const finalChoices = fossilOfferChoiceValues({ speciesId:species.speciesId,featureProviderHandoff:finalFeature })
  const offers = createBreedingFossilEggOptionOffersV1({command,sourceAuthority:source,
    trainerSheetRevision:input.current.trainer.revision,campaignOptionSnapshot:DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT,
    choices:finalChoices,issuedAtCampaignMinute:input.current.clock.campaignMinute,
    expiresAtCampaignMinute:input.current.clock.campaignMinute+OFFER_LIFETIME})
  return Object.freeze({command,source,reanimation,feature:finalFeature,actor:finalActor,choices:finalChoices,offers,selectedInnerOptionIds})
}

interface ArtificialContext {
  readonly command: Extract<BreedingOperationCommandV1, { readonly commandKind: 'create-source-egg' }>
  readonly source: ReturnType<typeof createBreedingArtificialEggSourceAuthorityV1>
  readonly feature: ReturnType<typeof createBreedingFeatureProviderHandoffV1>
  readonly actor: ReturnType<typeof createBreedingActorAuthorityV1>
  readonly offers: ReturnType<typeof createBreedingArtificialEggOptionOffersV1>
  readonly selectedInnerOptionIds: readonly string[]
  readonly speciesId: string
}
const artificialSlots = (operationId: string): readonly { readonly slot: BreedingArtificialEggOfferSlot, readonly offerId: string, readonly label: string, readonly minimum: number, readonly maximum: number }[] => [
  {slot:'nature',offerId:breedingArtificialEggOfferId(operationId,'nature'),label:'Nature',minimum:1,maximum:1},
  {slot:'primary-ability',offerId:breedingArtificialEggOfferId(operationId,'primary-ability'),label:'Basic Ability',minimum:1,maximum:1},
  ...([1,2,3,4,5,6] as const).map(value=>({slot:`upgrade-${value}` as BreedingArtificialEggOfferSlot,
    offerId:breedingArtificialEggOfferId(operationId,`upgrade-${value}`),label:`Playing God upgrade ${value}`,minimum:1,maximum:1})),
  {slot:'hatch-duration',offerId:breedingArtificialEggOfferId(operationId,'hatch-duration'),label:'Hatch duration',minimum:1,maximum:1},
  {slot:'baby-template',offerId:breedingArtificialEggOfferId(operationId,'baby-template'),label:'Baby Template',minimum:1,maximum:1},
]
const buildArtificialContext = (input: {
  readonly request: PreviewArtificialRequestV1 | CreateArtificialEggCommandV1
  readonly authority: ItemBreedingRequestAuthority
  readonly current: ReturnType<typeof currentProjection>
}): ArtificialContext => {
  if (input.authority.role !== 'gm') fail(403, 'Only a GM may authorize Playing God creation.')
  if (!input.current.authority.projection.artificial.availability.enabled) fail(409, input.current.authority.projection.artificial.availability.unavailableReason ?? 'Artificial Egg creation is unavailable.')
  const chemistry = input.current.authority.chemistrySets.get(input.request.chemistryOptionId)
    ?? fail(409, 'The selected Chemistry Set changed. Refresh before retrying.')
  const innerId = innerOperationId(input.request.operationId)
  const futureEggId = eggId(input.request.operationId)
  const feature = createBreedingFeatureProviderHandoffV1({
    trainerSheet:input.current.trainer,accessMode:'gm-authority',accessEvidenceDefinitionSha256:principalSha256(input.authority),
    checkpoint:'egg-acceptance',capturedAtCampaignMinute:input.current.clock.campaignMinute,facilityClaims:[],
  })
  const source = createBreedingArtificialEggSourceAuthorityV1({
    eggId:futureEggId,ownerTrainerSheet:input.current.trainer,createdByGmProfileId:'campaign-gm',featureProviderHandoff:feature,
    chemistryCustody:{inventoryEntryId:chemistry.inventoryEntryId,unitOrdinal:chemistry.unitOrdinal},capturedAtCampaignMinute:input.current.clock.campaignMinute,
  })
  const speciesId = breedingArtificialEggSpeciesIdV1(playingGodContributionV1(feature))
  const speciesOptionId = breedingArtificialEggOfferOptionId(innerId,'species',speciesId)
  const spec = compiledBreedingSpeciesSpec(speciesId) ?? fail(409,'The Playing God Species is unavailable.')
  const requestedRollKinds = spec.genderPolicy.kind === 'genderless' ? [] : ['gender']
  const baseCommand = parseSourceEggCommand({schemaVersion:1,operationId:innerId,commandKind:'create-source-egg',
    actor:{profileId:'campaign-gm',selectedTrainerSlug:null},ruleset:RULESET,
    scopes:[{kind:'pokemon-egg',eggId:futureEggId,expectedRevision:null},
      {kind:'trainer-sheet',sheetSlug:input.current.trainer.slug,expectedRevision:input.current.trainer.revision,fields:['inventory','money']}],
    payload:{eggId:futureEggId,ownerTrainerSlug:input.current.trainer.slug,
      source:{kind:'feature-artificial',providerId:'feature.playing-god',evidenceDefinitionSha256:source.definitionSha256},
      speciesOptionId,resolutions:{selectedOptionIds:[],requestedRollKinds}},
  })
  const tentativeOffers=createBreedingArtificialEggOptionOffersV1({command:baseCommand,sourceAuthority:source,
    featureProviderHandoff:feature,campaignOptionSnapshot:DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT,
    issuedAtCampaignMinute:input.current.clock.campaignMinute,expiresAtCampaignMinute:input.current.clock.campaignMinute+OFFER_LIFETIME})
  const selectedInnerOptionIds='selectedOptionIds'in input.request?resolveProjectedSourceChoices({operationId:input.request.operationId,
    offers:tentativeOffers,slots:artificialSlots(innerId),selectedOptionIds:input.request.selectedOptionIds}):[]
  const command=parseSourceEggCommand({...baseCommand,payload:{...baseCommand.payload,
    resolutions:{selectedOptionIds:[...selectedInnerOptionIds].sort(compare),requestedRollKinds}}})
  const actor=actorFor(input.authority,command,input.current.clock.campaignMinute)
  const offers=createBreedingArtificialEggOptionOffersV1({command,sourceAuthority:source,featureProviderHandoff:feature,
    campaignOptionSnapshot:DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT,issuedAtCampaignMinute:input.current.clock.campaignMinute,
    expiresAtCampaignMinute:input.current.clock.campaignMinute+OFFER_LIFETIME})
  return Object.freeze({command,source,feature,actor,offers,selectedInnerOptionIds,speciesId})
}
export const previewItemBreedingSourceWorkflow = (input: {
  readonly authority: ItemBreedingRequestAuthority
  readonly request: PreviewFossilRequestV1 | PreviewArtificialRequestV1
}, dependencies: Dependencies = {}): ItemBreedingSourcePreviewV1 => {
  const current=currentProjection({authority:input.authority,trainerSlug:input.request.trainerSheetSlug,
    expectedRevision:input.request.expectedTrainerRevision,dependencies})
  if(input.request.action==='preview-fossil'){
    const context=buildFossilContext({request:input.request,authority:input.authority,current})
    return Object.freeze({schemaVersion:1,kind:'fossil',operationId:input.request.operationId,
      trainerSheetSlug:input.request.trainerSheetSlug,expectedTrainerRevision:input.request.expectedTrainerRevision,
      title:'Restore a Fossil',summary:Object.freeze(['Exactly one GM-designated source unit is consumed.','The Reanimation Machine remains in inventory.','The result is an ordinary incubating Egg in the shared lifecycle.']),
      choices:choicesFromOffers({operationId:input.request.operationId,offers:context.offers,slots:fossilSlots(context.command.operationId)})})
  }
  const context=buildArtificialContext({request:input.request,authority:input.authority,current})
  return Object.freeze({schemaVersion:1,kind:'artificial',operationId:input.request.operationId,
    trainerSheetSlug:input.request.trainerSheetSlug,expectedTrainerRevision:input.request.expectedTrainerRevision,
    title:'Create an Artificial Egg',summary:Object.freeze(['Playing God supplies the exact Species.','$3,500 is spent atomically.','The Chemistry Set remains in inventory.']),
    choices:choicesFromOffers({operationId:input.request.operationId,offers:context.offers,slots:artificialSlots(context.command.operationId)})})
}

const acceptedReceipt = (input: {
  readonly command: Extract<BreedingOperationCommandV1,{readonly commandKind:'create-source-egg'}>
  readonly readSet: ReturnType<typeof buildReadSet>
  readonly actor: ReturnType<typeof createBreedingActorAuthorityV1>
  readonly evidenceHashes: readonly string[]
}) => createBreedingAuthorizationReceiptV1({operationId:input.command.operationId,
  commandSha256:createBreedingOperationCommandHash(input.command),commandKind:'create-source-egg',
  actorAuthorityDefinitionSha256:input.actor.definitionSha256,readSetDefinitionSha256:input.readSet.definitionSha256,
  evidenceDefinitionHashes:[...new Set(input.evidenceHashes)].sort(compare),gmOverrideIds:[],authorized:true,
  reasonId:'breeding.authorization.authorized',evaluatedAtCampaignMinute:input.readSet.capturedAtCampaignMinute,
  securityPolicyDefinitionSha256:SECURITY.definitionSha256})

const executeFossil = (input: {
  readonly authority: ItemBreedingRequestAuthority
  readonly command: RestoreFossilCommandV1
  readonly current: ReturnType<typeof currentProjection>
  readonly now: number
}): { readonly result: ItemBreedingOperationResultV1, readonly evidence: StrictJsonObject } => {
  const context=buildFossilContext({request:input.command,authority:input.authority,current:input.current})
  const speciesOption=context.offers.flatMap(offer=>offer.options).find(value=>value.optionId===context.command.payload.speciesOptionId)
    ?? fail(409,'The exact Fossil Species offer is unavailable.')
  const dependencies=breedingFossilEggDependencyEvidenceV1({sourceAuthority:context.source,reanimationAuthority:context.reanimation,
    featureProviderHandoff:context.feature,campaignOptionSnapshot:DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT,speciesId:speciesOption.canonicalValueId})
  const readSet=buildReadSet({outerOperationId:input.command.operationId,command:context.command,trainer:input.current.trainer,
    clock:input.current.clock,offers:context.offers,dependencies})
  const receipt=acceptedReceipt({command:context.command,readSet,actor:context.actor,evidenceHashes:[context.actor.definitionSha256,
    context.source.definitionSha256,context.reanimation.definitionSha256,context.feature.definitionSha256,
    DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT.definitionSha256,BREEDING_FOSSIL_EGG_POLICY_DEFINITION_SHA256,...context.offers.map(value=>value.definitionSha256)]})
  const references=createCurrentBreedingReferenceVersionSnapshotV1(DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT)
  const execution=createBreedingFossilEgg({command:context.command,readSet,authorizationReceipt:receipt,actorAuthority:context.actor,
    sourceAuthority:context.source,reanimationAuthority:context.reanimation,featureProviderHandoff:context.feature,
    campaignOptionSnapshot:DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT,audience:'gm'},
  {database:input.current.database,validateCurrentGmAuthority:()=>true,
    resolveCurrentCampaignOptionSnapshot:()=>DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT,
    resolveCurrentReferenceVersions:()=>references,resolveCurrentOfferChoices:()=>context.choices,
    offerLifetimeCampaignMinutes:OFFER_LIFETIME,campaignProjectionKey:SECURITY.definitionSha256,realtimeTimestamp:input.now,sheetUpdatedAt:input.now,
    resumePending:true})
  if(!execution.egg||!execution.sourceTrainerSheet||execution.execution.record.status!=='accepted'){
    return {result:parseItemBreedingOperationResult({schemaVersion:1,operationId:input.command.operationId,kind:'restore-fossil',status:'rejected',
      trainerSheetSlug:input.command.trainerSheetSlug,trainerRevision:input.current.trainer.revision,egg:null,assignment:null,
      message:'Fossil restoration was rejected by current authoritative breeding state.'}),evidence:strictEvidence({kind:'fossil-rejected',innerOperationId:context.command.operationId})}
  }
  const speciesName=canonicalName(execution.egg.offspring.speciesId)
  return {result:parseItemBreedingOperationResult({schemaVersion:1,operationId:input.command.operationId,kind:'restore-fossil',status:'accepted',
    trainerSheetSlug:input.command.trainerSheetSlug,trainerRevision:execution.sourceTrainerSheet.revision,
    egg:{sourceKind:'fossil',speciesName,startingLevel:execution.egg.offspring.startingLevel,status:'incubating'},assignment:null,
    message:`${speciesName} Egg restoration accepted. The Fossil source was consumed; the Reanimation Machine remains reusable.`}),
    evidence:strictEvidence({kind:'fossil-restoration',innerOperationId:context.command.operationId,eggId:execution.egg.eggId,
      contractDefinitionSha256:BREEDING_ITEM_WORKFLOW_DEFINITION_SHA256,sourceAuthorityDefinitionSha256:context.source.definitionSha256,
      reanimationAuthorityDefinitionSha256:context.reanimation.definitionSha256})}
}

const executeArtificial = (input: {
  readonly authority: ItemBreedingRequestAuthority
  readonly command: CreateArtificialEggCommandV1
  readonly current: ReturnType<typeof currentProjection>
  readonly now: number
}): { readonly result: ItemBreedingOperationResultV1, readonly evidence: StrictJsonObject } => {
  const context=buildArtificialContext({request:input.command,authority:input.authority,current:input.current})
  const dependencies=breedingArtificialEggDependencyEvidenceV1({sourceAuthority:context.source,
    campaignOptionSnapshot:DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT,speciesId:context.speciesId})
  const readSet=buildReadSet({outerOperationId:input.command.operationId,command:context.command,trainer:input.current.trainer,
    clock:input.current.clock,offers:context.offers,dependencies})
  const receipt=acceptedReceipt({command:context.command,readSet,actor:context.actor,evidenceHashes:[context.actor.definitionSha256,
    context.source.definitionSha256,context.feature.definitionSha256,DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT.definitionSha256,
    BREEDING_ARTIFICIAL_EGG_POLICY_DEFINITION_SHA256,...context.offers.map(value=>value.definitionSha256)]})
  const references=createCurrentBreedingReferenceVersionSnapshotV1(DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT)
  const execution=createBreedingArtificialEgg({command:context.command,readSet,authorizationReceipt:receipt,actorAuthority:context.actor,
    sourceAuthority:context.source,featureProviderHandoff:context.feature,campaignOptionSnapshot:DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT,audience:'gm'},
  {database:input.current.database,validateCurrentGmAuthority:()=>true,
    resolveCurrentCampaignOptionSnapshot:()=>DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT,resolveCurrentReferenceVersions:()=>references,
    resolveCurrentFeatureProviderHandoff:({trainerSheet,actorAuthority,campaignMinute})=>createBreedingFeatureProviderHandoffV1({
      trainerSheet,accessMode:'gm-authority',accessEvidenceDefinitionSha256:actorAuthority.authenticatedPrincipalSha256,
      checkpoint:'egg-acceptance',capturedAtCampaignMinute:campaignMinute,facilityClaims:[]}),
    offerLifetimeCampaignMinutes:OFFER_LIFETIME,campaignProjectionKey:SECURITY.definitionSha256,realtimeTimestamp:input.now,sheetUpdatedAt:input.now,
    resumePending:true})
  if(!execution.egg||!execution.sourceTrainerSheet||execution.execution.record.status!=='accepted'){
    return {result:parseItemBreedingOperationResult({schemaVersion:1,operationId:input.command.operationId,kind:'create-artificial-egg',status:'rejected',
      trainerSheetSlug:input.command.trainerSheetSlug,trainerRevision:input.current.trainer.revision,egg:null,assignment:null,
      message:'Artificial Egg creation was rejected by current authoritative breeding state.'}),evidence:strictEvidence({kind:'artificial-rejected',innerOperationId:context.command.operationId})}
  }
  const speciesName=canonicalName(execution.egg.offspring.speciesId)
  return {result:parseItemBreedingOperationResult({schemaVersion:1,operationId:input.command.operationId,kind:'create-artificial-egg',status:'accepted',
    trainerSheetSlug:input.command.trainerSheetSlug,trainerRevision:execution.sourceTrainerSheet.revision,
    egg:{sourceKind:'feature-artificial',speciesName,startingLevel:execution.egg.offspring.startingLevel,status:'incubating'},assignment:null,
    message:`${speciesName} Artificial Egg accepted. $3,500 was spent; the Chemistry Set remains reusable.`}),
    evidence:strictEvidence({kind:'artificial-egg',innerOperationId:context.command.operationId,eggId:execution.egg.eggId,
      contractDefinitionSha256:BREEDING_ITEM_WORKFLOW_DEFINITION_SHA256,sourceAuthorityDefinitionSha256:context.source.definitionSha256,
      featureHandoffDefinitionSha256:context.feature.definitionSha256})}
}
const canonicalName=(speciesId:string):string=>canonicalBreedingSpeciesIdentity(speciesId)?.sourceName??'Pokémon'

const executeAssignment = (input: {
  readonly authority: ItemBreedingRequestAuthority
  readonly command: Extract<ItemBreedingOperationCommandV1,{readonly kind:'assign-egg-warmer'}>
  readonly current: ReturnType<typeof currentProjection>
  readonly dependencies: Dependencies
  readonly now: number
  readonly operationRepository: ItemBreedingOperationRepository
  readonly commandSha256: string
  readonly replayPrincipal: string
}): ItemBreedingOperationResultV1 => {
  if(!input.current.authority.projection.eggWarmer.availability.enabled)fail(409,input.current.authority.projection.eggWarmer.availability.unavailableReason??'Egg Warmer assignment is unavailable.')
  const unit=input.current.authority.warmerUnits.get(input.command.warmerUnitOptionId)
    ?? fail(409,'The exact Egg Warmer unit or capacity is unavailable.')
  const eggs=input.command.eggOptionIds.map(id=>input.current.authority.eggs.get(id)??fail(409,'An assigned Egg changed. Refresh before retrying.'))
  if(eggs.length>BREEDING_ITEM_WORKFLOW_CAPACITY)fail(409,'The exact Egg Warmer unit or capacity is unavailable.')
  const state=parseItemBreedingState(input.current.trainer.document.serverPrivate?.itemBreeding)
  const unitKey=`${unit.inventoryEntryId}\0${unit.unitOrdinal}`
  for(const assignment of state.eggWarmerAssignments){
    const otherKey=`${assignment.inventoryEntryId}\0${assignment.unitOrdinal}`
    if(otherKey!==unitKey&&assignment.eggIds.some(id=>eggs.some(value=>value.egg.eggId===id)))fail(409,'One selected Egg is assigned to another Egg Warmer unit.')
  }
  for(const value of eggs)createBreedingEggWarmerItemHandoffV1({egg:value.egg,ownerTrainerSheet:input.current.trainer,
    custody:{inventoryEntryId:unit.inventoryEntryId,unitOrdinal:unit.unitOrdinal,assignedEggIds:eggs.map(entry=>entry.egg.eggId).sort(compare)},
    capturedAtCampaignMinute:input.current.clock.campaignMinute})
  const assignments=state.eggWarmerAssignments.filter(value=>`${value.inventoryEntryId}\0${value.unitOrdinal}`!==unitKey)
  if(eggs.length>0)assignments.push({inventoryEntryId:unit.inventoryEntryId,unitOrdinal:unit.unitOrdinal,
    eggIds:eggs.map(value=>value.egg.eggId).sort(compare),assignedAtCampaignMinute:input.current.clock.campaignMinute,lastOperationId:input.command.operationId})
  assignments.sort((a,b)=>compare(a.inventoryEntryId,b.inventoryEntryId)||a.unitOrdinal-b.unitOrdinal)
  const next:TrainerSheet=structuredClone(input.current.trainer.document)
  next.serverPrivate={...(next.serverPrivate??{}),itemBreeding:parseItemBreedingState({schemaVersion:1,eggWarmerAssignments:assignments})}
  next.updatedAt=input.now
  const sheets=input.dependencies.sheetRepository??createSqliteSheetRepository<Record<string,unknown>>(input.current.database)
  const realtime=input.dependencies.realtimeEventRepository??createSqliteRealtimeEventRepository({database:input.current.database})
  let result:ItemBreedingOperationResultV1|null=null
  const events=input.current.database.withTransaction(()=>{
    const duplicate=input.operationRepository.find(input.command.operationId)
    if(duplicate){if(duplicate.commandSha256!==input.commandSha256)fail(409,'Item breeding operation ID was reused with changed input.');if(duplicate.principalKey!==input.replayPrincipal)fail(403,'Item breeding replay belongs to another principal.');result=duplicate.result;return[]}
    const currentClock=(input.dependencies.campaignClockRepository??createSqliteCampaignClockRepository(input.current.database)).get()
    if(currentClock.revision!==input.current.clock.revision||currentClock.campaignMinute!==input.current.clock.campaignMinute)fail(409,'The campaign clock changed before Egg Warmer assignment commit.')
    if(sheets.applyLivePlayUpdate({kind:'trainer',slug:input.current.trainer.slug,expectedRevision:input.current.trainer.revision,
      nextSheet:next as unknown as Record<string,unknown>})==='stale')fail(409,'The breeding Trainer sheet changed before Egg Warmer assignment commit.')
    const after=storedTrainer(sheets,input.current.trainer.slug)
    result=parseItemBreedingOperationResult({schemaVersion:1,operationId:input.command.operationId,kind:'assign-egg-warmer',status:'accepted',
      trainerSheetSlug:input.command.trainerSheetSlug,trainerRevision:after.revision,egg:null,
      assignment:{warmerLabel:unit.label,assignedEggLabels:eggs.map(value=>value.label),capacity:4,progressRateNumerator:2,progressRateDenominator:1},
      message:eggs.length===0?'Egg Warmer assignment cleared.':`${eggs.length} Egg${eggs.length===1?'':'s'} assigned. Each campaign day now counts as two hatch-rate days.`})
    input.operationRepository.insert({commandSha256:input.commandSha256,principalKey:input.replayPrincipal,command:input.command,result:result!,
      evidence:strictEvidence({kind:'egg-warmer-assignment',contractDefinitionSha256:BREEDING_ITEM_WORKFLOW_DEFINITION_SHA256,
        campaignClockRevision:currentClock.revision,campaignMinute:currentClock.campaignMinute,inventoryEntryId:unit.inventoryEntryId,
        unitOrdinal:unit.unitOrdinal,eggIds:eggs.map(value=>value.egg.eggId),trainerRevisionBefore:input.current.trainer.revision,trainerRevisionAfter:after.revision}),createdAt:input.now})
    return realtime.appendMany(setupSheetSaveRealtimeAppendInputs({kind:'trainer',slug:after.slug,
      sheet:after.document as unknown as Record<string,unknown>,clientId:input.authority.clientId}).map(event=>({...event,timestamp:input.now})))
  })
  publishPersistedRealtimeEventsAfterCommit({events,publish:input.dependencies.publishPersistedRealtimeEvent??defaultPersistedRealtimeEventPublisher,
    reportFailure:input.dependencies.reportAfterCommitPublicationFailure??defaultPersistedRealtimePublicationFailureReporter,
    operation:'item-breeding-egg-warmer-assignment'})
  return result??fail(409,'Egg Warmer assignment did not settle.')
}

export const executeItemBreedingOperation = (input: {
  readonly authority: ItemBreedingRequestAuthority
  readonly command: unknown
}, dependencies: Dependencies = {}): ItemBreedingOperationResultV1 => {
  let command:ItemBreedingOperationCommandV1
  try{command=parseItemBreedingOperationCommand(input.command)}catch(error){if(error instanceof ItemBreedingWorkflowValidationError)fail(400,'Invalid item breeding command.');throw error}
  const database=databaseFrom(dependencies)
  const operations=dependencies.operationRepository??createSqliteItemBreedingOperationRepository(database)
  const commandSha256=sha256(command);const replayPrincipal=principalKey(input.authority)
  const existing=operations.find(command.operationId)
  if(existing){if(existing.commandSha256!==commandSha256)fail(409,'Item breeding operation ID was reused with changed input.');if(existing.principalKey!==replayPrincipal)fail(403,'Item breeding replay belongs to another principal.');return existing.result}
  const current=currentProjection({authority:input.authority,trainerSlug:command.trainerSheetSlug,expectedRevision:command.expectedTrainerRevision,dependencies})
  const now=dependencies.now?.()??Date.now()
  if(command.kind==='assign-egg-warmer')return executeAssignment({authority:input.authority,command,current,dependencies,now,
    operationRepository:operations,commandSha256,replayPrincipal})
  const settled=command.kind==='restore-fossil'?executeFossil({authority:input.authority,command,current,now})
    :executeArtificial({authority:input.authority,command,current,now})
  database.withTransaction(()=>{
    const duplicate=operations.find(command.operationId)
    if(duplicate){if(duplicate.commandSha256!==commandSha256)fail(409,'Item breeding operation ID was reused with changed input.');if(duplicate.principalKey!==replayPrincipal)fail(403,'Item breeding replay belongs to another principal.');return}
    operations.insert({commandSha256,principalKey:replayPrincipal,command,result:settled.result,evidence:settled.evidence,createdAt:now})
  })
  return settled.result
}

export const handleItemBreedingPost = (input: {
  readonly authority: ItemBreedingRequestAuthority
  readonly request: unknown
}, dependencies: Dependencies = {}): ItemBreedingSourcePreviewV1 | ItemBreedingOperationResultV1 => {
  let request:ItemBreedingWorkflowPostRequestV1
  try{request=parseItemBreedingWorkflowPostRequest(input.request)}catch(error){if(error instanceof ItemBreedingWorkflowValidationError)fail(400,'Invalid item breeding request.');throw error}
  return 'action'in request?previewItemBreedingSourceWorkflow({authority:input.authority,request},dependencies)
    :executeItemBreedingOperation({authority:input.authority,command:request},dependencies)
}
