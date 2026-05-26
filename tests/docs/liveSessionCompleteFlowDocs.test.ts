import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readText = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')

const userFlowDocs = [
  ['LAN hosting runbook', 'docs/live-session-lan-hosting.md'],
  ['named tunnel runbook', 'docs/live-session-cloudflare-tunnel-hosting.md'],
  ['session lobby guide', 'docs/live-session-lobby.md'],
  ['session map attachment guide', 'docs/live-session-map-attachment.md'],
  ['session map client guide', 'docs/live-session-client-integration.md'],
  ['deployment smoke checklist', 'docs/live-session-deployment-smoke-checklist.md'],
] as const

const commonFailureStates = [
  'Host flag disabled',
  'No map attached',
  'No token assigned',
  'Stale revision',
  'Disconnected socket',
] as const

describe('complete live-session user flow documentation', () => {
  it('keeps the attach, assign, and open flow visible in primary user docs', () => {
    for (const [label, path] of userFlowDocs) {
      const text = readText(path)

      expect(text, `${label} documents map attachment`).toContain('Attach current map to live session')
      expect(text, `${label} documents token assignment`).toContain('Assign map tokens')
      expect(text, `${label} documents player map discovery`).toContain('Visible session maps')
      expect(text, `${label} documents explicit session map routes`).toContain('?session=1')
    }
  })

  it('documents common failure states without telling users to bypass session authority', () => {
    for (const [label, path] of userFlowDocs) {
      const text = readText(path)

      for (const failureState of commonFailureStates) {
        expect(text, `${label} documents ${failureState}`).toContain(failureState)
      }

      expect(text, `${label} keeps session command authority visible`).toMatch(/session (command|socket|map)/i)
    }
  })
})
