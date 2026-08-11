import compatibilityPolicyJson from '../../../data/breeding-automation/compatibility-policy.json'
import {
  canonicalBreedingEggGroupIdentity,
  isCanonicalBreedingSpeciesId,
} from './canonicalIds'
import { compiledBreedingSpeciesSpec } from './registry'
import type { BreedingCampaignOptionSnapshotV1 } from './campaignOptions'
import type {
  BreedingEggGroupId,
  BreedingSpeciesId,
} from '#shared/breeding/ids'

export const BREEDING_COMPATIBILITY_POLICY_DEFINITION_SHA256 = compatibilityPolicyJson.definitionSha256
export const BREEDING_PARENT_ROLE_IDS = Object.freeze(['female-parent', 'male-parent'] as const)
export type BreedingParentRoleId = typeof BREEDING_PARENT_ROLE_IDS[number]
export type BreedingParentGenderId = 'female' | 'male' | 'genderless'

export interface BreedingCompatibilityParentFacts {
  readonly parentRef: string
  readonly speciesId: BreedingSpeciesId
  readonly genderId: BreedingParentGenderId
  readonly level: number
  readonly eggGroupIds: readonly BreedingEggGroupId[]
  readonly gmMaturityConfirmed: boolean
}
export interface BreedingParentRoleOverride {
  readonly evidenceId: string
  readonly roles: readonly [BreedingParentRoleId, BreedingParentRoleId]
}
export interface EvaluateBreedingCompatibilityInput {
  readonly parents: readonly [BreedingCompatibilityParentFacts, BreedingCompatibilityParentFacts]
  readonly options: BreedingCampaignOptionSnapshotV1
  readonly roleOverride: BreedingParentRoleOverride | null
}
export type BreedingCompatibilityReasonId =
  | 'breeding.compatibility.same-parent'
  | 'breeding.compatibility.spec-unavailable'
  | 'breeding.compatibility.not-breedable'
  | 'breeding.compatibility.gender-mismatch'
  | 'breeding.compatibility.maturity-unconfirmed'
  | 'breeding.compatibility.maturity-level-low'
  | 'breeding.compatibility.ditto-pair'
  | 'breeding.compatibility.no-shared-egg-group'
  | 'breeding.compatibility.genderless-unavailable'
  | 'breeding.compatibility.same-sex-unavailable'
  | 'breeding.compatibility.role-override-required'
  | 'breeding.compatibility.role-override-invalid'
  | 'breeding.compatibility.role-override-not-allowed'
  | 'breeding.compatibility.invalid-parent-facts'

export interface BreedingParentRoleAssignment {
  readonly parentRef: string
  readonly roleId: BreedingParentRoleId
  readonly assignmentKind: 'conventional-gender' | 'canonical-ditto' | 'gm-override'
  readonly evidenceId: string | null
}
export interface CompatibleBreedingResult {
  readonly status: 'compatible'
  readonly reasonIds: readonly []
  readonly compatibilityKind: 'conventional' | 'canonical-ditto' | 'gm-role-override'
  readonly parentRoles: readonly [BreedingParentRoleAssignment, BreedingParentRoleAssignment]
  readonly sharedEggGroupIds: readonly BreedingEggGroupId[]
  readonly familyContributorParentIndexes: readonly (0 | 1)[]
  readonly maturitySatisfied: readonly [true, true]
  readonly optionSnapshotDefinitionSha256: string
}
export interface UnavailableBreedingCompatibilityResult {
  readonly status: 'unavailable'
  readonly reasonIds: readonly BreedingCompatibilityReasonId[]
  readonly compatibilityKind: null
  readonly parentRoles: null
  readonly sharedEggGroupIds: readonly BreedingEggGroupId[]
  readonly familyContributorParentIndexes: readonly []
  readonly maturitySatisfied: readonly [boolean, boolean]
  readonly optionSnapshotDefinitionSha256: string
}
export type BreedingCompatibilityResult = CompatibleBreedingResult | UnavailableBreedingCompatibilityResult

