import type { MoveAutomationHpUpdate } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import { clampHpValue, computeInjuryAdjustedMaxHp, normalizeInjuryCount } from '~/utils/ptuHp'
import {
  computePtuInjuryAutomation,
  type PtuInjuryAutomationResult,
  type PtuInjuryHpReductionSource,
} from '~/utils/ptuInjuries'
import { applyDamageToTemporaryHp, normalizeTemporaryHpAmount } from '~/utils/mapTemporaryHitPoints'

interface MoveAutomationHpAccumulatorEntry {
  token: SpawnedPokemon
  currentHp: number
  temporaryHp: number
  injuries: number
}

export interface MoveAutomationHpLossResult {
  injuryResult: PtuInjuryAutomationResult
  effectiveHpLost: number
  realHpLost: number
  absorbedByTemporaryHp: number
}

export interface MoveAutomationHpUpdateAccumulator {
  get(token: SpawnedPokemon): number
  getTemporaryHp(token: SpawnedPokemon): number
  getEffectiveHp(token: SpawnedPokemon): number
  getInjuries(token: SpawnedPokemon): number
  getMaxHp(token: SpawnedPokemon): number
  set(token: SpawnedPokemon, currentHp: number): void
  setTemporaryHp(token: SpawnedPokemon, temporaryHp: number): void
  addInjuries(token: SpawnedPokemon, amount: number): void
  setWithInjuryAutomation(
    token: SpawnedPokemon,
    currentHp: number,
    source: PtuInjuryHpReductionSource,
  ): PtuInjuryAutomationResult
  applyLossWithInjuryAutomation(
    token: SpawnedPokemon,
    hpLoss: number,
    source: PtuInjuryHpReductionSource,
  ): MoveAutomationHpLossResult
  toUpdates(): MoveAutomationHpUpdate[]
}

const tokenFullMaxHp = (token: SpawnedPokemon): number => token.fullMaxHp ?? 0
const tokenInjuries = (token: SpawnedPokemon): number => normalizeInjuryCount(token.injuries)
const tokenTemporaryHp = (token: SpawnedPokemon): number => normalizeTemporaryHpAmount(token.temporaryHp)

const maxHpFor = (token: SpawnedPokemon, injuries: number): number =>
  token.fullMaxHp == null ? token.maxHp : computeInjuryAdjustedMaxHp(token.fullMaxHp, injuries)

export const clampMoveAutomationHp = (currentHp: number, maxHp: number): number => clampHpValue(currentHp, maxHp)

export const createMoveAutomationHpUpdateAccumulator = (): MoveAutomationHpUpdateAccumulator => {
  const hpById = new Map<string, MoveAutomationHpAccumulatorEntry>()

  const getEntry = (token: SpawnedPokemon): MoveAutomationHpAccumulatorEntry | undefined => hpById.get(token.id)
  const makeEntry = (token: SpawnedPokemon): MoveAutomationHpAccumulatorEntry => ({
    token,
    currentHp: token.currentHp,
    temporaryHp: tokenTemporaryHp(token),
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
    getTemporaryHp: (token) => getEntry(token)?.temporaryHp ?? tokenTemporaryHp(token),
    getEffectiveHp: (token) => {
      const entry = getEntry(token)
      return entry ? entry.currentHp + entry.temporaryHp : token.currentHp + tokenTemporaryHp(token)
    },
    getInjuries: (token) => getEntry(token)?.injuries ?? tokenInjuries(token),
    getMaxHp: (token) => maxHpFor(token, getEntry(token)?.injuries ?? tokenInjuries(token)),
    set: (token, currentHp) => {
      const entry = ensureEntry(token)
      setEntryHp(entry, currentHp)
    },
    setTemporaryHp: (token, temporaryHp) => {
      const entry = ensureEntry(token)
      entry.temporaryHp = normalizeTemporaryHpAmount(temporaryHp)
    },
    addInjuries: (token, amount) => {
      const entry = ensureEntry(token)
      entry.injuries = normalizeInjuryCount(entry.injuries + Math.max(0, Math.floor(amount)))
      setEntryHp(entry, entry.currentHp)
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
    applyLossWithInjuryAutomation: (token, hpLoss, source) => {
      const entry = ensureEntry(token)
      const beforeEffectiveHp = entry.currentHp + entry.temporaryHp
      const damage = applyDamageToTemporaryHp({
        currentHp: entry.currentHp,
        temporaryHp: entry.temporaryHp,
        hpLoss,
      })
      const result = computePtuInjuryAutomation({
        beforeHp: entry.currentHp,
        afterHp: damage.currentHp,
        fullMaxHp: tokenFullMaxHp(token),
        currentInjuries: entry.injuries,
        source,
      })
      entry.injuries = result.injuries
      entry.temporaryHp = damage.temporaryHp
      setEntryHp(entry, damage.currentHp)
      return {
        injuryResult: result,
        effectiveHpLost: Math.max(0, beforeEffectiveHp - (entry.currentHp + entry.temporaryHp)),
        realHpLost: damage.realHpLoss,
        absorbedByTemporaryHp: damage.absorbedByTemporaryHp,
      }
    },
    toUpdates: () => Array.from(hpById.entries())
      .filter(([_id, entry]) => (
        entry.currentHp !== entry.token.currentHp
        || entry.injuries !== tokenInjuries(entry.token)
        || entry.temporaryHp !== tokenTemporaryHp(entry.token)
      ))
      .map(([id, entry]) => ({
        id,
        currentHp: entry.currentHp,
        ...(entry.temporaryHp !== tokenTemporaryHp(entry.token) ? { temporaryHp: entry.temporaryHp } : {}),
        ...(entry.injuries !== tokenInjuries(entry.token) ? { injuries: entry.injuries } : {}),
      })),
  }
}
