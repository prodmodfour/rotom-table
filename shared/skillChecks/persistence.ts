import {
  SKILL_CHECK_DC_PRESET_IDS,
  SKILL_CHECK_OPERATION_KINDS,
  SKILL_CHECK_SKILL_IDS,
  SKILL_CHECK_STATES,
  assertSkillCheckDocumentInvariants,
  parseSkillCheckId,
  parseSkillCheckJournalId,
  parseSkillCheckOperationId,
  parseSkillCheckSubjectId,
  type SkillCheckAcceptedResultV1,
  type SkillCheckCommandV1,
  type SkillCheckComparisonPolicyV1,
  type SkillCheckCorrectionReceiptV1,
  type SkillCheckDiceJournalV1,
  type SkillCheckDocumentV1,
  type SkillCheckHistoryEntryV1,
  type SkillCheckModifierContributorV1,
  type SkillCheckOperationKind,
  type SkillCheckRequestComparisonPolicyV1,
  type SkillCheckSubjectV1,
} from './contract'

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u
const SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/u

const fail = (code: string, path: string, detail: string): never => {
  throw new Error(`${code}:${path}:${detail}`)
}
const record = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('skill-check.invalid-shape', path, 'must be an object')
  return value as Record<string, unknown>
}
const exact = (value: Record<string, unknown>, fields: readonly string[], path: string): void => {
  const keys = Object.keys(value)
  if (keys.length !== fields.length || fields.some(field => !Object.hasOwn(value, field))) {
    fail('skill-check.invalid-shape', path, 'contains unknown or missing fields')
  }
}
const array = (value: unknown, path: string, maximum: number): unknown[] => {
  if (!Array.isArray(value) || value.length > maximum) fail('skill-check.invalid-shape', path, `must be an array of at most ${maximum} entries`)
  return value as unknown[]
}
const integer = (value: unknown, path: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    fail('skill-check.invalid-number', path, `must be a safe integer from ${minimum} through ${maximum}`)
  }
  return Number(value)
}
const text = (value: unknown, path: string, maximum: number, required = false): string => {
  if (typeof value !== 'string' || value.length > maximum || CONTROL_CHARACTERS.test(value)
    || required && value.trim().length === 0) {
    fail('skill-check.invalid-text', path, `must be bounded control-free${required ? ' non-empty' : ''} text`)
  }
  return value as string
}
const unique = (values: readonly string[], path: string): void => {
  if (new Set(values).size !== values.length) fail('skill-check.duplicate-identity', path, 'must contain unique identities')
}
const deepFreeze = <Value>(value: Value): Value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return Object.freeze(value)
}

const parseComparison = (value: unknown, path: string): SkillCheckComparisonPolicyV1 => {
  const row = record(value, path)
  if (row.kind === 'dc') {
    exact(row, ['kind', 'difficultyClass', 'concealment'], path)
    integer(row.difficultyClass, `${path}.difficultyClass`, 1, 100)
    if (!['public', 'subjects-after-acceptance', 'gm-only'].includes(String(row.concealment))) {
      fail('skill-check.invalid-comparison', `${path}.concealment`, 'is unsupported')
    }
  }
  else if (row.kind === 'opposed') {
    exact(row, ['kind', 'tiePolicy'], path)
    if (row.tiePolicy !== 'reroll-both-up-to-10-then-journaled-server-coin') {
      fail('skill-check.invalid-comparison', `${path}.tiePolicy`, 'is unsupported')
    }
  }
  else fail('skill-check.invalid-comparison', `${path}.kind`, 'is unsupported')
  return row as unknown as SkillCheckComparisonPolicyV1
}

