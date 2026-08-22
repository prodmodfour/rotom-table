import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const documents = [
  'docs/contests/README.md',
  'docs/contests/player-and-gm-guide.md',
  'docs/contests/architecture-and-api.md',
  'docs/contests/canonical-data-maintenance.md',
  'docs/contests/operations-recovery.md',
  'docs/contests/accessibility-and-acceptance.md',
  'docs/adrs/019-authoritative-pokemon-contest-runtime.md',
]

describe('Pokémon Contest documentation closure', () => {
  it('retains all audience guides and names critical authority/recovery contracts', () => {
    for (const path of documents) expect(read(path).length, path).toBeGreaterThan(500)
    const corpus = documents.map(read).join('\n')
    for (const phrase of ['server-generated and journaled','Exact retry','public, owner, GM, and diagnostic','backup','320px','created Move','Supercontest','Festival','Rotation','Ribbon status unavailable']) expect(corpus.toLowerCase()).toContain(phrase.toLowerCase())
    expect(read('src/components/sheets/TrainerContestHistoryPanel.vue')).toContain('Ribbon status unavailable')
  })

  it('registers deterministic checks in package and the repository quality gate', () => {
    expect(read('package.json')).toContain('check:pokemon-contests')
    expect(read('scripts/quality-gate.sh')).toContain('npm run check:pokemon-contests')
    expect(read('docs/contests/canonical-data-maintenance.md')).toContain('migrate_pokemon_contests.py --check')
  })
})
