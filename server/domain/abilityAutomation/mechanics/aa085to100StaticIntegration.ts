import { createHash } from 'node:crypto'
import type { MoveDamageEffectOperation } from '#shared/moveAutomation/effects'
import type { CharacterSheet } from '~/types/characterSheet'
import type { GridAnchor } from '~/types/map'
import type { PokedexRecord, SpawnedPokemon } from '~/types/pokemon'
import pokedexData from '../../../../data/reference/pokedex.json'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import {
  MOVEMENT_MODES,
  type EffectiveMovementMode,
  type MovementCapabilitySpeeds,
} from '~/types/movement'
import type { MoveDamageModifier } from '~/utils/moveAutomationDamagePipeline'
import { clampCombatStage } from '~/utils/combatStages'
import { gridFootprintCells } from '~/utils/gridGeometry'
import { getVoxelMaterialDefinition } from '~/utils/mapMaterials'
import {
  ptuGridDistanceBetweenFootprints,
  ptuGridVectorDistance,
} from '~/utils/ptuGridDistance'
import { resolveStats } from '~/utils/sheets/pokemonDerived'
import { normalizeConditionNames } from '~/utils/statusConditions'
import { parseMoveAutomationAreaTemplates } from '~/utils/moveAutomationAreaTemplates'
import {
  POKEMON_TYPES,
  computeMultiplier,
  effectivenessStepsFromMultiplier,
  multiplierFromEffectivenessSteps,
  resistMultiplierOneStepFurther,
} from '~/utils/typeChart'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import type { MoveDamageTypeResolution } from '../../moveAutomation/damageTypes'
import type { ValidatedMoveSpecTargetingRule } from '../../moveAutomation/validateSpec'
import { moveAutomationTargetBranches } from '~/utils/moveAutomationTargetBranches'
import { createMoveAutomationWeatherResolver } from '../../moveAutomation/weather'

const shortHash = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)

const ability = (
  context: AuthoritativeMoveRulesContext,
  placementId: string,
  canonicalId: string,
): string | null => context.queries.abilities.activeForPlacement(placementId)
  .find(candidate => candidate.canonicalId === canonicalId)?.instanceId ?? null

const hasWeather = (
  context: AuthoritativeMoveRulesContext,
  kind: 'hail' | 'rainy' | 'sandstorm' | 'sunny',
  placementId = context.actor.placement.id,
): boolean => placementId === context.actor.placement.id
  ? context.queries.weather.active().some(weather => weather.kind === kind)
  : createMoveAutomationWeatherResolver(context.map, {
      subjectPlacementId: placementId,
      ...(context.queries.tokens.get(placementId) ? {
        subjectOccupiedCells: gridFootprintCells(
          context.queries.tokens.get(placementId)!.position,
          context.queries.tokens.get(placementId)!,
        ),
      } : {}),
      ...(context.queries.abilities.has(placementId, 'Water Bubble') ? {
        virtualWeatherKind: 'rainy' as const,
        virtualWeatherSourceId: `ability.water-bubble:${placementId}`,
      } : {}),
    }).active().some(weather => weather.kind === kind)

const activeEffect = (
  context: AuthoritativeMoveRulesContext,
  placementId: string,
  tag: string,
): boolean => context.map.encounterState?.effects.some(effect => (
  effect.tags.includes(tag)
  && effect.affected.placementIds.includes(placementId)
  && effect.suppression.sources.length === 0
  && (effect.duration.remaining === null || effect.duration.remaining > 0)
)) === true

const projectedStageDelta = (
  abilities: ReadonlySet<string>,
  delta: number,
): number => (abilities.has('Contrary') ? -1 : 1)
  * (abilities.has('Simple') ? 2 : 1)
  * delta

export const aa085to100TokenTerrainTags = (input: {
  readonly context: Pick<AuthoritativeMoveRulesContext, 'map'>
  readonly token: SpawnedPokemon
}): readonly string[] => {
  const occupied = gridFootprintCells(input.token.position, input.token)
  return Object.freeze([...new Set(input.context.map.voxels.flatMap(voxel => (
    occupied.some(cell => cell.x === voxel.x && cell.z === voxel.z
      && (cell.y === voxel.y || cell.y - 1 === voxel.y))
      ? [...(voxel.tags ?? []), ...(getVoxelMaterialDefinition(voxel).tags ?? [])]
        .map(tag => tag.trim().toLowerCase()).filter(Boolean)
      : []
  )))])
}

const POKEDEX_BY_SPECIES = new Map(
  (pokedexData as readonly PokedexRecord[]).map(record => [record.species.trim().toLowerCase(), record]),
)

const synchronizedMovementModes = (
  modes: readonly EffectiveMovementMode[],
  speeds: MovementCapabilitySpeeds,
): readonly EffectiveMovementMode[] => {
  const existing = new Map(modes.map(mode => [mode.mode, mode]))
  return MOVEMENT_MODES.map((mode): EffectiveMovementMode => {
    const current = existing.get(mode)
    const speed = mode === 'overland' || mode === 'sky' || mode === 'swim'
      || mode === 'levitate' || mode === 'burrow' || mode === 'climb'
      ? speeds[mode] : undefined
    if (typeof speed === 'number') return {
      mode,
      available: speed > 0,
      speed,
      longJump: current?.longJump ?? null,
      highJump: current?.highJump ?? null,
    }
    return current ?? {
      mode, available: false, speed: null, longJump: null, highJump: null,
    }
  })
}

const parseJumpCapability = (value: string | null | undefined): { long: number; high: number } | null => {
  const match = value?.trim().match(/^(\d+)\s*\/\s*(\d+)$/)
  if (!match?.[1] || !match[2]) return null
  return { long: Number(match[1]), high: Number(match[2]) }
}

