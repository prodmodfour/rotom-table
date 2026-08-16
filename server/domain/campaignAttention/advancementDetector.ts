import { createHash } from 'node:crypto'
import pokedexJson from '../../../data/reference/pokedex.json'
import {
  createOpenCampaignAttentionItem,
  type CampaignAttentionItem,
  type CampaignAttentionReason,
  type CampaignAttentionUrgency,
} from '../../../shared/campaignAttention/model'
import type { StoredSheetDocument } from '../../storage/sheetRepository'
import type { StoredEncounterSettlementAttentionSource } from '../../storage/encounterSettlementRepository'
import { campaignAttentionItemsFromSettlementSources } from './settlementProvider'
import type { CharacterSheet, StatKey } from '../../../src/types/characterSheet'
import type { TrainerSheet, TrainerStatKey } from '../../../src/types/trainerSheet'
import {
  pokemonAddedStatPointBudget,
  pokemonBaseRelationWaivers,
  resolveStats,
  validateBaseRelations,
} from '../../../src/utils/sheets/pokemonDerived'
import { calculatePokemonLevelFromExperience } from '../../../src/utils/sheets/pokemonExperience'
import { computeTrainerLevelUpStatPointBudget } from '../../../src/utils/statPointBudgets'
import { trainerMilestoneStatPointBudgetBonus } from './trainerChoiceDetector'

const SHEET_LIMIT = 10_000
const POKEMON_STATS: readonly StatKey[] = ['hp', 'atk', 'def', 'satk', 'sdef', 'spd']
const TRAINER_STATS: readonly TrainerStatKey[] = ['hp', 'atk', 'def', 'satk', 'sdef', 'spd']
const POKEDEX_SPECIES = new Set((pokedexJson as readonly { readonly species?: unknown }[])
  .flatMap(row => typeof row.species === 'string' ? [row.species] : []))

type Detection = 'level-threshold' | 'unspent-advancement' | 'invalid-advancement' | null

const identity = (prefix: string, ...parts: readonly (string | number)[]): string =>
  `${prefix}${createHash('sha256').update(JSON.stringify(parts)).digest('hex')}`

const record = (value: unknown): Record<string, unknown> | null => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
)
const boundedInteger = (value: unknown, minimum: number, maximum: number): value is number => (
  Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum
)
const optionalPoint = (value: unknown): number | null => {
  if (value === undefined) return 0
  return boundedInteger(value, 0, Number.MAX_SAFE_INTEGER) ? value : null
}

const pokemonDetection = (stored: StoredSheetDocument): Detection => {
  const document = record(stored.document)
  if (!document || document.slug !== stored.slug
    || typeof document.species !== 'string' || !POKEDEX_SPECIES.has(document.species)
    || !boundedInteger(document.level, 1, 100)) return 'invalid-advancement'

  const totalExp = document.totalExp
  let reachedLevel = false
  if (totalExp !== undefined) {
    if (!boundedInteger(totalExp, 0, Number.MAX_SAFE_INTEGER)) return 'invalid-advancement'
    const experienceLevel = calculatePokemonLevelFromExperience(totalExp)
    if (experienceLevel === undefined || experienceLevel < document.level) return 'invalid-advancement'
    reachedLevel = experienceLevel > document.level
  }

  const stats = record(document.stats)
  if (document.stats !== undefined && !stats) return 'invalid-advancement'
  let spent = 0
  for (const key of POKEMON_STATS) {
    const row = record(stats?.[key])
    if (stats?.[key] !== undefined && !row) return 'invalid-advancement'
    const point = optionalPoint(row?.added)
    if (point === null || !Number.isSafeInteger(spent + point)) return 'invalid-advancement'
    spent += point
  }

  try {
    const sheet = document as unknown as CharacterSheet
    const budget = pokemonAddedStatPointBudget(sheet)
    if (!boundedInteger(budget, 0, Number.MAX_SAFE_INTEGER) || spent > budget) return 'invalid-advancement'
    if (validateBaseRelations(resolveStats(sheet), pokemonBaseRelationWaivers(sheet)).length > 0) {
      return 'invalid-advancement'
    }
    if (reachedLevel) return 'level-threshold'
    return spent < budget ? 'unspent-advancement' : null
  }
  catch {
    return 'invalid-advancement'
  }
}

const trainerDetection = (stored: StoredSheetDocument): Detection => {
  const document = record(stored.document)
  if (!document || document.slug !== stored.slug) return 'invalid-advancement'
  const level = document.level === undefined ? 1 : document.level
  if (!boundedInteger(level, 1, 50)) return 'invalid-advancement'
  const stats = record(document.stats)
  if (document.stats !== undefined && !stats) return 'invalid-advancement'
  let spent = 0
  for (const key of TRAINER_STATS) {
    const row = record(stats?.[key])
    if (stats?.[key] !== undefined && !row) return 'invalid-advancement'
    const point = optionalPoint(row?.levelUp)
    if (point === null || !Number.isSafeInteger(spent + point)) return 'invalid-advancement'
    spent += point
  }
  let milestoneBonus = 0
  try {
    milestoneBonus = trainerMilestoneStatPointBudgetBonus({ ...document, level } as unknown as TrainerSheet)
  }
  catch {
    return 'invalid-advancement'
  }
  const budget = computeTrainerLevelUpStatPointBudget(level) + milestoneBonus
  if (!boundedInteger(budget, 0, Number.MAX_SAFE_INTEGER) || spent > budget) return 'invalid-advancement'
  return spent < budget ? 'unspent-advancement' : null
}

