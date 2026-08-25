import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import proof from '../../data/deferred-closure/item-action-closure-proof.v1.json'
import matrix from '../../data/deferred-closure/item-action-matrix.v1.json'
import grants from '../../data/complete-play-loop/equipment-grants.v1.json'
import contributions from '../../data/complete-play-loop/equipment-contributions.v1.json'
import cohorts from '../../data/complete-play-loop/item-catalog-cohorts.v1.json'
import inventory from '../../data/deferred-closure/closure-inventory.v1.json'
import recovery from '../../data/deferred-closure/item-action-recovery-certification.v1.json'
import rubric from '../../data/deferred-closure/completion-rubric.v1.json'
import { acceptedSuccessorHead } from '../helpers/deferredClosureSuccessors'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')
const actionGrants = new Map((grants as any).definitions.flatMap((definition: any) => definition.grants
  .filter((grant: any) => grant.kind === 'action')
  .map((grant: any) => [grant.actionId, grant])))
const contributionByItem = new Map((contributions as any).definitions
  .map((definition: any) => [definition.canonicalItemId, definition]))
const cohortByItem = new Map((cohorts as any).cohorts.flatMap((cohort: any) => cohort.members
  .map((member: any) => [member.canonicalId, { cohort, member }])))
const inventoryBySurface = new Map((inventory as any).rows.map((row: any) => [row.id, row]))
const recoveryByAction = new Map((recovery as any).actions.map((row: any) => [row.actionId, row]))

const mutationProgram = String.raw`
import copy
import json
import sys
from scripts.check_deferred_closure import (
    COHORTS_PATH, CONTRIBUTIONS_PATH, GRANTS_PATH, INVENTORY_PATH,
    ITEM_ACTION_MATRIX_PATH, ITEM_ACTION_PROOF_PATH, ITEM_ACTION_RECOVERY_PATH,
    load, validate_item_action_closure,
)
kind = sys.argv[1]
inventory = copy.deepcopy(load(INVENTORY_PATH))
grants = copy.deepcopy(load(GRANTS_PATH))
contributions = copy.deepcopy(load(CONTRIBUTIONS_PATH))
cohorts = copy.deepcopy(load(COHORTS_PATH))
matrix = copy.deepcopy(load(ITEM_ACTION_MATRIX_PATH))
recovery = copy.deepcopy(load(ITEM_ACTION_RECOVERY_PATH))
proof = copy.deepcopy(load(ITEM_ACTION_PROOF_PATH))
all_grants = [grant for definition in grants['definitions'] for grant in definition.get('grants', [])]
old_rod = next(grant for grant in all_grants if grant.get('actionId') == 'equipment.fishing.old-rod')
if kind == 'grant-final-deferred': old_rod['finalState'] = 'deferred'
elif kind == 'grant-executor-definition-missing': old_rod['executionStatus'] = 'definition-missing'
elif kind == 'grant-stale-ticket': old_rod['deferredTicket'] = 'P8-057'
elif kind == 'grant-missing':
    for definition in grants['definitions']:
        definition['grants'] = [grant for grant in definition.get('grants', []) if grant.get('actionId') != 'equipment.fishing.old-rod']
elif kind == 'contribution-deferred':
    next(row for row in contributions['definitions'] if row['canonicalItemId'] == 'Old Rod')['deferredMechanics'] = ['P8-057']
elif kind == 'cohort-deferred':
    member = next(member for cohort in cohorts['cohorts'] for member in cohort['members'] if member['canonicalId'] == 'Old Rod')
    member['actionFinalStates'][0]['finalState'] = 'deferred'
elif kind == 'cohort-unresolved':
    next(cohort for cohort in cohorts['cohorts'] if any(member['canonicalId'] == 'Old Rod' for member in cohort['members']))['unresolvedRequirements'] = ['legacy item action']
elif kind == 'inventory-deferred':
    row = next(row for row in inventory['rows'] if row['id'] == 'item-action.old-rod.fish')
    row['currentState'] = 'deferred'
    row['staleDeferredTicket'] = 'P8-057'
elif kind == 'recovery-deferred':
    next(row for row in recovery['actions'] if row['actionId'] == 'equipment.fishing.old-rod')['finalState'] = 'deferred'
elif kind == 'proof-count': proof['acceptance']['deferredCount'] = 1
else: raise RuntimeError(f'unknown mutation {kind}')
errors = []
validate_item_action_closure(
    inventory, grants, errors,
    contributions_document=contributions,
    cohorts_document=cohorts,
    matrix_document=matrix,
    recovery_document=recovery,
    proof_document=proof,
)
print(json.dumps(errors))
`

