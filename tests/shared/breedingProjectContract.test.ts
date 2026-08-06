import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  BREEDING_PROJECT_ACTIVE_STATUSES,
  BREEDING_PROJECT_SETTLED_STATUSES,
  BREEDING_PROJECT_STATUSES,
  BREEDING_PROJECT_TERMINAL_STATUSES,
  BreedingProjectValidationError,
  isBreedingProjectSettledStatus,
  isBreedingProjectStatus,
  isBreedingProjectTerminalStatus,
  parseBreedingProjectDocumentV1,
  type BreedingProjectDocumentV1,
  type BreedingProjectStatus,
} from '../../shared/breeding/project'
import {
  BREEDING_PROJECT_TRANSITIONS,
  BreedingProjectTransitionError,
  isBreedingProjectStatusTransitionAllowed,
  validateBreedingProjectRevisionSuccessor,
} from '../../server/domain/breeding/projectLifecycle'

const ROOT = resolve(import.meta.dirname, '../..')
const readJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as T
const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex')
const policy = readJson<Record<string, any>>('data/breeding-automation/project-contract.json')
const ruleset = readJson<Record<string, any>>('data/breeding-automation/ruleset.json')
const op = (value: number): string => `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
const PROJECT_ID = 'breeding-project:v1:11111111111111111111111111111111'
const CHECK_ID = 'breeding-check:v1:22222222222222222222222222222222'
const EGG_ID = 'pokemon-egg:v1:33333333333333333333333333333333'

const draftValue = (): Record<string, any> => ({
  schemaVersion: 1,
  projectId: PROJECT_ID,
  revision: 0,
  status: 'draft',
  ruleset: { rulesetId: ruleset.rulesetId, definitionSha256: ruleset.definitionSha256 },
  projectCreationOptionSnapshotSha256: 'a'.repeat(64),
  ownerTrainerSlug: 'trainer-owner',
  breederTrainerSlug: 'trainer-breeder',
  parentRefs: [
    { pokemonSheetSlug: 'pokemon-parent-a', ownerTrainerSlug: 'trainer-owner', expectedSheetRevision: 3 },
    { pokemonSheetSlug: 'pokemon-parent-b', ownerTrainerSlug: 'trainer-owner', expectedSheetRevision: 5 },
  ],
  consentPolicy: 'same-owner-control',
  timeline: {
    initialRequiredCampaignMinutes: 240,
    initialAccumulatedCampaignMinutes: 0,
    additionalRequiredCampaignMinutes: 240,
    additionalAccumulatedCampaignMinutes: 0,
    initialStartedAtCampaignMinute: null,
    checkReadyAtCampaignMinute: null,
    additionalStartedAtCampaignMinute: null,
    readyToProduceAtCampaignMinute: null,
    eggProducedAtCampaignMinute: null,
    lastAppliedClockRevision: null,
    lastAppliedClockMinute: null,
  },
  check: null,
  producedEggId: null,
  terminal: null,
  createdAtCampaignMinute: 100,
  updatedAtCampaignMinute: 100,
  statusChangedAtCampaignMinute: 100,
  lastOperationId: op(1),
})
const nextValue = (
  current: BreedingProjectDocumentV1,
  status: BreedingProjectStatus,
  minute: number,
  overrides: Record<string, unknown> = {},
): Record<string, any> => ({
  ...current,
  revision: current.revision + 1,
  status,
  updatedAtCampaignMinute: minute,
  statusChangedAtCampaignMinute: status === current.status ? current.statusChangedAtCampaignMinute : minute,
  lastOperationId: op(current.revision + 2),
  parentRefs: current.parentRefs.map(value => ({ ...value })),
  timeline: { ...current.timeline },
  check: current.check ? { ...current.check } : null,
  terminal: current.terminal ? { ...current.terminal } : null,
  ...overrides,
})
const validateNext = (
  current: BreedingProjectDocumentV1,
  status: BreedingProjectStatus,
  minute: number,
  overrides: Record<string, unknown> = {},
): BreedingProjectDocumentV1 => validateBreedingProjectRevisionSuccessor(current, nextValue(current, status, minute, overrides))
const happyPath = () => {
  const draft = parseBreedingProjectDocumentV1(draftValue())
  const awaiting = validateNext(draft, 'awaiting-parent-consent', 101)
  const initial = validateNext(awaiting, 'initial-time-in-progress', 102, {
    timeline: {
      ...awaiting.timeline,
      initialStartedAtCampaignMinute: 102,
      lastAppliedClockRevision: 1,
      lastAppliedClockMinute: 102,
    },
  })
  const progressed = validateNext(initial, 'initial-time-in-progress', 340, {
    timeline: {
      ...initial.timeline,
      initialAccumulatedCampaignMinutes: 239,
      lastAppliedClockRevision: 2,
      lastAppliedClockMinute: 340,
    },
  })
  const checkReady = validateNext(progressed, 'check-ready', 341, {
    timeline: {
      ...progressed.timeline,
      initialAccumulatedCampaignMinutes: 240,
      checkReadyAtCampaignMinute: 341,
      lastAppliedClockRevision: 3,
      lastAppliedClockMinute: 341,
    },
  })
  const additional = validateNext(checkReady, 'additional-time-in-progress', 342, {
    timeline: { ...checkReady.timeline, additionalStartedAtCampaignMinute: 342 },
    check: { checkRecordId: CHECK_ID, outcome: 'success', resolvedAtCampaignMinute: 342 },
  })
  const additionalProgress = validateNext(additional, 'additional-time-in-progress', 580, {
    timeline: {
      ...additional.timeline,
      additionalAccumulatedCampaignMinutes: 239,
      lastAppliedClockRevision: 4,
      lastAppliedClockMinute: 580,
    },
  })
  const ready = validateNext(additionalProgress, 'ready-to-produce', 581, {
    timeline: {
      ...additionalProgress.timeline,
      additionalAccumulatedCampaignMinutes: 240,
      readyToProduceAtCampaignMinute: 581,
      lastAppliedClockRevision: 5,
      lastAppliedClockMinute: 581,
    },
  })
  const eggProduced = validateNext(ready, 'egg-produced', 582, {
    timeline: { ...ready.timeline, eggProducedAtCampaignMinute: 582 },
    producedEggId: EGG_ID,
  })
  return { draft, awaiting, initial, progressed, checkReady, additional, additionalProgress, ready, eggProduced }
}

describe('BreedingProjectDocument v1 and lifecycle', () => {
  it('freezes the strict contract, explicit failed-check state, and lifecycle graph', () => {
    expect(policy).toMatchObject({
      schemaVersion: 1,
      contractId: 'ptu-1.05-breeding-project-document-v1',
      rulesetId: ruleset.rulesetId,
      rulesetDefinitionSha256: ruleset.definitionSha256,
      sourceManifestSha256: sha256(readFileSync(resolve(ROOT, 'data/breeding-automation/source-manifest.json'))),
    })
    expect(policy.definitionSha256).toBe(sha256(stableJsonStringify(policy.definition)))
    expect(policy.definition.statuses).toEqual(BREEDING_PROJECT_STATUSES)
    expect(policy.definition.activeStatuses).toEqual(BREEDING_PROJECT_ACTIVE_STATUSES)
    expect(policy.definition.terminalStatuses).toEqual(BREEDING_PROJECT_TERMINAL_STATUSES)
    expect(policy.definition.settledStatuses).toEqual(BREEDING_PROJECT_SETTLED_STATUSES)
    expect(policy.definition.transitions).toEqual(BREEDING_PROJECT_TRANSITIONS)
    expect(policy.definition.check).toMatchObject({
      attemptsPerProject: 1,
      failureStatus: 'check-failed',
      failedProject: 'terminal-new-project-identity-required',
    })
    expect(policy.definition.timing).toMatchObject({
      initialRequiredCampaignMinutes: 240,
      additionalRequiredCampaignMinutes: 240,
      authoritativeUnit: 'campaign-minute',
    })
  })

  it('parses, detaches, and deeply freezes an exact draft without client or legacy authority fields', () => {
    const source = draftValue()
    const parsed = parseBreedingProjectDocumentV1(source)
    expect(parsed).toMatchObject({
      schemaVersion: 1,
      projectId: PROJECT_ID,
      revision: 0,
      status: 'draft',
      ownerTrainerSlug: 'trainer-owner',
      breederTrainerSlug: 'trainer-breeder',
      producedEggId: null,
      terminal: null,
    })
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.ruleset)).toBe(true)
    expect(Object.isFrozen(parsed.parentRefs)).toBe(true)
    expect(Object.isFrozen(parsed.parentRefs[0])).toBe(true)
    expect(Object.isFrozen(parsed.timeline)).toBe(true)
    source.parentRefs[0].pokemonSheetSlug = 'mutated'
    source.timeline.initialAccumulatedCampaignMinutes = 200
    expect(parsed.parentRefs[0].pokemonSheetSlug).toBe('pokemon-parent-a')
    expect(parsed.timeline.initialAccumulatedCampaignMinutes).toBe(0)
  })

  it('accepts the complete forward lifecycle and immutable terminal Egg identity', () => {
    const path = happyPath()
    expect(Object.values(path).map(project => project.status)).toEqual([
      'draft', 'awaiting-parent-consent', 'initial-time-in-progress', 'initial-time-in-progress',
      'check-ready', 'additional-time-in-progress', 'additional-time-in-progress',
      'ready-to-produce', 'egg-produced',
    ])
    expect(path.eggProduced).toMatchObject({
      revision: 8,
      status: 'egg-produced',
      producedEggId: EGG_ID,
      terminal: null,
      timeline: {
        initialAccumulatedCampaignMinutes: 240,
        additionalAccumulatedCampaignMinutes: 240,
        eggProducedAtCampaignMinute: 582,
      },
      check: { checkRecordId: CHECK_ID, outcome: 'success' },
    })
    expect(() => validateBreedingProjectRevisionSuccessor(path.eggProduced, {
      ...path.eggProduced, revision: 9, updatedAtCampaignMinute: 583, lastOperationId: op(10),
    })).toThrow(BreedingProjectTransitionError)
  })

  it('settles a failed authoritative check terminally with no Egg', () => {
    const { checkReady } = happyPath()
    const operationId = op(checkReady.revision + 2)
    const failed = validateNext(checkReady, 'check-failed', 342, {
      check: { checkRecordId: CHECK_ID, outcome: 'failure', resolvedAtCampaignMinute: 342 },
      terminal: {
        reasonId: 'breeding.project-terminal.check-failed',
        atCampaignMinute: 342,
        operationId,
      },
    })
    expect(failed).toMatchObject({
      status: 'check-failed',
      producedEggId: null,
      check: { outcome: 'failure' },
      terminal: { reasonId: 'breeding.project-terminal.check-failed', operationId },
    })
    expect(isBreedingProjectTerminalStatus(failed.status)).toBe(true)
    expect(isBreedingProjectSettledStatus(failed.status)).toBe(true)
    const impossibleSuccessor = nextValue(failed, 'check-failed', 343)
    impossibleSuccessor.terminal = {
      ...impossibleSuccessor.terminal,
      atCampaignMinute: 343,
      operationId: impossibleSuccessor.lastOperationId,
    }
    expect(() => validateBreedingProjectRevisionSuccessor(failed, impossibleSuccessor)).toThrow(BreedingProjectTransitionError)
  })

  it('matches every declared legal transition and refuses all undeclared edges', () => {
    for (const from of BREEDING_PROJECT_STATUSES) {
      expect(BREEDING_PROJECT_TRANSITIONS[from]).toEqual(policy.definition.transitions[from])
      for (const to of BREEDING_PROJECT_STATUSES) {
        expect(isBreedingProjectStatusTransitionAllowed(from, to), `${from} -> ${to}`)
          .toBe(from !== to && policy.definition.transitions[from].includes(to))
      }
    }
    expect(isBreedingProjectStatus('ready-to-produce')).toBe(true)
    expect(isBreedingProjectStatus('ready')).toBe(false)
    expect(isBreedingProjectTerminalStatus('egg-produced')).toBe(false)
    expect(isBreedingProjectSettledStatus('egg-produced')).toBe(true)
  })

  it('allows monotonic same-status progress and revision-bound consent refresh before a check', () => {
    const { initial, progressed, checkReady } = happyPath()
    expect(progressed.status).toBe('initial-time-in-progress')
    expect(progressed.statusChangedAtCampaignMinute).toBe(initial.statusChangedAtCampaignMinute)
    const refreshed = validateNext(progressed, 'awaiting-parent-consent', 341, {
      parentRefs: [
        { ...progressed.parentRefs[0], expectedSheetRevision: 4 },
        { ...progressed.parentRefs[1] },
      ],
    })
    expect(refreshed).toMatchObject({
      status: 'awaiting-parent-consent',
      timeline: { initialAccumulatedCampaignMinutes: 239 },
      parentRefs: [{ expectedSheetRevision: 4 }, { expectedSheetRevision: 5 }],
    })
    const refreshedAtBoundary = validateNext(checkReady, 'awaiting-parent-consent', 342, {
      parentRefs: [
        { ...checkReady.parentRefs[0] },
        { ...checkReady.parentRefs[1], expectedSheetRevision: 6 },
      ],
    })
    expect(refreshedAtBoundary.timeline.initialAccumulatedCampaignMinutes).toBe(240)
    expect(() => validateNext(progressed, 'initial-time-in-progress', 341, {
      parentRefs: [
        { ...progressed.parentRefs[0], expectedSheetRevision: 4 },
        { ...progressed.parentRefs[1] },
      ],
    })).toThrow(BreedingProjectTransitionError)
  })

  it('rejects malformed, enriched, ambiguous, or contradictory documents', () => {
    const base = draftValue()
    const cases: Array<[string, Record<string, any>]> = [
      ['unknown field', { ...base, clientAuthorized: true }],
      ['project ID', { ...base, projectId: 'project-1' }],
      ['status', { ...base, status: 'ready' }],
      ['ruleset hash', { ...base, ruleset: { ...base.ruleset, definitionSha256: 'bad' } }],
      ['duplicate parents', { ...base, parentRefs: [base.parentRefs[0], { ...base.parentRefs[0] }] }],
      ['required time', { ...base, timeline: { ...base.timeline, initialRequiredCampaignMinutes: 239 } }],
      ['draft progress', {
        ...base,
        timeline: {
          ...base.timeline,
          initialAccumulatedCampaignMinutes: 1,
          initialStartedAtCampaignMinute: 100,
          lastAppliedClockRevision: 0,
          lastAppliedClockMinute: 100,
        },
      }],
      ['Egg before settlement', { ...base, producedEggId: EGG_ID }],
      ['legacy consent payload', { ...base, consent: { accepted: true } }],
    ]
    for (const [label, value] of cases) {
      expect(() => parseBreedingProjectDocumentV1(value), label).toThrow(BreedingProjectValidationError)
    }
    const accessor = draftValue()
    Object.defineProperty(accessor, 'revision', { enumerable: true, get: () => 0 })
    expect(() => parseBreedingProjectDocumentV1(accessor)).toThrow(BreedingProjectValidationError)
  })

  it('rejects skipped states, stale revisions, immutable drift, replay IDs, and regressive progress', () => {
    const path = happyPath()
    const validAwaiting = nextValue(path.draft, 'awaiting-parent-consent', 101)
    expect(() => validateBreedingProjectRevisionSuccessor(path.draft, { ...validAwaiting, revision: 0 }))
      .toThrowError(expect.objectContaining({ code: 'breeding.project.stale-revision' }))
    expect(() => validateBreedingProjectRevisionSuccessor(path.draft, {
      ...validAwaiting, lastOperationId: path.draft.lastOperationId,
    })).toThrowError(expect.objectContaining({ code: 'breeding.project.invalid-transition' }))
    expect(() => validateBreedingProjectRevisionSuccessor(path.draft, {
      ...validAwaiting, ownerTrainerSlug: 'different-owner',
    })).toThrowError(expect.objectContaining({ code: 'breeding.project.immutable-field' }))

    const skipped = {
      ...path.ready,
      revision: 1,
      projectId: path.draft.projectId,
      createdAtCampaignMinute: path.draft.createdAtCampaignMinute,
      lastOperationId: op(2),
    }
    expect(() => validateBreedingProjectRevisionSuccessor(path.draft, skipped))
      .toThrowError(expect.objectContaining({ code: 'breeding.project.invalid-transition' }))

    const regressed = nextValue(path.progressed, 'initial-time-in-progress', 341, {
      timeline: {
        ...path.progressed.timeline,
        initialAccumulatedCampaignMinutes: 238,
        lastAppliedClockRevision: 3,
        lastAppliedClockMinute: 341,
      },
    })
    expect(() => validateBreedingProjectRevisionSuccessor(path.progressed, regressed))
      .toThrowError(expect.objectContaining({ code: 'breeding.project.invalid-transition' }))
  })
})