const parseRequestComparison = (value: unknown, path: string): SkillCheckRequestComparisonPolicyV1 => {
  const row = record(value, path)
  if (row.kind === 'opposed') {
    parseComparison(row, path)
    return row as unknown as SkillCheckRequestComparisonPolicyV1
  }
  if (row.kind !== 'dc') fail('skill-check.invalid-comparison', `${path}.kind`, 'is unsupported')
  exact(row, ['kind', 'difficulty', 'concealment'], path)
  if (!['public', 'subjects-after-acceptance', 'gm-only'].includes(String(row.concealment))) {
    fail('skill-check.invalid-comparison', `${path}.concealment`, 'is unsupported')
  }
  const difficulty = record(row.difficulty, `${path}.difficulty`)
  if (difficulty.kind === 'explicit') {
    exact(difficulty, ['kind', 'difficultyClass'], `${path}.difficulty`)
    integer(difficulty.difficultyClass, `${path}.difficulty.difficultyClass`, 1, 100)
  }
  else if (difficulty.kind === 'preset') {
    exact(difficulty, ['kind', 'presetId'], `${path}.difficulty`)
    if (!SKILL_CHECK_DC_PRESET_IDS.includes(difficulty.presetId as never)) {
      fail('skill-check.invalid-comparison', `${path}.difficulty.presetId`, 'is not reviewed')
    }
  }
  else fail('skill-check.invalid-comparison', `${path}.difficulty.kind`, 'is unsupported')
  return row as unknown as SkillCheckRequestComparisonPolicyV1
}

const parseSubject = (value: unknown, index: number): SkillCheckSubjectV1 => {
  const path = `subjects[${index}]`
  const row = record(value, path)
  exact(row, ['subjectId', 'kind', 'sheetSlug', 'sheetRevision', 'skillId', 'controllerProfileIds', 'response', 'respondedAt'], path)
  parseSkillCheckSubjectId(row.subjectId, `${path}.subjectId`)
  if (row.kind !== 'trainer' && row.kind !== 'pokemon') fail('skill-check.invalid-subject', `${path}.kind`, 'is unsupported')
  if (typeof row.sheetSlug !== 'string' || !SLUG.test(row.sheetSlug)) fail('skill-check.invalid-subject', `${path}.sheetSlug`, 'must be a sheet slug')
  integer(row.sheetRevision, `${path}.sheetRevision`)
  if (!SKILL_CHECK_SKILL_IDS.includes(row.skillId as never)) fail('skill-check.unknown-skill', `${path}.skillId`, 'is not canonical')
  const controllerProfileIds = array(row.controllerProfileIds, `${path}.controllerProfileIds`, 32)
    .map((entry, controllerIndex) => text(entry, `${path}.controllerProfileIds[${controllerIndex}]`, 160, true))
  unique(controllerProfileIds, `${path}.controllerProfileIds`)
  if (!['pending', 'accepted', 'declined'].includes(String(row.response))) fail('skill-check.invalid-subject', `${path}.response`, 'is unsupported')
  if (row.respondedAt !== null) integer(row.respondedAt, `${path}.respondedAt`)
  if ((row.response === 'pending') !== (row.respondedAt === null)) {
    fail('skill-check.invalid-subject', path, 'response and respondedAt disagree')
  }
  return row as unknown as SkillCheckSubjectV1
}

const parseContributor = (value: unknown, path: string): SkillCheckModifierContributorV1 => {
  const row = record(value, path)
  exact(row, ['contributorId', 'label', 'value', 'visibility'], path)
  text(row.contributorId, `${path}.contributorId`, 200, true)
  text(row.label, `${path}.label`, 200, true)
  integer(row.value, `${path}.value`, -100, 100)
  if (row.visibility !== 'gm-and-subject' && row.visibility !== 'gm-only') {
    fail('skill-check.invalid-contributor', `${path}.visibility`, 'is unsupported')
  }
  return row as unknown as SkillCheckModifierContributorV1
}

