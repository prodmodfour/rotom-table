import contestsJson from '../../data/reference/contests.json'
import {
  BATTLE_CONTEST_BLEND_CONTRACT_ID,
  BATTLE_CONTEST_HANDOFF_KINDS,
} from './battleBlend'
import {
  CONTEST_BASE_VARIANT_IDS,
  CONTEST_EFFECT_IDS,
  CONTEST_PARTICIPANT_METHOD_IDS,
  CONTEST_RUNTIME_VARIANT_IDS,
  CONTEST_STAT_IDS,
  isContestBaseVariantId,
  isContestEffectId,
  isContestParticipantMethodId,
  isContestStatId,
  type ContestBaseVariantId,
  type ContestEffectId,
  type ContestIntroductionSkillId,
  type ContestParticipantMethodId,
  type ContestStatId,
  type ContestVariantId,
} from './ids'

export type ContestCombatStatId = 'atk' | 'def' | 'satk' | 'sdef' | 'spd'

export interface CanonicalContestStat {
  readonly id: ContestStatId
  readonly label: string
  readonly combatStatId: ContestCombatStatId
  readonly combatStatLabel: string
  readonly introductionSkillId: ContestIntroductionSkillId
  readonly introductionSkillLabel: string
  readonly alliedStatIds: readonly ContestStatId[]
  readonly opposedStatIds: readonly ContestStatId[]
}

export interface CanonicalTrainerParticipantSimultaneousMethod {
  readonly id: 'simultaneous'
  readonly appealsPerEntryPerRound: 2
  readonly appealOrderPolicy: 'controller-chooses-trainer-or-pokemon-first'
  readonly voltageScope: 'per-performer'
  readonly adjacentEffectScope: 'both-performers-of-adjacent-entry'
  readonly crossPerformerEffectPolicy: readonly ['get-ready-may-apply-to-partner-same-round', 'attention-grabber-may-transfer-between-pair']
}

export interface CanonicalTrainerParticipantAlternatingMethod {
  readonly id: 'alternating'
  readonly appealsPerEntryPerRound: 1
  readonly appealOrderPolicy: 'trainer-and-pokemon-alternate'
  readonly voltageScope: 'shared-entry'
  readonly adjacentEffectScope: 'shared-entry'
  readonly crossPerformerEffectPolicy: readonly []
}

export type CanonicalTrainerParticipantMethod = CanonicalTrainerParticipantSimultaneousMethod | CanonicalTrainerParticipantAlternatingMethod

export interface CanonicalTrainerParticipantVariant {
  readonly id: 'trainer-participant'
  readonly label: string
  readonly completionState: 'structured' | 'native'
  readonly structuredSemanticsVersion: 1
  readonly compatibleBaseVariantIds: readonly ContestBaseVariantId[]
  readonly contestantMinimum: 3
  readonly contestantMaximum: 5
  readonly performerPolicy: {
    readonly performersPerEntry: readonly ['trainer', 'pokemon']
    readonly trainerMayAppeal: true
    readonly moveAuthority: 'authoritative-performer-move-list'
    readonly missingContestIdentityPolicy: 'reject'
  }
  readonly methods: readonly [CanonicalTrainerParticipantSimultaneousMethod, CanonicalTrainerParticipantAlternatingMethod]
  readonly sharedContestDicePool: {
    readonly scope: 'trainer-pokemon-entry'
    readonly depletionScope: 'contest'
    readonly spendAuthority: 'active-performer'
    readonly singleSpendRequired: true
  }
  readonly featurePolicy: {
    readonly coordinatorMayTarget: readonly ['trainer', 'pokemon']
    readonly similarTrainerFeaturesMayTarget: readonly ['trainer', 'pokemon']
  }
}

