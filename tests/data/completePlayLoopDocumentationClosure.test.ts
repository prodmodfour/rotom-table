import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import closure from '../../data/complete-play-loop/documentation-closure.v1.json'
import { acceptedSuccessorHead, repositoryFileSha256 } from '../helpers/deferredClosureSuccessors'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8')

const documentationPaths = (): string[] => [
  closure.index,
  ...Object.values(closure.audiences),
]

const markdownLinks = (path: string): string[] => [...read(path).matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)]
  .map(match => match[1]!)

describe('P8-099 Complete Play Loop documentation closure', () => {
  it('provides one focused entry point for every required audience and topic', () => {
    expect(closure).toMatchObject({ schemaVersion: 1, ticket: 'P8-099', status: 'complete' })
    expect(Object.keys(closure.audiences)).toEqual(['user', 'gm', 'contributor', 'operator'])
    expect(Object.keys(closure.topics)).toEqual([
      'item-states',
      'inventory-actions',
      'equipment',
      'guided-adjudication',
      'settlement',
      'attention-items',
      'correction',
      'recovery',
      'canonical-data-maintenance',
      'troubleshooting',
    ])
    for (const path of documentationPaths()) {
      expect(path).toMatch(/^docs\//u)
      expect(read(path).length, path).toBeGreaterThan(1000)
    }
    for (const [topic, paths] of Object.entries(closure.topics)) {
      expect(paths.length, topic).toBeGreaterThanOrEqual(2)
      for (const path of paths) expect(existsSync(resolve(root, path)), `${topic}: ${path}`).toBe(true)
    }
  })

  it('keeps every new guide link relative, internal, and resolvable', () => {
    const broken: string[] = []
    for (const path of documentationPaths()) {
      for (const link of markdownLinks(path)) {
        expect(link, `${path}: external link`).not.toMatch(/^(?:https?:|\/\/)/u)
        if (link.startsWith('#')) continue
        const [target] = link.split('#', 1)
        const absolute = resolve(root, dirname(path), target!)
        if (!existsSync(absolute)) broken.push(`${path} -> ${link}`)
      }
    }
    expect(broken).toEqual([])
  })

  it('documents exact authority and recovery rules without promoting unsafe shortcuts', () => {
    const index = read(closure.index)
    expect(index).toContain('205 native, 40 guided, and 104 passive')
    expect(index).toContain('There are no blocked rows')
    expect(index).toContain('Reconnect never submits automatically')

    const player = read(closure.audiences.user)
    expect(player).toContain('Choose one exact source')
    expect(player).toContain('Check status')
    expect(player).toContain('Never fix a conflict by editing')

    const gm = read(closure.audiences.gm)
    expect(gm).toContain('Accept reviewed use')
    expect(gm).toContain('One transaction applies rewards')
    expect(gm).toContain('Accepted settlement evidence is immutable')

    const contributor = read(closure.audiences.contributor)
    expect(contributor).toContain('Runtime PTU identity and mechanics come only from app-owned')
    expect(contributor).toContain('Do not parse canonical effect prose at runtime')
    expect(contributor).toContain('After any change to `shared/encounterSettlement/document.ts`')

    const operator = read(closure.audiences.operator)
    expect(operator).toContain('liveplay-only')
    expect(operator).toContain('Never skip a schema version')
    expect(operator).toContain('Never alter production rows')

    expect(closure.documentationPolicy).toEqual({
      productUseAndExtensionOnly: true,
      repositoryPromotion: false,
      releaseCeremony: false,
      runtimeProseParsingRecommended: false,
      directStorageRepairRecommended: false,
      localHostingRecommended: false,
      externalPtuRuntimeSourcesRecommended: false,
      privacySafeExamplesOnly: true,
      relativeLinksRequired: true,
    })
    const combined = documentationPaths().map(read).join('\n').toLowerCase()
    expect(combined).not.toMatch(/github stars|social badge|launch announcement|public release ceremony/u)
  })

  it('hash-binds all guides, detailed topic references, tests, commands, and operator gate', () => {
    const paths = new Set<string>()
    for (const row of closure.sourceEvidence) {
      expect(paths.has(row.path), row.path).toBe(false)
      paths.add(row.path)
      expect(row.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(acceptedSuccessorHead(row.path, row.sha256), row.path)
        .toBe(repositoryFileSha256(row.path))
    }
    for (const path of new Set([
      ...documentationPaths(),
      ...Object.values(closure.topics).flat(),
      'tests/data/completePlayLoopDocumentationClosure.test.ts',
      'package.json',
      'scripts/quality-gate.sh',
    ])) expect(paths.has(path), path).toBe(true)
  })
})
