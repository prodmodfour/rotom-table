import type { MoveAutomationHpUpdate } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import { clampHpValue } from '~/utils/ptuHp'

export interface MoveAutomationHpUpdateAccumulator {
  get(token: SpawnedPokemon): number
  set(token: SpawnedPokemon, currentHp: number): void
  toUpdates(): MoveAutomationHpUpdate[]
}

export const clampMoveAutomationHp = (currentHp: number, maxHp: number): number => clampHpValue(currentHp, maxHp)

export const createMoveAutomationHpUpdateAccumulator = (): MoveAutomationHpUpdateAccumulator => {
  const hpById = new Map<string, { token: SpawnedPokemon; currentHp: number }>()

  return {
    get: (token) => hpById.get(token.id)?.currentHp ?? token.currentHp,
    set: (token, currentHp) => {
      hpById.set(token.id, { token, currentHp: clampMoveAutomationHp(currentHp, token.maxHp) })
    },
    toUpdates: () => Array.from(hpById.entries())
      .filter(([_id, entry]) => entry.currentHp !== entry.token.currentHp)
      .map(([id, entry]) => ({ id, currentHp: entry.currentHp })),
  }
}
