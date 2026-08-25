import type { AuthRole } from '#shared/auth'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { PlayerProfile } from '#shared/playerProfiles'
import { CONTEST_STAT_IDS, type ContestStatId } from '#shared/contests/ids'
import type { ContestDocumentV1, ContestantStateV1 } from '#shared/contests/document'
import { contestPerformerIsPokemon } from '#shared/contests/document'
import { projectContestPublic } from '#shared/contests/projections'
import {
  BATTLE_CONTEST_LIVEPLAY_SCHEMA_VERSION,
  type BattleContestLiveplayAppealDecisionV1,
  type BattleContestLiveplayCommandV1,
  type BattleContestLiveplayPoolV1,
  type BattleContestLiveplayProjectionV1,
  type BattleContestLiveplayResponseV1,
  type BattleContestLiveplaySpendV1,
} from '#shared/contests/battleLiveplay'
import type { EncounterDocument } from '#shared/encounterDocuments/model'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqliteContestRepository, type ContestRepository } from '../storage/contestRepository'
import { createSqliteEncounterDocumentRepository, type EncounterDocumentRepository } from '../storage/encounterDocumentRepository'
import { createSqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import { createSqliteLivePlayOpRepository, type LivePlayOpRepository, type SqliteLivePlayOpRecord } from '../storage/opRepository'
import { createSqliteSheetRepository, type SheetRepository } from '../storage/sheetRepository'
import { deriveBattleContestAcceptedMoveDelivery } from '../domain/contests/battleAcceptedMove'
import { findNextBattleContestLiveplayHandoff, type BattleContestLiveplayHandoffV1 } from '../domain/contests/battleLiveplay'
import {
  applyBattleContestVoltageLifecycleUseCase,
  ContestUseCaseError,
  endBattleContestUseCase,
  scoreBattleContestAcceptedMoveUseCase,
  type ContestActorV1,
  type ContestUseCaseDependencies,
} from './contests'

export interface BattleContestLiveplayDependencies {
  readonly database?: RotomDatabase
  readonly contests?: ContestRepository
  readonly encounters?: EncounterDocumentRepository
  readonly maps?: MapRepository<TabletopMap>
  readonly sheets?: SheetRepository<Record<string, unknown>>
  readonly livePlayOps?: Pick<LivePlayOpRepository, 'getStoredOpRecord' | 'listStoredOpsForMap'> & { readonly database?: RotomDatabase }
  readonly contestUseCases?: ContestUseCaseDependencies
}

interface LiveplayAuthority {
  readonly document: ContestDocumentV1
  readonly encounter: EncounterDocument
  readonly map: TabletopMap
  readonly sourceOperations: readonly SqliteLivePlayOpRecord[]
  readonly hitPoints: Readonly<Record<string, number>>
  readonly next: BattleContestLiveplayHandoffV1 | null
}

interface Runtime {
  readonly database: RotomDatabase
  readonly contests: ContestRepository
  readonly encounters: EncounterDocumentRepository
  readonly maps: MapRepository<TabletopMap>
  readonly sheets: SheetRepository<Record<string, unknown>>
  readonly livePlayOps: Pick<LivePlayOpRepository, 'getStoredOpRecord' | 'listStoredOpsForMap'> & { readonly database?: RotomDatabase }
  readonly contestDependencies: ContestUseCaseDependencies
}

const error = (statusCode: 400 | 403 | 404 | 409, code: string, message: string): never => {
  throw new ContestUseCaseError(statusCode, code, message)
}

const runtime = (dependencies: BattleContestLiveplayDependencies): Runtime => {
  const database = dependencies.database
    ?? dependencies.contests?.database
    ?? dependencies.encounters?.database
    ?? dependencies.maps?.database
    ?? dependencies.sheets?.database
    ?? dependencies.livePlayOps?.database
    ?? getRotomDatabase()
  const contests = dependencies.contests ?? createSqliteContestRepository(database)
  const encounters = dependencies.encounters ?? createSqliteEncounterDocumentRepository(database)
  const maps = dependencies.maps ?? createSqliteMapRepository<TabletopMap>(database)
  const sheets = dependencies.sheets ?? createSqliteSheetRepository<Record<string, unknown>>(database)
  const livePlayOps = dependencies.livePlayOps ?? createSqliteLivePlayOpRepository({ database })
  for (const candidate of [contests.database, encounters.database, maps.database, sheets.database, dependencies.livePlayOps?.database]) {
    if (candidate && candidate !== database) throw new Error('Battle Contest liveplay repositories must share one database.')
  }
  return {
    database,
    contests,
    encounters,
    maps,
    sheets,
    livePlayOps,
    contestDependencies: {
      ...dependencies.contestUseCases,
      database,
      contests,
      encounters,
      maps,
      sheets,
      livePlayOps,
    },
  }
}

const resolveEncounter = (repositories: Runtime, encounterId: string): EncounterDocument | null => (
  repositories.encounters.get(encounterId) ?? repositories.encounters.findByMapSlug(encounterId)
)

const hitPointsFor = (
  document: ContestDocumentV1,
  sheets: SheetRepository<Record<string, unknown>>,
): Readonly<Record<string, number>> => Object.freeze(Object.fromEntries((document.battle?.encounter?.teams ?? []).flatMap(team => (
  team.pokemon.map(member => {
    const stored = sheets.get('pokemon', member.sheetSlug)
      ?? error(409, 'battle-contest.liveplay-roster-missing', `Battle roster Pokémon ${member.sheetSlug} is unavailable.`)
    const currentHp = Number((stored.document as unknown as CharacterSheet).combat?.currentHp)
    if (!Number.isSafeInteger(currentHp)) {
      return error(409, 'battle-contest.liveplay-roster-invalid', `Battle roster Pokémon ${member.sheetSlug} lacks authoritative current HP.`)
    }
    return [member.sheetSlug, currentHp] as const
  })
))))

const loadAuthority = (repositories: Runtime, encounterId: string): LiveplayAuthority | null => {
  const encounter = resolveEncounter(repositories, encounterId)
    ?? error(404, 'encounter.not-found', 'Encounter was not found.')
  const contestId = encounter.battleContest?.link.contestId
  if (!contestId) return null
  const storedContest = repositories.contests.get(contestId)
    ?? error(409, 'battle-contest.liveplay-contest-missing', 'The linked Battle Contest is unavailable.')
  const document = storedContest.document
  const binding = document.battle?.encounter
  if (document.variantId !== 'battle' || !binding
    || binding.link.encounterId !== encounter.encounterId
    || encounter.battleContest?.link.linkId !== binding.link.linkId) {
    return error(409, 'battle-contest.liveplay-link-stale', 'Encounter and Battle Contest linkage is stale.')
  }
  const storedMap = repositories.maps.get(binding.link.linkedMapSlug)
    ?? error(409, 'battle-contest.liveplay-map-missing', 'The linked Encounter map is unavailable.')
  const map = storedMap.document
  const sourceOperations = repositories.livePlayOps.listStoredOpsForMap(map.slug, 10_000)
  const hitPoints = hitPointsFor(document, repositories.sheets)
  return Object.freeze({
    document,
    encounter,
    map,
    sourceOperations,
    hitPoints,
    next: findNextBattleContestLiveplayHandoff({
      document,
      encounterDocument: encounter,
      map,
      sourceOperations,
      pokemonHitPointsBySheetSlug: hitPoints,
    }),
  })
}

const audienceFor = (document: ContestDocumentV1, actor: ContestActorV1): 'gm' | 'owner' | 'public' => {
  if (actor.role === 'gm') return 'gm'
  const profileId = actor.playerProfile?.id
  return profileId && document.contestants.some(contestant => (
    contestant.controller.kind === 'profile' && contestant.controller.profileId === profileId
  )) ? 'owner' : 'public'
}

const controlledContestant = (document: ContestDocumentV1, actor: ContestActorV1): ContestantStateV1 | null => {
  if (!actor.playerProfile) return null
  const matches = document.contestants.filter(contestant => (
    contestant.controller.kind === 'profile' && contestant.controller.profileId === actor.playerProfile!.id
  ))
  return matches.length === 1 ? matches[0]! : null
}

const sanitizedPool = (contestant: ContestantStateV1): BattleContestLiveplayPoolV1 => Object.freeze({
  contestantId: contestant.contestantId,
  displayName: contestant.displayName,
  remaining: Object.freeze(Object.fromEntries(CONTEST_STAT_IDS.map(statId => [statId, contestant.teamDicePools[statId].remaining])) as Record<ContestStatId, number>),
})

interface PendingContext {
  readonly decision: BattleContestLiveplayAppealDecisionV1
  readonly contestant: ContestantStateV1
  readonly requiresChoice: boolean
}

const pendingContext = (
  authority: LiveplayAuthority,
  actor: ContestActorV1,
): PendingContext | null => {
  const next = authority.next
  if (!next || next.kind !== 'accepted-move') return null
  const sourceOperation = authority.sourceOperations.find(operation => operation.opId === next.sourceOperationId)
    ?? error(409, 'battle-contest.liveplay-source-missing', 'Accepted Move source authority is unavailable.')
  const delivery = deriveBattleContestAcceptedMoveDelivery({
    document: authority.document,
    encounterDocument: authority.encounter,
    map: authority.map,
    sourceOperation,
    sourceOperationId: next.sourceOperationId,
    sourceResolutionId: next.sourceResolutionId,
    contestOperationId: 'contest-op:v1:battle-liveplay-preview',
  })
  if (delivery.fact.kind !== 'accepted-move') throw new Error('Battle liveplay Move delivery has the wrong fact kind.')
  const payload = delivery.fact.payload
  const round = payload.round
    ?? error(409, 'battle-contest.liveplay-round-missing', 'Accepted Move lacks authoritative Encounter round identity.')
  const placement = authority.map.placements.find(candidate => candidate.id === payload.actorPlacementId)
    ?? error(409, 'battle-contest.liveplay-actor-missing', 'Accepted Move actor is absent from current Encounter authority.')
  if (placement.sheetKind !== 'pokemon') {
    return error(409, 'battle-contest.liveplay-actor-invalid', 'Accepted Move actor is not an enrolled Pokémon.')
  }
  const bindingTeam = authority.document.battle!.encounter!.teams.find(team => (
    team.pokemon.some(member => member.sheetSlug === placement.sheetSlug)
  )) ?? error(409, 'battle-contest.liveplay-actor-unenrolled', 'Accepted Move actor is absent from the immutable Battle roster.')
  const contestant = authority.document.contestants.find(candidate => candidate.contestantId === bindingTeam.contestantId)
    ?? error(409, 'battle-contest.liveplay-team-missing', 'Accepted Move team is absent from Contest authority.')
  const performer = contestant.performers.find(candidate => (
    contestPerformerIsPokemon(candidate) && candidate.pokemonSheetSlug === placement.sheetSlug
  ))
  if (!performer || !contestPerformerIsPokemon(performer)) {
    return error(409, 'battle-contest.liveplay-performer-missing', 'Accepted Move performer is absent from Contest authority.')
  }
  const remaining = CONTEST_STAT_IDS.reduce((sum, statId) => sum + contestant.teamDicePools[statId].remaining, 0)
  const requiresChoice = payload.sourceActionKind === 'pokemon-move' && remaining > 0
  const ownsDecision = actor.role === 'gm' || (
    contestant.controller.kind === 'profile'
    && contestant.controller.profileId === actor.playerProfile?.id
  )
  return Object.freeze({
    contestant,
    requiresChoice,
    decision: Object.freeze({
      kind: 'score-accepted-move',
      contestantId: contestant.contestantId,
      contestantDisplayName: contestant.displayName,
      pokemonDisplayName: performer.displayName,
      moveName: payload.canonicalMoveId,
      round,
      maximumSpend: 3,
      canResolve: requiresChoice && ownsDecision,
      waitingForDisplayName: contestant.displayName,
    }),
  })
}

const project = (
  authority: LiveplayAuthority,
  actor: ContestActorV1,
  exactRetry: boolean,
): BattleContestLiveplayProjectionV1 => {
  const document = authority.document
  const publicProjection = projectContestPublic(document)
  const audience = audienceFor(document, actor)
  const controlled = controlledContestant(document, actor)
  const pending = pendingContext(authority, actor)
  const visibleTeamPools = audience === 'gm'
    ? document.contestants.map(sanitizedPool)
    : audience === 'owner' && controlled ? [sanitizedPool(controlled)] : []
  const synchronizing = authority.next !== null && !(pending?.requiresChoice)
  return Object.freeze({
    schemaVersion: BATTLE_CONTEST_LIVEPLAY_SCHEMA_VERSION,
    audience,
    contestId: document.contestId,
    revision: document.revision,
    updatedAt: document.updatedAt,
    title: document.display.name,
    contestTypeId: document.contestTypeId ?? error(409, 'battle-contest.liveplay-type-missing', 'Battle Contest type authority is unavailable.'),
    stage: document.stage,
    paused: document.paused,
    round: document.round,
    roundBudget: document.battle?.roundBudget ?? error(409, 'battle-contest.liveplay-budget-missing', 'Battle Contest round budget is unavailable.'),
    scores: Object.freeze(publicProjection.scoreboard.map(row => Object.freeze({
      contestantId: row.contestantId,
      displayName: row.displayName,
      appeal: row.appeal,
      finalScore: row.finalScore,
      placement: row.placement,
      active: row.active,
      performers: Object.freeze(row.performers.filter(performer => performer.performerKind === 'pokemon').map(performer => Object.freeze({
        displayName: performer.displayName,
        portraitUrl: performer.portraitUrl,
        voltage: performer.voltage,
        active: performer.activePerformer,
      }))),
    }))),
    visibleTeamPools: Object.freeze(visibleTeamPools),
    pendingAppeal: pending?.requiresChoice ? pending.decision : null,
    synchronizing,
    acceptedAppeals: publicProjection.acceptedAppeals,
    history: publicProjection.history,
    actionsBlocked: document.paused || authority.next !== null || document.stage === 'settling',
    exactRetry,
  })
}

const zeroSpend = (): BattleContestLiveplaySpendV1 => ({ beauty: 0, cool: 0, cute: 0, smart: 0, tough: 0 })

const validateSpend = (value: unknown): BattleContestLiveplaySpendV1 => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return error(400, 'battle-contest.liveplay-spend-invalid', 'Contest Dice spend must contain exactly five stat values.')
  }
  const row = value as Record<string, unknown>
  if (Object.keys(row).length !== CONTEST_STAT_IDS.length || CONTEST_STAT_IDS.some(statId => !Object.hasOwn(row, statId))) {
    return error(400, 'battle-contest.liveplay-spend-invalid', 'Contest Dice spend must contain exactly five stat values.')
  }
  const spend = Object.fromEntries(CONTEST_STAT_IDS.map(statId => {
    const amount = row[statId]
    if (!Number.isSafeInteger(amount) || Number(amount) < 0 || Number(amount) > 3) {
      return error(400, 'battle-contest.liveplay-spend-invalid', 'Each Contest Dice spend must be an integer from zero through three.')
    }
    return [statId, Number(amount)]
  })) as unknown as BattleContestLiveplaySpendV1
  if (CONTEST_STAT_IDS.reduce((sum, statId) => sum + spend[statId], 0) > 3) {
    return error(400, 'battle-contest.liveplay-spend-invalid', 'At most three Contest Dice may be spent on one accepted Move.')
  }
  return Object.freeze(spend)
}

