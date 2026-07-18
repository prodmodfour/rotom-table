import type { MoveSpec } from '#shared/moveAutomation/spec'

export const FIVE_STRIKE_HIT_COUNT_TABLE = Object.freeze([
  { minimum: 1, maximum: 1, hits: 1 },
  { minimum: 2, maximum: 3, hits: 2 },
  { minimum: 4, maximum: 6, hits: 3 },
  { minimum: 7, maximum: 7, hits: 4 },
  { minimum: 8, maximum: 8, hits: 5 },
] as const)

export interface ReviewedFiveStrikeMoveDefinition {
  readonly canonicalId: string
  readonly slug: string
  readonly damageBase: number
  readonly moveType: string
}

/**
 * Build the shared reviewed PTU Five Strike program.
 *
 * A single Accuracy Roll gates one sequence-owned 1d8 hit-count table. Each
 * scheduled strike then owns its critical and damage rolls, and the bounded
 * multi-hit reducer stops before another draw when the recipient is knocked
 * out. Catalog wrappers supply only canonical identity, DB, and type.
 */
export const createReviewedFiveStrikeMoveSpec = (
  definition: ReviewedFiveStrikeMoveDefinition,
): MoveSpec => {
  const sourceId = `move.${definition.slug}`
  const spec: MoveSpec = {
    schemaVersion: 2,
    canonicalId: definition.canonicalId,
    version: 2,
    targeting: {
      kind: 'single-target',
      minTargets: 1,
      maxTargets: 1,
      selector: { kind: 'selected-targets' },
    },
    preconditions: [],
    costs: [],
    phases: [
      {
        phase: 'damage',
        operations: [{
          id: `${definition.slug}.multi-hit`,
          kind: 'multi-hit',
          source: { kind: 'move', id: sourceId },
          recipients: { kind: 'attacked-targets' },
          phase: 'damage',
          reasonCode: `${definition.slug}.five-strike`,
          payload: {
            count: {
              kind: 'table',
              scope: 'sequence',
              rollId: `${definition.slug}.hit-count-roll`,
              tableId: `${definition.slug}.five-strike-count`,
              drawFormula: { kind: 'dice', count: 1, sides: 8, modifier: 0 },
              entries: FIVE_STRIKE_HIT_COUNT_TABLE,
            },
            accuracy: {
              kind: 'once',
              rollId: `${definition.slug}.accuracy-roll`,
              formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
            },
            critical: {
              kind: 'per-hit',
              rollId: `${definition.slug}.critical-roll`,
              formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
            },
            damage: {
              damageClass: 'physical',
              damageBase: definition.damageBase,
              moveType: definition.moveType,
              accuracyRollId: null,
              criticalRollId: null,
            },
            effects: [],
          },
        }],
      },
      {
        phase: 'usage',
        operations: [{
          id: `${definition.slug}.usage`,
          kind: 'usage',
          source: { kind: 'move', id: sourceId },
          recipients: { kind: 'actor' },
          phase: 'usage',
          reasonCode: `${definition.slug}.frequency-use`,
          payload: {
            action: 'spend',
            resourceId: `${definition.slug}.frequency-use`,
            amount: 1,
          },
        }],
      },
      {
        phase: 'cleanup',
        operations: [{
          id: `${definition.slug}.log-completed`,
          kind: 'log',
          source: { kind: 'move', id: sourceId },
          recipients: { kind: 'none' },
          phase: 'cleanup',
          reasonCode: `${definition.slug}.completed`,
          payload: {
            messageKey: `move.${definition.slug}.completed`,
            arguments: [],
          },
        }],
      },
    ],
    registeredHandlerId: null,
    presentation: {
      displayName: definition.canonicalId,
      vfxKey: sourceId,
      tags: ['damage', 'five-strike', 'multi-hit'],
    },
  }
  return Object.freeze(spec)
}
