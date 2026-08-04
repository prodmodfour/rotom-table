import { getPokedexEntry } from '~~/data/characterSheets'
import { findMove, letterPressHiddenPowerSourceSlug } from '~~/data/ptuReference'
import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { MoveAttackSourceId } from '#shared/moveAutomation/attackSource'
import { reviewedAbilityConnectionMoveNames } from '#shared/abilityAutomation/connections'
import {
  AA083_POLTERGEIST_FORMS,
  aa083PoltergeistFormForSpecies,
} from '#shared/abilityAutomation/aa083'
import {
  projectEncounterMoveList,
  type EncounterMoveListBlockReason,
  type EncounterMoveListProjectionEntry,
} from '#shared/moveAutomation/moveListOverlays'
import { explicitScriptForMove } from '~/utils/moveAutomation'
import { nativeMoveAutomationPresentationScriptForMove } from '~/utils/move-automation/nativePresentation'
import { resolvePokemonOtherCapabilities } from '~/utils/sheets/pokemonCapabilities'
import { resolveMoveGrantedCapabilities } from '~/utils/sheets/pokemonMoveGrantedCapabilities'
import {
  makeAutomaticStruggleMoves,
  struggleAttackIsAvailableForCapabilities,
} from '~/utils/struggleMoves'
import { deriveTrainerAutomaticMoves } from '~/utils/sheets/trainerCombatDerivations'
import { makeMoveLookupRows, type MoveLookupRow } from '~/utils/sheetMoveLookup'
import { findMoveDamageBase } from '~/utils/moveDamageBase'
import { averageMoveDamageForDb } from '~/utils/moveDamageDisplay'
import { isPokemonLoyaltyDamageBaseMove } from '~/utils/sheets/pokemonLoyalty'
import { moveConditionUseBlock, type MoveConditionUseBlock } from '~/utils/moveConditionRestrictions'
import {
  moveAutomationSemanticStatusForMenu,
  type MoveAutomationSemanticStatus,
} from '~/utils/moveAutomationSemanticStatus'
import {
  eotMoveUsageState,
  getMapMoveUsageEntry,
  getSheetDailyMoveUsageEntry,
  limitedMoveUsageState,
  moveUsageKey,
  parseMoveFrequency,
  type MoveFrequencyKind,
} from '~/utils/moveUsage'
import type { CharacterSheet, CharacterSheetMove } from '~/types/characterSheet'
import { sheetAbilityNames } from '~/utils/sheetAbilities'
import { resolvedSheetEdgeInstances, sheetEdgeChoiceValues } from '#shared/edgeAutomation/sheetEdges'
import { pokeEdgeMoveGrants } from '#shared/edgeAutomation/grants'
import type { MapMoveUsageState, SheetMoveUsageState } from '~/types/moveUsage'
import type { SheetPlacement } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerMove, TrainerSheet } from '~/types/trainerSheet'

export type TokenSheetMove = CharacterSheetMove | TrainerMove

export interface TokenSheetMoveEntry {
  move: TokenSheetMove
  automatic: boolean
  /** Capability-owned weapon Moves explicitly never receive STAB. */
  suppressStab?: boolean
  /** Opaque, non-authoritative exact attack-source selector. */
  attackSourceId?: MoveAttackSourceId
  attackSourceLabel?: string
  /** Presentation-only DB adjustment; authoritative rules recompute it from the exact source. */
  presentationDamageBaseBonus?: number
  /** Presentation-only AC adjustment; authoritative rules recompute it from the exact source. */
  presentationAccuracyCheckModifier?: number
  /** Shared encounter-local projection consumed by both menu and server legality. */
  moveListProjection?: EncounterMoveListProjectionEntry
}

export interface MapTokenSheetLookup {
  pokemon?: Map<string, CharacterSheet>
  trainer?: Map<string, TrainerSheet>
}

export interface TokenMoveUsageMenuState {
  tracking: 'map' | 'sheet'
  frequencyKind: Extract<MoveFrequencyKind, 'eot' | 'scene' | 'daily'>
  label: string
  title: string
  available: boolean
  tone: 'available' | 'limited' | 'blocked'
  uses: number
  maxUses?: number
  remainingUses?: number
  sceneUses?: number
  sceneMaxUses?: number
  sceneRemainingUses?: number
  lastUsedRound?: number | null
  nextAvailableRound?: number | null
}

