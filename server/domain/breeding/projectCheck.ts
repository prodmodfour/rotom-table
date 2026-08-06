import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { BreedingBreederAuthorityEvidenceV1 } from '#shared/breeding/authorization'
import type { BreedingCheckRecordV1 } from '#shared/breeding/ledgers'
import { parseBreedingOperationCommandV1 } from '#shared/breeding/operations'
import { parseBreedingProjectDocumentV1, type BreedingProjectDocumentV1 } from '#shared/breeding/project'
import {
  parseBreedingProjectCheckProjectionV1,
  type BreedingProjectCheckProjectionV1,
} from '#shared/breeding/projectCheck'
import { parseAuthoritativeBreedingBreederAuthorityEvidenceV1 } from './authorization'
import {
  createBreedingCheckRecordFromRoll,
  parseAuthoritativeBreedingCheckRecordV1,
  parseAuthoritativeBreedingRollRecordV1,
} from './ledgers'
import { createBreedingOperationCommandHash } from './operations'
import { validateBreedingProjectRevisionSuccessor } from './projectLifecycle'

export const BREEDING_PROJECT_CHECK_POLICY_DEFINITION = Object.freeze({
  schemaVersion: 1 as const,
  policyId: 'breeding-project-check-v1' as const,
  skillId: 'pokemon-education' as const,
  difficultyClass: 12 as const,
  rollPurpose: 'breeder-check-d20' as const,
  rollFormula: '1d20' as const,
  attemptsPerProject: 1 as const,
  successTransition: 'additional-time-in-progress' as const,
  failureTransition: 'check-failed' as const,
})
const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')
export const BREEDING_PROJECT_CHECK_POLICY_DEFINITION_SHA256 = sha256(
  BREEDING_PROJECT_CHECK_POLICY_DEFINITION,
)

export type BreedingProjectCheckAuthorityErrorCode =
  | 'breeding.project-check.invalid-authority'
  | 'breeding.project-check.stale-authority'
  | 'breeding.project-check.unavailable'
  | 'breeding.project-check.wrong-command'
export class BreedingProjectCheckAuthorityError extends Error {
  readonly code: BreedingProjectCheckAuthorityErrorCode
  constructor(code: BreedingProjectCheckAuthorityErrorCode, message: string) {
    super(message)
    this.name = 'BreedingProjectCheckAuthorityError'
    this.code = code
  }
}
const fail = (code: BreedingProjectCheckAuthorityErrorCode, message: string): never => {
  throw new BreedingProjectCheckAuthorityError(code, message)
}
const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0

