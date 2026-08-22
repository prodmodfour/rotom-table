import type { AuthRole } from '#shared/auth'
import {
  linkedCharacterRefKey,
  type LinkedCharacterRef,
  type PlayerProfile,
} from '#shared/playerProfiles'
import { onboardingCreationCatalog } from '#shared/onboarding/catalog'
import {
  createSqliteOnboardingRepository,
  onboardingPayloadHash,
  type OnboardingRepository,
} from '../storage/onboardingRepository'
import { createSqliteSheetRepository, type SheetRepository } from '../storage/sheetRepository'
import { listPlayerProfiles, updatePlayerProfile } from '../utils/playerProfileStorage'
import { publishCampaignAttentionInvalidation } from '../realtime/campaignAttentionRealtime'
import { OnboardingUseCaseError } from './onboardingWorkflows'

/**
 * Existing-character intake (P9-061..P9-070).
 *
 * Adopts an existing Trainer and their linked Pokémon into the campaign's
 * onboarding provenance: validates references, classifies deviations, offers
 * bounded structural repairs, links the player profile, and records a
 * completion — without rewriting story history, resources, injuries,
 * inventory, or build choices.
 */

export const ONBOARDING_INTAKE_FINDING_KINDS = Object.freeze([
  'blocking-structural',
  'repairable-legacy',
  'ownership-conflict',
  'campaign-policy-deviation',
  'informational',
] as const)
export type OnboardingIntakeFindingKind = typeof ONBOARDING_INTAKE_FINDING_KINDS[number]

export interface OnboardingIntakeFinding {
  readonly findingId: string
  readonly kind: OnboardingIntakeFindingKind
  readonly message: string
  readonly target: { readonly sheetKind: 'trainer' | 'pokemon', readonly sheetSlug: string } | null
  /** Repair that resolves this finding, when one exists. */
  readonly repairId: string | null
}

export interface OnboardingIntakeRepair {
  readonly repairId: string
  readonly kind: 'remove-dangling-team-ref' | 'dedupe-team-refs' | 'move-overflow-to-box'
  readonly description: string
  readonly slug: string
}

export interface OnboardingIntakePokemonSummary {
  readonly slug: string
  readonly nickname: string
  readonly species: string
  readonly level: number
  readonly rosterKind: 'team' | 'box'
  readonly speciesKnown: boolean
  readonly linkedToOtherProfile: string | null
}

export interface OnboardingIntakePreview {
  readonly trainerSlug: string
  readonly trainerName: string
  readonly trainerLevel: number
  readonly pokemon: readonly OnboardingIntakePokemonSummary[]
  readonly findings: readonly OnboardingIntakeFinding[]
  readonly proposedRepairs: readonly OnboardingIntakeRepair[]
  readonly ownershipConflicts: readonly { readonly sheetKind: 'trainer' | 'pokemon', readonly sheetSlug: string, readonly profileId: string, readonly profileDisplayName: string }[]
  readonly canCommit: boolean
}

export interface OnboardingIntakeDependencies {
  readonly repository?: OnboardingRepository
  readonly sheetRepository?: SheetRepository<Record<string, unknown>>
  readonly listProfiles?: () => readonly PlayerProfile[]
  readonly updateProfile?: (profileId: string, input: { linkedCharacters: readonly LinkedCharacterRef[] }) => void
  readonly now?: () => number
  readonly publishAttention?: typeof publishCampaignAttentionInvalidation
}

const repositoryOf = (dependencies: OnboardingIntakeDependencies): OnboardingRepository =>
  dependencies.repository ?? createSqliteOnboardingRepository()

const sheetRepositoryOf = (
  dependencies: OnboardingIntakeDependencies,
  repository: OnboardingRepository,
): SheetRepository<Record<string, unknown>> =>
  dependencies.sheetRepository ?? createSqliteSheetRepository<Record<string, unknown>>(repository.database)

const normalizeSlugList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value.flatMap(entry => (typeof entry === 'string' && entry.trim() !== '' ? [entry.trim()] : []))
}