export interface TokenMoveUsageContext {
  mapMoveUsage?: MapMoveUsageState
  sheetMoveUsage?: SheetMoveUsageState
  activeScene?: unknown
  currentRound?: number | null
}

export interface TokenMoveListMenuState {
  readonly source: 'placement' | 'encounter-overlay'
  readonly effectId: string | null
  readonly copiedSpecHash: string | null
  readonly available: boolean
  readonly blockReason: EncounterMoveListBlockReason | null
  readonly blockingEffectIds: readonly string[]
}

export interface TokenMoveUseReference {
  readonly moveName: string
  /** Null deliberately selects the ordinary native/unsourced row. */
  readonly attackSourceId: MoveAttackSourceId | null
}

export interface TokenMoveMenuOption {
  /** Stable row identity; same-name native/source rows remain distinct. */
  optionId: string
  name: string
  attackSourceId?: MoveAttackSourceId
  attackSourceLabel?: string
  type: string | null
  damageClass: string | null
  frequency: string | null
  ac: number | string | null
  range: string | null
  effect: string | null
  special: string | null
  damageBase: number | null
  hasStab: boolean
  damageAverage: number | null
  damageFormula: string | null
  attackStat: number | null
  baseAttackStat: number | null
  attackStage: number | null
  attackStatKey: 'atk' | 'satk' | null
  attackStatLabel: string | null
  attackStatAbility: string | null
  additionalAttackStat: number | null
  additionalBaseAttackStat: number | null
  additionalAttackStage: number | null
  additionalAttackStatKey: 'atk' | 'satk' | null
  additionalAttackStatLabel: string | null
  automatic: boolean
  moveList: TokenMoveListMenuState
  disabledByMoveList: boolean
  /** Legacy runtime presence; semantic status is the user-facing automation contract. */
  hasAutomationScript: boolean
  automation: MoveAutomationSemanticStatus
  disabledByAutomation: boolean
  conditionUseBlock: MoveConditionUseBlock | null
  disabledByCondition: boolean
  /** Public Power-load projection; the server independently revalidates this restriction. */
  physicalLoadUseBlock?: string | null
  disabledByPhysicalLoad?: boolean
  usage: TokenMoveUsageMenuState | null
  disabledByUsage: boolean
}

const pokemonStruggleCapabilities = (sheet: CharacterSheet): string[] => {
  const species = getPokedexEntry(sheet.species)
  const moveGrantedCapabilities = resolveMoveGrantedCapabilities(sheet.movelist)
  return resolvePokemonOtherCapabilities(species, sheet.capabilities, {
    other: moveGrantedCapabilities.other,
    valuedBonuses: moveGrantedCapabilities.valuedOtherBonuses,
  })
}

const trainerStruggleCapabilities = (sheet: TrainerSheet): string[] => [
  ...(sheet.capabilities?.other ?? []),
]

const struggleEligibleMoves = <Move extends Pick<TokenSheetMove, 'name'>>(
  moves: readonly Move[] | undefined,
  capabilities: readonly string[],
): Move[] => (moves ?? []).filter(move => (
  struggleAttackIsAvailableForCapabilities(move.name, capabilities)
))