const naturewalkFrom = (values: readonly string[] | undefined): string | null => {
  const match = values?.find(value => /^naturewalk\s*\(/i.test(value.trim()))
    ?.match(/^naturewalk\s*\((.+)\)$/i)
  return match?.[1]?.trim() || null
}

const formProjectedToken = (input: {
  readonly token: SpawnedPokemon
  readonly sheet: CharacterSheet | null
  readonly targetSpecies: string
  readonly formId: string
}): SpawnedPokemon => {
  const source = input.sheet
    ? POKEDEX_BY_SPECIES.get(input.sheet.species.trim().toLowerCase()) ?? null
    : null
  const target = POKEDEX_BY_SPECIES.get(input.targetSpecies.trim().toLowerCase()) ?? null
  if (!source || !target || source.species === target.species) return {
    ...input.token,
    creatureRules: input.token.creatureRules
      ? { ...input.token.creatureRules, formId: input.formId }
      : input.token.creatureRules,
  }
  const sourceStats = source.base_stats
  const targetStats = target.base_stats
  const delta = (key: 'atk' | 'def' | 'spd', targetKey: 'atk' | 'def' | 'spd' = key): number => (
    (targetStats?.[targetKey] ?? sourceStats?.[key] ?? 0) - (sourceStats?.[key] ?? 0)
  )
  const capabilityKeys = ['overland', 'sky', 'swim', 'levitate', 'burrow'] as const
  const movementCapabilities = { ...(input.token.movementCapabilities ?? {}) }
  for (const key of capabilityKeys) {
    const sourceValue = source.capabilities?.[key]
    const targetValue = target.capabilities?.[key]
    const current = movementCapabilities[key] ?? sourceValue
    if (typeof current === 'number' && typeof sourceValue === 'number' && typeof targetValue === 'number') {
      movementCapabilities[key] = Math.max(0, current + targetValue - sourceValue)
    }
  }
  const sourceJump = parseJumpCapability(source.capabilities?.jump)
  const targetJump = parseJumpCapability(target.capabilities?.jump)
  const currentJump = input.token.movementTraits?.jump
    ?? input.token.ruleCapabilities?.movementTraits.jump
    ?? sourceJump
  const projectedJump = currentJump && sourceJump && targetJump ? {
    long: Math.max(0, currentJump.long + targetJump.long - sourceJump.long),
    high: Math.max(0, currentJump.high + targetJump.high - sourceJump.high),
  } : targetJump ?? currentJump ?? { long: 0, high: 0 }
  const movementTraits = {
    phasing: input.token.movementTraits?.phasing
      ?? input.token.ruleCapabilities?.movementTraits.phasing
      ?? false,
    jump: projectedJump,
  }
  const movementProfile = input.token.movementProfile ? {
    ...input.token.movementProfile,
    speeds: { ...input.token.movementProfile.speeds, ...movementCapabilities },
    traits: movementTraits,
    modes: synchronizedMovementModes(
      input.token.movementProfile.modes,
      { ...input.token.movementProfile.speeds, ...movementCapabilities },
    ).map(mode => mode.mode === 'jump' ? {
      ...mode,
      available: projectedJump.long > 0 || projectedJump.high > 0,
      longJump: projectedJump.long,
      highJump: projectedJump.high,
    } : mode),
  } : undefined
  const sourceOther = new Set((source.capabilities?.other ?? []).map(value => value.trim().toLowerCase()))
  const preservedOther = (input.token.ruleCapabilities?.other ?? [])
    .filter(value => !sourceOther.has(value.trim().toLowerCase()))
  const projectedOther = [...new Set([...preservedOther, ...(target.capabilities?.other ?? [])])]
  const sourcePower = source.capabilities?.power
  const targetPower = target.capabilities?.power
  const currentPower = input.token.ruleCapabilities?.power
  const projectedPower = typeof currentPower === 'number'
    && typeof sourcePower === 'number' && typeof targetPower === 'number'
    ? Math.max(0, currentPower + targetPower - sourcePower)
    : typeof targetPower === 'number' ? targetPower : currentPower ?? null
  const sourceNaturewalk = naturewalkFrom(source.capabilities?.other)
  const targetNaturewalk = naturewalkFrom(target.capabilities?.other)
  const currentNaturewalk = input.token.ruleCapabilities?.naturewalk ?? null
  const projectedNaturewalk = currentNaturewalk
    && currentNaturewalk.trim().toLowerCase() !== sourceNaturewalk?.trim().toLowerCase()
    ? currentNaturewalk
    : targetNaturewalk
  const projectedRuleCapabilities = input.token.ruleCapabilities ? {
    ...input.token.ruleCapabilities,
    movementSpeeds: {
      ...input.token.ruleCapabilities.movementSpeeds,
      ...movementCapabilities,
    },
    movementTraits,
    power: projectedPower,
    size: target.size ?? input.token.ruleCapabilities.size,
    naturewalk: projectedNaturewalk,
    other: projectedOther,
  } : undefined
  return {
    ...input.token,
    atk: Math.max(1, input.token.atk + delta('atk')),
    def: Math.max(1, input.token.def + delta('def')),
    satk: Math.max(1, input.token.satk
      + (targetStats?.spatk ?? sourceStats?.spatk ?? 0) - (sourceStats?.spatk ?? 0)),
    sdef: Math.max(1, input.token.sdef
      + (targetStats?.spdef ?? sourceStats?.spdef ?? 0) - (sourceStats?.spdef ?? 0)),
    ...(typeof input.token.spd === 'number'
      ? { spd: Math.max(1, input.token.spd + delta('spd')) }
      : {}),
    ...(target.types ? { defenderTypes: [...target.types] } : {}),
    ...(typeof target.weight === 'number' ? { weightClass: target.weight } : {}),
    ...(typeof target.base === 'number' ? { base: target.base } : {}),
    ...(typeof target.clearance === 'number' ? { clearance: target.clearance } : {}),
    movementCapabilities,
    movementTraits,
    ...(movementProfile ? { movementProfile } : {}),
    ...(projectedRuleCapabilities ? { ruleCapabilities: projectedRuleCapabilities } : {}),
    ...(target.capabilities ? {
      defenderCapabilities: {
        sky: movementCapabilities.sky ?? target.capabilities.sky ?? 0,
        levitate: movementCapabilities.levitate ?? target.capabilities.levitate ?? 0,
      },
    } : {}),
    creatureRules: input.token.creatureRules
      ? { ...input.token.creatureRules, formId: input.formId }
      : input.token.creatureRules,
  }
}

const tokenWithMovementCapabilities = (
  token: SpawnedPokemon,
  movementCapabilities: NonNullable<SpawnedPokemon['movementCapabilities']>,
): SpawnedPokemon => {
  const movementProfile = token.movementProfile ? {
    ...token.movementProfile,
    speeds: { ...token.movementProfile.speeds, ...movementCapabilities },
    modes: synchronizedMovementModes(
      token.movementProfile.modes,
      { ...token.movementProfile.speeds, ...movementCapabilities },
    ),
  } : undefined
  return {
    ...token,
    movementCapabilities,
    ...(movementProfile ? { movementProfile } : {}),
    ...(token.ruleCapabilities ? {
      ruleCapabilities: {
        ...token.ruleCapabilities,
        movementSpeeds: {
          ...token.ruleCapabilities.movementSpeeds,
          ...movementCapabilities,
        },
      },
    } : {}),
    defenderCapabilities: {
      ...(token.defenderCapabilities ?? {}),
      ...(typeof movementCapabilities.sky === 'number'
        ? { sky: movementCapabilities.sky } : {}),
      ...(typeof movementCapabilities.levitate === 'number'
        ? { levitate: movementCapabilities.levitate } : {}),
    },
  }
}

const tokenOccupiesMaterialTag = (
  context: Pick<AuthoritativeMoveRulesContext, 'map'>,
  token: SpawnedPokemon,
  tag: string,
): boolean => {
  const occupied = gridFootprintCells(token.position, token)
  return context.map.voxels.some(voxel => (
    (voxel.tags?.includes(tag) === true
      || getVoxelMaterialDefinition(voxel).tags?.includes(tag) === true)
    && occupied.some(cell => cell.x === voxel.x && cell.z === voxel.z
      && (cell.y === voxel.y || cell.y - 1 === voxel.y))
  ))
}

/** Remaining-catalog Base Stat, default-stage, form, and weather projections. */
export const aa085to100AdjustedToken = (input: {
  readonly token: SpawnedPokemon
  readonly sheet: CharacterSheet | null
  readonly effectiveAbilityIds: readonly string[]
  readonly contextMap: AuthoritativeMoveRulesContext['map']
  /** Exact currently equipped item locations that may back Symbiosis effects. */
  readonly validSymbiosisItemBindingIds?: ReadonlySet<string>
}): SpawnedPokemon => {
  const abilities = new Set(input.effectiveAbilityIds)
  let token = input.token
  if (abilities.has('RKS System')) {
    const memoryType = token.tokenItems.flatMap(item => {
      const normalized = item.trim().replace(/[-_]+/g, ' ')
      const match = normalized.match(/^(?:(Bug|Dark|Dragon|Electric|Fairy|Fighting|Fire|Flying|Ghost|Grass|Ground|Ice|Normal|Poison|Psychic|Rock|Steel|Water) Memory(?: Disc)?|Memory (Bug|Dark|Dragon|Electric|Fairy|Fighting|Fire|Flying|Ghost|Grass|Ground|Ice|Normal|Poison|Psychic|Rock|Steel|Water))$/i)
      const type = match?.[1] ?? match?.[2]
      return type
        ? [type[0]!.toUpperCase() + type.slice(1).toLowerCase()]
        : []
    })[0]
    if (memoryType) token = { ...token, defenderTypes: [memoryType] }
  }
  if (abilities.has('Pure Power')
    && !abilities.has('Huge Power')
    && !abilities.has('Huge Power / Pure Power')
    && input.sheet) {
    const baseAttack = resolveStats(input.sheet).find(stat => stat.key === 'atk')?.base ?? 0
    token = { ...token, atk: token.atk + Math.max(0, baseAttack) }
  }
  if (abilities.has('Sorcery')) {
    token = { ...token, satk: token.satk + 5 + Math.floor(Math.max(0, token.level) / 10) }
  }
  if (abilities.has('Unburden')) {
    const holdingItem = token.tokenItems.some(item => item.trim().length > 0)
    token = {
      ...token,
      combatStages: {
        ...token.combatStages,
        spd: clampCombatStage(token.combatStages.spd + (holdingItem ? 0 : 2)),
      },
    }
  }
  if (abilities.has('Wave Rider')) {
    const occupied = gridFootprintCells(token.position, token)
    const inWater = input.contextMap.voxels.some(voxel => (
      (voxel.tags?.includes('water') === true
        || getVoxelMaterialDefinition(voxel).tags?.includes('water') === true)
      && occupied.some(cell => cell.x === voxel.x && cell.z === voxel.z
        && (cell.y === voxel.y || cell.y - 1 === voxel.y))
    ))
    if (inWater) token = {
      ...token,
      combatStages: {
        ...token.combatStages,
        spd: clampCombatStage(token.combatStages.spd + projectedStageDelta(abilities, 4)),
      },
    }
  }
  const projectedWeather = createMoveAutomationWeatherResolver(input.contextMap, {
    subjectPlacementId: token.id,
    subjectOccupiedCells: gridFootprintCells(token.position, token),
    ...(abilities.has('Water Bubble') ? {
      virtualWeatherKind: 'rainy' as const,
      virtualWeatherSourceId: `ability.water-bubble:${token.id}`,
    } : {}),
  }).active()
  const sunny = projectedWeather.some(weather => weather.kind === 'sunny')
  if (abilities.has('Thermosensitive') && sunny) {
    token = {
      ...token,
      combatStages: {
        ...token.combatStages,
        atk: clampCombatStage(token.combatStages.atk + projectedStageDelta(abilities, 2)),
        satk: clampCombatStage(token.combatStages.satk + projectedStageDelta(abilities, 2)),
      },
    }
  }
  const hailing = projectedWeather.some(weather => weather.kind === 'hail')
  if (abilities.has('Thermosensitive') && hailing && token.movementCapabilities) {
    token = tokenWithMovementCapabilities(token, Object.fromEntries(
      Object.entries(token.movementCapabilities).map(([kind, value]) => [
        kind,
        typeof value === 'number'
          ? value <= 0 ? 0 : Math.max(1, Math.floor(value / 2))
          : value,
      ]),
    ))
  }
  const actorEffects = input.contextMap.encounterState?.effects ?? []
  const sharedItems = actorEffects.flatMap((effect) => {
    const bindingId = effect.tags.find(tag => tag.startsWith('aa094-symbiosis-binding:'))
      ?.slice('aa094-symbiosis-binding:'.length)
    return effect.tags.includes('aa094-symbiosis-shared-item')
      && effect.affected.placementIds.includes(token.id)
      && effect.suppression.sources.length === 0
      && (effect.duration.remaining === null || effect.duration.remaining > 0)
      && bindingId !== undefined
      && input.validSymbiosisItemBindingIds?.has(bindingId) === true
      ? effect.tags.flatMap(tag => tag.startsWith('aa094-symbiosis-item:')
          ? [tag.slice('aa094-symbiosis-item:'.length)] : [])
      : []
  }).filter(itemId => itemId.length > 0)
  if (sharedItems.length > 0) {
    token = { ...token, tokenItems: [...new Set([...token.tokenItems, ...sharedItems])] }
  }
  const hasEffectTag = (tag: string): boolean => actorEffects.some(effect => (
    effect.tags.includes(tag)
    && effect.affected.placementIds.includes(token.id)
    && effect.suppression.sources.length === 0
    && (effect.duration.remaining === null || effect.duration.remaining > 0)
  ))
  if (hasEffectTag('aa089-shadow-tag')) {
    token = { ...token, conditions: [...new Set([...token.conditions, 'Slowed', 'Trapped'])] }
  }
  if (hasEffectTag('aa086-regal-challenge-deference')) {
    token = { ...token, conditions: [...new Set([...token.conditions, 'Stuck'])] }
  }
  // Run Away's canonical trap immunity also applies to projected temporary
  // conditions such as Shadow Tag; resolve it after all trap providers.
  if (abilities.has('Run Away')
    && normalizeConditionNames(token.conditions).includes('Trapped')) {
    token = {
      ...token,
      conditions: token.conditions.filter(condition => (
        normalizeConditionNames([condition])[0] !== 'Trapped'
      )),
    }
  }
  if (token.movementCapabilities && hasEffectTag('aa088-shackle-half-movement')) {
    token = tokenWithMovementCapabilities(token, Object.fromEntries(
      Object.entries(token.movementCapabilities).map(([kind, value]) => [
        kind,
        typeof value === 'number'
          ? value <= 0 ? 0 : Math.max(1, Math.floor(value / 2))
          : value,
      ]),
    ))
  }
  if (hasEffectTag('aa091-spray-down-grounded')) {
    token = {
      ...tokenWithMovementCapabilities(token, {
        ...(token.movementCapabilities ?? {}),
        sky: 0,
        levitate: 0,
      }),
      conditions: [...new Set([
        ...token.conditions,
        'Groundsource Immunity Suppressed',
      ])],
    }
  }
  const schoolingForm = abilities.has('Schooling') && actorEffects.some(effect => (
    effect.tags.includes('aa088-schooling')
    && effect.affected.placementIds.includes(token.id)
    && effect.suppression.sources.length === 0
  ))
  const schoolingMaximum = Math.max(1, token.fullMaxHp ?? token.maxHp)
  const schoolingTemporaryHp = input.contextMap.temporaryHitPoints?.byPlacementId[token.id] ?? 0
  if (schoolingForm && (token.currentHp * 2 >= schoolingMaximum || schoolingTemporaryHp > 0)) {
    token = formProjectedToken({
      token,
      sheet: input.sheet,
      targetSpecies: 'Wishiwashi Schooling',
      formId: 'wishiwashi-school-forme',
    })
  }
  else if (abilities.has('Schooling')
    && input.sheet?.species.trim().toLowerCase().includes('wishiwashi')) {
    token = formProjectedToken({
      token,
      sheet: input.sheet,
      targetSpecies: 'Wishiwashi Solo',
      formId: 'wishiwashi-solo-forme',
    })
  }
  const shieldsDownCore = abilities.has('Shields Down') && (
    token.currentHp * 2 <= Math.max(1, token.fullMaxHp ?? token.maxHp)
    || actorEffects.some(effect => (
      effect.tags.includes('aa089-shields-down-core')
      && effect.affected.placementIds.includes(token.id)
      && effect.suppression.sources.length === 0
      && (effect.duration.remaining === null || effect.duration.remaining > 0)
    ))
  )
  if (shieldsDownCore) token = formProjectedToken({
    token,
    sheet: input.sheet,
    targetSpecies: 'Minior Core',
    formId: 'minior-core',
  })
  else if (abilities.has('Shields Down')
    && input.sheet?.species.trim().toLowerCase().includes('minior')) token = formProjectedToken({
    token,
    sheet: input.sheet,
    targetSpecies: 'Minior Meteor',
    formId: 'minior-meteor',
  })
  const zenMode = actorEffects.some(effect => (
    effect.tags.includes('aa100-zen-mode')
    && effect.affected.placementIds.includes(token.id)
    && effect.suppression.sources.length === 0
  ))
  const zenSnowed = actorEffects.some(effect => (
    effect.tags.includes('aa100-zen-snowed')
    && effect.affected.placementIds.includes(token.id)
    && effect.suppression.sources.length === 0
  ))
  if (zenMode) token = formProjectedToken({
    token,
    sheet: input.sheet,
    targetSpecies: 'Darmanitan Zen Mode',
    formId: 'darmanitan-zen-mode',
  })
  else if (zenSnowed) token = formProjectedToken({
    token,
    sheet: input.sheet,
    targetSpecies: 'Darmanitan Galar Zen Mode',
    formId: 'galarian-darmanitan-zen-mode',
  })
  else if (input.sheet?.species.trim().toLowerCase().includes('darmanitan')
    && (abilities.has('Zen Mode') || abilities.has('Zen Snowed'))) token = formProjectedToken({
    token,
    sheet: input.sheet,
    targetSpecies: abilities.has('Zen Snowed')
      ? 'Darmanitan Galar Standard Mode'
      : 'Darmanitan',
    formId: abilities.has('Zen Snowed')
      ? 'galarian-darmanitan-standard-mode'
      : 'darmanitan-standard-mode',
  })
  const swordStance = abilities.has('Stance Change')
    && input.sheet?.species.trim().toLowerCase().includes('aegislash') === true
    && actorEffects.some(effect => (
    effect.tags.includes('aa092-stance-change-sword')
    && effect.affected.placementIds.includes(token.id)
    && effect.suppression.sources.length === 0
  ))
  if (swordStance) token = {
    ...token,
    atk: token.def,
    def: token.atk,
    satk: token.sdef,
    sdef: token.satk,
  }
  const entryEffect = actorEffects.find(effect => (
    effect.tags.includes('encounter-entry')
    && effect.affected.placementIds.includes(token.id)
    && effect.suppression.sources.length === 0
  ))
  const currentRound = input.contextMap.initiative?.round
    ?? input.contextMap.encounterState?.history.currentRound ?? 1
  const slowStart = abilities.has('Slow Start') && (
    (entryEffect
      ? currentRound - entryEffect.createdRound < 3
      : currentRound <= 3)
    || actorEffects.some(effect => (
      effect.tags.includes('aa089-slow-start')
      && effect.affected.placementIds.includes(token.id)
      && effect.suppression.sources.length === 0
      && (effect.duration.remaining === null || effect.duration.remaining > 0)
    ))
  )
  if (slowStart) token = {
    ...token,
    atk: Math.max(1, Math.floor(token.atk / 2)),
    ...(typeof token.spd === 'number' ? { spd: Math.max(1, Math.floor(token.spd / 2)) } : {}),
  }
  return token
}

/** Apply a move-declaration form before same-resolution stat consultation. */
export const aa085to100ActorForMove = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: Pick<MoveAutomationScript, 'damaging'>
  readonly actor: SpawnedPokemon
}): SpawnedPokemon => {
  const aegislash = input.context.actor.sheet.kind === 'pokemon'
    && (input.context.actor.sheet.sheet as CharacterSheet).species
      .trim().toLowerCase().includes('aegislash')
  if (!input.script.damaging || !aegislash
    || !input.context.queries.abilities.has(input.actor.id, 'Stance Change')) return input.actor
  const alreadySword = input.context.map.encounterState?.effects.some(effect => (
    effect.tags.includes('aa092-stance-change-sword')
    && effect.affected.placementIds.includes(input.actor.id)
    && effect.suppression.sources.length === 0
  )) === true
  return alreadySword ? input.actor : {
    ...input.actor,
    atk: input.actor.def,
    def: input.actor.atk,
    satk: input.actor.sdef,
    sdef: input.actor.satk,
  }
}