const authorizeDecision = (contestant: ContestantStateV1, actor: ContestActorV1): void => {
  if (actor.role === 'gm') return
  if (!actor.playerProfile) return error(403, 'contest.profile-required', 'Select a player profile before resolving this Contest decision.')
  if (contestant.controller.kind !== 'profile' || contestant.controller.profileId !== actor.playerProfile.id) {
    return error(403, 'contest.controller-required', 'This Contest decision belongs to another controller.')
  }
}

const exactRetryAccepted = (
  document: ContestDocumentV1,
  expectedRevision: number,
  spend: BattleContestLiveplaySpendV1,
  actor: ContestActorV1,
  contests: ContestRepository,
): boolean => {
  const receipts = document.battleHandoffReceipts.filter(receipt => (
    receipt.outcome === 'scored-appeal' && receipt.contestRevisionBefore === expectedRevision
  ))
  if (receipts.length !== 1) return false
  const receipt = receipts[0]!
  const operation = contests.findOperation(receipt.operationId)
  if (!operation || operation.command.commandKind !== 'score-battle-accepted-move'
    || stableJsonStringify(operation.command.spentDice) !== stableJsonStringify(spend)) return false
  const appeal = document.appealLedger.find(entry => entry.operationId === receipt.operationId)
  const contestant = appeal ? document.contestants.find(candidate => candidate.contestantId === appeal.contestantId) : null
  if (!contestant) return false
  authorizeDecision(contestant, actor)
  return true
}

