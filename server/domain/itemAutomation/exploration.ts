import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  ITEM_EXPLORATION_LIMITS,
  ITEM_EXPLORATION_SHARD_COLORS,
  parseItemExplorationState,
  type ItemDowsingUseV1,
  type ItemExplorationShardColor,
  type ItemExplorationStateV1,
  type ItemRepelCampaignEffectV1,
  type ItemRouteLureActivityV1,
} from '#shared/itemAutomation/exploration'
import { edgeChoiceValues } from '#shared/edgeAutomation/instances'
import { resolvedSheetEdgeInstances } from '#shared/edgeAutomation/sheetEdges'
import type { ItemRuntimeDefinition } from '#shared/itemAutomation/spec'
import type { InventoryEntry, TrainerSheet } from '~/types/trainerSheet'
import { resolveTrainerSkills } from '~/utils/sheets/trainerDerived'
import { hasEffectiveFeature } from '../featureAutomation/effectiveFeatures'

export const ITEM_EXPLORATION_USE_MODE_CHOICE_ID = 'exploration-use-mode' as const
export const ITEM_DOWSING_TERRAIN_CHOICE_ID = 'dowsing-terrain' as const
export const ITEM_DOWSING_SKILL_STUNT_CHOICE_ID = 'dowsing-skill-stunt' as const
export const ITEM_EXPLORATION_USE_MODES = [
  'route-lure', 'wild-distraction', 'snack', 'route-ward', 'wild-spray',
] as const
export type ItemExplorationUseMode = typeof ITEM_EXPLORATION_USE_MODES[number]
export const ITEM_DOWSING_TERRAINS = [
  'ordinary', 'beach', 'cave', 'desert', 'sandy-or-rocky',
] as const
export type ItemDowsingTerrain = typeof ITEM_DOWSING_TERRAINS[number]

export interface ItemExplorationChoiceOption {
  readonly optionId: string
  readonly label: string
  readonly description: string | null
}

const hashId = (prefix: string, value: unknown): string => `${prefix}${createHash('sha256')
  .update(stableJsonStringify(value)).digest('hex').slice(0, 32)}`

const activeRouteLure = (activity: ItemRouteLureActivityV1): boolean => (
  activity.status === 'active' || activity.status === 'awaiting-encounter'
)

export const explorationUseModeOptions = (input: {
  readonly definition: ItemRuntimeDefinition
  readonly context: 'encounter' | 'sheet' | 'campaign' | 'extended-action' | 'workshop'
}): readonly ItemExplorationChoiceOption[] => {
  const effect = input.definition.spec.effects[0]
  const option = (optionId: ItemExplorationUseMode, label: string, description: string): ItemExplorationChoiceOption => ({
    optionId, label, description,
  })
  if (effect?.operation === 'use-bait') return Object.freeze(input.context === 'encounter'
    ? [option('wild-distraction', 'Distract wild Pokémon', 'Focus DC 12 · failed check forfeits its next Standard Action')]
    : [option('route-lure', 'Set route bait', 'Up to three server-rolled checks at 15-minute campaign intervals')])
  if (effect?.operation === 'use-repel') return Object.freeze(input.context === 'encounter'
    ? [option('wild-spray', 'Spray wild Pokémon', `AC ${effect.directBaseAc} · hit forces an immediate Shift away and forfeits its next Shift`)]
    : [option('route-ward', 'Ward the route', `${effect.durationMinutes} campaign minutes · wild Pokémon through Level ${effect.maximumAffectedWildLevel} flee`)])
  if (effect?.operation === 'use-snack-or-bait') return Object.freeze(input.context === 'encounter'
    ? [
        option('snack', 'Store as Snack', 'Stores Honey as a 5 HP Digestion Buff'),
        option('wild-distraction', 'Distract wild Pokémon', 'Focus DC 12 · failed check forfeits its next Standard Action'),
      ]
    : [
        option('snack', 'Store as Snack', 'Stores Honey as a 5 HP Digestion Buff'),
        option('route-lure', 'Set route bait', 'Up to three server-rolled checks at 15-minute campaign intervals'),
      ])
  return Object.freeze([])
}

const normalized = (value: string): string => value.normalize('NFKC').trim().toLocaleLowerCase('en-US')

