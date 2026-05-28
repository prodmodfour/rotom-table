import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SESSION_HOST_PORT,
  SESSION_HOST_ENABLE_ENV,
  SESSION_HOST_ENABLE_VALUE,
  SessionHostCliError,
  buildSessionHostChecklist,
  buildSessionHostDevCommand,
  formatSessionHostDevCommand,
  parseSessionHostCliArgs,
  resolveSessionHostConfig,
} from '../../scripts/session-host-dev.mjs'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

describe('live session host dev helper', () => {
  it('resolves the LAN script to the explicit session flag and LAN bind address', () => {
    const config = resolveSessionHostConfig({ mode: 'lan' })
    const command = buildSessionHostDevCommand(config)

    expect(config).toMatchObject({
      mode: 'lan',
      host: '0.0.0.0',
      port: DEFAULT_SESSION_HOST_PORT,
      envName: SESSION_HOST_ENABLE_ENV,
      envValue: SESSION_HOST_ENABLE_VALUE,
      nuxtArgs: ['--host', '0.0.0.0', '--port', '3000'],
    })
    expect(command).toMatchObject({
      command: 'npm',
      args: ['run', 'dev', '--', '--host', '0.0.0.0', '--port', '3000'],
      env: { [SESSION_HOST_ENABLE_ENV]: SESSION_HOST_ENABLE_VALUE },
    })
    expect(formatSessionHostDevCommand(config)).toBe(
      'ROTOM_ENABLE_SESSION_HOST=1 npm run dev -- --host 0.0.0.0 --port 3000',
    )
  })

  it('resolves the named-tunnel script to loopback binding by default', () => {
    const config = resolveSessionHostConfig({ mode: 'tunnel', port: 3001 })

    expect(config).toMatchObject({
      mode: 'tunnel',
      host: '127.0.0.1',
      port: 3001,
      nuxtArgs: ['--host', '127.0.0.1', '--port', '3001'],
    })
    expect(formatSessionHostDevCommand(config)).toBe(
      'ROTOM_ENABLE_SESSION_HOST=1 npm run dev -- --host 127.0.0.1 --port 3001',
    )
  })

  it('parses CLI options and rejects unsafe/ambiguous values before spawning Nuxt', () => {
    expect(parseSessionHostCliArgs(['--mode', 'tunnel', '--port', '4000', '--print-only'])).toEqual({
      mode: 'tunnel',
      port: 4000,
      printOnly: true,
      help: false,
    })
    expect(parseSessionHostCliArgs(['--dry-run'])).toMatchObject({ printOnly: true })

    expect(() => parseSessionHostCliArgs(['--mode', 'quick-tunnel'])).toThrow(SessionHostCliError)
    expect(() => parseSessionHostCliArgs(['--port', '0'])).toThrow(SessionHostCliError)
    expect(() => parseSessionHostCliArgs(['--host', '0.0.0.0'])).toThrow(SessionHostCliError)
    expect(() => parseSessionHostCliArgs(['--mode'])).toThrow(SessionHostCliError)
  })

  it('prints no-secret safety guidance for supported LAN and named-tunnel hosting only', () => {
    const checklist = buildSessionHostChecklist({ mode: 'lan' }).join('\n')

    expect(checklist).toContain('ROTOM_ENABLE_SESSION_HOST=1')
    expect(checklist).toContain('0.0.0.0:3000')
    expect(checklist).toContain('/sessions#player-lobby-title')
    expect(checklist).toContain('/maps/<slug>')
    expect(checklist).not.toContain('/maps/<slug>?session=1')
    expect(checklist).toContain('not public authentication')
    expect(checklist).toContain('WebSocket /api/sessions/socket')
    expect(checklist).toContain('server-authoritative commands')
    expect(checklist).toContain('Quick Tunnel remains development-smoke-test only')
    expect(checklist).toContain('data/sessions/')
    expect(checklist).not.toContain('gmKey=')
    expect(checklist).not.toContain('joinCode=')
  })

  it('exposes npm scripts for the safe host modes without replacing the plain local dev script', () => {
    const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'))

    expect(packageJson.scripts.dev).toBe('nuxt dev')
    expect(packageJson.scripts['dev:session:lan']).toBe('node scripts/session-host-dev.mjs --mode lan')
    expect(packageJson.scripts['dev:session:tunnel']).toBe('node scripts/session-host-dev.mjs --mode tunnel')
  })
})
