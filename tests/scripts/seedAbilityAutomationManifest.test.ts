import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import manifestJson from '../../data/ability-automation/manifest.json'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

type MutableManifest = {
  schemaVersion: number
  abilities: Array<Record<string, unknown>>
}

const runSeed = (outputPath: string) => spawnSync(
  'python3',
  ['scripts/seed_ability_automation_manifest.py', '--output', outputPath],
  {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  },
)

const withTemporaryManifest = (test: (manifestPath: string) => void): void => {
  const directory = mkdtempSync(join(tmpdir(), 'rotom-ability-manifest-'))
  try {
    test(join(directory, 'manifest.json'))
  }
  finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

describe('ability automation semantic manifest seed script', () => {
  it('generates byte-stable data matching the tracked bootstrap manifest', () => {
    withTemporaryManifest((manifestPath) => {
      const secondPath = join(dirname(manifestPath), 'second.json')
      const first = runSeed(manifestPath)
      const independent = runSeed(secondPath)
      expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0)
      expect(independent.status, `${independent.stdout}\n${independent.stderr}`).toBe(0)
      const firstBytes = readFileSync(manifestPath)
      expect(readFileSync(secondPath)).toEqual(firstBytes)
      expect(firstBytes).toEqual(readFileSync(join(repoRoot, 'data/ability-automation/manifest.json')))

      const rerun = runSeed(manifestPath)
      expect(rerun.status, `${rerun.stdout}\n${rerun.stderr}`).toBe(0)
      expect(readFileSync(manifestPath)).toEqual(firstBytes)
    })
  })

  it('seeds truthful blocked rows with planning-only mode hints and deterministic cohorts', () => {
    withTemporaryManifest((manifestPath) => {
      const result = runSeed(manifestPath)
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as typeof manifestJson
      const identities = manifest.abilities.map(ability => ability.canonicalId)
      const modeCounts = manifest.abilities.reduce<Record<string, number>>((counts, ability) => {
        const mode = ability.suggestedCapabilityTags[0]!
        counts[mode] = (counts[mode] ?? 0) + 1
        return counts
      }, {})

      expect(manifest.schemaVersion).toBe(1)
      expect(manifest.abilities).toHaveLength(483)
      expect(new Set(identities).size).toBe(483)
      expect(identities).toEqual([...identities].sort())
      expect(modeCounts).toEqual({
        'mode.static': 243,
        'mode.triggered': 120,
        'mode.activated': 120,
      })
      for (const ability of manifest.abilities) {
        expect(ability).toMatchObject({
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
          limitations: [],
          manualSteps: [],
          scenarioIds: [],
          reviewedAt: null,
          unsupportedInteractionIds: [],
        })
      }
      expect(manifest.abilities[0]?.rolloutCohortId).toBe('aa-060')
      expect(manifest.abilities.at(-1)?.rolloutCohortId).toBe('aa-100')
    })
  })

  it('preserves every existing reviewed row when rerun', () => {
    withTemporaryManifest((manifestPath) => {
      const existing = structuredClone(manifestJson) as unknown as MutableManifest
      const abominable = existing.abilities.find(row => row.canonicalId === 'Abominable')!
      Object.assign(abominable, {
        baseStatus: 'complete',
        runtime: {
          kind: 'abilityspec-v1',
          version: 1,
          definitionHash: 'a'.repeat(64),
          sourceModule: 'server/domain/abilityAutomation/specs/abominable.ts',
        },
        capabilityTags: ['mode.static'],
        suggestedCapabilityTags: [],
        blockerCodes: [],
        scenarioIds: ['abominable.static-provider'],
        conformanceEvidence: {
          requirementTags: ['mode.static'],
          scenarios: [{
            scenarioId: 'abominable.static-provider',
            evidenceClasses: ['passive-applied', 'passive-suppressed'],
          }],
          notApplicable: [],
        },
        reviewedAt: '2026-07-09',
      })
      writeFileSync(manifestPath, `${JSON.stringify(existing, null, 2)}\n`)

      const result = runSeed(manifestPath)
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
      const updated = JSON.parse(readFileSync(manifestPath, 'utf8')) as MutableManifest
      expect(updated.abilities.find(row => row.canonicalId === 'Abominable')).toEqual(abominable)
      expect(updated.abilities).toHaveLength(483)
    })
  })

  it('fails closed on malformed existing rows instead of silently replacing them', () => {
    withTemporaryManifest((manifestPath) => {
      writeFileSync(manifestPath, JSON.stringify({
        schemaVersion: 1,
        abilities: [{ canonicalId: 'Abominable' }],
      }))
      const result = runSeed(manifestPath)

      expect(result.status).toBe(1)
      expect(result.stdout).toContain('invalid shape')
    })
  })
})
