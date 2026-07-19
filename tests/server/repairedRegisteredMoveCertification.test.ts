import { describe, expect, it } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import {
  AROMATIC_MIST_ALLY_AREA_SCENARIOS,
  COACHING_ALLY_AREA_SCENARIOS,
  HOWL_ALLY_AREA_SCENARIOS,
} from '../fixtures/moveAutomation/allyAreaLegacyV1'
import { HELPING_HAND_V2_SEMANTIC_SCENARIOS } from '../fixtures/moveAutomation/helpingHandV2'
import { KNOCK_OFF_V2_SEMANTIC_SCENARIOS } from '../fixtures/moveAutomation/knockOffV2'
import {
  ASTONISH_V2_SEMANTIC_SCENARIOS,
  FAKE_OUT_V2_SEMANTIC_SCENARIOS,
} from '../fixtures/moveAutomation/openingMovesV2'
import { REFLECT_V2_SEMANTIC_SCENARIOS } from '../fixtures/moveAutomation/reflectV2'
import { SAND_TOMB_V2_SEMANTIC_SCENARIOS } from '../fixtures/moveAutomation/sandTombV2'
import {
  FURY_ATTACK_REG_011_SCENARIOS,
  FURY_CUTTER_REG_011_SCENARIOS,
  FURY_SWIPES_REG_011_SCENARIOS,
} from '../fixtures/moveAutomation/registeredBatch011'
import { PIN_MISSILE_REG_019_SCENARIOS } from '../fixtures/moveAutomation/registeredBatch019'
import { TACKLE_REG_030_SCENARIOS } from '../fixtures/moveAutomation/registeredBatch030'
import { TAKE_DOWN_V2_SEMANTIC_SCENARIOS } from '../fixtures/moveAutomation/takeDownV2'
import { U_TURN_V2_SEMANTIC_SCENARIOS } from '../fixtures/moveAutomation/uTurnV2'
import { YAWN_V2_SEMANTIC_SCENARIOS } from '../fixtures/moveAutomation/yawnV2'
import { registeredMoveAutomationRuntimeFor } from '~~/server/domain/moveAutomation/registry'

type RepairedRuntimeKind = 'legacy-v1' | 'movespec-v2'
type CertificationLayer = 'interpreter' | 'planner' | 'acceptedCommand'

