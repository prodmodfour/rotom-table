import { createHash } from 'node:crypto'
import authorizationContractJson from '../../data/breeding-automation/authorization-contract.json'
import rulesetJson from '../../data/breeding-automation/ruleset.json'
import securityPolicyJson from '../../data/breeding-automation/security-policy.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { AuthRole } from '#shared/auth'
import type {
  BreedingActorAuthorityV1,
  BreedingGmOverrideEvidenceV1,
  BreedingParentControlEvidenceV1,
  BreedingTrainerControlEvidenceV1,
} from '#shared/breeding/authorization'
import type { BreedingBreederEdgeHandoffV1 } from '#shared/breeding/breederEdgeHandoff'
import type { BreedingFeatureProviderHandoffV1 } from '#shared/breeding/featureProviderHandoff'
import {
  parseBreedingAdjudicationIdSyntax,
  parseBreedingOfferIdSyntax,
  parseBreedingOfferOptionIdSyntax,
  parseBreedingOperationIdSyntax,
  parseBreedingOverrideIdSyntax,
  parseBreedingProjectIdSyntax,
  parseBreedingReadSetIdSyntax,
  type BreedingOfferOptionId,
} from '#shared/breeding/ids'
import type {
  BreedingGmAdjudicationRecordV1,
  BreedingOptionOfferRecordV1,
  PokemonEducationRank,
} from '#shared/breeding/ledgers'
import { parseBreedingOperationCommandV1, type BreedingOperationCommandV1 } from '#shared/breeding/operations'
import type { BreedingProjectParentFactsV1 } from '#shared/breeding/projectSetupValidation'
import {
  BREEDING_PROJECT_CHOICE_REQUIRED_RANKS,
  BREEDING_PROJECT_CHOICE_TRAIT_KINDS,
  parseBreedingProjectChoicesRequestV1,
  type BreedingProjectCampaignSettingV1,
  type BreedingProjectChoiceConfirmationV1,
  type BreedingProjectChoiceOptionV1,
  type BreedingProjectChoicesProjectionV1,
  type BreedingProjectChoicesRequestV1,
  type BreedingProjectMaturityChoiceV1,
  type BreedingProjectParentRoleChoiceV1,
  type BreedingProjectSkillChoiceV1,
  type BreedingProjectTraitChoiceAuthorityV1,
} from '#shared/breeding/projectChoices'
import { parseBreedingReadResourceV1, type BreedingDependencyEvidenceV1, type BreedingReadResourceV1 } from '#shared/breeding/readSets'
import { isSlug } from '#shared/paths'
import {
  authorizeBreedingProjectSetupV1,
  createBreedingActorAuthorityV1,
  createBreedingGmOverrideEvidenceV1,
  createBreedingParentControlEvidenceV1,
  createBreedingTrainerControlEvidenceV1,
} from '../domain/breeding/authorization'
import {
  type BreedingCampaignOptionSnapshotV1,
  BREEDING_CAMPAIGN_OPTION_IDS,
} from '../domain/breeding/campaignOptions'
import {
  BREEDING_COMPATIBILITY_POLICY_DEFINITION_SHA256,
  evaluateBreedingCompatibility,
} from '../domain/breeding/compatibility'
import { createBreedingProjectChoicesProjectionV1 } from '../domain/breeding/projectChoices'
import { createCurrentBreedingReferenceVersionSnapshotV1 } from '../domain/breeding/currentReferences'
import {
  createBreedingGmAdjudicationRecordV1,
  createBreedingOptionOfferRecordV1,
  createBreedingOptionOfferRevisionV1,
} from '../domain/breeding/ledgers'
import {
  createBreedingOperationAcceptedV1,
  createBreedingOperationCommandHash,
} from '../domain/breeding/operations'
import {
  createBreedingProjectParentFactsV1,
  validateBreedingProjectSetupV1,
} from '../domain/breeding/projectSetupValidation'
import { compiledBreedingSpeciesSpec } from '../domain/breeding/registry'
import { createBreedingOperationReadSetV1 } from '../domain/breeding/readSets'
import { createSqliteBreedingGmAdjudicationRepository } from '../storage/breedingGmAdjudicationRepository'
import { createSqliteBreedingOperationEvidenceRepository } from '../storage/breedingOperationEvidenceRepository'
import { createSqliteBreedingOperationRepository } from '../storage/breedingOperationRepository'
import { createSqliteBreedingOptionOfferRepository } from '../storage/breedingOptionOfferRepository'
import { createSqliteBreedingProjectRepository } from '../storage/breedingProjectRepository'
import { createSqliteCampaignClockRepository } from '../storage/campaignClockRepository'
import type { RotomDatabase } from '../storage/database'
import type { PlayerProfile } from '#shared/playerProfiles'
import {
  parseAuthoritativeBreedingBreederEdgeHandoffV1,
} from '../domain/breeding/breederEdgeHandoff'
import {
  parseAuthoritativeBreedingFeatureProviderHandoffV1,
} from '../domain/breeding/featureProviderHandoff'
import {
  createBreedingProjectFromValidatedSetup,
  type BreedingProjectInitialTimeExecutionResultV1,
} from './manageBreedingProjectInitialTime'
import {
  createBreedingTransactionCoordinator,
  type BreedingTransactionCoordinator,
} from './executeBreedingTransaction'
import {
  loadBreedingProjectGuidanceAuthority,
  type LoadBreedingProjectGuidanceDependencies,
} from './loadBreedingProjectGuidance'
import {
  resolveCurrentBreedingBreederEdgeHandoff,
} from './resolveBreedingBreederEdgeHandoff'
import {
  resolveCurrentBreedingFeatureProviderHandoff,
  resolveCurrentFeatureGrantedBreederHandoff,
} from './resolveBreedingFeatureProviderHandoff'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class LoadBreedingProjectChoicesError extends UseCaseHttpError<400 | 403 | 409> {}

export interface LoadBreedingProjectChoicesInput {
  readonly role: AuthRole
  readonly playerProfile: unknown | null
  readonly request: unknown
}
export interface LoadBreedingProjectChoicesDependencies extends LoadBreedingProjectGuidanceDependencies {
  readonly resolveCurrentFeatureGrantedBreederHandoff?: typeof resolveCurrentFeatureGrantedBreederHandoff
  readonly coordinator?: BreedingTransactionCoordinator
  readonly createProject?: typeof createBreedingProjectFromValidatedSetup
  readonly campaignProjectionKey?: Buffer | string
  readonly realtimeTimestamp?: number
}

type StoredSheet = NonNullable<ReturnType<ReturnType<typeof loadBreedingProjectGuidanceAuthority>['wizardAuthority']['sheetRepository']['get']>>
type SkillKey = 'generalEd' | 'perception'
interface CurrentParent {
  readonly candidate: BreedingProjectChoicesProjectionV1['guidance']['wizard']['parentDiscovery']['trainerSheets'][number]['candidates'][number]
  readonly sheet: StoredSheet
  readonly owner: StoredSheet
  readonly ownerControl: BreedingTrainerControlEvidenceV1 | null
  readonly parentControl: BreedingParentControlEvidenceV1
  readonly facts: BreedingProjectParentFactsV1
}
interface BreederResolution {
  readonly handoff: BreedingBreederEdgeHandoffV1
  readonly featureHandoff: BreedingFeatureProviderHandoffV1 | null
  readonly selectedSkill: SkillKey | null
}
interface SetupContext {
  readonly command: Extract<BreedingOperationCommandV1, { readonly commandKind: 'create-breeding-project' | 'preview-breeding' }>
  readonly actor: BreedingActorAuthorityV1
  readonly readSet: ReturnType<typeof createBreedingOperationReadSetV1>
  readonly receipt: ReturnType<typeof authorizeBreedingProjectSetupV1>
  readonly ownerControl: BreedingTrainerControlEvidenceV1 | null
  readonly breeder: BreederResolution
  readonly breederControl: BreedingTrainerControlEvidenceV1 | null
  readonly parents: readonly [CurrentParent, CurrentParent]
  readonly gmOverrides: readonly BreedingGmOverrideEvidenceV1[]
}

const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')
const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0
const fail = (status: 400 | 403 | 409, message: string): never => {
  throw new LoadBreedingProjectChoicesError(status, message)
}
const promiseLike = (value: unknown): value is PromiseLike<unknown> => (
  (typeof value === 'object' || typeof value === 'function') && value !== null
  && typeof (value as { readonly then?: unknown }).then === 'function'
)
const optionId = (material: unknown): BreedingOfferOptionId => parseBreedingOfferOptionIdSyntax(
  `option:v1:${sha256(material).slice(0, 32)}`,
) ?? fail(409, 'Server-issued Project option identity is unavailable')
const operationId = (material: unknown) => parseBreedingOperationIdSyntax(
  `breeding-operation:v1:${sha256(material).slice(0, 32)}`,
) ?? fail(409, 'Server-issued Project operation identity is unavailable')
const projectId = (material: unknown) => parseBreedingProjectIdSyntax(
  `breeding-project:v1:${sha256(material).slice(0, 32)}`,
) ?? fail(409, 'Server-issued Project identity is unavailable')
const readSetId = (material: unknown) => parseBreedingReadSetIdSyntax(
  `breeding-read-set:v1:${sha256(material).slice(0, 32)}`,
) ?? fail(409, 'Server-issued Project read-set identity is unavailable')
const overrideId = (material: unknown) => parseBreedingOverrideIdSyntax(
  `breeding-override:v1:${sha256(material).slice(0, 32)}`,
) ?? fail(409, 'Server-issued Project override identity is unavailable')
const adjudicationId = (material: unknown) => parseBreedingAdjudicationIdSyntax(
  `breeding-adjudication:v1:${sha256(material).slice(0, 32)}`,
) ?? fail(409, 'Server-issued Project adjudication identity is unavailable')
const offerId = (material: unknown) => parseBreedingOfferIdSyntax(
  `breeding-offer:v1:${sha256(material).slice(0, 32)}`,
) ?? fail(409, 'Server-issued Project offer identity is unavailable')