const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/
const EVIDENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/
const GENDERS = new Set<BreedingParentGenderId>(['female', 'male', 'genderless'])
const REASON_ORDER = compatibilityPolicyJson.definition.reasonIds as readonly BreedingCompatibilityReasonId[]
const reasonOrder = new Map(REASON_ORDER.map((reason, index) => [reason, index]))
const sortReasons = (reasons: Iterable<BreedingCompatibilityReasonId>): readonly BreedingCompatibilityReasonId[] => Object.freeze(
  [...new Set(reasons)].sort((left, right) => reasonOrder.get(left)! - reasonOrder.get(right)!),
)
const sortedUniqueEggGroups = (values: readonly BreedingEggGroupId[]): readonly BreedingEggGroupId[] | null => {
  if (!Array.isArray(values)
    || values.length < 1
    || values.length > 2
    || values.some(value => !canonicalBreedingEggGroupIdentity(value))) return null
  const sorted = [...values].sort()
  return new Set(sorted).size === sorted.length ? Object.freeze(sorted) : null
}
const conventionalRole = (genderId: BreedingParentGenderId): BreedingParentRoleId | null => (
  genderId === 'female' ? 'female-parent' : genderId === 'male' ? 'male-parent' : null
)
const oppositeRole = (role: BreedingParentRoleId): BreedingParentRoleId => (
  role === 'female-parent' ? 'male-parent' : 'female-parent'
)
const validOverride = (value: BreedingParentRoleOverride | null): value is BreedingParentRoleOverride => (
  value !== null
  && typeof value === 'object'
  && EVIDENCE.test(value.evidenceId)
  && Array.isArray(value.roles)
  && value.roles.length === 2
  && value.roles.includes('female-parent')
  && value.roles.includes('male-parent')
)
const assignment = (
  parent: BreedingCompatibilityParentFacts,
  roleId: BreedingParentRoleId,
  assignmentKind: BreedingParentRoleAssignment['assignmentKind'],
  evidenceId: string | null,
): BreedingParentRoleAssignment => Object.freeze({ parentRef: parent.parentRef, roleId, assignmentKind, evidenceId })

