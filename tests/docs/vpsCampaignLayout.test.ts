import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const readProductFile = (...segments: string[]) => readFileSync(join(process.cwd(), ...segments), 'utf8')

const expectedVpsPaths = [
  '/srv/rotom-table/app',
  '/srv/rotom-table/campaign',
  '/srv/rotom-table/backups',
]

const expectedCampaignSubfolders = [
  'data/maps/',
  'data/sheets/',
  'data/trainers/',
  'data/player-profiles/',
  'data/reference-overrides/',
  'encounter_tables/',
]

describe('VPS campaign data layout docs', () => {
  it('documents the app, campaign, and backup directories for private VPS hosting', () => {
    const privateVpsDoc = readProductFile('docs/private-vps-hosting.md')

    for (const path of expectedVpsPaths) {
      expect(privateVpsDoc).toContain(path)
    }

    for (const subfolder of expectedCampaignSubfolders) {
      expect(privateVpsDoc).toContain(subfolder)
    }
  })

  it('keeps ROTOM_CAMPAIGN_ROOT and private app-checkout boundaries clear', () => {
    const campaignRepositoriesDoc = readProductFile('docs/campaign-repositories.md')
    const privateVpsDoc = readProductFile('docs/private-vps-hosting.md')

    expect(campaignRepositoriesDoc).toContain('ROTOM_CAMPAIGN_ROOT=/srv/rotom-table/campaign')
    expect(privateVpsDoc).toContain('ROTOM_CAMPAIGN_ROOT=/srv/rotom-table/campaign')
    expect(campaignRepositoriesDoc).toContain('Do not put private campaign JSON')
    expect(campaignRepositoriesDoc).toContain('app checkout at `/srv/rotom-table/app`')
    expect(privateVpsDoc).toContain('Do not store private maps, sheets, trainers, player profiles, campaign-specific reference overrides, encounter tables, backups, or unreleased campaign notes')
  })
})
