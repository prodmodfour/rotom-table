import { createHash } from 'node:crypto'
import { parseEncounterEffect } from '#shared/moveAutomation/encounterEffects'
import { parseEncounterState, type EncounterState } from '#shared/moveAutomation/encounterState'
import type { GridAnchor, TabletopMap } from '~/types/map'
import { ptuGridVectorDistance } from '~/utils/ptuGridDistance'

const distance = (left: GridAnchor, right: GridAnchor): number => ptuGridVectorDistance({
  x: left.x - right.x,
  y: left.y - right.y,
  z: left.z - right.z,
})

/** Retain each exact current-turn voluntary route segment consulted by charge abilities. */
export const recordAa085to100MovementEvidence = (input: {
  readonly encounterState: EncounterState
  readonly placementId: string
  readonly operationId: string
  readonly path: readonly GridAnchor[]
  readonly mode: 'voluntary' | 'jump' | 'forced' | 'teleport'
}): EncounterState => {
  if ((input.mode !== 'voluntary' && input.mode !== 'jump') || input.path.length < 2) return input.encounterState
  const origin = input.path[0]!
  if (input.path.every(step => distance(origin, step) === 0)) return input.encounterState
  const currentTurn = input.encounterState.history.currentTurn
  const effectId = `ability.movement-evidence.${createHash('sha256')
    .update(`${input.placementId}\u0000${currentTurn?.round ?? 0}\u0000${currentTurn?.turn ?? 0}\u0000${input.operationId}`)
    .digest('hex').slice(0, 24)}`
  const evidence = parseEncounterEffect({
    id: effectId,
    kind: 'capability',
    source: {
      operationId: input.operationId,
      moveId: input.mode === 'jump' ? 'capability.jump' : 'movement.shift',
      placementId: input.placementId,
    },
    affected: {
      placementIds: [input.placementId],
      sideIds: [],
      cells: input.path.map(cell => ({ ...cell })),
    },
    createdRound: Math.max(1, currentTurn?.round ?? input.encounterState.history.currentRound ?? 1),
    createdTurn: Math.max(0, currentTurn?.turn ?? 0),
    duration: { kind: 'turns', subject: 'source', boundary: 'end', remaining: 1 },
    stacks: 1,
    charges: null,
    stackPolicy: { kind: 'replace', maxStacks: null },
    chargePolicy: { kind: 'none', amount: null },
    tags: ['ability', 'aa085to100-movement-evidence', `movement-mode:${input.mode}`],
    payload: { capabilityId: `aa085to100.movement.${input.mode}-route`, action: 'grant' },
    dispel: { policy: 'matching-tags', tags: ['aa085to100-movement-evidence'] },
    transferPolicy: 'expire',
    suppression: { sources: [] },
  }, 'ability.movementEvidence')
  return parseEncounterState({
    ...input.encounterState,
    effects: [
      ...input.encounterState.effects.filter(effect => effect.id !== evidence.id),
      evidence,
    ],
  })
}

/** Shadow Tag constrains all paths; a Pumpkingrab grapple forbids ordinary Shifts entirely. */
export const aa085to100ShadowTagPathViolation = (input: {
  readonly map: Pick<TabletopMap, 'encounterState'>
  readonly placementId: string
  readonly path: readonly GridAnchor[]
}): boolean => {
  const grappled = input.map.encounterState?.effects.some(effect => (
    effect.tags.includes('aa085-pumpkingrab')
    && effect.tags.includes('grapple')
    && effect.affected.placementIds.includes(input.placementId)
    && effect.suppression.sources.length === 0
    && (effect.duration.remaining === null || effect.duration.remaining > 0)
  )) === true
  if (grappled && input.path.length > 0) return true
  const marker = input.map.encounterState?.effects.find(effect => (
    effect.tags.includes('aa089-shadow-tag')
    && effect.affected.placementIds.includes(input.placementId)
    && effect.affected.cells.length === 1
    && effect.suppression.sources.length === 0
    && (effect.duration.remaining === null || effect.duration.remaining > 0)
  ))
  const origin = marker?.affected.cells[0]
  return origin ? input.path.some(step => distance(origin, step) > 5) : false
}