export const pokemonMoveEntriesForSheet = (
  sheet: CharacterSheet,
  abilityConnectionNames: readonly string[] = sheetAbilityNames(sheet.abilities),
  additionalMoveNames: readonly string[] = [],
): TokenSheetMoveEntry[] => {
  const capabilities = pokemonStruggleCapabilities(sheet)
  const movelist = struggleEligibleMoves(sheet.movelist, capabilities)
  const connectionMoves = reviewedAbilityConnectionMoveNames(
    abilityConnectionNames,
    movelist.map(move => move.name),
  )
  const poltergeistForm = abilityConnectionNames.includes('Poltergeist')
    ? aa083PoltergeistFormForSpecies(sheet.species)
    : null
  const poltergeistMove = poltergeistForm && (sheet.level ?? 0) >= 40
    ? AA083_POLTERGEIST_FORMS[poltergeistForm].moveId
    : null
  const edgeMoveNames = resolvedSheetEdgeInstances(sheet, 'poke').flatMap(pokeEdgeMoveGrants)
  const accuracyTrainedMoves = new Set(sheetEdgeChoiceValues({
    sheet,
    family: 'poke',
    canonicalId: 'Accuracy Training',
    choiceId: 'choice-1',
  }).map(name => name.trim().toLocaleLowerCase('en-US')))
  const entries: TokenSheetMoveEntry[] = [
    ...makeAutomaticStruggleMoves(capabilities, movelist)
      .map((move) => ({ move, automatic: true })),
    ...[...new Set([
      ...connectionMoves,
      ...edgeMoveNames,
      ...additionalMoveNames,
      ...(poltergeistMove ? [poltergeistMove] : []),
    ])]
      .filter(name => !movelist.some(move => move.name.trim().toLowerCase() === name.trim().toLowerCase()))
      .map(name => ({ move: { name }, automatic: true })),
    ...movelist.map((move) => ({ move, automatic: false })),
  ]
  return entries.map(entry => accuracyTrainedMoves.has(entry.move.name.trim().toLocaleLowerCase('en-US'))
    ? { ...entry, presentationAccuracyCheckModifier: -1 }
    : entry)
}

export const trainerMoveEntriesForSheet = (sheet: TrainerSheet): TokenSheetMoveEntry[] => {
  const capabilities = trainerStruggleCapabilities(sheet)
  const automaticTrainerMoves = deriveTrainerAutomaticMoves(sheet)
    .filter(move => struggleAttackIsAvailableForCapabilities(move.entry.name, capabilities))
  const movelist = struggleEligibleMoves(sheet.movelist, capabilities)
  return [
    ...makeAutomaticStruggleMoves<TrainerMove>(
      capabilities,
      [...automaticTrainerMoves.map((move) => move.entry), ...movelist],
    ).map((move) => ({ move, automatic: true })),
    ...automaticTrainerMoves.map((move) => ({ move: move.entry, automatic: true })),
    ...movelist.map((move) => ({ move, automatic: false })),
  ]
}

export interface MoveEntriesForPlacementOptions {
  readonly encounterEffects?: readonly EncounterEffect[]
  /** Exact effective Ability names when a server authority has already projected suppression. */
  readonly abilityConnectionNames?: readonly string[]
  /** Additional server-reviewed temporary or form-owned move names. */
  readonly additionalMoveNames?: readonly string[]
  /** Complete server-reviewed supplemental Moves that are not Pokémon Move catalog rows. */
  readonly additionalMoveEntries?: readonly TokenSheetMoveEntry[]
}

const temporaryAbilityMoveNames = (
  placementId: string,
  effects: readonly EncounterEffect[] | undefined,
): readonly string[] => [...new Set((effects ?? []).flatMap(effect => {
  if (!effect.affected.placementIds.includes(placementId)
    || effect.suppression.sources.length > 0
    || (effect.duration.remaining !== null && effect.duration.remaining <= 0)) return []
  if (effect.tags.includes('aa100-zen-mode')) return ['Flamethrower', 'Psychic']
  if (effect.tags.includes('aa100-zen-snowed')) return ['Ice Punch', 'Fire Punch']
  const riderTag = effect.tags.find(tag => tag.startsWith('aa091-splendorous-rider:'))
  const move = riderTag ? findMove(riderTag.slice('aa091-splendorous-rider:'.length)) : null
  return move ? [move.name] : []
}))]

const canonicalMoveIdForEntry = (entry: TokenSheetMoveEntry): string => {
  const name = entry.move.name.trim()
  return findMove(name)?.name ?? name
}

const projectTokenMoveEntries = (
  placement: Pick<SheetPlacement, 'id' | 'sideId'>,
  entries: readonly TokenSheetMoveEntry[],
  effects: readonly EncounterEffect[] | undefined,
): TokenSheetMoveEntry[] => projectEncounterMoveList({
  placementId: placement.id,
  ...(placement.sideId === undefined ? {} : { sideId: placement.sideId }),
  baseCanonicalMoveIds: entries.map(canonicalMoveIdForEntry),
  effects,
}).map((projection): TokenSheetMoveEntry => {
  const base = projection.baseIndex === null ? null : entries[projection.baseIndex] ?? null
  return {
    move: base?.move ?? { name: projection.canonicalMoveId },
    automatic: base?.automatic ?? false,
    ...(base?.suppressStab ? { suppressStab: true } : {}),
    ...(base?.attackSourceId ? { attackSourceId: base.attackSourceId } : {}),
    ...(base?.attackSourceLabel ? { attackSourceLabel: base.attackSourceLabel } : {}),
    ...(base?.presentationDamageBaseBonus
      ? { presentationDamageBaseBonus: base.presentationDamageBaseBonus }
      : {}),
    moveListProjection: projection,
  }
})

