import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import guardrails from '../../data/complete-play-loop/authority-guardrails.v1.json'
import cohorts from '../../data/complete-play-loop/item-catalog-cohorts.v1.json'
import items from '../../data/reference/items.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'

const root = resolve(import.meta.dirname, '../..')
const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')

type Evidence = { readonly path: string, readonly sha256: string }

const assertEvidence = (row: Evidence) => {
  expect(row.path === 'package.json' || /^(?:data|docs|scripts|server|shared|src|tests)\//.test(row.path)).toBe(true)
  expect(sha256(readFileSync(resolve(root, row.path))), row.path).toBe(row.sha256)
}

describe('P8-094 complete-loop drift and authority guardrails', () => {
  it('executes the production checker without drift or forbidden gaps', () => {
    expect(() => execFileSync(
      'python3',
      ['scripts/generate_complete_play_loop_authority_guardrails.py', '--check'],
      { cwd: root, stdio: 'pipe' },
    )).not.toThrow()
  }, 30_000)

  it('registers every canonical item exactly once under a reviewed non-blocked provider', () => {
    expect(guardrails.schemaVersion).toBe(1)
    expect(guardrails.ticket).toBe('P8-094')
    expect(guardrails.status).toBe('enforced')
    expect(guardrails.runtimeProseParsing).toBe(false)
    expect(guardrails.catalog.itemCount).toBe(349)
    expect(guardrails.catalog.itemCount).toBe(Object.keys(items).length)
    expect(guardrails.catalog.registeredExactlyOnce).toBe(true)
    expect(guardrails.catalog.blockedCount).toBe(0)

    const members = cohorts.cohorts.flatMap(cohort => cohort.members.map(member => member.canonicalId))
    expect(members).toHaveLength(Object.keys(items).length)
    expect(new Set(members)).toEqual(new Set(Object.keys(items)))
    expect(cohorts.cohorts.every(cohort => ['native', 'guided', 'passive'].includes(cohort.implementationState))).toBe(true)
    expect(cohorts.cohorts.every(cohort => cohort.unresolvedRequirements.length === 0)).toBe(true)

    const providers = Object.entries(guardrails.providerAuthorities)
    expect(new Set(providers.map(([providerId]) => providerId))).toEqual(new Set(Object.keys(cohorts.providerCounts)))
    expect(providers.reduce((sum, [, provider]) => sum + provider.memberCount, 0)).toBe(349)
    for (const [providerId, provider] of providers) {
      expect(provider.memberCount).toBe(cohorts.providerCounts[providerId as keyof typeof cohorts.providerCounts])
      if (provider.allowZeroMembers) expect(provider.memberCount).toBe(0)
      else expect(provider.memberCount).toBeGreaterThan(0)
      provider.ownerEvidence.forEach(assertEvidence)
    }
  })

  it('binds every active handler and server-only mechanic caller to current source fingerprints', () => {
    expect(Object.keys(guardrails.handlerAuthorities).sort()).toEqual(['item.guided.v1', 'item.native.v1'])
    for (const handler of Object.values(guardrails.handlerAuthorities)) {
      expect(handler.assignmentCount).toBeGreaterThan(0)
      handler.ownerEvidence.forEach(assertEvidence)
    }

    expect(guardrails.clientAuthority).toEqual({
      filesChecked: expect.any(Number),
      serverImports: 0,
      mechanicalMutationCallbacks: 0,
      commandOnly: true,
    })
    expect(guardrails.clientAuthority.filesChecked).toBeGreaterThan(100)
    for (const authority of guardrails.mechanicalAuthoritySymbols) {
      expect(authority.callerEvidence.length).toBeGreaterThan(0)
      expect(authority.callerEvidence.every(row => row.path.startsWith('server/'))).toBe(true)
      assertEvidence(authority.declarationEvidence)
      authority.callerEvidence.forEach(assertEvidence)
    }
  })

  it('admits only reviewed inventory assignments and gives every settlement field an owner', () => {
    const inventoryOwners = Object.entries(guardrails.inventoryMutationAuthorities)
    expect(inventoryOwners).toHaveLength(8)
    expect(inventoryOwners.reduce((sum, [, owner]) => sum + owner.assignmentCount, 0)).toBe(9)
    for (const [path, owner] of inventoryOwners) {
      expect(owner.evidence.path).toBe(path)
      expect([
        'pure-reducer',
        'transaction-planned-migration',
        'transaction-repository',
        'transaction-use-case',
        'projection-redaction',
      ]).toContain(owner.kind)
      assertEvidence(owner.evidence)
    }

    const fields = Object.entries(guardrails.settlementFieldOwners)
    expect(fields).toHaveLength(16)
    expect(fields.every(([, owners]) => owners.length > 0 && new Set(owners).size === owners.length)).toBe(true)
    const providerIds = new Set(Object.keys(guardrails.settlementProviderEvidence))
    expect(new Set(fields.flatMap(([, owners]) => owners))).toEqual(providerIds)
    for (const rows of Object.values(guardrails.settlementProviderEvidence)) rows.forEach(assertEvidence)
  })

  it('self-hashes all completion evidence and rejects stale source fingerprints', () => {
    const { completionEvidenceSha256, ...payload } = guardrails
    expect(sha256(stableJsonStringify(payload))).toBe(completionEvidenceSha256)
    expect(guardrails.sourceEvidence.length).toBeGreaterThanOrEqual(4)
    guardrails.sourceEvidence.forEach(assertEvidence)
    guardrails.certificationEvidence.forEach(assertEvidence)
    assertEvidence(guardrails.cohortRegistryEvidence)
    expect(sha256(readFileSync(resolve(root, guardrails.catalog.path)))).toBe(guardrails.catalog.sha256)

    const stale = structuredClone(guardrails)
    stale.catalog.sha256 = '0'.repeat(64)
    expect(stale.catalog.sha256).not.toBe(sha256(readFileSync(resolve(root, stale.catalog.path))))
  })
})
