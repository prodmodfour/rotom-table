import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import boundaries from '../../data/gm-campaign-toolkit/data-boundaries.v1.json'
import packageJson from '../../package.json'

const root = resolve(import.meta.dirname, '../..')
const path = 'docs/gm-campaign-toolkit/contributor-guide.md'
const read = (target: string): string => readFileSync(resolve(root, target), 'utf8')
const links = (source: string): readonly string[] => [...source.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)]
  .map(match => match[1]!)
  .filter(target => !target.startsWith('#'))
const commands = (source: string): readonly string[] => [...source.matchAll(/npm run ([a-z0-9:-]+)/gu)].map(match => match[1]!)

describe('GM Campaign Toolkit contributor documentation', () => {
  it('records every canonical, campaign-owned, and documentary boundary without fallback authority', () => {
    const guide = read(path)
    expect(guide.length).toBeGreaterThan(15_000)
    for (const source of boundaries.canonicalRuntimeSources) expect(guide).toContain(source)
    for (const root of boundaries.documentaryOnlyRoots) expect(guide).toContain(root)
    for (const family of ['encounter-table documents', 'NPC archetype policies', 'session-preparation documents', 'generation operations']) expect(guide).toContain(family)
    expect(guide).toContain('Runtime must fail closed with a bounded explanation')
    expect(guide).toContain('Campaign data may select and constrain canonical identities. It may not override')
    expect(guide).toContain('Do not use external research to fill a runtime identity or mechanic.')
  })

  it('documents strict extension rules across every authority and preserves privacy, retry, and transaction invariants', () => {
    const guide = read(path)
    for (const heading of [
      'Extending encounter tables',
      'Extending wild generation',
      'Extending NPC generation',
      'Extending session preparation',
      'Extending Builder handoffs',
      'Authorization, projections, and realtime',
      'Persistence and migrations',
      'UI contribution rules',
      'Testing requirements',
    ]) expect(guide).toContain(`## ${heading}`)
    for (const phrase of [
      'Preview is inert and creates zero durable rows or realtime events.',
      'Exact operation retry returns the original immutable result with zero new draws, writes, revisions, or events.',
      'Generated participants are ordinary sheets with ordinary custody.',
      'Public/owner projections are separate allowlisted structures.',
      'Do not add package, preparation, random-journal, source-hash, token, or diagnostics export routes.',
      'Do not open a sidecar SQLite database',
    ]) expect(guide).toContain(phrase)
  })

  it('pins safe drift maintenance, executable checks, and resolvable local documentation links', () => {
    const guide = read(path)
    expect(guide).toContain('161be4cb987549b3947ba65262d325fcfd28dd5538286d633528e4ef2a2f9862')
    expect(guide).toContain('Do not run the footprint generator with `--write` merely to silence a failure.')
    expect(guide).toContain('Never hand-edit a certification hash.')
    for (const command of commands(guide)) expect(packageJson.scripts, `npm run ${command}`).toHaveProperty(command)
    for (const target of links(guide)) {
      expect(target).not.toMatch(/^(?:https?:|\/\/)/u)
      expect(existsSync(resolve(root, dirname(path), target)), `${path} -> ${target}`).toBe(true)
    }
    expect(read('docs/gm-campaign-toolkit/README.md')).toContain('(contributor-guide.md)')
    expect(read('docs/README.md')).toContain('(gm-campaign-toolkit/contributor-guide.md)')
  })
})