export interface CanonicalBattleContestVariant {
  readonly id: 'battle'
  readonly label: string
  readonly completionState: 'native'
  readonly structuredSemanticsVersion: 1
  readonly blendContract: {
    readonly contractId: typeof BATTLE_CONTEST_BLEND_CONTRACT_ID
    readonly linkIdentity: 'battle-contest-link:v1:<stable-id>'
    readonly linkAuthority: 'coordination-ledger-only'
    readonly contestAuthority: 'contest-document-scoring-only'
    readonly encounterAuthority: 'encounter-document-linked-map-mechanics-only'
    readonly acceptedResultAuthority: 'persisted-live-play-operation-plus-encounter-history'
    readonly handoffKinds: typeof BATTLE_CONTEST_HANDOFF_KINDS
    readonly revisionCoupling: 'exact-contest-encounter-document-and-map-read-set'
    readonly idempotency: 'operation-command-hash-plus-handoff-sha256'
    readonly crossDocumentWrites: 'forbidden'
    readonly atomicity: 'document-local-plans-with-shared-transaction-for-combined-transitions'
  }
  readonly trainerCount: 2
  readonly rosterPolicy: {
    readonly pokemonPerTrainerMinimum: 3
    readonly pokemonPerTrainerMaximum: 6
    readonly equalDeclaredCountRequired: true
    readonly defaultActivePokemonPerTrainer: 1
  }
  readonly roundBudget: {
    readonly formula: 'twice-pokemon-per-trainer'
    readonly minimum: 6
    readonly maximum: 12
  }
  readonly contestTypePolicy: 'fixed-selected-at-setup'
  readonly introductionPolicy: {
    readonly skillCheckPerTrainer: 1
    readonly contestDicePoolScope: 'trainer-team'
    readonly usableBy: 'any-team-pokemon'
    readonly affectsInitiative: false
  }
  readonly encounterPolicy: {
    readonly turnOrder: 'encounter-initiative'
    readonly appealSource: 'accepted-move-result'
    readonly excludedActions: readonly ['struggle-attack', 'combat-maneuver']
    readonly contestAdjacency: 'all-opposing-pokemon-on-field'
  }
  readonly contestEffectPolicy: {
    readonly semantics: 'canonical-contest-effect-handler'
    readonly supportedEffectIds: readonly ContestEffectId[]
    readonly unknownEffectPolicy: 'reject'
    readonly actorVoltageTarget: 'acting-pokemon'
    readonly adjacentVoltageTargets: 'all-opposing-pokemon-on-field'
    readonly indirectFumbleTarget: 'opposing-trainer-team'
    readonly onFieldPokemonMinimumPerTrainer: 1
    readonly onFieldPokemonMaximumPerTrainer: 6
    readonly onFieldPokemonAuthority: 'linked-map-placements'
    readonly roundIdentity: 'encounter-round'
    readonly getReadyTarget: 'same-pokemon-next-encounter-round'
    readonly savingGraceProtection: 'same-active-pokemon-through-encounter-round'
    readonly reliableHistory: 'same-pokemon-previous-accepted-move'
  }
  readonly voltagePolicy: {
    readonly scope: 'per-pokemon'
    readonly appealUses: 'active-pokemon-only'
    readonly attackKoDelta: 2
    readonly damageOverTimeKoRecipient: 'opposing-active-pokemon'
    readonly recallDelta: -2
    readonly recallLossExceptions: readonly ['Baton Pass', 'U-Turn', 'Volt Switch', 'Juggler-equivalent-switch']
    readonly jugglerRecallExceptionProviderIds: readonly ['feature:Quick Switch', 'feature:Round Trip']
  }
  readonly replacementPolicy: { readonly afterKo: 'center-of-attention-first-acting-turn' }
  readonly endPolicy: {
    readonly conditions: readonly ['round-budget-exhausted', 'one-trainer-all-pokemon-knocked-out']
    readonly score: 'appeal-points'
    readonly winner: 'highest-appeal-points'
  }
  readonly settlementPolicy: {
    readonly experienceRecipients: 'all-declared-team-pokemon'
    readonly experienceUnits: 'standard-team-placement-formula'
    readonly experienceLevelBasis: 'each-recipient-own-level'
    readonly ribbonRecipients: 'all-declared-winning-team-pokemon'
    readonly prizeRecipient: 'winning-trainer-unless-explicit-enrolled-target'
    readonly encounterReconciliation: 'exact-preview-one-combined-transaction'
    readonly duplicateSourcePolicy: 'exact-retry-or-reject'
  }
}

export interface CanonicalContestEffect {
  readonly id: ContestEffectId
  readonly label: string
  readonly baseDice: number | 'dynamic'
  readonly handler: string
  readonly parameters: Readonly<Record<string, unknown>>
}