export const AA085_RADIANT_BEAM_TARGET_BRANCH_ID = 'ability.radiant-beam.line-4' as const
export const AA090_SONIC_COURTSHIP_TARGET_BRANCH_ID = 'ability.sonic-courtship.burst-3' as const
export const AA091_SPIKE_SHOT_TARGET_BRANCH_ID = 'ability.spike-shot.range-8' as const
export const AA096_TRINITY_TARGET_BRANCH_ID = 'ability.trinity.melee-three-targets' as const

const abilityTargetBranchRule = (
  targetBranchId: string | null | undefined,
): ValidatedMoveSpecTargetingRule | null => {
  if (targetBranchId === AA096_TRINITY_TARGET_BRANCH_ID) return {
    kind: 'multi-target', minTargets: 1, maxTargets: 3,
    selector: { kind: 'selected-targets' },
    predicate: { relationship: 'any', willingness: 'any', excludeActor: true },
  }
  if (targetBranchId === AA085_RADIANT_BEAM_TARGET_BRANCH_ID
    || targetBranchId === AA090_SONIC_COURTSHIP_TARGET_BRANCH_ID) return {
    kind: 'area', minTargets: 0, maxTargets: 32,
    selector: { kind: 'area-targets' },
    predicate: { relationship: 'any', willingness: 'any', excludeActor: true },
  }
  if (targetBranchId === AA091_SPIKE_SHOT_TARGET_BRANCH_ID) return {
    kind: 'single-target', minTargets: 1, maxTargets: 1,
    selector: { kind: 'selected-targets' },
    predicate: { relationship: 'any', willingness: 'any', excludeActor: true },
  }
  return null
}

