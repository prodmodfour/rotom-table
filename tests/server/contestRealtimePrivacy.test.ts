import { describe, expect, it } from 'vitest'
import { createContestDocument } from '../../shared/contests/document'
import { contestRealtimeAppendInputs } from '../../server/realtime/contestRealtime'
import { evaluateRealtimeEventAccess, type RealtimeEventAccessDependencies } from '../../server/realtime/realtimeEventAccessPolicy'
import type { PersistedRealtimeEvent } from '../../shared/realtimeEventLog'

const dependencies: RealtimeEventAccessDependencies = { getMap: () => null, getSheet: () => null, listTrainerSheets: () => [], playerVisibleMapSheetAccessKeys: () => new Set() }
const event: PersistedRealtimeEvent = { sequence: 1, eventId: 'event-1', timestamp: 1, event: { channel: 'contest:test', type: 'contest.setup.changed', data: {} }, access: { kind: 'contest-access', contestId: 'contest:v1:privacy', audience: 'public', profileId: null } }
const profile = { id: 'profile_owner001', displayName: 'Owner', linkedCharacters: [], createdAt: 1, updatedAt: 1 } as any
const other = { ...profile, id: 'profile_other001' }

describe('Contest realtime structural privacy', () => {
  it('publishes role-targeted refresh signals without private document payloads', () => {
    const base = createContestDocument({ contestId: 'contest:v1:privacy', name: 'Privacy', hallName: 'Hall', description: '', variantId: 'standard', contestTypeId: 'cute', significanceMultiplier: 1, awardRibbon: true, prize: { declared: false, money: 999, items: [], notes: 'secret prize' }, gmNotes: 'secret gm note', now: 1 })
    const document = { ...base, contestants: [{ controller: { kind: 'profile', profileId: profile.id } }] } as any
    const inputs = contestRealtimeAppendInputs({ document, commandKind: 'update-settings', operationId: 'contest-op:v1:privacy-event', clientId: 'client', timestamp: 2 })
    expect(inputs).toHaveLength(3)
    expect(inputs.map(row => row.access.audience)).toEqual(['public','gm','owner'])
    expect(JSON.stringify(inputs)).not.toContain('secret gm note')
    expect(JSON.stringify(inputs)).not.toContain('secret prize')
    expect(JSON.stringify(inputs)).not.toContain('999')
  })

  it('allows public replay, exact owner replay, and GM replay only to their principals', () => {
    const decide = (access: PersistedRealtimeEvent['access'], principal: any) => evaluateRealtimeEventAccess({ access, principal, event: { ...event, access }, dependencies })
    expect(decide({ kind: 'contest-access', contestId: 'contest:v1:privacy', audience: 'public', profileId: null }, { role: 'player', playerProfile: other }).allowed).toBe(true)
    expect(decide({ kind: 'contest-access', contestId: 'contest:v1:privacy', audience: 'gm', profileId: null }, { role: 'gm' }).allowed).toBe(true)
    expect(decide({ kind: 'contest-access', contestId: 'contest:v1:privacy', audience: 'gm', profileId: null }, { role: 'player', playerProfile: profile }).allowed).toBe(false)
    expect(decide({ kind: 'contest-access', contestId: 'contest:v1:privacy', audience: 'owner', profileId: profile.id }, { role: 'player', playerProfile: profile }).allowed).toBe(true)
    expect(decide({ kind: 'contest-access', contestId: 'contest:v1:privacy', audience: 'owner', profileId: profile.id }, { role: 'player', playerProfile: other }).allowed).toBe(false)
    expect(decide({ kind: 'contest-access', contestId: 'contest:v1:privacy', audience: 'owner', profileId: profile.id }, { role: 'gm' }).allowed).toBe(false)
  })
})
