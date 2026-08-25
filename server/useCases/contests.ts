import { createHash, randomInt } from 'node:crypto'
import type { AuthRole } from '#shared/auth'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { PlayerProfile } from '#shared/playerProfiles'
import { appendContestHistory, ContestContractError, contestCurrentPerformer, contestPerformerIsPokemon, createContestDocument, parseContestDocument, type ContestDocumentV1, type ContestantStateV1 } from '#shared/contests/document'
import { parseContestCommand, type ContestCommandV1, type ContestOperationResultV1 } from '#shared/contests/operations'
import { projectContestDiagnostic, projectContestGm, projectContestOwner, projectContestPublic, type ContestRoleProjectionV1 } from '#shared/contests/projections'
import { buildContestPerformerSnapshot, buildContestTrainerPerformerSnapshot } from '#shared/contests/integrations'
import { battleContestVariant, contestBaseVariantAllowsTrainerParticipants } from '#shared/contests/catalog'
import { MAP_INTERACTION_MODES } from '#shared/mapInteractionMode'
import { resolvedSheetFeatureClosure } from '#shared/featureAutomation/sheetFeatures'
import { FEATURE_AUTOMATION_MANIFEST_BY_ID } from '#shared/featureAutomation/manifest'
import { beginAbilityDailyUsagePeriod, createEmptyAbilityDailyUsageLedger, parseAbilityDailyUsageLedger } from '#shared/abilityAutomation/resources'
import type { ContestRandomSource } from '#shared/contests/dice'
import { CONTEST_STAT_IDS, type ContestStatId } from '#shared/contests/ids'
import { ContestRuleError } from '#shared/contests/validation'
import type { ContestRibbonRecordV1, TrainerContestResultRecordV1 } from '#shared/contests/ribbons'
import itemsJson from '../../data/reference/items.json'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet, InventoryEntry } from '~/types/trainerSheet'
import { resolveTrainerSkills } from '~/utils/sheets/trainerDerived'
import { calculatePokemonLevelFromExperience, pokemonExperienceNeededForLevel } from '~/utils/sheets/pokemonExperience'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqliteContestRepository, contestCommandHash, ContestRepositoryError, type ContestRepository } from '../storage/contestRepository'
import { createSqliteSheetRepository, SheetRevisionConflictError, type SheetRepository } from '../storage/sheetRepository'
import { createSqliteEncounterDocumentRepository, type EncounterDocumentRepository } from '../storage/encounterDocumentRepository'
import { createSqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import { createSqliteMapInteractionModeRepository, type MapInteractionModeRepository } from '../storage/mapInteractionModeRepository'
import { createSqliteLivePlayOpRepository, type LivePlayOpRepository } from '../storage/opRepository'
import { createSqliteCampaignClockRepository } from '../storage/campaignClockRepository'
import { createSqliteRealtimeEventRepository, type AppendRealtimeEventInput, type RealtimeEventRepository } from '../storage/realtimeEventRepository'
import { contestRealtimeAppendInputs } from '../realtime/contestRealtime'
import { encounterDocumentRealtimeAppendInputs } from '../realtime/encounterDocumentRealtime'
import { interactionModeRealtimeAppendInputs, mapLibraryCreatedRealtimeAppendInputs } from '../realtime/libraryMutationRealtime'
import { deduplicateAuthoritativeSheetDocumentUpdates, sheetDocumentUpdatedRealtimeAppendInput } from '../realtime/sheetDocumentRealtime'
import { settleFeatureDeclarationResources } from '../domain/featureAutomation/resources'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import { publishPersistedRealtimeEventsAfterCommit, defaultPersistedRealtimeEventPublisher, defaultPersistedRealtimePublicationFailureReporter, type PersistedRealtimeEventPublisher, type PersistedRealtimePublicationFailureReporter } from '../realtime/persistedBatchPublication'
import { readPlayerProfile } from '../utils/playerProfileStorage'
import { createContestantState, executeContestEngineCommand } from '../domain/contests/engine'
import { BattleContestEncounterPlanningError, planBattleContestEncounter } from '../domain/contests/battleEncounter'
import { BattleAcceptedMoveDerivationError, deriveBattleContestAcceptedMoveDelivery } from '../domain/contests/battleAcceptedMove'
import { BattleContestAppealError, executeBattleContestAcceptedMoveAppeal } from '../domain/contests/battleAppeal'
import { assertBattleContestSingleSpendConvergence, BattleContestAccountingError } from '../domain/contests/battleAccounting'
import { BattleContestLifecycleDerivationError, deriveBattleContestVoltageLifecycleDelivery } from '../domain/contests/battleLifecycle'
import { BattleContestVoltageLifecycleError, executeBattleContestVoltageLifecycle } from '../domain/contests/battleVoltageLifecycle'
import { BattleContestEndError, deriveBattleContestAllPokemonKnockedOutEndDelivery, deriveBattleContestRoundBudgetEndDelivery, executeBattleContestEnd } from '../domain/contests/battleEnd'
import { assertBattleContestRecoveryAuthority, BattleContestRecoveryError, planBattleContestRecovery } from '../domain/contests/battleRecovery'
import {
  assertBattleContestRewardsUnapplied,
  assertBattleContestSettlementExactRetry,
  BattleContestSettlementError,
  completeBattleContestSettlementCoordination,
  encounterSettlementCommandForBattleCoordination,
  planBattleContestSettlementCoordination,
} from '../domain/contests/battleSettlement'
import { parseEncounterHistory } from '#shared/moveAutomation/encounterHistory'
import { assertBattleContestRevisionCoupling, BattleContestBlendContractError } from '#shared/contests/battleBlend'
import { encounterSceneId } from '../domain/moveAutomation/planSceneLifecycle'
import { toPersistableSheetPayload } from '~/utils/sheets/persistence'
import { prepareFinishEncounter, PrepareFinishEncounterUseCaseError, rebuildPreparedFinishEncounter } from './prepareFinishEncounter'
import {
  createSqliteEncounterSettlementRepository,
  EncounterSettlementRepositoryError,
  type EncounterSettlementAtomicWriteBoundary,
} from '../storage/encounterSettlementRepository'
import { encounterSettlementAtomicDefinitionSha256 } from '../domain/encounterSettlement/atomicCommit'

export interface ContestUseCaseDependencies {
  readonly database?: RotomDatabase
  readonly contests?: ContestRepository
  readonly sheets?: SheetRepository<Record<string, unknown>>
  readonly encounters?: EncounterDocumentRepository
  readonly maps?: MapRepository<TabletopMap>
  readonly mapInteractionModes?: MapInteractionModeRepository
  readonly livePlayOps?: Pick<LivePlayOpRepository, 'getStoredOpRecord'> & { readonly database?: RotomDatabase }
  readonly realtimeEvents?: Pick<RealtimeEventRepository, 'appendMany'> & { readonly database?: RotomDatabase }
  readonly random?: ContestRandomSource
  readonly now?: () => number
  readonly readProfile?: (id: unknown) => PlayerProfile | null
  readonly publishPersistedRealtimeEvent?: PersistedRealtimeEventPublisher
  readonly reportAfterCommitPublicationFailure?: PersistedRealtimePublicationFailureReporter
  /** Deterministic failure injection for the private combined Battle settlement boundary. */
  readonly onBattleSettlementWriteBoundary?: (boundary: EncounterSettlementAtomicWriteBoundary | 'after-contest-reward-writes' | 'after-contest-document-write' | 'after-contest-operation-write') => void
}
export interface ContestActorV1 { readonly role: AuthRole, readonly playerProfile?: PlayerProfile | null, readonly diagnostic?: boolean }
export interface ExecuteContestCommandResultV1 { readonly result: ContestOperationResultV1, readonly projection: ContestRoleProjectionV1 }
export class ContestUseCaseError extends Error {
  readonly statusCode: 400|403|404|409
  readonly code: string
  readonly details: unknown
  constructor(statusCode: 400|403|404|409, code: string, message: string, details: unknown = null) { super(message); this.name = 'ContestUseCaseError'; this.statusCode = statusCode; this.code = code; this.details = details }
}
const fail = (statusCode: 400|403|404|409, code: string, message: string, details: unknown = null): never => { throw new ContestUseCaseError(statusCode, code, message, details) }
/** Compare persistable JSON semantics after removing optional undefined fields. */
const persistableCanonicalJson = (value: unknown): string => stableJsonStringify(JSON.parse(JSON.stringify(value)) as unknown)
const cryptoRandom: ContestRandomSource = Object.freeze({ nextInteger: (minimum: number, maximum: number) => randomInt(minimum, maximum + 1) })
const runtime = (dependencies: ContestUseCaseDependencies) => {
  const database = dependencies.database ?? dependencies.contests?.database ?? dependencies.sheets?.database ?? dependencies.encounters?.database ?? dependencies.maps?.database ?? dependencies.mapInteractionModes?.database ?? dependencies.livePlayOps?.database ?? dependencies.realtimeEvents?.database ?? getRotomDatabase()
  for (const candidate of [dependencies.contests?.database, dependencies.sheets?.database, dependencies.encounters?.database, dependencies.maps?.database, dependencies.mapInteractionModes?.database, dependencies.livePlayOps?.database, dependencies.realtimeEvents?.database]) if (candidate && candidate !== database) throw new Error('Contest and linked Encounter repositories must share one transaction database.')
  return {
    database,
    contests: dependencies.contests ?? createSqliteContestRepository(database),
    sheets: dependencies.sheets ?? createSqliteSheetRepository<Record<string, unknown>>(database),
    encounters: dependencies.encounters ?? createSqliteEncounterDocumentRepository(database),
    maps: dependencies.maps ?? createSqliteMapRepository<TabletopMap>(database),
    mapModes: dependencies.mapInteractionModes ?? createSqliteMapInteractionModeRepository(database),
    livePlayOps: dependencies.livePlayOps ?? createSqliteLivePlayOpRepository({ database }),
    realtime: dependencies.realtimeEvents ?? createSqliteRealtimeEventRepository({ database }),
    random: dependencies.random ?? cryptoRandom,
    readProfile: dependencies.readProfile ?? readPlayerProfile,
  }
}
const projectFor = (document: ContestDocumentV1, actor: ContestActorV1): ContestRoleProjectionV1 => {
  if (actor.role === 'gm') return actor.diagnostic ? projectContestDiagnostic(document) : projectContestGm(document)
  const profileId = actor.playerProfile?.id
  return profileId ? projectContestOwner(document, profileId) ?? projectContestPublic(document) : projectContestPublic(document)
}
const commandContestantId = (command: ContestCommandV1): string | null => 'contestantId' in command && typeof command.contestantId === 'string' ? command.contestantId : null
const authorizeCommand = (document: ContestDocumentV1 | null, command: ContestCommandV1, actor: ContestActorV1): void => {
  if (actor.role === 'gm') return
  if (!actor.playerProfile) return fail(403, 'contest.profile-required', 'Select a player profile before acting in a Contest.')
  if (!document) return fail(403, 'contest.gm-required', 'Only the GM may create a Contest.')
  if (!['declare-introduction','select-rotation-performer','declare-appeal','use-intervention','pass-intervention'].includes(command.commandKind)) return fail(403, 'contest.gm-required', 'Only the GM may perform that Contest action.')
  const profile = actor.playerProfile
  const authoritativeDocument = document
  const contestantId = commandContestantId(command)
  const contestant = authoritativeDocument.contestants.find(row => row.contestantId === contestantId)
  if (!contestant || contestant.controller.kind !== 'profile' || contestant.controller.profileId !== profile.id) return fail(403, 'contest.controller-required', 'This Contest decision belongs to another controller.')
}
const resultFor = (document: ContestDocumentV1, command: ContestCommandV1, exactRetry: boolean): ContestOperationResultV1 => Object.freeze({ schemaVersion: 1, ok: true, exactRetry, operationId: command.operationId, contestId: document.contestId, commandKind: command.commandKind, revision: document.revision, stage: document.stage, updatedAt: document.updatedAt })
const sheet = <T extends CharacterSheet|TrainerSheet>(repository: SheetRepository<Record<string, unknown>>, kind: 'pokemon'|'trainer', slug: string): { document: T, revision: number } => {
  const stored = repository.get(kind, slug) ?? fail(404, 'contest.sheet-not-found', `${kind === 'pokemon' ? 'Pokémon' : 'Trainer'} sheet was not found.`)
  return { document: stored.document as unknown as T, revision: stored.revision }
}
const linkedToProfile = (profile: PlayerProfile, kind: 'pokemon'|'trainer', slug: string): boolean => profile.linkedCharacters.some(ref => ref.sheetKind === kind && ref.sheetSlug === slug)

const refreshContestProviderSnapshots = (document: ContestDocumentV1, repositories: ReturnType<typeof runtime>, now: number, recordHistory: boolean): ContestDocumentV1 => {
  if (document.stage === 'completed' || document.stage === 'cancelled' || document.contestants.length === 0) return document
  const next = structuredClone(document) as any
  const campaignDay = Math.floor(createSqliteCampaignClockRepository(repositories.database).get().campaignMinute / 1_440)
  let changed = false
  for (const contestant of next.contestants) {
    const trainerStored = repositories.sheets.get('trainer', contestant.trainerSheetSlug)
    if (!trainerStored) continue // Keep the enrolled snapshot readable while ordinary-sheet recovery is required.
    const trainer = trainerStored.document as unknown as TrainerSheet
    const enrolledTrainerPerformer = contestant.performers.find((performer: any) => performer.performerKind === 'trainer')
    if (enrolledTrainerPerformer) {
      const freshTrainerPerformer = buildContestTrainerPerformerSnapshot({ sheet: trainer, revision: enrolledTrainerPerformer.trainerSheetRevision })
      const activeTrainerProviderIds = new Set(freshTrainerPerformer.providerIds), retainedTrainerProviderIds = enrolledTrainerPerformer.providerIds.filter((providerId: string) => activeTrainerProviderIds.has(providerId))
      if (stableJsonStringify(retainedTrainerProviderIds) !== stableJsonStringify(enrolledTrainerPerformer.providerIds)) { enrolledTrainerPerformer.providerIds = retainedTrainerProviderIds; changed = true }
    }
    for (const performer of contestant.performers) {
      if (performer.performerKind !== 'pokemon') continue
      const pokemonStored = repositories.sheets.get('pokemon', performer.pokemonSheetSlug)
      if (!pokemonStored) continue
      const pokemon = pokemonStored.document as unknown as CharacterSheet
      const fresh = buildContestPerformerSnapshot({ sheet: pokemon, trainer, campaignDay, revision: performer.pokemonSheetRevision })
      const activeProviderIds = new Set(fresh.providerIds), retainedProviderIds = performer.providerIds.filter((id: string) => activeProviderIds.has(id))
      if (stableJsonStringify(retainedProviderIds) !== stableJsonStringify(performer.providerIds)) { performer.providerIds = retainedProviderIds; changed = true }
      for (const statId of CONTEST_STAT_IDS) {
        const pool = performer.dicePools[statId]
        const freshPool = fresh.dicePools[statId]
        const freshContributions = new Map(freshPool.contributors.map(row => [row.id, row]))
        const contributors = pool.contributors.map((entry: any) => {
          if (!['poffin','feature-poffin-equivalent','temporary-reallocation','ability'].includes(entry.kind)) return entry
          if (!entry.active) return entry
          const current = freshContributions.get(entry.id)
          const sourceActive = entry.kind === 'ability' ? activeProviderIds.has(`ability:${entry.label}`) : current?.active === true
          return sourceActive ? entry : { ...entry, active: false, explanation: `${entry.explanation} Source is no longer active for this Contest snapshot.` }
        })
        const total = contributors.reduce((sum: number, entry: any) => sum + (entry.active ? Number(entry.dice) : 0), 0), spent = Math.max(0, pool.total - pool.remaining)
        const remaining = Math.max(0, total - spent)
        if (total !== pool.total || remaining !== pool.remaining || stableJsonStringify(contributors) !== stableJsonStringify(pool.contributors)) { pool.total = total; pool.remaining = remaining; pool.contributors = contributors; changed = true }
      }
      const freshStyleOptions = new Set(fresh.moves.filter(row => row.source === 'style-feature' && row.available).map(row => row.optionId))
      for (const move of performer.moves) if (move.source === 'style-feature' && move.available && !freshStyleOptions.has(move.optionId)) {
        move.available = false
        move.unavailableCode = 'contest.provider-inactive'
        move.unavailableReason = 'The Style Feature that offered this Move is no longer active.'
        changed = true
      }
    }
  }
  if (changed && recordHistory) next.history = appendContestHistory(next, { type: 'provider-availability-refreshed', visibility: 'public', contestantId: null, headline: 'Provider availability refreshed', detail: 'Current ordinary sheets changed one or more Contest provider contributions; accepted results remain immutable.', operationId: null, createdAt: now }) as ContestDocumentV1['history']
  return changed ? parseContestDocument(next) : document
}

const enrollmentContext = (command: Extract<ContestCommandV1, { commandKind: 'enroll-contestant' }>, document: ContestDocumentV1, repositories: ReturnType<typeof runtime>): ContestantStateV1 => {
  if (document.participantVariantId === 'trainer-participant' && !contestBaseVariantAllowsTrainerParticipants(document.variantId)) fail(400, 'contest.variant-unsupported', 'Trainer performers are not permitted by this base Contest variant.')
  const trainer = sheet<TrainerSheet>(repositories.sheets, 'trainer', command.trainerSheetSlug)
  const controllerProfile = command.controller.kind === 'profile'
    ? repositories.readProfile(command.controller.profileId) ?? fail(400, 'contest.invalid-controller', 'Selected player profile no longer exists.')
    : null
  if (controllerProfile && !linkedToProfile(controllerProfile, 'trainer', trainer.document.slug)) fail(400, 'contest.invalid-controller', 'Selected player profile does not control that Trainer.')
  if (document.variantId === 'rotation') {
    if (command.pokemonSheetSlugs.length < 3 || command.pokemonSheetSlugs.length > 5) fail(400, 'contest.rotation-team-size', 'A Rotation team needs three through five distinct Pokémon.')
    const requiredOrderLength = document.policy.rotationOrderPolicy === 'predeclared' ? command.pokemonSheetSlugs.length : 0
    if (new Set(command.rotationOrder).size !== command.rotationOrder.length || command.rotationOrder.length !== requiredOrderLength) fail(400, 'contest.rotation-order', document.policy.rotationOrderPolicy === 'predeclared' ? 'Rotation order must use each team performer exactly once.' : 'This Rotation Contest chooses one unused performer at each round turn.')
  } else if (document.variantId === 'battle') {
    const minimum = battleContestVariant.rosterPolicy.pokemonPerTrainerMinimum, maximum = battleContestVariant.rosterPolicy.pokemonPerTrainerMaximum
    if (command.pokemonSheetSlugs.length < minimum || command.pokemonSheetSlugs.length > maximum) fail(400, 'contest.battle-team-size', `A Battle Contest team needs ${minimum} through ${maximum} distinct Pokémon.`)
    if (command.rotationOrder.length !== 0) fail(400, 'contest.rotation-order', 'Battle Contest initiative is owned by the linked encounter; setup cannot declare a Contest performer order.')
    const declared = document.battle?.declaredPokemonPerTrainer
    if (declared !== null && command.pokemonSheetSlugs.length !== declared) fail(400, 'contest.battle-team-size', `Both Battle Contest teams must declare exactly ${declared} Pokémon.`)
  } else if (command.pokemonSheetSlugs.length !== 1) fail(400, 'contest.team-not-supported', 'This Contest variant enrolls exactly one Pokémon per contestant.')
  if (new Set(command.pokemonSheetSlugs).size !== command.pokemonSheetSlugs.length) fail(400, 'contest.duplicate-pokemon', 'A Pokémon may enroll only once in an entry.')
  const campaignDay = Math.floor(createSqliteCampaignClockRepository(repositories.database).get().campaignMinute / 1_440)
  const preparedPokemonPerformers = command.pokemonSheetSlugs.map(slug => {
    if (controllerProfile && !linkedToProfile(controllerProfile, 'pokemon', slug)) fail(400, 'contest.invalid-controller', 'Selected player profile does not control every enrolled Pokémon.')
    const pokemon = sheet<CharacterSheet>(repositories.sheets, 'pokemon', slug)
    if (pokemon.document.letterPressCombinedInto || pokemon.document.zygardeDisassembledIntoCells) fail(400, 'contest.pokemon-ineligible', `${pokemon.document.nickname || slug} cannot act independently.`)
    return buildContestPerformerSnapshot({ sheet: pokemon.document, trainer: trainer.document, campaignDay, revision: pokemon.revision })
  })
  const performers = document.participantVariantId === 'trainer-participant'
    ? (() => {
        const trainerPerformer = buildContestTrainerPerformerSnapshot({ sheet: trainer.document, revision: trainer.revision }), trainerProviderIds = new Set(trainerPerformer.providerIds)
        const pokemonPerformers = preparedPokemonPerformers.map(performer => Object.freeze({ ...performer, providerIds: Object.freeze(performer.providerIds.filter(providerId => !trainerProviderIds.has(providerId))) }))
        return Object.freeze([...pokemonPerformers, trainerPerformer])
      })()
    : Object.freeze(preparedPokemonPerformers)
  return createContestantState({
    contestantId: command.contestantId,
    trainerSheetSlug: trainer.document.slug,
    trainerSheetRevision: trainer.revision,
    displayName: trainer.document.name || 'Trainer',
    controller: command.controller,
    introductionSkillDice: Object.freeze(Object.fromEntries(['charm','command','guile','intimidate','intuition'].map(skillId => [skillId, resolveTrainerSkills(trainer.document).find(row => row.key === skillId)?.rankValue ?? 2])) as Record<'charm'|'command'|'guile'|'intimidate'|'intuition', number>),
    performers: Object.freeze(performers),
    rotationOrder: Object.freeze([...command.rotationOrder]),
  })
}
const introductionContext = (command: Extract<ContestCommandV1, { commandKind: 'declare-introduction' }>, document: ContestDocumentV1, repositories: ReturnType<typeof runtime>) => {
  const contestant = document.contestants.find(row => row.contestantId === command.contestantId) ?? fail(400, 'contest.contestant-not-found', 'Contestant is not enrolled.')
  const skillDice = contestant.introductionSkillDice[command.skillId] ?? 2
  const providers = document.variantId === 'battle'
    ? (() => {
        const pokemon = contestant.performers.filter(contestPerformerIsPokemon)
        if (!pokemon.length) return []
        const trainer = sheet<TrainerSheet>(repositories.sheets, 'trainer', contestant.trainerSheetSlug)
        const trainerProviderIds = new Set(buildContestTrainerPerformerSnapshot({ sheet: trainer.document, revision: trainer.revision }).providerIds)
        return pokemon[0]!.providerIds.filter(providerId => trainerProviderIds.has(providerId) && pokemon.every(performer => performer.providerIds.includes(providerId)))
      })()
    : document.participantVariantId === 'trainer-participant'
      ? [...new Set(contestant.performers.flatMap(performer => performer.providerIds))]
      : contestant.performers.find(contestPerformerIsPokemon)?.providerIds ?? []
  const bonusRolls: Array<{ sourceId: string, label: string, dice: number, statId: ContestStatId }> = []
  const add = (sourceId: string, label: string, dice: number, statId: ContestStatId): void => { if (dice > 0) bonusRolls.push({ sourceId, label, dice, statId }) }
  if (providers.includes('edge:Groomer:groomed')) add('groomer', 'Groomer', 1, command.generatedStatId)
  for (const statId of CONTEST_STAT_IDS) if (providers.includes(`item:Fancy Clothes:${statId}`)) add(`fancy-clothes-${statId}`, 'Fancy Clothes', 2, statId)
  const hasAccessory = providers.includes('item:Contest Accessory')
  if (hasAccessory) add('contest-accessory', 'Contest Accessory', 2, command.bonusStatIds?.contestAccessory ?? command.generatedStatId)
  else if (command.bonusStatIds?.contestAccessory !== undefined) fail(400, 'contest.option-not-offered', 'Contest Accessory is not active for this performer.')
  for (const statId of CONTEST_STAT_IDS) if (providers.includes(`feature:Playing God:${statId}`)) add(`playing-god-${statId}`, 'Playing God coloration', 2, statId)
  const juggling = providers.find(id => id.startsWith('feature:Juggling Show:dice:'))
  const jugglingDice = juggling ? Math.max(0, Math.min(3, Number(juggling.split(':').at(-1)) || 0)) : 0
  if (jugglingDice) add('juggling-show', 'Juggling Show', jugglingDice, command.bonusStatIds?.jugglingShow ?? command.generatedStatId)
  else if (command.bonusStatIds?.jugglingShow !== undefined) fail(400, 'contest.option-not-offered', 'Juggling Show has no active bonus roll for this contestant.')
  return Object.freeze({ skillDice, bonusRolls: Object.freeze(bonusRolls), uglySixesCountAsOnes: providers.includes('ability:Ugly'), graceFlexible: providers.includes('edge:Grace') })
}

interface AuthoritativeContestSheetUpdate { readonly kind: 'trainer'|'pokemon', readonly slug: string, readonly sheet: Record<string, unknown> }
interface ContestResourceSheetPlan { readonly kind: 'trainer'|'pokemon', readonly slug: string, readonly expectedRevision: number, readonly sheet: TrainerSheet|CharacterSheet }
const contestInterventionResourcePlan = (
  command: Extract<ContestCommandV1, { commandKind: 'use-intervention' }>,
  document: ContestDocumentV1,
  repositories: ReturnType<typeof runtime>,
  now: number,
): ContestResourceSheetPlan | null => {
  const contestant = document.contestants.find(row => row.contestantId === command.contestantId) ?? fail(400, 'contest.contestant-not-found', 'Contestant is not enrolled.')
  const campaignDay = Math.floor(createSqliteCampaignClockRepository(repositories.database).get().campaignMinute / 1_440)
  if (command.interventionId === 'Fashion Designer') {
    const performer = document.participantVariantId === 'trainer-participant'
      ? contestant.performers.find(candidate => candidate.performerId === command.targetPerformerId)
      : contestCurrentPerformer(document, contestant)
    if (!performer || !contestPerformerIsPokemon(performer) || !performer.providerIds.includes('ability:Fashion Designer')) return null
    const current = sheet<CharacterSheet>(repositories.sheets, 'pokemon', performer.pokemonSheetSlug)
    const dayKey = `campaign-day:${campaignDay}`
    const ledger = beginAbilityDailyUsagePeriod(parseAbilityDailyUsageLedger(current.document.abilityUsage ?? createEmptyAbilityDailyUsageLedger()), dayKey)
    const ownerId = `sheet:pokemon:${current.document.slug}`
    const existing = ledger.entries.find(entry => entry.ownerId === ownerId && entry.canonicalId === 'Fashion Designer' && entry.clauseId === 'contest-decorative-twine')
    if (existing?.operationIds.includes(command.operationId)) return null
    if ((existing?.spent ?? 0) >= 1) fail(409, 'contest.resource-exhausted', 'Fashion Designer has already been used this campaign day.')
    const entry = { ownerId, abilityInstanceId: 'base:fashion-designer', canonicalId: 'Fashion Designer', clauseId: 'contest-decorative-twine', limit: 1, spent: 1, operationIds: [command.operationId] }
    const abilityUsage = parseAbilityDailyUsageLedger({ ...ledger, entries: existing ? ledger.entries.map(row => row === existing ? entry : row) : [...ledger.entries, entry] })
    return Object.freeze({ kind: 'pokemon', slug: current.document.slug, expectedRevision: current.revision, sheet: { ...structuredClone(current.document), abilityUsage } })
  }
  if (!contestant.performers.some(performer => performer.providerIds.some(id => id === `feature:${command.interventionId}` || id.startsWith(`feature:${command.interventionId}:`)))) return null
  const current = sheet<TrainerSheet>(repositories.sheets, 'trainer', contestant.trainerSheetSlug)
  const instance = resolvedSheetFeatureClosure(current.document).find(row => row.canonicalId === command.interventionId)
    ?? fail(409, 'contest.feature-source-stale', `${command.interventionId} is no longer on the enrolled Trainer sheet.`)
  const frequency = FEATURE_AUTOMATION_MANIFEST_BY_ID.get(command.interventionId)?.actions[0]?.frequency
    ?? fail(409, 'contest.feature-source-stale', `${command.interventionId} has no reviewed Feature resource contract.`)
  if (frequency.mode === 'at-will' && frequency.payment === null) return null
  const settlement = settleFeatureDeclarationResources({
    sheet: current.document,
    canonicalId: command.interventionId,
    sourceInstanceId: instance.instanceId,
    frequency,
    scope: { campaignId: 'campaign', sceneId: document.contestId, dayId: `campaign-day:${campaignDay}`, roundNumber: document.round || null, now },
    operationId: command.operationId,
  })
  if (!settlement.accepted) fail(409, `contest.${settlement.code ?? 'resource-exhausted'}`, `${command.interventionId} cannot pay its ordinary sheet resource.`)
  return Object.freeze({ kind: 'trainer', slug: current.document.slug, expectedRevision: current.revision, sheet: { ...structuredClone(current.document), featureApState: settlement.apState, featureUsage: settlement.usage } })
}

const assertReplacementController = (command: Extract<ContestCommandV1, { commandKind: 'apply-correction' }>, document: ContestDocumentV1, repositories: ReturnType<typeof runtime>): void => {
  if (command.correctionKind !== 'controller-reassignment' || command.replacementProfileId === null) return
  const contestant = document.contestants.find(row => row.contestantId === command.contestantId) ?? fail(400, 'contest.contestant-not-found', 'Contestant is not enrolled.')
  const profile = repositories.readProfile(command.replacementProfileId) ?? fail(400, 'contest.invalid-controller', 'Replacement player profile no longer exists.')
  if (!linkedToProfile(profile, 'trainer', contestant.trainerSheetSlug) || contestant.performers.filter(contestPerformerIsPokemon).some(performer => !linkedToProfile(profile, 'pokemon', performer.pokemonSheetSlug))) fail(400, 'contest.invalid-controller', 'Replacement profile must own the enrolled Trainer and every Pokémon performer.')
}

const appendPrizeItem = (trainer: TrainerSheet, itemId: string, quantity: number, contestId: string, ordinal: number): void => {
  trainer.inventory ??= {}
  const item = (itemsJson as Record<string, { categories?: readonly string[], sections?: readonly string[] }>)[itemId]
  const categories = new Set(item?.categories ?? [])
  const sections = new Set(item?.sections ?? [])
  const section: keyof NonNullable<TrainerSheet['inventory']> = categories.has('Food') || sections.has('Food') ? 'foodStuff'
    : categories.has('Body Equipment') || categories.has('Equipment') || sections.has('Equipment') ? 'equipment'
      : categories.has('Poké Ball') ? 'pokeBalls'
        : categories.has('Medicine') ? 'medicalKit'
          : categories.has('Key Item') ? 'keyItems' : 'pokemonItems'
  trainer.inventory[section] ??= []
  const rows = trainer.inventory[section]!
  if (section === 'equipment') {
    for (let index = 0; index < quantity; index += 1) rows.push({ id: `contest-prize-${contestId.split(':').at(-1)}-${ordinal}-${index + 1}`, name: itemId } satisfies InventoryEntry)
    return
  }
  const existing = rows.find(row => row.name === itemId && !row.serializedEquipment && !row.itemVariant && !row.contestPoffinStatId)
  if (existing) existing.qty = Math.max(0, Math.floor(existing.qty ?? 0)) + quantity
  else rows.push({ id: `contest-prize-${contestId.split(':').at(-1)}-${ordinal}`, name: itemId, qty: quantity } satisfies InventoryEntry)
}
const applySettlementWrites = (before: ContestDocumentV1, settlementOperationId: string, repositories: ReturnType<typeof runtime>, now: number): readonly AuthoritativeContestSheetUpdate[] => {
  const candidateSettlement = before.settlement
  if (!candidateSettlement || candidateSettlement.status !== 'preview') return fail(409, 'contest.settlement-not-ready', 'Settlement preview is unavailable.')
  const settlement = candidateSettlement
  const winner = settlement.entries.find(row => row.placement === 1)!
  const trainerUpdates = new Map<string, { beforeRevision: number, sheet: TrainerSheet }>()
  const pokemonUpdates = new Map<string, { beforeRevision: number, sheet: CharacterSheet }>()
  const trainerFor = (slug: string) => {
    let entry = trainerUpdates.get(slug)
    if (!entry) { const current = sheet<TrainerSheet>(repositories.sheets, 'trainer', slug); entry = { beforeRevision: current.revision, sheet: structuredClone(current.document) }; trainerUpdates.set(slug, entry) }
    return entry.sheet
  }
  const pokemonFor = (slug: string) => {
    let entry = pokemonUpdates.get(slug)
    if (!entry) { const current = sheet<CharacterSheet>(repositories.sheets, 'pokemon', slug); entry = { beforeRevision: current.revision, sheet: structuredClone(current.document) }; pokemonUpdates.set(slug, entry) }
    return entry.sheet
  }
  for (const entry of settlement.entries) {
    const contestant = before.contestants.find(row => row.contestantId === entry.contestantId)!
    const trainer = trainerFor(entry.trainerSheetSlug)
    const pokemonPerformers = contestant.performers.filter(contestPerformerIsPokemon)
    const result: TrainerContestResultRecordV1 = Object.freeze({ schemaVersion: 1, resultId: `${before.contestId}:result:${entry.contestantId}`, contestId: before.contestId, hallName: before.display.hallName, contestName: before.display.name, contestTypeId: before.contestTypeId, variantId: before.variantId, placement: entry.placement, score: entry.finalScore, pokemonSheetSlugs: Object.freeze(pokemonPerformers.map(row => row.pokemonSheetSlug)), ribbonAwarded: entry.ribbon, ribbonIds: Object.freeze(entry.ribbon ? pokemonPerformers.map(row => `${before.contestId}:ribbon:${row.pokemonSheetSlug}`) : []), completedAt: now })
    trainer.contestResults = [...(trainer.contestResults ?? []).filter(row => row.resultId !== result.resultId), result]
    for (const award of entry.experienceByPokemon) {
      const pokemon = pokemonFor(award.pokemonSheetSlug)
      const currentTotal = Number.isFinite(pokemon.totalExp) ? Number(pokemon.totalExp) : pokemonExperienceNeededForLevel(pokemon.level) ?? 0
      pokemon.totalExp = Math.max(0, currentTotal + award.experience)
      pokemon.level = Math.max(pokemon.level, calculatePokemonLevelFromExperience(pokemon.totalExp) ?? pokemon.level)
    }
    if (entry.ribbon) for (const performer of pokemonPerformers) {
      const pokemon = pokemonFor(performer.pokemonSheetSlug)
      const ribbon: ContestRibbonRecordV1 = Object.freeze({ schemaVersion: 1, ribbonId: `${before.contestId}:ribbon:${performer.pokemonSheetSlug}`, contestId: before.contestId, hallName: before.display.hallName, contestName: before.display.name, contestTypeId: before.contestTypeId, variantId: before.variantId, placement: 1, awardedAt: now, trainerSheetSlug: entry.trainerSheetSlug, pokemonSheetSlug: performer.pokemonSheetSlug })
      pokemon.contestRibbons = [...(pokemon.contestRibbons ?? []).filter(row => row.ribbonId !== ribbon.ribbonId), ribbon]
    }
  }
  const winningTrainer = trainerFor(winner.trainerSheetSlug)
  winningTrainer.money = Math.max(0, Math.floor(winningTrainer.money ?? 0)) + settlement.money
  settlement.items.forEach((item, index) => appendPrizeItem(trainerFor(item.targetTrainerSlug ?? winner.trainerSheetSlug), item.itemId, item.quantity, before.contestId, index))
  for (const [slug, update] of trainerUpdates) {
    const status = repositories.sheets.applyLivePlayUpdate({ kind: 'trainer', slug, expectedRevision: update.beforeRevision, nextSheet: update.sheet as unknown as Record<string, unknown>, sourceOperationId: settlementOperationId })
    if (status !== 'applied') fail(409, 'contest.settlement-failed', `Trainer sheet ${slug} changed during settlement; no rewards were committed.`)
  }
  for (const [slug, update] of pokemonUpdates) {
    const status = repositories.sheets.applyLivePlayUpdate({ kind: 'pokemon', slug, expectedRevision: update.beforeRevision, nextSheet: update.sheet as unknown as Record<string, unknown>, sourceOperationId: settlementOperationId })
    if (status !== 'applied') fail(409, 'contest.settlement-failed', `Pokémon sheet ${slug} changed during settlement; no rewards were committed.`)
  }
  return Object.freeze([
    ...[...trainerUpdates.keys()].map(slug => ({ kind: 'trainer' as const, slug, sheet: repositories.sheets.get('trainer', slug)!.document })),
    ...[...pokemonUpdates.keys()].map(slug => ({ kind: 'pokemon' as const, slug, sheet: repositories.sheets.get('pokemon', slug)!.document })),
  ])
}

const executeContestCommand = (value: unknown, actor: ContestActorV1, dependencies: ContestUseCaseDependencies = {}, serverOwnedBattleCommand = false): ExecuteContestCommandResultV1 => {
  let command: ContestCommandV1
  try { command = parseContestCommand(value) } catch (error) { return fail(400, 'contest.invalid-command', error instanceof Error ? error.message : 'Contest command is invalid.') }
  if ((command.commandKind === 'score-battle-accepted-move' || command.commandKind === 'apply-battle-voltage-lifecycle' || command.commandKind === 'end-battle-contest') && !serverOwnedBattleCommand) return fail(403, 'contest.server-owned-command', 'Battle handoffs are derived and delivered only by the server coordinator.')
  const repositories = runtime(dependencies)
  const existingOperation = repositories.contests.findOperation(command.operationId)
  if (existingOperation) {
    if (existingOperation.commandHash !== contestCommandHash(command)) fail(409, 'contest.operation-conflict', 'Operation ID was reused with changed input.')
    const current = repositories.contests.get(command.contestId)?.document ?? fail(404, 'contest.not-found', 'Contest was not found.')
    authorizeCommand(current, command, actor)
    if (command.commandKind === 'commit-settlement' && current.variantId === 'battle') {
      try {
        const coordination = current.settlement?.battleCoordination
        const encounterOperation = coordination
          ? createSqliteEncounterSettlementRepository(repositories.database).getOperation(coordination.encounterSettlementOperationId)
          : null
        assertBattleContestSettlementExactRetry({ document: current, contestOperationId: command.operationId, encounterOperation })
      }
      catch (error) {
        if (error instanceof BattleContestSettlementError) return fail(409, error.code, error.message)
        throw error
      }
    }
    const refreshed = refreshContestProviderSnapshots(current, repositories, dependencies.now?.() ?? Date.now(), false)
    return Object.freeze({ result: Object.freeze({ ...existingOperation.result, exactRetry: true }), projection: projectFor(refreshed, actor) })
  }
  const now = dependencies.now?.() ?? Date.now()
  let persistedEvents: readonly PersistedRealtimeEvent[] = []
  let encounterSettlementPersistedEvents: readonly PersistedRealtimeEvent[] = []
  let authoritativeSheetUpdates: AuthoritativeContestSheetUpdate[] = []
  let linkedEncounterRealtimeInputs: readonly AppendRealtimeEventInput[] = []
  let terminal!: ContestDocumentV1
  let terminalResult!: ContestOperationResultV1
  try {
    repositories.database.withTransaction(() => {
      if (repositories.contests.findOperation(command.operationId)) throw new ContestRepositoryError('operation-conflict', 'Operation raced; retry the exact command.')
      if (command.commandKind === 'create-contest') {
        authorizeCommand(null, command, actor)
        if (repositories.contests.get(command.contestId)) fail(409, 'contest.duplicate-id', 'Contest ID already exists.')
        terminal = createContestDocument({ ...command.settings, contestId: command.contestId, now })
        repositories.contests.insert(terminal)
      } else {
        const stored = repositories.contests.get(command.contestId) ?? fail(404, 'contest.not-found', 'Contest was not found.')
        authorizeCommand(stored.document, command, actor)
        if (stored.revision !== command.expectedRevision) fail(409, 'contest.revision-conflict', `Contest changed; expected revision ${command.expectedRevision}, current revision ${stored.revision}.`, { currentRevision: stored.revision })
        const authoritativeDocument = refreshContestProviderSnapshots(stored.document, repositories, now, true)
        const enrollment = command.commandKind === 'enroll-contestant' ? enrollmentContext(command, authoritativeDocument, repositories) : undefined
        const introduction = command.commandKind === 'declare-introduction' ? introductionContext(command, authoritativeDocument, repositories) : undefined
        const battleEncounter = command.commandKind === 'create-battle-encounter'
          ? (() => {
              const encounterId = `${authoritativeDocument.contestId}:battle-encounter`
              if (repositories.encounters.get(encounterId)) fail(409, 'contest.battle-encounter-conflict', 'The derived Battle Encounter identity already exists; no authority was changed.')
              const mapSlug = repositories.maps.allocateSlug(`${authoritativeDocument.display.name.slice(0, 72)} Battle`)
              return planBattleContestEncounter({
                contest: authoritativeDocument,
                operationId: command.operationId,
                encounterId,
                mapSlug,
                now,
                readSheet: (kind, slug) => {
                  const stored = repositories.sheets.get(kind, slug)
                  return stored ? { kind, slug: stored.slug, revision: stored.revision, updatedAt: stored.updatedAt, document: stored.document } : null
                },
              })
            })()
          : null
        const battleRecovery = authoritativeDocument.battle?.encounter && (command.commandKind === 'set-paused' || command.commandKind === 'apply-correction' || command.commandKind === 'cancel-contest')
          ? (() => {
              const binding = authoritativeDocument.battle!.encounter!
              const encounter = repositories.encounters.get(binding.link.encounterId) ?? fail(409, 'contest.battle-encounter-missing', 'The linked Encounter Document is unavailable; no recovery state changed.')
              const map = repositories.maps.getBySlug(binding.link.linkedMapSlug) ?? fail(409, 'contest.battle-map-missing', 'The linked Encounter map is unavailable; no recovery state changed.')
              return Object.freeze({ ...planBattleContestRecovery({ contest: authoritativeDocument, encounter, map, command, now }), encounterBefore: encounter, map })
            })()
          : null
        const battleMoveAppeal = command.commandKind === 'score-battle-accepted-move'
          ? (() => {
              const binding = authoritativeDocument.battle?.encounter ?? fail(409, 'contest.battle-encounter-required', 'Battle Appeal scoring requires the immutable linked Encounter authority.')
              const encounter = repositories.encounters.get(binding.link.encounterId) ?? fail(409, 'contest.battle-encounter-missing', 'The linked Encounter Document is unavailable; no Appeal was scored.')
              const map = repositories.maps.getBySlug(binding.link.linkedMapSlug) ?? fail(409, 'contest.battle-map-missing', 'The linked Encounter map is unavailable; no Appeal was scored.')
              const sourceOperation = repositories.livePlayOps.getStoredOpRecord(map.slug, command.sourceOperationId) ?? fail(409, 'contest.battle-source-missing', 'The accepted Encounter Move operation is unavailable; no Appeal was scored.')
              const delivery = deriveBattleContestAcceptedMoveDelivery({
                document: authoritativeDocument,
                encounterDocument: encounter,
                map,
                sourceOperation,
                sourceOperationId: command.sourceOperationId,
                sourceResolutionId: command.sourceResolutionId,
                contestOperationId: command.operationId,
              })
              const sceneId = map.activeScene ? encounterSceneId(map.slug, map.activeScene) : null
              if (!Number.isSafeInteger(map.revision)) fail(409, 'contest.battle-authority-stale', 'The linked map lacks current revision authority; no Appeal was scored.')
              const currentSceneId = sceneId ?? fail(409, 'contest.battle-authority-stale', 'The linked map lacks current Scene authority; no Appeal was scored.')
              assertBattleContestRevisionCoupling(delivery, binding.link, {
                contestId: authoritativeDocument.contestId,
                contestRevision: authoritativeDocument.revision,
                encounterId: encounter.encounterId,
                encounterDocumentRevision: encounter.revision,
                linkedMapSlug: map.slug,
                encounterRevision: Number(map.revision),
                encounterSceneId: currentSceneId,
              })
              if (delivery.fact.kind !== 'accepted-move') throw new Error('Accepted Move derivation returned a non-Move handoff.')
              const acceptedMovePayload = delivery.fact.payload
              const actorPlacement = map.placements.find(placement => placement.id === acceptedMovePayload.actorPlacementId)
              const actorTeam = actorPlacement?.sheetKind === 'pokemon'
                ? binding.teams.find(team => team.sideId === actorPlacement.sideId && team.pokemon.some(member => member.sheetSlug === actorPlacement.sheetSlug))
                : null
              if (acceptedMovePayload.sourceActionKind === 'pokemon-move' && !actorTeam) fail(409, 'contest.battle-actor-mismatch', 'Accepted Move actor is not a currently placed Pokémon on its immutable Battle team.')
              const opposingTeam = actorTeam ? binding.teams.find(team => team.sideId !== actorTeam.sideId) : null
              const adjacentPokemonSheetSlugs = opposingTeam
                ? map.placements.filter(placement => placement.sheetKind === 'pokemon'
                    && placement.sideId === opposingTeam.sideId
                    && opposingTeam.pokemon.some(member => member.sheetSlug === placement.sheetSlug))
                  .map(placement => placement.sheetSlug)
                : []
              const result = executeBattleContestAcceptedMoveAppeal({
                document: authoritativeDocument,
                delivery,
                actorPokemonSheetSlug: actorTeam && actorPlacement?.sheetKind === 'pokemon' ? actorPlacement.sheetSlug : null,
                adjacentPokemonSheetSlugs,
                spentDice: command.spentDice,
                now,
                random: repositories.random,
              })
              const accounting = assertBattleContestSingleSpendConvergence({
                before: authoritativeDocument,
                after: result.document,
                delivery,
                sourceOperation,
              })
              return Object.freeze({ result, accounting, delivery, encounter, map, sourceOperation })
            })()
          : null
        const battleVoltageLifecycle = command.commandKind === 'apply-battle-voltage-lifecycle'
          ? (() => {
              const binding = authoritativeDocument.battle?.encounter ?? fail(409, 'contest.battle-encounter-required', 'Battle Voltage lifecycle requires immutable linked Encounter authority.')
              const encounter = repositories.encounters.get(binding.link.encounterId) ?? fail(409, 'contest.battle-encounter-missing', 'The linked Encounter Document is unavailable; no Voltage changed.')
              const map = repositories.maps.getBySlug(binding.link.linkedMapSlug) ?? fail(409, 'contest.battle-map-missing', 'The linked Encounter map is unavailable; no Voltage changed.')
              const sourceOperation = repositories.livePlayOps.getStoredOpRecord(map.slug, command.sourceOperationId) ?? fail(409, 'contest.battle-source-missing', 'The accepted Encounter lifecycle operation is unavailable; no Voltage changed.')
              const derived = deriveBattleContestVoltageLifecycleDelivery({
                document: authoritativeDocument,
                encounterDocument: encounter,
                map,
                sourceOperation,
                sourceOperationId: command.sourceOperationId,
                sourceResultId: command.sourceResultId,
                contestOperationId: command.operationId,
              })
              const sceneId = map.activeScene ? encounterSceneId(map.slug, map.activeScene) : null
              if (!Number.isSafeInteger(map.revision)) fail(409, 'contest.battle-authority-stale', 'The linked map lacks current revision authority; no Voltage changed.')
              const currentSceneId = sceneId ?? fail(409, 'contest.battle-authority-stale', 'The linked map lacks current Scene authority; no Voltage changed.')
              assertBattleContestRevisionCoupling(derived.delivery, binding.link, {
                contestId: authoritativeDocument.contestId,
                contestRevision: authoritativeDocument.revision,
                encounterId: encounter.encounterId,
                encounterDocumentRevision: encounter.revision,
                linkedMapSlug: map.slug,
                encounterRevision: Number(map.revision),
                encounterSceneId: currentSceneId,
              })
              return Object.freeze({
                result: executeBattleContestVoltageLifecycle({
                  document: authoritativeDocument,
                  delivery: derived.delivery,
                  targetPokemonSheetSlug: derived.targetPokemonSheetSlug,
                  sourcePokemonSheetSlug: derived.sourcePokemonSheetSlug,
                  recalledPokemonSheetSlug: derived.recalledPokemonSheetSlug,
                  sentOutPokemonSheetSlug: derived.sentOutPokemonSheetSlug,
                  opposingActivePokemonSheetSlugs: derived.opposingActivePokemonSheetSlugs,
                  now,
                }),
                delivery: derived.delivery,
                encounter,
                map,
                sourceOperation,
              })
            })()
          : null
        const battleEnd = command.commandKind === 'end-battle-contest'
          ? (() => {
              const binding = authoritativeDocument.battle?.encounter ?? fail(409, 'contest.battle-encounter-required', 'Battle ending requires immutable linked Encounter authority.')
              const encounter = repositories.encounters.get(binding.link.encounterId) ?? fail(409, 'contest.battle-encounter-missing', 'The linked Encounter Document is unavailable; the Contest was not ended.')
              const map = repositories.maps.getBySlug(binding.link.linkedMapSlug) ?? fail(409, 'contest.battle-map-missing', 'The linked Encounter map is unavailable; the Contest was not ended.')
              const sourceOperation = repositories.livePlayOps.getStoredOpRecord(map.slug, command.sourceOperationId) ?? fail(409, 'contest.battle-source-missing', 'The accepted Encounter end source is unavailable; the Contest was not ended.')
              let encounterHistory
              try { encounterHistory = parseEncounterHistory(map.encounterState?.history) }
              catch { return fail(409, 'battle-contest.end-source-mismatch', 'The linked Encounter history is malformed; the Contest was not ended.') }
              const roundMatches = encounterHistory.roundBoundaries.filter(row => row.eventId === command.sourceResultId)
              const pokemonSheets = roundMatches.length > 0 ? [] : binding.teams.flatMap(team => team.pokemon.map(member => {
                const storedPokemon = repositories.sheets.get('pokemon', member.sheetSlug) ?? fail(409, 'contest.battle-roster-missing', `Battle roster Pokémon ${member.sheetSlug} is unavailable; the Contest was not ended.`)
                const currentHp = Number((storedPokemon.document as unknown as CharacterSheet).combat?.currentHp)
                if (!Number.isSafeInteger(currentHp)) fail(409, 'contest.battle-roster-invalid', `Battle roster Pokémon ${member.sheetSlug} lacks authoritative current HP; the Contest was not ended.`)
                return Object.freeze({ sheetSlug: member.sheetSlug, stored: storedPokemon, currentHp })
              }))
              const base = {
                document: authoritativeDocument,
                encounterDocument: encounter,
                map,
                sourceOperation,
                sourceOperationId: command.sourceOperationId,
                sourceResultId: command.sourceResultId,
                contestOperationId: command.operationId,
              }
              const delivery = roundMatches.length > 0
                ? deriveBattleContestRoundBudgetEndDelivery(base)
                : deriveBattleContestAllPokemonKnockedOutEndDelivery({ ...base, pokemonHitPointsBySheetSlug: Object.fromEntries(pokemonSheets.map(row => [row.sheetSlug, row.currentHp])) })
              const currentSceneId = (map.activeScene ? encounterSceneId(map.slug, map.activeScene) : null) ?? fail(409, 'contest.battle-authority-stale', 'The linked map lacks current Scene authority; the Contest was not ended.')
              if (!Number.isSafeInteger(map.revision)) fail(409, 'contest.battle-authority-stale', 'The linked map lacks current revision authority; the Contest was not ended.')
              assertBattleContestRevisionCoupling(delivery, binding.link, {
                contestId: authoritativeDocument.contestId,
                contestRevision: authoritativeDocument.revision,
                encounterId: encounter.encounterId,
                encounterDocumentRevision: encounter.revision,
                linkedMapSlug: map.slug,
                encounterRevision: Number(map.revision),
                encounterSceneId: currentSceneId,
              })
              return Object.freeze({
                result: executeBattleContestEnd({ document: authoritativeDocument, delivery, now, random: repositories.random }),
                delivery, encounter, map, sourceOperation, pokemonSheets,
              })
            })()
          : null
        const battleHandoff = battleMoveAppeal ?? battleVoltageLifecycle ?? battleEnd
        const battleSettlementCoordination = command.commandKind === 'commit-settlement' && authoritativeDocument.variantId === 'battle'
          ? (() => {
              const coordination = authoritativeDocument.settlement?.battleCoordination
                ?? fail(409, 'battle-contest.settlement-source-mismatch', 'Battle settlement has no prepared combined Encounter authority.')
              const encounterCommand = encounterSettlementCommandForBattleCoordination(coordination)
              let prepared
              try {
                prepared = rebuildPreparedFinishEncounter(
                  { role: 'gm', command: encounterCommand },
                  { database: repositories.database, coordinatedBattleContestId: authoritativeDocument.contestId },
                )
              }
              catch (error) {
                if (error instanceof PrepareFinishEncounterUseCaseError) return fail(409, 'battle-contest.settlement-source-mismatch', error.message)
                throw error
              }
              if (!prepared.plan || !prepared.authority) return fail(409, 'battle-contest.settlement-blocked', 'The linked Encounter settlement is no longer ready for the exact combined commit.')
              assertBattleContestRewardsUnapplied({
                document: authoritativeDocument,
                readSheet: (kind, slug) => (repositories.sheets.get(kind, slug)?.document as unknown as TrainerSheet | CharacterSheet | undefined) ?? null,
              })
              const encounterSettlementRepository = createSqliteEncounterSettlementRepository(repositories.database)
              const principalKey = `battle-contest:v1:${createHash('sha256').update(`${authoritativeDocument.contestId}\u0000${command.operationId}`).digest('hex')}`
              const applied = encounterSettlementRepository.applyAtomicCommit({
                principalKey,
                command: encounterCommand,
                plan: prepared.plan,
                reauthorize: () => {
                  const current = rebuildPreparedFinishEncounter(
                    { role: 'gm', command: encounterCommand },
                    { database: repositories.database, coordinatedBattleContestId: authoritativeDocument.contestId },
                  )
                  return current.authority ?? fail(409, 'battle-contest.settlement-source-mismatch', 'The linked Encounter authority changed before combined settlement commit.')
                },
                onWriteBoundary: dependencies.onBattleSettlementWriteBoundary,
              })
              if (applied.replayed) return fail(409, 'battle-contest.settlement-orphaned', 'Encounter settlement was already accepted without the matching Contest settlement operation.')
              encounterSettlementPersistedEvents = applied.persistedRealtimeEvents
              const contestUpdates = applySettlementWrites(authoritativeDocument, command.operationId, repositories, now)
              authoritativeSheetUpdates.push(...contestUpdates)
              dependencies.onBattleSettlementWriteBoundary?.('after-contest-reward-writes')
              const contestSheetWrites = contestUpdates.map((update) => {
                const storedSheet = repositories.sheets.get(update.kind, update.slug)
                  ?? fail(409, 'battle-contest.settlement-source-mismatch', `Settlement sheet ${update.slug} disappeared after its Contest reward write.`)
                return Object.freeze({
                  kind: update.kind,
                  slug: update.slug,
                  revision: storedSheet.revision,
                  definitionSha256: encounterSettlementAtomicDefinitionSha256(storedSheet.document),
                })
              })
              return completeBattleContestSettlementCoordination({
                document: authoritativeDocument,
                acceptedByContestOperationId: command.operationId,
                encounterPlan: prepared.plan,
                encounterResult: applied.result,
                contestSheetWrites,
              })
            })()
          : null
        if (command.commandKind === 'apply-correction') assertReplacementController(command, authoritativeDocument, repositories)
        terminal = battleHandoff?.result.document ?? executeContestEngineCommand(authoritativeDocument, command, {
          now,
          random: repositories.random,
          enrollment,
          introduction,
          ...(battleEncounter ? { battleEncounter: battleEncounter.binding } : {}),
          ...(battleRecovery ? { battleRecovery: battleRecovery.receipt } : {}),
          ...(battleSettlementCoordination ? { battleSettlementCoordination } : {}),
        })
        if (command.commandKind === 'prepare-settlement' && terminal.variantId === 'battle') {
          const binding = terminal.battle?.encounter
            ?? fail(409, 'battle-contest.settlement-source-mismatch', 'Battle settlement preparation requires the immutable linked Encounter authority.')
          let prepared
          try {
            prepared = prepareFinishEncounter(
              { role: 'gm', encounterId: binding.link.encounterId, now },
              { database: repositories.database, coordinatedBattleContestId: terminal.contestId },
            )
          }
          catch (error) {
            if (error instanceof PrepareFinishEncounterUseCaseError) return fail(409, 'battle-contest.settlement-blocked', error.message)
            throw error
          }
          const encounterCommand = prepared.view.command
          if (!prepared.plan || !prepared.authority || !encounterCommand) return fail(409, 'battle-contest.settlement-blocked', 'Resolve every linked Encounter settlement gate before preparing the combined Battle settlement.')
          const coordination = planBattleContestSettlementCoordination({
            document: terminal,
            preparedByContestOperationId: command.operationId,
            encounterCommand,
            encounterPlan: prepared.plan,
          })
          terminal = parseContestDocument({
            ...terminal,
            settlement: { ...terminal.settlement!, battleCoordination: coordination },
          })
        }
        if (battleHandoff) {
          const rereadEncounter = repositories.encounters.get(battleHandoff.encounter.encounterId) ?? fail(409, 'contest.battle-authority-stale', 'Encounter authority disappeared during handoff; no Contest consequence was applied.')
          const rereadMap = repositories.maps.getBySlug(battleHandoff.map.slug) ?? fail(409, 'contest.battle-authority-stale', 'Encounter map authority disappeared during handoff; no Contest consequence was applied.')
          const rereadSource = repositories.livePlayOps.getStoredOpRecord(battleHandoff.map.slug, battleHandoff.sourceOperation.opId) ?? fail(409, 'contest.battle-authority-stale', 'Encounter operation authority disappeared during handoff; no Contest consequence was applied.')
          const sceneId = (rereadMap.activeScene ? encounterSceneId(rereadMap.slug, rereadMap.activeScene) : null) ?? fail(409, 'contest.battle-authority-stale', 'Encounter Scene authority disappeared during handoff; no Contest consequence was applied.')
          if (persistableCanonicalJson(rereadEncounter) !== persistableCanonicalJson(battleHandoff.encounter)
            || persistableCanonicalJson(rereadMap) !== persistableCanonicalJson(battleHandoff.map)
            || persistableCanonicalJson(rereadSource) !== persistableCanonicalJson(battleHandoff.sourceOperation)) fail(409, 'contest.battle-authority-stale', 'Encounter authority changed during handoff; no Contest consequence was applied.')
          if ('pokemonSheets' in battleHandoff && battleHandoff.pokemonSheets.some(snapshot => {
            const reread = repositories.sheets.get('pokemon', snapshot.sheetSlug)
            return !reread || persistableCanonicalJson(reread) !== persistableCanonicalJson(snapshot.stored)
          })) fail(409, 'contest.battle-authority-stale', 'Battle roster HP authority changed during handoff; the Contest was not ended.')
          assertBattleContestRevisionCoupling(battleHandoff.delivery, terminal.battle!.encounter!.link, {
            contestId: authoritativeDocument.contestId,
            contestRevision: authoritativeDocument.revision,
            encounterId: rereadEncounter.encounterId,
            encounterDocumentRevision: rereadEncounter.revision,
            linkedMapSlug: rereadMap.slug,
            encounterRevision: Number(rereadMap.revision),
            encounterSceneId: sceneId,
          })
        }
        if (battleRecovery) {
          const currentEncounter = repositories.encounters.get(battleRecovery.encounterBefore.encounterId) ?? fail(409, 'contest.battle-encounter-missing', 'The linked Encounter Document disappeared before recovery commit.')
          const currentMap = repositories.maps.getBySlug(battleRecovery.map.slug) ?? fail(409, 'contest.battle-map-missing', 'The linked Encounter map disappeared before recovery commit.')
          assertBattleContestRecoveryAuthority({ contest: authoritativeDocument, encounter: currentEncounter, map: currentMap, receipt: battleRecovery.receipt })
          const savedEncounter = repositories.encounters.replace({ expectedRevision: currentEncounter.revision, document: battleRecovery.encounterDocument })
            ?? fail(409, 'contest.battle-encounter-missing', 'The linked Encounter Document disappeared before recovery commit.')
          if (persistableCanonicalJson(savedEncounter.battleRecoveryReceipts) !== persistableCanonicalJson(terminal.battleRecoveryReceipts)) throw new Error('Battle recovery commit did not retain matching receipts in both linked documents.')
          linkedEncounterRealtimeInputs = encounterDocumentRealtimeAppendInputs({ document: savedEncounter, kind: 'updated', previousRevision: currentEncounter.revision, operationId: command.operationId, timestamp: now })
        }
        const resourcePlan = command.commandKind === 'use-intervention' ? contestInterventionResourcePlan(command, authoritativeDocument, repositories, now) : null
        if (resourcePlan) {
          const status = repositories.sheets.applyLivePlayUpdate({ kind: resourcePlan.kind, slug: resourcePlan.slug, expectedRevision: resourcePlan.expectedRevision, nextSheet: resourcePlan.sheet as unknown as Record<string, unknown>, sourceOperationId: command.operationId })
          if (status !== 'applied') fail(409, 'contest.revision-conflict', 'Trainer Feature resources changed during the Contest intervention.')
          authoritativeSheetUpdates = [{ kind: resourcePlan.kind, slug: resourcePlan.slug, sheet: repositories.sheets.get(resourcePlan.kind, resourcePlan.slug)!.document }]
        }
        if (command.commandKind === 'commit-settlement' && authoritativeDocument.variantId !== 'battle') authoritativeSheetUpdates.push(...applySettlementWrites(stored.document, command.operationId, repositories, now))
        if (battleEncounter) {
          try {
            if (battleEncounter.sceneLifecycle.sheetReads.length > 0) repositories.sheets.assertRevisions(battleEncounter.sceneLifecycle.sheetReads)
          } catch (error) {
            if (error instanceof SheetRevisionConflictError) fail(409, 'contest.battle-encounter-roster-stale', 'A roster sheet changed during Battle Encounter creation; no authority was changed.')
            throw error
          }
          for (const write of battleEncounter.sceneLifecycle.sheetWrites) {
            const status = repositories.sheets.applyLivePlayUpdate({
              kind: write.kind,
              slug: write.slug,
              expectedRevision: write.expectedRevision,
              nextSheet: {
                ...toPersistableSheetPayload(write.nextSheet as unknown as Record<string, unknown>),
                slug: write.slug,
                updatedAt: now,
              },
              sourceOperationId: command.operationId,
            })
            if (status !== 'applied') fail(409, 'contest.battle-encounter-roster-stale', `The ${write.kind} sheet ${write.slug} changed during Scene start; no authority was changed.`)
            const acceptedSheet = repositories.sheets.get(write.kind, write.slug) ?? fail(404, 'contest.sheet-not-found', `${write.kind} sheet ${write.slug} disappeared during Battle Encounter creation.`)
            authoritativeSheetUpdates.push({ kind: write.kind, slug: write.slug, sheet: acceptedSheet.document })
          }
          const createdMap = repositories.maps.create({ slug: battleEncounter.map.slug, map: battleEncounter.map, now })
          const createdMode = repositories.mapModes.set({ slug: createdMap.slug, interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY, updatedAt: now })
          const createdEncounter = repositories.encounters.create(battleEncounter.encounter)
          const rereadMap = repositories.maps.getBySlug(createdMap.slug)
          const rereadEncounter = repositories.encounters.get(createdEncounter.encounterId)
          const acceptedBinding = terminal.battle?.encounter ?? null
          const rereadMode = repositories.mapModes.get(createdMap.slug)
          if (!rereadMap || !rereadEncounter || !acceptedBinding
            || rereadMap.revision !== 0
            || rereadEncounter.revision !== 0
            || persistableCanonicalJson(rereadEncounter) !== persistableCanonicalJson(battleEncounter.encounter)
            || persistableCanonicalJson(rereadEncounter.battleContest) !== persistableCanonicalJson(acceptedBinding)
            || rereadEncounter.encounterId !== acceptedBinding.link.encounterId
            || rereadEncounter.linkedMapSlug !== acceptedBinding.link.linkedMapSlug
            || rereadMap.slug !== acceptedBinding.link.linkedMapSlug
            || rereadMap.playerVisible !== true
            || rereadMap.folder !== battleEncounter.map.folder
            || persistableCanonicalJson(rereadMap.placements) !== persistableCanonicalJson(battleEncounter.map.placements)
            || persistableCanonicalJson(rereadMap.encounterState?.sides ?? {}) !== persistableCanonicalJson(battleEncounter.map.encounterState?.sides ?? {})
            || rereadMap.initiative?.activeId !== acceptedBinding.openingActivePlacementId
            || rereadMap.initiative?.round !== acceptedBinding.openingRound
            || !rereadMap.activeScene
            || encounterSceneId(rereadMap.slug, rereadMap.activeScene) !== acceptedBinding.sceneId
            || rereadMode.interactionMode !== MAP_INTERACTION_MODES.LIVE_PLAY
            || rereadMode.updatedAt !== now) {
            throw new Error('Battle Contest link commit did not re-read the exact created Encounter authorities.')
          }
          linkedEncounterRealtimeInputs = [
            ...mapLibraryCreatedRealtimeAppendInputs(rereadMap, command.clientId),
            ...interactionModeRealtimeAppendInputs({ ...createdMode, clientId: command.clientId }),
            ...encounterDocumentRealtimeAppendInputs({ document: rereadEncounter, kind: 'created', previousRevision: null, operationId: command.operationId, timestamp: now }),
          ]
        }
        repositories.contests.replace(stored.revision, terminal)
        if (command.commandKind === 'commit-settlement' && terminal.variantId === 'battle') dependencies.onBattleSettlementWriteBoundary?.('after-contest-document-write')
      }
      terminalResult = resultFor(terminal, command, (command.commandKind === 'score-battle-accepted-move' || command.commandKind === 'apply-battle-voltage-lifecycle' || command.commandKind === 'end-battle-contest') && terminal.revision === command.expectedRevision)
      repositories.contests.recordOperation(command, terminalResult, now)
      if (command.commandKind === 'commit-settlement' && terminal.variantId === 'battle') dependencies.onBattleSettlementWriteBoundary?.('after-contest-operation-write')
      const contestEvents = contestRealtimeAppendInputs({ document: terminal, commandKind: command.commandKind, operationId: command.operationId, clientId: command.clientId, timestamp: now })
      const sheetUpdates = deduplicateAuthoritativeSheetDocumentUpdates(authoritativeSheetUpdates)
      const contestPersistedEvents = repositories.realtime.appendMany([
        ...linkedEncounterRealtimeInputs,
        ...contestEvents,
        ...sheetUpdates.map(update => sheetDocumentUpdatedRealtimeAppendInput({ update, destination: 'specific', dedupeKey: `${command.operationId}:${update.kind}:${update.slug}` })),
      ])
      persistedEvents = Object.freeze([...encounterSettlementPersistedEvents, ...contestPersistedEvents])
    })
  } catch (error) {
    if (error instanceof ContestUseCaseError) throw error
    if (error instanceof ContestContractError) throw new ContestUseCaseError(400, error.code, error.message, { field: error.field })
    if (error instanceof ContestRuleError) throw new ContestUseCaseError(error.statusCode, error.issue.code, error.message, error.issue)
    if (error instanceof ContestRepositoryError) throw new ContestUseCaseError(error.code === 'not-found' ? 404 : 409, `contest.${error.code}`, error.message, { currentRevision: error.currentRevision })
    if (error instanceof BattleContestEncounterPlanningError) throw new ContestUseCaseError(error.statusCode, error.code, error.message)
    if (error instanceof BattleAcceptedMoveDerivationError || error instanceof BattleContestAppealError || error instanceof BattleContestLifecycleDerivationError || error instanceof BattleContestVoltageLifecycleError || error instanceof BattleContestEndError || error instanceof BattleContestAccountingError || error instanceof BattleContestBlendContractError || error instanceof BattleContestRecoveryError || error instanceof BattleContestSettlementError) throw new ContestUseCaseError(409, error.code, error.message)
    if (error instanceof EncounterSettlementRepositoryError) throw new ContestUseCaseError(409, `battle-contest.settlement-${error.code}`, error.message)
    if (error instanceof PrepareFinishEncounterUseCaseError) throw new ContestUseCaseError(409, 'battle-contest.settlement-blocked', error.message)
    throw error
  }
  publishPersistedRealtimeEventsAfterCommit({ events: persistedEvents, operation: command.commandKind, publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedRealtimeEventPublisher, reportFailure: dependencies.reportAfterCommitPublicationFailure ?? defaultPersistedRealtimePublicationFailureReporter })
  return Object.freeze({ result: terminalResult, projection: projectFor(terminal, actor) })
}

/** Public command ingress. All server-derived Battle handoffs are deliberately rejected here. */
export const executeContestCommandUseCase = (value: unknown, actor: ContestActorV1, dependencies: ContestUseCaseDependencies = {}): ExecuteContestCommandResultV1 => executeContestCommand(value, actor, dependencies, false)

export interface ScoreBattleContestAcceptedMoveInputV1 {
  readonly contestId: string
  readonly expectedRevision: number
  readonly sourceOperationId: string
  readonly sourceResolutionId: string
  readonly spentDice: Readonly<Record<ContestStatId, number>>
  readonly clientId?: string | null
}

/**
 * Server-only blend coordinator ingress. It accepts source identities, never
 * client-authored Move/result/roll/hit/Scene/round/actor/target mechanics.
 */
export const scoreBattleContestAcceptedMoveUseCase = (
  input: ScoreBattleContestAcceptedMoveInputV1,
  dependencies: ContestUseCaseDependencies = {},
): ExecuteContestCommandResultV1 => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail(400, 'contest.invalid-handoff-request', 'Battle Move scoring input must be one server-owned object.')
  const allowed = new Set(['contestId','expectedRevision','sourceOperationId','sourceResolutionId','spentDice','clientId'])
  if (Object.keys(input).some(field => !allowed.has(field))) return fail(400, 'contest.invalid-handoff-request', 'Battle Move scoring accepts no client-authored result, roll, actor, target, Scene, round, map, or mechanics fields.')
  const operationDigest = createHash('sha256')
    .update(`${input.contestId}\n${input.sourceOperationId}\n${input.sourceResolutionId}`)
    .digest('hex')
    .slice(0, 40)
  return executeContestCommand({
    schemaVersion: 1,
    commandKind: 'score-battle-accepted-move',
    contestId: input.contestId,
    operationId: `contest-op:v1:battle-move-${operationDigest}`,
    expectedRevision: input.expectedRevision,
    clientId: input.clientId ?? null,
    sourceOperationId: input.sourceOperationId,
    sourceResolutionId: input.sourceResolutionId,
    spentDice: input.spentDice,
  }, { role: 'gm' }, dependencies, true)
}

