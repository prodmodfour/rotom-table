/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LivePlayLatencyDebugPanel from '~/components/map/LivePlayLatencyDebugPanel.vue'
import {
  LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES,
  type LivePlayCommandTraceEvent,
  type LivePlayCommandTraceSnapshot,
} from '~/utils/livePlayCommandTrace'

const event = (
  type: LivePlayCommandTraceEvent['type'],
  sequence: number,
  timestamp: number,
): LivePlayCommandTraceEvent => ({ type, sequence, timestamp })

const trace = (overrides: Partial<LivePlayCommandTraceSnapshot> & Pick<LivePlayCommandTraceSnapshot, 'opId' | 'events'>): LivePlayCommandTraceSnapshot => {
  const { opId, events, ...rest } = overrides
  const first = events[0]
  const last = events[events.length - 1]
  return {
    opId,
    requestPath: '/api/maps/token/move',
    commandType: 'moveToken',
    baseRevision: 4,
    resourceSummary: 'token …ikachu position',
    status: 'pending',
    firstSequence: first?.sequence ?? 0,
    lastSequence: last?.sequence ?? 0,
    startedAt: first?.timestamp ?? 0,
    updatedAt: last?.timestamp ?? 0,
    events,
    ...rest,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('LivePlayLatencyDebugPanel', () => {
  it('renders useful latency timings from the latest command traces', () => {
    const olderTrace = trace({
      opId: 'op_private_profile_secret_abcdef12',
      commandType: 'moveToken',
      status: 'confirmed',
      resourceSummary: 'token …ikachu position',
      events: [
        event(LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.BUILT, 1, 100),
        event(LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.PREDICTED, 2, 120),
        event(LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.SSE_TERMINAL, 3, 180),
        event(LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.PATCH_ADOPTED, 4, 210),
        event(LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.CONFIRMED, 5, 230),
      ],
    })
    const latestTrace = trace({
      opId: 'op_payload_sheet_secret_zzzz9999',
      commandType: 'turnToken',
      status: 'confirmed',
      resourceSummary: 'token …ikachu facing',
      events: [
        event(LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.BUILT, 6, 300),
        event(LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.PREDICTED, 7, 325),
        event(LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.HTTP_TERMINAL, 8, 390),
        event(LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.PATCH_ADOPTED, 9, 440),
        event(LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.CONFIRMED, 10, 460),
      ],
    })

    const wrapper = mount(LivePlayLatencyDebugPanel, {
      props: {
        maxRows: 1,
        traces: {
          [olderTrace.opId]: olderTrace,
          [latestTrace.opId]: latestTrace,
        },
      },
    })

    expect(wrapper.text()).toContain('Live-play latency')
    expect(wrapper.text()).toContain('turnToken')
    expect(wrapper.text()).toContain('token …ikachu facing')
    expect(wrapper.text()).toContain('…zzzz9999')
    expect(wrapper.text()).toContain('Pred → HTTP')
    expect(wrapper.text()).toContain('65 ms')
    expect(wrapper.text()).toContain('HTTP → adopt')
    expect(wrapper.text()).toContain('50 ms')
    expect(wrapper.text()).toContain('Total')
    expect(wrapper.text()).toContain('160 ms')
    expect(wrapper.text()).not.toContain('moveToken')
  })

  it('does not render command payloads, profile IDs, sheet payloads, or full operation IDs', () => {
    const redactedTrace = trace({
      opId: 'op_profile_secret_payload_sheet_12345678',
      commandType: 'modifyHp',
      status: 'confirmed',
      resourceSummary: 'pokemon sheet hp',
      events: [
        event(LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.BUILT, 1, 1_000),
        event(LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.PREDICTED, 2, 1_050),
        event(LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.HTTP_TERMINAL, 3, 1_130),
        event(LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.PATCH_ADOPTED, 4, 1_170),
        event(LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.CONFIRMED, 5, 1_200),
      ],
    })

    const wrapper = mount(LivePlayLatencyDebugPanel, {
      props: { traces: { [redactedTrace.opId]: redactedTrace } },
    })
    const text = wrapper.text()

    expect(text).toContain('modifyHp')
    expect(text).toContain('pokemon sheet hp')
    expect(text).toContain('…12345678')
    expect(text).not.toContain('profile_secret')
    expect(text).not.toContain('payload_sheet')
    expect(text).not.toContain(redactedTrace.opId)
    expect(text).not.toContain('payload')
    expect(text).not.toContain('sheet: {')
  })

  it('renders presence freshness metrics without exposing presence payload internals', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)

    const wrapper = mount(LivePlayLatencyDebugPanel, {
      props: {
        traces: {},
        presenceMetrics: {
          lastHeartbeatAt: 8_750,
          lastSnapshotAt: 7_500,
          lastTransientAt: null,
          activeParticipantCount: 3,
        },
      },
    })
    await nextTick()
    const text = wrapper.text()

    expect(text).toContain('Presence freshness')
    expect(text).toContain('Heartbeat age')
    expect(text).toContain('1.3 s')
    expect(text).toContain('Last snapshot age')
    expect(text).toContain('2.5 s')
    expect(text).toContain('Last transient age')
    expect(text).toContain('—')
    expect(text).toContain('Active participants')
    expect(text).toContain('3')
    expect(text).not.toContain('profile_')
    expect(text).not.toContain('clientIdSuffix')
    expect(text).not.toContain('selectedTokenId')

    wrapper.unmount()
  })

  it('renders token motion metrics without exposing token identities', () => {
    const wrapper = mount(LivePlayLatencyDebugPanel, {
      props: {
        traces: {},
        tokenMotionMetrics: {
          activeMovingTokenCount: 2,
          longestActiveMotionAgeMs: 450,
          completedMotionCount: 7,
          sourceReasonCounts: [
            { reason: 'local-prediction', activeCount: 1, startedCount: 3, completedCount: 2 },
            { reason: 'remote-accepted', activeCount: 1, startedCount: 4, completedCount: 3 },
            { reason: 'server-correction', activeCount: 0, startedCount: 1, completedCount: 1 },
          ],
        },
      },
    })
    const text = wrapper.text()

    expect(text).toContain('Token motion')
    expect(text).toContain('Presentation-only renderer state')
    expect(text).toContain('Active tokens')
    expect(text).toContain('2')
    expect(text).toContain('Longest active age')
    expect(text).toContain('450 ms')
    expect(text).toContain('Completed motions')
    expect(text).toContain('7')
    expect(text).toContain('Local prediction')
    expect(text).toContain('1 active · 3 started · 2 done')
    expect(text).toContain('Remote accepted')
    expect(text).toContain('1 active · 4 started · 3 done')
    expect(text).not.toContain('token_secret')
    expect(text).not.toContain('Pikachu')
    expect(text).not.toContain('placementId')
  })

  it('renders an empty state when no traces are available', () => {
    const wrapper = mount(LivePlayLatencyDebugPanel, {
      props: { traces: {} },
    })

    expect(wrapper.text()).toContain('No live-play command traces recorded yet.')
    expect(wrapper.text()).not.toContain('Presence freshness')
  })
})
