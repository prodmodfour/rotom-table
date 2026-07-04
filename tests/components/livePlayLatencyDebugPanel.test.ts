/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
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

  it('renders an empty state when no traces are available', () => {
    const wrapper = mount(LivePlayLatencyDebugPanel, {
      props: { traces: {} },
    })

    expect(wrapper.text()).toContain('No live-play command traces recorded yet.')
  })
})
