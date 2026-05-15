import type { Ref } from 'vue'
import type {
  InventoryEntry,
  SkillRank,
  TrainerAbilityEntry,
  TrainerAdvancementRow,
  TrainerClassEntry,
  TrainerEdgeEntry,
  TrainerEvasion,
  TrainerFeatureEntry,
  TrainerManeuver,
  TrainerMove,
  TrainerOrder,
  TrainerSheet,
  TrainerSkillKey,
  TrainerStatKey,
} from '~/types/trainerSheet'
import { moveArrayItem } from '~/utils/arrayReorder'
import { coerceEvasionBonus } from '~/utils/evasion'
import { parseCsvList } from '~/utils/sheets/csvFields'

export type TrainerEvasionBonusKey = Extract<
  keyof TrainerEvasion,
  'speedBonus' | 'physicalBonus' | 'specialBonus'
>

export type TrainerStatEditableField = 'base' | 'feats' | 'bonus' | 'levelUp' | 'stage'

export function useTrainerSheetRowActions(sheet: Readonly<Ref<TrainerSheet | null>>) {
  const addClass = () =>
    sheet.value?.classes?.push({ name: 'New Class' } as TrainerClassEntry)
  const removeClass = (i: number) =>
    sheet.value?.classes?.splice(i, 1)

  const addMove = () =>
    sheet.value?.movelist?.push({ name: '' } as TrainerMove)
  const removeMove = (i: number | null) => {
    if (i == null) return
    sheet.value?.movelist?.splice(i, 1)
  }
  const reorderMove = (fromIndex: number | null, toIndex: number | null) => {
    moveArrayItem(sheet.value?.movelist, fromIndex, toIndex)
  }

  const addAbility = () =>
    sheet.value?.abilities?.push({ name: '' } as TrainerAbilityEntry)
  const removeAbility = (i: number) =>
    sheet.value?.abilities?.splice(i, 1)

  const addManeuver = () =>
    sheet.value?.maneuvers?.push({ name: 'New Maneuver' } as TrainerManeuver)
  const removeManeuver = (i: number) =>
    sheet.value?.maneuvers?.splice(i, 1)

  const addOrder = () =>
    sheet.value?.orders?.push({ name: 'New Order' } as TrainerOrder)
  const removeOrder = (i: number) =>
    sheet.value?.orders?.splice(i, 1)

  const addFeature = () =>
    sheet.value?.features?.push({ name: 'New Feature' } as TrainerFeatureEntry)
  const removeFeature = (i: number) =>
    sheet.value?.features?.splice(i, 1)

  const addEdge = () =>
    sheet.value?.edges?.push({ name: 'New Edge' } as TrainerEdgeEntry)
  const removeEdge = (i: number) =>
    sheet.value?.edges?.splice(i, 1)

  const addAdvancement = (level: number) => {
    if (!sheet.value?.advancement) return
    if (sheet.value.advancement.find((row) => row.level === level)) return
    sheet.value.advancement.push({ level } as TrainerAdvancementRow)
  }

  /** Update an advancement row, creating it if missing. */
  const setAdv = (level: number, field: keyof TrainerAdvancementRow, value: number | string | undefined) => {
    if (!sheet.value) return
    const list = sheet.value.advancement ?? (sheet.value.advancement = [])
    let row = list.find((entry) => entry.level === level)
    if (!row) {
      row = { level }
      list.push(row)
    }
    ;(row as unknown as Record<string, unknown>)[field as string] = value
  }

  const addInvItem = (key: keyof NonNullable<TrainerSheet['inventory']>) => {
    const inv = sheet.value?.inventory
    if (!inv) return
    ;(inv[key] as InventoryEntry[]).push({ name: 'New Item' })
  }

  const removeInvItem = (key: keyof NonNullable<TrainerSheet['inventory']>, i: number) => {
    const inv = sheet.value?.inventory
    if (!inv) return
    ;(inv[key] as InventoryEntry[]).splice(i, 1)
  }

  // Tags are stored as ``string[]`` on features/orders; expose as CSV.
  const featureTagsCsv = (feature: TrainerFeatureEntry): string => feature.tags?.join(', ') ?? ''
  const setFeatureTags = (feature: TrainerFeatureEntry, raw: string) => {
    feature.tags = parseCsvList(raw)
  }

  const orderTagsCsv = (order: TrainerOrder): string => order.tags?.join(', ') ?? ''
  const setOrderTags = (order: TrainerOrder, raw: string) => {
    order.tags = parseCsvList(raw)
  }

  /** Update a stat sub-field (base/feats/bonus/levelUp/stage). */
  const setStatField = (
    key: TrainerStatKey,
    field: TrainerStatEditableField,
    value: number | undefined,
  ) => {
    if (!sheet.value?.stats) return
    const row = sheet.value.stats[key] ?? {}
    row[field] = typeof value === 'number' ? value : 0
    sheet.value.stats[key] = row
  }

  const setEvasionBonus = (key: TrainerEvasionBonusKey, value: number | undefined) => {
    const evasion = sheet.value?.evasion
    if (!evasion) return
    evasion[key] = coerceEvasionBonus(value)
  }

  /** Update a skill's rank/modifier override. */
  const setSkillRank = (key: TrainerSkillKey, rank: SkillRank | undefined) => {
    if (!sheet.value?.skills) return
    const existing = sheet.value.skills[key] ?? {}
    if (!rank) delete existing.rank
    else existing.rank = rank
    if (existing.rank == null && existing.modifier == null) delete sheet.value.skills[key]
    else sheet.value.skills[key] = existing
  }

  const setSkillModifier = (key: TrainerSkillKey, modifier: number | undefined) => {
    if (!sheet.value?.skills) return
    const existing = sheet.value.skills[key] ?? {}
    if (modifier === undefined || modifier === 0) delete existing.modifier
    else existing.modifier = modifier
    if (existing.rank == null && existing.modifier == null) delete sheet.value.skills[key]
    else sheet.value.skills[key] = existing
  }

  const skillModifier = (key: TrainerSkillKey): number =>
    sheet.value?.skills?.[key]?.modifier ?? 0

  return {
    addClass,
    removeClass,
    addMove,
    removeMove,
    reorderMove,
    addAbility,
    removeAbility,
    addManeuver,
    removeManeuver,
    addOrder,
    removeOrder,
    addFeature,
    removeFeature,
    addEdge,
    removeEdge,
    addAdvancement,
    setAdv,
    addInvItem,
    removeInvItem,
    featureTagsCsv,
    setFeatureTags,
    orderTagsCsv,
    setOrderTags,
    setStatField,
    setEvasionBonus,
    setSkillRank,
    setSkillModifier,
    skillModifier,
  }
}
