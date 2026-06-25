import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readSource = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')

describe('map page live-play command recovery integration', () => {
  it('wires context-scoped startup recovery into the new-command gate and displayed readiness', () => {
    const mapPage = readSource('src/pages/maps/[slug].vue')

    expect(mapPage).toContain("import LivePlayCommandRecoveryPanel from '~/components/map/LivePlayCommandRecoveryPanel.vue'")
    expect(mapPage).toContain("import { useLivePlayCommandRecoveryGate } from '~/composables/map-editor/useLivePlayCommandRecoveryGate'")
    expect(mapPage).toContain('newCommandBlocked: livePlayRecoveryNewCommandBlocked')
    expect(mapPage).toContain('newCommandBlockedMessage: livePlayRecoveryNewCommandBlockedMessage')
    expect(mapPage).toContain("if (role.value === 'gm') return `${slug}:gm`")
    expect(mapPage).toContain("if (role.value === 'player') return `${slug}:player:${selectedProfileId.value ?? 'none'}`")
    expect(mapPage).toContain('recoverInterrupted: livePlayCommands.recoverInterruptedOutboxCommands')
    expect(mapPage).toContain('refresh: livePlayCommands.refreshOutboxEntries')
    expect(mapPage).toContain('retry: livePlayCommands.retryOutboxCommand')
    expect(mapPage).toContain('const livePlayCommandsAllowed = computed')
    expect(mapPage).toContain('&& !livePlayCommandRecoveryGate.blocksNewLiveCommands.value')
    expect(mapPage).toContain('return livePlayCommandsAllowed.value ? controllablePlacementIds.value : []')
    expect(mapPage).toContain("if (!livePlayCommandRecoveryGate.readyForCurrentContext.value) return 'reconciling'")
    expect(mapPage).toContain("if (livePlayCommands.outboxEntries.value.length > 0) return 'stale'")
    expect(mapPage).toContain("if (livePlayCommandRecoveryGate.retryingOpId.value) return 'saving-command'")
  })

  it('renders the retry panel without adding discard or automatic resend controls', () => {
    const mapPage = readSource('src/pages/maps/[slug].vue')
    const panel = readSource('src/components/map/LivePlayCommandRecoveryPanel.vue')

    expect(mapPage).toContain('<LivePlayCommandRecoveryPanel')
    expect(mapPage).toContain('@refresh="refreshLivePlayCommandRecovery"')
    expect(mapPage).toContain('@retry="retryLivePlayCommandRecoveryEntry"')
    expect(mapPage).toContain('void livePlayCommandRecoveryGate.retryEntry(opId).catch(() => undefined)')
    expect(panel).toContain('Retry reuses the original operation ID')
    expect(panel).toContain('server is idempotent')
    expect(panel).toContain('Switch to Run Live Play to retry pending live-play commands.')
    expect(panel).toContain('Another tab or page instance may own this send lease')
    expect(mapPage).not.toContain('.discard(')
    expect(panel).not.toContain('Forget')
    expect(panel).not.toContain('Dismiss operation')
  })
})
