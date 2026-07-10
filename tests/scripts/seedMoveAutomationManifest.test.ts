import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import legacyFingerprintsJson from '../../data/move-automation/legacy-v1-fingerprints.json'
import { EXPLICIT_MOVE_AUTOMATION_SCRIPTS } from '../../src/utils/move-automation/registry'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const WORKLIST_BUCKETS = new Set([
  'plain-single-target-damage',
  'single-target-status',
  'single-target-stage',
  'single-target-secondary-condition',
  'single-target-secondary-stage',
  'plain-area-damage',
  'area-condition-or-stage',
  'hp-heal-drain-recoil-cost',
  'direct-hp-loss',
  'dynamic-damage-base',
  'field-weather-terrain-room',
  'hazard',
  'persistent-marker-or-delayed-effect',
  'movement-positioning',
  'item-inventory',
  'copy-random-move-list',
  'reaction-interrupt-shield',
  'complex-review-needed',
])

type MutableManifest = {
  schemaVersion: number
  moves: Array<Record<string, unknown>>
}

const runSeed = (outputPath: string) => spawnSync(
  'python3',
  ['scripts/seed_move_automation_manifest.py', '--output', outputPath],
  {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  },
)

const withTemporaryManifest = (test: (manifestPath: string) => void): void => {
  const directory = mkdtempSync(join(tmpdir(), 'rotom-move-manifest-'))
  try {
    test(join(directory, 'manifest.json'))
  }
  finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

describe('move automation semantic manifest seed script', () => {
  it('generates byte-stable bootstrap data', () => {
    withTemporaryManifest((manifestPath) => {
      const secondManifestPath = join(dirname(manifestPath), 'second-manifest.json')
      const firstRun = runSeed(manifestPath)
      const independentRun = runSeed(secondManifestPath)
      expect(firstRun.status, `${firstRun.stdout}\n${firstRun.stderr}`).toBe(0)
      expect(independentRun.status, `${independentRun.stdout}\n${independentRun.stderr}`).toBe(0)
      const firstBytes = readFileSync(manifestPath)
      expect(readFileSync(secondManifestPath)).toEqual(firstBytes)

      const rerun = runSeed(manifestPath)
      expect(rerun.status, `${rerun.stdout}\n${rerun.stderr}`).toBe(0)
      expect(readFileSync(manifestPath)).toEqual(firstBytes)
    })
  }, 15_000)

  it('seeds exact registry-aware statuses without treating heuristic tags as capabilities', () => {
    withTemporaryManifest((manifestPath) => {
      const result = runSeed(manifestPath)
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
      const seeded = JSON.parse(readFileSync(manifestPath, 'utf8')) as typeof manifestJson
      const registeredIds = new Set(EXPLICIT_MOVE_AUTOMATION_SCRIPTS.keys())
      const legacyRuntimeById = new Map(legacyFingerprintsJson.entries.map(entry => [
        entry.canonicalId,
        {
          kind: 'legacy-v1',
          version: entry.version,
          definitionHash: entry.definitionHash,
          sourceModule: entry.sourceModule,
        },
      ]))
      const manifestIds = seeded.moves.map(({ canonicalId }) => canonicalId)
      const assisted = seeded.moves.filter(({ baseStatus }) => baseStatus === 'assisted')
      const blocked = seeded.moves.filter(({ baseStatus }) => baseStatus === 'blocked')

      expect(seeded.moves).toHaveLength(776)
      expect(new Set(manifestIds).size).toBe(776)
      expect(assisted).toHaveLength(registeredIds.size)
      expect(blocked).toHaveLength(776 - registeredIds.size)

      for (const row of seeded.moves) {
        expect(row.capabilityTags).toEqual([])
        expect(row.conformanceEvidence).toEqual({
          requirementTags: [],
          scenarios: [],
          notApplicable: [],
        })
        if (registeredIds.has(row.canonicalId)) {
          expect(row).toMatchObject({
            baseStatus: 'assisted',
            runtime: {
              kind: 'legacy-v1',
              version: expect.any(Number),
              definitionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
              sourceModule: expect.stringMatching(/^src\/utils\/move-automation\/scripts\/.+\.ts$/),
            },
            suggestedCapabilityTags: [],
            blockerCodes: [],
            limitations: [{ code: 'audit.required' }],
          })
          expect(row.runtime).toEqual(legacyRuntimeById.get(row.canonicalId))
        }
        else {
          expect(row).toMatchObject({
            baseStatus: 'blocked',
            runtime: { kind: 'unimplemented' },
            blockerCodes: ['runtime.unimplemented'],
            limitations: [],
          })
          expect(row.suggestedCapabilityTags).toHaveLength(1)
          expect(WORKLIST_BUCKETS.has(row.suggestedCapabilityTags[0])).toBe(true)
        }
      }

      expect(seeded.moves.find(({ canonicalId }) => canonicalId === 'Hyper Beam')?.suggestedCapabilityTags)
        .toEqual(['plain-single-target-damage'])
      expect(seeded.moves.find(({ canonicalId }) => canonicalId === 'Protect')?.suggestedCapabilityTags)
        .toEqual(['reaction-interrupt-shield'])
    })
  })

  it('preserves existing semantic statuses when rerun', () => {
    withTemporaryManifest((manifestPath) => {
      const existing = structuredClone(manifestJson) as unknown as MutableManifest
      const scratch = existing.moves.find(({ canonicalId }) => canonicalId === 'Scratch')
      expect(scratch).toBeDefined()
      Object.assign(scratch!, {
        baseStatus: 'complete',
        interactionStatus: 'unassessed',
        runtime: {
          kind: 'legacy-v1',
          version: 1,
          definitionHash: 'a'.repeat(64),
          sourceModule: 'src/utils/move-automation/scripts/singleTargetAttacks.ts',
        },
        blockerCodes: [],
        limitations: [],
        manualSteps: [],
        scenarioIds: ['scratch.hit'],
        conformanceEvidence: {
          requirementTags: ['target.enemy'],
          scenarios: [{ scenarioId: 'scratch.hit', evidenceClasses: ['enemy'] }],
          notApplicable: [],
        },
        reviewedAt: '2026-07-10',
      })
      writeFileSync(manifestPath, `${JSON.stringify(existing, null, 2)}\n`)
      const statusesBefore = new Map(existing.moves.map((row) => [row.canonicalId, row.baseStatus]))

      const result = runSeed(manifestPath)
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
      const updated = JSON.parse(readFileSync(manifestPath, 'utf8')) as MutableManifest
      const statusesAfter = new Map(updated.moves.map((row) => [row.canonicalId, row.baseStatus]))

      expect(statusesAfter).toEqual(statusesBefore)
      expect(updated.moves.find(({ canonicalId }) => canonicalId === 'Scratch')).toEqual(scratch)
    })
  })
})
