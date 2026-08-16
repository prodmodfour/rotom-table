import { createHash } from 'node:crypto'
import abilitiesJson from '../../../data/reference/abilities.json'
import movesJson from '../../../data/reference/moves.json'
import pokedexJson from '../../../data/reference/pokedex.json'
import rulesJson from '../../../data/reference/rules.json'
import { stableJsonStringify } from '../../../shared/automation/stableJson'
import {
  createOpenCampaignAttentionItem,
  type CampaignAttentionActionIntent,
  type CampaignAttentionDecisionKind,
  type CampaignAttentionItem,
  type CampaignAttentionReason,
  type CampaignAttentionSourceEventKind,
  type CampaignAttentionUrgency,
} from '../../../shared/campaignAttention/model'
import { parseItemEvolutionState } from '../../../shared/itemAutomation/evolution'
import { parseSheetEquipmentStateForOwner } from '../../../shared/itemAutomation/equipment'
import type { CharacterSheet } from '../../../src/types/characterSheet'
import type { PokedexRecord } from '../../../src/types/pokemon'
import type { StoredEncounterSettlementAttentionSource, StoredEncounterSettlementHistoryFact } from '../../storage/encounterSettlementRepository'
import type { StoredItemOperationRecord } from '../../storage/itemOperationRepository'
import type { StoredSheetDocument } from '../../storage/sheetRepository'
import { assertCurrentItemEvolutionAuthority } from '../itemAutomation/evolution'
import { assertCurrentItemMoveLearningAuthority } from '../itemAutomation/moveLearning'

const LIMIT = 10_000
const RULE_ID = 'Pokémon Advancement Choices'
const ITEM_EVOLUTION_RULE_ID = 'Evolutionary Items'
const ABILITY_TIERS = ['basic', 'advanced', 'high'] as const

interface AbilityMilestone {
  readonly level: number
  readonly ordinal: number
  readonly tiers: readonly (typeof ABILITY_TIERS[number])[]
}
interface AdvancementChoiceMechanics {
  readonly moveLearning: {
    readonly activeMoveMaximum: number
    readonly clusterMindAdditionalSlots: number
  }
  readonly abilityMilestones: readonly AbilityMilestone[]
}

const hash = (value: string): string => createHash('sha256').update(value).digest('hex')
const identity = (prefix: string, ...parts: readonly (string | number)[]): string =>
  `${prefix}${hash(stableJsonStringify(parts))}`