const CAMPAIGN_OPTION_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'breeding.baby-template-policy': 'Baby Template',
  'breeding.baby-template-stat-penalty': 'Baby Template stat penalty',
  'breeding.check-failure-policy': 'Failed Breeder check',
  'breeding.form-root-policy': 'Form root',
  'breeding.fossil-hatch-level': 'Fossil hatch Level',
  'breeding.fossil-inheritance-policy': 'Fossil inheritance',
  'breeding.genderless-policy': 'Genderless pairing',
  'breeding.gm-hatch-duration-minutes': 'GM hatch duration',
  'breeding.hatch-duration-variation': 'Hatch duration variation',
  'breeding.hatch-special-policy': 'Hatch special result',
  'breeding.maturity-policy': 'Maturity',
  'breeding.minimum-maturity-level': 'Minimum maturity Level',
  'breeding.missing-hatch-duration-policy': 'Missing hatch duration',
  'breeding.parent-family-policy': 'Offspring family',
  'breeding.same-sex-policy': 'Same-sex pairing',
})
const titleCase = (value: string): string => value.split('-')
  .map(word => word.length > 0 ? `${word[0]!.toUpperCase()}${word.slice(1)}` : word)
  .join(' ')
const campaignSettings = (
  options: BreedingCampaignOptionSnapshotV1,
): readonly BreedingProjectCampaignSettingV1[] => Object.freeze(BREEDING_CAMPAIGN_OPTION_IDS
  .map(campaignOptionId => {
    const value = options.values[campaignOptionId as keyof typeof options.values]
    return Object.freeze({
      campaignOptionId,
      label: CAMPAIGN_OPTION_LABELS[campaignOptionId] ?? titleCase(campaignOptionId.slice('breeding.'.length)),
      valueLabel: typeof value === 'number' ? String(value) : titleCase(value),
    })
  })
  .sort((left, right) => compare(left.campaignOptionId, right.campaignOptionId)))

const skillOptionIds = (input: {
  readonly trainerSheetSlug: string
  readonly trainerRevision: number
  readonly campaignMinute: number
  readonly optionSnapshotDefinitionSha256: string
}): Readonly<Record<SkillKey, BreedingOfferOptionId>> => Object.freeze({
  generalEd: optionId({ ...input, choiceKind: 'dilettante-mandated-skill', value: 'general-education' }),
  perception: optionId({ ...input, choiceKind: 'dilettante-mandated-skill', value: 'perception' }),
})
const assertOnlyServerIssuedOptions = (
  selectedOptionIds: readonly BreedingOfferOptionId[],
  allowedOptionIds: readonly BreedingOfferOptionId[],
): void => {
  const allowed = new Set<string>(allowedOptionIds)
  if (selectedOptionIds.some(id => !allowed.has(id))) {
    return fail(400, 'Project choice selection contains an unissued or stale option')
  }
}
const choiceOption = (
  id: BreedingOfferOptionId,
  label: string,
  description: string,
  selectedIds: ReadonlySet<string>,
): BreedingProjectChoiceOptionV1 => Object.freeze({
  optionId: id,
  label,
  description,
  selected: selectedIds.has(id),
})
const skillChoiceProjection = (input: {
  readonly guidance: ReturnType<typeof loadBreedingProjectGuidanceAuthority>['projection']
  readonly request: BreedingProjectChoicesRequestV1
  readonly options: BreedingCampaignOptionSnapshotV1
}): { readonly projection: BreedingProjectSkillChoiceV1, readonly ids: Readonly<Record<SkillKey, BreedingOfferOptionId>>, readonly selected: SkillKey | null } => {
  const wizard = input.guidance.wizard
  const ids = skillOptionIds({
    trainerSheetSlug: wizard.breeder.trainerSheetSlug,
    trainerRevision: wizard.breeder.trainerRevision,
    campaignMinute: wizard.generatedAtCampaignMinute,
    optionSnapshotDefinitionSha256: input.options.definitionSha256,
  })
  const selectedIds = new Set<string>(input.request.selectedOptionIds)
  const selected = selectedIds.has(ids.generalEd) && !selectedIds.has(ids.perception)
    ? 'generalEd' as const
    : selectedIds.has(ids.perception) && !selectedIds.has(ids.generalEd)
      ? 'perception' as const
      : null
  const source = input.guidance.sourceContributions.find(row => row.sourceCanonicalId === 'Breeder')!
  if (source.status === 'active') {
    return Object.freeze({ projection: Object.freeze({ status: 'not-required', options: Object.freeze([]) }), ids, selected: null })
  }
  if (source.status === 'unavailable') {
    return Object.freeze({ projection: Object.freeze({ status: 'unavailable', options: Object.freeze([]) }), ids, selected: null })
  }
  const options = [
    choiceOption(ids.generalEd, 'General Education', 'Use the current General Education rank and check total for Dilettante’s mandated Breeder Skill.', selectedIds),
    choiceOption(ids.perception, 'Perception', 'Use the current Perception rank and check total for Dilettante’s mandated Breeder Skill.', selectedIds),
  ].sort((left, right) => compare(left.optionId, right.optionId))
  return Object.freeze({
    projection: Object.freeze({ status: selected ? 'selected' : 'required', options: Object.freeze(options) }),
    ids,
    selected,
  })
}

const strictRoster = (document: unknown): { readonly currentTeam: readonly string[], readonly boxedPokemon: readonly string[] } => {
  if (!document || typeof document !== 'object' || Array.isArray(document)
    || (Object.getPrototypeOf(document) !== Object.prototype && Object.getPrototypeOf(document) !== null)
    || Object.getOwnPropertySymbols(document).length > 0) return fail(409, 'Current Trainer roster authority is malformed')
  const row = document as Record<string, unknown>
  const parse = (field: 'currentTeam' | 'boxedPokemon'): readonly string[] => {
    const value = row[field] ?? []
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
      || value.length > 512 || Object.getOwnPropertySymbols(value).length > 0
      || Object.getOwnPropertyNames(value).length !== value.length + 1) return fail(409, 'Current Trainer roster authority is malformed')
    const output = value.map((entry, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      return descriptor?.enumerable && 'value' in descriptor && isSlug(descriptor.value)
        ? descriptor.value
        : fail(409, 'Current Trainer roster authority is malformed')
    })
    if (new Set(output).size !== output.length) return fail(409, 'Current Trainer roster authority is ambiguous')
    return Object.freeze(output)
  }
  const currentTeam = parse('currentTeam')
  const boxedPokemon = parse('boxedPokemon')
  if (currentTeam.some(slug => boxedPokemon.includes(slug))) return fail(409, 'Current Trainer roster authority is ambiguous')
  return Object.freeze({ currentTeam, boxedPokemon })
}
const trainerControl = (profile: PlayerProfile | null, sheet: StoredSheet, minute: number): BreedingTrainerControlEvidenceV1 | null => profile
  ? createBreedingTrainerControlEvidenceV1({
      profile,
      trainerSheetSlug: sheet.slug,
      trainerSheetRevision: sheet.revision,
      trainerSheetDefinitionSha256: sha256(sheet.document),
      evaluatedAtCampaignMinute: minute,
    })
  : null

const commandIdentity = (request: BreedingProjectChoicesRequestV1, principalKey: string): {
  readonly operationId: ReturnType<typeof operationId>
  readonly projectId: ReturnType<typeof projectId>
} => {
  const identity = {
    schemaVersion: 1,
    draftId: request.draftId,
    principalKey,
    destinationTrainerSlug: request.destinationTrainerSlug,
    breederTrainerSlug: request.breederTrainerSlug,
    parentRefs: request.parentRefs,
  }
  return Object.freeze({
    operationId: operationId({ ...identity, kind: 'create-breeding-project' }),
    projectId: projectId({ ...identity, kind: 'breeding-project' }),
  })
}
const gmVerifier = (role: AuthRole, dependency: LoadBreedingProjectChoicesDependencies['validateCurrentGmAuthority']) => (
  dependency ?? ((actor: BreedingActorAuthorityV1) => role === 'gm' && actor.role === 'gm')
)

