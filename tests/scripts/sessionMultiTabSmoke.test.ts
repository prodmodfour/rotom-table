import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BASE_URL,
  FOCUSED_SMOKE_TESTS,
  SESSION_HOST_ENABLE_ENV,
  SESSION_HOST_ENABLE_VALUE,
  SmokeCliError,
  buildAutomatedCheckCommand,
  buildSmokeChecklist,
  buildSmokeUrls,
  openerForPlatform,
  parseSmokeCliArgs,
} from '../../scripts/session-multi-tab-smoke.mjs'

describe('Live session multi-tab smoke helper', () => {
  it('builds safe default lobby URLs and a map chooser without requiring secrets', () => {
    const urls = buildSmokeUrls()

    expect(urls.map((entry) => entry.key)).toEqual([
      'gm-login',
      'gm-lobby',
      'player-lobby',
      'map-library',
    ])
    expect(urls.map((entry) => entry.url)).toEqual([
      `${DEFAULT_BASE_URL}/login`,
      `${DEFAULT_BASE_URL}/sessions#gm-lobby-title`,
      `${DEFAULT_BASE_URL}/sessions#player-lobby-title`,
      `${DEFAULT_BASE_URL}/maps`,
    ])
    expect(urls.every((entry) => !entry.url.includes('gmKey') && !entry.url.includes('joinCode'))).toBe(true)
  })

  it('opens explicit session-map URLs for GM and isolated player profiles when a map slug is supplied', () => {
    const urls = buildSmokeUrls({
      baseUrl: 'http://127.0.0.1:3000/',
      mapSlug: 'smoke arena',
      playerTabs: 2,
    })

    expect(urls.map((entry) => entry.key)).toEqual([
      'gm-login',
      'gm-lobby',
      'player-lobby',
      'gm-local-map',
      'gm-session-map',
      'player-1-session-map',
      'player-2-session-map',
    ])
    expect(urls.find((entry) => entry.key === 'gm-local-map')?.url).toBe(
      'http://127.0.0.1:3000/maps/smoke%20arena',
    )
    expect(urls.filter((entry) => entry.url.endsWith('/maps/smoke%20arena?session=1'))).toHaveLength(3)
    expect(urls.filter((entry) => entry.profile === 'player')).toHaveLength(3)
  })

  it('prints a verification checklist for command patches, rejections, reconnect, and cleanup', () => {
    const checklist = buildSmokeChecklist({ mapSlug: 'arena-map' }).join('\n')

    expect(checklist).toContain('npm run dev:session:lan')
    expect(checklist).toContain(`${SESSION_HOST_ENABLE_ENV}=${SESSION_HOST_ENABLE_VALUE} npm run dev`)
    expect(checklist).toContain('separate browser profiles')
    expect(checklist).toContain('/maps/arena-map?session=1')
    expect(checklist).toContain('move or turn one token')
    expect(checklist).toContain('server patch')
    expect(checklist).toContain('without a whole-map save')
    expect(checklist).toContain('stale')
    expect(checklist).toContain('reconnect')
    expect(checklist).toContain('do not commit generated data/sessions/')
    expect(checklist).not.toContain('Quick Tunnel')
  })

  it('locks the focused automated smoke command to server fanout and client integration tests', () => {
    const command = buildAutomatedCheckCommand()

    expect(command).toEqual({
      command: 'npm',
      args: ['test', '--', ...FOCUSED_SMOKE_TESTS],
    })
    for (const testPath of FOCUSED_SMOKE_TESTS) {
      expect(existsSync(join(process.cwd(), testPath))).toBe(true)
    }
  })

  it('parses CLI options without opening browsers in test mode', () => {
    expect(parseSmokeCliArgs([
      '--base-url',
      'http://localhost:4173',
      '--map',
      'arena-map',
      '--player-tabs',
      '2',
      '--no-open',
      '--skip-checks',
      '--browser',
      'chromium --new-window',
    ])).toMatchObject({
      baseUrl: 'http://localhost:4173',
      mapSlug: 'arena-map',
      playerTabs: 2,
      openBrowser: false,
      runChecks: false,
      browserCommand: 'chromium --new-window',
    })

    expect(() => parseSmokeCliArgs(['--player-tabs', '0'])).toThrow(SmokeCliError)
    expect(() => buildSmokeUrls({ baseUrl: 'ftp://localhost:3000' })).toThrow(SmokeCliError)
  })

  it('uses platform openers while allowing a custom browser command', () => {
    expect(openerForPlatform('darwin')('http://localhost:3000')).toEqual({
      command: 'open',
      args: ['http://localhost:3000'],
      shell: false,
    })
    expect(openerForPlatform('win32')('http://localhost:3000')).toEqual({
      command: 'cmd',
      args: ['/c', 'start', '', 'http://localhost:3000'],
      shell: false,
    })
    expect(openerForPlatform('linux')('http://localhost:3000')).toEqual({
      command: 'xdg-open',
      args: ['http://localhost:3000'],
      shell: false,
    })
    expect(openerForPlatform('linux', 'chromium --new-window')('http://localhost:3000')).toEqual({
      command: 'chromium --new-window',
      args: ['http://localhost:3000'],
      shell: true,
    })
  })
})
