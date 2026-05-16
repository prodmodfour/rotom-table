import { computed, watch, type ComputedRef, type Ref } from 'vue'
import { trimmedTextValueFromEvent } from '~/utils/domEvents'
import { resolveStats } from '~/utils/sheets/pokemonDerived'
import { resolveTrainerStats } from '~/utils/sheets/trainerDerived'
import { conditionAdjustedInitiative } from '~/utils/sheetConditionEffects'
import { sheetItemsInitiativeBonus } from '~/utils/sheetHeldItemEffects'
import { pokemonHeldItemNames, trainerEquippedItemNames } from '~/utils/sheetItemNames'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { InitiativeTrackerState, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'

type InitiativeKind = 'pokemon' | 'trainer'

type SheetMapRef<T> = Ref<Map<string, T> | undefined>

export interface InitiativeSpritePreview {
  url: string | null
  isSpriteSheet: boolean
  frameWidth: number
  frameHeight: number
  scale: number
}

export interface InitiativeRow {
  id: string
  name: string
  meta: string
  sprite: InitiativeSpritePreview
  currentHp: number
  maxHp: number
  conditions: string[]
  /** Raw map-local initiative input before condition effects. */
  initiative: number | null
  speed: number
  /** Default initiative before condition effects: Speed plus sheet item bonuses such as Quick Claw. */
  baseInitiative: number
  /** Initiative bonus supplied by sheet equipment. */
  initiativeItemBonus: number
  /** Final initiative after applying conditions such as Paralysis and Flinch. */
  initiativeScore: number
}

export interface UseInitiativeTrackerOptions {
  map: Ref<TabletopMap | null>
  spawnedPokemon: ComputedRef<SpawnedPokemon[]>
  pokemonBySlug: SheetMapRef<CharacterSheet>
  trainerBySlug: SheetMapRef<TrainerSheet>
  canManageInitiative: ComputedRef<boolean>
  focusEntry?: (id: string) => void
}

export const normalizeInitiativeValue = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.trunc(n)
}

const initiativeSpriteScale = (width: number, height: number): number =>
  Math.min(1, 32 / Math.max(width, height, 1))

const initiativeSpriteFor = (pokemon: SpawnedPokemon): InitiativeSpritePreview => {
  const animation = pokemon.spriteAnimation
  if (animation) {
    return {
      url: animation.url,
      isSpriteSheet: true,
      frameWidth: animation.frameWidth,
      frameHeight: animation.frameHeight,
      scale: initiativeSpriteScale(animation.frameWidth, animation.frameHeight),
    }
  }

  return {
    url: pokemon.spriteUrl ?? null,
    isSpriteSheet: false,
    frameWidth: 32,
    frameHeight: 32,
    scale: 1,
  }
}

export const initiativeSpriteFrameStyle = (entry: InitiativeRow): Record<string, string> => ({
  backgroundImage: entry.sprite.url ? `url(${entry.sprite.url})` : 'none',
  width: `${entry.sprite.frameWidth}px`,
  height: `${entry.sprite.frameHeight}px`,
  transform: `scale(${entry.sprite.scale})`,
})

export const hpPercent = (entry: InitiativeRow): string => {
  if (entry.maxHp <= 0) return '0%'
  const percent = Math.max(0, Math.min(100, (entry.currentHp / entry.maxHp) * 100))
  return `${percent}%`
}

export const hpTier = (entry: InitiativeRow): 'critical' | 'wounded' | 'healthy' => {
  if (entry.maxHp <= 0) return 'critical'
  const ratio = Math.max(0, Math.min(1, entry.currentHp / entry.maxHp))
  if (ratio <= 0.25) return 'critical'
  if (ratio <= 0.5) return 'wounded'
  return 'healthy'
}

