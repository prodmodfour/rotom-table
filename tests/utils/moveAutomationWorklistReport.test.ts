import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const runCoverageChecker = (...args: string[]) => spawnSync(
  'python3',
  ['scripts/check_move_automation_coverage.py', ...args],
  {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  },
)

type SemanticCoverageOutput = {
  catalog: { canonicalMoves: number }
  manifestMoves: number
  registry: { explicitLegacyScripts: number }
  valid: boolean
}

describe('move automation worklist report', () => {
  it('prints planning buckets with totals derived from the validated manifest', () => {
    const semanticResult = runCoverageChecker('--json')
    expect(semanticResult.status, `${semanticResult.stdout}\n${semanticResult.stderr}`).toBe(0)
    expect(semanticResult.stderr).toBe('')
    const semantic = JSON.parse(semanticResult.stdout) as SemanticCoverageOutput
    expect(semantic.valid).toBe(true)
    expect(semantic.manifestMoves).toBe(semantic.catalog.canonicalMoves)

    const result = runCoverageChecker('--worklist')
    const missingScriptCount = semantic.catalog.canonicalMoves
      - semantic.registry.explicitLegacyScripts

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Move automation heuristic prose classification (informational only)')
    expect(result.stdout).toContain('not a progress tracker or implementation queue')
    expect(result.stdout).toContain(`Canonical valid move count: ${semantic.catalog.canonicalMoves}`)
    expect(result.stdout).toContain(`Explicit script count: ${semantic.registry.explicitLegacyScripts}`)
    expect(result.stdout).toContain(`Missing script count: ${missingScriptCount}`)
    expect(result.stdout).toContain('plain-single-target-damage (')
    expect(result.stdout).toContain('complex-review-needed (')
    expect(result.stdout).toContain('Informational candidate sample (')

    const recommendedMatch = result.stdout.match(
      /\nInformational candidate sample \((\d+) moves; not an implementation queue\):\n([\s\S]*)$/,
    )
    expect(recommendedMatch).not.toBeNull()
    expect(Number(recommendedMatch?.[1] ?? '0')).toBeGreaterThanOrEqual(0)
    const recommendedSection = recommendedMatch?.[2] ?? ''
    for (const moveName of [
      'Spore',
      'Earth Power',
      'Chatter',
      'Dragon Hammer',
      'Frost Breath',
      'Storm Throw',
      'Spacial Rend',
      'Aura Wheel',
      'Hammer Arm',
      'Ice Hammer',
      'Topsy-Turvy',
    ]) {
      expect(recommendedSection).not.toContain(`  - ${moveName}`)
    }
  })
})