export const dowsingSkillStuntOptions = (sheet: TrainerSheet): readonly ItemExplorationChoiceOption[] => Object.freeze(
  resolvedSheetEdgeInstances(sheet, 'trainer')
    .filter(instance => instance.canonicalId === 'Skill Stunt'
      && edgeChoiceValues(instance, 'skill').includes('occultEd')
      && edgeChoiceValues(instance, 'circumstance').some(value => normalized(value) === 'dowsing'))
    .map(instance => ({
      optionId: instance.instanceId,
      label: 'Skill Stunt — Dowsing',
      description: 'Adds the reviewed Dowsing bonus die to this search.',
    })),
)

export const dowsingTerrainOptions = (): readonly ItemExplorationChoiceOption[] => Object.freeze([
  { optionId: 'ordinary', label: 'Ordinary route or outside area', description: 'No terrain bonus die.' },
  { optionId: 'beach', label: 'Beach', description: '+1 terrain die.' },
  { optionId: 'cave', label: 'Cave', description: '+1 terrain die.' },
  { optionId: 'desert', label: 'Desert', description: '+1 terrain die.' },
  { optionId: 'sandy-or-rocky', label: 'Sandy or rocky area', description: '+1 terrain die.' },
])

export const startItemRouteLure = (input: {
  readonly current: unknown
  readonly definition: ItemRuntimeDefinition
  readonly sourceOperationId: string
  readonly sourceInstanceId: string
  readonly campaignMinute: number
}): { readonly state: ItemExplorationStateV1, readonly activity: ItemRouteLureActivityV1 } => {
  const state = parseItemExplorationState(input.current)
  const effect = input.definition.spec.effects[0]
  const canonicalItemId = input.definition.canonicalId
  if ((effect?.operation !== 'use-bait' && effect?.operation !== 'start-route-lure'
    && effect?.operation !== 'use-snack-or-bait')
    || (canonicalItemId !== 'Bait' && canonicalItemId !== 'Fishing Lure' && canonicalItemId !== 'Honey')) {
    throw new Error('The item definition does not authorize a route lure.')
  }
  if (!Number.isSafeInteger(input.campaignMinute) || input.campaignMinute < 0
    || input.campaignMinute > Number.MAX_SAFE_INTEGER - 45) {
    throw new Error('Route lure timing exceeds the safe campaign-clock range.')
  }
  if (state.routeLures.some(activeRouteLure)) {
    throw new Error('This Trainer already has an unresolved route lure activity.')
  }
  if (state.routeLures.some(activity => activity.sourceOperationId === input.sourceOperationId)) {
    throw new Error('This route lure operation was already recorded.')
  }
  const reusable = effect.operation === 'start-route-lure'
  const activity: ItemRouteLureActivityV1 = {
    activityId: hashId('item-route-lure:v1:', {
      sourceOperationId: input.sourceOperationId,
      sourceInstanceId: input.sourceInstanceId,
      definitionSha256: input.definition.definitionSha256,
    }),
    sourceOperationId: input.sourceOperationId,
    canonicalItemId,
    canonicalDefinitionSha256: input.definition.definitionSha256,
    sourceInstanceId: input.sourceInstanceId,
    reusable,
    startedAtCampaignMinute: input.campaignMinute,
    nextCheckAtCampaignMinute: input.campaignMinute + 15,
    status: 'active',
    attempts: [],
    outcome: null,
  }
  return Object.freeze({
    activity,
    state: parseItemExplorationState({
      ...state,
      routeLures: [...state.routeLures.slice(-(ITEM_EXPLORATION_LIMITS.routeLures - 1)), activity],
    }),
  })
}

