import abilityManifestJson from '../../data/ability-automation/manifest.json'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TabletopMap } from '~/types/map'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { computeInjuryAdjustedMaxHp } from '~/utils/ptuHp'
import { MOVEMENT_MODES, type EffectiveMovementMode } from '~/types/movement'
import { moveAutomationTargetSuppressesGroundsourceImmunity } from '~/utils/moveAutomationKeywordImmunity'

const ABOMINABLE_RUNTIME = Object.freeze({
  kind: 'abilityspec-v1',
  version: 1,
  definitionHash: '7dac8de0c873b773145fbb8cb2844129163840ec55d08f26eb51ed52a018cf61',
  sourceModule: 'server/domain/abilityAutomation/specs/aa060.ts',
} as const)
const abominableSelected = (): boolean => {
  const row = abilityManifestJson.abilities.find(ability => ability.canonicalId === 'Abominable')
  return row?.baseStatus === 'complete'
    && row.runtime.kind === ABOMINABLE_RUNTIME.kind
    && row.runtime.version === ABOMINABLE_RUNTIME.version
    && row.runtime.definitionHash === ABOMINABLE_RUNTIME.definitionHash
    && row.runtime.sourceModule === ABOMINABLE_RUNTIME.sourceModule
}
const ABOMINABLE_SELECTED = abominableSelected()
const CHLOROPHYLL_RUNTIME = Object.freeze({
  kind: 'abilityspec-v1', version: 1,
  definitionHash: '9a271d8aa60028738a5c3edc9b78827da33277dd9f7bcec6f246a07c1d0857e4',
  sourceModule: 'server/domain/abilityAutomation/specs/aa063.ts',
} as const)
const CHLOROPHYLL_SELECTED = (() => {
  const row = abilityManifestJson.abilities.find(ability => ability.canonicalId === 'Chlorophyll')
  return row?.baseStatus === 'complete'
    && row.runtime.kind === CHLOROPHYLL_RUNTIME.kind
    && row.runtime.version === CHLOROPHYLL_RUNTIME.version
    && row.runtime.definitionHash === CHLOROPHYLL_RUNTIME.definitionHash
    && row.runtime.sourceModule === CHLOROPHYLL_RUNTIME.sourceModule
})()
const COLOR_THEORY_SELECTED = (() => {
  const row = abilityManifestJson.abilities.find(ability => ability.canonicalId === 'Color Theory')
  return row?.baseStatus === 'complete'
    && row.runtime.kind === 'abilityspec-v1'
    && row.runtime.version === 1
    && row.runtime.definitionHash === '5ab08ed52993c3c9aa8bd3d4a137f9b565b3cdbcf622561cc088ce1700bbc0a8'
    && row.runtime.sourceModule === 'server/domain/abilityAutomation/specs/aa064.ts'
})()
const AA077_RUNTIME_HASHES = Object.freeze({
  Levitate: '973c33edd723cd2ac20f7ba2180d6e720d26cbcbd136b6ab7085750de2f44283',
  'Light Metal': '7c80e1f9163ab3f53008200f902b84946da518b85ea63872032149db6987a537',
} as const)
const aa077Selected = (canonicalId: keyof typeof AA077_RUNTIME_HASHES): boolean => {
  const row = abilityManifestJson.abilities.find(ability => ability.canonicalId === canonicalId)
  return row?.baseStatus === 'complete'
    && row.runtime.kind === 'abilityspec-v1'
    && row.runtime.version === 1
    && row.runtime.definitionHash === AA077_RUNTIME_HASHES[canonicalId]
    && row.runtime.sourceModule === 'server/domain/abilityAutomation/specs/aa077.ts'
}
const LEVITATE_SELECTED = aa077Selected('Levitate')
const LIGHT_METAL_SELECTED = aa077Selected('Light Metal')

const COLOR_THEORY_STATS: Readonly<Record<string, readonly ('hp' | 'atk' | 'def' | 'satk' | 'sdef' | 'spd')[]>> = Object.freeze({
  red: ['atk'], 'red-orange': ['atk', 'def'], orange: ['def'],
  'yellow-orange': ['def', 'satk'], yellow: ['satk'], 'yellow-green': ['satk', 'sdef'],
  green: ['sdef'], 'blue-green': ['sdef', 'spd'], blue: ['spd'],
  'blue-violet': ['spd', 'hp'], violet: ['hp'], 'red-violet': ['hp', 'atk'],
})
const colorTheoryOption = (sheet: Pick<CharacterSheet | TrainerSheet, 'abilities'> | undefined): string | null => {
  const ability = sheet?.abilities?.find(entry => entry.name === 'Color Theory')
  const data = ability?.automation
  if (!data || data.canonicalId !== 'Color Theory' || data.definitionVersion !== 1) return null
  const selection = data.selections.find(entry => entry.parameterId === 'color')
  const option = selection?.optionIds.length === 1 ? selection.optionIds[0] : null
  return option && COLOR_THEORY_STATS[option] ? option : null
}

export const nativeChlorophyllInitiativeMultiplier = (
  token: SpawnedPokemon,
  map: Pick<TabletopMap, 'fieldEffects' | 'encounterState' | 'initiative'>,
): 1 | 2 => {
  if (!CHLOROPHYLL_SELECTED || !token.abilityNames?.includes('Chlorophyll')) return 1
  const round = Math.max(1, map.initiative?.round ?? 1)
  const airLockActive = (map.encounterState?.abilityOwnedState?.entries ?? []).some(entry => (
    entry.canonicalId === 'Air Lock'
    && entry.payload.kind === 'mark'
    && entry.payload.markId === `aa060.air-lock.active:${round}`
  ))
  const sunny = !airLockActive && (map.fieldEffects?.weather ?? []).some(weather => weather.kind === 'sunny')
  const maximumHp = Math.max(1, token.fullMaxHp ?? token.maxHp)
  return sunny || Math.max(0, token.currentHp) * 2 < maximumHp ? 2 : 1
}