export interface CanonicalContestChartRound {
  readonly round: number
  readonly lineup: readonly string[]
  readonly turnOrder: readonly string[]
}

export interface CanonicalContestChart {
  readonly positionTurnNumbers: readonly number[]
  readonly centerPosition: number
  readonly rounds: readonly CanonicalContestChartRound[]
}

export interface CanonicalContestCatalog {
  readonly schemaVersion: 1
  readonly catalogId: string
  readonly contestStats: readonly CanonicalContestStat[]
  readonly contestEffects: readonly CanonicalContestEffect[]
  readonly charts: Readonly<Record<'3' | '4' | '5', CanonicalContestChart>>
  readonly preparation: {
    readonly combatContribution: { readonly pointsPerDie: number, readonly maximumDice: number, readonly includeCombatStages: false }
    readonly poffins: { readonly baseAllowance: number, readonly levelsPerAdditionalPoffin: number, readonly standardMaximum: number, readonly graceAdditionalMaximum: number, readonly dicePerPoffin: number, readonly overAllowancePolicy: string }
  }
  readonly introduction: {
    readonly skillIds: readonly ContestIntroductionSkillId[]
    readonly dieSides: 6
    readonly successFaces: readonly number[]
    readonly standardMatchingAppealBonus: number
    readonly standardMatchingLetterTotalBonus: number
    readonly standardMatchingBasis: 'selected-skill-mapped-stat'
    readonly tiePolicy: string
    readonly bonusRolls: Readonly<Record<string, number | string | boolean>>
  }
  readonly performance: {
    readonly roundCount: string
    readonly moveRepeatPolicy: string
    readonly contestDiceSpendMaximumPerAppeal: number
    readonly contestDiceDepletionScope: 'contest'
    readonly appealTypeModifiers: { readonly matching: number, readonly allied: number, readonly opposed: number, readonly opposedAtZero: string }
    readonly normalScoring: Readonly<Record<string, { readonly appeal: number, readonly fumble: number }>>
    readonly centerScoring: Readonly<Record<string, { readonly appeal: number, readonly fumble: number }>>
    readonly voltage: { readonly minimum: number, readonly maximum: number, readonly startOfTurnBonusDicePerPoint: number }
    readonly finalScoreFormula: string
    readonly placementTiePolicy: string
  }
  readonly variants: ReadonlyArray<Readonly<Record<string, unknown>> & { readonly id: string, readonly completionState: string }>
  readonly experience: {
    readonly baseExperiencePerOwnLevelOpponent: string
    readonly participationUnitsFormula: string
    readonly roundingPolicy: string
    readonly significanceMultiplierMinimum: number
    readonly significanceMultiplierMaximum: number
    readonly significanceMultiplierStep: number
    readonly festivalPolicy: string
    readonly rotationParticipationUnitsFormula: string
    readonly rotationPackagePolicy: string
    readonly rotationPolicy: string
  }
  readonly integrationRows: ReadonlyArray<{
    readonly kind: 'feature' | 'edge' | 'ability' | 'item'
    readonly id: string
    readonly completionState: 'native' | 'guided' | 'passive' | 'reference-only' | 'not-applicable'
    readonly handler?: string
    readonly safeReason?: string
  }>
  readonly privacy: Readonly<Record<string, readonly string[]>>
  readonly corrections: {
    readonly allowed: readonly string[]
    readonly maximumAbsoluteNumericDelta: number
    readonly diceEvidenceMutable: false
    readonly receiptRequired: true
  }
}

const fail = (message: string): never => { throw new Error(`Invalid canonical Contest catalog: ${message}`) }
const unique = (values: readonly string[]): boolean => new Set(values).size === values.length

