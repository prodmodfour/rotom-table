import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import inventoryJson from '../../data/onboarding/authority-inventory.json'

const ROOT = resolve(import.meta.dirname, '../..')
const VALID_RISK_KINDS = new Set(inventoryJson.riskKinds)
const VALID_STORAGE_KINDS = new Set(['sqlite', 'filesystem-json'])

const REQUIRED_OPERATIONS = [
  'sheet-create',
  'sheet-save-setup',
  'sheet-rename',
  'sheet-delete',
  'profile-create',
  'profile-update-links',
  'team-membership',
  'equipment-operations',
  'inventory-actions',
  'encounter-participants',
] as const

describe('onboarding authority inventory', () => {
  it('freezes storage kind, authorization, revision control, and risks per operation', () => {
    expect(inventoryJson).toMatchObject({
      schemaVersion: 1,
      inventoryId: 'onboarding-authority-baseline-v1',
    })
    expect(new Set(inventoryJson.operations.map(op => op.id)).size).toBe(inventoryJson.operations.length)

    for (const op of inventoryJson.operations) {
      expect(VALID_STORAGE_KINDS.has(op.storageKind), `${op.id} storage ${op.storageKind}`).toBe(true)
      expect(op.authorization.trim(), op.id).not.toBe('')
      expect(op.revisionControl.trim(), op.id).not.toBe('')
      expect(op.risks.length, op.id).toBeGreaterThan(0)
      for (const risk of op.risks) {
        expect(VALID_RISK_KINDS.has(risk.kind), `${op.id} risk ${risk.kind}`).toBe(true)
        expect(risk.description.trim(), op.id).not.toBe('')
      }
      for (const path of [op.route, op.useCase, op.storage]) {
        expect(existsSync(resolve(ROOT, path)), `${op.id} path ${path}`).toBe(true)
      }
    }
  })

  it('covers required onboarding operations and every declared risk class', () => {
    const ids = new Set(inventoryJson.operations.map(op => op.id))
    for (const id of REQUIRED_OPERATIONS) expect(ids, id).toContain(id)

    const represented = new Set(
      inventoryJson.operations.flatMap(op => op.risks.map(risk => risk.kind)),
    )
    expect(represented).toEqual(VALID_RISK_KINDS)
  })

  it('records the profile-link and team dangling-reference hazards the plan must close', () => {
    const profileUpdate = inventoryJson.operations.find(op => op.id === 'profile-update-links')
    expect(profileUpdate?.storageKind).toBe('filesystem-json')
    expect(profileUpdate?.risks.some(risk => risk.kind === 'missing-revision-check')).toBe(true)

    const rename = inventoryJson.operations.find(op => op.id === 'sheet-rename')
    expect(rename?.risks.some(risk => risk.kind === 'dangling-reference')).toBe(true)

    const team = inventoryJson.operations.find(op => op.id === 'team-membership')
    expect(team?.risks.some(risk => risk.kind === 'client-owned-mutation')).toBe(true)
  })
})
