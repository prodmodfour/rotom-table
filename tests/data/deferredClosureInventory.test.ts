import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import inventory from '../../data/deferred-closure/closure-inventory.v1.json'
import grants from '../../data/complete-play-loop/equipment-grants.v1.json'
import cohorts from '../../data/complete-play-loop/item-catalog-cohorts.v1.json'
import contests from '../../data/reference/contests.json'
import items from '../../data/reference/items.json'
import moves from '../../data/reference/moves.json'

const root = resolve(import.meta.dirname, '../..')
const sha = (path: string) => createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')

const rows = inventory.rows as ReadonlyArray<Record<string, any>>
const mechanicsRows = rows.filter(row => row.kind !== 'hygiene')
const grantById = new Map<string, Record<string, any>>()
for (const definition of (grants as any).definitions) {
  for (const grant of definition.grants ?? []) grantById.set(grant.grantId, grant)
}

describe('Deferred Mechanics Closure inventory (P11-001)', () => {
  it('is a structurally complete activation baseline', () => {
    expect((inventory as any).schemaVersion).toBe(1)
    expect((inventory as any).ticket).toBe('P11-001')
    expect((inventory as any).runtimeProseParsing).toBe(false)
    const ids = rows.map(row => row.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect((inventory as any).counts.rows).toBe(rows.length)
    expect((inventory as any).counts.mechanics).toBe(mechanicsRows.length)
    expect((inventory as any).counts.weaponProfiles).toBe(rows.filter(row => row.kind === 'weapon-profile').length)
    expect((inventory as any).counts.weaponMoves).toBe(rows.filter(row => row.kind === 'weapon-move').length)
    expect((inventory as any).counts.itemActions).toBe(rows.filter(row => row.kind === 'item-action').length)
    expect((inventory as any).counts.contestVariants).toBe(rows.filter(row => row.kind === 'contest-variant').length)
    expect((inventory as any).counts.reviewedNonGaps).toBe((inventory as any).reviewedNonGaps.length)
    for (const row of rows) {
      expect((inventory as any).allowedCurrentStates).toContain(row.currentState)
      expect((inventory as any).allowedTargetStates).toContain(row.targetState)
      expect(row.owningTickets.length).toBeGreaterThan(0)
      expect(row.owningPaths.length).toBeGreaterThan(0)
      expect(typeof row.canonicalDataStatus).toBe('string')
      expect(typeof row.privacyImplications).toBe('string')
      expect(row.acceptanceEvidence.length).toBeGreaterThan(0)
    }
  })

  it('references only real Plan 11 tickets from the authoritative ledger', () => {
    const ledger = readFileSync(resolve(root, 'implementation-plans/DEFERRED_MECHANICS_CLOSURE_PLAN.md'), 'utf8')
    for (const row of rows) {
      for (const ticket of row.owningTickets) {
        expect(ticket).toMatch(/^P11-0\d\d$/)
        expect(ledger).toContain(`**${ticket}`)
      }
    }
  })

  it('keeps the frozen canonical sources frozen', () => {
    for (const source of (inventory as any).frozenSources) {
      expect(sha(source.path)).toBe(source.sha256)
    }
    for (const row of rows.filter(entry => entry.kind === 'weapon-move')) {
      expect((moves as Record<string, unknown>)[row.canonicalId]).toBeUndefined()
    }
  })

  it('binds every mechanics row to its canonical item identity', () => {
    for (const row of rows.filter(entry => entry.canonicalItem)) {
      expect((items as Record<string, unknown>)[row.canonicalItem]).toBeDefined()
    }
  })

  it('tracks monotone closure progress in the grants registry', () => {
    for (const row of rows.filter(entry => entry.grantId)) {
      const grant = grantById.get(row.grantId)
      expect(grant, row.grantId).toBeDefined()
      const finalStates = row.targetState === 'guided' ? ['native', 'guided'] : ['native']
      const reviewedState = grant!.finalState ?? grant!.executionStatus
      expect([row.currentState, ...finalStates]).toContain(reviewedState)
      if (reviewedState === 'deferred') {
        const pointer = grant!.deferredTicket as string
        expect([row.staleDeferredTicket, ...row.owningTickets]).toContain(pointer)
      }
    }
  })

  it('tracks monotone closure progress in the canonical contest variants', () => {
    for (const row of rows.filter(entry => entry.kind === 'contest-variant')) {
      const variantId = row.id.replace('contest-variant.', '')
      const variant = (contests as any).variants.find((entry: any) => entry.id === variantId)
      expect(variant, variantId).toBeDefined()
      expect(['reference-only', 'structured', row.targetState]).toContain(variant.completionState)
    }
  })

  it('closes every fishing row and records the bounded Plan 12 content handoff', () => {
    const fishingRows = rows.filter(row => row.id.startsWith('item-action.') && row.id.endsWith('-rod.fish'))
    expect(fishingRows.map(row => row.id).sort()).toEqual([
      'item-action.good-rod.fish',
      'item-action.old-rod.fish',
      'item-action.super-rod.fish',
    ])
    expect(fishingRows.every(row => row.currentState === 'guided')).toBe(true)
    expect(fishingRows.every(row => grantById.get(row.grantId)?.executionStatus === 'native')).toBe(true)
    expect(fishingRows.every(row => grantById.get(row.grantId)?.finalState === 'guided')).toBe(true)
    expect((inventory as any).plan12HandoffBoundaries).toContainEqual(expect.objectContaining({
      id: 'fishing-hook-content-tooling',
      recordedBy: 'P11-039',
      handoffOnly: expect.arrayContaining([
        'campaign-specific fishing encounter tables',
        'automatic hooked-Pokémon sheet creation or map spawning',
      ]),
    }))
  })

  it('records the finality decision that resolves the grants-versus-cohorts contradiction', () => {
    const decision = (inventory as any).finalityDecision
    expect(decision.readSurfaces).toContain('data/complete-play-loop/equipment-grants.v1.json')
    expect(decision.readSurfaces).toContain('data/reference/contests.json')
    expect(decision.readSurfaces).toContain('data/deferred-closure/closure-inventory.v1.json')
    expect(decision.derivedSurfaces).toContain('data/complete-play-loop/item-catalog-cohorts.v1.json')
    expect(decision.reconciledBy).toBe('P11-042')
    expect(decision.provedBy).toBe('P11-089')
    const cohortMembers = new Map<string, any>((cohorts as any).cohorts.flatMap((cohort: any) => (
      cohort.members.map((member: any) => [member.canonicalId, member])
    )))
    for (const row of rows.filter(entry => entry.kind === 'item-action' || entry.kind === 'weapon-profile')) {
      expect(cohortMembers.has(row.canonicalItem), row.canonicalItem).toBe(true)
      if (row.kind === 'item-action') {
        expect(cohortMembers.get(row.canonicalItem).actionFinalStates).toContainEqual({
          actionId: grantById.get(row.grantId)?.actionId,
          finalState: grantById.get(row.grantId)?.finalState,
        })
      }
    }
  })

  it('separates core gaps from reviewed non-gaps without silent absences', () => {
    const nonGapIds = (inventory as any).reviewedNonGaps.map((entry: any) => entry.id)
    expect(new Set(nonGapIds).size).toBe(nonGapIds.length)
    for (const entry of (inventory as any).reviewedNonGaps) {
      expect(entry.id).toMatch(/^non-gap\./)
      expect(typeof entry.finding).toBe('string')
      expect(['closed-by-later-plan', 'closed-at-source', 'final-state-by-rubric', 'not-a-mechanics-row', 'post-1.0-by-definition']).toContain(entry.classification)
    }
    const deferredGrantIds = (grants as any).definitions
      .flatMap((definition: any) => definition.grants ?? [])
      .filter((grant: any) => grant.executionStatus && grant.executionStatus !== 'native')
      .map((grant: any) => grant.grantId)
    const inventoryGrantIds = new Set(rows.filter(entry => entry.grantId).map(entry => entry.grantId))
    for (const grantId of deferredGrantIds) expect(inventoryGrantIds.has(grantId), grantId).toBe(true)
  })
})