interface SemanticEvidenceReference {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

interface RepairedMoveCertification {
  readonly canonicalId: string
  readonly runtimeKind: RepairedRuntimeKind
  readonly scenarios: readonly SemanticEvidenceReference[]
  /** One focused scenario exercised at each immediate authoritative boundary. */
  readonly executionScenarioIds: Readonly<Record<CertificationLayer, string>>
  /** Scenarios exercised by exact duplicate operation delivery. */
  readonly duplicateReplayScenarioIds: readonly string[]
  /** Required only for a durable response saga. */
  readonly reconnectScenarioId?: string
}

const allImmediateLayers = (
  scenarioId: string,
): Readonly<Record<CertificationLayer, string>> => Object.freeze({
  interpreter: scenarioId,
  planner: scenarioId,
  acceptedCommand: scenarioId,
})

/**
 * Cross-cutting certificate for the scripts repaired by MA-170 through MA-180.
 * Focused suites execute these IDs; this matrix prevents their manifest rows,
 * runtime selection, and boundary/recovery evidence from drifting apart.
 */
const REPAIRED_MOVE_CERTIFICATIONS: readonly RepairedMoveCertification[] = Object.freeze([
  {
    canonicalId: 'Aromatic Mist',
    runtimeKind: 'legacy-v1',
    scenarios: AROMATIC_MIST_ALLY_AREA_SCENARIOS,
    executionScenarioIds: allImmediateLayers('aromatic-mist.legacy-v1-mixed-sides'),
    duplicateReplayScenarioIds: ['aromatic-mist.legacy-v1-duplicate-replay'],
  },
  {
    canonicalId: 'Astonish',
    runtimeKind: 'movespec-v2',
    scenarios: ASTONISH_V2_SEMANTIC_SCENARIOS,
    executionScenarioIds: allImmediateLayers('astonish.v2-threshold-pass'),
    duplicateReplayScenarioIds: ['astonish.v2-reconnect-retry'],
    reconnectScenarioId: 'astonish.v2-reconnect-retry',
  },
  {
    canonicalId: 'Coaching',
    runtimeKind: 'legacy-v1',
    scenarios: COACHING_ALLY_AREA_SCENARIOS,
    executionScenarioIds: allImmediateLayers('coaching.legacy-v1-mixed-sides'),
    duplicateReplayScenarioIds: ['coaching.legacy-v1-duplicate-replay'],
  },
  {
    canonicalId: 'Fake Out',
    runtimeKind: 'movespec-v2',
    scenarios: FAKE_OUT_V2_SEMANTIC_SCENARIOS,
    executionScenarioIds: allImmediateLayers('fake-out.v2-joining-hit'),
    duplicateReplayScenarioIds: ['fake-out.v2-duplicate-retry'],
  },
  {
    canonicalId: 'Fury Attack',
    runtimeKind: 'movespec-v2',
    scenarios: FURY_ATTACK_REG_011_SCENARIOS,
    executionScenarioIds: allImmediateLayers('fury-attack.v2-one-hit'),
    duplicateReplayScenarioIds: ['fury-attack.v2-five-hit-critical'],
  },
  {
    canonicalId: 'Fury Cutter',
    runtimeKind: 'movespec-v2',
    scenarios: FURY_CUTTER_REG_011_SCENARIOS,
    executionScenarioIds: allImmediateLayers('fury-cutter.v2-first-hit'),
    duplicateReplayScenarioIds: ['fury-cutter.v2-duplicate-retry'],
  },
  {
    canonicalId: 'Fury Swipes',
    runtimeKind: 'movespec-v2',
    scenarios: FURY_SWIPES_REG_011_SCENARIOS,
    executionScenarioIds: allImmediateLayers('fury-swipes.v2-one-hit'),
    duplicateReplayScenarioIds: ['fury-swipes.v2-five-hit-critical'],
  },
  {
    canonicalId: 'Helping Hand',
    runtimeKind: 'movespec-v2',
    scenarios: HELPING_HAND_V2_SEMANTIC_SCENARIOS,
    executionScenarioIds: allImmediateLayers('helping-hand.v2-qualifying-consume'),
    duplicateReplayScenarioIds: ['helping-hand.v2-duplicate-replay'],
  },
  {
    canonicalId: 'Howl',
    runtimeKind: 'legacy-v1',
    scenarios: HOWL_ALLY_AREA_SCENARIOS,
    executionScenarioIds: allImmediateLayers('howl.legacy-v1-mixed-sides'),
    duplicateReplayScenarioIds: ['howl.legacy-v1-duplicate-replay'],
  },
  {
    canonicalId: 'Knock Off',
    runtimeKind: 'movespec-v2',
    scenarios: KNOCK_OFF_V2_SEMANTIC_SCENARIOS,
    executionScenarioIds: allImmediateLayers('knock-off.v2-hit-choice'),
    duplicateReplayScenarioIds: [
      'knock-off.v2-duplicate-declaration',
      'knock-off.v2-duplicate-response',
    ],
    reconnectScenarioId: 'knock-off.v2-reconnect',
  },
  {
    canonicalId: 'Pin Missile',
    runtimeKind: 'movespec-v2',
    scenarios: PIN_MISSILE_REG_019_SCENARIOS,
    executionScenarioIds: allImmediateLayers('pin-missile.v2-one-hit'),
    duplicateReplayScenarioIds: ['pin-missile.v2-five-hit-critical'],
  },
  {
    canonicalId: 'Reflect',
    runtimeKind: 'movespec-v2',
    scenarios: REFLECT_V2_SEMANTIC_SCENARIOS,
    executionScenarioIds: allImmediateLayers('reflect.v2-side-application'),
    duplicateReplayScenarioIds: ['reflect.v2-duplicate-replay'],
  },
  {
    canonicalId: 'Sand Tomb',
    runtimeKind: 'movespec-v2',
    scenarios: SAND_TOMB_V2_SEMANTIC_SCENARIOS,
    executionScenarioIds: allImmediateLayers('sand-tomb.v2-hit'),
    duplicateReplayScenarioIds: ['sand-tomb.v2-replacement-retry'],
  },
  {
    canonicalId: 'Tackle',
    runtimeKind: 'movespec-v2',
    scenarios: TACKLE_REG_030_SCENARIOS,
    executionScenarioIds: allImmediateLayers('tackle.v2-hit-push'),
    duplicateReplayScenarioIds: ['tackle.v2-duplicate-retry'],
  },
  {
    canonicalId: 'Take Down',
    runtimeKind: 'movespec-v2',
    scenarios: TAKE_DOWN_V2_SEMANTIC_SCENARIOS,
    executionScenarioIds: allImmediateLayers('take-down.v2-pass'),
    duplicateReplayScenarioIds: ['take-down.v2-duplicate-retry'],
    reconnectScenarioId: 'take-down.v2-reconnect',
  },
  {
    canonicalId: 'U-Turn',
    runtimeKind: 'movespec-v2',
    scenarios: U_TURN_V2_SEMANTIC_SCENARIOS,
    executionScenarioIds: allImmediateLayers('u-turn.v2-hit-switch'),
    duplicateReplayScenarioIds: ['u-turn.v2-duplicate-retry'],
    reconnectScenarioId: 'u-turn.v2-reconnect',
  },
  {
    canonicalId: 'Yawn',
    runtimeKind: 'movespec-v2',
    scenarios: YAWN_V2_SEMANTIC_SCENARIOS,
    executionScenarioIds: allImmediateLayers('yawn.v2-delayed-sleep'),
    duplicateReplayScenarioIds: ['yawn.v2-refresh-retry'],
  },
] as const satisfies readonly RepairedMoveCertification[])

const normalizedEvidence = (
  scenarios: readonly SemanticEvidenceReference[],
): readonly SemanticEvidenceReference[] => scenarios
  .map(scenario => ({
    scenarioId: scenario.scenarioId,
    evidenceClasses: [...scenario.evidenceClasses].sort(),
  }))
  .sort((left, right) => left.scenarioId.localeCompare(right.scenarioId))

describe('repaired registered move certification', () => {
  it('covers every script repaired by MA-170 through MA-180 exactly once', () => {
    expect(REPAIRED_MOVE_CERTIFICATIONS.map(({ canonicalId }) => canonicalId)).toEqual([
      'Aromatic Mist',
      'Astonish',
      'Coaching',
      'Fake Out',
      'Fury Attack',
      'Fury Cutter',
      'Fury Swipes',
      'Helping Hand',
      'Howl',
      'Knock Off',
      'Pin Missile',
      'Reflect',
      'Sand Tomb',
      'Tackle',
      'Take Down',
      'U-Turn',
      'Yawn',
    ])
    expect(new Set(
      REPAIRED_MOVE_CERTIFICATIONS.map(({ canonicalId }) => canonicalId),
    ).size).toBe(REPAIRED_MOVE_CERTIFICATIONS.length)

    const scenarioIds = REPAIRED_MOVE_CERTIFICATIONS.flatMap(({ scenarios }) => (
      scenarios.map(({ scenarioId }) => scenarioId)
    ))
    expect(new Set(scenarioIds).size).toBe(scenarioIds.length)
  })

  it.each(REPAIRED_MOVE_CERTIFICATIONS)(
    'certifies $canonicalId as debt-free with linked authority and recovery evidence',
    (certification) => {
      const row = manifestJson.moves.find(
        candidate => candidate.canonicalId === certification.canonicalId,
      )
      expect(row, certification.canonicalId).toBeDefined()
      if (!row) return

      expect(row).toMatchObject({
        baseStatus: 'complete',
        blockerCodes: [],
        limitations: [],
        manualSteps: [],
        reviewedAt: expect.any(String),
        runtime: { kind: certification.runtimeKind },
      })
      expect([...row.scenarioIds].sort()).toEqual(
        certification.scenarios.map(({ scenarioId }) => scenarioId).sort(),
      )
      expect(normalizedEvidence(row.conformanceEvidence.scenarios)).toEqual(
        normalizedEvidence(certification.scenarios),
      )

      const runtime = registeredMoveAutomationRuntimeFor(certification.canonicalId)
      expect(runtime, certification.canonicalId).toMatchObject({
        canonicalId: certification.canonicalId,
        kind: certification.runtimeKind,
        version: row.runtime.version,
        definitionHash: row.runtime.definitionHash,
        sourceModule: row.runtime.sourceModule,
      })

      const linkedScenarioIds = new Set(row.scenarioIds)
      for (const [layer, scenarioId] of Object.entries(certification.executionScenarioIds)) {
        expect(linkedScenarioIds.has(scenarioId), `${certification.canonicalId} ${layer}`).toBe(true)
      }

      expect(row.conformanceEvidence.requirementTags).toContain('recovery.retry')
      const evidenceByScenario = new Map(
        row.conformanceEvidence.scenarios.map(scenario => [
          scenario.scenarioId,
          new Set(scenario.evidenceClasses),
        ]),
      )
      for (const scenarioId of certification.duplicateReplayScenarioIds) {
        expect(evidenceByScenario.get(scenarioId), scenarioId).toContain('retry')
      }

      if (certification.reconnectScenarioId !== undefined) {
        expect(row.conformanceEvidence.requirementTags).toContain('recovery.reconnect')
        expect(
          evidenceByScenario.get(certification.reconnectScenarioId),
          certification.reconnectScenarioId,
        ).toContain('reconnect')
      }
      else {
        expect(row.conformanceEvidence.requirementTags).not.toContain('recovery.reconnect')
      }
    },
  )
})
