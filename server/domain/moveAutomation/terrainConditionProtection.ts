import { createHash } from 'node:crypto'
import type {
  EncounterConditionEffect,
} from '#shared/moveAutomation/encounterEffects'
import { parseEncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type {
  MistyTerrainConditionProtection,
} from '#shared/moveAutomation/terrain'
import { conditionsAppliedWith } from '~/utils/conditionApplication'
import {
  conditionLookupKey,
  normalizeConditionName,
} from '~/utils/statusConditions'

export interface CreateMistyTerrainConditionProtectionEffectsInput {
  readonly protection: MistyTerrainConditionProtection
  readonly conditionId: string
  readonly operationId: string
  readonly moveId: string
  readonly sourcePlacementId: string
  readonly recipientPlacementId: string
  readonly createdRound: number
  readonly createdTurn: number
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const effectId = (input: {
  readonly zoneId: string
  readonly recipientPlacementId: string
  readonly conditionId: string
}): string => `condition-protection.${createHash('sha256')
  .update(`${input.zoneId}:${input.recipientPlacementId}:${input.conditionId}`)
  .digest('hex')
  .slice(0, 32)}`

const protectedConditionNames = (conditionId: string): readonly string[] => {
  const canonical = normalizeConditionName(conditionId)
  if (!canonical) return []
  return [...new Set([canonical, ...conditionsAppliedWith(canonical)])]
}

/**
 * Materialize Misty Terrain's first-turn protection as typed suppression.
 * The affliction remains sheet-owned, while its mechanics disappear from the
 * effective condition projection through the target's first turn-end boundary.
 */
export const createMistyTerrainConditionProtectionEffects = (
  input: CreateMistyTerrainConditionProtectionEffectsInput,
): readonly EncounterConditionEffect[] => Object.freeze(
  protectedConditionNames(input.conditionId).map((condition) => {
    const conditionId = conditionLookupKey(condition)
    return deepFreeze(parseEncounterEffect({
      id: effectId({
        zoneId: input.protection.zoneId,
        recipientPlacementId: input.recipientPlacementId,
        conditionId,
      }),
      kind: 'condition',
      source: {
        operationId: input.operationId,
        moveId: input.moveId,
        placementId: input.sourcePlacementId,
      },
      affected: {
        placementIds: [input.recipientPlacementId],
        sideIds: [],
        cells: [],
      },
      createdRound: Math.max(1, input.createdRound),
      createdTurn: Math.max(0, input.createdTurn),
      duration: {
        kind: 'turns',
        subject: 'target',
        boundary: 'end',
        remaining: 1,
      },
      stacks: 1,
      charges: null,
      stackPolicy: { kind: 'refresh', maxStacks: null },
      chargePolicy: { kind: 'none', amount: null },
      tags: ['condition-protection', 'terrain', 'misty'],
      payload: {
        conditionId,
        action: 'suppress',
        saveTiming: null,
      },
      dispel: { policy: 'none', tags: [] },
      transferPolicy: 'expire',
      suppression: { sources: [] },
    }, `mistyTerrainProtection.${conditionId}`) as EncounterConditionEffect)
  }),
)
