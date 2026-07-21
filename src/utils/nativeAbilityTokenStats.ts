import abilityManifestJson from '../../data/ability-automation/manifest.json'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TabletopMap } from '~/types/map'
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
export const projectNativeAbilityTokenStats = (token: SpawnedPokemon): SpawnedPokemon => {
  if (!ABOMINABLE_SELECTED || !token.abilityNames?.includes('Abominable')) return token
  const fullMaxHp = (token.fullMaxHp ?? token.maxHp) + 15
  return {
    ...token,
    fullMaxHp,
    maxHp: computeInjuryAdjustedMaxHp(fullMaxHp, token.injuries),
  }
}