export const moveEntriesForPlacement = (
  placement: Pick<SheetPlacement, 'id' | 'sheetKind' | 'sheetSlug' | 'sideId'> | null | undefined,
  sheets: MapTokenSheetLookup,
  options: MoveEntriesForPlacementOptions = {},
): TokenSheetMoveEntry[] => {
  if (!placement) return []
  const baseEntries = placement.sheetKind === 'pokemon'
    ? (() => {
        const sheet = sheets.pokemon?.get(placement.sheetSlug)
        return sheet ? pokemonMoveEntriesForSheet(
          sheet,
          options.abilityConnectionNames,
          [
            ...(options.additionalMoveNames ?? []),
            ...temporaryAbilityMoveNames(placement.id, options.encounterEffects),
          ],
        ) : []
      })()
    : (() => {
        const sheet = sheets.trainer?.get(placement.sheetSlug)
        return sheet ? trainerMoveEntriesForSheet(sheet) : []
      })()
  const additionalEntries = options.additionalMoveEntries ?? []
  const replacingSupplementalNames = new Set(additionalEntries
    .filter(entry => !entry.attackSourceId)
    .map(entry => entry.move.name.trim().toLocaleLowerCase('en-US')))
  const entries = [
    ...baseEntries.filter(entry => !replacingSupplementalNames.has(entry.move.name.trim().toLocaleLowerCase('en-US'))),
    ...additionalEntries,
  ]
  return projectTokenMoveEntries(placement, entries, options.encounterEffects)
}

const fallback = <T>(...values: T[]): NonNullable<T> | null => {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') return value as NonNullable<T>
  }
  return null
}

const moveHasAutomationScript = (row: MoveLookupRow<TokenSheetMove>): boolean => {
  const moveName = row.reference?.name ?? row.move.name
  if (isPokemonLoyaltyDamageBaseMove(moveName) && row.damageBase == null) return false
  return Boolean(
    explicitScriptForMove(moveName)
    ?? explicitScriptForMove(row.move.name)
    ?? nativeMoveAutomationPresentationScriptForMove(moveName)
    ?? nativeMoveAutomationPresentationScriptForMove(row.move.name),
  )
}

const usageLimitTitle = (
  moveName: string,
  scope: 'Scene' | 'Daily',
  uses: number,
  maxUses: number,
  remainingUses: number,
): string => remainingUses > 0
  ? `${moveName}: ${remainingUses} of ${maxUses} ${scope} uses remaining.`
  : `${moveName}: no ${scope} uses remaining.`