export const resolveItemRouteLureCheck = (input: {
  readonly current: unknown
  readonly activityId: string
  readonly campaignMinute: number
  readonly roll: number
}): { readonly state: ItemExplorationStateV1, readonly activity: ItemRouteLureActivityV1 } => {
  const state = parseItemExplorationState(input.current)
  const matches = state.routeLures.flatMap((activity, index) => activity.activityId === input.activityId ? [{ activity, index }] : [])
  if (matches.length !== 1) throw new Error('The exact route lure activity is unavailable.')
  const { activity, index } = matches[0]!
  if (activity.status !== 'active' || activity.nextCheckAtCampaignMinute === null) {
    throw new Error('This route lure is not awaiting a timed check.')
  }
  if (!Number.isSafeInteger(input.campaignMinute) || input.campaignMinute < activity.nextCheckAtCampaignMinute) {
    throw new Error('The next route lure check is not due on the campaign clock.')
  }
  if (!Number.isSafeInteger(input.roll) || input.roll < 1 || input.roll > 20) {
    throw new Error('Route lure checks require a bounded server-owned d20 roll.')
  }
  const attemptNumber = activity.attempts.length + 1
  if (attemptNumber < 1 || attemptNumber > 3) throw new Error('The route lure has no remaining checks.')
  const success = input.roll >= 15
  const attempts = [...activity.attempts, {
    attempt: attemptNumber as 1 | 2 | 3,
    dueAtCampaignMinute: activity.nextCheckAtCampaignMinute,
    resolvedAtCampaignMinute: input.campaignMinute,
    roll: input.roll,
    success,
  }]
  const next: ItemRouteLureActivityV1 = {
    ...activity,
    attempts,
    status: success ? 'awaiting-encounter' : attemptNumber === 3 ? 'completed' : 'active',
    nextCheckAtCampaignMinute: success || attemptNumber === 3
      ? null : activity.startedAtCampaignMinute + (attemptNumber + 1) * 15,
    outcome: !success && attemptNumber === 3 ? 'no-encounter' : null,
  }
  const rows = [...state.routeLures]
  rows[index] = next
  return Object.freeze({ state: parseItemExplorationState({ ...state, routeLures: rows }), activity: next })
}

export const settleItemRouteLure = (input: {
  readonly current: unknown
  readonly activityId: string
  readonly outcome: 'encounter-introduced' | 'cancelled' | 'lure-lost'
  readonly gm: boolean
}): { readonly state: ItemExplorationStateV1, readonly activity: ItemRouteLureActivityV1 } => {
  const state = parseItemExplorationState(input.current)
  const index = state.routeLures.findIndex(activity => activity.activityId === input.activityId)
  if (index < 0) throw new Error('The exact route lure activity is unavailable.')
  const activity = state.routeLures[index]!
  if (input.outcome === 'encounter-introduced' && (!input.gm || activity.status !== 'awaiting-encounter')) {
    throw new Error('Only a GM may settle a successful route lure encounter.')
  }
  if (input.outcome === 'lure-lost' && (!input.gm || !activity.reusable || !activeRouteLure(activity))) {
    throw new Error('Fishing Lure loss requires active reusable source and explicit GM adjudication.')
  }
  if (input.outcome === 'cancelled' && !activeRouteLure(activity)) {
    throw new Error('Only an active route lure can be cancelled.')
  }
  const next: ItemRouteLureActivityV1 = {
    ...activity,
    status: input.outcome === 'cancelled' || input.outcome === 'lure-lost' ? 'cancelled' : 'completed',
    nextCheckAtCampaignMinute: null,
    outcome: input.outcome,
  }
  const rows = [...state.routeLures]
  rows[index] = next
  return Object.freeze({ state: parseItemExplorationState({ ...state, routeLures: rows }), activity: next })
}

export const applyItemRepelCampaignEffect = (input: {
  readonly current: unknown
  readonly definition: ItemRuntimeDefinition
  readonly sourceOperationId: string
  readonly sourceInstanceId: string
  readonly campaignMinute: number
}): { readonly state: ItemExplorationStateV1, readonly effect: ItemRepelCampaignEffectV1 } => {
  const state = parseItemExplorationState(input.current)
  const reviewed = input.definition.spec.effects[0]
  if (reviewed?.operation !== 'use-repel'
    || !['Repel', 'Super Repel', 'Max Repel'].includes(input.definition.canonicalId)) {
    throw new Error('The item definition does not authorize a route Repel effect.')
  }
  if (!Number.isSafeInteger(input.campaignMinute) || input.campaignMinute < 0
    || input.campaignMinute > Number.MAX_SAFE_INTEGER - reviewed.durationMinutes) {
    throw new Error('Repel timing exceeds the safe campaign-clock range.')
  }
  const expiresAtCampaignMinute = input.campaignMinute + reviewed.durationMinutes
  const active = state.repels.filter(effect => effect.expiresAtCampaignMinute > input.campaignMinute)
  if (active.some(effect => effect.maximumAffectedWildLevel >= reviewed.maximumAffectedWildLevel
    && effect.expiresAtCampaignMinute >= expiresAtCampaignMinute)) {
    throw new Error('An equal or stronger Repel effect already covers this entire duration.')
  }
  const effect: ItemRepelCampaignEffectV1 = {
    effectId: hashId('item-repel:v1:', { sourceOperationId: input.sourceOperationId, sourceInstanceId: input.sourceInstanceId }),
    sourceOperationId: input.sourceOperationId,
    canonicalItemId: input.definition.canonicalId as ItemRepelCampaignEffectV1['canonicalItemId'],
    canonicalDefinitionSha256: input.definition.definitionSha256,
    sourceInstanceId: input.sourceInstanceId,
    startedAtCampaignMinute: input.campaignMinute,
    expiresAtCampaignMinute,
    maximumAffectedWildLevel: reviewed.maximumAffectedWildLevel,
  }
  return Object.freeze({
    effect,
    state: parseItemExplorationState({
      ...state,
      repels: [...state.repels.slice(-(ITEM_EXPLORATION_LIMITS.repels - 1)), effect],
    }),
  })
}

