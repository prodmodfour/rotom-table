import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import fixtureIndex from '../../data/encounter-workspace/fixtures/index.json'
import taskInventory from '../../data/encounter-workspace/encounter-task-inventory.json'

const ROOT = resolve(import.meta.dirname, '../..')
const STABLE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const VALID_ROLES = new Set(['player-owner', 'gm', 'public', 'diagnostic'])
const VALID_SPATIALITY = new Set(['none', 'relationship', 'exact', 'mixed'])
const VALID_AVAILABILITY = new Set(['available', 'unavailable'])
const VALID_PENDING_STATUS = new Set(['queued', 'pending', 'resuming'])
const VALID_CONNECTION = new Set(['ready', 'saving', 'reconnecting', 'reconciling', 'stale', 'error'])

interface FixtureParticipant {
  id: string
  sideId: string
  onMap: boolean
  reserve: boolean
  hidden: boolean
  groupKey: string | null
  position: { x: number, y: number, z: number } | null
  controllerIds: string[]
  hp: { current: number, maximum: number, temporary: number }
}

interface EncounterFixture {
  schemaVersion: number
  fixtureId: string
  sourceTicket: string
  map: {
    slug: string
    revision: number
    environment: { weather: string[], terrain: string[], rooms: string[], hazards: unknown[] }
  }
  encounter: {
    currentParticipantId: string | null
    initiativeOrder: string[]
    sides: { id: string }[]
    objectives: { id: string, visibility: string, status: string }[]
  }
  participants: FixtureParticipant[]
  relationships?: { id: string, kind: string, sourceId: string, targetId: string, distance: number, public: boolean }[]
  offers: {
    id: string
    actorId: string
    sourceKind: string
    spatiality: string
    targetIds: string[]
    availability: string
    unavailableReason: string | null
  }[]
  pending: {
    id: string
    parentId: string | null
    actorId: string
    responderIds: string[]
    optionLabels: string[]
    publicPrompt: string
    privatePrompt: string
    spatiality: string
    status: string
  }[]
  accepted: { id: string, sequence: number, actorId: string | null, affectedIds: string[] }[]
  system: {
    connection: string
    replayGap: boolean
    outbox: { id: string, exactRetryAllowed?: boolean, status?: string }[]
  }
  audiences: {
    id: string
    role: string
    viewerId: string | null
    visibleParticipantIds: string[]
    controlledParticipantIds: string[]
    authorizedPendingIds: string[]
  }[]
  scripts: { id: string, actorRole: string, taskIds: string[], steps: string[], expectedTerminal: string }[]
}

const loadFixture = (path: string): EncounterFixture => JSON.parse(
  readFileSync(resolve(ROOT, path), 'utf8'),
) as EncounterFixture

const expectUniqueStableIds = (values: readonly string[], label: string): void => {
  expect(new Set(values).size, label).toBe(values.length)
  expect(values.every(value => STABLE_ID.test(value)), label).toBe(true)
}

