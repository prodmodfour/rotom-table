import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import inventoryJson from '../../data/onboarding/zero-to-first-encounter-task-inventory.json'

const ROOT = resolve(import.meta.dirname, '../..')
const VALID_ROLES = new Set(inventoryJson.actorRoles)
const VALID_STAGES = new Set(inventoryJson.journeyStages)
const VALID_FINDING_KINDS = new Set(inventoryJson.findingKinds)
const VALID_BASELINES = new Set(inventoryJson.baselineStatuses)

const REQUIRED_TASKS = [
  'create-player-profile',
  'create-blank-trainer-sheet',
  'allocate-trainer-stats',
  'choose-training-feature',
  'add-edges-features-classes',
  'set-starting-money-inventory-equipment',
  'create-blank-pokemon-sheet',
  'assign-species-level-stats',
  'choose-pokemon-abilities-moves',
  'link-starter-team',
  'link-profile-characters',
  'review-and-approve-build',
  'enter-encounter-with-party',
  'perform-first-action',
  'adopt-existing-character',
] as const

describe('zero-to-first-encounter onboarding task inventory', () => {
  it('freezes complete role, stage, owner, finding, and future-ticket records', () => {
    expect(inventoryJson).toMatchObject({
      schemaVersion: 1,
      inventoryId: 'onboarding-zero-to-play-baseline-v1',
    })
    expect(inventoryJson.tasks.length).toBeGreaterThanOrEqual(20)
    expect(new Set(inventoryJson.tasks.map(task => task.id)).size).toBe(inventoryJson.tasks.length)

    const plan = readFileSync(
      resolve(ROOT, 'implementation-plans/done/CHARACTER_CREATION_AND_CAMPAIGN_ONBOARDING_PLAN.md'),
      'utf8',
    )

    for (const task of inventoryJson.tasks) {
      expect(task.actorRoles.length, task.id).toBeGreaterThan(0)
      expect(task.actorRoles.every(role => VALID_ROLES.has(role)), task.id).toBe(true)
      expect(VALID_STAGES.has(task.journeyStage), `${task.id} stage ${task.journeyStage}`).toBe(true)
      expect(VALID_BASELINES.has(task.baselineStatus), task.id).toBe(true)
      expect(task.currentOwners.length, task.id).toBeGreaterThan(0)
      expect(task.currentFlow.length, task.id).toBeGreaterThan(0)
      expect(task.authorityInputs.length, task.id).toBeGreaterThan(0)
      expect(task.findings.length, task.id).toBeGreaterThan(0)
      for (const finding of task.findings) {
        expect(VALID_FINDING_KINDS.has(finding.kind), `${task.id} finding kind ${finding.kind}`).toBe(true)
        expect(finding.description.trim(), task.id).not.toBe('')
      }
      expect(task.futureTickets.length, task.id).toBeGreaterThan(0)
      for (const ticket of task.futureTickets) {
        expect(ticket, task.id).toMatch(/^P9-\d{3}$/)
        expect(plan, `${task.id} references ${ticket}`).toContain(`**${ticket} `)
      }
      for (const owner of task.currentOwners) {
        expect(existsSync(resolve(ROOT, owner)), `${task.id} owner ${owner}`).toBe(true)
      }
    }
  })

  it('covers the whole journey and every finding classification', () => {
    const ids = new Set(inventoryJson.tasks.map(task => task.id))
    for (const id of REQUIRED_TASKS) expect(ids, id).toContain(id)

    // Every journey stage is represented by at least one task.
    expect(new Set(inventoryJson.tasks.map(task => task.journeyStage))).toEqual(VALID_STAGES)

    // Every declared finding kind occurs somewhere, including the
    // direct-storage-repair and invalid-state-escape classes the plan
    // explicitly requires this audit to record.
    const representedKinds = new Set(
      inventoryJson.tasks.flatMap(task => task.findings.map(finding => finding.kind)),
    )
    expect(representedKinds).toEqual(VALID_FINDING_KINDS)
  })

  it('records the manual review gap as missing structured authority', () => {
    const review = inventoryJson.tasks.find(task => task.id === 'review-and-approve-build')
    expect(review?.baselineStatus).toBe('missing')
    const adoption = inventoryJson.tasks.find(task => task.id === 'adopt-existing-character')
    expect(adoption?.baselineStatus).toBe('missing')
    expect(
      adoption?.findings.some(finding => finding.kind === 'direct-storage-repair'),
    ).toBe(true)
  })
})