export const buildTokenMoveUsageState = (
  tokenId: string,
  moveName: string,
  frequency: string | null | undefined,
  context: TokenMoveUsageContext = {},
): TokenMoveUsageMenuState | null => {
  const parsed = parseMoveFrequency(frequency)
  const moveKey = moveUsageKey(moveName)
  if (!moveKey) return null

  if (parsed.kind === 'eot') {
    const state = eotMoveUsageState(
      getMapMoveUsageEntry(context.mapMoveUsage, tokenId, moveKey, context.activeScene),
      context.currentRound,
    )
    return {
      tracking: 'map',
      frequencyKind: 'eot',
      label: state.available ? 'EOT ready' : `EOT Round ${state.nextAvailableRound ?? '?'}`,
      title: state.available
        ? `${moveName}: EOT is available.`
        : `${moveName}: EOT is unavailable until round ${state.nextAvailableRound ?? '?'}.`,
      available: state.available,
      tone: state.available ? 'available' : 'blocked',
      uses: state.uses,
      lastUsedRound: state.lastUsedRound,
      nextAvailableRound: state.nextAvailableRound,
    }
  }

  if (parsed.kind === 'scene') {
    const maxUses = Math.max(1, parsed.usesPerPeriod ?? 1)
    const state = limitedMoveUsageState(
      getMapMoveUsageEntry(context.mapMoveUsage, tokenId, moveKey, context.activeScene),
      maxUses,
    )
    return {
      tracking: 'map',
      frequencyKind: 'scene',
      label: `Scene ${state.remainingUses}/${state.maxUses}`,
      title: usageLimitTitle(moveName, 'Scene', state.uses, state.maxUses, state.remainingUses),
      available: state.available,
      tone: state.available ? 'limited' : 'blocked',
      uses: state.uses,
      maxUses: state.maxUses,
      remainingUses: state.remainingUses,
    }
  }

  if (parsed.kind === 'daily') {
    const maxUses = Math.max(1, parsed.usesPerPeriod ?? 1)
    const dailyState = limitedMoveUsageState(
      getSheetDailyMoveUsageEntry(context.sheetMoveUsage, moveKey),
      maxUses,
    )
    const sceneEntry = getMapMoveUsageEntry(context.mapMoveUsage, tokenId, moveKey, context.activeScene)
    const sceneState = limitedMoveUsageState(
      sceneEntry?.frequency === 'daily' ? sceneEntry : null,
      1,
    )
    const available = dailyState.available && sceneState.available
    const label = sceneState.available
      ? `Daily ${dailyState.remainingUses}/${dailyState.maxUses}`
      : 'Daily scene used'
    const title = !dailyState.available
      ? usageLimitTitle(moveName, 'Daily', dailyState.uses, dailyState.maxUses, dailyState.remainingUses)
      : sceneState.available
        ? `${usageLimitTitle(moveName, 'Daily', dailyState.uses, dailyState.maxUses, dailyState.remainingUses)} Once per Scene.`
        : `${moveName}: Daily use already spent this Scene. ${dailyState.remainingUses} of ${dailyState.maxUses} Daily uses remaining.`
    return {
      tracking: 'sheet',
      frequencyKind: 'daily',
      label,
      title,
      available,
      tone: available ? 'limited' : 'blocked',
      uses: dailyState.uses,
      maxUses: dailyState.maxUses,
      remainingUses: dailyState.remainingUses,
      sceneUses: sceneState.uses,
      sceneMaxUses: sceneState.maxUses,
      sceneRemainingUses: sceneState.remainingUses,
    }
  }

  return null
}

const moveListMenuState = (
  entry: TokenSheetMoveEntry,
): TokenMoveListMenuState => {
  const projection = entry.moveListProjection
  if (!projection) {
    return {
      source: 'placement',
      effectId: null,
      copiedSpecHash: null,
      available: true,
      blockReason: null,
      blockingEffectIds: [],
    }
  }
  return {
    source: projection.source.kind,
    effectId: projection.source.kind === 'encounter-overlay'
      ? projection.source.effectId
      : null,
    copiedSpecHash: projection.source.kind === 'encounter-overlay'
      ? projection.source.copiedSpecHash
      : null,
    available: projection.available,
    blockReason: projection.blockReason,
    blockingEffectIds: [...projection.blockingEffectIds],
  }
}