const makeCommand = (input: {
  readonly commandKind: 'create-breeding-project' | 'preview-breeding'
  readonly operationId: ReturnType<typeof operationId>
  readonly projectId?: ReturnType<typeof projectId>
  readonly request: BreedingProjectChoicesRequestV1
  readonly profile: PlayerProfile | null
  readonly options: BreedingCampaignOptionSnapshotV1
  readonly crossOwner: boolean
}): SetupContext['command'] => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: input.operationId,
  commandKind: input.commandKind,
  actor: {
    profileId: input.profile?.id ?? 'campaign-gm',
    selectedTrainerSlug: input.request.destinationTrainerSlug,
  },
  ruleset: { rulesetId: rulesetJson.rulesetId, definitionSha256: rulesetJson.definitionSha256 },
  scopes: input.commandKind === 'create-breeding-project'
    ? [{ kind: 'breeding-project', projectId: input.projectId, expectedRevision: null }]
    : [],
  payload: {
    ...(input.commandKind === 'create-breeding-project' ? { projectId: input.projectId } : {}),
    ownerTrainerSlug: input.request.destinationTrainerSlug,
    breederTrainerSlug: input.request.breederTrainerSlug,
    parentRefs: input.request.parentRefs.map(ref => ({
      pokemonSheetSlug: ref.pokemonSheetSlug,
      expectedSheetRevision: ref.expectedSheetRevision,
    })),
    optionSnapshotDefinitionSha256: input.options.definitionSha256,
    ...(input.commandKind === 'create-breeding-project' ? {
      consentPolicy: input.crossOwner
        ? 'cross-owner-current-revision-consent'
        : 'same-owner-control',
    } : {}),
  },
}) as SetupContext['command']

const actorFor = (input: {
  readonly role: AuthRole
  readonly command: SetupContext['command']
  readonly wizardActor: BreedingActorAuthorityV1
  readonly profile: PlayerProfile | null
  readonly minute: number
}): BreedingActorAuthorityV1 => createBreedingActorAuthorityV1({
  role: input.role,
  command: input.command,
  authenticatedPrincipalSha256: input.wizardActor.authenticatedPrincipalSha256,
  authenticationPolicyDefinitionSha256: input.wizardActor.authenticationPolicyDefinitionSha256,
  profile: input.profile,
  evaluatedAtCampaignMinute: input.minute,
})

const resolveBreeder = (input: {
  readonly role: AuthRole
  readonly actor: BreedingActorAuthorityV1
  readonly breederSheet: StoredSheet
  readonly breederControl: BreedingTrainerControlEvidenceV1 | null
  readonly selectedSkill: SkillKey | null
  readonly checkpoint: 'project-creation' | 'project-preview'
  readonly database: RotomDatabase
  readonly dependencies: LoadBreedingProjectChoicesDependencies
}): BreederResolution => {
  const verifier = gmVerifier(input.role, input.dependencies.validateCurrentGmAuthority)
  const resolverOptions = input.role === 'gm'
    ? { database: input.database, validateCurrentGmAuthority: verifier }
    : { database: input.database }
  let feature: BreedingFeatureProviderHandoffV1 | null = null
  try {
    const raw = (input.dependencies.resolveCurrentFeatureProviderHandoff
      ?? resolveCurrentBreedingFeatureProviderHandoff)({
      trainerSheetSlug: input.breederSheet.slug,
      expectedTrainerSheetRevision: input.breederSheet.revision,
      checkpoint: input.checkpoint,
      actorAuthority: input.actor,
      trainerControl: input.breederControl,
      facilityClaims: [],
    }, resolverOptions)
    if (promiseLike(raw)) return fail(409, 'Current Feature provider resolution must be synchronous')
    feature = parseAuthoritativeBreedingFeatureProviderHandoffV1(raw)
  }
  catch { feature = null }
  const grants = feature?.contributions.filter(contribution => (
    contribution.providerCanonicalId === 'Dilettante'
    && contribution.contributionIds.includes('effective-breeder-edge-grant')
  )) ?? []
  if (grants.length > 1) return fail(409, 'Current Dilettante Breeder authority is ambiguous')
  if (grants.length === 1) {
    if (!input.selectedSkill) return fail(409, 'A current server-issued Dilettante Skill choice is required')
    const raw = (input.dependencies.resolveCurrentFeatureGrantedBreederHandoff
      ?? resolveCurrentFeatureGrantedBreederHandoff)({
      breederTrainerSlug: input.breederSheet.slug,
      expectedTrainerSheetRevision: input.breederSheet.revision,
      checkpoint: input.checkpoint,
      actorAuthority: input.actor,
      breederTrainerControl: input.breederControl,
    }, {
      ...resolverOptions,
      selectDilettanteMandatedSkill: () => input.selectedSkill!,
    })
    if (promiseLike(raw)) return fail(409, 'Current Dilettante resolution must be synchronous')
    return Object.freeze({
      handoff: parseAuthoritativeBreedingBreederEdgeHandoffV1(raw.breederHandoff),
      featureHandoff: parseAuthoritativeBreedingFeatureProviderHandoffV1(raw.featureHandoff),
      selectedSkill: input.selectedSkill,
    })
  }
  const raw = (input.dependencies.resolveCurrentBreederEdgeHandoff
    ?? resolveCurrentBreedingBreederEdgeHandoff)({
    breederTrainerSlug: input.breederSheet.slug,
    expectedTrainerSheetRevision: input.breederSheet.revision,
    checkpoint: input.checkpoint,
    actorAuthority: input.actor,
    breederTrainerControl: input.breederControl,
  }, resolverOptions)
  if (promiseLike(raw)) return fail(409, 'Current Breeder resolution must be synchronous')
  return Object.freeze({
    handoff: parseAuthoritativeBreedingBreederEdgeHandoffV1(raw),
    featureHandoff: null,
    selectedSkill: null,
  })
}

const readResource = (input: {
  readonly resourceKind: BreedingReadResourceV1['resourceKind']
  readonly resourceId: string
  readonly existence: 'present' | 'absent'
  readonly revision: number | null
  readonly definitionSha256: string | null
  readonly observedCampaignMinute?: number | null
  readonly purposes: readonly BreedingReadResourceV1['purposes'][number][]
}): BreedingReadResourceV1 => parseBreedingReadResourceV1({
  ...input,
  observedCampaignMinute: input.observedCampaignMinute ?? null,
  purposes: [...new Set(input.purposes)].sort(compare),
})
const dependencySet = (values: readonly BreedingDependencyEvidenceV1[]): readonly BreedingDependencyEvidenceV1[] => {
  const byKey = new Map<string, BreedingDependencyEvidenceV1>()
  for (const value of values) {
    const key = `${value.checkpoint}\u0000${value.providerKind}\u0000${value.providerId}\u0000${value.subjectKind}\u0000${value.subjectId}`
    const existing = byKey.get(key)
    if (existing && stableJsonStringify(existing) !== stableJsonStringify(value)) {
      return fail(409, 'Current Project dependency authority is ambiguous')
    }
    byKey.set(key, value)
  }
  const resolved = [...byKey.values()].sort((left, right) => compare(
    `${left.checkpoint}\u0000${left.providerKind}\u0000${left.providerId}\u0000${left.subjectKind}\u0000${left.subjectId}`,
    `${right.checkpoint}\u0000${right.providerKind}\u0000${right.providerId}\u0000${right.subjectKind}\u0000${right.subjectId}`,
  ))
  return Object.freeze([{
    providerKind: 'system',
    providerId: 'breeding-effective-dependency-set-v1',
    subjectKind: 'campaign',
    subjectId: 'campaign',
    subjectRevision: null,
    checkpoint: 'authorization',
    providerDefinitionSha256: authorizationContractJson.definitionSha256,
    effectiveEvidenceSha256: sha256(resolved),
  }, ...resolved])
}

const buildParents = (input: {
  readonly guidance: ReturnType<typeof loadBreedingProjectGuidanceAuthority>['projection']
  readonly repository: ReturnType<typeof loadBreedingProjectGuidanceAuthority>['wizardAuthority']['sheetRepository']
  readonly profile: PlayerProfile | null
  readonly role: AuthRole
  readonly minute: number
}): readonly [CurrentParent, CurrentParent] => {
  const candidates = new Map(input.guidance.wizard.parentDiscovery.trainerSheets
    .flatMap(trainer => trainer.candidates)
    .map(candidate => [candidate.parentSheetSlug, candidate] as const))
  const output = input.guidance.wizard.parentDiscovery.selectedParentRefs.map((ref) => {
    const candidate = candidates.get(ref.pokemonSheetSlug)
    if (!candidate || candidate.availability.status !== 'selectable'
      || candidate.parentSheetRevision !== ref.expectedSheetRevision
      || candidate.speciesId === null || candidate.genderId === null || candidate.level === null) {
      return fail(409, 'Selected parent authority is stale or unavailable')
    }
    const sheet = input.repository.get('pokemon', candidate.parentSheetSlug)
    const owner = input.repository.get('trainer', candidate.ownerTrainerSlug)
    if (!sheet || sheet.revision !== candidate.parentSheetRevision || !owner
      || owner.revision !== candidate.ownerTrainerRevision) return fail(409, 'Selected parent storage authority changed')
    const roster = strictRoster(owner.document)
    const ownerControl = trainerControl(input.profile, owner, input.minute)
    const parentControl = createBreedingParentControlEvidenceV1({
      parentSheetSlug: sheet.slug,
      parentSheetRevision: sheet.revision,
      parentSheetDefinitionSha256: sha256(sheet.document),
      ownerTrainer: {
        slug: owner.slug,
        revision: owner.revision,
        definitionSha256: sha256(owner.document),
        currentTeam: roster.currentTeam,
        boxedPokemon: roster.boxedPokemon,
      },
      trainerControl: input.role === 'player' ? ownerControl : null,
      verificationMode: input.role === 'player' ? 'profile-control' : 'gm-verified',
      evaluatedAtCampaignMinute: input.minute,
    })
    const spec = compiledBreedingSpeciesSpec(candidate.speciesId)
    if (!spec) return fail(409, 'Selected parent Species authority is unavailable')
    const facts = createBreedingProjectParentFactsV1({
      schemaVersion: 1,
      parentSheetSlug: sheet.slug,
      parentSheetRevision: sheet.revision,
      parentSheetDefinitionSha256: sha256(sheet.document),
      speciesId: spec.speciesId,
      speciesSpecDefinitionSha256: spec.definitionSha256,
      genderId: candidate.genderId,
      level: candidate.level,
      eggGroupIds: spec.eggGroupIds,
      capturedAtCampaignMinute: input.minute,
    })
    return Object.freeze({ candidate, sheet, owner, ownerControl, parentControl, facts })
  })
  if (output.length !== 2) return fail(409, 'Project choices require exactly two current parents')
  return Object.freeze([output[0]!, output[1]!])
}