export interface ApplyBattleContestVoltageLifecycleInputV1 {
  readonly contestId: string
  readonly expectedRevision: number
  readonly sourceOperationId: string
  readonly sourceResultId: string
  readonly clientId?: string | null
}

/**
 * Server-only lifecycle coordinator ingress. Callers identify an accepted root
 * operation and typed history event; cause, Pokémon, round, recipient, delta,
 * and recall exception are reconstructed from persisted Encounter authority.
 */
export const applyBattleContestVoltageLifecycleUseCase = (
  input: ApplyBattleContestVoltageLifecycleInputV1,
  dependencies: ContestUseCaseDependencies = {},
): ExecuteContestCommandResultV1 => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail(400, 'contest.invalid-handoff-request', 'Battle lifecycle input must be one server-owned object.')
  const allowed = new Set(['contestId','expectedRevision','sourceOperationId','sourceResultId','clientId'])
  if (Object.keys(input).some(field => !allowed.has(field))) return fail(400, 'contest.invalid-handoff-request', 'Battle lifecycle scoring accepts no client-authored cause, Pokémon, recipient, delta, exception, Scene, round, map, or mechanics fields.')
  const operationDigest = createHash('sha256')
    .update(`${input.contestId}\n${input.sourceOperationId}\n${input.sourceResultId}`)
    .digest('hex').slice(0, 40)
  return executeContestCommand({
    schemaVersion: 1,
    commandKind: 'apply-battle-voltage-lifecycle',
    contestId: input.contestId,
    operationId: `contest-op:v1:battle-lifecycle-${operationDigest}`,
    expectedRevision: input.expectedRevision,
    clientId: input.clientId ?? null,
    sourceOperationId: input.sourceOperationId,
    sourceResultId: input.sourceResultId,
  }, { role: 'gm' }, dependencies, true)
}

