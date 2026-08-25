import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import gate from '../../data/deferred-closure/drift-forbidden-gap-gate.v1.json'
import certification from '../../data/deferred-closure/drift-forbidden-gap-certification.v1.json'
import inventory from '../../data/deferred-closure/closure-inventory.v1.json'
import grants from '../../data/complete-play-loop/equipment-grants.v1.json'
import contests from '../../data/reference/contests.json'
import { CAPABILITY_WEAPON_MOVES } from '../../shared/capabilityAutomation/weaponMoves'
import { CAPABILITY_WEAPON_MOVE_HANDLER_ID } from '../../server/domain/moveAutomation/handlers/capabilityWeaponMoves'
import { REGISTERED_MOVE_HANDLER_REGISTRY } from '../../server/domain/moveAutomation/handlers/registry'
import { acceptedSuccessorHead, repositoryFileSha256 } from '../helpers/deferredClosureSuccessors'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')
const source = (path: string): string => readFileSync(path, 'utf8')
const verify = (row: { path: string, sha256: string }): void => {
  expect(acceptedSuccessorHead(row.path, row.sha256), row.path).toBe(repositoryFileSha256(row.path))
}
const allGrants = grants.definitions.flatMap(definition => definition.grants)
const grantById = new Map(allGrants.map(grant => [grant.grantId, grant]))

describe('P11-088 Deferred Mechanics Closure drift and forbidden-gap gate', () => {
  it('registers every repaired row exactly once with no deferral-flavored final authority', () => {
    expect(gate).toMatchObject({
      schemaVersion: 1,
      gateId: 'deferred-closure-drift-forbidden-gap-v1',
      ticket: 'P11-088',
      status: 'enforced',
      runtimeProseParsing: false,
    })
    expect(gate.registryContracts).toMatchObject({
      closureRows: 29,
      userFacingMechanics: 27,
      rangedWeaponProfiles: 6,
      repairedWeaponMoves: 7,
      supplementalWeaponMoves: 12,
      itemActions: 11,
      contestVariants: 2,
      genericSkillCheckSurfaces: 1,
    })
    expect(inventory.rows).toHaveLength(gate.registryContracts.closureRows)
    const registeredGrantIds = inventory.rows.flatMap(row => 'grantId' in row ? [row.grantId] : [])
    expect(new Set(registeredGrantIds).size).toBe(registeredGrantIds.length)
    expect(new Set(registeredGrantIds)).toEqual(new Set(gate.registryContracts.expectedGrantIds))
    for (const grantId of gate.registryContracts.expectedGrantIds) {
      const grant = grantById.get(grantId)!
      expect(grant, grantId).toBeDefined()
      expect(gate.forbiddenFinalTokens, grantId).not.toContain(grant.executionStatus)
      if ('finalState' in grant) expect(gate.forbiddenFinalTokens, grantId).not.toContain(grant.finalState)
      expect('deferredTicket' in grant ? grant.deferredTicket : null, grantId).toBeNull()
    }
    for (const variantId of gate.registryContracts.contestVariantIds) {
      expect(contests.variants.find(row => row.id === variantId), variantId).toMatchObject({ completionState: 'native' })
    }
  })

  it('has exactly twelve source-bound weapon definitions and one registered non-orphan handler', () => {
    expect(Object.keys(CAPABILITY_WEAPON_MOVES)).toEqual(gate.registryContracts.supplementalWeaponMoveIds)
    expect(gate.handlerContracts).toEqual([expect.objectContaining({
      handlerId: CAPABILITY_WEAPON_MOVE_HANDLER_ID,
      expectedDefinitions: 12,
      orphanDefinitions: 0,
      orphanRegistrations: 0,
    })])
    const registration = REGISTERED_MOVE_HANDLER_REGISTRY.resolve(CAPABILITY_WEAPON_MOVE_HANDLER_ID)
    expect(registration).toMatchObject({ id: CAPABILITY_WEAPON_MOVE_HANDLER_ID, version: 1 })
    expect(REGISTERED_MOVE_HANDLER_REGISTRY.entries().filter(row => row.id === CAPABILITY_WEAPON_MOVE_HANDLER_ID)).toHaveLength(1)
  })

  it('pins every new persisted shape to its owning existing authority and migration', () => {
    expect(gate.documentContracts.map(row => [row.documentId, row.storageSchemaVersion])).toEqual([
      ['encounter-equipment-actions', 47],
      ['fishing-guided-declarations', 48],
      ['snag-conversion-adjudication', 49],
      ['generic-skill-check', 50],
      ['trainer-participant-contest', 46],
      ['battle-contest-blend', 46],
    ])
    for (const document of gate.documentContracts) {
      expect(document.parallelAuthority, document.documentId).toBe(false)
      for (const requirement of document.requiredTokens) {
        expect(source(requirement.path), `${document.documentId}: ${requirement.path}`).toContain(requirement.token)
      }
    }
    const migrations = source('server/storage/migrations.ts')
    expect(migrations).toContain('export const LATEST_STORAGE_SCHEMA_VERSION = 50')
    expect(migrations).not.toContain('version: 51')
  })

  it('runs one successor-aware static checker and binds every generator command into the quality gate', () => {
    const report = JSON.parse(execFileSync('python3', [
      'scripts/check_deferred_closure.py', '--check-drift', '--json',
    ], { encoding: 'utf8' }))
    expect(report).toMatchObject({
      rows: 29,
      final: 29,
      nonFinal: 0,
      unregisteredDebt: 0,
      checkDrift: true,
      errors: [],
    })
    const packageSource = source('package.json')
    for (const command of gate.generatedChecks) expect(packageSource, command).toContain(`"${command}"`)
    for (const command of gate.directGeneratedChecks) expect(packageSource, command).toContain(command)
    expect(packageSource).toContain('check:deferred-closure-drift')
    expect(source(gate.qualityGate.scriptPath)).toContain(gate.qualityGate.command)
    const checker = source('scripts/check_deferred_closure.py')
    for (const failurePolicy of [
      'successor chain branches',
      'unregistered deferral-flavored grant authority',
      'handler registration or orphan contract drifted',
      'required contract token is absent',
      'drift gate source binding is stale',
    ]) expect(checker).toContain(failurePolicy)
  })

  it('hash-binds the gate, checker, generators, document contracts, and repository quality gate', () => {
    expect(certification).toMatchObject({
      schemaVersion: 1,
      certificationId: 'deferred-closure-drift-forbidden-gap-v1',
      ticket: 'P11-088',
      status: 'certified',
      runtimeProseParsing: false,
    })
    expect(certification.predecessor.sha256).toBe(sha256(certification.predecessor.path))
    verify(certification.gate)
    for (const row of gate.sourceBindings) verify(row)
    for (const row of certification.authorities) verify(row)
    for (const row of certification.evidence) verify(row)
    expect(certification.acceptance).toEqual({
      closureRows: 29,
      finalRows: 29,
      generatedChecks: 7,
      documentContracts: 6,
      orphanHandlers: 0,
      unregisteredRows: 0,
      deferralFlavoredFinalStates: 0,
      successorBranchesOrGaps: 0,
      qualityGateRegistrations: 1,
      hardFailures: 0,
      nextTicket: 'P11-089',
    })
  })
})
