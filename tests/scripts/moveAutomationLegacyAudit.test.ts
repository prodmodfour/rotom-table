import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import capabilitiesJson from '../../data/move-automation/capabilities.json'
import manifestJson from '../../data/move-automation/manifest.json'
import {
  buildLegacyMoveAutomationAudit,
  formatLegacyMoveAutomationAuditReport,
} from '../../scripts/move_automation_legacy_audit'
import {
  EXPLICIT_MOVE_AUTOMATION_SCRIPTS,
} from '../../src/utils/move-automation/registry'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const viteNode = resolve(repoRoot, 'node_modules/.bin/vite-node')

const runAudit = (...args: string[]) => spawnSync(
  viteNode,
  [
    '--config',
    'vitest.config.ts',
    'scripts/generate_move_automation_legacy_audit.ts',
    ...args,
  ],
  {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  },
)

describe('legacy move automation audit metadata', () => {
  it('deterministically attributes every registered v1 script without deciding completion', () => {
    const first = buildLegacyMoveAutomationAudit()
    const second = buildLegacyMoveAutomationAudit()
    const registryIds = [...EXPLICIT_MOVE_AUTOMATION_SCRIPTS.keys()].sort()

    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    expect(first).toMatchObject({
      schemaVersion: 2,
      generatedFrom: 'EXPLICIT_MOVE_AUTOMATION_SCRIPTS',
      entryCount: EXPLICIT_MOVE_AUTOMATION_SCRIPTS.size,
    })
    expect(first.scope).toContain('semantic completion is not evaluated')
    expect(first.entries.map(entry => entry.canonicalId)).toEqual(registryIds)
    expect(new Set(first.entries.map(entry => entry.canonicalId)).size).toBe(first.entryCount)

    const knownCapabilities = new Set(capabilitiesJson.capabilities.map(({ code }) => code))
    for (const entry of first.entries) {
      const script = EXPLICIT_MOVE_AUTOMATION_SCRIPTS.get(entry.canonicalId)
      expect(script).toBeDefined()
      expect(entry.v1Version).toBe(script?.version)
      expect(entry.definitionHash).toMatch(/^[a-f0-9]{64}$/)
      expect(entry.sourceModule).toMatch(/^src\/utils\/move-automation\/scripts\/.+\.ts$/)
      expect(existsSync(resolve(repoRoot, entry.sourceModule))).toBe(true)
      expect(entry).not.toHaveProperty('baseStatus')
      expect(entry).not.toHaveProperty('interactionStatus')
      expect(entry.inferredCapabilityHints.every(code => knownCapabilities.has(code))).toBe(true)
    }
  })

  it('extracts review-relevant shapes, suggestions, notes, and non-authoritative hints', () => {
    const entries = new Map(
      buildLegacyMoveAutomationAudit().entries.map(entry => [entry.canonicalId, entry]),
    )

    expect(entries.get('Scratch')).toMatchObject({
      sourceModule: 'src/utils/move-automation/scripts/area.ts',
      v1Version: 1,
      definitionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      targetMode: 'multi-target',
      scriptShape: {
        damageKind: 'ordinary-damage',
        areaTemplateKinds: ['pass'],
        targetBranchCount: 0,
      },
      suggestionKinds: [],
      inferredCapabilityHints: expect.arrayContaining([
        'movement.authoritative',
        'targeting.authoritative',
      ]),
    })
    expect(entries.get('Acupressure')).toMatchObject({
      sourceModule: 'src/utils/move-automation/scripts/additionalSingleTarget.ts',
      scriptShape: { randomStageKind: 'roll-table' },
      suggestionKinds: ['stage'],
      inferredCapabilityHints: expect.arrayContaining([
        'expressions.bounded',
        'stages.typed',
      ]),
    })
    expect(entries.get('Dragon Rage')).toMatchObject({
      sourceModule: 'src/utils/move-automation/scripts/directHpLoss.ts',
      scriptShape: { damageKind: 'direct-hp-loss:fixed' },
      inferredCapabilityHints: expect.arrayContaining(['hp.typed']),
    })
    expect(entries.get('Knock Off')).toMatchObject({
      automationNotes: expect.arrayContaining([
        expect.stringContaining('Held Items or Accessory Slot Items'),
      ]),
      inferredCapabilityHints: expect.arrayContaining(['items.authoritative']),
    })
    expect(entries.get('Yawn')).toMatchObject({
      suggestionKinds: ['condition'],
      automationNotes: expect.arrayContaining([
        expect.stringContaining('replace the Yawn marker with Sleep'),
      ]),
      inferredCapabilityHints: expect.arrayContaining(['lifecycle.effects']),
    })
  })

  it('records precise debt for known partials while retaining the generic audit remainder', () => {
    const expectedKnownDebt = new Map<string, {
      blockerCodes: readonly string[]
      limitationCodes: readonly string[]
      manualStepCodes: readonly string[]
      summaryTerms: readonly string[]
    }>([
      ['Aromatic Mist', {
        blockerCodes: ['targeting.authoritative'],
        limitationCodes: ['ally-area.side-required'],
        manualStepCodes: ['ally-area.side-setup'],
        summaryTerms: ['explicit encounter sides', 'Prepare Map'],
      }],
      ['Astonish', {
        blockerCodes: ['history.structured'],
        limitationCodes: ['astonish.timing'],
        manualStepCodes: ['astonish.unaware-flinch'],
        summaryTerms: ['once-per-scene', 'unaware'],
      }],
      ['Coaching', {
        blockerCodes: ['targeting.authoritative'],
        limitationCodes: ['ally-area.side-required'],
        manualStepCodes: ['ally-area.side-setup'],
        summaryTerms: ['explicit encounter sides', 'Prepare Map'],
      }],
      ['Fake Out', {
        blockerCodes: ['history.structured', 'reactions.durable'],
        limitationCodes: ['fake-out.timing'],
        manualStepCodes: ['fake-out.joining-flinch'],
        summaryTerms: ['joined', 'Priority'],
      }],
      ['Howl', {
        blockerCodes: ['targeting.authoritative'],
        limitationCodes: ['ally-area.side-required'],
        manualStepCodes: ['ally-area.side-setup'],
        summaryTerms: ['explicit encounter sides', 'Prepare Map'],
      }],
    ])
    const manifestById = new Map(manifestJson.moves.map(row => [row.canonicalId, row]))
    const auditById = new Map(
      buildLegacyMoveAutomationAudit().entries.map(entry => [entry.canonicalId, entry]),
    )

    for (const [canonicalId, expected] of expectedKnownDebt) {
      const row = manifestById.get(canonicalId)
      expect(row, canonicalId).toBeDefined()
      expect(auditById.get(canonicalId)?.automationNotes.length, canonicalId).toBeGreaterThan(0)
      expect(row).toMatchObject({
        baseStatus: 'assisted',
        runtime: { kind: 'legacy-v1' },
        blockerCodes: expected.blockerCodes,
        reviewedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      })
      expect(row?.limitations.map(({ code }) => code)).toEqual(expected.limitationCodes)
      expect(row?.manualSteps.map(({ code }) => code)).toEqual(expected.manualStepCodes)

      const debtSummary = [...(row?.limitations ?? []), ...(row?.manualSteps ?? [])]
        .map(({ summary }) => summary)
        .join(' ')
      expect(debtSummary).not.toContain('Semantic conformance review is required')
      for (const term of expected.summaryTerms) expect(debtSummary, canonicalId).toContain(term)
    }

    for (const row of manifestJson.moves) {
      if (
        row.runtime.kind !== 'legacy-v1'
        || row.baseStatus !== 'assisted'
        || expectedKnownDebt.has(row.canonicalId)
      ) continue

      expect(row.blockerCodes, row.canonicalId).toEqual([])
      expect(row.limitations, row.canonicalId).toEqual([{
        code: 'audit.required',
        summary: 'Semantic conformance review is required before this legacy implementation can be marked complete.',
      }])
      expect(row.manualSteps, row.canonicalId).toEqual([])
      expect(row.reviewedAt, row.canonicalId).toBeNull()
    }
  })

  it('emits deterministic JSON and a complete human-readable report', () => {
    const jsonResult = runAudit('--json')
    expect(jsonResult.status, `${jsonResult.stdout}\n${jsonResult.stderr}`).toBe(0)
    expect(jsonResult.stderr).toBe('')

    const parsed = JSON.parse(jsonResult.stdout)
    const expected = buildLegacyMoveAutomationAudit()
    expect(parsed).toEqual(expected)

    const reportResult = runAudit('--report')
    expect(reportResult.status, `${reportResult.stdout}\n${reportResult.stderr}`).toBe(0)
    expect(reportResult.stderr).toBe('')
    expect(reportResult.stdout).toBe(formatLegacyMoveAutomationAuditReport(expected))
    expect(reportResult.stdout).toContain(`Registry entries: ${EXPLICIT_MOVE_AUTOMATION_SCRIPTS.size}`)
    expect(reportResult.stdout).toContain('Capability hints are inferred planning aids')
    expect(reportResult.stdout).toContain('\nScratch\n  Source module: src/utils/move-automation/scripts/area.ts')
    expect(reportResult.stdout).toMatch(/Scratch[\s\S]*Definition hash: [a-f0-9]{64}/)
    expect(reportResult.stdout).toContain('\nYawn\n  Source module: src/utils/move-automation/scripts/additionalSingleTarget.ts')
  })
})