export const strongestActiveRepel = (stateValue: unknown, campaignMinute: number): ItemRepelCampaignEffectV1 | null => (
  parseItemExplorationState(stateValue).repels
    .filter(effect => campaignMinute < effect.expiresAtCampaignMinute)
    .sort((left, right) => right.maximumAffectedWildLevel - left.maximumAffectedWildLevel
      || right.expiresAtCampaignMinute - left.expiresAtCampaignMinute)[0] ?? null
)

export const dowsingDailyUsage = (input: {
  readonly state: unknown
  readonly sourceInstanceId: string
  readonly campaignMinute: number
  readonly occultEducationRank: number
}): { readonly used: number, readonly maximum: number, readonly campaignDayIndex: number } => {
  const state = parseItemExplorationState(input.state)
  const campaignDayIndex = Math.floor(input.campaignMinute / 1_440)
  const maximum = Math.floor(input.occultEducationRank / 2)
  // The reviewed limit belongs to the searching Trainer, not to each Rod.
  // Retain source identity in accepted evidence, but never multiply uses by moving
  // between or owning multiple reusable tools.
  const used = state.dowsingUses.filter(use => use.campaignDayIndex === campaignDayIndex).length
  return Object.freeze({ used, maximum, campaignDayIndex })
}

export const resolveItemDowsing = (input: {
  readonly current: unknown
  readonly definition: ItemRuntimeDefinition
  readonly sheet: TrainerSheet
  readonly sourceOperationId: string
  readonly sourceInstanceId: string
  readonly campaignMinute: number
  readonly terrainId: ItemDowsingTerrain
  readonly skillStuntInstanceId: string | null
  readonly rollDie: (sides: number) => number
}): { readonly state: ItemExplorationStateV1, readonly use: ItemDowsingUseV1, readonly shardRows: readonly InventoryEntry[] } => {
  const state = parseItemExplorationState(input.current)
  const effect = input.definition.spec.effects[0]
  if (input.definition.canonicalId !== 'Dowsing Rod' || effect?.operation !== 'search-for-shards') {
    throw new Error('The item definition does not authorize Dowsing.')
  }
  if (!ITEM_DOWSING_TERRAINS.includes(input.terrainId)) throw new Error('The Dowsing terrain choice is unavailable.')
  const occultEducationRank = resolveTrainerSkills(input.sheet).find(skill => skill.key === 'occultEd')?.rankValue ?? 0
  const usage = dowsingDailyUsage({
    state,
    sourceInstanceId: input.sourceInstanceId,
    campaignMinute: input.campaignMinute,
    occultEducationRank,
  })
  if (usage.maximum < 1 || usage.used >= usage.maximum) throw new Error('Dowsing Rod has no uses remaining this campaign day.')
  if (state.dowsingUses.some(use => use.sourceOperationId === input.sourceOperationId)) {
    throw new Error('This Dowsing operation was already recorded.')
  }
  const stuntOptions = dowsingSkillStuntOptions(input.sheet)
  if (input.skillStuntInstanceId !== null
    && !stuntOptions.some(option => option.optionId === input.skillStuntInstanceId)) {
    throw new Error('The selected Dowsing Skill Stunt instance is unavailable or stale.')
  }
  const terrainBonusDice = input.terrainId === 'ordinary' ? 0 : 1
  const skillStuntBonusDice = input.skillStuntInstanceId === null ? 0 : 1
  const crystalResonanceBonusDice = hasEffectiveFeature(input.sheet, 'Crystal Resonance') ? 3 : 0
  const initialDice = occultEducationRank + terrainBonusDice + skillStuntBonusDice + crystalResonanceBonusDice
  if (!Number.isSafeInteger(initialDice) || initialDice < 1 || initialDice > 16) {
    throw new Error('The authoritative Dowsing dice pool is outside reviewed bounds.')
  }
  const rolls: number[] = []
  let pending = initialDice
  while (pending > 0) {
    if (rolls.length >= ITEM_EXPLORATION_LIMITS.rollCount) throw new Error('The exploding Dowsing roll exceeded its safe bound.')
    const roll = input.rollDie(6)
    if (!Number.isSafeInteger(roll) || roll < 1 || roll > 6) throw new Error('Dowsing requires bounded server-owned d6 rolls.')
    rolls.push(roll)
    pending -= 1
    if (roll === 6) pending += 1
  }
  const successes = rolls.filter(roll => roll >= 4).length
  const shardAwards: ItemExplorationShardColor[] = []
  for (let index = 0; index < successes; index += 1) {
    const colorRoll = input.rollDie(6)
    if (!Number.isSafeInteger(colorRoll) || colorRoll < 1 || colorRoll > 6) {
      throw new Error('Dowsing Shard colors require bounded server-owned d6 rolls.')
    }
    shardAwards.push(ITEM_EXPLORATION_SHARD_COLORS[colorRoll - 1]!)
  }
  const shardRows = shardAwards.map((color, index): InventoryEntry => ({
    id: hashId('item-shard:v1:', { sourceOperationId: input.sourceOperationId, index, color }),
    name: 'Shards',
    qty: 1,
    description: `${color} Shard · color recorded by authoritative Dowsing`,
    itemVariant: { schemaVersion: 1, kind: 'shard-color', color },
  }))
  const use: ItemDowsingUseV1 = {
    sourceOperationId: input.sourceOperationId,
    canonicalDefinitionSha256: input.definition.definitionSha256,
    sourceInstanceId: input.sourceInstanceId,
    campaignDayIndex: usage.campaignDayIndex,
    resolvedAtCampaignMinute: input.campaignMinute,
    terrainId: input.terrainId,
    skillStuntInstanceId: input.skillStuntInstanceId,
    roll: {
      expression: `${initialDice}d6!6`,
      baseDice: occultEducationRank,
      terrainBonusDice,
      skillStuntBonusDice,
      crystalResonanceBonusDice,
      rolls,
      successes,
      explodingSixes: rolls.filter(roll => roll === 6).length,
    },
    shardAwards,
    shardInventoryRowIds: shardRows.map(row => row.id!),
  }
  return Object.freeze({
    use,
    shardRows: Object.freeze(shardRows),
    state: parseItemExplorationState({
      ...state,
      dowsingUses: [...state.dowsingUses.slice(-(ITEM_EXPLORATION_LIMITS.dowsingUses - 1)), use],
    }),
  })
}

