import type { MoveAutomationHpUpdate } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import { clampHpValue, computeInjuryAdjustedMaxHp, normalizeInjuryCount } from '~/utils/ptuHp'
import {
  computePtuInjuryAutomation,
  type PtuInjuryAutomationResult,
  type PtuInjuryHpReductionSource,
} from '~/utils/ptuInjuries'

interface MoveAutomationHpAccumulatorEntry {
  token: SpawnedPokemon
  currentHp: number
  injuries: number
}

export interface MoveAutomationHpUpdateAccumulator {
  get(token: SpawnedPokemon): number
  getInjuries(token: SpawnedPokemon): number
  getMaxHp(token: SpawnedPokemon): number
  set(token: SpawnedPokemon, currentHp: number): void
  setWithInjuryAutomation(
    token: SpawnedPokemon,
    currentHp: number,
    source: PtuInjuryHpReductionSource,
  ): PtuInjuryAutomationResult
  toUpdates(): MoveAutomationHpUpdate[]
}

const tokenFullMaxHp = (token: SpawnedPokemon): number => token.fullMaxHp ?? 0
const tokenInjuries = (token: SpawnedPokemon): number => normalizeInjuryCount(token.injuries)

const maxHpFor = (token: SpawnedPokemon, injuries: number): number =>
  token.fullMaxHp == null ? token.maxHp : computeInjuryAdjustedMaxHp(token.fullMaxHp, injuries)

export const clampMoveAutomationHp = (currentHp: number, maxHp: number): number => clampHpValue(currentHp, maxHp)

export const createMoveAutomationHpUpdateAccumulator = (): MoveAutomationHpUpdateAccumulator => {
  const hpById = new Map<string, MoveAutomationHpAccumulatorEntry>()

  const getEntry = (token: SpawnedPokemon): MoveAutomationHpAccumulatorEntry | undefined => hpById.get(token.id)
  const makeEntry = (token: SpawnedPokemon): MoveAutomationHpAccumulatorEntry => ({
    token,
    currentHp: token.currentHp,
    injuries: tokenInjuries(token),
  })
  const ensureEntry = (token: SpawnedPokemon): MoveAutomationHpAccumulatorEntry => {
    const existing = getEntry(token)
    if (existing) return existing
    const entry = makeEntry(token)
    hpById.set(token.id, entry)
    return entry
  }

  const setEntryHp = (entry: MoveAutomationHpAccumulatorEntry, currentHp: number): void => {
    entry.currentHp = clampMoveAutomationHp(currentHp, maxHpFor(entry.token, entry.injuries))
  }

  return {
    get: (token) => getEntry(token)?.currentHp ?? token.currentHp,
    getInjuries: (token) => getEntry(token)?.injuries ?? tokenInjuries(token),
    getMaxHp: (token) => maxHpFor(token, getEntry(token)?.injuries ?? tokenInjuries(token)),
    set: (token, currentHp) => {
      const entry = ensureEntry(token)
      setEntryHp(entry, currentHp)
    },
    setWithInjuryAutomation: (token, currentHp, source) => {
      const entry = ensureEntry(token)
      const result = computePtuInjuryAutomation({
        beforeHp: entry.currentHp,
        afterHp: currentHp,
        fullMaxHp: tokenFullMaxHp(token),
        currentInjuries: entry.injuries,
        source,
      })
      entry.injuries = result.injuries
      setEntryHp(entry, currentHp)
      return result
    },
    toUpdates: () => Array.from(hpById.entries())
      .filter(([_id, entry]) => entry.currentHp !== entry.token.currentHp || entry.injuries !== tokenInjuries(entry.token))
      .map(([id, entry]) => ({
        id,
        currentHp: entry.currentHp,
        ...(entry.injuries !== tokenInjuries(entry.token) ? { injuries: entry.injuries } : {}),
      })),
  }
}