interface IntakeDiscovery {
  readonly trainerDocument: Record<string, unknown>
  readonly trainerRevision: number
  readonly team: readonly string[]
  readonly boxed: readonly string[]
  readonly presentPokemon: ReadonlyMap<string, Record<string, unknown>>
}

const discover = (
  trainerSlug: string,
  sheetRepository: SheetRepository<Record<string, unknown>>,
): IntakeDiscovery => {
  const trainer = sheetRepository.getByRef('trainer', trainerSlug)
  if (!trainer) throw new OnboardingUseCaseError(404, `Trainer sheet ${trainerSlug} not found`)
  const document = trainer.sheet as Record<string, unknown>
  const team = normalizeSlugList(document.currentTeam)
  const boxed = normalizeSlugList(document.boxedPokemon)
  const presentPokemon = new Map<string, Record<string, unknown>>()
  for (const slug of [...team, ...boxed]) {
    const pokemon = sheetRepository.getByRef('pokemon', slug)
    if (pokemon) presentPokemon.set(slug, pokemon.sheet as Record<string, unknown>)
  }
  return {
    trainerDocument: document,
    trainerRevision: trainer.revision ?? 0,
    team,
    boxed,
    presentPokemon,
  }
}

export const previewOnboardingIntakeUseCase = (
  input: { readonly role: AuthRole, readonly trainerSlug: unknown, readonly profileId: unknown },
  dependencies: OnboardingIntakeDependencies = {},
): OnboardingIntakePreview => {
  if (input.role !== 'gm') throw new OnboardingUseCaseError(403, 'GM role required')
  const repository = repositoryOf(dependencies)
  const sheetRepository = sheetRepositoryOf(dependencies, repository)
  const trainerSlug = String(input.trainerSlug ?? '').trim()
  if (!trainerSlug) throw new OnboardingUseCaseError(400, 'trainerSlug is required')
  const profileId = String(input.profileId ?? '').trim()

  const discovery = discover(trainerSlug, sheetRepository)
  const catalog = onboardingCreationCatalog()
  const profiles = (dependencies.listProfiles ?? listPlayerProfiles)()

  const findings: OnboardingIntakeFinding[] = []
  const repairs: OnboardingIntakeRepair[] = []
  const ownershipConflicts: { sheetKind: 'trainer' | 'pokemon', sheetSlug: string, profileId: string, profileDisplayName: string }[] = []
  let findingSequence = 0
  const finding = (
    kind: OnboardingIntakeFindingKind,
    message: string,
    target: OnboardingIntakeFinding['target'],
    repairId: string | null = null,
  ): void => {
    findingSequence += 1
    findings.push({ findingId: `intake-finding-${findingSequence}`, kind, message, target, repairId })
  }

  /* Dangling and duplicate references (P9-062, P9-067). */
  const seen = new Set<string>()
  for (const [rosterKind, slugs] of [['team', discovery.team], ['box', discovery.boxed]] as const) {
    for (const slug of slugs) {
      if (seen.has(slug)) {
        const repairId = `repair-dedupe-${slug}`
        if (!repairs.some(repair => repair.repairId === repairId)) {
          repairs.push({ repairId, kind: 'dedupe-team-refs', description: `Keep one reference to ${slug}`, slug })
        }
        finding('repairable-legacy', `${slug} is referenced more than once across team and box.`, { sheetKind: 'pokemon', sheetSlug: slug }, repairId)
        continue
      }
      seen.add(slug)
      if (!discovery.presentPokemon.has(slug)) {
        const repairId = `repair-dangling-${slug}`
        repairs.push({ repairId, kind: 'remove-dangling-team-ref', description: `Remove missing Pokémon reference ${slug} from the ${rosterKind}`, slug })
        finding('blocking-structural', `The ${rosterKind} references ${slug}, but no such Pokémon sheet exists.`, { sheetKind: 'pokemon', sheetSlug: slug }, repairId)
      }
    }
  }

  /* Team overflow. */
  const distinctTeam = [...new Set(discovery.team)].filter(slug => discovery.presentPokemon.has(slug))
  if (distinctTeam.length > 6) {
    for (const slug of distinctTeam.slice(6)) {
      const repairId = `repair-overflow-${slug}`
      repairs.push({ repairId, kind: 'move-overflow-to-box', description: `Move ${slug} to the box (team limit is 6)`, slug })
      finding('repairable-legacy', `The team holds more than six Pokémon; ${slug} overflows the limit.`, { sheetKind: 'pokemon', sheetSlug: slug }, repairId)
    }
  }

  /* Ownership conflicts (P9-066/P9-067). */
  const refsToLink: LinkedCharacterRef[] = [
    { sheetKind: 'trainer', sheetSlug: trainerSlug },
    ...[...discovery.presentPokemon.keys()].map(slug => ({ sheetKind: 'pokemon' as const, sheetSlug: slug })),
  ]
  for (const profile of profiles) {
    if (profile.id === profileId) continue
    for (const ref of profile.linkedCharacters) {
      if (refsToLink.some(candidate => linkedCharacterRefKey(candidate) === linkedCharacterRefKey(ref))) {
        ownershipConflicts.push({
          sheetKind: ref.sheetKind,
          sheetSlug: ref.sheetSlug,
          profileId: profile.id,
          profileDisplayName: profile.displayName,
        })
        finding('ownership-conflict', `${ref.sheetKind} ${ref.sheetSlug} is already linked to ${profile.displayName}.`, { sheetKind: ref.sheetKind, sheetSlug: ref.sheetSlug })
      }
    }
  }

  /* Canonical and policy classification (P9-063/P9-064): advancement is never a defect. */
  const pokemonSummaries: OnboardingIntakePokemonSummary[] = []
  for (const [slug, sheet] of discovery.presentPokemon) {
    const species = String(sheet.species ?? '')
    const speciesRecord = species ? catalog.species.get(species) ?? null : null
    if (!species) {
      finding('informational', `${slug} has no species selected; it remains playable but cannot be validated against the Pokédex.`, { sheetKind: 'pokemon', sheetSlug: slug })
    } else if (!speciesRecord) {
      finding('blocking-structural', `${slug} references species "${species}", which is not a canonical Pokédex entry.`, { sheetKind: 'pokemon', sheetSlug: slug })
    } else if (!speciesRecord.eligible) {
      finding('informational', `${species} has incomplete canonical data (${speciesRecord.ineligibleReasons.join(', ')}); existing history is preserved as-is.`, { sheetKind: 'pokemon', sheetSlug: slug })
    }
    const conflicted = ownershipConflicts.find(conflict => conflict.sheetSlug === slug)
    pokemonSummaries.push({
      slug,
      nickname: String(sheet.nickname ?? slug),
      species,
      level: Number(sheet.level ?? 1),
      rosterKind: discovery.team.includes(slug) ? 'team' : 'box',
      speciesKnown: speciesRecord !== null,
      linkedToOtherProfile: conflicted ? conflicted.profileDisplayName : null,
    })
  }

  const activePolicy = repository.getActivePolicy()
  if (activePolicy) {
    const trainerLevel = Number(discovery.trainerDocument.level ?? 1)
    if (trainerLevel !== activePolicy.content.trainer.startingLevel) {
      finding('campaign-policy-deviation', `Trainer level ${trainerLevel} differs from the policy starting level ${activePolicy.content.trainer.startingLevel}; legitimate advancement is preserved, not repaired.`, { sheetKind: 'trainer', sheetSlug: trainerSlug })
    }
  }

  const unrepairableBlockers = findings.filter(entry => entry.kind === 'blocking-structural' && entry.repairId === null)

  return {
    trainerSlug,
    trainerName: String(discovery.trainerDocument.name ?? trainerSlug),
    trainerLevel: Number(discovery.trainerDocument.level ?? 1),
    pokemon: pokemonSummaries,
    findings,
    proposedRepairs: repairs,
    ownershipConflicts,
    canCommit: unrepairableBlockers.length === 0,
  }
}

