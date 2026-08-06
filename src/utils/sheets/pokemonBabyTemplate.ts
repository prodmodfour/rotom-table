import type { CharacterSheet } from '~/types/characterSheet'
import { parseBreedingBabyTemplateAuthorityV1 } from '#shared/breeding/babyTemplate'
import { resolvePokemonBabyTemplateStage } from '~/utils/sheets/pokemonDerived'

/**
 * Preserve immutable breeding authority while materializing only the public
 * lifecycle flag from current Level. A setup-sheet request cannot create,
 * replace, remove, or reactivate this authority.
 */
export const reconcileServerOwnedBreedingBabyTemplate = (
  current: CharacterSheet,
  requested: CharacterSheet,
): CharacterSheet => {
  const privateState = current.serverPrivate
  const hasAuthority = privateState !== undefined
    && Object.hasOwn(privateState, 'breedingBabyTemplate')
  const rawAuthority = privateState?.breedingBabyTemplate
  if (!hasAuthority) {
    const next = { ...requested, babyTemplate: false }
    if (current.serverPrivate !== undefined) next.serverPrivate = current.serverPrivate
    else delete next.serverPrivate
    delete next.babyTemplateMechanics
    return next
  }
  const authority = parseBreedingBabyTemplateAuthorityV1(rawAuthority)
  if (!Number.isSafeInteger(current.level) || !Number.isSafeInteger(requested.level)
    || requested.level < current.level) {
    throw new Error('Authoritative Baby Template recovery cannot be reversed by a missing, malformed, or lower Level.')
  }
  const next: CharacterSheet = {
    ...requested,
    serverPrivate: current.serverPrivate,
    babyTemplateMechanics: {
      schemaVersion: 1,
      applicationKind: authority.applicationKind,
      effects: authority.effects,
    },
  }
  const stage = resolvePokemonBabyTemplateStage(next)
  next.babyTemplate = stage?.active === true
  return next
}
