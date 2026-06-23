import { computed, watch, type ComputedRef, type Ref } from 'vue'
import { appendInitiativeLogEntry } from '~/utils/initiativeLog'
import { trimmedTextValueFromEvent } from '~/utils/domEvents'
import {
  compareInitiativeOrderEntries,
  normalizeInitiativeValue as normalizeInitiativeOrderValue,
  type InitiativeOrderEntry,
} from '#shared/initiativeOrder'
import {
  fallbackInitiativeOrderEntry,
  initiativeOrderEntryForPlacement,
  type InitiativeSheetReader,
} from '~/utils/initiativeOrderEntries'
import { resolveStats } from '~/utils/sheets/pokemonDerived'
import { resolveTrainerStats } from '~/utils/sheets/trainerDerived'
import { applyCombatStageToStat } from '~/utils/combatStageStats'
import {
  conditionAdjustedCombatStage,
  conditionAdjustedInitiative,
} from '~/utils/sheetConditionEffects'
import { sheetItemsInitiativeBonus } from '~/utils/sheetHeldItemEffects'
import { pokemonHeldItemNames, trainerEquippedItemNames } from '~/utils/sheetItemNames'
import { pokemonTrainingFeatureInitiativeBonus } from '~/utils/sheets/pokemonTrainingFeatures'
import {
  getHpBarDisplayMetrics,
  hpBarPercentFromRatio,
  hpTierForRatio,
} from '~/utils/hpBarDisplay'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SpawnedPokemon } from '~/types/pokemon'
import { MAP_INTERACTION_MODES, type MapInteractionMode } from '#shared/mapInteractionMode'
import type { AdvanceInitiativePayload, SetInitiativePayload } from '#shared/livePlayCommands'
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
  profileUrl: string | null
  currentHp: number
  temporaryHp?: number
  maxHp: number
  fullMaxHp?: number
  conditions: string[]
  /** Raw map-local initiative input before condition effects. */
  initiative: number | null
  /** Raw Speed before Combat Stages. */
  baseSpeed: number
  /** Speed after current Combat Stages, before item/training bonuses. */
  speed: number
  /** Effective Speed Combat Stage used to calculate Speed. */
  speedCombatStage: number
  /** Default initiative before non-Speed condition effects: staged Speed plus sheet item bonuses such as Quick Claw. */
  baseInitiative: number
  /** Initiative bonus supplied by sheet equipment. */
  initiativeItemBonus: number
  /** Initiative bonus supplied by active Training Features such as Agility Training. */
  initiativeTrainingBonus: number
  /** Per-trainer accent colour for this token, if one is assigned. */
  accentColor?: string
  /** Final initiative after applying conditions such as Paralysis and Flinch. */
  initiativeScore: number
}

export interface UseInitiativeTrackerOptions {
  map: Ref<TabletopMap | null>
  spawnedPokemon: ComputedRef<SpawnedPokemon[]>
  pokemonBySlug: SheetMapRef<CharacterSheet>
  trainerBySlug: SheetMapRef<TrainerSheet>
  canManageInitiative: ComputedRef<boolean>
  interactionMode?: ComputedRef<MapInteractionMode>
  dispatchSetInitiative?: (payload: SetInitiativePayload) => Promise<unknown>
  dispatchNextInitiative?: (payload: AdvanceInitiativePayload) => Promise<unknown>
  dispatchPreviousInitiative?: (payload: AdvanceInitiativePayload) => Promise<unknown>
  focusEntry?: (id: string) => void
  now?: () => number
  maxInitiativeLogEntries?: number
}

export { normalizeInitiativeValue } from '#shared/initiativeOrder'