const gmOverridesFor = (input: {
  readonly role: AuthRole
  readonly command: SetupContext['command']
  readonly actor: BreedingActorAuthorityV1
  readonly parents: readonly [CurrentParent, CurrentParent]
  readonly minute: number
}): readonly BreedingGmOverrideEvidenceV1[] => {
  if (input.role !== 'gm') return Object.freeze([])
  const definitions = [
    { kind: 'owner-control' as const, target: { kind: 'trainer-sheet' as const, trainerSheetSlug: input.command.payload.ownerTrainerSlug } },
    { kind: 'breeder-access' as const, target: { kind: 'trainer-sheet' as const, trainerSheetSlug: input.command.payload.breederTrainerSlug } },
    ...input.parents.flatMap(parent => ([
      {
        kind: 'parent-control' as const,
        target: {
          kind: 'parent-sheet' as const,
          parentSheetSlug: parent.sheet.slug,
          parentSheetRevision: parent.sheet.revision,
        },
      },
      ...(parent.owner.slug !== input.command.payload.ownerTrainerSlug ? [{
        // This audited setup-only override permits creation of the private
        // request. It is never accepted as positive participant consent by
        // later Project mechanics.
        kind: 'cross-owner-consent' as const,
        target: {
          kind: 'parent-sheet' as const,
          parentSheetSlug: parent.sheet.slug,
          parentSheetRevision: parent.sheet.revision,
        },
      }] : []),
    ])),
  ]
  return Object.freeze(definitions.map(definition => createBreedingGmOverrideEvidenceV1({
    overrideId: overrideId({ operationId: input.command.operationId, ...definition }),
    command: input.command,
    actorAuthority: input.actor,
    overrideKind: definition.kind,
    target: definition.target,
    reasonId: `breeding.override.project-choices.${definition.kind}`,
    createdAtCampaignMinute: input.minute,
    securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
  })))
}

const buildContext = (input: {
  readonly role: AuthRole
  readonly profile: PlayerProfile | null
  readonly request: BreedingProjectChoicesRequestV1
  readonly guidanceAuthority: ReturnType<typeof loadBreedingProjectGuidanceAuthority>
  readonly command: SetupContext['command']
  readonly selectedSkill: SkillKey | null
  readonly extraRecords: readonly (BreedingGmAdjudicationRecordV1 | BreedingOptionOfferRecordV1)[]
  readonly dependencies: LoadBreedingProjectChoicesDependencies
}): SetupContext => {
  const { wizardAuthority, projection: guidance } = input.guidanceAuthority
  const database = wizardAuthority.database
  const minute = guidance.wizard.generatedAtCampaignMinute
  const clock = createSqliteCampaignClockRepository(database).get()
  if (clock.campaignMinute !== minute) return fail(409, 'Campaign authority changed during Project choice resolution')
  const actor = actorFor({
    role: input.role,
    command: input.command,
    wizardActor: wizardAuthority.actorAuthority,
    profile: input.profile,
    minute,
  })
  const parents = buildParents({
    guidance,
    repository: wizardAuthority.sheetRepository,
    profile: input.profile,
    role: input.role,
    minute,
  })
  const ownerSheet = wizardAuthority.sheetRepository.get('trainer', input.command.payload.ownerTrainerSlug)
  const breederSheet = wizardAuthority.sheetRepository.get('trainer', input.command.payload.breederTrainerSlug)
  if (!ownerSheet || !breederSheet) return fail(409, 'Current Project Trainer authority is unavailable')
  const ownerControl = trainerControl(input.profile, ownerSheet, minute)
  const breederControl = trainerControl(input.profile, breederSheet, minute)
  const breeder = resolveBreeder({
    role: input.role,
    actor,
    breederSheet,
    breederControl,
    selectedSkill: input.selectedSkill,
    checkpoint: input.command.commandKind === 'create-breeding-project' ? 'project-creation' : 'project-preview',
    database,
    dependencies: input.dependencies,
  })
  const resources = new Map<string, BreedingReadResourceV1>()
  const add = (resource: BreedingReadResourceV1): void => {
    const key = `${resource.resourceKind}\u0000${resource.resourceId}`
    const existing = resources.get(key)
    if (!existing) { resources.set(key, resource); return }
    if (existing.existence !== resource.existence || existing.revision !== resource.revision
      || existing.definitionSha256 !== resource.definitionSha256
      || existing.observedCampaignMinute !== resource.observedCampaignMinute) {
      return fail(409, 'Current Project read authority is contradictory')
    }
    resources.set(key, readResource({
      resourceKind: existing.resourceKind,
      resourceId: existing.resourceId,
      existence: existing.existence,
      revision: existing.revision,
      definitionSha256: existing.definitionSha256,
      observedCampaignMinute: existing.observedCampaignMinute,
      purposes: [...existing.purposes, ...resource.purposes],
    }))
  }
  add(readResource({
    resourceKind: 'campaign-clock', resourceId: 'campaign-clock', existence: 'present',
    revision: clock.revision, definitionSha256: sha256(clock), observedCampaignMinute: clock.campaignMinute,
    purposes: ['campaign-time'],
  }))
  for (const sheet of [ownerSheet, breederSheet, ...parents.map(parent => parent.owner)]) {
    const purposes: BreedingReadResourceV1['purposes'][number][] = ['authorization']
    if (sheet.slug === breederSheet.slug) purposes.push('mechanics')
    add(readResource({
      resourceKind: 'trainer-sheet', resourceId: sheet.slug, existence: 'present',
      revision: sheet.revision, definitionSha256: sha256(sheet.document), purposes,
    }))
  }
  for (const parent of parents) add(readResource({
    resourceKind: 'pokemon-sheet', resourceId: parent.sheet.slug, existence: 'present',
    revision: parent.sheet.revision, definitionSha256: sha256(parent.sheet.document), purposes: ['snapshot'],
  }))
  if (input.command.commandKind === 'create-breeding-project') add(readResource({
    resourceKind: 'breeding-project', resourceId: input.command.payload.projectId, existence: 'absent',
    revision: null, definitionSha256: null, purposes: ['conflict'],
  }))
  for (const record of input.extraRecords) add(readResource({
    resourceKind: 'adjudicationId' in record ? 'breeding-adjudication' : 'breeding-offer',
    resourceId: 'adjudicationId' in record ? record.adjudicationId : record.offerId,
    existence: 'present', revision: record.revision, definitionSha256: record.definitionSha256,
    purposes: ['mechanics'],
  }))
  const providerDependencies: BreedingDependencyEvidenceV1[] = [breeder.handoff.dependencyEvidence]
  if (breeder.featureHandoff) providerDependencies.push(...breeder.featureHandoff.dependencyEvidence)
  const readSet = createBreedingOperationReadSetV1({
    readSetId: readSetId({ operationId: input.command.operationId, kind: 'project-choices-current-read-set' }),
    operationId: input.command.operationId,
    commandSha256: createBreedingOperationCommandHash(input.command),
    commandKind: input.command.commandKind,
    capturedAtCampaignMinute: minute,
    resources: [...resources.values()],
    referenceVersions: createCurrentBreedingReferenceVersionSnapshotV1(wizardAuthority.campaignOptions),
    dependencyEvidence: dependencySet(providerDependencies),
    writeExpectations: input.command.scopes,
  })
  const gmOverrides = gmOverridesFor({ role: input.role, command: input.command, actor, parents, minute })
  const parentInputs = parents.map(parent => ({
    parentControl: parent.parentControl,
    ownerTrainerControl: input.role === 'player' ? parent.ownerControl : null,
    consentEvidence: null,
  })) as unknown as readonly [
    { readonly parentControl: BreedingParentControlEvidenceV1, readonly ownerTrainerControl: BreedingTrainerControlEvidenceV1 | null, readonly consentEvidence: null },
    { readonly parentControl: BreedingParentControlEvidenceV1, readonly ownerTrainerControl: BreedingTrainerControlEvidenceV1 | null, readonly consentEvidence: null },
  ]
  const receipt = authorizeBreedingProjectSetupV1({
    command: input.command,
    readSet,
    actorAuthority: actor,
    ownerTrainerControl: input.role === 'player' ? ownerControl : null,
    breederAuthority: breeder.handoff.breederAuthority,
    breederTrainerControl: input.role === 'player' ? breederControl : null,
    parents: parentInputs,
    gmOverrides,
    securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
  })
  if (!receipt.authorized) return fail(403, 'Current Project creation authority is unavailable')
  return Object.freeze({
    command: input.command,
    actor,
    readSet,
    receipt,
    ownerControl: input.role === 'player' ? ownerControl : null,
    breeder,
    breederControl: input.role === 'player' ? breederControl : null,
    parents,
    gmOverrides,
  })
}