const validateCatalog = (value: unknown): CanonicalContestCatalog => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('root must be an object')
  const catalog = value as unknown as CanonicalContestCatalog
  if (catalog.schemaVersion !== 1 || catalog.catalogId !== 'ptu-core-contests-v1') fail('unsupported schema or catalog identity')
  if (catalog.contestStats.length !== CONTEST_STAT_IDS.length
    || !unique(catalog.contestStats.map(row => row.id))
    || catalog.contestStats.some(row => !isContestStatId(row.id))) fail('contest stat coverage drift')
  for (const row of catalog.contestStats) {
    if (row.alliedStatIds.length !== 2 || row.opposedStatIds.length !== 2
      || !unique([...row.alliedStatIds, ...row.opposedStatIds])
      || [...row.alliedStatIds, ...row.opposedStatIds].some(id => id === row.id || !isContestStatId(id))) {
      fail(`invalid allied/opposed relationships for ${row.id}`)
    }
  }
  if (catalog.introduction.standardMatchingBasis !== 'selected-skill-mapped-stat' || catalog.introduction.bonusRolls.allocationPolicy !== 'independent-source-rolls-may-target-distinct-stats') fail('Introduction allocation policy drift')
  if (catalog.performance.contestDiceDepletionScope !== 'contest') fail('Contest dice must use canonical whole-Contest depletion')
  if (catalog.contestEffects.length !== CONTEST_EFFECT_IDS.length
    || !unique(catalog.contestEffects.map(row => row.id))
    || catalog.contestEffects.some(row => !isContestEffectId(row.id))) fail('contest effect coverage drift')
  for (const size of [3, 4, 5] as const) {
    const chart = catalog.charts[String(size) as '3' | '4' | '5']
    if (!chart || chart.rounds.length !== size || chart.positionTurnNumbers.length !== size
      || chart.centerPosition < 0 || chart.centerPosition >= size) fail(`invalid ${size}-contestant chart`)
    const letters = Array.from({ length: size }, (_, index) => String.fromCharCode(65 + index))
    for (const [index, round] of chart.rounds.entries()) {
      if (round.round !== index + 1 || round.lineup.length !== size || round.turnOrder.length !== size
        || !unique(round.lineup) || !unique(round.turnOrder)
        || [...round.lineup].sort().join() !== letters.join()
        || [...round.turnOrder].sort().join() !== letters.join()) fail(`invalid ${size}-contestant chart round ${index + 1}`)
      const derivedTurnOrder = chart.positionTurnNumbers
        .map((turn, position) => ({ turn, letter: round.lineup[position]! }))
        .sort((left, right) => left.turn - right.turn)
        .map(entry => entry.letter)
      if (derivedTurnOrder.join() !== round.turnOrder.join()) fail(`${size}-contestant turn order drift in round ${round.round}`)
    }
    for (const letter of letters) {
      const centerCount = chart.rounds.filter(round => round.lineup[chart.centerPosition] === letter).length
      if (centerCount !== 1) fail(`${size}-contestant chart must center ${letter} exactly once`)
    }
  }
  const nativeVariantIds = catalog.variants.filter(row => row.completionState === 'native').map(row => row.id)
  if (!CONTEST_BASE_VARIANT_IDS.every(id => nativeVariantIds.includes(id))) fail('native base variant coverage drift')
  if (catalog.integrationRows.some(row => row.completionState === ('blocked' as string))) fail('blocked integration row')
  const counts = (kind: string): number => catalog.integrationRows.filter(row => row.kind === kind).length
  if (counts('feature') !== 34 || counts('edge') !== 2 || counts('ability') !== 3 || counts('item') !== 5) fail('integration coverage drift')
  return Object.freeze(catalog)
}

export const contestCatalog = validateCatalog(contestsJson)