/** Used by continuation replay before its authoritative context is rebuilt. */
export const aa085to100TargetingRuleForBranchId = (
  targetBranchId: string | null | undefined,
): ValidatedMoveSpecTargetingRule | null => abilityTargetBranchRule(targetBranchId)

const withAbilityTargetBranch = (input: {
  readonly script: MoveAutomationScript
  readonly id: string
  readonly label: string
  readonly range: string
  readonly targetMode: 'one-target' | 'multi-target'
  readonly targetCount: number | null
}): MoveAutomationScript => {
  const branches = moveAutomationTargetBranches(input.script)
  if (branches.some(branch => branch.id === input.id)) return input.script
  return {
    ...input.script,
    targetBranches: [
      ...branches,
      {
        id: input.id,
        label: input.label,
        targetMode: input.targetMode,
        targetCount: input.targetCount,
        range: input.range,
        areaTemplates: parseMoveAutomationAreaTemplates(input.range),
      },
    ],
  }
}

/** Authoritative declaration-shape choices for reviewed static range abilities. */
export const aa085to100MovePresentationScript = (input: {
  readonly context: Pick<AuthoritativeMoveRulesContext, 'actor' | 'queries'>
  readonly script: MoveAutomationScript
}): MoveAutomationScript => {
  const actorId = input.context.actor.placement.id
  const name = input.script.moveName.trim().toLowerCase()
  let script = input.script
  if (input.context.queries.abilities.has(actorId, 'Wily')
    && script.damageClass?.trim().toLowerCase() === 'status'
    && script.targetCount !== null && script.targetCount > 0) {
    script = {
      ...script,
      targetMode: 'multi-target', targetCount: script.targetCount + 1,
      automationNotes: [...new Set([...script.automationNotes, 'Wily: +1 target'])],
    }
  }
  if (input.context.queries.abilities.has(actorId, 'Whirlwind Kicks')
    && ['rapid spin', 'triple kick'].includes(name)) {
    const range = 'Burst 1'
    script = {
      ...script,
      range,
      targetMode: 'multi-target',
      targetCount: null,
      areaTemplates: parseMoveAutomationAreaTemplates(range),
      automationNotes: [...new Set([...script.automationNotes, `Ability range override: ${range}`])],
    }
  }
  if (input.context.queries.abilities.has(actorId, 'Sonic Courtship') && name === 'attract') {
    script = withAbilityTargetBranch({
      script,
      id: AA090_SONIC_COURTSHIP_TARGET_BRANCH_ID,
      label: 'Sonic Courtship — Burst 3, Sonic, Friendly',
      range: 'Burst 3, Sonic, Friendly',
      targetMode: 'multi-target',
      targetCount: null,
    })
  }
  if (input.context.queries.abilities.has(actorId, 'Trinity') && name === 'tri attack') {
    script = withAbilityTargetBranch({
      script,
      id: AA096_TRINITY_TARGET_BRANCH_ID,
      label: 'Trinity — Melee, 3 Targets',
      range: 'Melee, 3 Targets',
      targetMode: 'multi-target',
      targetCount: 3,
    })
  }
  if (input.context.queries.abilities.has(actorId, 'Radiant Beam')
    && script.damaging && script.type.trim().toLowerCase() === 'grass') {
    script = withAbilityTargetBranch({
      script,
      id: AA085_RADIANT_BEAM_TARGET_BRANCH_ID,
      label: 'Radiant Beam — Line 4',
      range: 'Line 4',
      targetMode: 'multi-target',
      targetCount: null,
    })
  }
  if (input.context.queries.abilities.has(actorId, 'Spike Shot')
    && /^melee\s*,?\s*1[ -]?target$/i.test(script.range.trim())) {
    script = withAbilityTargetBranch({
      script,
      id: AA091_SPIKE_SHOT_TARGET_BRANCH_ID,
      label: 'Spike Shot — 8, 1 Target',
      range: '8, 1 Target',
      targetMode: 'one-target',
      targetCount: 1,
    })
  }
  return script
}

