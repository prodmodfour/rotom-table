import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { parseBattleContestRecoveryReceipt, type BattleContestRecoveryReceiptV1 } from '#shared/contests/battleRecovery'
import type { BattleContestEncounterBindingV1 } from '#shared/contests/battleEncounter'
import { parseContestDocument, type ContestDocumentV1 } from '#shared/contests/document'
import type { ContestCommandV1 } from '#shared/contests/operations'
import { parseEncounterDocument, type EncounterDocument } from '#shared/encounterDocuments/model'
import { normalizeRevision } from '#shared/sessionRevisions'
import type { TabletopMap } from '~/types/map'
import { encounterSceneId } from '../moveAutomation/planSceneLifecycle'

export type BattleContestRecoveryErrorCode =
  | 'battle-contest.recovery-stage-mismatch'
  | 'battle-contest.recovery-link-mismatch'
  | 'battle-contest.recovery-contest-stale'
  | 'battle-contest.recovery-encounter-document-stale'
  | 'battle-contest.recovery-encounter-revision-stale'
  | 'battle-contest.recovery-scene-stale'
  | 'battle-contest.recovery-orphaned'
  | 'battle-contest.recovery-lifecycle-mismatch'
  | 'battle-contest.recovery-requires-pause'
  | 'battle-contest.recovery-no-op'

export class BattleContestRecoveryError extends Error {
  constructor(readonly code: BattleContestRecoveryErrorCode, message: string) {
    super(message)
    this.name = 'BattleContestRecoveryError'
  }
}
const fail = (code: BattleContestRecoveryErrorCode, message: string): never => { throw new BattleContestRecoveryError(code, message) }

export type BattleContestRecoveryCommandV1 = Extract<ContestCommandV1, {
  commandKind: 'set-paused' | 'apply-correction' | 'cancel-contest'
}>

export interface BattleContestRecoveryPlanV1 {
  readonly receipt: BattleContestRecoveryReceiptV1
  readonly encounterDocument: EncounterDocument
}

const canonical = (value: unknown): string => stableJsonStringify(JSON.parse(JSON.stringify(value)) as unknown)
const sha256 = (value: unknown): string => createHash('sha256').update(canonical(value), 'utf8').digest('hex')

const assertMirroredReceipts = (contest: ContestDocumentV1, encounter: EncounterDocument): void => {
  if (canonical(contest.battleRecoveryReceipts) !== canonical(encounter.battleRecoveryReceipts)) fail('battle-contest.recovery-orphaned', 'Linked Battle recovery receipts diverged; no new cross-engine mutation may commit.')
}

const assertBinding = (contest: ContestDocumentV1, encounter: EncounterDocument, map: TabletopMap): BattleContestEncounterBindingV1 => {
  const binding = contest.battle?.encounter
  if (!binding) return fail('battle-contest.recovery-stage-mismatch', 'Battle recovery requires one immutable linked Battle Contest and Encounter.')
  if (contest.variantId !== 'battle' || encounter.battleContest === null) return fail('battle-contest.recovery-stage-mismatch', 'Battle recovery requires one immutable linked Battle Contest and Encounter.')
  if (canonical(binding) !== canonical(encounter.battleContest)
    || binding.link.contestId !== contest.contestId
    || binding.link.encounterId !== encounter.encounterId
    || binding.link.linkedMapSlug !== encounter.linkedMapSlug
    || binding.link.linkedMapSlug !== map.slug) fail('battle-contest.recovery-link-mismatch', 'Contest, Encounter document, and linked map do not retain the same immutable Battle binding.')
  if (!['performance', 'settling'].includes(contest.stage)) fail('battle-contest.recovery-stage-mismatch', `Battle recovery is unavailable during ${contest.stage}.`)
  const currentSceneId = map.activeScene ? encounterSceneId(map.slug, map.activeScene) : null
  if (currentSceneId !== binding.sceneId) fail('battle-contest.recovery-scene-stale', 'The linked Encounter Scene changed before Battle recovery could commit.')
  return binding
}

const classify = (command: BattleContestRecoveryCommandV1): {
  readonly kind: BattleContestRecoveryReceiptV1['kind']
  readonly correctionKind: BattleContestRecoveryReceiptV1['correctionKind']
  readonly correctionTargetPerformerId: string | null
} => {
  if (command.commandKind === 'set-paused') return { kind: command.paused ? 'pause' : 'resume', correctionKind: null, correctionTargetPerformerId: null }
  if (command.commandKind === 'cancel-contest') return { kind: 'cancel', correctionKind: null, correctionTargetPerformerId: null }
  if (command.correctionKind === 'cancel-contest') return { kind: 'cancel', correctionKind: 'cancel-contest', correctionTargetPerformerId: null }
  return { kind: 'correction', correctionKind: command.correctionKind, correctionTargetPerformerId: command.correctionKind === 'voltage-delta' ? command.performerId ?? null : null }
}

const lifecycleAfter = (kind: BattleContestRecoveryReceiptV1['kind']): 'active' | 'paused' => kind === 'resume' ? 'active' : 'paused'
const contestPausedAfter = (kind: BattleContestRecoveryReceiptV1['kind']): boolean => kind === 'pause' || kind === 'correction'

