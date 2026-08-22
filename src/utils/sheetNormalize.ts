/**
 * Normalize a sheet so every nested object/array we want to bind via
 * ``v-model`` actually exists. Optional fields stay optional in the type
 * system but we materialise empty defaults at runtime to keep the editable
 * cells from binding to ``undefined.x``.
 *
 * The functions take a *clone* (the editable sheet, not the static one)
 * and mutate it in place.
 */
import { normalizeRevision } from '#shared/sessionRevisions'
import {
  parseSerializedEquipmentInventoryState,
  parseSheetEquipmentStateForOwner,
} from '#shared/itemAutomation/equipment'
import type { CharacterSheet, CharacterSheetAppliedMove, StatKey } from '~/types/characterSheet'
import type { InventoryEntry, TrainerSheet, TrainerStatKey } from '~/types/trainerSheet'
import { parseItemBreedingState } from '#shared/breeding/itemWorkflows'
import { parseItemGuidedLoyaltyState } from '#shared/itemAutomation/guidedAdjudication'
import { mergeLegacyConditions } from '~/utils/statusConditions'
import { normalizePokemonLoyalty } from '~/utils/sheets/pokemonLoyalty'
import { normalizePokemonGmSection } from '~/utils/sheets/pokemonGmFields'
import { normalizeTrainerAccentColor } from '~/utils/trainerAccent'
import { setPokemonCaughtBall } from '~/utils/sheets/pokemonCaughtBall'
import { normalizeTrainerInventoryLegacyFishingRodAutofill } from '~/utils/sheets/trainerInventoryItems'
import { stripLegacyTrainerSheetSkillRanks } from '~/utils/sheets/trainerSkillEntries'
import { resolveEdgeInstance } from '#shared/edgeAutomation/instances'
import { resolveFeatureInstance } from '#shared/featureAutomation/instances'
import { normalizedFeatureApState, normalizedFeatureRuntimeState, normalizedFeatureUsageLedger } from '#shared/featureAutomation/state'
import {
  POKEMON_RARE_CANDY_LIMIT,
  POKEMON_VITAMIN_STAT_KEYS,
  coercePokemonVitaminCount,
} from '~/utils/sheets/pokemonVitamins'
import { parsePokemonContestStatsState } from '#shared/contests/preparation'

const STAT_KEYS: StatKey[] = ['hp', 'atk', 'def', 'satk', 'sdef', 'spd']
const TRAINER_STAT_KEYS: TrainerStatKey[] = ['hp', 'atk', 'def', 'satk', 'sdef', 'spd']

const ensureObj = <T extends object>(host: any, key: string): T => {
  if (!host[key] || typeof host[key] !== 'object' || Array.isArray(host[key])) {
    host[key] = {}
  }
  return host[key] as T
}

const ensureArr = <T>(host: any, key: string): T[] => {
  if (!Array.isArray(host[key])) host[key] = []
  return host[key] as T[]
}