const detectionPolicy = (detection: Exclude<Detection, null>): {
  readonly urgency: CampaignAttentionUrgency
  readonly decision: 'allocate-advancement' | 'repair-advancement'
} => detection === 'unspent-advancement'
  ? { urgency: 'normal', decision: 'allocate-advancement' }
  : { urgency: 'blocking', decision: 'repair-advancement' }

export const detectSheetAdvancementAttention = (input: {
  readonly stored: StoredSheetDocument
  readonly campaignMinute: number
}): CampaignAttentionItem | null => {
  if (!boundedInteger(input.campaignMinute, 0, Number.MAX_SAFE_INTEGER)) {
    throw new Error('Advancement attention requires a non-negative safe campaign minute.')
  }
  if (!boundedInteger(input.stored.revision, 0, Number.MAX_SAFE_INTEGER)) {
    throw new Error('Advancement attention requires an exact non-negative sheet revision.')
  }
  const detection = input.stored.kind === 'pokemon'
    ? pokemonDetection(input.stored)
    : trainerDetection(input.stored)
  if (!detection) return null
  const policy = detectionPolicy(detection)
  const entityKind = input.stored.kind === 'pokemon' ? 'pokemon-sheet' as const : 'trainer-sheet' as const
  const authority = Object.freeze({ kind: 'sheet' as const, id: input.stored.slug, revision: input.stored.revision })
  const sourceEventId = identity(
    'campaign-attention-source:v1:', 'sheet-authority', input.stored.kind,
    input.stored.slug, input.stored.revision,
  )
  const itemId = identity(
    'campaign-attention:v1:', 'sheet-advancement', input.stored.kind,
    input.stored.slug, detection,
  )
  return createOpenCampaignAttentionItem({
    itemId,
    reason: detection satisfies CampaignAttentionReason,
    audience: 'owner',
    urgency: policy.urgency,
    entity: Object.freeze({ kind: entityKind, id: input.stored.slug }),
    sourceEvent: Object.freeze({
      kind: 'sheet-authority',
      eventId: sourceEventId,
      campaignMinute: input.campaignMinute,
    }),
    authority,
    requiredDecision: Object.freeze({
      decisionId: identity('campaign-attention-decision:v1:', itemId),
      kind: policy.decision,
      authority,
    }),
    legalActions: Object.freeze([Object.freeze({
      actionId: identity('campaign-attention-action:v1:', itemId, 'review-advancement'),
      intent: 'review-advancement',
      href: input.stored.kind === 'pokemon'
        ? `/sheets/pokemon/${encodeURIComponent(input.stored.slug)}`
        : `/sheets/trainers/${encodeURIComponent(input.stored.slug)}`,
      authority,
      requiresConfirmation: false,
    })]),
    createdAtCampaignMinute: input.campaignMinute,
  })
}

export const detectCampaignSheetAdvancementAttention = (input: {
  readonly sheets: readonly StoredSheetDocument[]
  readonly campaignMinute: number
}): readonly CampaignAttentionItem[] => {
  if (input.sheets.length > SHEET_LIMIT) {
    throw new Error(`Advancement attention detection is limited to ${SHEET_LIMIT} sheets.`)
  }
  const keys = input.sheets.map(stored => `${stored.kind}:${stored.slug}`)
  if (new Set(keys).size !== keys.length) {
    throw new Error('Advancement attention requires unique current sheet authorities.')
  }
  const items = input.sheets.flatMap((stored) => {
    const item = detectSheetAdvancementAttention({ stored, campaignMinute: input.campaignMinute })
    return item ? [item] : []
  })
  const urgencyRank: Readonly<Record<CampaignAttentionUrgency, number>> = {
    blocking: 0, urgent: 1, normal: 2, informational: 3,
  }
  return Object.freeze(items.sort((left, right) => (
    urgencyRank[left.urgency] - urgencyRank[right.urgency]
    || left.entity.kind.localeCompare(right.entity.kind)
    || left.entity.id.localeCompare(right.entity.id)
    || left.itemId.localeCompare(right.itemId)
  )))
}

export const projectCampaignAdvancementAttention = (input: {
  readonly sheets: readonly StoredSheetDocument[]
  readonly settlementSources: readonly StoredEncounterSettlementAttentionSource[]
  readonly campaignMinute: number
}): readonly CampaignAttentionItem[] => {
  if (input.settlementSources.length > SHEET_LIMIT) {
    throw new Error(`Advancement attention projection is limited to ${SHEET_LIMIT} settlement sources.`)
  }
  const sourceItems = campaignAttentionItemsFromSettlementSources(input.settlementSources.filter(source => (
    source.reason === 'level-threshold' || source.reason === 'advancement-review'
  )))
  const sheetItems = detectCampaignSheetAdvancementAttention({
    sheets: input.sheets,
    campaignMinute: input.campaignMinute,
  })
  const items = [...sourceItems, ...sheetItems]
  if (items.length > SHEET_LIMIT) {
    throw new Error(`Advancement attention projection is limited to ${SHEET_LIMIT} items.`)
  }
  if (new Set(items.map(item => item.itemId)).size !== items.length) {
    throw new Error('Advancement attention providers must produce unique item identities.')
  }
  const urgencyRank: Readonly<Record<CampaignAttentionUrgency, number>> = {
    blocking: 0, urgent: 1, normal: 2, informational: 3,
  }
  return Object.freeze(items.sort((left, right) => (
    urgencyRank[left.urgency] - urgencyRank[right.urgency]
    || left.entity.kind.localeCompare(right.entity.kind)
    || left.entity.id.localeCompare(right.entity.id)
    || left.itemId.localeCompare(right.itemId)
  )))
}

export const CAMPAIGN_ADVANCEMENT_ATTENTION_SHEET_LIMIT = SHEET_LIMIT
