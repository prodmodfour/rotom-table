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
    expect(mapPage).toContain('checkStatus: livePlayCommands.checkOutboxCommandStatus')
    expect(mapPage).toContain('abandon: livePlayCommands.abandonOutboxCommand')
    expect(mapPage).toContain('const livePlayStateBlocksCommands = computed')
    expect(mapPage).toContain('const livePlayCommandsAllowed = computed')
    expect(mapPage).not.toContain("&& livePlayCommands.status.value !== 'saving'")
    expect(mapPage).toContain('&& !livePlayStateBlocksCommands.value')
    expect(mapPage).toContain('&& !livePlayCommandRecoveryGate.blocksNewLiveCommands.value')
    expect(mapPage).toContain('return livePlayCommandsAllowed.value ? controllablePlacementIds.value : []')
    expect(mapPage).toContain('const livePlayGlobalTransportPending = computed(() => (')
    expect(mapPage).toContain("if (livePlayGlobalTransportPending.value) return 'saving-command'")
    expect(mapPage).toContain("if (livePlayCommands.outboxRecoveryStatus.value === 'abandoning') return 'saving-command'")
    expect(mapPage).toContain("if (livePlayCommands.outboxRecoveryStatus.value === 'synchronizing') return 'reconciling'")
    expect(mapPage).toContain("if (!livePlayCommandRecoveryGate.readyForCurrentContext.value) return 'reconciling'")
    expect(mapPage).toContain("if (livePlayCommands.outboxEntries.value.length > 0) return 'stale'")
    expect(mapPage).toContain("if (livePlayCommandRecoveryGate.retryingOpId.value) return 'saving-command'")
    expect(mapPage).toContain("if (livePlayCommandRecoveryGate.abandoningOpId.value) return 'saving-command'")
  })

  it('wires accepted realtime command events through safe acknowledgement indirection', () => {
    const mapPage = readSource('src/pages/maps/[slug].vue')

    expect(mapPage).toContain("import type { LivePlayAcceptedRealtimeEvent } from '#shared/livePlayRealtimeEvents'")
    expect(mapPage).toContain('queuedAcceptedRealtimeEvents')
    expect(mapPage).toContain('onLivePlayCommandAcceptedEvent: (event) => acknowledgeAcceptedRealtimeEvent(event)')
    expect(mapPage).toContain('acceptedRealtimeAcknowledgementHandler = livePlayCommands.acknowledgeAcceptedRealtimeEvent')
    expect(mapPage).toContain('void acknowledgeAcceptedRealtimeEvent(event).catch')
  })

  it('renders the retry panel without adding discard or automatic resend controls', () => {
    const mapPage = readSource('src/pages/maps/[slug].vue')
    const panel = readSource('src/components/map/LivePlayCommandRecoveryPanel.vue')

    expect(mapPage).toContain('<LivePlayCommandRecoveryPanel')
    expect(mapPage).toContain('@refresh="refreshLivePlayCommandRecovery"')
    expect(mapPage).toContain('@retry="retryLivePlayCommandRecoveryEntry"')
    expect(mapPage).toContain('@check-status="checkLivePlayCommandRecoveryEntryStatus"')
    expect(mapPage).toContain('@request-abandon-confirmation="requestLivePlayCommandAbandonConfirmation"')
    expect(mapPage).toContain('@confirm-abandon="confirmLivePlayCommandAbandonment"')
    expect(mapPage).toContain(':checking-op-id="livePlayCommandRecoveryGate.checkingOpId.value"')
    expect(mapPage).toContain(':confirming-abandon-op-id="livePlayCommandRecoveryGate.confirmingAbandonOpId.value"')
    expect(mapPage).toContain(':abandoning-op-id="livePlayCommandRecoveryGate.abandoningOpId.value"')
    expect(mapPage).toContain(':resolution-notice="livePlayCommandRecoveryGate.resolutionNotice.value"')
    expect(mapPage).toContain(':status-result-by-op-id="livePlayCommandRecoveryGate.statusResultByOpId.value"')
    expect(mapPage).toContain('void livePlayCommandRecoveryGate.retryEntry(opId).catch(() => undefined)')
    expect(mapPage).toContain('void livePlayCommandRecoveryGate.checkEntry(opId).catch(() => undefined)')
    expect(mapPage).toContain('void livePlayCommandRecoveryGate.confirmAbandon(opId).catch(() => undefined)')
    expect(panel).toContain('Retry reuses the original operation ID')
    expect(panel).toContain('server is idempotent')
    expect(panel).toContain('Switch to Run Live Play to retry pending live-play commands.')
    expect(panel).toContain('Another tab or page instance may own this send lease')
    expect(panel).toContain('Check server')
    expect(panel).toContain('Check whether operation')
    expect(panel).toContain('Abandon…')
    expect(panel).toContain('Abandoning does not undo an operation that already committed')
    expect(mapPage).not.toContain('.discard(')
    expect(panel).not.toContain('Forget')
    expect(panel).not.toContain('Dismiss operation')
  })
})
