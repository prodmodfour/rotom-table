import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import grants from '../../data/complete-play-loop/equipment-grants.v1.json'
import contests from '../../data/reference/contests.json'
import items from '../../data/reference/items.json'
import moves from '../../data/reference/moves.json'
import authority from '../../data/deferred-closure/source-authority.v1.json'
import chain from '../../data/deferred-closure/successor-chain.v1.json'

const root = resolve(import.meta.dirname, '../..')
const sha = (path: string) => createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')

const grantRows = (grants as any).definitions.flatMap((definition: any) => definition.grants ?? [])
const grantsByActionId = new Map(grantRows.filter((grant: any) => grant.actionId).map((grant: any) => [grant.actionId, grant]))
const contestVariants = new Set((contests as any).variants.map((variant: any) => variant.id))

describe('Deferred Closure reviewed source authority (P11-003)', () => {
  it('pins every documentary source by exact bytes', () => {
    expect(authority.status).toBe('reviewed')
    expect(authority.runtimeProseParsing).toBe(false)
    expect(authority.documentaryFingerprint.algorithm).toBe('sha256')
    expect(authority.documentaryFingerprint.sources.map(source => source.path)).toEqual([
      'books/markdown/core/09-gear-and-items.md',
      'books/markdown/core/08-pokemon-contests.md',
      'books/markdown/errata-2.md',
      'books/markdown/errata-3.md',
    ])
    for (const source of authority.documentaryFingerprint.sources) {
      expect(sha(source.path), source.path).toBe(source.sha256)
      expect(source.authorizes.length).toBeGreaterThan(0)
    }
  })

  it('pins frozen app-owned authority and keeps weapon Moves out of moves.json', () => {
    for (const source of authority.appOwnedAuthority.filter(source => 'sha256' in source)) {
      expect(sha(source.path), source.path).toBe(source.sha256)
    }
    for (const moveName of authority.reviewedIdentitySets.weaponMoves) {
      expect((moves as Record<string, unknown>)[moveName], moveName).toBeUndefined()
    }
  })

  it('binds every reviewed identity to app-owned canonical rows', () => {
    for (const itemName of authority.reviewedIdentitySets.weaponProfiles) {
      expect((items as Record<string, unknown>)[itemName], itemName).toBeDefined()
    }
    for (const actionId of authority.reviewedIdentitySets.itemActions) {
      expect(grantsByActionId.has(actionId), actionId).toBe(true)
    }
    for (const variantId of authority.reviewedIdentitySets.contestVariants) {
      expect(contestVariants.has(variantId), variantId).toBe(true)
    }
    expect(authority.identityPolicy.unknownIdentity).toBe('fail-closed-and-record-data-defect')
    expect(authority.identityPolicy.runtimeProseInterpretation).toBe('forbidden')
    expect(authority.identityPolicy.openDataDefects).toEqual([])
  })

  it('keeps every touched Plan 1-10 acceptance record byte-immutable', () => {
    expect(new Set(authority.frozenAcceptanceRecords.map(record => record.path)).size)
      .toBe(authority.frozenAcceptanceRecords.length)
    for (const record of authority.frozenAcceptanceRecords) {
      expect(record.policy).toBe('byte-immutable')
      expect(sha(record.path), record.path).toBe(record.sha256)
      expect(record.touchedBy.length).toBeGreaterThan(0)
      expect(record.plan).toBeGreaterThanOrEqual(1)
      expect(record.plan).toBeLessThanOrEqual(10)
    }
  })

  it('records contiguous reviewed successors and the installed pending heads', () => {
    expect(sha(chain.sourceAuthority.path)).toBe(chain.sourceAuthority.sha256)
    for (const edge of chain.edges) {
      expect(edge.beforeSha256).toMatch(/^[a-f0-9]{64}$/)
      expect(edge.afterSha256).toMatch(/^[a-f0-9]{64}$/)
      expect(edge.beforeSha256).not.toBe(edge.afterSha256)
      expect(edge.reviewStatus).toBe('accepted')
    }
    const edgesBySurface = Map.groupBy(chain.edges, edge => edge.surface)
    for (const [surface, edges] of edgesBySurface) {
      for (let index = 1; index < edges.length; index += 1) {
        expect(edges[index]!.beforeSha256, surface).toBe(edges[index - 1]!.afterSha256)
      }
    }
    for (const pending of chain.pendingSurfaces) {
      const edges = edgesBySurface.get(pending.surface) ?? []
      if (edges.length > 0) expect(pending.currentSha256).toBe(edges.at(-1)!.afterSha256)
      expect(sha(pending.surface), pending.surface).toBe(pending.currentSha256)
      expect(pending.owningTickets.every(ticket => /^P11-0\d\d$/.test(ticket))).toBe(true)
    }
  })
})