const parseJournal = (value: unknown, index: number): SkillCheckDiceJournalV1 => {
  const path = `journals[${index}]`
  const row = record(value, path)
  exact(row, ['journalId', 'subjectId', 'attempt', 'diceCount', 'dieSides', 'flatModifier', 'contributors', 'results', 'dieTotal', 'finalTotal', 'rolledAt'], path)
  parseSkillCheckJournalId(row.journalId, `${path}.journalId`)
  parseSkillCheckSubjectId(row.subjectId, `${path}.subjectId`)
  integer(row.attempt, `${path}.attempt`, 1, 11)
  const diceCount = integer(row.diceCount, `${path}.diceCount`, 1, 20)
  if (row.dieSides !== 6) fail('skill-check.invalid-journal', `${path}.dieSides`, 'must be six')
  integer(row.flatModifier, `${path}.flatModifier`, -100, 100)
  const contributors = array(row.contributors, `${path}.contributors`, 100)
    .map((entry, contributorIndex) => parseContributor(entry, `${path}.contributors[${contributorIndex}]`))
  unique(contributors.map(entry => entry.contributorId), `${path}.contributors`)
  const results = array(row.results, `${path}.results`, 20)
  if (results.length !== diceCount) fail('skill-check.invalid-journal', `${path}.results`, 'must match diceCount')
  results.forEach((result, resultIndex) => integer(result, `${path}.results[${resultIndex}]`, 1, 6))
  integer(row.dieTotal, `${path}.dieTotal`, 1, 120)
  integer(row.finalTotal, `${path}.finalTotal`, -100, 220)
  integer(row.rolledAt, `${path}.rolledAt`)
  return row as unknown as SkillCheckDiceJournalV1
}

const parseAcceptedResult = (value: unknown, index: number): SkillCheckAcceptedResultV1 => {
  const path = `acceptedResults[${index}]`
  const row = record(value, path)
  exact(row, ['subjectId', 'journalIds', 'finalTotal', 'outcome', 'acceptedAt'], path)
  parseSkillCheckSubjectId(row.subjectId, `${path}.subjectId`)
  const journalIds = array(row.journalIds, `${path}.journalIds`, 11)
    .map((entry, journalIndex) => parseSkillCheckJournalId(entry, `${path}.journalIds[${journalIndex}]`))
  if (journalIds.length === 0) fail('skill-check.invalid-result', `${path}.journalIds`, 'must not be empty')
  unique(journalIds, `${path}.journalIds`)
  integer(row.finalTotal, `${path}.finalTotal`, -100, 220)
  if (!['success', 'failure', 'winner', 'loser'].includes(String(row.outcome))) fail('skill-check.invalid-result', `${path}.outcome`, 'is unsupported')
  integer(row.acceptedAt, `${path}.acceptedAt`)
  return row as unknown as SkillCheckAcceptedResultV1
}

const parseCorrection = (value: unknown, index: number): SkillCheckCorrectionReceiptV1 => {
  const path = `corrections[${index}]`
  const row = record(value, path)
  exact(row, ['correctionId', 'operationId', 'gmPrincipalId', 'reason', 'previousOutcome', 'correctedOutcome', 'createdAt'], path)
  text(row.correctionId, `${path}.correctionId`, 200, true)
  parseSkillCheckOperationId(row.operationId, `${path}.operationId`)
  text(row.gmPrincipalId, `${path}.gmPrincipalId`, 200, true)
  text(row.reason, `${path}.reason`, 1000, true)
  for (const field of ['previousOutcome', 'correctedOutcome'] as const) {
    if (!['success', 'failure', 'winner', 'loser'].includes(String(row[field]))) fail('skill-check.invalid-correction', `${path}.${field}`, 'is unsupported')
  }
  if (row.previousOutcome === row.correctedOutcome) fail('skill-check.invalid-correction', path, 'must change the outcome')
  integer(row.createdAt, `${path}.createdAt`)
  return row as unknown as SkillCheckCorrectionReceiptV1
}

const parseHistory = (value: unknown, index: number): SkillCheckHistoryEntryV1 => {
  const path = `history[${index}]`
  const row = record(value, path)
  exact(row, ['historyId', 'kind', 'operationId', 'subjectId', 'headline', 'createdAt'], path)
  text(row.historyId, `${path}.historyId`, 200, true)
  if (!['requested', 'responded', 'accepted', 'cancelled', 'timed-out', 'corrected'].includes(String(row.kind))) {
    fail('skill-check.invalid-history', `${path}.kind`, 'is unsupported')
  }
  parseSkillCheckOperationId(row.operationId, `${path}.operationId`)
  if (row.subjectId !== null) parseSkillCheckSubjectId(row.subjectId, `${path}.subjectId`)
  text(row.headline, `${path}.headline`, 500, true)
  integer(row.createdAt, `${path}.createdAt`)
  return row as unknown as SkillCheckHistoryEntryV1
}