export interface EndBattleContestInputV1 {
  readonly contestId: string
  readonly expectedRevision: number
  readonly sourceOperationId: string
  readonly sourceResultId: string
  readonly clientId?: string | null
}

/**
 * Server-only Battle ending ingress. The source identity is resolved against
 * persisted round-boundary or final-knockout authority; clients cannot choose
 * the end condition, round, scores, placements, or winner.
 */
export const endBattleContestUseCase = (
  input: EndBattleContestInputV1,
  dependencies: ContestUseCaseDependencies = {},
): ExecuteContestCommandResultV1 => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail(400, 'contest.invalid-handoff-request', 'Battle ending input must be one server-owned object.')
  const allowed = new Set(['contestId','expectedRevision','sourceOperationId','sourceResultId','clientId'])
  if (Object.keys(input).some(field => !allowed.has(field))) return fail(400, 'contest.invalid-handoff-request', 'Battle ending accepts no client-authored condition, round, score, placement, winner, HP, Scene, map, or mechanics fields.')
  const operationDigest = createHash('sha256')
    .update(`${input.contestId}\n${input.sourceOperationId}\n${input.sourceResultId}`)
    .digest('hex').slice(0, 40)
  return executeContestCommand({
    schemaVersion: 1,
    commandKind: 'end-battle-contest',
    contestId: input.contestId,
    operationId: `contest-op:v1:battle-end-${operationDigest}`,
    expectedRevision: input.expectedRevision,
    clientId: input.clientId ?? null,
    sourceOperationId: input.sourceOperationId,
    sourceResultId: input.sourceResultId,
  }, { role: 'gm' }, dependencies, true)
}

export const loadContestUseCase = (contestId: string, actor: ContestActorV1, dependencies: ContestUseCaseDependencies = {}): ContestRoleProjectionV1 => {
  const repositories = runtime(dependencies)
  const stored = repositories.contests.get(contestId) ?? fail(404, 'contest.not-found', 'Contest was not found.')
  return projectFor(refreshContestProviderSnapshots(stored.document, repositories, dependencies.now?.() ?? Date.now(), false), actor)
}
export const listContestsUseCase = (actor: ContestActorV1, dependencies: ContestUseCaseDependencies = {}): readonly ContestRoleProjectionV1[] => {
  const repositories = runtime(dependencies), now = dependencies.now?.() ?? Date.now()
  return repositories.contests.list({ includeTerminal: true, limit: 100 }).map(row => projectFor(refreshContestProviderSnapshots(row.document, repositories, now, false), actor))
}
