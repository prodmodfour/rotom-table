import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import {
  MOVE_AUTOMATION_MANIFEST_LIMITS,
  MoveAutomationManifestValidationError,
  parseMoveAutomationManifest,
  type MoveAutomationManifestValidationCode,
} from '#shared/moveAutomation/manifest'
import {
  loadCanonicalMoveCatalog,
  type CanonicalMoveCatalog,
} from '#shared/moveAutomation/ruleset'

const movesPath = join(process.cwd(), 'data', 'reference', 'moves.json')
const DEFINITION_HASH = 'a'.repeat(64)

let catalog: CanonicalMoveCatalog

beforeAll(async () => {
  catalog = await loadCanonicalMoveCatalog(readFileSync(movesPath))
})

const provenanceReference = () => ({
  rulesetId: catalog.rulesetId,
  canonicalizationVersion: catalog.canonicalizationVersion,
  sourceDataSha256: catalog.sourceDataSha256,
})

const completeScratchRecord = () => ({
  canonicalId: 'Scratch',
  displayName: 'Scratch',
  baseStatus: 'complete',
  interactionStatus: 'complete',
  runtime: {
    kind: 'legacy-v1',
    version: 1,
    definitionHash: DEFINITION_HASH,
    sourceModule: 'src/utils/move-automation/scripts/singleTargetAttacks.ts',
  },
  rulesProvenance: provenanceReference(),
  capabilityTags: ['targeting.authoritative', 'hp.typed'],
  suggestedCapabilityTags: [],
  blockerCodes: [],
  limitations: [],
  manualSteps: [],
  scenarioIds: ['scratch.hit'],
  reviewedAt: '2026-07-10',
  unsupportedInteractionIds: [],
  rolloutCohortId: 'reg-024',
})

const blockedTackleRecord = () => ({
  ...completeScratchRecord(),
  canonicalId: 'Tackle',
  displayName: 'Tackle',
  baseStatus: 'blocked',
  interactionStatus: 'unassessed',
  runtime: {
    kind: 'unimplemented',
    version: null,
    definitionHash: null,
    sourceModule: null,
  },
  capabilityTags: [],
  blockerCodes: ['runtime.unimplemented'],
  scenarioIds: [],
  reviewedAt: null,
  rolloutCohortId: null,
})

const manifestWith = (...moves: unknown[]) => ({ schemaVersion: 1, moves })

const expectManifestError = (
  value: unknown,
  code: MoveAutomationManifestValidationCode,
  path?: string,
): void => {
  try {
    parseMoveAutomationManifest(value, catalog)
    expect.unreachable(`Expected ${code}`)
  }
  catch (error) {
    expect(error).toBeInstanceOf(MoveAutomationManifestValidationError)
    expect((error as MoveAutomationManifestValidationError).code).toBe(code)
    if (path) expect((error as MoveAutomationManifestValidationError).path).toBe(path)
  }
}