const rankIndex = (rank: PokemonEducationRank | null): number => rank === null
  ? -1
  : ['Untrained', 'Novice', 'Adept', 'Expert', 'Master'].indexOf(rank)
const traitChoices = (rank: PokemonEducationRank | null): BreedingProjectChoicesProjectionV1['traitChoices'] => Object.freeze(
  BREEDING_PROJECT_CHOICE_TRAIT_KINDS.map((traitKind): BreedingProjectTraitChoiceAuthorityV1 => {
    const requiredRank = BREEDING_PROJECT_CHOICE_REQUIRED_RANKS[traitKind]
    return Object.freeze({
      traitKind,
      requiredRank,
      effectiveRank: rank,
      status: rank === null ? 'unavailable'
        : rankIndex(rank) >= rankIndex(requiredRank) ? 'choice-authorised' : 'random-only',
      resolutionCheckpoint: 'egg-production',
    })
  }),
) as BreedingProjectChoicesProjectionV1['traitChoices']

const maturityIdentity = (
  facts: BreedingProjectParentFactsV1,
  options: BreedingCampaignOptionSnapshotV1,
  request: BreedingProjectChoicesRequestV1,
) => ({
  kind: 'maturity-confirmation',
  ownerTrainerSlug: request.destinationTrainerSlug,
  breederTrainerSlug: request.breederTrainerSlug,
  parentSheetSlug: facts.parentSheetSlug,
  parentSheetRevision: facts.parentSheetRevision,
  parentFactsDefinitionSha256: facts.definitionSha256,
  optionSnapshotDefinitionSha256: options.definitionSha256,
})
const roleIdentity = (
  parents: readonly [CurrentParent, CurrentParent],
  options: BreedingCampaignOptionSnapshotV1,
  request: BreedingProjectChoicesRequestV1,
) => ({
  kind: 'parent-role-override',
  ownerTrainerSlug: request.destinationTrainerSlug,
  breederTrainerSlug: request.breederTrainerSlug,
  parentFactsDefinitionSha256: parents.map(parent => parent.facts.definitionSha256),
  optionSnapshotDefinitionSha256: options.definitionSha256,
})
const resolvedMaturity = (
  database: RotomDatabase,
  facts: BreedingProjectParentFactsV1,
  options: BreedingCampaignOptionSnapshotV1,
  request: BreedingProjectChoicesRequestV1,
): BreedingGmAdjudicationRecordV1 | null => {
  const record = createSqliteBreedingGmAdjudicationRepository(database).get(adjudicationId(maturityIdentity(facts, options, request)))
  return record?.status === 'resolved' && record.decision?.kind === 'confirmation' && record.decision.confirmed
    ? record
    : null
}
const resolvedRole = (database: RotomDatabase, identity: ReturnType<typeof roleIdentity>): {
  readonly adjudication: BreedingGmAdjudicationRecordV1
  readonly offer: BreedingOptionOfferRecordV1
} | null => {
  const adjudication = createSqliteBreedingGmAdjudicationRepository(database).get(adjudicationId(identity))
  const offer = createSqliteBreedingOptionOfferRepository(database).get(offerId(identity))
  return adjudication?.status === 'resolved' && adjudication.decision?.kind === 'option'
    && offer?.status === 'consumed' && offer.selectedOptionId === adjudication.decision.optionId
    ? Object.freeze({ adjudication, offer })
    : null
}

const validAdjudicationSettlement = (database: RotomDatabase, input: {
  readonly adjudication: BreedingGmAdjudicationRecordV1
  readonly offer: BreedingOptionOfferRecordV1 | null
}): boolean => {
  try {
    const operation = createSqliteBreedingOperationRepository(database).get(input.adjudication.createdOperationId)
    const evidence = createSqliteBreedingOperationEvidenceRepository(database).get(input.adjudication.createdOperationId)
    if (!operation || operation.status !== 'accepted' || operation.command.commandKind !== 'preview-breeding'
      || operation.command.actor.profileId !== 'campaign-gm' || operation.result?.ok !== true
      || operation.result.outcomeKind !== 'previewed' || !evidence
      || !evidence.authorizationReceipt.authorized
      || evidence.authorizationReceipt.securityPolicyDefinitionSha256 !== securityPolicyJson.definitionSha256
      || input.adjudication.settlementOperationId !== operation.operationId
      || input.adjudication.settlementCommandSha256 !== operation.commandHash
      || input.adjudication.createdCommandSha256 !== operation.commandHash) return false
    return input.offer === null || input.offer.issuedOperationId === operation.operationId
      && input.offer.issuedCommandSha256 === operation.commandHash
      && input.offer.settlementOperationId === operation.operationId
      && input.offer.settlementCommandSha256 === operation.commandHash
  }
  catch { return false }
}

const settleMaturity = (input: {
  readonly base: Omit<Parameters<typeof buildContext>[0], 'command' | 'extraRecords'>
  readonly parent: CurrentParent
  readonly options: BreedingCampaignOptionSnapshotV1
  readonly coordinator: BreedingTransactionCoordinator
}): BreedingGmAdjudicationRecordV1 => {
  const identity = maturityIdentity(input.parent.facts, input.options, input.base.request)
  const opId = operationId({ ...identity, kind: 'review-maturity' })
  const command = makeCommand({
    commandKind: 'preview-breeding', operationId: opId,
    request: input.base.request, profile: null, options: input.options, crossOwner: false,
  })
  const context = buildContext({ ...input.base, role: 'gm', profile: null, command, extraRecords: [] })
  const commandSha256 = createBreedingOperationCommandHash(command)
  const canonicalPending = createBreedingGmAdjudicationRecordV1({
    schemaVersion: 1,
    adjudicationId: adjudicationId(identity),
    revision: 0,
    status: 'pending',
    adjudicationKind: 'maturity-confirmation',
    decisionMode: 'audited-confirmation',
    target: { kind: 'pokemon-sheet', sheetSlug: input.parent.sheet.slug, revision: input.parent.sheet.revision },
    createdByProfileId: 'campaign-gm',
    reasonId: 'breeding.maturity.reviewed',
    offerId: null,
    decision: null,
    createdOperationId: command.operationId,
    createdCommandSha256: commandSha256,
    createdAtCampaignMinute: context.readSet.capturedAtCampaignMinute,
    resolvedByProfileId: null,
    settlementOperationId: null,
    settlementCommandSha256: null,
    settledAtCampaignMinute: null,
    settlementReasonId: null,
    authorityDefinitionHashes: [
      BREEDING_COMPATIBILITY_POLICY_DEFINITION_SHA256,
      input.parent.facts.definitionSha256,
      input.options.definitionSha256,
      input.options.rulesetDefinitionSha256,
    ].sort(compare),
  })
  const resolved = createBreedingGmAdjudicationRecordV1({
    ...canonicalPending,
    revision: 1,
    status: 'resolved',
    decision: { kind: 'confirmation', confirmed: true, evidenceDefinitionSha256: input.parent.facts.definitionSha256 },
    resolvedByProfileId: 'campaign-gm',
    settlementOperationId: command.operationId,
    settlementCommandSha256: commandSha256,
    settledAtCampaignMinute: context.readSet.capturedAtCampaignMinute,
  })
  input.coordinator.execute({
    command,
    createdAtCampaignMinute: context.readSet.capturedAtCampaignMinute,
    settledAtCampaignMinute: context.readSet.capturedAtCampaignMinute,
    execute: (canonical, _operation, tx) => {
      tx.repositories.operationEvidence.insert({ command: canonical, readSet: context.readSet, authorizationReceipt: context.receipt })
      tx.repositories.gmAdjudications.insert(canonicalPending)
      const replacement = tx.repositories.gmAdjudications.replace({ expectedRevision: 0, record: resolved })
      if (replacement.kind !== 'applied') throw new Error('Maturity adjudication changed during settlement.')
      return createBreedingOperationAcceptedV1({
        operationId: canonical.operationId,
        commandHash: createBreedingOperationCommandHash(canonical),
        commandKind: canonical.commandKind,
        outcomeKind: 'previewed',
        aggregateRefs: [],
        changedScopes: [],
        committedAtCampaignMinute: null,
      })
    },
  })
  return createSqliteBreedingGmAdjudicationRepository(input.coordinator.database).get(resolved.adjudicationId)
    ?? fail(409, 'Resolved maturity review was not persisted')
}

const compatibilityAuthorityHashes = (parents: readonly [CurrentParent, CurrentParent], options: BreedingCampaignOptionSnapshotV1): readonly string[] => Object.freeze([
  BREEDING_COMPATIBILITY_POLICY_DEFINITION_SHA256,
  options.definitionSha256,
  options.rulesetDefinitionSha256,
  ...parents.map(parent => parent.facts.definitionSha256),
].sort(compare))

const roleOptionDefinitions = (parents: readonly [CurrentParent, CurrentParent]) => ([
  { canonicalValueId: 'first-female-second-male', roles: ['female-parent', 'male-parent'] as const },
  { canonicalValueId: 'first-male-second-female', roles: ['male-parent', 'female-parent'] as const },
].map(definition => Object.freeze({
  ...definition,
  optionId: optionId({
    kind: 'parent-role',
    canonicalValueId: definition.canonicalValueId,
    parentFactsDefinitionSha256: parents.map(parent => parent.facts.definitionSha256),
  }),
})))

