import { createHash } from 'node:crypto'
import {
  parseEncounterEffect,
  type EncounterEffect,
} from '#shared/moveAutomation/encounterEffects'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'

const PARENTAL_BOND = 'Parental Bond'

const shortHash = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000'))
  .digest('hex')
  .slice(0, 20)

const tokenDistance = (
  left: AuthoritativeMoveRulesContext['actor']['token'],
  right: AuthoritativeMoveRulesContext['actor']['token'],
): number => Math.max(
  Math.abs(left.position.x - right.position.x),
  Math.abs(left.position.y - right.position.y),
  Math.abs(left.position.z - right.position.z),
)

const sceneEffect = (input: {
  readonly id: string
  readonly kind: 'condition' | 'numeric-modifier'
  readonly operationId: string
  readonly sourcePlacementId: string
  readonly recipientPlacementId: string
  readonly position: { readonly x: number; readonly y: number; readonly z: number }
  readonly round: number
  readonly turn: number
  readonly payload: Record<string, unknown>
  readonly tags: readonly string[]
}): EncounterEffect => parseEncounterEffect({
  id: input.id,
  kind: input.kind,
  tags: [...input.tags],
  source: {
    operationId: input.operationId,
    moveId: 'parental-bond',
    placementId: input.sourcePlacementId,
  },
  affected: {
    placementIds: [input.recipientPlacementId],
    sideIds: [],
    cells: [{ ...input.position }],
  },
  createdRound: input.round,
  createdTurn: input.turn,
  duration: { kind: 'scene', remaining: null },
  stacks: 1,
  charges: null,
  stackPolicy: { kind: 'refresh', maxStacks: null },
  chargePolicy: { kind: 'none', amount: null },
  payload: input.payload,
  dispel: { policy: 'matching-tags', tags: ['parental-bond', 'mother-rage'] },
  transferPolicy: 'expire',
  suppression: { sources: [] },
}, `ability.${input.id}`)

/**
 * Applies Parental Bond's scene-long mother rage after the Baby is knocked out.
 *
 * Sheets have no first-class parent link, so the authoritative live-play link is
 * the nearest conscious allied Kangaskhan within the canonical 10-metre tether.
 * Ties are broken by placement id. This keeps replay and reconnect deterministic.
 */
export const applyAa082ParentalBondFaintTrigger = (input: {
  readonly map: TabletopMap
  readonly context: AuthoritativeMoveRulesContext
  readonly faintedPlacementIds: readonly string[]
  readonly operationId: string
}): TabletopMap => {
  if (input.faintedPlacementIds.length === 0 || !input.map.encounterState) return input.map
  const effects = [...input.map.encounterState.effects]
  const round = input.map.encounterState.history.currentRound ?? input.map.initiative?.round ?? 1
  const turn = input.map.encounterState.history.currentTurn?.turn ?? 1
  let changed = false

  for (const babyId of [...new Set(input.faintedPlacementIds)].sort()) {
    const baby = input.context.queries.tokens.get(babyId)
    if (!baby || !input.context.queries.abilities.has(babyId, PARENTAL_BOND)) continue
    const mother = input.context.queries.tokens.all()
      .filter(candidate => candidate.id !== babyId)
      .filter(candidate => input.context.queries.relationships.resolve(babyId, candidate.id).relationship === 'ally')
      .filter(candidate => candidate.sheetKind === 'pokemon')
      .filter(candidate => {
        const placement = input.context.queries.placements.get(candidate.id)
        const resolved = placement ? input.context.queries.sheets.forPlacement(placement) : null
        const sheet = resolved?.kind === 'pokemon' ? resolved.sheet as CharacterSheet : null
        return sheet?.species?.trim().toLowerCase() === 'kangaskhan'
          && (sheet.combat?.currentHp ?? 1) > 0
      })
      .map(candidate => ({ candidate, distance: tokenDistance(baby, candidate) }))
      .sort((left, right) => left.distance - right.distance || left.candidate.id.localeCompare(right.candidate.id))[0]
      ?.candidate
    if (!mother) continue

    const suffix = shortHash(
      input.map.encounterState.history.sceneId ?? 'scene',
      babyId,
      mother.id,
    )
    const prefix = `ability.parental-bond.mother-rage.${suffix}`
    if (effects.some(effect => effect.id.startsWith(prefix))) continue
    const common = {
      operationId: `${input.operationId}:parental-bond:${suffix}`,
      sourcePlacementId: babyId,
      recipientPlacementId: mother.id,
      position: mother.position,
      round,
      turn,
      tags: ['ability', 'aa082', 'parental-bond', 'mother-rage'],
    } as const
    effects.push(
      sceneEffect({
        ...common,
        id: `${prefix}.condition`,
        kind: 'condition',
        payload: { conditionId: 'rage', action: 'apply', saveTiming: null },
      }),
      sceneEffect({
        ...common,
        id: `${prefix}.dr`,
        kind: 'numeric-modifier',
        payload: { attribute: 'damage-reduction', operation: 'add', value: 5, rounding: 'none' },
      }),
      sceneEffect({
        ...common,
        id: `${prefix}.damage`,
        kind: 'numeric-modifier',
        payload: { attribute: 'damage', operation: 'add', value: 5, rounding: 'none' },
      }),
    )
    changed = true
  }

  return changed
    ? { ...input.map, encounterState: { ...input.map.encounterState, effects } }
    : input.map
}