/** Presentation/shared token projection for exact manifest-selected static stat providers. */
const modesWithLevitate = (
  modes: readonly EffectiveMovementMode[] | undefined,
  speed: number,
): readonly EffectiveMovementMode[] => {
  const current = new Map((modes ?? []).map(mode => [mode.mode, mode]))
  current.set('levitate', {
    mode: 'levitate', available: true, speed, longJump: null, highJump: null,
  })
  return MOVEMENT_MODES.map(mode => current.get(mode) ?? {
    mode, available: false, speed: null, longJump: null, highJump: null,
  })
}

export interface Aa077AbilityTokenStatProjection {
  readonly lightMetal: boolean
  readonly levitate: boolean
}

/** Shared pure AA-077 token projection; callers determine exact ability effectiveness. */
export const projectAa077AbilityTokenStats = (
  token: SpawnedPokemon,
  abilities: Aa077AbilityTokenStatProjection,
): SpawnedPokemon => {
  let projected = token
  if (abilities.lightMetal) {
    projected = {
      ...projected,
      def: Math.max(1, projected.def - 2),
      spd: Math.max(1, (projected.spd ?? 0) + 2),
      ...(typeof projected.weightClass === 'number'
        ? { weightClass: Math.max(1, projected.weightClass - 2) }
        : {}),
    }
  }
  if (!abilities.levitate) return projected
  const base = projected.movementCapabilities?.levitate
  const speed = typeof base === 'number' && Number.isFinite(base) && base > 0 ? base + 2 : 4
  const movementProfile = projected.movementProfile
    ? {
        ...projected.movementProfile,
        speeds: { ...projected.movementProfile.speeds, levitate: speed },
        state: {
          ...projected.movementProfile.state,
          grounding: moveAutomationTargetSuppressesGroundsourceImmunity(projected)
            ? 'grounded' as const
            : 'airborne' as const,
        },
        modes: modesWithLevitate(projected.movementProfile.modes, speed),
      }
    : projected.movementProfile
  return {
    ...projected,
    movementCapabilities: { ...(projected.movementCapabilities ?? {}), levitate: speed },
    ...(movementProfile ? { movementProfile } : {}),
    defenderCapabilities: { ...(projected.defenderCapabilities ?? {}), levitate: speed },
    ...(projected.ruleCapabilities ? {
      ruleCapabilities: {
        ...projected.ruleCapabilities,
        movementSpeeds: { ...projected.ruleCapabilities.movementSpeeds, levitate: speed },
      },
    } : {}),
  }
}

const projectAa077NativeStats = (
  token: SpawnedPokemon,
  options: NativeAbilityTokenStatProjectionOptions,
): SpawnedPokemon => {
  if (options.skipAa077NativeProjection) return token
  const abilities = new Set(token.abilityNames ?? [])
  return projectAa077AbilityTokenStats(token, {
    lightMetal: LIGHT_METAL_SELECTED && abilities.has('Light Metal'),
    levitate: LEVITATE_SELECTED && abilities.has('Levitate'),
  })
}

export interface NativeAbilityTokenStatProjectionOptions {
  /** Authoritative server contexts project AA-077 from exact effective abilities. */
  readonly skipAa077NativeProjection?: boolean
}

export const projectNativeAbilityTokenStats = (
  token: SpawnedPokemon,
  sheet?: Pick<CharacterSheet | TrainerSheet, 'abilities'>,
  options: NativeAbilityTokenStatProjectionOptions = {},
): SpawnedPokemon => {
  let projected = token
  if (ABOMINABLE_SELECTED && projected.abilityNames?.includes('Abominable')) {
    const fullMaxHp = (projected.fullMaxHp ?? projected.maxHp) + 15
    projected = {
      ...projected,
      fullMaxHp,
      maxHp: computeInjuryAdjustedMaxHp(fullMaxHp, projected.injuries),
    }
  }
  const color = COLOR_THEORY_SELECTED && projected.abilityNames?.includes('Color Theory')
    ? colorTheoryOption(sheet)
    : null
  if (color) {
    const bonus = color.includes('-') ? 3 : 6
    const stats = COLOR_THEORY_STATS[color]!
    const hpBonus = stats.includes('hp') ? bonus * 3 : 0
    const fullMaxHp = (projected.fullMaxHp ?? projected.maxHp) + hpBonus
    projected = {
      ...projected,
      ...(stats.includes('atk') ? { atk: (projected.atk ?? 0) + bonus } : {}),
      ...(stats.includes('def') ? { def: (projected.def ?? 0) + bonus } : {}),
      ...(stats.includes('satk') ? { satk: (projected.satk ?? 0) + bonus } : {}),
      ...(stats.includes('sdef') ? { sdef: (projected.sdef ?? 0) + bonus } : {}),
      ...(stats.includes('spd') ? { spd: (projected.spd ?? 0) + bonus } : {}),
      ...(hpBonus > 0 ? {
        fullMaxHp,
        maxHp: computeInjuryAdjustedMaxHp(fullMaxHp, projected.injuries),
      } : {}),
    }
  }
  return projectAa077NativeStats(projected, options)
}
