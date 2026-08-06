import type { PokemonEggDocumentV1 } from '#shared/breeding/egg'
import { parseBreedingEggProductionProjectionV1, type BreedingEggProductionProjectionV1 } from '#shared/breeding/eggProduction'
import { parseBreedingOperationCommandV1 } from '#shared/breeding/operations'
import { parseAuthoritativeBreedingRollRecordV1 } from './ledgers'
import { parseBreedingProjectDocumentV1, type BreedingProjectDocumentV1 } from '#shared/breeding/project'
import { parseCampaignClockV1 } from '#shared/campaignClock'
import { parseAuthoritativePokemonEggDocumentV1 } from './lineage'
import { createBreedingOperationCommandHash } from './operations'
import {
  breedingCampaignOptionsFromProductionSnapshotV1,
  breedingOffspringRollSourceDefinitionHashes,
  parseAuthoritativeBreedingOffspringResolutionRecordV1,
} from './offspringProduction'
import { parseAuthoritativeBreedingProductionSnapshotV1 } from './productionSnapshots'
import {
  BREEDING_HATCH_DURATION_POLICY_DEFINITION_SHA256,
  resolveBreedingHatchDuration,
} from './eggRuleHelpers'
import { validateBreedingProjectRevisionSuccessor } from './projectLifecycle'

const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0
export type BreedingEggProductionAuthorityErrorCode =
  | 'breeding.egg-production.hash-mismatch'
  | 'breeding.egg-production.stale-authority'
  | 'breeding.egg-production.unavailable'
  | 'breeding.egg-production.wrong-command'