export const normalizeCharacterSheet = (sheet: CharacterSheet): CharacterSheet => {
  sheet.revision = normalizeRevision(sheet.revision)
  if (sheet.equipmentState !== undefined) {
    sheet.equipmentState = parseSheetEquipmentStateForOwner(sheet.equipmentState, {
      kind: 'pokemon',
      slug: sheet.slug,
    })
  }
  if (typeof sheet.player !== 'boolean') sheet.player = false
  normalizePokemonGmSection(sheet)
  const loyalty = normalizePokemonLoyalty(sheet.loyalty)
  if (loyalty == null) delete sheet.loyalty
  else sheet.loyalty = loyalty
  if (sheet.serverPrivate?.itemGuidedLoyalty !== undefined) {
    sheet.serverPrivate.itemGuidedLoyalty = parseItemGuidedLoyaltyState(sheet.serverPrivate.itemGuidedLoyalty)
  }
  setPokemonCaughtBall(sheet, sheet.caughtBall)
  // Keep Contest fields additive: migrate a legacy value when present, but do
  // not rewrite unrelated historical sheets merely because Contest support
  // exists in the current schema.
  if (Object.hasOwn(sheet, 'contestStats')) {
    sheet.contestStats = parsePokemonContestStatsState(sheet.contestStats)
  }
  if (Object.hasOwn(sheet, 'contestRibbons')) ensureArr(sheet, 'contestRibbons')

  // Headline stats — give every key an entry so the stats table is editable.
  const stats = ensureObj<NonNullable<CharacterSheet['stats']>>(sheet, 'stats')
  for (const key of STAT_KEYS) {
    const row = ensureObj<Record<string, number>>(stats, key)
    if (typeof row.base  !== 'number') row.base  = 0
    if (typeof row.added !== 'number') row.added = 0
    if (typeof row.stage !== 'number') row.stage = 0
  }

  ensureObj<NonNullable<CharacterSheet['natureMod']>>(sheet, 'natureMod')

  const combat = ensureObj<NonNullable<CharacterSheet['combat']>>(sheet, 'combat')
  const evasion = ensureObj<NonNullable<NonNullable<CharacterSheet['combat']>['evasion']>>(combat, 'evasion')
  if (typeof evasion.vsAtkBonus  !== 'number') evasion.vsAtkBonus  = 0
  if (typeof evasion.vsSatkBonus !== 'number') evasion.vsSatkBonus = 0
  if (typeof evasion.vsAnyBonus  !== 'number') evasion.vsAnyBonus  = 0
  combat.conditions = mergeLegacyConditions(combat.conditions, combat.statusAfflictions)

  const vitamins = ensureObj<NonNullable<CharacterSheet['vitamins']>>(sheet, 'vitamins')
  const statBoosts = ensureObj<NonNullable<NonNullable<CharacterSheet['vitamins']>['statBoosts']>>(vitamins, 'statBoosts')
  const statSuppressants = ensureObj<NonNullable<NonNullable<CharacterSheet['vitamins']>['statSuppressants']>>(vitamins, 'statSuppressants')
  for (const key of POKEMON_VITAMIN_STAT_KEYS) {
    statBoosts[key] = coercePokemonVitaminCount(statBoosts[key])
    statSuppressants[key] = coercePokemonVitaminCount(statSuppressants[key])
  }
  vitamins.heartBooster = vitamins.heartBooster === true
  vitamins.ppUp = vitamins.ppUp === true
  vitamins.rareCandies = coercePokemonVitaminCount(vitamins.rareCandies, { max: POKEMON_RARE_CANDY_LIMIT })
  vitamins.heartScales = coercePokemonVitaminCount(vitamins.heartScales)
  if (typeof vitamins.ppUpMove !== 'string') vitamins.ppUpMove = ''
  if (typeof vitamins.notes !== 'string') vitamins.notes = ''
  if (typeof combat.vitamins === 'string' && combat.vitamins.trim() && !vitamins.notes.trim()) {
    vitamins.notes = combat.vitamins
  }
  delete combat.vitamins

  const combatStages = ensureObj<NonNullable<CharacterSheet['combatStages']>>(sheet, 'combatStages')
  if (typeof combatStages.acc !== 'number') combatStages.acc = 0

  ensureObj<NonNullable<CharacterSheet['items']>>(sheet, 'items')
  ensureArr<string>(sheet.items as Record<string, unknown>, 'extraItems')

  ensureObj<NonNullable<CharacterSheet['weapon']>>(sheet, 'weapon')
  ensureObj<NonNullable<CharacterSheet['tutorPoints']>>(sheet, 'tutorPoints')
  ensureObj<NonNullable<CharacterSheet['skillBackground']>>(sheet, 'skillBackground')

  ensureObj<NonNullable<CharacterSheet['inheritedMoves']>>(sheet, 'inheritedMoves')

  ensureArr(sheet, 'movelist')
  ensureArr(sheet, 'eggMoves')
  for (const move of ensureArr<CharacterSheetAppliedMove>(sheet, 'appliedMoves')) {
    const source = String(move.source ?? '').trim().toLowerCase()
    move.source = source === 'tutor' || source === 'tutoring' ? 'tutor' : 'tm'
  }
  ensureArr(sheet, 'abilities')
  for (const [index, edge] of ensureArr<NonNullable<CharacterSheet['edges']>[number]>(sheet, 'edges').entries()) {
    const resolved = resolveEdgeInstance({ family: 'poke', entry: edge, ownerId: sheet.slug, index })
    if (resolved.status === 'ready' && resolved.data) edge.automation = { ...resolved.data, family: 'poke' }
  }

  ensureObj<NonNullable<CharacterSheet['capabilities']>>(sheet, 'capabilities')
  ensureArr<string>(sheet.capabilities as Record<string, unknown>, 'other')

  ensureObj<NonNullable<CharacterSheet['skills']>>(sheet, 'skills')
  ensureObj<NonNullable<CharacterSheet['scene']>>(sheet, 'scene')

  return sheet
}

