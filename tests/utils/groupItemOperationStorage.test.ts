/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearPendingGroupItemOperation,
  loadPendingGroupItemOperation,
  retainPendingGroupItemOperation,
} from '~/utils/groupItemOperationStorage'
import type { UseItemCommandV1 } from '#shared/itemAutomation/operations'

const command = (): UseItemCommandV1 => ({
  schemaVersion: 1,
  operationId: 'group-sheet-item:v1:11111111111111111111111111111111',
  context: 'sheet', offerId: 'offer:shared-potion',
  sourceInstanceId: 'item-instance:group:main:medicalKit:private-row', actorParticipantId: null,
  actorSheet: { kind: 'trainer', slug: 'ash', expectedRevision: 3 },
  source: { kind: 'group', slug: 'main', section: 'medicalKit', rowId: 'private-row', expectedRevision: 4 },
  targetIds: ['sheet-target:v1:pokemon:pikachu'],
  choices: [{ choiceId: 'target', optionIds: ['sheet-target:v1:pokemon:pikachu'] }],
  readSet: [
    { kind: 'campaign-clock', id: 'campaign', revision: 0 },
    { kind: 'group-inventory', id: 'main', revision: 4 },
    { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 3 },
    { kind: 'sheet', sheetKind: 'pokemon', id: 'pikachu', revision: 2 },
  ],
})

afterEach(() => {
  window.sessionStorage.clear()
  window.localStorage.clear()
})

describe('group item pending operation storage', () => {
  it('retains only one exact profile-bound shared-source declaration and clears by operation identity', () => {
    retainPendingGroupItemOperation({
      schemaVersion: 1, groupSlug: 'main', profileId: 'profile_group_item_01', command: command(),
    })
    expect(loadPendingGroupItemOperation('main')).toMatchObject({
      profileId: 'profile_group_item_01',
      command: { source: { kind: 'group', slug: 'main', rowId: 'private-row' } },
    })
    clearPendingGroupItemOperation('main', 'another-operation')
    expect(loadPendingGroupItemOperation('main')).not.toBeNull()
    clearPendingGroupItemOperation('main', command().operationId)
    expect(loadPendingGroupItemOperation('main')).toBeNull()
  })

  it('deletes malformed, expanded, Trainer-source, or wrong-group state', () => {
    const key = 'rotom-table:group-item:pending:v1:main'
    for (const value of [
      { schemaVersion: 1, groupSlug: 'main', profileId: null, command: command(), privateRowId: 'leak' },
      { schemaVersion: 1, groupSlug: 'other', profileId: null, command: command() },
      {
        schemaVersion: 1, groupSlug: 'main', profileId: null,
        command: {
          ...command(),
          sourceInstanceId: 'item-instance:trainer:ash:medicalKit:private-row',
          source: { kind: 'trainer', slug: 'ash', section: 'medicalKit', rowId: 'private-row', expectedRevision: 3 },
        },
      },
    ]) {
      window.sessionStorage.setItem(key, JSON.stringify(value))
      expect(loadPendingGroupItemOperation('main')).toBeNull()
      expect(window.sessionStorage.getItem(key)).toBeNull()
    }
  })
})