export interface PlanBreedingProjectCheckResultV1 {
  readonly project: BreedingProjectDocumentV1
  readonly check: BreedingCheckRecordV1
}
export const planBreedingProjectCheckV1 = (input: {
  readonly project: unknown
  readonly command: unknown
  readonly breederAuthority: unknown
  readonly persistedRoll: unknown
  readonly campaignClockRevision: number
  readonly resolvedAtCampaignMinute: number
}): PlanBreedingProjectCheckResultV1 => {
  const project = parseBreedingProjectDocumentV1(input.project)
  const command = parseBreedingOperationCommandV1(input.command)
  const breeder = parseAuthoritativeBreedingBreederAuthorityEvidenceV1(input.breederAuthority)
  const roll = parseAuthoritativeBreedingRollRecordV1(input.persistedRoll)
  if (command.commandKind !== 'resolve-breeding-check') {
    return fail('breeding.project-check.wrong-command', 'Project check accepts only resolve-breeding-check.')
  }
  if (!Number.isSafeInteger(input.campaignClockRevision) || input.campaignClockRevision < 0
    || input.campaignClockRevision > 2_147_483_647
    || !Number.isSafeInteger(input.resolvedAtCampaignMinute) || input.resolvedAtCampaignMinute < 0) {
    return fail('breeding.project-check.invalid-authority', 'Project check requires one bounded current campaign-clock checkpoint.')
  }
  const commandSha256 = createBreedingOperationCommandHash(command)
  const scope = command.scopes[0]
  if (scope?.kind !== 'breeding-project' || scope.projectId !== project.projectId
    || scope.expectedRevision !== project.revision || command.payload.projectId !== project.projectId
    || command.payload.checkRecordId === undefined
    || command.ruleset.rulesetId !== project.ruleset.rulesetId
    || command.ruleset.definitionSha256 !== project.ruleset.definitionSha256) {
    return fail('breeding.project-check.stale-authority', 'Command, ruleset, scope, and current Project revision must match exactly.')
  }
  if (project.status !== 'check-ready' || project.check !== null
    || project.timeline.initialAccumulatedCampaignMinutes !== 240
    || project.timeline.checkReadyAtCampaignMinute === null
    || input.resolvedAtCampaignMinute < project.timeline.checkReadyAtCampaignMinute
    || (project.timeline.lastAppliedClockRevision !== null
      && (input.campaignClockRevision < project.timeline.lastAppliedClockRevision
        || input.resolvedAtCampaignMinute < project.timeline.lastAppliedClockMinute!))) {
    return fail('breeding.project-check.unavailable', 'Project must be check-ready at a current nondecreasing campaign checkpoint and retain no prior check.')
  }
  if (breeder.breederTrainerSlug !== project.breederTrainerSlug
    || breeder.evaluatedAtCampaignMinute !== input.resolvedAtCampaignMinute) {
    return fail('breeding.project-check.stale-authority', 'Breeder authority must identify the Project Breeder at the exact check minute.')
  }
  const expectedSources = [
    breeder.definitionSha256,
    BREEDING_PROJECT_CHECK_POLICY_DEFINITION_SHA256,
    project.ruleset.definitionSha256,
  ].sort(compare)
  if (roll.operationId !== command.operationId || roll.commandSha256 !== commandSha256
    || roll.operationRollOrdinal !== 0 || roll.purpose !== 'breeder-check-d20'
    || roll.formula !== '1d20' || roll.target.kind !== 'breeding-project'
    || roll.target.projectId !== project.projectId || roll.target.revision !== project.revision
    || roll.generatorId !== 'server-rng-v1'
    || roll.generatedAtCampaignMinute !== input.resolvedAtCampaignMinute
    || stableJsonStringify(roll.sourceDefinitionHashes) !== stableJsonStringify(expectedSources)) {
    return fail('breeding.project-check.invalid-authority', 'Check reducer requires exactly one persisted server d20 bound to the command, Project, Breeder, policy, ruleset, and campaign minute.')
  }
  const check = createBreedingCheckRecordFromRoll({
    checkRecordId: command.payload.checkRecordId,
    operationId: command.operationId,
    commandSha256,
    projectId: project.projectId,
    projectRevision: project.revision,
    breederSnapshotDefinitionSha256: breeder.definitionSha256,
    authoritativeSkillTotal: breeder.pokemonEducationSkillTotal,
    roll,
    rulesetDefinitionSha256: project.ruleset.definitionSha256,
    resolvedAtCampaignMinute: input.resolvedAtCampaignMinute,
  })
  const success = check.outcome === 'success'
  const next = parseBreedingProjectDocumentV1({
    ...project,
    revision: project.revision + 1,
    status: success ? 'additional-time-in-progress' : 'check-failed',
    timeline: {
      ...project.timeline,
      additionalStartedAtCampaignMinute: success ? input.resolvedAtCampaignMinute : null,
      lastAppliedClockRevision: input.campaignClockRevision,
      lastAppliedClockMinute: input.resolvedAtCampaignMinute,
    },
    check: {
      checkRecordId: check.checkRecordId,
      outcome: check.outcome,
      resolvedAtCampaignMinute: check.resolvedAtCampaignMinute,
    },
    terminal: success ? null : {
      reasonId: 'breeding.project-terminal.check-failed',
      atCampaignMinute: input.resolvedAtCampaignMinute,
      operationId: command.operationId,
    },
    updatedAtCampaignMinute: input.resolvedAtCampaignMinute,
    statusChangedAtCampaignMinute: input.resolvedAtCampaignMinute,
    lastOperationId: command.operationId,
  })
  return Object.freeze({
    project: validateBreedingProjectRevisionSuccessor(project, next),
    check,
  })
}

export const projectBreedingProjectCheckV1 = (input: {
  readonly project: unknown
  readonly check: unknown
  readonly audience: 'gm' | 'owner'
  readonly mandatedSkillId: 'pokemon-education' | 'general-education' | 'perception'
}): BreedingProjectCheckProjectionV1 => {
  const project = parseBreedingProjectDocumentV1(input.project)
  const check = parseAuthoritativeBreedingCheckRecordV1(input.check)
  if (project.projectId !== check.projectId || project.check?.checkRecordId !== check.checkRecordId
    || project.check.outcome !== check.outcome
    || project.check.resolvedAtCampaignMinute !== check.resolvedAtCampaignMinute
    || ((check.outcome === 'success' && project.status !== 'additional-time-in-progress')
      || (check.outcome === 'failure' && project.status !== 'check-failed'))) {
    return fail('breeding.project-check.stale-authority', 'Project and check projection authority must cross-link exactly.')
  }
  return parseBreedingProjectCheckProjectionV1({
    schemaVersion: 1,
    audience: input.audience,
    status: project.status,
    skillId: input.mandatedSkillId,
    difficultyClass: 12,
    finalTotal: check.finalTotal,
    outcome: check.outcome,
    resolvedAtCampaignMinute: check.resolvedAtCampaignMinute,
  })
}

export const breedingProjectCheckRollSourceDefinitionHashes = (
  breeder: BreedingBreederAuthorityEvidenceV1,
  rulesetDefinitionSha256: string,
): readonly string[] => Object.freeze([
  breeder.definitionSha256,
  BREEDING_PROJECT_CHECK_POLICY_DEFINITION_SHA256,
  rulesetDefinitionSha256,
].sort(compare))
