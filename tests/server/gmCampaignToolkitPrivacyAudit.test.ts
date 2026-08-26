import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import fixture from '../../data/gm-campaign-toolkit/fixtures/session-preparation.v1.json'
import {
  parseSessionPreparationDocumentV1,
  projectSessionPreparationForPublic,
} from '../../shared/gmToolkit/sessionPreparation'
import { isGmCampaignToolkitInvalidationV1 } from '../../shared/gmToolkit/realtime'

const root = process.cwd()
const source = (path: string): string => readFileSync(join(root, path), 'utf8')
const filesBelow = (path: string): string[] => readdirSync(join(root, path)).flatMap((entry) => {
  const absolute = join(root, path, entry)
  return statSync(absolute).isDirectory()
    ? filesBelow(relative(root, absolute))
    : absolute.endsWith('.ts') ? [relative(root, absolute)] : []
})

const privateRoutePaths = [
  ...filesBelow('server/api/gm-toolkit'),
  'server/api/encounters/archive.post.ts',
  'server/api/encounters/copy.post.ts',
  'server/api/encounters/create.post.ts',
  'server/api/encounters/export/[tableId].get.ts',
  'server/api/encounters/generate.post.ts',
  'server/api/encounters/import.post.ts',
  'server/api/encounters/list.get.ts',
  'server/api/encounters/restore.post.ts',
  'server/api/encounters/save.post.ts',
  'server/api/encounters/table/[tableId].get.ts',
].sort()

describe('GM Campaign Toolkit structural privacy audit', () => {
  it('places every toolkit table, package, handoff, generation, and preparation route behind GM authorization', () => {
    expect(privateRoutePaths).toHaveLength(18)
    for (const path of privateRoutePaths) {
      const text = source(path)
      const handler = text.slice(text.indexOf('export default defineEventHandler'))
      const guard = handler.indexOf('requireGm(event)')
      expect(guard, `${path} must call requireGm`).toBeGreaterThan(-1)
      for (const boundary of ['readBoundedJsonBody', 'UseCase(', 'createSqlite']) {
        const position = handler.indexOf(boundary)
        if (position >= 0) expect(guard, `${path} must guard before ${boundary}`).toBeLessThan(position)
      }
    }
    expect(filesBelow('server/api/gm-toolkit').some(path => /public|player|owner/i.test(path))).toBe(false)
  })

  it('constructs a distinct launched public preparation with no candidates, private prose, decisions, maps, provenance, or launch receipts', () => {
    const base = fixture.document
    const privateValues = [
      'PRIVATE ROOT NOTE', 'PRIVATE SCENE NOTE', 'PRIVATE CANDIDATE NOTE',
      'PRIVATE DECISION PROMPT', 'PRIVATE DECISION RESOLUTION', 'PRIVATE HANDOUT NOTE',
      'Forest wildlife', 'encounter-table:v1:thickerby-vale-forest', 'launch-private-001',
    ]
    const launched = parseSessionPreparationDocumentV1({
      ...base,
      revision: 2,
      lifecycle: 'launched',
      gmNotes: privateValues[0],
      scenes: base.scenes.map(scene => ({
        ...scene,
        gmNotes: privateValues[1],
        map: { slug: 'private-forest-map', revision: 7 },
        encounterCandidates: scene.encounterCandidates.map(candidate => ({
          ...candidate,
          label: privateValues[5 + 1],
          gmNotes: privateValues[2],
        })),
      })),
      handouts: base.handouts.map(handout => ({ ...handout, gmNotes: privateValues[5] })),
      unresolvedDecisions: [{
        decisionId: 'decision:private-weather', headline: 'Private weather decision',
        prompt: privateValues[3], state: 'resolved', resolution: privateValues[4],
      }],
      launches: [{
        launchId: privateValues[8], sceneId: base.scenes[0]!.sceneId,
        encounterId: 'forest-arrival', mapSlug: 'private-forest-map', launchedAt: '2026-08-26T12:00:00.000Z',
      }],
      updatedAt: '2026-08-26T12:00:00.000Z',
    })
    const projected = projectSessionPreparationForPublic(launched)
    expect(projected).toMatchObject({
      lifecycle: 'launched', title: 'Under the Old Canopy',
      playerOverview: 'The road into Thickerby Vale continues.',
      scenes: [{ title: 'Forest arrival', playerSummary: 'The path narrows beneath an old canopy.' }],
      handouts: [{ title: 'Field note', playerText: 'A pressed leaf marks the page.' }],
    })
    const encoded = JSON.stringify(projected)
    for (const value of privateValues) expect(encoded).not.toContain(value)
    for (const field of ['gmNotes', 'encounterCandidates', 'unresolvedDecisions', 'map', 'provenance', 'launches']) {
      expect(encoded).not.toContain(`"${field}"`)
    }
  })

  it('accepts only identity-and-revision toolkit invalidations and keeps both transient and generated-sheet events GM-only', () => {
    expect(isGmCampaignToolkitInvalidationV1({ documentId: 'session-preparation:v1:forest', revision: 3 })).toBe(true)
    for (const leaked of [
      { documentId: 'session-preparation:v1:forest', revision: 3, gmNotes: 'secret' },
      { documentId: 'wild-package:v1:abc', revision: 0, journal: [] },
      { documentId: 'npc-package:v1:abc', revision: 0, sourceHash: 'hash' },
    ]) expect(isGmCampaignToolkitInvalidationV1(leaked)).toBe(false)

    const transient = source('server/utils/gmToolkitRealtime.ts')
    expect(transient).toContain("access: { kind: 'gm-only' }")
    expect(transient).toContain('data: { documentId: invalidation.documentId, revision: invalidation.revision }')
    expect(transient).not.toMatch(/data:\s*invalidation\b/)

    const generated = source('server/realtime/libraryMutationRealtime.ts')
    const section = generated.slice(
      generated.indexOf('export const sheetLibraryGeneratedIdentityRealtimeAppendInputs'),
      generated.indexOf('export const sheetLibraryCreatedRealtimeAppendInputs'),
    )
    expect(section).toContain('access: gmOnlyAccess')
    expect(section).toContain('data: { kind: sheet.kind, slug: sheet.slug, revision: sheet.revision }')
    expect(section).not.toContain('sheet: sheet.sheet')
  })

  it('keeps exports GM-only and never offers preparation, random-journal, package, or diagnostics export routes', () => {
    const tableExport = source('server/api/encounters/export/[tableId].get.ts')
    expect(tableExport.indexOf('requireGm(event)')).toBeLessThan(tableExport.indexOf('exportGmEncounterTableUseCase({'))
    const routePaths = filesBelow('server/api')
    const forbiddenExports = routePaths.filter(path => /gm-toolkit\/.+export|session-preparations\/.+export|packages\/.+export|journal.+export|diagnostic.+export/i.test(path))
    expect(forbiddenExports).toEqual([])
  })
})