/**
 * Reviewed Ability-owned targeting authority for canonical MoveSpecs whose
 * declaration shape is changed without replacing their reviewed effects.
 */
export const aa085to100MoveTargetingOverride = (input: {
  readonly context: Pick<AuthoritativeMoveRulesContext, 'actor' | 'queries' | 'intent'>
  readonly script: MoveAutomationScript
}): ValidatedMoveSpecTargetingRule | null => {
  const actorId = input.context.actor.placement.id
  const name = input.script.moveName.trim().toLowerCase()
  const branchId = input.context.intent.targetBranchId
  const branchRule = abilityTargetBranchRule(branchId)
  const branchAuthorized = branchId === AA096_TRINITY_TARGET_BRANCH_ID
    ? input.context.queries.abilities.has(actorId, 'Trinity')
      && name === 'tri attack'
      && input.script.targetMode === 'multi-target'
      && input.script.targetCount === 3
    : branchId === AA090_SONIC_COURTSHIP_TARGET_BRANCH_ID
      ? input.context.queries.abilities.has(actorId, 'Sonic Courtship')
        && name === 'attract'
        && input.script.range === 'Burst 3, Sonic, Friendly'
      : branchId === AA085_RADIANT_BEAM_TARGET_BRANCH_ID
        ? input.context.queries.abilities.has(actorId, 'Radiant Beam')
          && input.script.damaging
          && input.script.type.trim().toLowerCase() === 'grass'
          && input.script.range === 'Line 4'
        : branchId === AA091_SPIKE_SHOT_TARGET_BRANCH_ID
          ? input.context.queries.abilities.has(actorId, 'Spike Shot')
            && input.script.range === '8, 1 Target'
          : false
  if (branchRule) return branchAuthorized ? branchRule : null
  if (input.context.queries.abilities.has(actorId, 'Wily')
    && input.script.damageClass?.trim().toLowerCase() === 'status'
    && input.script.targetMode === 'multi-target'
    && typeof input.script.targetCount === 'number'
    && input.script.targetCount > 1
    && input.script.automationNotes.includes('Wily: +1 target')) {
    return {
      kind: 'multi-target', minTargets: 1, maxTargets: input.script.targetCount,
      selector: { kind: 'selected-targets' },
      predicate: { relationship: 'any', willingness: 'any', excludeActor: true },
    }
  }
  const whirlwindKicks = input.context.queries.abilities.has(actorId, 'Whirlwind Kicks')
    && ['rapid spin', 'triple kick'].includes(name)
    && input.script.range === 'Burst 1'
  if (whirlwindKicks && (input.script.areaTemplates?.length ?? 0) > 0) {
    return {
      kind: 'area', minTargets: 0, maxTargets: 32,
      selector: { kind: 'area-targets' },
      predicate: { relationship: 'any', willingness: 'any', excludeActor: true },
    }
  }
  return null
}

/** Triage makes Healing-keyword Moves resolve on the Priority lane. */
export const aa085to100MovePriorityActive = (input: {
  readonly context: Pick<AuthoritativeMoveRulesContext, 'actor' | 'queries'>
  readonly script: Pick<MoveAutomationScript, 'keywords'>
}): boolean => input.context.queries.abilities.has(input.context.actor.placement.id, 'Triage')
  && input.script.keywords.some(keyword => keyword.trim().toLowerCase() === 'healing')

const STRONG_JAW_MOVES = new Set([
  'bite', 'bug bite', 'crunch', 'fire fang', 'ice fang', 'thunder fang',
  'poison fang', 'hyper fang',
])
const RECKLESS_MOVES = new Set([
  'jump kick', 'hi jump kick', 'high jump kick', 'close combat', 'draco meteor', 'hammer arm',
  'leaf storm', 'outrage', 'overheat', 'petal dance', 'psycho boost',
  'superpower', 'thrash', 'v-create',
])

/** Exact post-bounds DB providers for remaining canonical abilities. */
export const aa085to100DamageBaseBonus = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: Pick<MoveAutomationScript, 'moveName' | 'damageBase' | 'range' | 'keywords'>
  readonly baseDamageBase: number
}): number => {
  const actorId = input.context.actor.placement.id
  const text = `${input.script.range} ${input.script.keywords.join(' ')}`.toLowerCase()
  let bonus = 0
  if (input.context.queries.abilities.has(actorId, 'Punk Rock') && /\bsonic\b/.test(text)) bonus += 2
  if (input.context.queries.abilities.has(actorId, 'Reckless')
    // Take Down's immutable registered handler already binds and traces this
    // exact DB +3; the generic provider must not apply the same Ability twice.
    && input.script.moveName.trim().toLowerCase() !== 'take down'
    && (/\b(exhaust|recoil|reckless)\b/.test(text)
      || RECKLESS_MOVES.has(input.script.moveName.trim().toLowerCase()))) bonus += 3
  if (input.context.queries.abilities.has(actorId, 'Strong Jaw')
    && STRONG_JAW_MOVES.has(input.script.moveName.trim().toLowerCase())) bonus += 2
  if (input.context.queries.abilities.has(actorId, 'Technician')
    && (input.baseDamageBase <= 6 || /\b(double strike|five strike|fivestrike)\b/.test(text))) bonus += 2
  if (input.context.queries.abilities.has(actorId, 'Tough Claws') && /\bmelee\b/.test(text)) bonus += 2
  return bonus
}

const modifier = (input: {
  readonly operation: MoveDamageEffectOperation
  readonly recipientId: string
  readonly abilityInstanceId: string
  readonly group: string
  readonly reasonCode: string
  readonly value: number
  readonly stage?: MoveDamageModifier['stage']
  readonly priority?: number
}): MoveDamageModifier => ({
  id: `ability.remaining.${input.group}.${shortHash(
    input.operation.id, input.recipientId, input.abilityInstanceId,
  )}`,
  stage: input.stage ?? 'pre-type-modifiers',
  priority: input.priority ?? 48,
  source: { kind: 'ability', id: input.abilityInstanceId },
  stackingGroup: `remaining-${input.group}`,
  reasonCode: input.reasonCode,
  operation: input.value >= 0 ? 'add' : 'subtract',
  value: Math.abs(input.value),
})