export const parseSkillCheckDocument = (value: unknown): SkillCheckDocumentV1 => {
  const row = structuredClone(record(value, 'document'))
  if (row.schemaVersion !== 1) fail('skill-check.unsupported-schema', 'document.schemaVersion', 'is unsupported')
  exact(row, [
    'schemaVersion', 'checkId', 'revision', 'state', 'mode', 'requester', 'publicLabel', 'prompt', 'gmNotes',
    'visibility', 'comparison', 'situationalModifier', 'subjects', 'journals', 'acceptedResults', 'corrections',
    'history', 'createdAt', 'updatedAt', 'expiresAt', 'terminalAt', 'lastOperationId',
  ], 'document')
  parseSkillCheckId(row.checkId)
  integer(row.revision, 'document.revision', 1)
  if (!SKILL_CHECK_STATES.includes(row.state as never)) fail('skill-check.invalid-state', 'document.state', 'is unsupported')
  if (row.mode !== 'single' && row.mode !== 'group') fail('skill-check.invalid-mode', 'document.mode', 'is unsupported')
  const requester = record(row.requester, 'document.requester')
  exact(requester, ['role', 'principalId'], 'document.requester')
  if (requester.role !== 'gm') fail('skill-check.invalid-requester', 'document.requester.role', 'must be gm')
  text(requester.principalId, 'document.requester.principalId', 200, true)
  text(row.publicLabel, 'document.publicLabel', 120, true)
  text(row.prompt, 'document.prompt', 2000, true)
  text(row.gmNotes, 'document.gmNotes', 4000)
  if (!['public-results', 'participants-results', 'gm-only-results'].includes(String(row.visibility))) {
    fail('skill-check.invalid-visibility', 'document.visibility', 'is unsupported')
  }
  parseComparison(row.comparison, 'document.comparison')
  integer(row.situationalModifier, 'document.situationalModifier', -20, 20)
  const subjects = array(row.subjects, 'document.subjects', 32).map(parseSubject)
  if (subjects.length === 0) fail('skill-check.invalid-subject-count', 'document.subjects', 'must not be empty')
  unique(subjects.map(subject => subject.subjectId), 'document.subjects')
  const journals = array(row.journals, 'document.journals', 1000).map(parseJournal)
  unique(journals.map(journal => journal.journalId), 'document.journals')
  const results = array(row.acceptedResults, 'document.acceptedResults', 32).map(parseAcceptedResult)
  unique(results.map(result => result.subjectId), 'document.acceptedResults')
  const corrections = array(row.corrections, 'document.corrections', 1000).map(parseCorrection)
  unique(corrections.map(correction => correction.correctionId), 'document.corrections')
  const history = array(row.history, 'document.history', 5000).map(parseHistory)
  unique(history.map(entry => entry.historyId), 'document.history')
  const createdAt = integer(row.createdAt, 'document.createdAt')
  const updatedAt = integer(row.updatedAt, 'document.updatedAt', createdAt)
  if (row.expiresAt !== null) integer(row.expiresAt, 'document.expiresAt', createdAt)
  if (row.terminalAt !== null) integer(row.terminalAt, 'document.terminalAt', createdAt, updatedAt)
  parseSkillCheckOperationId(row.lastOperationId, 'document.lastOperationId')
  assertSkillCheckDocumentInvariants(row as unknown as SkillCheckDocumentV1)
  return deepFreeze(row as unknown as SkillCheckDocumentV1)
}