export const normalizeTrainerSheet = (sheet: TrainerSheet): TrainerSheet => {
  sheet.revision = normalizeRevision(sheet.revision)
  if (sheet.equipmentState !== undefined) {
    sheet.equipmentState = parseSheetEquipmentStateForOwner(sheet.equipmentState, {
      kind: 'trainer',
      slug: sheet.slug,
    })
  }
  if (typeof sheet.player !== 'boolean') sheet.player = false
  if (sheet.serverPrivate?.itemBreeding !== undefined) {
    sheet.serverPrivate.itemBreeding = parseItemBreedingState(sheet.serverPrivate.itemBreeding)
  }
  const accentColor = normalizeTrainerAccentColor(sheet.accentColor)
  if (accentColor) sheet.accentColor = accentColor
  else delete sheet.accentColor

  const stats = ensureObj<NonNullable<TrainerSheet['stats']>>(sheet, 'stats')
  for (const key of TRAINER_STAT_KEYS) {
    const row = ensureObj<Record<string, number>>(stats, key)
    if (typeof row.base    !== 'number') row.base    = key === 'hp' ? 10 : 5
    if (typeof row.feats   !== 'number') row.feats   = 0
    if (typeof row.bonus   !== 'number') row.bonus   = 0
    if (typeof row.levelUp !== 'number') row.levelUp = 0
    if (typeof row.stage   !== 'number') row.stage   = 0
  }

  ensureObj<NonNullable<TrainerSheet['ap']>>(sheet, 'ap')
  if (sheet.featureApState) sheet.featureApState = normalizedFeatureApState(sheet.featureApState, Math.max(0, Math.floor(sheet.ap?.max ?? (5 + Math.floor(Math.max(1, sheet.level || 1) / 5)))))
  if (sheet.featureUsage) sheet.featureUsage = normalizedFeatureUsageLedger(sheet.featureUsage)
  if (sheet.featureRuntimeState) sheet.featureRuntimeState = normalizedFeatureRuntimeState(sheet.featureRuntimeState)
  const evasion = ensureObj<NonNullable<TrainerSheet['evasion']>>(sheet, 'evasion')
  if (typeof evasion.speedBonus    !== 'number') evasion.speedBonus    = 0
  if (typeof evasion.physicalBonus !== 'number') evasion.physicalBonus = 0
  if (typeof evasion.specialBonus  !== 'number') evasion.specialBonus  = 0
  sheet.conditions = mergeLegacyConditions(sheet.conditions, sheet.statusAfflictions)
  const combatStages = ensureObj<NonNullable<TrainerSheet['combatStages']>>(sheet, 'combatStages')
  if (typeof combatStages.acc !== 'number') combatStages.acc = 0

  ensureObj<NonNullable<TrainerSheet['capabilities']>>(sheet, 'capabilities')
  ensureArr<string>(sheet.capabilities as Record<string, unknown>, 'other')

  ensureObj<NonNullable<TrainerSheet['skillBackground']>>(sheet, 'skillBackground')
  ensureArr<string>(sheet.skillBackground as Record<string, unknown>, 'pathetic')

  ensureObj<NonNullable<TrainerSheet['skills']>>(sheet, 'skills')
  stripLegacyTrainerSheetSkillRanks(sheet)
  ensureObj<NonNullable<TrainerSheet['equipmentSlots']>>(sheet, 'equipmentSlots')

  const inv = ensureObj<NonNullable<TrainerSheet['inventory']>>(sheet, 'inventory')
  const serializedEquipmentIds = new Set<string>()
  for (const key of ['keyItems', 'pokemonItems', 'medicalKit', 'pokeBalls', 'foodStuff', 'equipment']) {
    for (const entry of ensureArr<InventoryEntry>(inv, key)) {
      normalizeTrainerInventoryLegacyFishingRodAutofill(entry)
      if (entry.serializedEquipment !== undefined) {
        entry.serializedEquipment = parseSerializedEquipmentInventoryState(entry.serializedEquipment)
        if (serializedEquipmentIds.has(entry.serializedEquipment.instanceId)) {
          throw new Error('Trainer inventory contains a duplicate serialized equipment identity.')
        }
        serializedEquipmentIds.add(entry.serializedEquipment.instanceId)
        delete entry.qty
      }
      else if (key === 'equipment') delete entry.qty
    }
  }

  ensureArr(sheet, 'movelist')
  ensureArr(sheet, 'abilities')
  ensureArr(sheet, 'maneuvers')
  for (const [index, order] of ensureArr<NonNullable<TrainerSheet['orders']>[number]>(sheet, 'orders').entries()) {
    const resolved = resolveFeatureInstance({ entry: order, ownerId: sheet.slug, index: 20_000 + index, acquisitionKind: 'orders' })
    if (resolved.status === 'ready' && resolved.data) order.automation = { ...resolved.data }
  }
  for (const [index, trainerClass] of ensureArr<NonNullable<TrainerSheet['classes']>[number]>(sheet, 'classes').entries()) {
    const resolved = resolveFeatureInstance({ entry: trainerClass, ownerId: sheet.slug, index: 10_000 + index, acquisitionKind: 'class' })
    if (resolved.status === 'ready' && resolved.data) trainerClass.automation = { ...resolved.data }
  }
  for (const [index, feature] of ensureArr<NonNullable<TrainerSheet['features']>[number]>(sheet, 'features').entries()) {
    const resolved = resolveFeatureInstance({ entry: feature, ownerId: sheet.slug, index, acquisitionKind: 'sheet' })
    if (resolved.status === 'ready' && resolved.data) feature.automation = { ...resolved.data }
  }
  for (const [index, edge] of ensureArr<NonNullable<TrainerSheet['edges']>[number]>(sheet, 'edges').entries()) {
    const resolved = resolveEdgeInstance({ family: 'trainer', entry: edge, ownerId: sheet.slug, index })
    if (resolved.status === 'ready' && resolved.data) edge.automation = { ...resolved.data, family: 'trainer' }
  }
  ensureArr(sheet, 'advancement')
  if (Object.hasOwn(sheet, 'contestResults')) ensureArr(sheet, 'contestResults')
  ensureArr<string>(sheet, 'currentTeam')
  ensureArr<string>(sheet, 'boxedPokemon')
  ensureArr<string>(sheet, 'wishlist')

  return sheet
}