const randomBonus = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveDamageEffectOperation
  readonly recipientId: string
  readonly canonicalId: string
  readonly count: number
  readonly sides: number
  readonly flat?: number
}): number => input.context.random.roll({
  rollId: `ability.${input.canonicalId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${shortHash(
    input.operation.id, input.recipientId,
  )}`,
  parentEffectId: input.operation.id,
  formula: { kind: 'dice', count: input.count, sides: input.sides, modifier: input.flat ?? 0 },
  reason: `${input.canonicalId} bonus damage`,
}).finalValue

export const aa085to100StraightLineMovementToward = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly actor: SpawnedPokemon
  readonly recipient: SpawnedPokemon
}): number => {
  const currentTurn = input.context.map.encounterState?.history.currentTurn
  const evidence = (input.context.map.encounterState?.effects ?? []).filter(effect => (
    effect.tags.includes('aa085to100-movement-evidence')
    && effect.tags.includes('movement-mode:voluntary')
    && effect.affected.placementIds.includes(input.actor.id)
    && effect.createdRound === (currentTurn?.round ?? effect.createdRound)
    && effect.createdTurn === (currentTurn?.turn ?? effect.createdTurn)
    && effect.affected.cells.length >= 2
    && effect.suppression.sources.length === 0
    && (effect.duration.remaining === null || effect.duration.remaining > 0)
  ))
  const sameCell = (left: GridAnchor, right: GridAnchor): boolean => (
    left.x === right.x && left.y === right.y && left.z === right.z
  )
  // Build only the contiguous suffix that ends at the actor's committed
  // position. A forced move or Teleport creates a positional gap and therefore
  // cannot contribute distance or connect otherwise voluntary segments.
  const segments: (readonly GridAnchor[])[] = []
  let expectedEndpoint: GridAnchor = input.actor.position
  for (const effect of [...evidence].reverse()) {
    const segment = effect.affected.cells
    const endpoint = segment.at(-1)
    if (!endpoint || !sameCell(endpoint, expectedEndpoint)) break
    segments.unshift(segment)
    expectedEndpoint = segment[0]!
  }
  const path = segments.flatMap((segment, segmentIndex) => (
    segmentIndex === 0 ? segment : segment.slice(1)
  ))
  const origin = path[0]
  const endpoint = path.at(-1)
  if (!origin || !endpoint || !sameCell(endpoint, input.actor.position)) return 0
  const vectors = path.slice(1).map((cell, index) => ({
    x: Math.sign(cell.x - path[index]!.x),
    y: Math.sign(cell.y - path[index]!.y),
    z: Math.sign(cell.z - path[index]!.z),
  }))
  const direction = vectors[0]
  if (!direction || vectors.some(vector => (
    vector.x !== direction.x || vector.y !== direction.y || vector.z !== direction.z
  ))) return 0
  const originDistance = ptuGridDistanceBetweenFootprints(
    { ...input.actor, position: origin }, input.recipient,
  )
  const endpointDistance = ptuGridDistanceBetweenFootprints(input.actor, input.recipient)
  if (endpointDistance >= originDistance) return 0
  return path.slice(1).reduce((total, cell, index) => total + ptuGridVectorDistance({
    x: cell.x - path[index]!.x,
    y: cell.y - path[index]!.y,
    z: cell.z - path[index]!.z,
  }), 0)
}

const lastChanceType = (canonicalId: string): string | null => ({
  'Pure Blooded': 'dragon',
  Swarm: 'bug',
  Torrent: 'water',
  Unbreakable: 'steel',
  Venom: 'poison',
} as Readonly<Record<string, string>>)[canonicalId] ?? null

