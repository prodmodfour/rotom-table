import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import inventoryJson from '../../data/encounter-workspace/encounter-task-inventory.json'

const ROOT = resolve(import.meta.dirname, '../..')
const VALID_ROLES = new Set(inventoryJson.actorRoles)
const VALID_SPATIALITY = new Set(inventoryJson.spatialityLevels)
const VALID_STATES = new Set(inventoryJson.experienceStates)
const VALID_BASELINES = new Set(['available', 'partial', 'missing'])
const REQUIRED_TASKS = [
  'observe-current-turn',
  'discover-actions',
  'use-move',
  'choose-participant-targets',
  'choose-area-direction-or-placement',
  'move-participant',
  'respond-to-optional-trigger',
  'pass-cancel-or-force-response',
  'send-out-switch-recall',
  'throw-pokeball',
  'inspect-participant',
  'manage-field-state',
  'correct-participant-state',
  'correct-move-operation',
  'recover-uncertain-command',
  'manage-objectives-phases-and-waves',
  'launch-complete-encounter',
] as const

describe('current player and GM encounter task inventory', () => {
  it('freezes complete role, authority, flow, spatiality, and migration records', () => {
    expect(inventoryJson).toMatchObject({
      schemaVersion: 1,
      inventoryId: 'encounter-task-baseline-v1',
      currentRoute: '/maps/:slug',
    })
    expect(inventoryJson.tasks).toHaveLength(35)
    expect(new Set(inventoryJson.tasks.map(task => task.id)).size).toBe(35)

    const plan = readFileSync(resolve(ROOT, 'implementation-plans/done/ENCOUNTER_UI_UX_PLAN.md'), 'utf8')
    for (const task of inventoryJson.tasks) {
      expect(task.actorRoles.length, task.id).toBeGreaterThan(0)
      expect(task.actorRoles.every(role => VALID_ROLES.has(role)), task.id).toBe(true)
      expect(VALID_SPATIALITY.has(task.spatiality), task.id).toBe(true)
      expect(VALID_STATES.has(task.targetState), task.id).toBe(true)
      expect(VALID_BASELINES.has(task.baselineStatus), task.id).toBe(true)
      expect(task.currentOwners.length, task.id).toBeGreaterThan(0)
      expect(task.currentFlow.length, task.id).toBeGreaterThan(0)
      expect(task.authorityInputs.length, task.id).toBeGreaterThan(0)
      expect(task.acceptedOutcome.trim(), task.id).not.toBe('')
      expect(task.currentProblems.length, task.id).toBeGreaterThan(0)
      expect(task.futureHome.trim(), task.id).not.toBe('')
      expect(plan, `${task.id} links ${task.migrationTicket}`).toContain(`**${task.migrationTicket} `)
      for (const owner of task.currentOwners) {
        expect(existsSync(resolve(ROOT, owner)), `${task.id} owner ${owner}`).toBe(true)
      }
    }
  })

  it('covers required player, responder, GM, correction, Workshop, and authoring journeys', () => {
    const ids = new Set(inventoryJson.tasks.map(task => task.id))
    for (const id of REQUIRED_TASKS) expect(ids, id).toContain(id)

    const representedRoles = new Set(inventoryJson.tasks.flatMap(task => task.actorRoles))
    expect(representedRoles).toEqual(VALID_ROLES)
    expect(new Set(inventoryJson.tasks.map(task => task.spatiality))).toEqual(VALID_SPATIALITY)
    expect(new Set(inventoryJson.tasks.map(task => task.targetState))).toEqual(VALID_STATES)
    expect(new Set(inventoryJson.tasks.map(task => task.baselineStatus))).toEqual(VALID_BASELINES)
  })
})