export const useInitiativeTracker = ({
  map,
  spawnedPokemon,
  pokemonBySlug,
  trainerBySlug,
  canManageInitiative,
  focusEntry,
}: UseInitiativeTrackerOptions) => {
  const speedForPlacement = (kind: InitiativeKind, sheetSlug: string): number => {
    if (kind === 'pokemon') {
      const sheet = pokemonBySlug.value?.get(sheetSlug)
      if (!sheet) return 0
      return resolveStats(sheet).find((row) => row.key === 'spd')?.total ?? 0
    }
    const sheet = trainerBySlug.value?.get(sheetSlug)
    if (!sheet) return 0
    return resolveTrainerStats(sheet).find((row) => row.key === 'spd')?.total ?? 0
  }

  const initiativeItemBonusForPlacement = (kind: InitiativeKind, sheetSlug: string): number => {
    if (kind === 'pokemon') {
      const sheet = pokemonBySlug.value?.get(sheetSlug)
      return sheet ? sheetItemsInitiativeBonus(pokemonHeldItemNames(sheet)) : 0
    }
    const sheet = trainerBySlug.value?.get(sheetSlug)
    return sheet ? sheetItemsInitiativeBonus(trainerEquippedItemNames(sheet)) : 0
  }

  const metaForPlacement = (kind: InitiativeKind, sheetSlug: string): string => {
    if (kind === 'pokemon') {
      const sheet = pokemonBySlug.value?.get(sheetSlug)
      return sheet ? `${sheet.species} · Lv ${sheet.level}` : 'Pokémon'
    }
    const sheet = trainerBySlug.value?.get(sheetSlug)
    const className = sheet?.classes?.[0]?.name
    if (!sheet) return 'Trainer'
    return className ? `Trainer · Lv ${sheet.level} · ${className}` : `Trainer · Lv ${sheet.level}`
  }

  const initiativeRows = computed<InitiativeRow[]>(() => {
    const placements = new Map((map.value?.placements ?? []).map((placement) => [placement.id, placement]))
    return spawnedPokemon.value.map((pokemon) => {
      const placement = placements.get(pokemon.id)
      const speed = speedForPlacement(pokemon.sheetKind, pokemon.sheetSlug)
      const initiativeItemBonus = initiativeItemBonusForPlacement(pokemon.sheetKind, pokemon.sheetSlug)
      const baseInitiative = speed + initiativeItemBonus
      const initiative = normalizeInitiativeValue(placement?.initiative)
      return {
        id: pokemon.id,
        name: pokemon.species,
        meta: metaForPlacement(pokemon.sheetKind, pokemon.sheetSlug),
        sprite: initiativeSpriteFor(pokemon),
        currentHp: Math.max(0, Math.floor(pokemon.currentHp)),
        maxHp: Math.max(0, Math.floor(pokemon.maxHp)),
        conditions: pokemon.conditions,
        initiative,
        speed,
        baseInitiative,
        initiativeItemBonus,
        initiativeScore: conditionAdjustedInitiative(
          initiative ?? baseInitiative,
          pokemon.conditions,
          { abilities: pokemon.abilityNames },
        ),
      }
    })
  })

  const sortedInitiativeRows = computed<InitiativeRow[]>(() =>
    [...initiativeRows.value].sort((a, b) => {
      const aHasInitiative = a.initiative !== null
      const bHasInitiative = b.initiative !== null
      if (aHasInitiative !== bHasInitiative) return aHasInitiative ? -1 : 1
      if (a.initiativeScore !== b.initiativeScore) return b.initiativeScore - a.initiativeScore
      return a.name.localeCompare(b.name)
    }),
  )

  const validInitiativeIds = computed(() => new Set(initiativeRows.value.map((row) => row.id)))
  const activeInitiativeId = computed(() => {
    const id = map.value?.initiative?.activeId ?? null
    return id && validInitiativeIds.value.has(id) ? id : null
  })
  const initiativeRound = computed(() => {
    const round = Math.floor(Number(map.value?.initiative?.round ?? 1))
    return Number.isFinite(round) && round > 0 ? round : 1
  })
  const hasInitiativeValues = computed(() =>
    (map.value?.placements ?? []).some((placement) => normalizeInitiativeValue(placement.initiative) !== null),
  )

  const ensureInitiativeState = (): InitiativeTrackerState | null => {
    if (!map.value) return null
    if (!map.value.initiative || typeof map.value.initiative !== 'object') {
      map.value.initiative = { activeId: null, round: 1 }
    }
    const round = Math.floor(Number(map.value.initiative.round ?? 1))
    map.value.initiative.round = Number.isFinite(round) && round > 0 ? round : 1
    return map.value.initiative
  }

  const placementById = (id: string) => map.value?.placements.find((placement) => placement.id === id) ?? null

  const setActiveInitiative = (id: string) => {
    if (!canManageInitiative.value) return
    const state = ensureInitiativeState()
    if (!state) return
    state.activeId = id
  }

  const focusInitiativeEntry = (id: string) => {
    focusEntry?.(id)
  }

  const setActiveInitiativeAndFocus = (id: string) => {
    setActiveInitiative(id)
    focusInitiativeEntry(id)
  }

  const setInitiativeInput = (id: string, event: Event) => {
    if (!canManageInitiative.value) return
    const placement = placementById(id)
    if (!placement) return
    const raw = trimmedTextValueFromEvent(event)
    if (!raw) {
      delete placement.initiative
      return
    }
    const n = Number(raw)
    if (!Number.isFinite(n)) return
    placement.initiative = Math.max(-999, Math.min(999, Math.trunc(n)))
  }

  const setInitiativeFromSpeed = (id: string, speed: number) => {
    if (!canManageInitiative.value) return
    const placement = placementById(id)
    if (!placement) return
    if (!Number.isFinite(speed)) return
    placement.initiative = Math.max(-999, Math.min(999, Math.trunc(speed)))
  }

  const setInitiativeRound = (event: Event) => {
    if (!canManageInitiative.value) return
    const state = ensureInitiativeState()
    if (!state) return
    const raw = trimmedTextValueFromEvent(event)
    if (!raw) {
      state.round = 1
      return
    }
    const n = Number(raw)
    state.round = Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1
  }

  const fillInitiativeFromSpeed = () => {
    if (!map.value || !canManageInitiative.value) return
    const baseInitiatives = new Map(initiativeRows.value.map((entry) => [entry.id, entry.baseInitiative]))
    for (const placement of map.value.placements) {
      const baseInitiative = baseInitiatives.get(placement.id)
      if (baseInitiative !== undefined) placement.initiative = baseInitiative
    }
  }

  const clearInitiativeValues = () => {
    if (!map.value || !canManageInitiative.value) return
    for (const placement of map.value.placements) delete placement.initiative
    const state = ensureInitiativeState()
    if (state) {
      state.activeId = null
      state.round = 1
    }
  }

  const clearActiveInitiative = () => {
    if (!map.value?.initiative || !canManageInitiative.value) return
    map.value.initiative.activeId = null
  }

  const nextInitiative = () => {
    if (!canManageInitiative.value) return
    const order = sortedInitiativeRows.value
    if (!order.length) return
    const state = ensureInitiativeState()
    if (!state) return

    const ids = order.map((entry) => entry.id)
    const currentIndex = state.activeId ? ids.indexOf(state.activeId) : -1
    const nextIndex = currentIndex >= 0 && currentIndex < ids.length - 1 ? currentIndex + 1 : 0
    if (currentIndex === ids.length - 1) state.round = initiativeRound.value + 1
    state.activeId = ids[nextIndex]
  }

  const previousInitiative = () => {
    if (!canManageInitiative.value) return
    const order = sortedInitiativeRows.value
    if (!order.length) return
    const state = ensureInitiativeState()
    if (!state) return

    const ids = order.map((entry) => entry.id)
    const currentIndex = state.activeId ? ids.indexOf(state.activeId) : -1
    const previousIndex = currentIndex > 0 ? currentIndex - 1 : ids.length - 1
    if (currentIndex === 0) state.round = Math.max(1, initiativeRound.value - 1)
    state.activeId = ids[previousIndex]
  }

  watch(
    () => [map.value?.initiative?.activeId ?? null, initiativeRows.value.map((row) => row.id).join('|')] as const,
    ([activeId]) => {
      if (!activeId || !map.value?.initiative) return
      if (!validInitiativeIds.value.has(activeId)) map.value.initiative.activeId = null
    },
  )

  return {
    initiativeRows,
    sortedInitiativeRows,
    activeInitiativeId,
    initiativeRound,
    hasInitiativeValues,
    initiativeSpriteFrameStyle,
    hpPercent,
    hpTier,
    focusInitiativeEntry,
    setActiveInitiative,
    setActiveInitiativeAndFocus,
    setInitiativeInput,
    setInitiativeFromSpeed,
    setInitiativeRound,
    fillInitiativeFromSpeed,
    clearInitiativeValues,
    clearActiveInitiative,
    nextInitiative,
    previousInitiative,
  }
}