const reconcile = (
  repositories: Runtime,
  encounterId: string,
  actor: ContestActorV1,
  requestedSpend: { readonly expectedRevision: number, readonly spend: BattleContestLiveplaySpendV1 } | null,
  initialExactRetry = false,
): BattleContestLiveplayProjectionV1 | null => {
  let spendRequest = requestedSpend
  let exactRetry = initialExactRetry
  for (let index = 0; index < 512; index += 1) {
    const authority = loadAuthority(repositories, encounterId)
    if (!authority) return null
    const next = authority.next
    if (!next || authority.document.stage !== 'performance') {
      if (spendRequest) {
        if (spendRequest.expectedRevision < authority.document.revision
          && exactRetryAccepted(authority.document, spendRequest.expectedRevision, spendRequest.spend, actor, repositories.contests)) {
          exactRetry = true
          spendRequest = null
        } else return error(409, 'battle-contest.liveplay-decision-missing', 'The accepted Move no longer has this Contest Dice decision.')
      }
      return project(authority, actor, exactRetry)
    }
    if (next.kind === 'accepted-move') {
      const pending = pendingContext(authority, actor)!
      if (pending.requiresChoice) {
        if (!spendRequest) return project(authority, actor, exactRetry)
        if (spendRequest.expectedRevision !== authority.document.revision) {
          if (spendRequest.expectedRevision < authority.document.revision
            && exactRetryAccepted(authority.document, spendRequest.expectedRevision, spendRequest.spend, actor, repositories.contests)) {
            exactRetry = true
            spendRequest = null
            continue
          }
          return error(409, 'battle-contest.liveplay-revision-stale', 'Contest decision changed before this allocation was accepted.')
        }
        authorizeDecision(pending.contestant, actor)
        scoreBattleContestAcceptedMoveUseCase({
          contestId: authority.document.contestId,
          expectedRevision: authority.document.revision,
          sourceOperationId: next.sourceOperationId,
          sourceResolutionId: next.sourceResolutionId,
          spentDice: spendRequest.spend,
          clientId: actor.playerProfile?.id ?? null,
        }, repositories.contestDependencies)
        spendRequest = null
        continue
      }
      scoreBattleContestAcceptedMoveUseCase({
        contestId: authority.document.contestId,
        expectedRevision: authority.document.revision,
        sourceOperationId: next.sourceOperationId,
        sourceResolutionId: next.sourceResolutionId,
        spentDice: zeroSpend(),
        clientId: null,
      }, repositories.contestDependencies)
      continue
    }
    if (spendRequest) {
      if (spendRequest.expectedRevision < authority.document.revision
        && exactRetryAccepted(authority.document, spendRequest.expectedRevision, spendRequest.spend, actor, repositories.contests)) {
        exactRetry = true
        spendRequest = null
      } else return error(409, 'battle-contest.liveplay-decision-missing', 'The accepted Move no longer has this Contest Dice decision.')
    }
    if (next.kind === 'voltage-lifecycle') {
      applyBattleContestVoltageLifecycleUseCase({
        contestId: authority.document.contestId,
        expectedRevision: authority.document.revision,
        sourceOperationId: next.sourceOperationId,
        sourceResultId: next.sourceResultId,
        clientId: null,
      }, repositories.contestDependencies)
      continue
    }
    endBattleContestUseCase({
      contestId: authority.document.contestId,
      expectedRevision: authority.document.revision,
      sourceOperationId: next.sourceOperationId,
      sourceResultId: next.sourceResultId,
      clientId: null,
    }, repositories.contestDependencies)
  }
  return error(409, 'battle-contest.liveplay-reconciliation-limit', 'Battle Contest reconciliation exceeded its bounded handoff limit.')
}

