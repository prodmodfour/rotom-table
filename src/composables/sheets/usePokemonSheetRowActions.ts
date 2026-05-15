import type { Ref } from 'vue'
import type {
  CharacterSheet,
  CharacterSheetAbility,
  CharacterSheetEdge,
  CharacterSheetEvasion,
  CharacterSheetMove,
  StatKey,
} from '~/types/characterSheet'
import { moveArrayItem } from '~/utils/arrayReorder'
import { coerceEvasionBonus } from '~/utils/evasion'
import { toggleSheetAbilityActivation } from '~/utils/sheetAbilityActivation'

export type PokemonEvasionBonusKey = Extract<
  keyof CharacterSheetEvasion,
  'vsAtkBonus' | 'vsSatkBonus' | 'vsAnyBonus'
>

export type PokemonStatEditableField = 'added' | 'stage'

export function usePokemonSheetRowActions(sheet: Readonly<Ref<CharacterSheet | null>>) {
  const clearLookupBackedItemFields = () => {
    if (!sheet.value?.items) return
    delete sheet.value.items.itemDescription
    delete sheet.value.items.digestionFood
    delete sheet.value.items.extraItems
    delete sheet.value.items.pointsLeft
  }

  const setHeldItemName = (value: unknown) => {
    if (!sheet.value) return
    const next = typeof value === 'string' ? value : value == null ? '' : String(value)
    sheet.value.items!.held = next
    // The sheet stores only the held item name; display details come from
    // ptu-data/data/items.json via data/ptuReference.ts.
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

  const addAbility = () => {
    sheet.value?.abilities?.push({ name: '' } as CharacterSheetAbility)
  }

  const removeAbility = (i: number) => {
    sheet.value?.abilities?.splice(i, 1)
  }

  const toggleAbilityActivation = (i: number) => {
    const ability = sheet.value?.abilities?.[i]
    if (!ability) return
    toggleSheetAbilityActivation(ability)
  }

  const addEdge = () => {
    sheet.value?.edges?.push({ name: 'New Edge' } as CharacterSheetEdge)
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
    addAbility,
    removeAbility,
    toggleAbilityActivation,
    addEdge,
    removeEdge,
    setStat,
    setEvasionBonus,
    setInheritedMove,
  }
}