const trainerParticipantRow = contestCatalog.variants.find(row => row.id === 'trainer-participant') as Record<string, unknown> | undefined
const trainerParticipantPolicy = trainerParticipantRow?.performerPolicy as Record<string, unknown> | undefined
const trainerParticipantDicePool = trainerParticipantRow?.sharedContestDicePool as Record<string, unknown> | undefined
const trainerParticipantFeaturePolicy = trainerParticipantRow?.featurePolicy as Record<string, unknown> | undefined
const trainerParticipantMethods = trainerParticipantRow?.methods as Record<string, unknown>[] | undefined
const simultaneousMethod = trainerParticipantMethods?.find(row => row.id === 'simultaneous')
const alternatingMethod = trainerParticipantMethods?.find(row => row.id === 'alternating')
const exactMethodFields = (row: Record<string, unknown> | undefined): boolean => Boolean(row && Object.keys(row).sort().join(',') === ['id','appealsPerEntryPerRound','appealOrderPolicy','voltageScope','adjacentEffectScope','crossPerformerEffectPolicy'].sort().join(','))
const compatibleTrainerParticipantVariants = trainerParticipantRow?.compatibleBaseVariantIds
if (!trainerParticipantRow
  || !trainerParticipantPolicy
  || trainerParticipantRow.completionState !== 'native'
  || trainerParticipantRow.structuredSemanticsVersion !== 1
  || trainerParticipantRow.contestantMinimum !== 3
  || trainerParticipantRow.contestantMaximum !== 5
  || !Array.isArray(compatibleTrainerParticipantVariants)
  || compatibleTrainerParticipantVariants.length !== CONTEST_BASE_VARIANT_IDS.length
  || new Set(compatibleTrainerParticipantVariants).size !== compatibleTrainerParticipantVariants.length
  || compatibleTrainerParticipantVariants.some(id => !isContestBaseVariantId(id))
  || !CONTEST_BASE_VARIANT_IDS.every(id => compatibleTrainerParticipantVariants.includes(id))
  || !Array.isArray(trainerParticipantPolicy.performersPerEntry)
  || trainerParticipantPolicy.performersPerEntry.join(',') !== 'trainer,pokemon'
  || trainerParticipantPolicy.trainerMayAppeal !== true
  || trainerParticipantPolicy.moveAuthority !== 'authoritative-performer-move-list'
  || trainerParticipantPolicy.missingContestIdentityPolicy !== 'reject'
  || !Array.isArray(trainerParticipantMethods)
  || trainerParticipantMethods.length !== CONTEST_PARTICIPANT_METHOD_IDS.length
  || new Set(trainerParticipantMethods.map(row => row.id)).size !== trainerParticipantMethods.length
  || trainerParticipantMethods.some(row => !isContestParticipantMethodId(row.id))
  || !exactMethodFields(simultaneousMethod)
  || simultaneousMethod?.appealsPerEntryPerRound !== 2
  || simultaneousMethod?.appealOrderPolicy !== 'controller-chooses-trainer-or-pokemon-first'
  || simultaneousMethod?.voltageScope !== 'per-performer'
  || simultaneousMethod?.adjacentEffectScope !== 'both-performers-of-adjacent-entry'
  || !Array.isArray(simultaneousMethod?.crossPerformerEffectPolicy)
  || (simultaneousMethod?.crossPerformerEffectPolicy as unknown[] | undefined)?.join(',') !== 'get-ready-may-apply-to-partner-same-round,attention-grabber-may-transfer-between-pair'
  || !exactMethodFields(alternatingMethod)
  || alternatingMethod?.appealsPerEntryPerRound !== 1
  || alternatingMethod?.appealOrderPolicy !== 'trainer-and-pokemon-alternate'
  || alternatingMethod?.voltageScope !== 'shared-entry'
  || alternatingMethod?.adjacentEffectScope !== 'shared-entry'
  || !Array.isArray(alternatingMethod?.crossPerformerEffectPolicy)
  || (alternatingMethod?.crossPerformerEffectPolicy as unknown[] | undefined)?.length !== 0
  || !trainerParticipantDicePool
  || trainerParticipantDicePool.scope !== 'trainer-pokemon-entry'
  || trainerParticipantDicePool.depletionScope !== 'contest'
  || trainerParticipantDicePool.spendAuthority !== 'active-performer'
  || trainerParticipantDicePool.singleSpendRequired !== true
  || !trainerParticipantFeaturePolicy
  || !Array.isArray(trainerParticipantFeaturePolicy.coordinatorMayTarget)
  || trainerParticipantFeaturePolicy.coordinatorMayTarget.join(',') !== 'trainer,pokemon'
  || !Array.isArray(trainerParticipantFeaturePolicy.similarTrainerFeaturesMayTarget)
  || trainerParticipantFeaturePolicy.similarTrainerFeaturesMayTarget.join(',') !== 'trainer,pokemon') {
  fail('trainer-participant structured authority drift')
}