describe('move automation semantic manifest contract', () => {
  it('loads the exact sorted canonical inventory', () => {
    const manifest = parseMoveAutomationManifest(manifestJson, catalog)
    const canonicalIds = catalog.moves.map(({ canonicalId }) => canonicalId)
    const manifestIds = manifest.moves.map(({ canonicalId }) => canonicalId)

    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.moves).toHaveLength(776)
    expect(manifestIds).toEqual(canonicalIds)
    expect(new Set(manifestIds).size).toBe(776)
  })

  it('keeps base completeness separate from explicitly partial ecosystem interactions', () => {
    const record = {
      ...completeScratchRecord(),
      interactionStatus: 'partial',
      unsupportedInteractionIds: ['ability.wonder-guard', 'item.focus-sash'],
    }

    const manifest = parseMoveAutomationManifest(manifestWith(record), catalog)

    expect(manifest.moves[0]).toMatchObject({
      canonicalId: 'Scratch',
      baseStatus: 'complete',
      interactionStatus: 'partial',
      unsupportedInteractionIds: ['ability.wonder-guard', 'item.focus-sash'],
    })
  })

  it('rejects unknown fields at every contract level', () => {
    expectManifestError(
      { ...manifestWith(completeScratchRecord()), extra: true },
      'invalid-manifest',
      'manifest',
    )
    expectManifestError(
      manifestWith({ ...completeScratchRecord(), extra: true }),
      'invalid-manifest',
      'moves[0]',
    )
    expectManifestError(
      manifestWith({
        ...completeScratchRecord(),
        runtime: { ...completeScratchRecord().runtime, executable: true },
      }),
      'invalid-manifest',
      'moves[0].runtime',
    )
    expectManifestError(
      manifestWith({
        ...completeScratchRecord(),
        limitations: [{ code: 'manual.audit', summary: 'Needs review.', extra: true }],
      }),
      'invalid-manifest',
      'moves[0].limitations[0]',
    )
  })

  it('rejects duplicate and unknown canonical identities', () => {
    expectManifestError(
      manifestWith(completeScratchRecord(), completeScratchRecord()),
      'duplicate-move',
      'manifest.moves',
    )
    expectManifestError(
      manifestWith({
        ...blockedTackleRecord(),
        canonicalId: 'Not A Canonical Move',
        displayName: 'Not A Canonical Move',
      }),
      'unknown-move',
      'moves[0].canonicalId',
    )
    expectManifestError(
      manifestWith({ ...blockedTackleRecord(), displayName: 'tackle' }),
      'unknown-move',
      'moves[0].displayName',
    )
  })

  it('requires every row to reference the loaded rules provenance exactly', () => {
    expectManifestError(
      manifestWith({
        ...blockedTackleRecord(),
        rulesProvenance: {
          ...provenanceReference(),
          sourceDataSha256: 'b'.repeat(64),
        },
      }),
      'provenance-mismatch',
      'moves[0].rulesProvenance',
    )
  })

  it('requires complete rows to be debt-free, linked, and backed by scenarios', () => {
    const invalidCompleteRows = [
      { ...completeScratchRecord(), blockerCodes: ['runtime.unimplemented'] },
      {
        ...completeScratchRecord(),
        limitations: [{ code: 'timing.partial', summary: 'Timing remains partial.' }],
      },
      {
        ...completeScratchRecord(),
        manualSteps: [{ code: 'gm.apply', summary: 'The GM applies the condition.' }],
      },
      { ...completeScratchRecord(), scenarioIds: [] },
      {
        ...completeScratchRecord(),
        runtime: { kind: 'unimplemented', version: null, definitionHash: null, sourceModule: null },
      },
      {
        ...completeScratchRecord(),
        runtime: { ...completeScratchRecord().runtime, definitionHash: null },
      },
    ]

    for (const record of invalidCompleteRows) {
      expectManifestError(manifestWith(record), 'invalid-status-combination')
    }
  })

  it('requires assisted and blocked statuses to state their semantic debt truthfully', () => {
    expectManifestError(
      manifestWith({ ...blockedTackleRecord(), blockerCodes: [] }),
      'invalid-status-combination',
      'moves[0].blockerCodes',
    )
    expectManifestError(
      manifestWith({
        ...completeScratchRecord(),
        baseStatus: 'assisted',
      }),
      'invalid-status-combination',
      'moves[0]',
    )
    expectManifestError(
      manifestWith({
        ...completeScratchRecord(),
        baseStatus: 'assisted',
        limitations: [{ code: 'audit.required', summary: 'Semantic review is still required.' }],
        runtime: { kind: 'unimplemented', version: null, definitionHash: null, sourceModule: null },
      }),
      'invalid-status-combination',
      'moves[0].runtime',
    )
    expectManifestError(
      manifestWith({
        ...completeScratchRecord(),
        baseStatus: 'assisted',
        limitations: [{ code: 'audit.required', summary: 'Semantic review is still required.' }],
        runtime: { kind: 'legacy-v1', version: null, definitionHash: null, sourceModule: null },
      }),
      'invalid-status-combination',
      'moves[0].runtime',
    )
  })

  it('keeps interaction status and unsupported interaction IDs consistent', () => {
    expectManifestError(
      manifestWith({
        ...completeScratchRecord(),
        interactionStatus: 'partial',
      }),
      'invalid-status-combination',
      'moves[0].unsupportedInteractionIds',
    )
    expectManifestError(
      manifestWith({
        ...completeScratchRecord(),
        interactionStatus: 'unassessed',
        unsupportedInteractionIds: ['ability.wonder-guard'],
      }),
      'invalid-status-combination',
      'moves[0].unsupportedInteractionIds',
    )
    expectManifestError(
      manifestWith({
        ...blockedTackleRecord(),
        interactionStatus: 'complete',
      }),
      'invalid-status-combination',
      'moves[0].interactionStatus',
    )
  })

  it('requires reviewed capability tags and blockers to resolve to the typed catalog', () => {
    expectManifestError(
      manifestWith({
        ...completeScratchRecord(),
        capabilityTags: ['targeting.unknown'],
      }),
      'unknown-capability',
      'moves[0].capabilityTags[0]',
    )
    expectManifestError(
      manifestWith({
        ...blockedTackleRecord(),
        blockerCodes: ['runtime.unknown'],
      }),
      'unknown-capability',
      'moves[0].blockerCodes[0]',
    )
  })

  it('rejects duplicate metadata IDs and unbounded strings or arrays', () => {
    expectManifestError(
      manifestWith({
        ...completeScratchRecord(),
        scenarioIds: ['scratch.hit', 'scratch.hit'],
      }),
      'invalid-manifest',
      'moves[0].scenarioIds',
    )
    expectManifestError(
      manifestWith({
        ...blockedTackleRecord(),
        limitations: [{
          code: 'audit.required',
          summary: 'x'.repeat(MOVE_AUTOMATION_MANIFEST_LIMITS.summaryLength + 1),
        }],
      }),
      'limit-exceeded',
      'moves[0].limitations[0].summary',
    )
    expectManifestError(
      manifestWith({
        ...blockedTackleRecord(),
        suggestedCapabilityTags: Array.from(
          { length: MOVE_AUTOMATION_MANIFEST_LIMITS.suggestedCapabilityTags + 1 },
          (_, index) => `hint-${index}`,
        ),
      }),
      'limit-exceeded',
      'moves[0].suggestedCapabilityTags',
    )
  })

  it('rejects malformed hashes, dates, identifiers, and runtime versions', () => {
    expectManifestError(
      manifestWith({ ...blockedTackleRecord(), reviewedAt: '2026-02-30' }),
      'invalid-manifest',
      'moves[0].reviewedAt',
    )
    expectManifestError(
      manifestWith({ ...blockedTackleRecord(), blockerCodes: ['Not Stable'] }),
      'invalid-manifest',
      'moves[0].blockerCodes[0]',
    )
    expectManifestError(
      manifestWith({
        ...completeScratchRecord(),
        runtime: { ...completeScratchRecord().runtime, version: 0 },
      }),
      'invalid-manifest',
      'moves[0].runtime.version',
    )
    expectManifestError(
      manifestWith({
        ...completeScratchRecord(),
        runtime: { ...completeScratchRecord().runtime, definitionHash: 'ABC' },
      }),
      'invalid-manifest',
      'moves[0].runtime.definitionHash',
    )
  })
})