const assertLifecycle = (input: {
  readonly contest: ContestDocumentV1
  readonly encounter: EncounterDocument
  readonly kind: BattleContestRecoveryReceiptV1['kind']
}): void => {
  const { contest, encounter, kind } = input
  if (encounter.lifecycle !== 'active' && encounter.lifecycle !== 'paused') fail('battle-contest.recovery-lifecycle-mismatch', 'Linked Encounter recovery requires active or paused lifecycle authority.')
  if ((contest.paused ? 'paused' : 'active') !== encounter.lifecycle) fail('battle-contest.recovery-lifecycle-mismatch', 'Contest pause state and linked Encounter lifecycle disagree.')
  if (kind === 'pause' && contest.paused || kind === 'resume' && !contest.paused) fail('battle-contest.recovery-no-op', `Battle Contest is already ${contest.paused ? 'paused' : 'active'}.`)
  if (kind === 'correction' && (!contest.paused || encounter.lifecycle !== 'paused')) fail('battle-contest.recovery-requires-pause', 'Pause both linked authorities before applying a bounded Battle Contest correction.')
}

/**
 * Produces only the Encounter-owned half plus one immutable shared receipt.
 * The Contest engine independently consumes that receipt; the use-case owns
 * the transaction that commits both local plans or neither.
 */
export const planBattleContestRecovery = (input: {
  readonly contest: ContestDocumentV1
  readonly encounter: EncounterDocument
  readonly map: TabletopMap
  readonly command: BattleContestRecoveryCommandV1
  readonly now: number
}): BattleContestRecoveryPlanV1 => {
  const contest = parseContestDocument(input.contest)
  const encounter = parseEncounterDocument(input.encounter)
  assertMirroredReceipts(contest, encounter)
  const binding = assertBinding(contest, encounter, input.map)
  const classified = classify(input.command)
  assertLifecycle({ contest, encounter, kind: classified.kind })
  if (classified.kind === 'correction' && classified.correctionKind === 'voltage-delta' && classified.correctionTargetPerformerId === null) fail('battle-contest.recovery-requires-pause', 'A Battle Voltage correction must identify one exact enrolled Pokémon performer.')
  const intentMaterial = Object.freeze({
    schemaVersion: 1,
    linkId: binding.link.linkId,
    command: input.command,
    contestRevision: contest.revision,
    encounterDocumentRevision: encounter.revision,
    encounterMapRevision: normalizeRevision(input.map.revision),
    encounterSceneId: binding.sceneId,
    priorRecoveryReceiptId: contest.battleRecoveryReceipts.at(-1)?.receiptId ?? null,
  })
  const intentSha256 = sha256(intentMaterial)
  const receipt = parseBattleContestRecoveryReceipt({
    schemaVersion: 1,
    receiptId: `battle-recovery:v1:${intentSha256.slice(0, 40)}`,
    operationId: input.command.operationId,
    linkId: binding.link.linkId,
    kind: classified.kind,
    correctionKind: classified.correctionKind,
    correctionTargetPerformerId: classified.correctionTargetPerformerId,
    contestRevisionBefore: contest.revision,
    contestRevisionAfter: contest.revision + 1,
    encounterDocumentRevisionBefore: encounter.revision,
    encounterDocumentRevisionAfter: encounter.revision + 1,
    encounterMapRevision: normalizeRevision(input.map.revision),
    encounterSceneId: binding.sceneId,
    contestPausedBefore: contest.paused,
    contestPausedAfter: contestPausedAfter(classified.kind),
    encounterLifecycleBefore: encounter.lifecycle,
    encounterLifecycleAfter: lifecycleAfter(classified.kind),
    intentSha256,
    createdAt: input.now,
  })
  const encounterDocument = parseEncounterDocument({
    ...encounter,
    revision: encounter.revision + 1,
    lifecycle: receipt.encounterLifecycleAfter,
    battleRecoveryReceipts: [...encounter.battleRecoveryReceipts, receipt],
    updatedAt: input.now,
  })
  return Object.freeze({ receipt, encounterDocument })
}

/** Final transaction-bound reread. Changed material writes nothing. */
export const assertBattleContestRecoveryAuthority = (input: {
  readonly contest: ContestDocumentV1
  readonly encounter: EncounterDocument
  readonly map: TabletopMap
  readonly receipt: BattleContestRecoveryReceiptV1
}): void => {
  const contest = parseContestDocument(input.contest), encounter = parseEncounterDocument(input.encounter)
  assertMirroredReceipts(contest, encounter)
  const binding = assertBinding(contest, encounter, input.map)
  const receipt = parseBattleContestRecoveryReceipt(input.receipt)
  if (contest.revision !== receipt.contestRevisionBefore) fail('battle-contest.recovery-contest-stale', 'Contest authority changed before Battle recovery commit.')
  if (encounter.revision !== receipt.encounterDocumentRevisionBefore) fail('battle-contest.recovery-encounter-document-stale', 'Encounter document authority changed before Battle recovery commit.')
  if (normalizeRevision(input.map.revision) !== receipt.encounterMapRevision) fail('battle-contest.recovery-encounter-revision-stale', 'Encounter map authority changed before Battle recovery commit.')
  if (binding.link.linkId !== receipt.linkId) fail('battle-contest.recovery-link-mismatch', 'Recovery receipt no longer identifies the immutable Battle link.')
  const currentSceneId = input.map.activeScene ? encounterSceneId(input.map.slug, input.map.activeScene) : null
  if (currentSceneId !== receipt.encounterSceneId) fail('battle-contest.recovery-scene-stale', 'Encounter Scene changed before Battle recovery commit.')
  if (contest.paused !== receipt.contestPausedBefore || encounter.lifecycle !== receipt.encounterLifecycleBefore) fail('battle-contest.recovery-lifecycle-mismatch', 'Linked lifecycle authority changed before Battle recovery commit.')
}