const validateFixture = (fixture: EncounterFixture): void => {
  expect(fixture.schemaVersion, fixture.fixtureId).toBe(1)
  expect(fixture.map.revision, fixture.fixtureId).toBeGreaterThan(0)
  const participantIds = fixture.participants.map(participant => participant.id)
  const participantSet = new Set(participantIds)
  const sideSet = new Set(fixture.encounter.sides.map(side => side.id))
  const pendingSet = new Set(fixture.pending.map(pending => pending.id))
  const taskSet = new Set(taskInventory.tasks.map(task => task.id))

  expectUniqueStableIds(participantIds, `${fixture.fixtureId} participants`)
  expectUniqueStableIds([...sideSet], `${fixture.fixtureId} sides`)
  expectUniqueStableIds(fixture.offers.map(offer => offer.id), `${fixture.fixtureId} offers`)
  expectUniqueStableIds([...pendingSet], `${fixture.fixtureId} pending`)
  expectUniqueStableIds(fixture.accepted.map(accepted => accepted.id), `${fixture.fixtureId} accepted`)
  expectUniqueStableIds(fixture.audiences.map(audience => audience.id), `${fixture.fixtureId} audiences`)
  expectUniqueStableIds(fixture.scripts.map(script => script.id), `${fixture.fixtureId} scripts`)

  expect(fixture.encounter.currentParticipantId === null || participantSet.has(fixture.encounter.currentParticipantId), fixture.fixtureId).toBe(true)
  expect(fixture.encounter.initiativeOrder.every(id => participantSet.has(id)), fixture.fixtureId).toBe(true)
  expect(new Set(fixture.encounter.initiativeOrder).size, fixture.fixtureId).toBe(fixture.encounter.initiativeOrder.length)

  for (const participant of fixture.participants) {
    expect(sideSet.has(participant.sideId), participant.id).toBe(true)
    expect(participant.onMap ? participant.position !== null : participant.position === null, participant.id).toBe(true)
    expect(participant.reserve && participant.onMap, participant.id).toBe(false)
    expect(participant.hp.maximum, participant.id).toBeGreaterThan(0)
    expect(participant.hp.current, participant.id).toBeGreaterThanOrEqual(0)
    expect(participant.hp.temporary, participant.id).toBeGreaterThanOrEqual(0)
    expect(participant.controllerIds.length, participant.id).toBeGreaterThan(0)
  }
  for (const relationship of fixture.relationships ?? []) {
    expect(participantSet.has(relationship.sourceId), relationship.id).toBe(true)
    expect(participantSet.has(relationship.targetId), relationship.id).toBe(true)
    expect(relationship.distance, relationship.id).toBeGreaterThanOrEqual(0)
  }
  for (const offer of fixture.offers) {
    expect(participantSet.has(offer.actorId), offer.id).toBe(true)
    expect(offer.targetIds.every(id => participantSet.has(id)), offer.id).toBe(true)
    expect(VALID_SPATIALITY.has(offer.spatiality), offer.id).toBe(true)
    expect(VALID_AVAILABILITY.has(offer.availability), offer.id).toBe(true)
    expect(offer.availability === 'unavailable' ? Boolean(offer.unavailableReason) : offer.unavailableReason === null, offer.id).toBe(true)
  }
  for (const pending of fixture.pending) {
    expect(participantSet.has(pending.actorId), pending.id).toBe(true)
    expect(pending.parentId === null || pendingSet.has(pending.parentId), pending.id).toBe(true)
    expect(pending.responderIds.length, pending.id).toBeGreaterThan(0)
    expect(pending.optionLabels.length, pending.id).toBeGreaterThan(0)
    expect(pending.publicPrompt.trim(), pending.id).not.toBe('')
    expect(pending.privatePrompt.trim(), pending.id).not.toBe('')
    expect(VALID_SPATIALITY.has(pending.spatiality), pending.id).toBe(true)
    expect(VALID_PENDING_STATUS.has(pending.status), pending.id).toBe(true)
  }
  expect(fixture.accepted.map(entry => entry.sequence)).toEqual(
    [...fixture.accepted].map(entry => entry.sequence).sort((left, right) => left - right),
  )
  for (const accepted of fixture.accepted) {
    expect(accepted.actorId === null || participantSet.has(accepted.actorId), accepted.id).toBe(true)
    expect(accepted.affectedIds.every(id => participantSet.has(id)), accepted.id).toBe(true)
  }
  expect(VALID_CONNECTION.has(fixture.system.connection), fixture.fixtureId).toBe(true)
  for (const audience of fixture.audiences) {
    expect(VALID_ROLES.has(audience.role), audience.id).toBe(true)
    expect(audience.visibleParticipantIds.every(id => participantSet.has(id)), audience.id).toBe(true)
    expect(audience.controlledParticipantIds.every(id => participantSet.has(id)), audience.id).toBe(true)
    expect(audience.authorizedPendingIds.every(id => pendingSet.has(id)), audience.id).toBe(true)
  }
  for (const script of fixture.scripts) {
    expect(script.taskIds.length, script.id).toBeGreaterThan(0)
    expect(script.taskIds.every(id => taskSet.has(id)), script.id).toBe(true)
    expect(script.steps.length, script.id).toBeGreaterThan(0)
    expect(script.expectedTerminal.trim(), script.id).not.toBe('')
  }
}