/** Damage Roll bonuses/reductions that require exact actor/recipient state. */
export const aa085to100MoveDamageModifiers = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveDamageEffectOperation
  readonly script: MoveAutomationScript
  readonly actor: SpawnedPokemon
  readonly recipient: SpawnedPokemon
  readonly moveType: string
  readonly damageClass: 'physical' | 'special'
  readonly effectivenessMultiplier: number
  readonly critical: boolean
}): readonly MoveDamageModifier[] => {
  const result: MoveDamageModifier[] = []
  const actorId = input.actor.id
  const recipientId = input.recipient.id
  const add = (canonicalId: string, group: string, reasonCode: string, value: number): void => {
    const instanceId = ability(input.context, actorId, canonicalId)
    if (instanceId && value !== 0) result.push(modifier({
      operation: input.operation, recipientId, abilityInstanceId: instanceId,
      group, reasonCode, value,
    }))
  }
  const reduce = (canonicalId: string, group: string, reasonCode: string, value: number): void => {
    const instanceId = ability(input.context, recipientId, canonicalId)
    if (instanceId && value > 0) result.push(modifier({
      operation: input.operation, recipientId, abilityInstanceId: instanceId,
      group, reasonCode, value: -value, stage: 'post-damage-modifiers', priority: 52,
    }))
  }

  for (const canonicalId of ['Pure Blooded', 'Swarm', 'Torrent', 'Unbreakable', 'Venom']) {
    const type = lastChanceType(canonicalId)
    const maximum = Math.max(1, input.actor.fullMaxHp ?? input.actor.maxHp)
    if (type === input.moveType.toLowerCase() && input.actor.currentHp * 3 <= maximum) {
      add(canonicalId, `last-chance-${type}`, `ability.${canonicalId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.last-chance`, 5)
    }
  }

  if (input.actor.gender && input.recipient.gender
    && input.actor.gender.trim().toLowerCase() !== 'genderless'
    && input.recipient.gender.trim().toLowerCase() !== 'genderless'
    && input.actor.gender.trim().toLowerCase() === input.recipient.gender.trim().toLowerCase()) {
    add('Rivalry', 'rivalry', 'ability.rivalry.same-gender-damage', 5)
  }
  const straightLineDistance = /\bmelee\b/i.test(input.script.range)
    ? aa085to100StraightLineMovementToward(input) : 0
  if (input.damageClass === 'physical' && straightLineDistance >= 4
    && input.context.queries.abilities.has(actorId, 'Rock Head')) {
    add('Rock Head', 'rock-head-charge', 'ability.rock-head.straight-line-charge', randomBonus({
      ...input, recipientId, canonicalId: 'Rock Head', count: 2, sides: 6,
    }))
  }
  if (straightLineDistance > 0) add(
    'Run Up', 'run-up', 'ability.run-up.straight-line-distance', straightLineDistance,
  )
  if (input.critical && input.context.queries.abilities.has(actorId, 'Sniper')) {
    add('Sniper', 'sniper', 'ability.sniper.critical-damage', randomBonus({
      ...input, recipientId, canonicalId: 'Sniper', count: 3, sides: 10,
    }))
  }
  const entry = input.context.map.encounterState?.effects.find(effect => (
    effect.tags.includes('encounter-entry')
    && effect.affected.placementIds.includes(recipientId)
    && effect.suppression.sources.length === 0
  ))
  const actorLastTurn = input.context.map.encounterState?.effects.find(effect => (
    effect.tags.includes('aa091-stakeout-last-turn')
    && effect.affected.placementIds.includes(actorId)
    && effect.suppression.sources.length === 0
    && (effect.duration.remaining === null || effect.duration.remaining > 0)
  ))
  const enteredSinceLastTurn = entry !== undefined && (
    actorLastTurn === undefined
    || entry.createdRound > actorLastTurn.createdRound
    || (entry.createdRound === actorLastTurn.createdRound
      && entry.createdTurn > actorLastTurn.createdTurn)
  )
  if (enteredSinceLastTurn) add('Stakeout', 'stakeout', 'ability.stakeout.recent-entry-damage', randomBonus({
    ...input, recipientId, canonicalId: 'Stakeout', count: 2, sides: 6, flat: 4,
  }))
  const auraProvider = input.context.queries.tokens.all().find(token => (
    (token.id === actorId
      || input.context.queries.relationships.resolve(token.id, actorId).relationship === 'ally')
    && input.context.queries.abilities.has(token.id, 'Type Aura')
    && token.defenderTypes[0]?.toLowerCase() === input.moveType.toLowerCase()
    && ptuGridDistanceBetweenFootprints(token, input.actor) <= 3
  ))
  const auraInstance = auraProvider
    ? ability(input.context, auraProvider.id, 'Type Aura')
    : null
  if (auraInstance) result.push(modifier({
    operation: input.operation, recipientId, abilityInstanceId: auraInstance,
    group: 'type-aura', reasonCode: 'ability.type-aura.damage', value: 5,
  }))
  const effectiveAttack = input.context.queries.stats.resolve(actorId, {
    stat: 'attack', combatStagePolicy: 'honor', stageModifierPolicy: 'honor',
  })?.value ?? input.actor.atk
  const effectiveSpecialAttack = input.context.queries.stats.resolve(actorId, {
    stat: 'special-attack', combatStagePolicy: 'honor', stageModifierPolicy: 'honor',
  })?.value ?? input.actor.satk
  if (input.context.queries.abilities.has(actorId, 'Twisted Power')) {
    add(
      'Twisted Power', 'twisted-power', 'ability.twisted-power.cross-stat-damage',
      Math.floor((input.damageClass === 'physical' ? effectiveSpecialAttack : effectiveAttack) / 2),
    )
  }
  if (input.context.queries.abilities.has(actorId, 'Weird Power')
    && !input.context.queries.abilities.has(actorId, 'Mixed Power')) {
    const value = input.damageClass === 'physical'
      ? effectiveSpecialAttack > effectiveAttack ? effectiveSpecialAttack : 0
      : effectiveAttack > effectiveSpecialAttack ? effectiveAttack : 0
    add('Weird Power', 'weird-power', 'ability.weird-power.higher-offense-damage', value)
  }
  if (normalizeConditionNames(input.actor.conditions).includes('Rage')) {
    add('White Flame', 'white-flame', 'ability.white-flame.enraged-damage', 5)
  }
  const curledUp = ['rollout', 'ice ball'].includes(input.script.moveName.trim().toLowerCase())
    ? input.context.map.encounterState?.effects.find(effect => (
        effect.tags.includes('curled-up')
        && effect.affected.placementIds.includes(actorId)
        && effect.suppression.sources.length === 0
        && (effect.duration.remaining === null || effect.duration.remaining > 0)
      ))
    : null
  if (curledUp) result.push(modifier({
    operation: input.operation, recipientId,
    abilityInstanceId: curledUp.source.operationId,
    group: 'curled-up', reasonCode: 'move.defense-curl.curled-up-damage', value: 10,
  }))
  if (activeEffect(input.context, actorId, 'aa095-tingle-damage-penalty')) {
    const tingleInstance = input.context.map.encounterState?.effects.find(effect => (
      effect.tags.includes('aa095-tingle-damage-penalty')
      && effect.affected.placementIds.includes(actorId)
    ))?.source.operationId ?? 'ability.tingle'
    result.push(modifier({
      operation: input.operation, recipientId,
      abilityInstanceId: tingleInstance, group: 'tingle-penalty',
      reasonCode: 'ability.tingle.damage-penalty', value: -5,
    }))
  }
  if (activeEffect(input.context, actorId, 'aa086-regal-challenge-defiance')) {
    const regalInstance = input.context.map.encounterState?.effects.find(effect => (
      effect.tags.includes('aa086-regal-challenge-defiance')
      && effect.affected.placementIds.includes(actorId)
    ))?.source.operationId ?? 'ability.regal-challenge'
    result.push(modifier({
      operation: input.operation, recipientId,
      abilityInstanceId: regalInstance, group: 'regal-challenge-defiance',
      reasonCode: 'ability.regal-challenge.defiance-damage', value: 10,
    }))
  }
  // Sandstorm's existing authoritative weather pipeline owns the canonical
  // Sand Force +5. This provider covers sandy terrain only, without stacking
  // a second copy when both environment clauses are active.
  if (!hasWeather(input.context, 'sandstorm')
    && tokenOccupiesMaterialTag(input.context, input.actor, 'sand')
    && ['ground', 'rock', 'steel'].includes(input.moveType.toLowerCase())) {
    add('Sand Force', 'sand-force', 'ability.sand-force.damage', 5)
  }
  const actorInitiative = input.context.queries.placements.get(actorId)?.initiative ?? undefined
  const recipientInitiative = input.context.queries.placements.get(recipientId)?.initiative ?? undefined
  if (actorInitiative !== undefined && recipientInitiative !== undefined
    && actorInitiative > recipientInitiative
    && !input.context.map.encounterState?.history.actedThisRoundPlacementIds.includes(recipientId)) {
    add('Vanguard', 'vanguard', 'ability.vanguard.unacted-lower-initiative-damage', 5)
  }

  if (input.effectivenessMultiplier > 1) reduce(
    'Solid Rock', 'solid-rock', 'ability.solid-rock.super-effective-reduction', 5,
  )
  if (hasWeather(input.context, 'sunny', recipientId)) reduce(
    'Sol Veil', 'sol-veil', 'ability.sol-veil.sunny-damage-reduction', 5,
  )
  const slowStartEntry = input.context.map.encounterState?.effects.find(effect => (
    effect.tags.includes('encounter-entry')
    && effect.affected.placementIds.includes(recipientId)
    && effect.suppression.sources.length === 0
  ))
  const slowStartRound = input.context.map.initiative?.round
    ?? input.context.map.encounterState?.history.currentRound ?? 1
  if (activeEffect(input.context, recipientId, 'aa089-slow-start')
    || (input.context.queries.abilities.has(recipientId, 'Slow Start')
      && (slowStartEntry
        ? slowStartRound - slowStartEntry.createdRound < 3
        : slowStartRound <= 3))) reduce(
    'Slow Start', 'slow-start', 'ability.slow-start.damage-reduction', 10,
  )
  if (activeEffect(input.context, recipientId, 'aa087-root-down-dr')) reduce(
    'Root Down', 'root-down', 'ability.root-down.damage-reduction', 5,
  )
  if (activeEffect(input.context, recipientId, 'aa093-suction-cups-dr')) reduce(
    'Suction Cups', 'suction-cups', 'ability.suction-cups.damage-reduction', 5,
  )
  const strategistEffect = input.context.map.encounterState?.effects.find(effect => (
    effect.tags.includes('aa096-type-strategist')
    && effect.affected.placementIds.includes(recipientId)
    && effect.suppression.sources.length === 0
  ))
  if (strategistEffect) {
    const maximum = Math.max(1, input.recipient.fullMaxHp ?? input.recipient.maxHp)
    reduce(
      'Type Strategist', 'type-strategist', 'ability.type-strategist.damage-reduction',
      input.recipient.currentHp * 3 < maximum ? 10 : 5,
    )
  }
  return Object.freeze(result)
}

const recomputeWithoutGhostImmunity = (
  moveType: string,
  defenderTypes: readonly string[],
): number => computeMultiplier(moveType, defenderTypes.filter(type => type.toLowerCase() !== 'ghost'))

