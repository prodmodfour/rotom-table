import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import contests from '../../data/reference/contests.json'
import inventory from '../../data/deferred-closure/closure-inventory.v1.json'
import packageJson from '../../package.json'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8')
const documentationPaths = [
  'docs/deferred-mechanics-closure.md',
  'docs/complete-play-loop-contributor-guide.md',
  'docs/complete-play-loop-operator-guide.md',
  'docs/complete-play-loop-gm-guide.md',
  'docs/complete-play-loop-player-guide.md',
  'docs/skill-check-recovery-and-campaign-history.md',
  'docs/contests/README.md',
  'docs/contests/player-and-gm-guide.md',
  'docs/contests/trainer-participant-runtime.md',
  'docs/contests/battle-contest-runtime.md',
  'docs/adrs/019-authoritative-pokemon-contest-runtime.md',
  'docs/README.md',
] as const

const userFacingRows = inventory.rows.filter(row => (
  row.id.startsWith('weapon-profile.')
  || row.id.startsWith('weapon-move.')
  || row.id.startsWith('item-action.')
  || row.id === 'runtime.generic-skill-check'
  || row.id.startsWith('contest-variant.')
))

const markdownLinks = (path: string): readonly string[] => [...read(path).matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)]
  .map(match => match[1]!)
  .filter(target => !/^(?:https?:|mailto:|#)/u.test(target))
  .map(target => target.split('#', 1)[0]!)
  .filter(Boolean)

const documentedCommands = (path: string): readonly string[] => [...read(path).matchAll(/npm run ([a-z0-9:-]+)/gu)]
  .map(match => match[1]!)

describe('P11-087 Deferred Mechanics Closure documentation', () => {
  it('documents every closed user-facing row and current native Contest status', () => {
    const overview = read('docs/deferred-mechanics-closure.md')
    expect(userFacingRows).toHaveLength(27)
    for (const row of userFacingRows) {
      const visibleIdentity = row.id === 'runtime.generic-skill-check'
        ? 'Generic Skill Checks'
        : row.id.startsWith('contest-variant.')
          ? row.id.endsWith('trainer-participant') ? 'Trainer Participant' : 'Battle Contests'
          : row.id.startsWith('weapon-move.') && 'canonicalId' in row && typeof row.canonicalId === 'string'
            ? row.canonicalId
            : 'canonicalItem' in row && typeof row.canonicalItem === 'string'
              ? row.canonicalItem
              : null
      expect(visibleIdentity, row.id).not.toBeNull()
      expect(overview, row.id).toContain(visibleIdentity!)
    }
    expect(contests.variants.map(row => [row.id, row.completionState])).toEqual([
      ['standard', 'native'],
      ['supercontest', 'native'],
      ['festival', 'native'],
      ['rotation', 'native'],
      ['trainer-participant', 'native'],
      ['battle', 'native'],
    ])
    for (const phrase of ['All twelve supplemental weapon Moves', 'one through 32', 'equal teams of three through six', 'Independent **Finish Encounter** is intentionally blocked']) {
      expect(overview).toContain(phrase)
    }
  })

  it('updates contributor, operator, GM, and player runbooks with authoritative behavior and recovery', () => {
    const contributor = read('docs/complete-play-loop-contributor-guide.md')
    for (const claim of ['all twelve supplemental weapon Moves', 'schema-v50', 'typed immutable facts', 'accepted successor-chain continuity']) expect(contributor).toContain(claim)

    const operator = read('docs/complete-play-loop-operator-guide.md')
    for (const claim of ['current application schema is 50', 'refuses an unknown future version without writing', 'linked Battle Contest/Encounter', 'never repair SQLite or JSON manually']) expect(operator).toContain(claim)

    const gm = read('docs/complete-play-loop-gm-guide.md')
    for (const claim of ['Ranged weapons, weapon Moves, and item actions', 'Generic Skill Checks', 'one through 32', 'Trainer Participant and Battle Contests', 'Independent **Finish Encounter**']) expect(gm).toContain(claim)

    const player = read('docs/complete-play-loop-player-guide.md')
    for (const claim of ['Weighted Rope', 'generic Skill Check', 'Trainer Participant Contest', 'Battle Contest', 'Opponents and spectators']) expect(player).toContain(claim)

    const skillChecks = read('docs/skill-check-recovery-and-campaign-history.md')
    expect(skillChecks).toContain('The browser submits strict intent and issued identities, never a roll, total, winner, or correction result.')
    expect(read('docs/contests/player-and-gm-guide.md')).toContain('Trainer Participant:')
    expect(read('docs/contests/player-and-gm-guide.md')).toContain('Battle:')
  })

  it('retires the exact stale deferred-state claims without conflating durable deferred transactions', () => {
    const allDocs = documentationPaths.map(path => read(path)).join('\n')
    for (const stale of [
      'Trainer Participant and Battle Contest are intentionally not selectable',
      'Trainer Participant and Battle Contest remain unavailable',
      'Schema 44 is the current Complete Play Loop baseline',
      'P11-057 owns Trainer appeal execution',
      'remain P11-059 scope',
      'P11-055 does not infer extra semantics',
    ]) expect(allDocs).not.toContain(stale)

    const adr = read('docs/adrs/019-authoritative-pokemon-contest-runtime.md')
    expect(adr).toContain('Accepted; amended by Deferred Mechanics Closure')
    expect(adr).toContain('Standard, Supercontest, Festival, Rotation, Trainer Participant, and Battle are native.')
    expect(read('docs/contests/README.md')).toContain('frozen machine-readable P10-100 closure record')
  })

  it('keeps all scoped local links and documented npm commands executable', () => {
    for (const path of documentationPaths) {
      for (const target of markdownLinks(path)) {
        const destination = resolve(root, dirname(path), target)
        expect(existsSync(destination), `${path} -> ${target}`).toBe(true)
      }
      for (const command of documentedCommands(path)) {
        expect(packageJson.scripts, `${path}: npm run ${command}`).toHaveProperty(command)
      }
    }
    expect(documentedCommands('docs/deferred-mechanics-closure.md')).toEqual([
      'check:deferred-closure-golden-journeys',
      'check:deferred-closure-migrations',
      'check:deferred-closure-backup-restore',
      'check:deferred-closure-accessibility',
      'check:deferred-closure-performance',
      'check:deferred-closure-privacy',
      'check:deferred-closure-docs',
    ])
  })
})