describe('canonical encounter workspace fixtures', () => {
  it('indexes source-bound, structurally valid canonical fixtures', () => {
    expect(fixtureIndex).toMatchObject({
      schemaVersion: 1,
      fixtureSetId: 'encounter-workspace-canonical-v1',
    })
    expect(fixtureIndex.fixtures).toHaveLength(5)
    expectUniqueStableIds(fixtureIndex.fixtures.map(entry => entry.fixtureId), 'fixture index')
    const plan = readFileSync(resolve(ROOT, 'implementation-plans/done/ENCOUNTER_UI_UX_PLAN.md'), 'utf8')
    for (const entry of fixtureIndex.fixtures) {
      expect(entry.status, entry.fixtureId).toBe('complete')
      expect(plan, entry.sourceTicket).toContain(`**${entry.sourceTicket} `)
      const fixture = loadFixture(entry.path)
      expect(fixture.fixtureId).toBe(entry.fixtureId)
      expect(fixture.sourceTicket).toBe(entry.sourceTicket)
      validateFixture(fixture)
    }
  })

  it('covers simple Trainer duel ownership, direct targeting, unavailable reasons, reserves, and accepted facts', () => {
    const fixture = loadFixture('data/encounter-workspace/fixtures/simple-trainer-duel.json')
    expect(fixture.encounter.sides).toHaveLength(2)
    expect(fixture.participants.filter(participant => participant.reserve)).toHaveLength(2)
    expect(fixture.offers.some(offer => offer.spatiality === 'relationship' && offer.targetIds.length > 0)).toBe(true)
    expect(fixture.offers.some(offer => offer.availability === 'unavailable' && Boolean(offer.unavailableReason))).toBe(true)
    expect(fixture.accepted.length).toBeGreaterThan(0)
    expect(fixture.audiences.filter(audience => audience.role === 'player-owner')).toHaveLength(2)
  })

  it('covers a crowded grouped wild pack, dense initiative, area targeting, capture, and performance scripts', () => {
    const fixture = loadFixture('data/encounter-workspace/fixtures/crowded-wild-pack.json')
    expect(fixture.participants.length).toBeGreaterThanOrEqual(15)
    expect(fixture.encounter.initiativeOrder.length).toBeGreaterThanOrEqual(12)
    const grouped = fixture.participants.filter(participant => participant.groupKey)
    expect(grouped.length).toBeGreaterThanOrEqual(10)
    expect(fixture.offers.some(offer => offer.spatiality === 'exact' && offer.targetIds.length >= 10)).toBe(true)
    expect(fixture.scripts.some(script => script.id === 'pack-capture')).toBe(true)
    expect(fixture.scripts.some(script => script.id === 'pack-large-layout')).toBe(true)
  })

  it('covers boss phases, public and GM objectives, active environment, hidden reinforcements, and adjudication', () => {
    const fixture = loadFixture('data/encounter-workspace/fixtures/boss-phases-environment.json')
    expect(fixture.participants.some(participant => participant.hidden && participant.reserve)).toBe(true)
    expect(fixture.encounter.objectives.some(objective => objective.visibility === 'gm')).toBe(true)
    expect(fixture.map.environment.weather).not.toEqual([])
    expect(fixture.map.environment.terrain).not.toEqual([])
    expect(fixture.map.environment.rooms).not.toEqual([])
    expect(fixture.map.environment.hazards).not.toEqual([])
    expect(fixture.pending).toHaveLength(1)
    const hiddenId = fixture.participants.find(participant => participant.hidden)!.id
    expect(fixture.audiences.find(audience => audience.role === 'gm')?.visibleParticipantIds).toContain(hiddenId)
    expect(fixture.audiences.filter(audience => audience.role !== 'gm').every(audience => !audience.visibleParticipantIds.includes(hiddenId))).toBe(true)
  })

  it('covers nested private responders, public redaction, reconnect, replay gaps, and exact retry', () => {
    const fixture = loadFixture('data/encounter-workspace/fixtures/private-reactions-reconnect.json')
    expect(fixture.pending).toHaveLength(2)
    const parent = fixture.pending.find(pending => pending.parentId === null)!
    const child = fixture.pending.find(pending => pending.parentId === parent.id)!
    expect(parent.status).toBe('pending')
    expect(child.status).toBe('queued')
    const playerAudiences = fixture.audiences.filter(audience => audience.role === 'player-owner')
    expect(playerAudiences).toHaveLength(2)
    expect(playerAudiences.every(audience => audience.authorizedPendingIds.length === 1)).toBe(true)
    expect(new Set(playerAudiences.flatMap(audience => audience.authorizedPendingIds))).toEqual(new Set([parent.id, child.id]))
    expect(fixture.audiences.find(audience => audience.role === 'public')?.authorizedPendingIds).toEqual([])
    expect(fixture.system).toMatchObject({ connection: 'reconnecting', replayGap: true })
    expect(fixture.system.outbox).toMatchObject([{ status: 'uncertain', exactRetryAllowed: true }])
  })

  it('covers mounted Capability movement, Feature interaction, exact routes, relationships, and nested interruption', () => {
    const fixture = loadFixture('data/encounter-workspace/fixtures/capability-movement-feature.json')
    expect(fixture.relationships?.some(relationship => relationship.kind === 'mounted' && relationship.distance === 0)).toBe(true)
    expect([...new Set(fixture.offers.map(offer => offer.sourceKind))]).toEqual(expect.arrayContaining(['capability', 'feature', 'move']))
    expect(fixture.offers.filter(offer => offer.spatiality === 'exact').length).toBeGreaterThanOrEqual(3)
    const parent = fixture.pending.find(pending => pending.parentId === null)!
    expect(fixture.pending.some(pending => pending.parentId === parent.id && pending.status === 'queued')).toBe(true)
    expect(fixture.scripts.some(script => script.id === 'feature-modifies-capability-movement')).toBe(true)
  })
})