export const evaluateBreedingCompatibility = (
  input: EvaluateBreedingCompatibilityInput,
): BreedingCompatibilityResult => {
  const reasons: BreedingCompatibilityReasonId[] = []
  const [first, second] = input.parents
  const parents = [first, second] as const
  if (first.parentRef === second.parentRef) reasons.push('breeding.compatibility.same-parent')

  const specs = parents.map(parent => compiledBreedingSpeciesSpec(parent.speciesId))
  const groupRows = parents.map(parent => sortedUniqueEggGroups(parent.eggGroupIds))
  for (const [index, parent] of parents.entries()) {
    const spec = specs[index]
    if (!REFERENCE.test(parent.parentRef)
      || !isCanonicalBreedingSpeciesId(parent.speciesId)
      || !GENDERS.has(parent.genderId)
      || !Number.isSafeInteger(parent.level)
      || parent.level < 1 || parent.level > 100
      || typeof parent.gmMaturityConfirmed !== 'boolean'
      || !groupRows[index]) {
      reasons.push('breeding.compatibility.invalid-parent-facts')
    }
    if (!spec) reasons.push('breeding.compatibility.spec-unavailable')
    else {
      if (spec.eligibilityId !== 'breedable') reasons.push('breeding.compatibility.not-breedable')
      const genderMatches = spec.genderPolicy.kind === 'genderless'
        ? parent.genderId === 'genderless'
        : parent.genderId === 'female' || parent.genderId === 'male'
      if (!genderMatches) reasons.push('breeding.compatibility.gender-mismatch')
    }
  }

  const maturitySatisfied = parents.map(parent => (
    input.options.values['breeding.maturity-policy'] === 'minimum-level'
      ? parent.level >= input.options.values['breeding.minimum-maturity-level']
      : parent.gmMaturityConfirmed
  )) as [boolean, boolean]
  if (input.options.values['breeding.maturity-policy'] === 'minimum-level') {
    if (maturitySatisfied.some(value => !value)) reasons.push('breeding.compatibility.maturity-level-low')
  }
  else if (maturitySatisfied.some(value => !value)) reasons.push('breeding.compatibility.maturity-unconfirmed')

  const sharedEggGroupIds = groupRows[0] && groupRows[1]
    ? Object.freeze(groupRows[0].filter(group => groupRows[1]!.includes(group)))
    : Object.freeze([] as BreedingEggGroupId[])
  const dittoIndexes = parents
    .map((parent, index) => parent.speciesId === 'ditto' ? index as 0 | 1 : null)
    .filter((index): index is 0 | 1 => index !== null)

  let parentRoles: CompatibleBreedingResult['parentRoles'] | null = null
  let compatibilityKind: CompatibleBreedingResult['compatibilityKind'] | null = null
  let familyContributorParentIndexes: readonly (0 | 1)[] = Object.freeze([])

  if (dittoIndexes.length === 2) {
    reasons.push('breeding.compatibility.ditto-pair')
    if (input.roleOverride) reasons.push('breeding.compatibility.role-override-not-allowed')
  }
  else if (dittoIndexes.length === 1) {
    const dittoIndex = dittoIndexes[0]!
    const otherIndex = (dittoIndex === 0 ? 1 : 0) as 0 | 1
    const other = parents[otherIndex]
    const otherRole = conventionalRole(other.genderId) ?? 'female-parent'
    const roles: [BreedingParentRoleId, BreedingParentRoleId] = ['female-parent', 'male-parent']
    roles[otherIndex] = otherRole
    roles[dittoIndex] = oppositeRole(otherRole)
    parentRoles = Object.freeze(parents.map((parent, index) => assignment(
      parent,
      roles[index]!,
      'canonical-ditto',
      null,
    )) as [BreedingParentRoleAssignment, BreedingParentRoleAssignment])
    compatibilityKind = 'canonical-ditto'
    familyContributorParentIndexes = Object.freeze([otherIndex])
    if (input.roleOverride) reasons.push('breeding.compatibility.role-override-not-allowed')
  }
  else {
    if (sharedEggGroupIds.length < 1) reasons.push('breeding.compatibility.no-shared-egg-group')
    const conventional = parents.map(parent => conventionalRole(parent.genderId))
    const conventionalPair = conventional[0] !== null && conventional[1] !== null && conventional[0] !== conventional[1]
    const hasGenderless = parents.some(parent => parent.genderId === 'genderless')
    const sameSex = !hasGenderless && parents[0].genderId === parents[1].genderId
    if (conventionalPair) {
      parentRoles = Object.freeze(parents.map((parent, index) => assignment(
        parent,
        conventional[index]!,
        'conventional-gender',
        null,
      )) as [BreedingParentRoleAssignment, BreedingParentRoleAssignment])
      compatibilityKind = 'conventional'
      familyContributorParentIndexes = Object.freeze([0, 1])
      if (input.roleOverride) reasons.push('breeding.compatibility.role-override-not-allowed')
    }
    else {
      const overrideEnabled = hasGenderless
        ? input.options.values['breeding.genderless-policy'] === 'gm-role-override'
        : sameSex && input.options.values['breeding.same-sex-policy'] === 'gm-role-override'
      if (!overrideEnabled) {
        reasons.push(hasGenderless
          ? 'breeding.compatibility.genderless-unavailable'
          : 'breeding.compatibility.same-sex-unavailable')
        if (input.roleOverride) reasons.push('breeding.compatibility.role-override-not-allowed')
      }
      else if (!input.roleOverride) reasons.push('breeding.compatibility.role-override-required')
      else if (!validOverride(input.roleOverride)) reasons.push('breeding.compatibility.role-override-invalid')
      else {
        const override = input.roleOverride
        parentRoles = Object.freeze(parents.map((parent, index) => assignment(
          parent,
          override.roles[index]!,
          'gm-override',
          override.evidenceId,
        )) as [BreedingParentRoleAssignment, BreedingParentRoleAssignment])
        compatibilityKind = 'gm-role-override'
        familyContributorParentIndexes = Object.freeze([0, 1])
      }
    }
  }

  const orderedReasons = sortReasons(reasons)
  if (orderedReasons.length > 0 || !parentRoles || !compatibilityKind) {
    return Object.freeze({
      status: 'unavailable',
      reasonIds: orderedReasons,
      compatibilityKind: null,
      parentRoles: null,
      sharedEggGroupIds,
      familyContributorParentIndexes: Object.freeze([] as const),
      maturitySatisfied: Object.freeze(maturitySatisfied) as [boolean, boolean],
      optionSnapshotDefinitionSha256: input.options.definitionSha256,
    })
  }
  return Object.freeze({
    status: 'compatible',
    reasonIds: Object.freeze([] as const),
    compatibilityKind,
    parentRoles,
    sharedEggGroupIds,
    familyContributorParentIndexes,
    maturitySatisfied: Object.freeze([true, true] as const),
    optionSnapshotDefinitionSha256: input.options.definitionSha256,
  })
}