const settleRole = (input: {
  readonly base: Omit<Parameters<typeof buildContext>[0], 'command' | 'extraRecords'>
  readonly parents: readonly [CurrentParent, CurrentParent]
  readonly options: BreedingCampaignOptionSnapshotV1
  readonly selectedOptionId: BreedingOfferOptionId
  readonly coordinator: BreedingTransactionCoordinator
}): { readonly adjudication: BreedingGmAdjudicationRecordV1, readonly offer: BreedingOptionOfferRecordV1 } => {
  const identity = roleIdentity(input.parents, input.options, input.base.request)
  const opId = operationId({ ...identity, kind: 'review-parent-role' })
  const command = makeCommand({
    commandKind: 'preview-breeding', operationId: opId,
    request: input.base.request, profile: null, options: input.options, crossOwner: false,
  })
  const context = buildContext({ ...input.base, role: 'gm', profile: null, command, extraRecords: [] })
  const commandSha256 = createBreedingOperationCommandHash(command)
  const definitions = roleOptionDefinitions(input.parents)
  if (!definitions.some(row => row.optionId === input.selectedOptionId)) return fail(400, 'Parent-role selection is not a current server option')
  const evidenceIds = input.parents.map(parent => parent.facts.definitionSha256).sort(compare)
  const activeOffer = createBreedingOptionOfferRecordV1({
    schemaVersion: 1,
    offerId: offerId(identity),
    choiceKind: 'parent-role',
    target: { kind: 'trainer-sheet', sheetSlug: input.base.request.destinationTrainerSlug, revision: input.parents[0].owner.revision },
    chooserProfileId: 'campaign-gm',
    minimumPokemonEducationRank: null,
    options: definitions.map(definition => ({
      optionId: definition.optionId,
      kind: 'parent-role' as const,
      canonicalValueId: definition.canonicalValueId,
      valueDefinitionSha256: sha256({ schemaVersion: 1, canonicalValueId: definition.canonicalValueId, roles: definition.roles }),
      authorityEvidenceIds: evidenceIds,
    })).sort((left, right) => compare(left.optionId, right.optionId)),
    issuedOperationId: command.operationId,
    issuedCommandSha256: commandSha256,
    issuedAtCampaignMinute: context.readSet.capturedAtCampaignMinute,
    expiresAtCampaignMinute: context.readSet.capturedAtCampaignMinute + 1,
  })
  const consumedOffer = createBreedingOptionOfferRevisionV1({
    ...activeOffer,
    revision: 1,
    status: 'consumed',
    selectedOptionId: input.selectedOptionId,
    settlementOperationId: command.operationId,
    settlementCommandSha256: commandSha256,
    settledAtCampaignMinute: context.readSet.capturedAtCampaignMinute,
    settlementReasonId: null,
  })
  const pending = createBreedingGmAdjudicationRecordV1({
    schemaVersion: 1,
    adjudicationId: adjudicationId(identity),
    revision: 0,
    status: 'pending',
    adjudicationKind: 'parent-role-override',
    decisionMode: 'bounded-option',
    target: activeOffer.target,
    createdByProfileId: 'campaign-gm',
    reasonId: 'breeding.parent-role.reviewed',
    offerId: activeOffer.offerId,
    decision: null,
    createdOperationId: command.operationId,
    createdCommandSha256: commandSha256,
    createdAtCampaignMinute: context.readSet.capturedAtCampaignMinute,
    resolvedByProfileId: null,
    settlementOperationId: null,
    settlementCommandSha256: null,
    settledAtCampaignMinute: null,
    settlementReasonId: null,
    authorityDefinitionHashes: compatibilityAuthorityHashes(input.parents, input.options),
  })
  const resolved = createBreedingGmAdjudicationRecordV1({
    ...pending,
    revision: 1,
    status: 'resolved',
    decision: { kind: 'option', optionId: input.selectedOptionId },
    resolvedByProfileId: 'campaign-gm',
    settlementOperationId: command.operationId,
    settlementCommandSha256: commandSha256,
    settledAtCampaignMinute: context.readSet.capturedAtCampaignMinute,
  })
  input.coordinator.execute({
    command,
    createdAtCampaignMinute: context.readSet.capturedAtCampaignMinute,
    settledAtCampaignMinute: context.readSet.capturedAtCampaignMinute,
    execute: (canonical, _operation, tx) => {
      tx.repositories.operationEvidence.insert({ command: canonical, readSet: context.readSet, authorizationReceipt: context.receipt })
      tx.repositories.optionOffers.insert(activeOffer)
      tx.repositories.gmAdjudications.insert(pending)
      if (tx.repositories.optionOffers.replace({ expectedRevision: 0, record: consumedOffer }).kind !== 'applied'
        || tx.repositories.gmAdjudications.replace({ expectedRevision: 0, record: resolved }).kind !== 'applied') {
        throw new Error('Parent-role review changed during settlement.')
      }
      return createBreedingOperationAcceptedV1({
        operationId: canonical.operationId,
        commandHash: createBreedingOperationCommandHash(canonical),
        commandKind: canonical.commandKind,
        outcomeKind: 'previewed',
        aggregateRefs: [],
        changedScopes: [],
        committedAtCampaignMinute: null,
      })
    },
  })
  const adjudication = createSqliteBreedingGmAdjudicationRepository(input.coordinator.database).get(resolved.adjudicationId)
  const offer = createSqliteBreedingOptionOfferRepository(input.coordinator.database).get(consumedOffer.offerId)
  if (!adjudication || !offer) return fail(409, 'Resolved parent-role review was not persisted')
  return Object.freeze({ adjudication, offer })
}

const confirmationFor = (input: {
  readonly guidance: ReturnType<typeof loadBreedingProjectGuidanceAuthority>['projection']
  readonly skillChoice: BreedingProjectSkillChoiceV1
  readonly maturityChoices: readonly BreedingProjectMaturityChoiceV1[]
  readonly roleChoice: BreedingProjectParentRoleChoiceV1
  readonly currentCompatibilityUnavailable: boolean
  readonly created: BreedingProjectInitialTimeExecutionResultV1['project']
}): BreedingProjectChoiceConfirmationV1 => {
  if (input.created) return Object.freeze({
    status: 'created',
    setupStatus: input.created.status === 'awaiting-parent-consent' ? 'awaiting-consent' : 'ready',
    canConfirm: false,
    explicitConfirmationRequired: true,
    messageId: input.created.status === 'awaiting-parent-consent'
      ? 'breeding.project-choices.project-awaiting-consent'
      : 'breeding.project-choices.project-created',
    project: Object.freeze({ projectId: input.created.projectId, revision: 0, status: input.created.status }),
  }) as BreedingProjectChoiceConfirmationV1
  if (input.guidance.wizard.parentDiscovery.selectedParentRefs.length !== 2) return Object.freeze({
    status: 'incomplete', setupStatus: 'not-evaluated', canConfirm: false,
    explicitConfirmationRequired: true, messageId: 'breeding.project-choices.selection-incomplete', project: null,
  })
  if (input.guidance.wizard.consentStatus === 'review-required') return Object.freeze({
    status: 'blocked', setupStatus: 'not-evaluated', canConfirm: false,
    explicitConfirmationRequired: true, messageId: 'breeding.project-choices.cross-owner-consent-required', project: null,
  })
  if (input.skillChoice.status === 'required') return Object.freeze({
    status: 'blocked', setupStatus: 'not-evaluated', canConfirm: false,
    explicitConfirmationRequired: true, messageId: 'breeding.project-choices.breeder-choice-required', project: null,
  })
  if (input.skillChoice.status === 'unavailable') return Object.freeze({
    status: 'blocked', setupStatus: 'unavailable', canConfirm: false,
    explicitConfirmationRequired: true, messageId: 'breeding.project-choices.breeder-unavailable', project: null,
  })
  if (input.maturityChoices.some(choice => choice.status !== 'confirmed'
    && (choice.status !== 'confirmation-required' || !choice.option?.selected))) return Object.freeze({
    status: 'blocked', setupStatus: 'unavailable', canConfirm: false,
    explicitConfirmationRequired: true, messageId: 'breeding.project-choices.maturity-review-required', project: null,
  })
  if (input.roleChoice.status === 'required' || input.roleChoice.status === 'unavailable') return Object.freeze({
    status: 'blocked', setupStatus: 'unavailable', canConfirm: false,
    explicitConfirmationRequired: true, messageId: 'breeding.project-choices.parent-role-review-required', project: null,
  })
  if (input.currentCompatibilityUnavailable) return Object.freeze({
    status: 'blocked', setupStatus: 'unavailable', canConfirm: false,
    explicitConfirmationRequired: true, messageId: 'breeding.project-choices.current-validation-required', project: null,
  })
  return Object.freeze({
    status: 'ready', setupStatus: 'ready', canConfirm: true,
    explicitConfirmationRequired: true, messageId: 'breeding.project-choices.ready-to-confirm', project: null,
  })
}

/**
 * Rebuilds final Project choices from current campaign authority. Browser input
 * contains selectors and opaque option IDs only. An explicit confirmed request
 * settles any GM review first, then rebuilds the complete setup and creates the
 * Project through the existing idempotent initial-progress transaction.
 */
