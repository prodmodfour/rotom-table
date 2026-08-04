import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import manifest from '../../docs/encounter-workspace/baseline/current-compatibility/manifest.json'

const ROOT = resolve(import.meta.dirname, '../..')
const BASELINE_ROOT = resolve(ROOT, 'docs/encounter-workspace/baseline/current-compatibility')

interface PerformanceTrace {
  schemaVersion: number
  route: string
  settleWindowMs: number
  wallDurationMs: number
  browser: {
    viewport: { width: number, height: number, devicePixelRatio: number }
    navigation: Record<string, number>
    paints: { name: string, startTime: number }[]
    observers: {
      lcp: { startTime: number }[]
      cls: { value: number }[]
      longTasks: { startTime: number, duration: number }[]
    }
    resources: {
      count: number
      totalTransferSize: number
      totalDecodedBodySize: number
      entries: { name: string }[]
    }
  }
  cdpMetrics: Record<string, number>
}

const sha256 = (content: Buffer): string => createHash('sha256').update(content).digest('hex')

const loadTrace = (path: string): PerformanceTrace => JSON.parse(
  readFileSync(resolve(BASELINE_ROOT, path), 'utf8'),
) as PerformanceTrace

describe('encounter workspace compatibility baseline evidence', () => {
  it('retains hash-bound screenshots, videos, accessibility trees, and performance traces', () => {
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      baselineId: 'current-compatibility-164b510d',
      sourceCommit: '164b510d',
      sourceRoute: '/maps/:slug',
      captureTicket: 'EUX-009',
      privacyReview: {
        status: 'passed',
        containsCredentials: false,
        containsJoinCodes: false,
        containsPrivateCampaignData: false,
      },
    })
    expect(manifest.fixture.containsPrivateCampaignData).toBe(false)
    expect(new Set(manifest.artifacts.map(artifact => artifact.kind))).toEqual(new Set([
      'screenshot',
      'video',
      'accessibility-tree',
      'performance-trace',
    ]))
    expect(new Set(manifest.artifacts.map(artifact => artifact.viewport))).toEqual(new Set(['desktop', 'mobile']))

    for (const artifact of manifest.artifacts) {
      const content = readFileSync(resolve(BASELINE_ROOT, artifact.path))
      expect(content.byteLength, artifact.path).toBe(artifact.bytes)
      expect(sha256(content), artifact.path).toBe(artifact.sha256)
    }
  })

  it.each([
    ['desktop-performance-trace.json', 1280, 720],
    ['mobile-performance-trace.json', 412, 915],
  ] as const)('keeps a sanitized, structurally complete raw browser trace in %s', (path, width, height) => {
    const trace = loadTrace(path)
    expect(trace).toMatchObject({
      schemaVersion: 1,
      route: '/maps/:slug',
      settleWindowMs: 3000,
      browser: { viewport: { width, height, devicePixelRatio: 1 } },
    })
    expect(trace.wallDurationMs).toBeGreaterThan(3000)
    expect(trace.browser.navigation.domContentLoadedEventEnd).toBeGreaterThan(0)
    expect(trace.browser.paints.map(entry => entry.name)).toContain('first-contentful-paint')
    expect(trace.browser.observers.lcp.length).toBeGreaterThan(0)
    expect(trace.browser.resources.count).toBeGreaterThan(0)
    expect(trace.browser.resources.totalDecodedBodySize).toBeGreaterThan(0)
    expect(trace.browser.resources.entries.every(entry => entry.name.startsWith('/') && !entry.name.includes('?'))).toBe(true)
    expect(trace.cdpMetrics.Nodes).toBeGreaterThan(0)
    expect(trace.cdpMetrics.JSHeapUsedSize).toBeGreaterThan(0)
    expect(JSON.stringify(trace)).not.toMatch(/https?:\/\/|join.?code|credential|authorization/i)
  })

  it('stores ARIA trees with synthetic identities and no live host or credential material', () => {
    for (const path of ['desktop-accessibility-tree.yml', 'mobile-accessibility-tree.yml']) {
      const tree = readFileSync(resolve(BASELINE_ROOT, path), 'utf8')
      expect(tree).toContain('Encounter actions and outcomes')
      expect(tree).toContain('Initiative turn order')
      expect(tree).not.toMatch(/127\.0\.0\.1|localhost|join.?code|authorization|cookie/i)
    }
  })
})
