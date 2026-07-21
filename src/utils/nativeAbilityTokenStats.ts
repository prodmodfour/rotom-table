import abilityManifestJson from '../../data/ability-automation/manifest.json'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TabletopMap } from '~/types/map'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { computeInjuryAdjustedMaxHp } from '~/utils/ptuHp'

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
export const projectNativeAbilityTokenStats = (
  token: SpawnedPokemon,
  sheet?: Pick<CharacterSheet | TrainerSheet, 'abilities'>,
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
  if (!color) return projected
  const bonus = color.includes('-') ? 3 : 6
  const stats = COLOR_THEORY_STATS[color]!
  const hpBonus = stats.includes('hp') ? bonus * 3 : 0
  const fullMaxHp = (projected.fullMaxHp ?? projected.maxHp) + hpBonus
  return {
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
