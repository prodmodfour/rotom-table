import { performance } from 'node:perf_hooks'
import { afterEach, describe, expect, it } from 'vitest'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteContestRepository } from '../../server/storage/contestRepository'
import { createContestDocument } from '../../shared/contests/document'
import { projectContestDiagnostic, projectContestGm, projectContestOwner, projectContestPublic } from '../../shared/contests/projections'
import type { PlayerProfile } from '../../shared/playerProfiles'

const databases: RotomDatabase[] = []
afterEach(() => { while (databases.length) databases.pop()!.close() })

describe('Contest deterministic performance budgets', () => {
  it('loads the maximum activity list within the trusted-table budget', () => {
    const database = openRotomDatabase({ path: ':memory:', enableWal: false }); databases.push(database)
    const repository = createSqliteContestRepository(database)
    for (let index = 0; index < 100; index += 1) repository.insert(createContestDocument({ contestId: `contest:v1:budget-${index}`, name: `Contest ${index}`, hallName: 'Budget Hall', description: '', variantId: 'standard', contestTypeId: 'cute', significanceMultiplier: 1, awardRibbon: true, prize: { declared: true, money: 0, items: [], notes: '' }, gmNotes: '', now: index + 1 }))
    const started = performance.now()
    const rows = repository.list({ includeTerminal: true, limit: 100 })
    const elapsed = performance.now() - started
    expect(rows).toHaveLength(100)
    expect(elapsed).toBeLessThan(250)
  })

  it('recomputes all structural role projections without mutation or private leakage', () => {
    const document = createContestDocument({ contestId: 'contest:v1:projection-budget', name: 'Projection budget', hallName: 'Budget Hall', description: '', variantId: 'standard', contestTypeId: 'cute', significanceMultiplier: 1, awardRibbon: true, prize: { declared: false, money: 5_000, items: [], notes: 'private' }, gmNotes: 'private', now: 1 })
    const profile = { id: 'profile_budget01', displayName: 'Budget', linkedCharacters: [], createdAt: 1, updatedAt: 1 } as PlayerProfile
    const original = JSON.stringify(document)
    const started = performance.now()
    for (let index = 0; index < 2_000; index += 1) {
      projectContestPublic(document)
      projectContestOwner(document, profile.id)
      projectContestGm(document)
      projectContestDiagnostic(document)
    }
    const elapsed = performance.now() - started
    expect(elapsed).toBeLessThan(1_500)
    expect(JSON.stringify(document)).toBe(original)
    expect(JSON.stringify(projectContestPublic(document))).not.toContain('private')
  })
})