/* ------------------------------------------------------------------ */
/* Commit                                                             */
/* ------------------------------------------------------------------ */

export interface CommitOnboardingIntakeInput {
  readonly role: AuthRole
  readonly trainerSlug: unknown
  readonly profileId: unknown
  readonly acceptedRepairIds: readonly string[]
  readonly resolveOwnershipConflicts: boolean
  readonly operationId: string
}

export interface CommitOnboardingIntakeResult {
  readonly ok: true
  readonly completionRecordId: string
  readonly slotId: string
  readonly trainerSlug: string
  readonly pokemonSlugs: readonly string[]
  readonly repairsApplied: readonly string[]
  readonly relinkedFromProfiles: readonly string[]
}

export const commitOnboardingIntakeUseCase = (
  input: CommitOnboardingIntakeInput,
  dependencies: OnboardingIntakeDependencies = {},
): CommitOnboardingIntakeResult => {
  if (input.role !== 'gm') throw new OnboardingUseCaseError(403, 'GM role required')
  const repository = repositoryOf(dependencies)
  const sheetRepository = sheetRepositoryOf(dependencies, repository)
  const trainerSlug = String(input.trainerSlug ?? '').trim()
  const profileId = String(input.profileId ?? '').trim()

  const payloadHash = onboardingPayloadHash({
    trainerSlug,
    profileId,
    acceptedRepairIds: [...input.acceptedRepairIds].sort(),
  })
  const existing = repository.findOperation(input.operationId)
  if (existing) {
    if (existing.payloadHash === payloadHash) return existing.result as unknown as CommitOnboardingIntakeResult
    throw new OnboardingUseCaseError(409, `Operation ${input.operationId} was already recorded with different material`)
  }

  const preview = previewOnboardingIntakeUseCase({ role: input.role, trainerSlug, profileId }, dependencies)

  const acceptedRepairs = preview.proposedRepairs.filter(repair => input.acceptedRepairIds.includes(repair.repairId))
  const requiredRepairIds = preview.findings
    .filter(entry => entry.kind === 'blocking-structural' && entry.repairId !== null)
    .map(entry => entry.repairId!)
  for (const required of requiredRepairIds) {
    if (!acceptedRepairs.some(repair => repair.repairId === required)) {
      throw new OnboardingUseCaseError(409, `Structural repair ${required} must be accepted before intake can commit`)
    }
  }
  if (!preview.canCommit) {
    throw new OnboardingUseCaseError(409, 'Intake is blocked by structural findings without a safe repair')
  }
  if (preview.ownershipConflicts.length > 0 && !input.resolveOwnershipConflicts) {
    throw new OnboardingUseCaseError(409, `${preview.ownershipConflicts.length} sheet(s) are linked to another profile; explicit GM resolution is required`)
  }

  const profiles = (dependencies.listProfiles ?? listPlayerProfiles)()
  const targetProfile = profiles.find(profile => profile.id === profileId)
  if (!targetProfile) throw new OnboardingUseCaseError(404, `Player profile ${profileId} not found`)

  const now = dependencies.now?.() ?? Date.now()

  const transactionResult = repository.database.withTransaction(() => {
    const discovery = discover(trainerSlug, sheetRepository)

    /* Apply accepted structural repairs to the roster arrays only. */
    let team = [...discovery.team]
    let boxed = [...discovery.boxed]
    for (const repair of acceptedRepairs) {
      if (repair.kind === 'remove-dangling-team-ref') {
        team = team.filter(slug => slug !== repair.slug)
        boxed = boxed.filter(slug => slug !== repair.slug)
      } else if (repair.kind === 'dedupe-team-refs') {
        const inTeam = team.includes(repair.slug)
        team = inTeam ? [...new Set(team)] : team
        boxed = boxed.filter((slug, index) => slug !== repair.slug || (!inTeam && boxed.indexOf(repair.slug) === index))
      } else if (repair.kind === 'move-overflow-to-box') {
        team = team.filter(slug => slug !== repair.slug)
        if (!boxed.includes(repair.slug)) boxed = [...boxed, repair.slug]
      }
    }
    const rosterChanged = JSON.stringify(team) !== JSON.stringify(discovery.team)
      || JSON.stringify(boxed) !== JSON.stringify(discovery.boxed)
    if (rosterChanged) {
      sheetRepository.saveSetupSheet('trainer', trainerSlug, {
        ...discovery.trainerDocument,
        currentTeam: team,
        boxedPokemon: boxed,
        revision: discovery.trainerRevision,
        updatedAt: now,
      })
    }

    const pokemonSlugs = [...new Set([...team, ...boxed])].filter(slug => discovery.presentPokemon.has(slug))
    const slot = repository.createIntakeSlot({ profileId, now })
    const completion = repository.recordCompletion({
      completionId: `onbintake-${trainerSlug}-${now}`,
      slotId: slot.slotId,
      draftId: 'onbdraft_intake000',
      submissionRevision: 1,
      refs: {
        kind: 'intake',
        trainerSlug,
        pokemonSlugs,
        repairsApplied: acceptedRepairs.map(repair => repair.repairId),
        findings: preview.findings.map(entry => ({ kind: entry.kind, message: entry.message })),
        ownershipConflictsResolved: preview.ownershipConflicts.map(conflict => `${conflict.sheetKind}:${conflict.sheetSlug}`),
        profileLinksApplied: false,
      },
      now,
    })

    const result: CommitOnboardingIntakeResult = {
      ok: true,
      completionRecordId: completion.completionId,
      slotId: slot.slotId as string,
      trainerSlug,
      pokemonSlugs,
      repairsApplied: acceptedRepairs.map(repair => repair.repairId),
      relinkedFromProfiles: [...new Set(preview.ownershipConflicts.map(conflict => conflict.profileId))],
    }
    repository.recordOperation({
      opId: input.operationId,
      scope: 'commit',
      payloadHash,
      result: result as unknown as Record<string, unknown>,
      now,
    })
    return result
  })

  /* Profile links after the SQLite transaction, mirrored from approval. */
  const refsToLink: LinkedCharacterRef[] = [
    { sheetKind: 'trainer', sheetSlug: trainerSlug },
    ...transactionResult.pokemonSlugs.map(slug => ({ sheetKind: 'pokemon' as const, sheetSlug: slug })),
  ]
  const applyProfile = dependencies.updateProfile
    ?? ((id: string, update: { linkedCharacters: readonly LinkedCharacterRef[] }) => {
      updatePlayerProfile(id, { linkedCharacters: update.linkedCharacters })
    })

  if (input.resolveOwnershipConflicts) {
    for (const conflictProfileId of transactionResult.relinkedFromProfiles) {
      const conflictProfile = profiles.find(profile => profile.id === conflictProfileId)
      if (!conflictProfile) continue
      const remaining = conflictProfile.linkedCharacters.filter(ref =>
        !refsToLink.some(candidate => linkedCharacterRefKey(candidate) === linkedCharacterRefKey(ref)))
      applyProfile(conflictProfileId, { linkedCharacters: remaining })
    }
  }
  const merged = new Map(targetProfile.linkedCharacters.map(ref => [linkedCharacterRefKey(ref), ref]))
  for (const ref of refsToLink) merged.set(linkedCharacterRefKey(ref), ref)
  applyProfile(profileId, { linkedCharacters: [...merged.values()] })

  repository.database.connection.prepare(
    "UPDATE onboarding_completions SET refs_json = json_set(refs_json, '$.profileLinksApplied', json('true')) WHERE completion_id = ?",
  ).run(transactionResult.completionRecordId)

  ;(dependencies.publishAttention ?? publishCampaignAttentionInvalidation)({
    cause: 'profile-authority',
    profileIds: [profileId],
  })

  return transactionResult
}