export const applyResolvedItemDowsing = (input: {
  readonly sheet: TrainerSheet
  readonly use: ItemDowsingUseV1
  readonly shardRows: readonly InventoryEntry[]
}): TrainerSheet => {
  const current = parseItemExplorationState(input.sheet.serverPrivate?.itemExploration)
  if (current.dowsingUses.some(use => use.sourceOperationId === input.use.sourceOperationId)) {
    throw new Error('This Dowsing use already exists on the Trainer sheet.')
  }
  if (input.shardRows.length !== input.use.shardAwards.length
    || input.shardRows.some((row, index) => row.id !== input.use.shardInventoryRowIds[index]
      || row.name !== 'Shards' || row.qty !== 1
      || row.itemVariant?.schemaVersion !== 1 || row.itemVariant.kind !== 'shard-color'
      || row.itemVariant.color !== input.use.shardAwards[index]
      || row.description !== `${input.use.shardAwards[index]} Shard · color recorded by authoritative Dowsing`)) {
    throw new Error('Dowsing Shard inventory rows do not match their color-preserving authority.')
  }
  const existingIds = new Set(Object.values(input.sheet.inventory ?? {}).flatMap(rows => rows ?? [])
    .flatMap(row => row.id ? [row.id] : []))
  if (input.shardRows.some(row => !row.id || existingIds.has(row.id))) {
    throw new Error('Dowsing Shard inventory identity is duplicated.')
  }
  const next = structuredClone(input.sheet)
  next.serverPrivate = {
    ...(next.serverPrivate ?? {}),
    itemExploration: parseItemExplorationState({
      ...current,
      dowsingUses: [...current.dowsingUses.slice(-(ITEM_EXPLORATION_LIMITS.dowsingUses - 1)), input.use],
    }),
  }
  next.inventory = {
    ...(next.inventory ?? {}),
    keyItems: [...(next.inventory?.keyItems ?? []), ...input.shardRows.map(row => structuredClone(row))],
  }
  return next
}