const optionForMoveRow = (
  row: MoveLookupRow<TokenSheetMove>,
  entry: TokenSheetMoveEntry,
  index: number,
  token: SpawnedPokemon,
  hasAutomationScript: boolean,
  usageContext: TokenMoveUsageContext = {},
): TokenMoveMenuOption => {
  const letterPressHiddenPower = letterPressHiddenPowerSourceSlug(row.move.name) !== null
  const name = letterPressHiddenPower ? row.move.name : row.reference?.name ?? row.move.name
  const damageClass = letterPressHiddenPower
    ? fallback(row.move.category, row.reference?.damage_class)
    : fallback(row.reference?.damage_class, row.move.category)
  const frequency = fallback(row.reference?.frequency, row.move.frequency)
  const range = fallback(row.reference?.range, row.move.range)
  const usage = buildTokenMoveUsageState(token.id, name, frequency, usageContext)
  const automation = moveAutomationSemanticStatusForMenu(name)
  const moveList = moveListMenuState(entry)
  const conditionUseBlock = moveConditionUseBlock({
    name,
    aliases: [row.move.name],
    damageClass,
    range,
    frequency,
  }, token.conditions)
  const physicalLoadUseBlock = token.physicalPowerLoad?.standardActionsAllowed === false
    ? 'Staggering Weight prevents the Standard Action required to use a Move.' : null
  const damageBase = row.damageBase === null
    ? null
    : row.damageBase + (entry.presentationDamageBaseBonus ?? 0)
  const rawAc = fallback(row.ac, row.reference?.ac, row.move.ac)
  const ac = typeof rawAc === 'number'
    ? Math.max(1, rawAc + (entry.presentationAccuracyCheckModifier ?? 0))
    : rawAc
  const attackStat = row.attackStat ?? 0
  const damage = damageBase === null ? null : findMoveDamageBase(damageBase)
  const signed = (value: number): string => value === 0 ? '' : value > 0 ? `+${value}` : String(value)
  const damageFormula = damageBase === null
    ? null
    : damage
      ? `${damage.count}d${damage.sides}${signed(damage.mod)}${signed(attackStat)}`
      : `DB ${damageBase}${signed(attackStat)}`

  const optionMoveKey = name.trim().toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '') || `row-${index}`
  return {
    optionId: entry.attackSourceId
      ? `${entry.attackSourceId}.move.${optionMoveKey}`
      : `move-option.native.${index}.${optionMoveKey}`,
    name,
    ...(entry.attackSourceId ? { attackSourceId: entry.attackSourceId } : {}),
    ...(entry.attackSourceLabel ? { attackSourceLabel: entry.attackSourceLabel } : {}),
    type: fallback(row.reference?.type, row.move.type),
    damageClass,
    frequency,
    ac,
    range,
    effect: fallback(row.reference?.effect, row.move.effect),
    special: fallback(row.reference?.special, row.move.special),
    damageBase,
    hasStab: row.hasStab,
    damageAverage: damageBase === null ? null : averageMoveDamageForDb(damageBase, attackStat),
    damageFormula,
    attackStat: row.attackStat,
    baseAttackStat: row.baseAttackStat,
    attackStage: row.attackStage,
    attackStatKey: row.attackStatKey,
    attackStatLabel: row.attackStatLabel,
    attackStatAbility: row.attackStatAbility,
    additionalAttackStat: row.additionalAttackStat,
    additionalBaseAttackStat: row.additionalBaseAttackStat,
    additionalAttackStage: row.additionalAttackStage,
    additionalAttackStatKey: row.additionalAttackStatKey,
    additionalAttackStatLabel: row.additionalAttackStatLabel,
    automatic: entry.automatic,
    moveList,
    disabledByMoveList: !moveList.available,
    hasAutomationScript,
    automation,
    disabledByAutomation: automation.baseStatus === 'blocked',
    conditionUseBlock,
    disabledByCondition: conditionUseBlock != null,
    physicalLoadUseBlock,
    disabledByPhysicalLoad: physicalLoadUseBlock !== null,
    usage,
    disabledByUsage: usage?.available === false,
  }
}

export const tokenMoveUseReference = (
  option: Pick<TokenMoveMenuOption, 'name' | 'attackSourceId'>,
): TokenMoveUseReference => Object.freeze({
  moveName: option.name,
  attackSourceId: option.attackSourceId ?? null,
})

export const buildTokenMoveMenuOptions = (
  token: SpawnedPokemon,
  entries: readonly TokenSheetMoveEntry[],
  usageContext: TokenMoveUsageContext = {},
): TokenMoveMenuOption[] => {
  const rows = makeMoveLookupRows(entries.map((entry) => entry.move), {
    stabTypes: token.sheetKind === 'pokemon' ? token.defenderTypes : [],
    physicalAttack: token.atk,
    specialAttack: token.satk,
    physicalAttackStage: token.combatStages.atk,
    specialAttackStage: token.combatStages.satk,
    abilities: token.abilityNames,
    combatSkillRankValue: token.combatSkillRankValue,
    loyalty: token.sheetKind === 'pokemon' ? token.loyalty : undefined,
  })
  return rows
    .map((row, index) => ({ row, index, entry: entries[index] ?? { move: row.move, automatic: false } }))
    .map(({ row, index, entry }) => optionForMoveRow(row, entry, index, token, moveHasAutomationScript(row), usageContext))
}