const battleRow = contestCatalog.variants.find(row => row.id === 'battle') as Record<string, unknown> | undefined
const battleBlend = battleRow?.blendContract as Record<string, unknown> | undefined
const battleRoster = battleRow?.rosterPolicy as Record<string, unknown> | undefined
const battleRounds = battleRow?.roundBudget as Record<string, unknown> | undefined
const battleIntroduction = battleRow?.introductionPolicy as Record<string, unknown> | undefined
const battleEncounter = battleRow?.encounterPolicy as Record<string, unknown> | undefined
const battleEffects = battleRow?.contestEffectPolicy as Record<string, unknown> | undefined
const battleVoltage = battleRow?.voltagePolicy as Record<string, unknown> | undefined
const battleReplacement = battleRow?.replacementPolicy as Record<string, unknown> | undefined
const battleEnd = battleRow?.endPolicy as Record<string, unknown> | undefined
const battleSettlement = battleRow?.settlementPolicy as Record<string, unknown> | undefined
if (!battleRow
  || battleRow.completionState !== 'native'
  || battleRow.structuredSemanticsVersion !== 1
  || !battleBlend
  || battleBlend.contractId !== BATTLE_CONTEST_BLEND_CONTRACT_ID
  || battleBlend.linkIdentity !== 'battle-contest-link:v1:<stable-id>'
  || battleBlend.linkAuthority !== 'coordination-ledger-only'
  || battleBlend.contestAuthority !== 'contest-document-scoring-only'
  || battleBlend.encounterAuthority !== 'encounter-document-linked-map-mechanics-only'
  || battleBlend.acceptedResultAuthority !== 'persisted-live-play-operation-plus-encounter-history'
  || !Array.isArray(battleBlend.handoffKinds)
  || battleBlend.handoffKinds.join(',') !== BATTLE_CONTEST_HANDOFF_KINDS.join(',')
  || battleBlend.revisionCoupling !== 'exact-contest-encounter-document-and-map-read-set'
  || battleBlend.idempotency !== 'operation-command-hash-plus-handoff-sha256'
  || battleBlend.crossDocumentWrites !== 'forbidden'
  || battleBlend.atomicity !== 'document-local-plans-with-shared-transaction-for-combined-transitions'
  || battleRow.trainerCount !== 2
  || !battleRoster
  || battleRoster.pokemonPerTrainerMinimum !== 3
  || battleRoster.pokemonPerTrainerMaximum !== 6
  || battleRoster.equalDeclaredCountRequired !== true
  || battleRoster.defaultActivePokemonPerTrainer !== 1
  || !battleRounds
  || battleRounds.formula !== 'twice-pokemon-per-trainer'
  || battleRounds.minimum !== 6
  || battleRounds.maximum !== 12
  || battleRow.contestTypePolicy !== 'fixed-selected-at-setup'
  || !battleIntroduction
  || battleIntroduction.skillCheckPerTrainer !== 1
  || battleIntroduction.contestDicePoolScope !== 'trainer-team'
  || battleIntroduction.usableBy !== 'any-team-pokemon'
  || battleIntroduction.affectsInitiative !== false
  || !battleEncounter
  || battleEncounter.turnOrder !== 'encounter-initiative'
  || battleEncounter.appealSource !== 'accepted-move-result'
  || !Array.isArray(battleEncounter.excludedActions)
  || battleEncounter.excludedActions.join(',') !== 'struggle-attack,combat-maneuver'
  || battleEncounter.contestAdjacency !== 'all-opposing-pokemon-on-field'
  || !battleEffects
  || battleEffects.semantics !== 'canonical-contest-effect-handler'
  || !Array.isArray(battleEffects.supportedEffectIds)
  || battleEffects.supportedEffectIds.length !== contestCatalog.contestEffects.length
  || new Set(battleEffects.supportedEffectIds).size !== battleEffects.supportedEffectIds.length
  || battleEffects.supportedEffectIds.join(',') !== contestCatalog.contestEffects.map(effect => effect.id).join(',')
  || battleEffects.unknownEffectPolicy !== 'reject'
  || battleEffects.actorVoltageTarget !== 'acting-pokemon'
  || battleEffects.adjacentVoltageTargets !== 'all-opposing-pokemon-on-field'
  || battleEffects.indirectFumbleTarget !== 'opposing-trainer-team'
  || battleEffects.onFieldPokemonMinimumPerTrainer !== 1
  || battleEffects.onFieldPokemonMaximumPerTrainer !== battleRoster.pokemonPerTrainerMaximum
  || battleEffects.onFieldPokemonAuthority !== 'linked-map-placements'
  || battleEffects.roundIdentity !== 'encounter-round'
  || battleEffects.getReadyTarget !== 'same-pokemon-next-encounter-round'
  || battleEffects.savingGraceProtection !== 'same-active-pokemon-through-encounter-round'
  || battleEffects.reliableHistory !== 'same-pokemon-previous-accepted-move'
  || !battleVoltage
  || battleVoltage.scope !== 'per-pokemon'
  || battleVoltage.appealUses !== 'active-pokemon-only'
  || battleVoltage.attackKoDelta !== 2
  || battleVoltage.damageOverTimeKoRecipient !== 'opposing-active-pokemon'
  || battleVoltage.recallDelta !== -2
  || !Array.isArray(battleVoltage.recallLossExceptions)
  || battleVoltage.recallLossExceptions.join(',') !== 'Baton Pass,U-Turn,Volt Switch,Juggler-equivalent-switch'
  || !Array.isArray(battleVoltage.jugglerRecallExceptionProviderIds)
  || battleVoltage.jugglerRecallExceptionProviderIds.join(',') !== 'feature:Quick Switch,feature:Round Trip'
  || !battleReplacement
  || battleReplacement.afterKo !== 'center-of-attention-first-acting-turn'
  || !battleEnd
  || !Array.isArray(battleEnd.conditions)
  || battleEnd.conditions.join(',') !== 'round-budget-exhausted,one-trainer-all-pokemon-knocked-out'
  || battleEnd.score !== 'appeal-points'
  || battleEnd.winner !== 'highest-appeal-points'
  || !battleSettlement
  || battleSettlement.experienceRecipients !== 'all-declared-team-pokemon'
  || battleSettlement.experienceUnits !== 'standard-team-placement-formula'
  || battleSettlement.experienceLevelBasis !== 'each-recipient-own-level'
  || battleSettlement.ribbonRecipients !== 'all-declared-winning-team-pokemon'
  || battleSettlement.prizeRecipient !== 'winning-trainer-unless-explicit-enrolled-target'
  || battleSettlement.encounterReconciliation !== 'exact-preview-one-combined-transaction'
  || battleSettlement.duplicateSourcePolicy !== 'exact-retry-or-reject') {
  fail('battle native blend authority drift')
}