const normalizeInitiativeRound = (value: unknown): number => {
  const round = Math.floor(Number(value ?? 1))
  return Number.isFinite(round) && round > 0 ? round : 1
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

export const initiativeSpriteFrameStyle = (entry: Pick<InitiativeRow, 'sprite'>): Record<string, string> => ({
  backgroundImage: entry.sprite.url ? `url(${entry.sprite.url})` : 'none',
  width: `${entry.sprite.frameWidth}px`,
  height: `${entry.sprite.frameHeight}px`,
  transform: `scale(${entry.sprite.scale})`,
})

const initiativeHpMetrics = (entry: InitiativeRow) => getHpBarDisplayMetrics(entry)

export const hpPercent = (entry: InitiativeRow): string =>
  hpBarPercentFromRatio(initiativeHpMetrics(entry).currentRatio)

export const hpBlockedPercent = (entry: InitiativeRow): string =>
  hpBarPercentFromRatio(initiativeHpMetrics(entry).blockedRatio)

export const hasHpBlocked = (entry: InitiativeRow): boolean =>
  initiativeHpMetrics(entry).blockedRatio > 0

export const hpTier = (entry: InitiativeRow): 'critical' | 'wounded' | 'healthy' =>
  hpTierForRatio(initiativeHpMetrics(entry).currentRatio)

export const useInitiativeTracker = ({
  map,
  spawnedPokemon,
  pokemonBySlug,
  trainerBySlug,
  canManageInitiative,
  interactionMode,
  dispatchSetInitiative,
  dispatchNextInitiative,
  dispatchPreviousInitiative,
  focusEntry,
  now,
  maxInitiativeLogEntries,
}: UseInitiativeTrackerOptions) => {
  const baseSpeedForPlacement = (kind: InitiativeKind, sheetSlug: string): number => {
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

  const initiativeTrainingBonusForPlacement = (kind: InitiativeKind, sheetSlug: string): number => {
    if (kind !== 'pokemon') return 0
    const sheet = pokemonBySlug.value?.get(sheetSlug)
    return sheet ? pokemonTrainingFeatureInitiativeBonus(sheet.activeTrainingFeature) : 0
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

  const readInitiativeSheet: InitiativeSheetReader = (kind, slug) => {
    const sheet = kind === 'pokemon'
      ? pokemonBySlug.value?.get(slug)
      : trainerBySlug.value?.get(slug)
    return sheet ? { sheet: sheet as unknown as Record<string, unknown> } : null
  }

  const initiativeOrderEntryByPlacementId = computed(() => new Map(
    (map.value?.placements ?? []).map((placement) => [
      placement.id,
      initiativeOrderEntryForPlacement(placement, readInitiativeSheet),
    ] as const),
  ))

  const fallbackInitiativeRowForPlacement = (
    placement: TabletopMap['placements'][number],
    orderEntry: InitiativeOrderEntry = fallbackInitiativeOrderEntry(placement),
  ): InitiativeRow => {
    const initiative = normalizeInitiativeOrderValue(placement.initiative)
    const initiativeScore = orderEntry.initiativeScore
    return {
      id: placement.id,
      name: orderEntry.displayName,
      meta: `${placement.sheetKind === 'pokemon' ? 'Pokémon' : 'Trainer'} · unresolved token`,
      sprite: {
        url: null,
        isSpriteSheet: false,
        frameWidth: 32,
        frameHeight: 32,
        scale: 1,
      },
      profileUrl: null,
      currentHp: 1,
      maxHp: 1,
      conditions: [],
      initiative,
      baseSpeed: 0,
      speed: 0,
      speedCombatStage: 0,
      baseInitiative: orderEntry.hasExplicitInitiative ? (initiative ?? initiativeScore) : initiativeScore,
      initiativeItemBonus: 0,
      initiativeTrainingBonus: 0,
      initiativeScore,
    }
  }

  const initiativeRows = computed<InitiativeRow[]>(() => {
    const placements = new Map((map.value?.placements ?? []).map((placement) => [placement.id, placement]))
    const renderedIds = new Set<string>()
    const rows: InitiativeRow[] = spawnedPokemon.value.map((pokemon): InitiativeRow => {
      renderedIds.add(pokemon.id)
      const placement = placements.get(pokemon.id)
      const baseSpeed = baseSpeedForPlacement(pokemon.sheetKind, pokemon.sheetSlug)
      const speedCombatStage = conditionAdjustedCombatStage(
        pokemon.combatStages?.spd,
        pokemon.conditions,
        'spd',
        { abilities: pokemon.abilityNames },
      )
      const speed = applyCombatStageToStat(baseSpeed, speedCombatStage)
      const initiativeItemBonus = initiativeItemBonusForPlacement(pokemon.sheetKind, pokemon.sheetSlug)
      const initiativeTrainingBonus = initiativeTrainingBonusForPlacement(pokemon.sheetKind, pokemon.sheetSlug)
      const baseInitiative = speed + initiativeItemBonus + initiativeTrainingBonus
      const initiative = normalizeInitiativeOrderValue(placement?.initiative)
      return {
        id: pokemon.id,
        name: pokemon.species,
        meta: metaForPlacement(pokemon.sheetKind, pokemon.sheetSlug),
        sprite: initiativeSpriteFor(pokemon),
        profileUrl: pokemon.profileSpriteUrl ?? null,
        currentHp: Math.floor(pokemon.currentHp),
        temporaryHp: pokemon.temporaryHp == null ? undefined : Math.max(0, Math.floor(pokemon.temporaryHp)),
        maxHp: Math.max(0, Math.floor(pokemon.maxHp)),
        fullMaxHp: pokemon.fullMaxHp == null ? undefined : Math.max(0, Math.floor(pokemon.fullMaxHp)),
        conditions: pokemon.conditions,
        initiative,
        baseSpeed,
        speed,
        speedCombatStage,
        baseInitiative,
        initiativeItemBonus,
        initiativeTrainingBonus,
        ...(pokemon.accentColor ? { accentColor: pokemon.accentColor } : {}),
        initiativeScore: conditionAdjustedInitiative(
          initiative ?? baseInitiative,
          pokemon.conditions,
          { abilities: pokemon.abilityNames },
        ),
      }
    })

    for (const placement of map.value?.placements ?? []) {
      if (renderedIds.has(placement.id)) continue
      rows.push(fallbackInitiativeRowForPlacement(
        placement,
        initiativeOrderEntryByPlacementId.value.get(placement.id),
      ))
    }

    return rows
  })

  const initiativeOrderEntryForRow = (row: InitiativeRow): InitiativeOrderEntry => ({
    id: row.id,
    displayName: row.name,
    hasExplicitInitiative: row.initiative !== null,
    initiativeScore: row.initiativeScore,
  })

  const sortedInitiativeRows = computed<InitiativeRow[]>(() =>
    [...initiativeRows.value].sort((left, right) => compareInitiativeOrderEntries(
      initiativeOrderEntryForRow(left),
      initiativeOrderEntryForRow(right),
    )),
  )

  const validInitiativeIds = computed(() => new Set(initiativeRows.value.map((row) => row.id)))
  const activeInitiativeId = computed(() => {
    const id = map.value?.initiative?.activeId ?? null
    return id && validInitiativeIds.value.has(id) ? id : null
  })
  const initiativeRound = computed(() => normalizeInitiativeRound(map.value?.initiative?.round))
  const hasInitiativeValues = computed(() =>
    (map.value?.placements ?? []).some((placement) => normalizeInitiativeOrderValue(placement.initiative) !== null),
  )

  const livePlayInitiativeCommandsEnabled = () => interactionMode?.value === MAP_INTERACTION_MODES.LIVE_PLAY

  const dispatchLiveSetInitiative = (payload: SetInitiativePayload): boolean => {
    if (!livePlayInitiativeCommandsEnabled() || !dispatchSetInitiative) return false
    void dispatchSetInitiative(payload)
    return true
  }

  const visibleAdvancePrecondition = (): AdvanceInitiativePayload => ({
    orderIds: sortedInitiativeRows.value.map((row) => row.id),
    activeId: activeInitiativeId.value ?? null,
    round: initiativeRound.value,
  })

  const ensureInitiativeState = (): InitiativeTrackerState | null => {
    if (!map.value) return null
    if (!map.value.initiative || typeof map.value.initiative !== 'object') {
      map.value.initiative = { activeId: null, round: 1 }
    }
    map.value.initiative.round = normalizeInitiativeRound(map.value.initiative.round)
    return map.value.initiative
  }

  const placementById = (id: string) => map.value?.placements.find((placement) => placement.id === id) ?? null

  const initiativeCharacterName = (id: string): string =>
    initiativeRows.value.find((row) => row.id === id)?.name
    ?? placementById(id)?.sheetSlug
    ?? id

  const appendInitiativeGainLog = (id: string) => {
    if (!map.value) return
    map.value.metadata = appendInitiativeLogEntry(map.value.metadata, {
      userId: id,
      userName: initiativeCharacterName(id),
    }, {
      ...(now ? { now } : {}),
      ...(maxInitiativeLogEntries === undefined ? {} : { maxLogEntries: maxInitiativeLogEntries }),
    })
  }

  const activeInitiativeChanged = (
    before: { readonly activeId: string | null; readonly round: number },
    after: { readonly activeId: string | null; readonly round: number },
  ): boolean => Boolean(after.activeId) && (after.activeId !== before.activeId || after.round !== before.round)

  const setActiveInitiative = (id: string) => {
    if (!canManageInitiative.value) return
    if (dispatchLiveSetInitiative({ activeId: id })) return
    const state = ensureInitiativeState()
    if (!state) return
    const previousActiveId = state.activeId ?? null
    if (previousActiveId === id) return
    state.activeId = id
    appendInitiativeGainLog(id)
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
    const raw = trimmedTextValueFromEvent(event)
    if (!raw) {
      if (dispatchLiveSetInitiative({ tokenId: id, initiative: null })) return
      const placement = placementById(id)
      if (!placement) return
      delete placement.initiative
      return
    }
    const n = Number(raw)
    if (!Number.isFinite(n)) return
    const initiative = Math.max(-999, Math.min(999, Math.trunc(n)))
    if (dispatchLiveSetInitiative({ tokenId: id, initiative })) return
    const placement = placementById(id)
    if (!placement) return
    placement.initiative = initiative
  }

  const setInitiativeFromSpeed = (id: string, speed: number) => {
    if (!canManageInitiative.value) return
    if (!Number.isFinite(speed)) return
    const initiative = Math.max(-999, Math.min(999, Math.trunc(speed)))
    if (dispatchLiveSetInitiative({ tokenId: id, initiative })) return
    const placement = placementById(id)
    if (!placement) return
    placement.initiative = initiative
  }

  const setInitiativeRound = (event: Event) => {
    if (!canManageInitiative.value) return
    const raw = trimmedTextValueFromEvent(event)
    const n = Number(raw)
    const round = raw && Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1
    if (dispatchLiveSetInitiative({ round })) return
    const state = ensureInitiativeState()
    if (!state) return
    state.round = round
  }

  const fillInitiativeFromSpeed = () => {
    if (!map.value || !canManageInitiative.value) return
    const baseInitiatives = new Map(initiativeRows.value.map((entry) => [entry.id, entry.baseInitiative]))
    if (livePlayInitiativeCommandsEnabled() && dispatchSetInitiative) {
      void (async () => {
        for (const placement of map.value?.placements ?? []) {
          const baseInitiative = baseInitiatives.get(placement.id)
          if (baseInitiative !== undefined) await dispatchSetInitiative({ tokenId: placement.id, initiative: baseInitiative })
        }
      })()
      return
    }
    for (const placement of map.value.placements) {
      const baseInitiative = baseInitiatives.get(placement.id)
      if (baseInitiative !== undefined) placement.initiative = baseInitiative
    }
  }

  const clearInitiativeValues = () => {
    if (!map.value || !canManageInitiative.value) return
    if (livePlayInitiativeCommandsEnabled() && dispatchSetInitiative) {
      void (async () => {
        for (const placement of map.value?.placements ?? []) await dispatchSetInitiative({ tokenId: placement.id, initiative: null })
        await dispatchSetInitiative({ activeId: null, round: 1 })
      })()
      return
    }
    for (const placement of map.value.placements) delete placement.initiative
    const state = ensureInitiativeState()
    if (state) {
      state.activeId = null
      state.round = 1
    }
  }

  const clearActiveInitiative = () => {
    if (!canManageInitiative.value) return
    if (dispatchLiveSetInitiative({ activeId: null })) return
    if (!map.value?.initiative) return
    map.value.initiative.activeId = null
  }

  const nextInitiative = () => {
    if (!canManageInitiative.value) return
    if (livePlayInitiativeCommandsEnabled() && dispatchNextInitiative) return dispatchNextInitiative(visibleAdvancePrecondition())
    const order = sortedInitiativeRows.value
    if (!order.length) return
    const state = ensureInitiativeState()
    if (!state) return

    const before = { activeId: state.activeId ?? null, round: initiativeRound.value }
    const ids = order.map((entry) => entry.id)
    const currentIndex = state.activeId ? ids.indexOf(state.activeId) : -1
    const nextIndex = currentIndex >= 0 && currentIndex < ids.length - 1 ? currentIndex + 1 : 0
    if (currentIndex === ids.length - 1) state.round = initiativeRound.value + 1
    state.activeId = ids[nextIndex]

    const after = { activeId: state.activeId ?? null, round: normalizeInitiativeRound(state.round) }
    if (activeInitiativeChanged(before, after) && after.activeId) appendInitiativeGainLog(after.activeId)
  }

  const previousInitiative = () => {
    if (!canManageInitiative.value) return
    if (livePlayInitiativeCommandsEnabled() && dispatchPreviousInitiative) return dispatchPreviousInitiative(visibleAdvancePrecondition())
    const order = sortedInitiativeRows.value
    if (!order.length) return
    const state = ensureInitiativeState()
    if (!state) return

    const before = { activeId: state.activeId ?? null, round: initiativeRound.value }
    const ids = order.map((entry) => entry.id)
    const currentIndex = state.activeId ? ids.indexOf(state.activeId) : -1
    const previousIndex = currentIndex > 0 ? currentIndex - 1 : ids.length - 1
    if (currentIndex === 0) state.round = Math.max(1, initiativeRound.value - 1)
    state.activeId = ids[previousIndex]

    const after = { activeId: state.activeId ?? null, round: normalizeInitiativeRound(state.round) }
    if (activeInitiativeChanged(before, after) && after.activeId) appendInitiativeGainLog(after.activeId)
  }

  watch(
    () => [map.value?.initiative?.activeId ?? null, initiativeRows.value.map((row) => row.id).join('|')] as const,
    ([activeId]) => {
      if (!activeId || !map.value?.initiative || livePlayInitiativeCommandsEnabled()) return
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
    hpBlockedPercent,
    hasHpBlocked,
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