export const loadBattleContestLiveplayUseCase = (
  encounterId: string,
  actor: ContestActorV1,
  dependencies: BattleContestLiveplayDependencies = {},
): BattleContestLiveplayResponseV1 => {
  const repositories = runtime(dependencies)
  const authority = loadAuthority(repositories, encounterId)
  return Object.freeze({ ok: true, battleContest: authority ? project(authority, actor, false) : null })
}

export const executeBattleContestLiveplayCommandUseCase = (
  value: unknown,
  actor: ContestActorV1,
  dependencies: BattleContestLiveplayDependencies = {},
): BattleContestLiveplayResponseV1 => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return error(400, 'battle-contest.liveplay-command-invalid', 'Battle Contest liveplay command must be one object.')
  }
  const command = value as Partial<BattleContestLiveplayCommandV1> & Record<string, unknown>
  if (command.schemaVersion !== BATTLE_CONTEST_LIVEPLAY_SCHEMA_VERSION
    || (command.command !== 'synchronize' && command.command !== 'score-appeal')
    || typeof command.encounterId !== 'string' || command.encounterId.length < 1 || command.encounterId.length > 200) {
    return error(400, 'battle-contest.liveplay-command-invalid', 'Battle Contest liveplay command is invalid.')
  }
  const repositories = runtime(dependencies)
  if (command.command === 'synchronize') {
    if (Object.keys(command).length !== 3) return error(400, 'battle-contest.liveplay-command-invalid', 'Synchronize accepts exactly schemaVersion, command, and encounterId.')
    return Object.freeze({ ok: true, battleContest: reconcile(repositories, command.encounterId, actor, null) })
  }
  if (Object.keys(command).length !== 5 || !Number.isSafeInteger(command.expectedContestRevision) || Number(command.expectedContestRevision) < 0) {
    return error(400, 'battle-contest.liveplay-command-invalid', 'Score Appeal requires exactly one expected Contest revision and five-stat spend.')
  }
  const spend = validateSpend(command.spentDice)
  return Object.freeze({
    ok: true,
    battleContest: reconcile(repositories, command.encounterId, actor, {
      expectedRevision: Number(command.expectedContestRevision),
      spend,
    }),
  })
}

export type BattleContestLiveplayActorV1 = {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
}