export const loadBreedingProjectChoices = (
  input: LoadBreedingProjectChoicesInput,
  dependencies: LoadBreedingProjectChoicesDependencies = {},
): BreedingProjectChoicesProjectionV1 => {
  const request = (() => {
    try { return parseBreedingProjectChoicesRequestV1(input.request) }
    catch { return fail(400, 'Breeding Project choice request is malformed') }
  })()
  const guidanceAuthority = loadBreedingProjectGuidanceAuthority({
    role: input.role,
    playerProfile: input.playerProfile,
    request: {
      schemaVersion: 1,
      profileId: request.profileId,
      destinationTrainerSlug: request.destinationTrainerSlug,
      breederTrainerSlug: request.breederTrainerSlug,
      parentRefs: request.parentRefs,
    },
  }, dependencies)
  const { projection: guidance, wizardAuthority } = guidanceAuthority
  const profile = wizardAuthority.playerProfile
  const options = wizardAuthority.campaignOptions
  const selectedIds = new Set<string>(request.selectedOptionIds)
  const skill = skillChoiceProjection({ guidance, request, options })
  const settings = campaignSettings(options)
  const guidanceBreederSource = guidance.sourceContributions.find(row => row.sourceCanonicalId === 'Breeder')
  const guidanceBreederRank = guidanceBreederSource?.status === 'active'
    ? guidanceBreederSource.skillApplication!.rank as PokemonEducationRank
    : null
  const skillAllowedOptionIds = skill.projection.options.map(option => option.optionId)
  const identity = commandIdentity(request, wizardAuthority.actorAuthority.authenticatedPrincipalSha256)
  const existingProject = createSqliteBreedingProjectRepository(wizardAuthority.database).get(identity.projectId)
  if (existingProject) {
    // A terminal exact retry may carry the previously issued adjudication option
    // IDs. They never affect the already-created aggregate; syntax remains
    // closed and the durable Project lookup prevents a second mutation.
    return createBreedingProjectChoicesProjectionV1({
      guidance,
      skillChoice: skill.projection,
      traitChoices: traitChoices(guidanceBreederRank),
      campaignSettings: settings,
      maturityChoices: Object.freeze([]),
      parentRoleChoice: Object.freeze({ status: 'not-required', options: Object.freeze([]) }),
      confirmation: confirmationFor({
        guidance,
        skillChoice: skill.projection,
        maturityChoices: [],
        roleChoice: { status: 'not-required', options: [] },
        currentCompatibilityUnavailable: false,
        created: existingProject,
      }),
    })
  }
  const compatibilityPreviewReasons = guidance.wizard.parentDiscovery.compatibilityPreview?.reasonIds ?? []
  const roleReviewablePair = compatibilityPreviewReasons.length === 1
    && compatibilityPreviewReasons[0] === 'breeding.compatibility.role-override-required'
  if (request.parentRefs.length !== 2
    || (guidance.wizard.reviewStatus !== 'requires-final-validation' && !roleReviewablePair)) {
    assertOnlyServerIssuedOptions(request.selectedOptionIds, skillAllowedOptionIds)
    return createBreedingProjectChoicesProjectionV1({
      guidance,
      skillChoice: skill.projection,
      traitChoices: traitChoices(guidanceBreederRank),
      campaignSettings: settings,
      maturityChoices: Object.freeze([]),
      parentRoleChoice: Object.freeze({ status: 'not-required', options: Object.freeze([]) }),
      confirmation: confirmationFor({
        guidance, skillChoice: skill.projection, maturityChoices: [],
        roleChoice: { status: 'not-required', options: [] },
        currentCompatibilityUnavailable: false, created: null,
      }),
    })
  }
  if (guidance.wizard.consentStatus === 'review-required') {
    assertOnlyServerIssuedOptions(request.selectedOptionIds, skillAllowedOptionIds)
    const blocked = skill.projection.status === 'required' || skill.projection.status === 'unavailable'
    let created: BreedingProjectInitialTimeExecutionResultV1['project'] = null
    if (request.confirmed) {
      if (blocked) return fail(409, 'Current Breeder authority is incomplete or unavailable')
      const crossOwnerCommand = makeCommand({
        commandKind: 'create-breeding-project', operationId: identity.operationId, projectId: identity.projectId,
        request, profile, options, crossOwner: true,
      })
      const coordinator = dependencies.coordinator ?? createBreedingTransactionCoordinator({ database: wizardAuthority.database })
      if (coordinator.database !== wizardAuthority.database) return fail(409, 'Project choice coordinator must share the current database connection')
      const current = buildContext({
        role: input.role,
        profile,
        request,
        guidanceAuthority,
        command: crossOwnerCommand,
        selectedSkill: skill.selected,
        extraRecords: [],
        dependencies,
      })
      const parentInputs = current.parents.map(parent => ({
        parentControl: parent.parentControl,
        ownerTrainerControl: input.role === 'player' ? parent.ownerControl : null,
        consentEvidence: null,
      })) as unknown as readonly [
        { readonly parentControl: BreedingParentControlEvidenceV1, readonly ownerTrainerControl: BreedingTrainerControlEvidenceV1 | null, readonly consentEvidence: null },
        { readonly parentControl: BreedingParentControlEvidenceV1, readonly ownerTrainerControl: BreedingTrainerControlEvidenceV1 | null, readonly consentEvidence: null },
      ]
      const setup = validateBreedingProjectSetupV1({
        command: current.command,
        readSet: current.readSet,
        actorAuthority: current.actor,
        ownerTrainerControl: current.ownerControl,
        breederAuthority: current.breeder.handoff.breederAuthority,
        breederTrainerControl: current.breederControl,
        parents: parentInputs,
        gmOverrides: current.gmOverrides,
        securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
        campaignOptions: options,
        // Cross-owner setup deliberately stops before parent mechanics,
        // maturity, or role adjudication. Positive consent is a later,
        // participant-owned operation.
        parentFacts: [],
        maturityAdjudications: [],
        roleAdjudication: null,
        roleOffer: null,
      })
      if (setup.authority.status !== 'awaiting-consent') return fail(409, 'Cross-owner Project setup did not remain consent-gated')
      const result = (dependencies.createProject ?? createBreedingProjectFromValidatedSetup)({
        command: current.command,
        readSet: current.readSet,
        authorizationReceipt: current.receipt,
        setupValidation: setup.authority,
        parentControls: current.parents.map(parent => parent.parentControl) as unknown as readonly [unknown, unknown],
        audience: input.role === 'gm' ? 'gm' : 'owner',
      }, {
        database: wizardAuthority.database,
        coordinator,
        campaignProjectionKey: dependencies.campaignProjectionKey ?? securityPolicyJson.definitionSha256,
        realtimeTimestamp: dependencies.realtimeTimestamp ?? Date.now(),
      })
      created = result.project
      if (!created || created.status !== 'awaiting-parent-consent') return fail(409, 'Cross-owner Project request was not durably created')
    }
    const confirmation: BreedingProjectChoiceConfirmationV1 = created
      ? confirmationFor({
          guidance, skillChoice: skill.projection, maturityChoices: [],
          roleChoice: { status: 'unavailable', options: [] },
          currentCompatibilityUnavailable: false, created,
        })
      : Object.freeze({
          status: blocked ? 'blocked' : 'ready',
          setupStatus: blocked ? 'unavailable' : 'ready',
          canConfirm: !blocked,
          explicitConfirmationRequired: true,
          messageId: skill.projection.status === 'required'
            ? 'breeding.project-choices.breeder-choice-required'
            : skill.projection.status === 'unavailable'
              ? 'breeding.project-choices.breeder-unavailable'
              : 'breeding.project-choices.ready-to-confirm',
          project: null,
        })
    return createBreedingProjectChoicesProjectionV1({
      guidance,
      skillChoice: skill.projection,
      traitChoices: traitChoices(guidanceBreederRank),
      campaignSettings: settings,
      maturityChoices: Object.freeze([]),
      parentRoleChoice: Object.freeze({ status: 'unavailable', options: Object.freeze([]) }),
      confirmation,
    })
  }
  if (skill.projection.status === 'required' || skill.projection.status === 'unavailable') {
    assertOnlyServerIssuedOptions(request.selectedOptionIds, skillAllowedOptionIds)
    return createBreedingProjectChoicesProjectionV1({
      guidance,
      skillChoice: skill.projection,
      traitChoices: traitChoices(guidanceBreederRank),
      campaignSettings: settings,
      maturityChoices: Object.freeze([]),
      parentRoleChoice: Object.freeze({ status: 'not-required', options: Object.freeze([]) }),
      confirmation: confirmationFor({
        guidance, skillChoice: skill.projection, maturityChoices: [],
        roleChoice: { status: 'not-required', options: [] },
        currentCompatibilityUnavailable: false, created: null,
      }),
    })
  }

  const createCommand = makeCommand({
    commandKind: 'create-breeding-project', operationId: identity.operationId, projectId: identity.projectId,
    request, profile, options, crossOwner: false,
  })
  let initialContext: SetupContext
  try {
    initialContext = buildContext({
      role: input.role,
      profile,
      request,
      guidanceAuthority,
      command: createCommand,
      selectedSkill: skill.selected,
      extraRecords: [],
      dependencies,
    })
  }
  catch (error) {
    if (error instanceof LoadBreedingProjectChoicesError) throw error
    return fail(409, 'Current Breeder and parent authority is unavailable')
  }
  const effectiveRank = initialContext.breeder.handoff.skillApplication.rank
  const coordinator = dependencies.coordinator ?? createBreedingTransactionCoordinator({ database: wizardAuthority.database })
  if (coordinator.database !== wizardAuthority.database) return fail(409, 'Project choice coordinator must share the current database connection')

  let maturityRecords = options.values['breeding.maturity-policy'] === 'gm-confirmed-per-parent'
    ? initialContext.parents.map(parent => resolvedMaturity(wizardAuthority.database, parent.facts, options, request))
    : [null, null]
  const maturityChoices = options.values['breeding.maturity-policy'] === 'gm-confirmed-per-parent'
    ? initialContext.parents.map((parent, index): BreedingProjectMaturityChoiceV1 => {
        const existing = maturityRecords[index]
        if (existing) return Object.freeze({
          parentOrdinal: index + 1 as 1 | 2,
          parentLabel: parent.candidate.label,
          status: 'confirmed',
          option: null,
        })
        if (input.role !== 'gm') return Object.freeze({
          parentOrdinal: index + 1 as 1 | 2,
          parentLabel: parent.candidate.label,
          status: 'unavailable',
          option: null,
        })
        const id = optionId({ ...maturityIdentity(parent.facts, options, request), value: 'confirm-current-maturity' })
        return Object.freeze({
          parentOrdinal: index + 1 as 1 | 2,
          parentLabel: parent.candidate.label,
          status: 'confirmation-required',
          option: choiceOption(
            id,
            `Confirm ${parent.candidate.label} is mature`,
            'Record a current audited GM confirmation for this exact parent revision.',
            selectedIds,
          ),
        })
      })
    : []

  const compatibility = evaluateBreedingCompatibility({
    parents: initialContext.parents.map(parent => ({
      parentRef: parent.sheet.slug,
      speciesId: parent.facts.speciesId,
      genderId: parent.facts.genderId,
      level: parent.facts.level,
      eggGroupIds: parent.facts.eggGroupIds,
      gmMaturityConfirmed: true,
    })) as unknown as Parameters<typeof evaluateBreedingCompatibility>[0]['parents'],
    options,
    roleOverride: null,
  })
  const roleRequired = compatibility.status === 'unavailable'
    && compatibility.reasonIds.includes('breeding.compatibility.role-override-required')
  const roleKey = roleIdentity(initialContext.parents, options, request)
  let roleRecords = roleRequired ? resolvedRole(wizardAuthority.database, roleKey) : null
  const projectedRoleOptions = roleOptionDefinitions(initialContext.parents)
  const projectedRoleOptionIds = new Set(projectedRoleOptions.map(option => option.optionId))
  const requestedRoleOptionIds = request.selectedOptionIds.filter(option => projectedRoleOptionIds.has(option))
  if (roleRecords) {
    const settledOptionId = roleRecords.offer.selectedOptionId
    if (!settledOptionId || requestedRoleOptionIds.some(option => option !== settledOptionId)
      || request.confirmed && !requestedRoleOptionIds.includes(settledOptionId)) {
      return fail(409, 'Parent-role confirmation does not match the persisted current review')
    }
  }
  let roleChoice: BreedingProjectParentRoleChoiceV1
  if (!roleRequired) roleChoice = Object.freeze({ status: 'not-required', options: Object.freeze([]) })
  else if (roleRecords) roleChoice = Object.freeze({
    status: 'selected',
    options: Object.freeze(projectedRoleOptions.map(definition => choiceOption(
      definition.optionId,
      definition.canonicalValueId === 'first-female-second-male'
        ? 'First parent: female role'
        : 'First parent: male role',
      definition.canonicalValueId === 'first-female-second-male'
        ? 'Assign the first parent the female role and the second parent the male role.'
        : 'Assign the first parent the male role and the second parent the female role.',
      new Set([roleRecords!.offer.selectedOptionId!]),
    )).sort((left, right) => compare(left.optionId, right.optionId))),
  })
  else if (input.role !== 'gm') roleChoice = Object.freeze({ status: 'unavailable', options: Object.freeze([]) })
  else {
    const projected = projectedRoleOptions.map(definition => choiceOption(
      definition.optionId,
      definition.canonicalValueId === 'first-female-second-male'
        ? 'First parent: female role'
        : 'First parent: male role',
      definition.canonicalValueId === 'first-female-second-male'
        ? 'Assign the first parent the female role and the second parent the male role.'
        : 'Assign the first parent the male role and the second parent the female role.',
      selectedIds,
    )).sort((left, right) => compare(left.optionId, right.optionId))
    roleChoice = Object.freeze({
      status: projected.filter(option => option.selected).length === 1 ? 'selected' : 'required',
      options: Object.freeze(projected),
    })
  }
  const compatibilityUnavailable = compatibility.status === 'unavailable' && !roleRequired
  assertOnlyServerIssuedOptions(request.selectedOptionIds, [
    ...skillAllowedOptionIds,
    ...initialContext.parents.map(parent => optionId({
      ...maturityIdentity(parent.facts, options, request),
      value: 'confirm-current-maturity',
    })),
    ...projectedRoleOptions.map(option => option.optionId),
  ])

  let confirmation = confirmationFor({
    guidance,
    skillChoice: skill.projection,
    maturityChoices,
    roleChoice,
    currentCompatibilityUnavailable: compatibilityUnavailable,
    created: null,
  })
  let created: BreedingProjectInitialTimeExecutionResultV1['project'] = null
  if (request.confirmed) {
    if (!confirmation.canConfirm) return fail(409, 'Current Project choices are incomplete or unavailable')
    if (input.role === 'gm' && options.values['breeding.maturity-policy'] === 'gm-confirmed-per-parent') {
      maturityRecords = initialContext.parents.map((parent, index) => maturityRecords[index]
        ?? settleMaturity({
          base: { role: 'gm', profile: null, request, guidanceAuthority, selectedSkill: skill.selected, dependencies },
          parent,
          options,
          coordinator,
        }))
    }
    if (input.role === 'gm' && roleRequired && !roleRecords) {
      const selected = roleChoice.options.filter(option => option.selected)
      if (selected.length !== 1) return fail(409, 'One current parent-role option is required')
      roleRecords = settleRole({
        base: { role: 'gm', profile: null, request, guidanceAuthority, selectedSkill: skill.selected, dependencies },
        parents: initialContext.parents,
        options,
        selectedOptionId: selected[0]!.optionId,
        coordinator,
      })
    }
    const extras = [
      ...maturityRecords.filter((record): record is BreedingGmAdjudicationRecordV1 => record !== null),
      ...(roleRecords ? [roleRecords.adjudication, roleRecords.offer] : []),
    ]
    const current = buildContext({
      role: input.role,
      profile,
      request,
      guidanceAuthority,
      command: createCommand,
      selectedSkill: skill.selected,
      extraRecords: extras,
      dependencies,
    })
    const parentInputs = current.parents.map(parent => ({
      parentControl: parent.parentControl,
      ownerTrainerControl: input.role === 'player' ? parent.ownerControl : null,
      consentEvidence: null,
    })) as unknown as readonly [
      { readonly parentControl: BreedingParentControlEvidenceV1, readonly ownerTrainerControl: BreedingTrainerControlEvidenceV1 | null, readonly consentEvidence: null },
      { readonly parentControl: BreedingParentControlEvidenceV1, readonly ownerTrainerControl: BreedingTrainerControlEvidenceV1 | null, readonly consentEvidence: null },
    ]
    const setupInput = {
      command: current.command,
      readSet: current.readSet,
      actorAuthority: current.actor,
      ownerTrainerControl: current.ownerControl,
      breederAuthority: current.breeder.handoff.breederAuthority,
      breederTrainerControl: current.breederControl,
      parents: parentInputs,
      gmOverrides: current.gmOverrides,
      securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
      campaignOptions: options,
      parentFacts: current.parents.map(parent => parent.facts),
      maturityAdjudications: maturityRecords.filter((record): record is BreedingGmAdjudicationRecordV1 => record !== null),
      roleAdjudication: roleRecords?.adjudication ?? null,
      roleOffer: roleRecords?.offer ?? null,
    }
    const setup = validateBreedingProjectSetupV1(setupInput, {
      validateResolvedGmAdjudication: value => validAdjudicationSettlement(wizardAuthority.database, value),
    })
    if (setup.authority.status !== 'ready') return fail(409, 'Current Project setup validation is unavailable')
    const result = (dependencies.createProject ?? createBreedingProjectFromValidatedSetup)({
      command: current.command,
      readSet: current.readSet,
      authorizationReceipt: current.receipt,
      setupValidation: setup.authority,
      parentControls: current.parents.map(parent => parent.parentControl) as unknown as readonly [unknown, unknown],
      audience: input.role === 'gm' ? 'gm' : 'owner',
    }, {
      database: wizardAuthority.database,
      coordinator,
      campaignProjectionKey: dependencies.campaignProjectionKey ?? securityPolicyJson.definitionSha256,
      realtimeTimestamp: dependencies.realtimeTimestamp ?? Date.now(),
    })
    created = result.project
    if (!created) return fail(409, 'Project creation was rejected by current authority')
    confirmation = confirmationFor({
      guidance,
      skillChoice: skill.projection,
      maturityChoices: maturityChoices.map(choice => Object.freeze({ ...choice, status: 'confirmed', option: null })),
      roleChoice,
      currentCompatibilityUnavailable: false,
      created,
    })
  }

  return createBreedingProjectChoicesProjectionV1({
    guidance,
    skillChoice: skill.projection,
    traitChoices: traitChoices(effectiveRank),
    campaignSettings: settings,
    maturityChoices: Object.freeze(maturityChoices),
    parentRoleChoice: roleChoice,
    confirmation,
  })
}