/** Final type-provider ordering for Scrappy, lens/bypass abilities, and Wonder Guard. */
export const aa085to100DamageTypeOverlay = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation?: MoveDamageEffectOperation
  readonly recipientId: string
  readonly resolved: MoveDamageTypeResolution
}): MoveDamageTypeResolution => {
  const actorId = input.context.actor.placement.id
  const target = input.context.queries.tokens.get(input.recipientId)
  if (!target) return input.resolved
  let finalMultiplier = input.resolved.finalMultiplier
  let immunitySource = input.resolved.immunitySource
  const passiveSources = [...input.resolved.passiveSources]
  const moveType = input.resolved.moveType.toLowerCase()

  if (finalMultiplier === 0
    && ['normal', 'fighting'].includes(moveType)
    && target.defenderTypes.some(type => type.toLowerCase() === 'ghost')
    && input.context.queries.abilities.has(actorId, 'Scrappy')) {
    finalMultiplier = recomputeWithoutGhostImmunity(input.resolved.moveType, target.defenderTypes)
    immunitySource = null
    passiveSources.push('Scrappy')
  }
  if (finalMultiplier > 0 && finalMultiplier < 1
    && input.context.queries.abilities.has(actorId, 'Tinted Lens')) {
    finalMultiplier = Math.min(1, finalMultiplier * 2)
    passiveSources.push('Tinted Lens')
  }
  const targetIsEnemy = input.context.queries.relationships.resolve(
    actorId,
    input.recipientId,
  ).relationship === 'enemy'
  const typedBypass = targetIsEnemy && ((moveType === 'electric'
    && input.context.queries.abilities.has(actorId, 'Teravolt'))
    || (moveType === 'fire'
      && input.context.queries.abilities.has(actorId, 'Turboblaze')))
  if (typedBypass) {
    const typeChartMultiplier = computeMultiplier(input.resolved.moveType, target.defenderTypes)
    const defensiveImmunity = finalMultiplier === 0 && typeChartMultiplier > 0
    if (defensiveImmunity) {
      finalMultiplier = typeChartMultiplier
      immunitySource = null
    }
    passiveSources.push(moveType === 'electric' ? 'Teravolt' : 'Turboblaze')
  }
  const rksNormalDefense = input.operation?.payload.preTypeDamageModifiers?.some(modifier => (
    modifier.reasonCode === `ability.rks-system.normal-defense:${input.recipientId}`
  )) === true
  if (rksNormalDefense) {
    const alreadyNormal = target.defenderTypes.some(type => type.trim().toLowerCase() === 'normal')
    const ordinaryMultiplier = computeMultiplier(input.resolved.moveType, target.defenderTypes)
    finalMultiplier = alreadyNormal
      ? resistMultiplierOneStepFurther(ordinaryMultiplier)
      : computeMultiplier(input.resolved.moveType, ['Normal'])
    immunitySource = finalMultiplier === 0 ? 'RKS System' : null
    passiveSources.push('RKS System')
  }
  const wobbleResistance = input.operation?.payload.preTypeDamageModifiers?.some(modifier => (
    modifier.reasonCode === `ability.wobble.resistance:${input.recipientId}`
  )) === true
  if (wobbleResistance && finalMultiplier > 0) {
    finalMultiplier = resistMultiplierOneStepFurther(finalMultiplier)
    passiveSources.push('Wobble')
  }
  if (input.context.queries.abilities.has(input.recipientId, 'Shadow Shield')
    && target.currentHp >= Math.max(1, target.maxHp)
    && finalMultiplier > 0) {
    finalMultiplier = resistMultiplierOneStepFurther(finalMultiplier)
    passiveSources.push('Shadow Shield')
  }
  // Teravolt/Turboblaze neutralize resistance after every other defensive
  // modifier, including reviewed response-owned resistance such as RKS System
  // and Counter/Mirror Coat. Transistor is explicitly later than all modifiers.
  if (typedBypass && finalMultiplier > 0 && finalMultiplier < 1) finalMultiplier = 1
  const transistor = input.operation?.payload.preTypeDamageModifiers?.some(modifier => (
    modifier.reasonCode === `ability.transistor.vulnerability:${input.recipientId}`
  )) === true
  if (transistor) {
    // PTU treats an immunity as two resistance steps for Transistor, then makes
    // the selected target one step more vulnerable after every other modifier.
    const base = finalMultiplier === 0 ? multiplierFromEffectivenessSteps(-2) : finalMultiplier
    const steps = effectivenessStepsFromMultiplier(base)
    if (steps !== null) finalMultiplier = multiplierFromEffectivenessSteps(steps + 1)
    immunitySource = null
    passiveSources.push('Transistor')
  }
  const wonderGuard = input.context.queries.abilities.has(input.recipientId, 'Wonder Guard')
    && !typedBypass
    && !transistor
  if (wonderGuard) {
    const hasWeakness = POKEMON_TYPES.some(type => computeMultiplier(type, target.defenderTypes) > 1)
    if (hasWeakness && finalMultiplier <= 1) {
      finalMultiplier = 0
      immunitySource = 'Wonder Guard'
      passiveSources.push('Wonder Guard')
    }
  }
  return {
    ...input.resolved,
    passiveMultiplier: finalMultiplier,
    passiveSources,
    finalMultiplier,
    finalRelation: finalMultiplier === 0 ? 'immune'
      : finalMultiplier < 1 ? 'resistant'
        : finalMultiplier > 1 ? 'weak' : 'neutral',
    immunitySource,
  }
}

/** Teamwork/Victory Star outgoing Accuracy providers. */
export const aa085to100AccuracyModifiers = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly targetPlacementId?: string
  readonly script?: Pick<MoveAutomationScript, 'range'>
}): readonly { readonly sourceId: string; readonly reason: string; readonly value: number }[] => {
  const result: { sourceId: string; reason: string; value: number }[] = []
  const actorId = input.context.actor.placement.id
  const victory = input.context.actor.placement.sheetKind === 'pokemon'
    ? input.context.queries.placements.all().find(placement => (
    placement.id !== actorId
    && input.context.queries.relationships.resolve(placement.id, actorId).relationship === 'ally'
    && input.context.queries.abilities.has(placement.id, 'Victory Star')
  ))
    : undefined
  if (victory) result.push({
    sourceId: `ability.victory-star:${victory.id}`,
    reason: 'Victory Star Accuracy', value: 2,
  })
  if (activeEffect(input.context, actorId, 'aa093-sunglow-accuracy')) result.push({
    sourceId: 'ability.sunglow', reason: 'Sunglow Accuracy', value: 2,
  })
  if (input.targetPlacementId) {
    const grapple = input.context.map.encounterState?.effects.find(effect => (
      effect.tags.includes('aa085-pumpkingrab')
      && effect.tags.includes('grapple')
      && effect.affected.placementIds.includes(actorId)
      && effect.suppression.sources.length === 0
      && (effect.duration.remaining === null || effect.duration.remaining > 0)
    ))
    if (grapple && !grapple.affected.placementIds.includes(input.targetPlacementId)) result.push({
      sourceId: `ability.pumpkingrab:${grapple.id}`,
      reason: 'Grapple outside-target Accuracy', value: -6,
    })
  }
  if (input.targetPlacementId && /\bmelee\b/i.test(input.script?.range ?? '')) {
    const target = input.context.queries.tokens.get(input.targetPlacementId)
    const teamwork = target && input.context.queries.tokens.all().find(provider => (
      provider.id !== actorId
      && input.context.queries.relationships.resolve(provider.id, actorId).relationship === 'ally'
      && input.context.queries.relationships.resolve(provider.id, target.id).relationship === 'enemy'
      && input.context.queries.abilities.has(provider.id, 'Teamwork')
      && ptuGridDistanceBetweenFootprints(provider, target) <= 1
    ))
    if (teamwork) result.push({
      sourceId: `ability.teamwork:${teamwork.id}`,
      reason: 'Teamwork Accuracy', value: 2,
    })
  }
  return Object.freeze(result)
}
