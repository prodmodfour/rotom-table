import type { Ref } from 'vue'
import type {
  CharacterSheet,
  CharacterSheetAbility,
  CharacterSheetAppliedMove,
  CharacterSheetEdge,
  CharacterSheetEvasion,
  CharacterSheetMove,
  StatKey,
} from '~/types/characterSheet'
import { moveArrayItem } from '~/utils/arrayReorder'
import { coerceEvasionBonus } from '~/utils/evasion'
import { setSheetAccuracyStage } from '~/utils/sheetAccuracy'
import {
  POKEMON_RARE_CANDY_LIMIT,
  coercePokemonVitaminCount,
  type PokemonVitaminFlagKey,
  type PokemonVitaminNumberKey,
  type PokemonVitaminStatCountKind,
  type PokemonVitaminTextKey,
} from '~/utils/sheets/pokemonVitamins'

export type PokemonEvasionBonusKey = Extract<
  keyof CharacterSheetEvasion,
  'vsAtkBonus' | 'vsSatkBonus' | 'vsAnyBonus'
>

export type PokemonStatEditableField = 'added' | 'stage'

export function usePokemonSheetRowActions(sheet: Readonly<Ref<CharacterSheet | null>>) {
  const clearLookupBackedItemFields = () => {
    if (!sheet.value?.items) return
    delete sheet.value.items.itemDescription
    delete sheet.value.items.extraItems
    delete sheet.value.items.pointsLeft
  }

  const setHeldItemName = (value: unknown) => {
    if (!sheet.value) return
    const next = typeof value === 'string' ? value : value == null ? '' : String(value)
    sheet.value.items!.held = next
    // The sheet stores only the held item name; display details come from
    // data/reference/items.json via data/ptuReference.ts.
    clearLookupBackedItemFields()
  }

  const addMove = () => {
    sheet.value?.movelist?.push({ name: '' } as CharacterSheetMove)
  }

  const removeMove = (i: number | null) => {
    if (i == null) return
    sheet.value?.movelist?.splice(i, 1)
  }

  const reorderMove = (fromIndex: number | null, toIndex: number | null) => {
    moveArrayItem(sheet.value?.movelist, fromIndex, toIndex)
  }

  const addEggMove = () => {
    if (!sheet.value) return
    const eggMoves = sheet.value.eggMoves ?? []
    eggMoves.push({ name: '' } as CharacterSheetMove)
    sheet.value.eggMoves = eggMoves
  }

  const removeEggMove = (i: number) => {
    sheet.value?.eggMoves?.splice(i, 1)
  }

  const addAppliedMove = () => {
    if (!sheet.value) return
    const appliedMoves = sheet.value.appliedMoves ?? []
    appliedMoves.push({ name: '', source: 'tm' } as CharacterSheetAppliedMove)
    sheet.value.appliedMoves = appliedMoves
  }

  const removeAppliedMove = (i: number) => {
    sheet.value?.appliedMoves?.splice(i, 1)
  }

  const addAbility = () => {
    sheet.value?.abilities?.push({ name: '' } as CharacterSheetAbility)
  }

  const removeAbility = (i: number) => {
    sheet.value?.abilities?.splice(i, 1)
  }

  const addEdge = () => {
    sheet.value?.edges?.push({ name: '', choices: {} } as CharacterSheetEdge)
  }

  const removeEdge = (i: number) => {
    sheet.value?.edges?.splice(i, 1)
  }

  const setStat = (key: StatKey, field: PokemonStatEditableField, value: number | undefined) => {
    if (!sheet.value?.stats) return
    const row = sheet.value.stats[key] ?? {}
    row[field] = typeof value === 'number' ? value : 0
    sheet.value.stats[key] = row
  }

  const setEvasionBonus = (key: PokemonEvasionBonusKey, value: number | undefined) => {
    const evasion = sheet.value?.combat?.evasion
    if (!evasion) return
    evasion[key] = coerceEvasionBonus(value)
  }

  const setAccuracyStage = (value: unknown) => {
    if (!sheet.value) return
    setSheetAccuracyStage(sheet.value, value)
  }

  const ensureVitaminTracking = (): NonNullable<CharacterSheet['vitamins']> | null => {
    if (!sheet.value) return null
    const vitamins = sheet.value.vitamins ?? {}
    if (!vitamins.statBoosts || typeof vitamins.statBoosts !== 'object' || Array.isArray(vitamins.statBoosts)) {
      vitamins.statBoosts = {}
    }
    if (!vitamins.statSuppressants || typeof vitamins.statSuppressants !== 'object' || Array.isArray(vitamins.statSuppressants)) {
      vitamins.statSuppressants = {}
    }
    sheet.value.vitamins = vitamins
    return vitamins
  }

  const setVitaminStatCount = (kind: PokemonVitaminStatCountKind, key: StatKey, value: unknown) => {
    const vitamins = ensureVitaminTracking()
    if (!vitamins) return
    const counts = vitamins[kind] ?? {}
    counts[key] = coercePokemonVitaminCount(value)
    vitamins[kind] = counts
  }

  const setVitaminFlag = (key: PokemonVitaminFlagKey, value: boolean) => {
    const vitamins = ensureVitaminTracking()
    if (!vitamins) return
    vitamins[key] = value === true
  }

  const setVitaminNumber = (key: PokemonVitaminNumberKey, value: unknown) => {
    const vitamins = ensureVitaminTracking()
    if (!vitamins) return
    vitamins[key] = coercePokemonVitaminCount(
      value,
      key === 'rareCandies' ? { max: POKEMON_RARE_CANDY_LIMIT } : {},
    )
  }

  const setVitaminText = (key: PokemonVitaminTextKey, value: string | undefined) => {
    const vitamins = ensureVitaminTracking()
    if (!vitamins) return
    const next = typeof value === 'string' ? value : value == null ? '' : String(value)
    vitamins[key] = next
  }

  const setInheritedMove = (level: string, value: string | undefined) => {
    if (!sheet.value) return
    const inherited = sheet.value.inheritedMoves ?? {}
    if (value && value.trim()) inherited[level] = value
    else delete inherited[level]
    sheet.value.inheritedMoves = inherited
  }

  return {
    setHeldItemName,
    addMove,
    removeMove,
    reorderMove,
    addEggMove,
    removeEggMove,
    addAppliedMove,
    removeAppliedMove,
    addAbility,
    removeAbility,
    addEdge,
    removeEdge,
    setStat,
    setEvasionBonus,
    setAccuracyStage,
    setVitaminStatCount,
    setVitaminFlag,
    setVitaminNumber,
    setVitaminText,
    setInheritedMove,
  }
}