const parseRequestSubjects = (value: unknown): void => {
  const subjects = array(value, 'command.subjects', 32)
  if (subjects.length === 0) fail('skill-check.invalid-subject-count', 'command.subjects', 'must not be empty')
  const ids: string[] = []
  const sheetKeys: string[] = []
  for (const [index, valueRow] of subjects.entries()) {
    const path = `command.subjects[${index}]`
    const row = record(valueRow, path)
    exact(row, ['subjectId', 'kind', 'sheetSlug', 'skillId'], path)
    ids.push(parseSkillCheckSubjectId(row.subjectId, `${path}.subjectId`))
    if (row.kind !== 'trainer' && row.kind !== 'pokemon') fail('skill-check.invalid-subject', `${path}.kind`, 'is unsupported')
    if (typeof row.sheetSlug !== 'string' || !SLUG.test(row.sheetSlug)) fail('skill-check.invalid-subject', `${path}.sheetSlug`, 'must be a sheet slug')
    sheetKeys.push(`${row.kind}:${row.sheetSlug}`)
    if (!SKILL_CHECK_SKILL_IDS.includes(row.skillId as never)) fail('skill-check.unknown-skill', `${path}.skillId`, 'is not canonical')
  }
  unique(ids, 'command.subjects')
  unique(sheetKeys, 'command.subjectSheets')
}

export const parseSkillCheckCommand = (value: unknown): SkillCheckCommandV1 => {
  const row = structuredClone(record(value, 'command'))
  if (row.schemaVersion !== 1) fail('skill-check.unsupported-schema', 'command.schemaVersion', 'is unsupported')
  if (!SKILL_CHECK_OPERATION_KINDS.includes(row.commandKind as SkillCheckOperationKind)) {
    fail('skill-check.invalid-command', 'command.commandKind', 'is unsupported')
  }
  const common = ['schemaVersion', 'operationId', 'expectedRevision', 'commandKind']
  const fields: Record<SkillCheckOperationKind, readonly string[]> = {
    request: [...common, 'checkId', 'publicLabel', 'prompt', 'gmNotes', 'visibility', 'comparison', 'situationalModifier', 'expiresAt', 'subjects'],
    respond: [...common, 'checkId', 'subjectId', 'decision'],
    resolve: [...common, 'checkId'],
    cancel: [...common, 'checkId', 'reason'],
    timeout: [...common, 'checkId', 'campaignMinute'],
    correct: [...common, 'checkId', 'subjectId', 'correctedOutcome', 'reason'],
  }
  exact(row, fields[row.commandKind as SkillCheckOperationKind], 'command')
  parseSkillCheckOperationId(row.operationId)
  const expectedRevision = integer(row.expectedRevision, 'command.expectedRevision')
  parseSkillCheckId(row.checkId)
  if (row.commandKind === 'request') {
    if (expectedRevision !== 0) fail('skill-check.invalid-command', 'command.expectedRevision', 'request must start at zero')
    text(row.publicLabel, 'command.publicLabel', 120, true)
    text(row.prompt, 'command.prompt', 2000, true)
    text(row.gmNotes, 'command.gmNotes', 4000)
    if (!['public-results', 'participants-results', 'gm-only-results'].includes(String(row.visibility))) fail('skill-check.invalid-visibility', 'command.visibility', 'is unsupported')
    parseRequestComparison(row.comparison, 'command.comparison')
    integer(row.situationalModifier, 'command.situationalModifier', -20, 20)
    if (row.expiresAt !== null) integer(row.expiresAt, 'command.expiresAt')
    parseRequestSubjects(row.subjects)
  }
  else if (row.commandKind === 'respond') {
    parseSkillCheckSubjectId(row.subjectId)
    if (row.decision !== 'accept' && row.decision !== 'decline') fail('skill-check.invalid-command', 'command.decision', 'is unsupported')
  }
  else if (row.commandKind === 'cancel') text(row.reason, 'command.reason', 1000, true)
  else if (row.commandKind === 'timeout') integer(row.campaignMinute, 'command.campaignMinute')
  else if (row.commandKind === 'correct') {
    parseSkillCheckSubjectId(row.subjectId)
    if (!['success', 'failure', 'winner', 'loser'].includes(String(row.correctedOutcome))) fail('skill-check.invalid-command', 'command.correctedOutcome', 'is unsupported')
    text(row.reason, 'command.reason', 1000, true)
  }
  return deepFreeze(row as unknown as SkillCheckCommandV1)
}