const object = (value: unknown): Record<string, unknown> | null => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
)
const integer = (value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number => (
  Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum
)
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const expected = [...keys].sort()
  const actual = Object.keys(value).sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

const choiceRule = object((rulesJson as Record<string, unknown>)[RULE_ID])
const rawMechanics = object(choiceRule?.pokemonAdvancementChoiceMechanics)
const rawMove = object(rawMechanics?.moveLearning)
const rawAbilityResolution = object(rawMechanics?.abilityResolution)
const rawEvolution = object(rawMechanics?.evolution)
const rawPostEvolution = object(rawMechanics?.postEvolution)
const rawFormChoice = object(rawMechanics?.formChoice)
const rawMilestones = rawMechanics?.abilityMilestones
if (!choiceRule || !rawMechanics || rawMechanics.schemaVersion !== 1
  || rawMechanics.sourceEventPolicy !== 'immutable-level-threshold-event'
  || !rawMove || rawMove.candidateSource !== 'pokedex.level_up_moves'
  || rawMove.candidateLevelPolicy !== 'greater-than-before-and-at-most-after'
  || rawMove.activeMoveMaximum !== 6 || rawMove.clusterMindAdditionalSlots !== 2
  || rawMove.replacementRequiredAtMaximum !== true || rawMove.currentExactCanonicalRowResolves !== true
  || stableJsonStringify(rawMove.authoritativeResolutionSources) !== stableJsonStringify([
    'item-move-learning', 'breeding-permanent-move', 'settlement-attention-resolution',
  ])
  || !Array.isArray(rawMilestones)
  || !rawAbilityResolution
  || rawAbilityResolution.currentExactCanonicalRowsResolveOrdinals !== true
  || rawAbilityResolution.itemEvolutionMappingsResolveOrdinals !== true
  || rawAbilityResolution.settlementAttentionResolutionResolvesEvent !== true
  || !rawEvolution || rawEvolution.candidateSource !== 'pokedex.evolutions'
  || rawEvolution.optional !== true || rawEvolution.nextStageOnly !== true
  || rawEvolution.candidateRecordStageMustMatch !== true
  || rawEvolution.candidateLevelPolicy !== 'greater-than-before-and-at-most-after'
  || rawEvolution.conditionPolicy !== 'no-condition-field'
  || rawEvolution.itemTransitionPolicy !== 'exclude-reviewed-item-transition-pairs'
  || rawEvolution.multipleCanonicalCandidates !== 'explicit-form-choice'
  || rawEvolution.malformedOrUnsupportedCandidate !== 'provider-unavailable'
  || !rawPostEvolution || rawPostEvolution.source !== 'server-private-item-evolution-application'
  || rawPostEvolution.reviewStatAllocation !== true
  || rawPostEvolution.reviewMoveOpportunities !== true
  || rawPostEvolution.reviewInactiveEquipment !== true
  || rawPostEvolution.abilityMappingsAreResolved !== true
  || rawPostEvolution.currentAuthorityCanClearCompletedWork !== true
  || !rawFormChoice || rawFormChoice.genericInferenceFromSpeciesName !== false
  || rawFormChoice.itemFormOperationResolutionSuppressesDuplicate !== true) {
  throw new Error('Canonical Pokémon advancement-choice authority is unavailable or stale.')
}
const abilityMilestones: readonly AbilityMilestone[] = rawMilestones.map((value, index) => {
  const row = object(value)
  const expected = [
    { level: 1, ordinal: 1, tiers: ['basic'] },
    { level: 20, ordinal: 2, tiers: ['basic', 'advanced'] },
    { level: 40, ordinal: 3, tiers: ['basic', 'advanced', 'high'] },
  ][index]
  if (!row || !expected || row.level !== expected.level || row.ordinal !== expected.ordinal
    || stableJsonStringify(row.tiers) !== stableJsonStringify(expected.tiers)) {
    throw new Error('Canonical Pokémon Ability milestone authority is unavailable or stale.')
  }
  return Object.freeze({
    level: expected.level,
    ordinal: expected.ordinal,
    tiers: Object.freeze(expected.tiers as AbilityMilestone['tiers']),
  })
})
if (abilityMilestones.length !== 3) throw new Error('Canonical Pokémon Ability milestone authority is unavailable or stale.')
const mechanics: AdvancementChoiceMechanics = Object.freeze({
  moveLearning: Object.freeze({
    activeMoveMaximum: Number(rawMove.activeMoveMaximum),
    clusterMindAdditionalSlots: Number(rawMove.clusterMindAdditionalSlots),
  }),
  abilityMilestones: Object.freeze(abilityMilestones),
})
export const POKEMON_ADVANCEMENT_CHOICE_RULE_SHA256 = hash(stableJsonStringify(choiceRule))

const pokedex = pokedexJson as unknown as readonly PokedexRecord[]
const pokedexBySpecies = new Map<string, PokedexRecord>()
for (const row of pokedex) {
  if (!row || typeof row.species !== 'string' || pokedexBySpecies.has(row.species)) {
    throw new Error('Canonical Pokédex species authority is unavailable or duplicated.')
  }
  pokedexBySpecies.set(row.species, row)
}
const canonicalMoves = movesJson as unknown as Readonly<Record<string, { readonly name?: unknown }>>
const canonicalAbilities = abilitiesJson as unknown as Readonly<Record<string, { readonly name?: unknown }>>

const itemEvolutionRule = object((rulesJson as Record<string, unknown>)[ITEM_EVOLUTION_RULE_ID])
const itemEvolutionMechanics = object(itemEvolutionRule?.itemEvolutionMechanics)
const itemTransitions = itemEvolutionMechanics?.transitions
if (itemEvolutionMechanics?.schemaVersion !== 1 || !Array.isArray(itemTransitions)
  || itemEvolutionMechanics.transitionCount !== itemTransitions.length) {
  throw new Error('Canonical item Evolution transition authority is unavailable or stale.')
}
const itemTransitionPairs = new Set<string>()
for (const value of itemTransitions) {
  const row = object(value)
  if (!row || typeof row.fromSpecies !== 'string' || typeof row.toSpecies !== 'string'
    || typeof row.itemId !== 'string' || !integer(row.minimumLevel, 0, 100)
    || (row.requiredGender !== null && row.requiredGender !== 'Male' && row.requiredGender !== 'Female')) {
    throw new Error('Canonical item Evolution transition authority is malformed.')
  }
  itemTransitionPairs.add(`${row.fromSpecies}\u0000${row.toSpecies}`)
}

interface LevelEvent {
  readonly source: StoredEncounterSettlementAttentionSource
  readonly fact: StoredEncounterSettlementHistoryFact
  readonly levelBefore: number
  readonly levelAfter: number
}

const parseLevelEvent = (input: {
  readonly source: StoredEncounterSettlementAttentionSource
  readonly fact: StoredEncounterSettlementHistoryFact
  readonly stored: StoredSheetDocument
}): LevelEvent => {
  const { source, fact, stored } = input
  const payload = object(fact.payload)
  if (source.reason !== 'level-threshold' || source.audience !== 'owner'
    || source.entityKind !== 'pokemon-sheet'
    || source.entityId !== stored.slug || source.authority.kind !== 'sheet'
    || source.authority.id !== stored.slug || source.authority.revision > stored.revision
    || fact.factId !== source.sourceFactId || fact.kind !== 'experience-award'
    || fact.audience !== 'destination-owner'
    || fact.subjectKind !== 'sheet' || fact.subjectId !== stored.slug
    || fact.settlementId !== source.settlementId || fact.operationId !== source.operationId
    || fact.createdAtCampaignMinute !== source.createdAtCampaignMinute
    || !payload || !exactKeys(payload, ['amount', 'levelBefore', 'levelAfter'])
    || !integer(payload.amount, 1) || !integer(payload.levelBefore, 1, 100)
    || !integer(payload.levelAfter, 1, 100) || payload.levelAfter <= payload.levelBefore) {
    throw new Error('Level-threshold attention lost its exact immutable Experience event authority.')
  }
  return Object.freeze({
    source,
    fact,
    levelBefore: payload.levelBefore,
    levelAfter: payload.levelAfter,
  })
}

const currentMoveNames = (sheet: CharacterSheet): ReadonlySet<string> => {
  if (!Array.isArray(sheet.movelist ?? []) || !Array.isArray(sheet.appliedMoves ?? [])) {
    throw new Error('Pokémon choice detection requires bounded current Move arrays.')
  }
  const parseNames = (rows: readonly { readonly name?: unknown }[], label: string): readonly string[] => {
    const names = rows.map((row) => {
      if (!row || typeof row !== 'object' || typeof row.name !== 'string'
        || canonicalMoves[row.name]?.name !== row.name) {
        throw new Error(`Pokémon choice detection found ${label} without exact canonical identity.`)
      }
      return row.name
    })
    if (new Set(names).size !== names.length) {
      throw new Error(`Pokémon choice detection found duplicate ${label} identity.`)
    }
    return names
  }
  const activeNames = parseNames(sheet.movelist ?? [], 'active Move')
  parseNames(sheet.appliedMoves ?? [], 'applied Move evidence')
  return new Set(activeNames)
}

const currentResolvedAbilityNames = (sheet: CharacterSheet, species: PokedexRecord): ReadonlySet<string> => {
  if (!Array.isArray(sheet.abilities ?? [])) {
    throw new Error('Pokémon choice detection requires a bounded current Ability array.')
  }
  const natural = new Set(ABILITY_TIERS.flatMap(tier => species.abilities?.[tier] ?? []))
  for (const name of natural) {
    if (typeof name !== 'string' || canonicalAbilities[name]?.name !== name) {
      throw new Error('Current species has malformed canonical Ability authority.')
    }
  }
  const currentNames = (sheet.abilities ?? []).map((row) => {
    if (!row || typeof row.name !== 'string' || canonicalAbilities[row.name]?.name !== row.name) {
      throw new Error('Pokémon choice detection found malformed Ability authority.')
    }
    return row.name
  })
  if (new Set(currentNames).size !== currentNames.length) {
    throw new Error('Pokémon choice detection found duplicate current Ability identity.')
  }
  const resolved = new Set(currentNames.filter(name => natural.has(name)))
  const state = parseItemEvolutionState(sheet.serverPrivate?.itemEvolution)
  const currentApplication = state.applications.at(-1)
  if (currentApplication?.toSpeciesId === sheet.species) {
    for (const mapping of currentApplication.abilityMappings) {
      if (!currentNames.includes(mapping.toAbilityId)) {
        throw new Error('Item-Evolution Ability resolution is absent from current sheet authority.')
      }
      resolved.add(mapping.toAbilityId)
    }
  }
  return resolved
}

const eventRef = (events: readonly LevelEvent[]): {
  readonly kind: CampaignAttentionSourceEventKind
  readonly eventId: string
  readonly campaignMinute: number
} => Object.freeze({
  kind: 'encounter-settlement',
  eventId: identity(
    'campaign-attention-source:v1:',
    ...events.map(event => event.fact.factId).sort((left, right) => left.localeCompare(right)),
  ),
  campaignMinute: Math.max(...events.map(event => event.source.createdAtCampaignMinute)),
})

const attentionItem = (input: {
  readonly stored: StoredSheetDocument
  readonly reason: CampaignAttentionReason
  readonly urgency: CampaignAttentionUrgency
  readonly decision: CampaignAttentionDecisionKind
  readonly intent: CampaignAttentionActionIntent
  readonly hrefSection: string
  readonly sourceEvent: ReturnType<typeof eventRef> | {
    readonly kind: CampaignAttentionSourceEventKind
    readonly eventId: string
    readonly campaignMinute: number
  }
}): CampaignAttentionItem => {
  const authority = Object.freeze({ kind: 'sheet' as const, id: input.stored.slug, revision: input.stored.revision })
  const itemId = identity(
    'campaign-attention:v1:',
    'pokemon-choice',
    input.stored.slug,
    input.reason,
    input.sourceEvent.kind,
    input.sourceEvent.eventId,
  )
  return createOpenCampaignAttentionItem({
    itemId,
    reason: input.reason,
    audience: 'owner',
    urgency: input.urgency,
    entity: Object.freeze({ kind: 'pokemon-sheet', id: input.stored.slug }),
    sourceEvent: input.sourceEvent,
    authority,
    requiredDecision: Object.freeze({
      decisionId: identity('campaign-attention-decision:v1:', itemId),
      kind: input.decision,
      authority,
    }),
    legalActions: Object.freeze([Object.freeze({
      actionId: identity('campaign-attention-action:v1:', itemId, input.intent),
      intent: input.intent,
      href: `/sheets/pokemon/${encodeURIComponent(input.stored.slug)}?attention=${input.hrefSection}`,
      authority,
      requiresConfirmation: false,
    })]),
    createdAtCampaignMinute: input.sourceEvent.campaignMinute,
  })
}

const levelMovePending = (input: {
  readonly events: readonly LevelEvent[]
  readonly species: PokedexRecord
  readonly currentMoves: ReadonlySet<string>
}): boolean => {
  const levelMoves = input.species.level_up_moves ?? []
  for (const move of levelMoves) {
    if (!integer(move.level, 1, 100) || typeof move.name !== 'string'
      || canonicalMoves[move.name]?.name !== move.name) {
      throw new Error('Current species has malformed canonical level-up Move authority.')
    }
  }
  return input.events.some(event => levelMoves.some(move => (
    move.level > event.levelBefore && move.level <= event.levelAfter
    && !input.currentMoves.has(move.name)
  )))
}

const abilityPending = (input: {
  readonly events: readonly LevelEvent[]
  readonly species: PokedexRecord
  readonly currentAbilities: ReadonlySet<string>
}): boolean => {
  const crossed = mechanics.abilityMilestones.filter(milestone => input.events.some(event => (
    milestone.level > event.levelBefore && milestone.level <= event.levelAfter
  )))
  const target = crossed.at(-1)
  if (!target || input.currentAbilities.size >= target.ordinal) return false
  const options = new Set(target.tiers.flatMap(tier => input.species.abilities?.[tier] ?? []))
  for (const option of options) {
    if (canonicalAbilities[option]?.name !== option) {
      throw new Error('Current species has malformed canonical Ability option authority.')
    }
  }
  if ([...options].every(option => input.currentAbilities.has(option))) {
    throw new Error('Current Ability milestone has no complete legal canonical option set.')
  }
  return true
}

const evolutionChoice = (input: {
  readonly events: readonly LevelEvent[]
  readonly species: PokedexRecord
}): 'evolution-choice' | 'form-choice' | null => {
  if (!integer(input.species.evolution_stage, 1, 3)) {
    throw new Error('Current species has malformed canonical Evolution-stage authority.')
  }
  const evolutionStage = input.species.evolution_stage
  const relevant = (input.species.evolutions ?? []).filter(row => input.events.some(event => (
    integer(row.min_level, 1, 100)
    && row.min_level > event.levelBefore
    && row.min_level <= event.levelAfter
    && row.stage === evolutionStage + 1
  )))
  if (relevant.length === 0) return null
  if (relevant.some(row => Object.prototype.hasOwnProperty.call(row, 'condition'))) return null
  if (relevant.some((row) => {
    const target = pokedexBySpecies.get(row.species)
    return !target || target.evolution_stage !== row.stage
  })) return null
  const candidates = relevant.filter(row => (
    !itemTransitionPairs.has(`${input.species.species}\u0000${row.species}`)
  ))
  if (candidates.length === 0) return null
  if (new Set(candidates.map(row => row.species)).size !== candidates.length) {
    throw new Error('Current species has duplicate canonical Evolution candidate authority.')
  }
  return candidates.length > 1 ? 'form-choice' : 'evolution-choice'
}

const acceptedItemOperation = (input: {
  readonly application: ReturnType<typeof parseItemEvolutionState>['applications'][number]
  readonly stored: StoredSheetDocument
  readonly operations: ReadonlyMap<string, StoredItemOperationRecord>
  readonly currentCampaignMinute: number
}): StoredItemOperationRecord => {
  const { application, stored } = input
  const operation = input.operations.get(application.sourceOperationId)
  const plan = operation?.plan
  const result = operation?.result
  const context = plan?.nonEncounterContext
  const targetAuthorities = context?.targetAuthorities.filter(target => (
    target.sheetKind === 'pokemon'
    && target.sheetSlug === stored.slug
    && target.sheetRevision === application.targetRevisionBefore
  )) ?? []
  const matchingEvolutionOperations = plan?.operations.filter((entry) => {
    const payload = object(entry.payload)
    return entry.aggregate.kind === 'sheet'
      && entry.aggregate.sheetKind === 'pokemon'
      && entry.aggregate.id === stored.slug
      && entry.aggregate.revision === application.targetRevisionBefore
      && targetAuthorities.some(target => target.targetId === entry.subjectId)
      && payload?.action === 'evolve-pokemon'
      && payload.sourceOperationId === application.sourceOperationId
      && stableJsonStringify(payload.application) === stableJsonStringify(application)
  }) ?? []
  if (!operation || operation.status !== 'accepted' || !result
    || result.status !== 'accepted' || plan?.operationId !== application.sourceOperationId
    || result.operationId !== application.sourceOperationId
    || operation.canonicalItemId !== application.canonicalItemId
    || operation.canonicalDefinitionSha256 !== application.canonicalDefinitionSha256
    || plan.canonicalItemId !== application.canonicalItemId
    || plan.canonicalDefinitionSha256 !== application.canonicalDefinitionSha256
    || result.canonicalItemId !== application.canonicalItemId
    || targetAuthorities.length !== 1 || matchingEvolutionOperations.length !== 1 || !context
    || context.campaignTime.campaignMinute > input.currentCampaignMinute) {
    throw new Error('Post-evolution attention lost its exact accepted item-operation authority.')
  }
  return operation
}

const postEvolutionItem = (input: {
  readonly stored: StoredSheetDocument
  readonly sheet: CharacterSheet
  readonly currentMoves: ReadonlySet<string>
  readonly operations: ReadonlyMap<string, StoredItemOperationRecord>
  readonly campaignMinute: number
}): CampaignAttentionItem | null => {
  const state = parseItemEvolutionState(input.sheet.serverPrivate?.itemEvolution)
  const application = state.applications.at(-1)
  if (!application || application.toSpeciesId !== input.sheet.species) return null
  const operation = acceptedItemOperation({
    application,
    stored: input.stored,
    operations: input.operations,
    currentCampaignMinute: input.campaignMinute,
  })
  const statPending = !state.statResolutions.some(row => row.sourceOperationId === application.sourceOperationId)
  const movePending = application.moveOpportunityIds.some(moveId => !input.currentMoves.has(moveId))
  let equipmentPending = false
  if (application.inactiveEquipmentItemIds.length > 0) {
    if (!input.sheet.equipmentState) {
      throw new Error('Post-evolution equipment review lost its exact current equipment authority.')
    }
    const equipment = parseSheetEquipmentStateForOwner(input.sheet.equipmentState, {
      kind: 'pokemon', slug: input.stored.slug,
    })
    const inactive = new Set(application.inactiveEquipmentItemIds)
    equipmentPending = equipment.instances.some(instance => (
      inactive.has(instance.canonicalItemId) && instance.activity.status !== 'active'
    ))
  }
  if (!statPending && !movePending && !equipmentPending) return null
  return attentionItem({
    stored: input.stored,
    reason: 'post-evolution-review',
    urgency: equipmentPending ? 'urgent' : 'normal',
    decision: 'review-post-evolution',
    intent: 'review-post-evolution',
    hrefSection: 'post-evolution',
    sourceEvent: Object.freeze({
      kind: 'item-operation',
      eventId: identity('campaign-attention-source:v1:', application.sourceOperationId),
      campaignMinute: operation.plan!.nonEncounterContext!.campaignTime.campaignMinute,
    }),
  })
}

const projectForSheet = (input: {
  readonly stored: StoredSheetDocument
  readonly sources: readonly StoredEncounterSettlementAttentionSource[]
  readonly facts: ReadonlyMap<string, StoredEncounterSettlementHistoryFact>
  readonly operations: ReadonlyMap<string, StoredItemOperationRecord>
  readonly campaignMinute: number
}): readonly CampaignAttentionItem[] => {
  const raw = object(input.stored.document)
  if (!raw || raw.slug !== input.stored.slug || typeof raw.species !== 'string'
    || !integer(raw.level, 1, 100) || !integer(input.stored.revision)) {
    throw new Error('Pokémon choice detection requires one valid exact current sheet authority.')
  }
  const sheet = raw as unknown as CharacterSheet
  const species = pokedexBySpecies.get(sheet.species)
  if (!species) throw new Error('Pokémon choice detection requires exact canonical species authority.')
  assertCurrentItemMoveLearningAuthority(sheet)
  assertCurrentItemEvolutionAuthority(sheet)
  const currentMoves = currentMoveNames(sheet)
  const currentAbilities = currentResolvedAbilityNames(sheet, species)
  const events = input.sources.filter(source => (
    source.reason === 'level-threshold'
    && source.entityKind === 'pokemon-sheet'
    && source.entityId === input.stored.slug
  )).map((source) => {
    const fact = input.facts.get(source.sourceFactId)
    if (!fact) throw new Error('Level-threshold attention source lost its immutable history fact.')
    return parseLevelEvent({ source, fact, stored: input.stored })
  })
  for (const event of events) {
    const resolutionValid = event.source.status === 'open'
      ? event.source.revision === 0
        && event.source.resolvedAtCampaignMinute === null
        && event.source.resolutionOperationId === null
      : event.source.status === 'resolved'
        && event.source.revision >= 1
        && event.source.resolvedAtCampaignMinute !== null
        && event.source.resolvedAtCampaignMinute >= event.source.createdAtCampaignMinute
        && event.source.resolutionOperationId !== null
    if (!resolutionValid || event.source.createdAtCampaignMinute > input.campaignMinute
      || event.fact.createdAtCampaignMinute > input.campaignMinute) {
      throw new Error('Level-threshold attention has malformed or future lifecycle authority.')
    }
    if (event.levelAfter > sheet.level) {
      throw new Error('Level-threshold attention is newer than current Pokémon Level authority.')
    }
  }
  const openEvents = events.filter(event => event.source.status === 'open')
  const items: CampaignAttentionItem[] = []
  if (openEvents.length > 0) {
    const sourceEvent = eventRef(openEvents)
    if (levelMovePending({ events: openEvents, species, currentMoves })) {
      const clusterMind = currentAbilities.has('Cluster Mind')
      const activeMaximum = mechanics.moveLearning.activeMoveMaximum
        + (clusterMind ? mechanics.moveLearning.clusterMindAdditionalSlots : 0)
      if (currentMoves.size > activeMaximum) {
        throw new Error('Current Pokémon Move count exceeds canonical advancement-choice authority.')
      }
      items.push(attentionItem({
        stored: input.stored,
        reason: 'move-learning',
        urgency: currentMoves.size === activeMaximum ? 'urgent' : 'normal',
        decision: 'choose-move',
        intent: 'review-moves',
        hrefSection: 'moves',
        sourceEvent,
      }))
    }
    if (abilityPending({ events: openEvents, species, currentAbilities })) {
      items.push(attentionItem({
        stored: input.stored,
        reason: 'ability-choice',
        urgency: 'normal',
        decision: 'choose-ability',
        intent: 'review-abilities',
        hrefSection: 'abilities',
        sourceEvent,
      }))
    }
    const evolution = evolutionChoice({ events: openEvents, species })
    if (evolution) {
      items.push(attentionItem({
        stored: input.stored,
        reason: evolution,
        urgency: 'normal',
        decision: evolution === 'form-choice' ? 'choose-form' : 'choose-evolution',
        intent: evolution === 'form-choice' ? 'review-form' : 'review-evolution',
        hrefSection: evolution === 'form-choice' ? 'form' : 'evolution',
        sourceEvent,
      }))
    }
  }
  const postEvolution = postEvolutionItem({
    stored: input.stored,
    sheet,
    currentMoves,
    operations: input.operations,
    campaignMinute: input.campaignMinute,
  })
  if (postEvolution) items.push(postEvolution)
  return Object.freeze(items)
}

export const projectCampaignPokemonChoiceAttention = (input: {
  readonly sheets: readonly StoredSheetDocument[]
  readonly settlementSources: readonly StoredEncounterSettlementAttentionSource[]
  readonly historyFacts: readonly StoredEncounterSettlementHistoryFact[]
  readonly itemOperations: readonly StoredItemOperationRecord[]
  readonly campaignMinute: number
  readonly completeness: {
    readonly sheets: true
    readonly settlementSources: true
    readonly historyFacts: true
    readonly itemOperations: true
  }
}): readonly CampaignAttentionItem[] => {
  if (input.completeness.sheets !== true || input.completeness.settlementSources !== true
    || input.completeness.historyFacts !== true || input.completeness.itemOperations !== true) {
    throw new Error('Pokémon choice attention requires one complete current authority read.')
  }
  if (!integer(input.campaignMinute) || input.sheets.length > LIMIT
    || input.settlementSources.length > LIMIT || input.historyFacts.length > LIMIT
    || input.itemOperations.length > LIMIT) {
    throw new Error(`Pokémon choice attention inputs must be complete and bounded to ${LIMIT} records.`)
  }
  const sheetKeys = input.sheets.map(sheet => `${sheet.kind}:${sheet.slug}`)
  const sourceIds = input.settlementSources.map(source => source.sourceId)
  const factIds = input.historyFacts.map(fact => fact.factId)
  const operationIds = input.itemOperations.map(operation => operation.operationId)
  if (new Set(sheetKeys).size !== sheetKeys.length || new Set(sourceIds).size !== sourceIds.length
    || new Set(factIds).size !== factIds.length || new Set(operationIds).size !== operationIds.length) {
    throw new Error('Pokémon choice attention inputs contain duplicate authority identity.')
  }
  const facts = new Map(input.historyFacts.map(fact => [fact.factId, fact]))
  const operations = new Map(input.itemOperations.map(operation => [operation.operationId, operation]))
  const pokemon = input.sheets.filter(sheet => sheet.kind === 'pokemon')
  const pokemonSlugs = new Set(pokemon.map(sheet => sheet.slug))
  if (input.settlementSources.some(source => (
    source.reason === 'level-threshold'
    && source.entityKind === 'pokemon-sheet'
    && !pokemonSlugs.has(source.entityId)
  ))) {
    throw new Error('Level-threshold attention points to a missing current Pokémon sheet.')
  }
  const items = pokemon.flatMap(stored => projectForSheet({
    stored,
    sources: input.settlementSources,
    facts,
    operations,
    campaignMinute: input.campaignMinute,
  }))
  if (items.length > LIMIT || new Set(items.map(item => item.itemId)).size !== items.length) {
    throw new Error('Pokémon choice attention providers produced overflow or duplicate item identity.')
  }
  const urgencyRank: Readonly<Record<CampaignAttentionUrgency, number>> = {
    blocking: 0, urgent: 1, normal: 2, informational: 3,
  }
  return Object.freeze(items.sort((left, right) => (
    urgencyRank[left.urgency] - urgencyRank[right.urgency]
    || left.entity.id.localeCompare(right.entity.id)
    || left.reason.localeCompare(right.reason)
    || left.itemId.localeCompare(right.itemId)
  )))
}

export const CAMPAIGN_POKEMON_CHOICE_ATTENTION_LIMIT = LIMIT
