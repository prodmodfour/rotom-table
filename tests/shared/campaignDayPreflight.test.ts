import { describe, expect, it } from 'vitest'
import { parseCampaignDayPreflightProjection } from '../../shared/campaignDayPreflight'

const impact = () => ({
  totalSheets: 2,
  affectedSheetCount: 1,
  affectedSheets: [{ kind: 'pokemon', label: 'Sparky', href: '/sheets/pokemon/sparky', changes: ['hit-points', 'injury'] }],
  additionalAffectedSheets: 0,
  pokemonAffected: 1,
  trainerAffected: 0,
  hitPointsRestored: 12,
  injuriesHealed: 1,
  conditionsCleared: 1,
  dailyMoveUsesCleared: 1,
  dailyMoveEntriesCleared: 1,
  trainerApRestored: 0,
  reconciledEggs: 1,
  creditedEggCampaignMinutes: 1440,
  skippedPausedEggCampaignMinutes: 0,
  expiredEffects: 1,
})
const ready = () => ({
  schemaVersion: 1,
  state: 'ready',
  preflightId: `campaign-day-preflight:v1:${'a'.repeat(64)}`,
  clock: { currentCampaignMinute: 100, targetCampaignMinute: 1540, minutesAdvanced: 1440 },
  blockers: [],
  impact: impact(),
  accepted: null,
})

describe('campaign-day preflight projection contract', () => {
  it('accepts exact ready, blocked, and recovered-accepted states', () => {
    expect(parseCampaignDayPreflightProjection(ready()).state).toBe('ready')
    expect(parseCampaignDayPreflightProjection({
      ...ready(),
      state: 'blocked',
      blockers: [{
        kind: 'attention', reason: 'team-overflow', label: 'Team capacity work',
        count: 1, href: '/sheets/trainers/mira',
      }],
    }).state).toBe('blocked')
    const acceptedImpact = { ...impact(), affectedSheets: [], additionalAffectedSheets: 1 }
    expect(parseCampaignDayPreflightProjection({
      ...ready(),
      state: 'already-accepted', preflightId: null, blockers: [], impact: acceptedImpact,
      accepted: { replayed: true, impact: acceptedImpact },
    }).accepted?.replayed).toBe(true)
  })

  it('rejects unknown fields, external links, divergent counts, malformed identities, and contradictory lifecycle state', () => {
    expect(() => parseCampaignDayPreflightProjection({ ...ready(), operationId: 'private' })).toThrow('must contain exactly')
    expect(() => parseCampaignDayPreflightProjection({
      ...ready(), impact: { ...impact(), affectedSheetCount: 2 },
    })).toThrow('sheet counts must reconcile exactly')
    expect(() => parseCampaignDayPreflightProjection({
      ...ready(), impact: { ...impact(), affectedSheets: [{ ...impact().affectedSheets[0], href: 'https://example.test' }] },
    })).toThrow('app-relative route')
    expect(() => parseCampaignDayPreflightProjection({ ...ready(), preflightId: 'preflight:1' })).toThrow('malformed')
    expect(() => parseCampaignDayPreflightProjection({ ...ready(), state: 'blocked' })).toThrow('blocked state')
  })

  it('rejects raw row identity fields and duplicate or empty change evidence', () => {
    expect(() => parseCampaignDayPreflightProjection({
      ...ready(),
      impact: {
        ...impact(),
        affectedSheets: [{ ...impact().affectedSheets[0], slug: 'private-slug' }],
      },
    })).toThrow('must contain exactly')
    expect(() => parseCampaignDayPreflightProjection({
      ...ready(),
      impact: { ...impact(), affectedSheets: [{ ...impact().affectedSheets[0], changes: [] }] },
    })).toThrow('non-empty bounded array')
  })
})