const mutationErrors = (mutation: string): readonly string[] => JSON.parse(execFileSync(
  'python3', ['-c', mutationProgram, mutation], { encoding: 'utf8' },
)) as string[]

describe('P11-044 zero-deferred core item-action proof', () => {
  it('is an exact hash-bound eleven-row proof with zero debt counts', () => {
    expect(proof).toMatchObject({
      schemaVersion: 1,
      proofId: 'deferred-closure-zero-item-actions-v1',
      ticket: 'P11-044',
      status: 'proved-zero-deferred-item-actions',
      runtimeProseParsing: false,
      acceptance: {
        actionCount: 11,
        nativeCount: 7,
        guidedCount: 4,
        deferredCount: 0,
        contradictionCount: 0,
        missingCount: 0,
        staleTicketCount: 0,
        unresolvedRequirementCount: 0,
        uncoveredRecoveryCount: 0,
        runtimeProseRows: 0,
      },
    })
    for (const binding of proof.authorityBindings) {
      expect(acceptedSuccessorHead(binding.path, binding.sha256), binding.path).toBe(sha256(binding.path))
    }
    expect(proof.actions.map(row => row.actionId).sort()).toEqual(matrix.rows.map(row => row.actionId).sort())
  })

  it('proves exact agreement across grants, contributions, cohorts, inventory, and recovery', () => {
    for (const row of proof.actions) {
      const grant = actionGrants.get(row.actionId) as any
      expect(grant, row.actionId).toMatchObject({
        grantId: row.grantId,
        executionStatus: 'native',
        finalState: row.finalState,
        deferredTicket: null,
      })
      const contribution = contributionByItem.get(row.canonicalItemId) as any
      expect(contribution.deferredMechanics, row.actionId).toEqual([])
      expect(contribution.grantFinalStates, row.actionId).toContainEqual({
        grantId: row.grantId,
        kind: 'action',
        finalState: row.finalState,
      })
      const cohort = cohortByItem.get(row.canonicalItemId) as any
      expect(cohort.cohort.unresolvedRequirements, row.actionId).toEqual([])
      expect(cohort.member.actionFinalStates, row.actionId).toContainEqual({
        actionId: row.actionId,
        finalState: row.finalState,
      })
      expect(inventoryBySurface.get(row.surfaceId), row.actionId).toMatchObject({
        currentState: row.finalState,
        targetState: row.finalState,
        closureEvidenceId: 'p11-044.item-actions',
      })
      expect(inventoryBySurface.get(row.surfaceId)).not.toHaveProperty('staleDeferredTicket')
      expect(recoveryByAction.get(row.actionId), row.actionId).toMatchObject({ finalState: row.finalState })
      expect(proof.forbiddenStates).not.toContain(row.finalState)
    }
  })

  it('publishes the strict item-action result through the repository checker', () => {
    const report = JSON.parse(execFileSync(
      'python3', ['scripts/check_deferred_closure.py', '--json'], { encoding: 'utf8' },
    ))
    expect(report).toMatchObject({
      final: 29,
      nonFinal: 0,
      unregisteredDebt: 0,
      itemActions: { rows: 11, native: 7, guided: 4, deferred: 0 },
      errors: [],
    })
  })

  it.each([
    ['grant-final-deferred', 'grant final state disagrees'],
    ['grant-executor-definition-missing', 'declaration executor is not native'],
    ['grant-stale-ticket', 'stale deferred ticket survived'],
    ['grant-missing', 'grant authority is absent'],
    ['contribution-deferred', 'contribution registry retains deferred mechanics'],
    ['cohort-deferred', 'cohort action final-state binding is absent'],
    ['cohort-unresolved', 'cohort retains unresolved requirements'],
    ['inventory-deferred', 'closure inventory is not in its exact final state'],
    ['recovery-deferred', 'recovery certification final state is absent or contradictory'],
    ['proof-count', 'proof acceptance counts are not zero-debt'],
  ] as const)('fails closed for synthetic %s authority', (mutation, message) => {
    expect(mutationErrors(mutation).join('\n')).toContain(message)
  })

  it('registers both runtime and zero-debt evidence as passing', () => {
    expect((rubric as any).evidenceRegistry).toContainEqual({
      id: 'p11.item-action-runtime-certification',
      type: 'test',
      path: 'tests/data/deferredClosureItemActionRecovery.test.ts',
      status: 'passing',
    })
    expect((rubric as any).evidenceRegistry).toContainEqual({
      id: 'p11.zero-deferred-item-proof',
      type: 'test',
      path: 'tests/data/deferredClosureItemProof.test.ts',
      status: 'passing',
    })
  })
})
