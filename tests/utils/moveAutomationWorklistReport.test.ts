import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

describe('move automation worklist report', () => {
  it('prints planning buckets without failing incomplete coverage', () => {
    const result = spawnSync('python3', ['scripts/check_move_automation_coverage.py', '--report'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    })

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Move automation worklist report')
    expect(result.stdout).toContain('Canonical valid move count: 776')
    expect(result.stdout).toContain('Explicit script count: 241')
    expect(result.stdout).toContain('Missing script count: 535')
    expect(result.stdout).toContain('plain-single-target-damage (')
    expect(result.stdout).toContain('complex-review-needed (')
    expect(result.stdout).toContain('Recommended next safest batch (')

    const recommendedMatch = result.stdout.match(/\nRecommended next safest batch \((\d+) moves\):\n([\s\S]*)$/)
    expect(recommendedMatch).not.toBeNull()
    expect(Number(recommendedMatch?.[1] ?? '0')).toBeGreaterThan(0)
    const recommendedSection = recommendedMatch?.[2] ?? ''
    expect(recommendedSection).toContain('  - Decorate')
    for (const moveName of ['Frost Breath', 'Storm Throw', 'Spacial Rend', 'Aura Wheel', 'Hammer Arm', 'Ice Hammer', 'Topsy-Turvy']) {
      expect(recommendedSection).not.toContain(`  - ${moveName}`)
    }
  })
})