export class BreedingEggProductionAuthorityError extends Error {
  readonly code: BreedingEggProductionAuthorityErrorCode
  constructor(code: BreedingEggProductionAuthorityErrorCode, message: string) {
    super(message)
    this.name = 'BreedingEggProductionAuthorityError'
    this.code = code
  }
}
const fail = (code: BreedingEggProductionAuthorityErrorCode, message: string): never => {
  throw new BreedingEggProductionAuthorityError(code, message)
}
export interface PlannedBreedingEggProductionV1 {
  readonly project: BreedingProjectDocumentV1
  readonly egg: PokemonEggDocumentV1
}
export const planBreedingEggProductionV1 = (input: {
  readonly project: unknown
  readonly productionSnapshot: unknown
  readonly offspringResolution: unknown
  readonly command: unknown
  readonly campaignClock: unknown
  readonly hatchDurationRoll?: unknown | null
}): PlannedBreedingEggProductionV1 => {
  const current = parseBreedingProjectDocumentV1(input.project)
  const snapshot = parseAuthoritativeBreedingProductionSnapshotV1(input.productionSnapshot)
  const resolution = parseAuthoritativeBreedingOffspringResolutionRecordV1(input.offspringResolution)
  const command = parseBreedingOperationCommandV1(input.command)
  const clock = parseCampaignClockV1(input.campaignClock)
  if (command.commandKind !== 'produce-egg') {
    return fail('breeding.egg-production.wrong-command', 'Egg production requires one produce-egg command.')
  }
  const commandSha256 = createBreedingOperationCommandHash(command)
  if (current.status !== 'ready-to-produce' || current.revision !== snapshot.projectRevision
    || current.projectId !== snapshot.projectId || current.projectId !== resolution.projectId
    || command.payload.projectId !== current.projectId || command.payload.eggId !== resolution.eggId
    || command.operationId !== snapshot.operationId || command.operationId !== resolution.operationId
    || commandSha256 !== snapshot.commandSha256 || commandSha256 !== resolution.commandSha256
    || resolution.productionSnapshot.definitionSha256 !== snapshot.definitionSha256
    || resolution.projectRevision !== current.revision
    || snapshot.capturedAtCampaignMinute !== clock.campaignMinute
    || current.timeline.lastAppliedClockRevision === null
    || current.timeline.lastAppliedClockRevision > clock.revision
    || current.timeline.lastAppliedClockMinute === null
    || current.timeline.lastAppliedClockMinute > clock.campaignMinute) {
    return fail('breeding.egg-production.stale-authority', 'Project, command, snapshot, resolution, Egg identity, and campaign-clock checkpoint must agree exactly.')
  }
  const options = breedingCampaignOptionsFromProductionSnapshotV1(snapshot)
  const suppliedDurationRoll = input.hatchDurationRoll === null || input.hatchDurationRoll === undefined
    ? null
    : parseAuthoritativeBreedingRollRecordV1(input.hatchDurationRoll)
  if ((resolution.hatchDurationRollRecordId === null) !== (suppliedDurationRoll === null)) {
    return fail('breeding.egg-production.stale-authority', 'Persisted hatch-duration roll evidence must exist exactly when referenced by the resolution.')
  }
  if (suppliedDurationRoll && (suppliedDurationRoll.rollRecordId !== resolution.hatchDurationRollRecordId
    || suppliedDurationRoll.operationId !== command.operationId || suppliedDurationRoll.commandSha256 !== commandSha256
    || suppliedDurationRoll.operationRollOrdinal !== command.payload.resolutions.requestedRollKinds.indexOf('hatch-duration')
    || suppliedDurationRoll.purpose !== 'hatch-duration-percentage' || suppliedDurationRoll.formula !== 'percentage-50-to-200'
    || suppliedDurationRoll.target.kind !== 'breeding-project' || suppliedDurationRoll.target.projectId !== current.projectId
    || suppliedDurationRoll.target.revision !== current.revision || suppliedDurationRoll.generatedAtCampaignMinute !== clock.campaignMinute
    || JSON.stringify(suppliedDurationRoll.sourceDefinitionHashes) !== JSON.stringify(breedingOffspringRollSourceDefinitionHashes(snapshot)))) {
    return fail('breeding.egg-production.stale-authority', 'Hatch-duration randomness must be the exact persisted command-bound percentage roll.')
  }
  const durationChoice = resolution.selectedOffers.find(value => value.choiceKind === 'hatch-duration') ?? null
  const durationChoiceMatch = durationChoice?.canonicalValueId.match(/^campaign-minutes:([1-9][0-9]{0,7})$/u) ?? null
  const duration = resolveBreedingHatchDuration({
    speciesId: resolution.blueprint.speciesId,
    sourceKind: 'breeding',
    options,
    durationOverride: null,
    variationRoll: suppliedDurationRoll ? { rollId: suppliedDurationRoll.rollRecordId, total: suppliedDurationRoll.total } : null,
    gmTarget: durationChoice && durationChoiceMatch ? {
      targetCampaignMinutes: Number(durationChoiceMatch[1]),
      optionId: durationChoice.optionId,
      evidenceId: durationChoice.authorityEvidenceIds[0]!,
    } : null,
  })
  if (duration.status !== 'resolved') {
    return fail('breeding.egg-production.unavailable', `Egg incubation duration is unavailable: ${duration.reasonIds.join(',')}`)
  }
  if (duration.speciesSpecDefinitionSha256 !== resolution.blueprint.speciesSpecDefinitionSha256) {
    return fail('breeding.egg-production.stale-authority', 'Duration and offspring resolution must use the same compiled Species definition.')
  }
  const definitionHashes = [
    ...resolution.sourceEvidenceDefinitionHashes,
    resolution.definitionSha256,
    resolution.blueprint.definitionSha256,
    snapshot.definitionSha256,
    duration.resultDefinitionSha256,
    ...(suppliedDurationRoll ? [suppliedDurationRoll.definitionSha256] : []),
    duration.hatchDurationPolicyDefinitionSha256,
    BREEDING_HATCH_DURATION_POLICY_DEFINITION_SHA256,
  ].filter((value, index, values) => values.indexOf(value) === index).sort(compare)
  const egg = parseAuthoritativePokemonEggDocumentV1({
    schemaVersion: 1,
    eggId: command.payload.eggId,
    revision: 0,
    status: 'incubating',
    ownerTrainerSlug: current.ownerTrainerSlug,
    source: { kind: 'breeding', projectId: current.projectId },
    ruleset: current.ruleset,
    definitionHashes,
    parents: snapshot.parents,
    breeder: snapshot.breeder,
    offspring: resolution.blueprint,
    incubation: {
      averageCampaignMinutes: duration.averageCampaignMinutes,
      targetCampaignMinutes: duration.targetCampaignMinutes,
      accumulatedCampaignMinutes: 0,
      variationPolicyId: duration.variationPolicyId,
      durationResultDefinitionSha256: duration.resultDefinitionSha256,
      lastAppliedClockRevision: clock.revision,
      lastAppliedClockMinute: clock.campaignMinute,
      readyAtCampaignMinute: null,
      readinessKind: null,
      readyOperationId: null,
      paused: false,
      pauseReasonId: null,
      pauseOperationId: null,
    },
    special: {
      state: 'not-rolled',
      rollRecordId: null,
      rollTotal: null,
      triggerIds: [],
      adjudicationId: null,
      outcomeId: null,
      automaticShiny: false,
    },
    hatchOperationId: null,
    childSheetSlug: null,
    terminal: null,
    createdAtCampaignMinute: clock.campaignMinute,
    updatedAtCampaignMinute: clock.campaignMinute,
    statusChangedAtCampaignMinute: clock.campaignMinute,
    lastOperationId: command.operationId,
  })
  const project = validateBreedingProjectRevisionSuccessor(current, {
    ...current,
    revision: current.revision + 1,
    status: 'egg-produced',
    parentRefs: current.parentRefs.map(parent => ({ ...parent })),
    timeline: {
      ...current.timeline,
      eggProducedAtCampaignMinute: clock.campaignMinute,
    },
    check: current.check ? { ...current.check } : null,
    producedEggId: egg.eggId,
    terminal: null,
    updatedAtCampaignMinute: clock.campaignMinute,
    statusChangedAtCampaignMinute: clock.campaignMinute,
    lastOperationId: command.operationId,
  })
  return Object.freeze({ project, egg })
}
export const projectBreedingEggProductionV1 = (input: {
  readonly project: unknown
  readonly egg: unknown
  readonly audience: 'gm'|'owner'
}): BreedingEggProductionProjectionV1 => {
  const project = parseBreedingProjectDocumentV1(input.project)
  const egg = parseAuthoritativePokemonEggDocumentV1(input.egg)
  if (project.status !== 'egg-produced' || project.producedEggId !== egg.eggId
    || egg.source.kind !== 'breeding' || egg.source.projectId !== project.projectId
    || egg.status !== 'incubating' || egg.revision !== 0
    || project.timeline.eggProducedAtCampaignMinute !== egg.createdAtCampaignMinute) {
    return fail('breeding.egg-production.hash-mismatch', 'Projected Project and Egg must be one exact committed production pair.')
  }
  return parseBreedingEggProductionProjectionV1({
    schemaVersion: 1,
    audience: input.audience,
    status: 'egg-produced',
    eggId: egg.eggId,
    eggRevision: 0,
    projectRevision: project.revision,
    producedAtCampaignMinute: egg.createdAtCampaignMinute,
    sourceKind: 'breeding',
    incubationStatus: 'incubating',
  })
}