/** Source-bound native Trainer Participant authority activated by P11-064. */
export const trainerParticipantContestVariant = Object.freeze(trainerParticipantRow) as unknown as CanonicalTrainerParticipantVariant
/** Source-bound native Battle Contest authority activated only after P11-065 through P11-080 certification. */
export const battleContestVariant = Object.freeze(battleRow) as unknown as CanonicalBattleContestVariant
export const trainerParticipantMethodById = new Map<ContestParticipantMethodId, CanonicalTrainerParticipantMethod>(trainerParticipantContestVariant.methods.map(method => [method.id, method]))
export const contestBaseVariantAllowsTrainerParticipants = (variantId: ContestVariantId): variantId is ContestBaseVariantId =>
  isContestBaseVariantId(variantId) && trainerParticipantContestVariant.compatibleBaseVariantIds.includes(variantId)

export const contestStatById = new Map<ContestStatId, CanonicalContestStat>(contestCatalog.contestStats.map(row => [row.id, row]))
export const contestEffectById = new Map<ContestEffectId, CanonicalContestEffect>(contestCatalog.contestEffects.map(row => [row.id, row]))

export const contestChart = (contestantCount: number): CanonicalContestChart => {
  if (contestantCount !== 3 && contestantCount !== 4 && contestantCount !== 5) fail('contestant count must be 3, 4, or 5')
  return contestCatalog.charts[String(contestantCount) as '3' | '4' | '5']
}

export const contestVariantIsNative = (value: unknown): value is ContestVariantId =>
  typeof value === 'string'
  && CONTEST_RUNTIME_VARIANT_IDS.includes(value as ContestVariantId)
  && contestCatalog.variants.some(row => row.id === value && row.completionState === 'native')
/** Setup is available only to source-bound native runtime variants. */
export const contestVariantAllowsSetup = (value: unknown): value is ContestVariantId =>
  contestVariantIsNative(value)
export const contestParticipantVariantIsNative = (value: unknown): value is 'trainer-participant' =>
  value === 'trainer-participant' && trainerParticipantContestVariant.completionState === 'native'
