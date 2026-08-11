import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import rulesetJson from '../../data/breeding-automation/ruleset.json'
import {
  BreedingParentDiscoveryValidationError,
  parseBreedingParentDiscoveryFilterV1,
  parseBreedingParentDiscoveryProjectionV1,
  parseBreedingParentSelectionV1,
} from '../../shared/breeding/parentDiscovery'
import { parseBreedingOperationCommandV1 } from '../../shared/breeding/operations'
import type { PlayerProfile } from '../../shared/playerProfiles'
import {
  BREEDING_PERFORMANCE_BUDGET_POLICY_V1,
  breedingPerformanceJsonUtf8Bytes,
} from '../../shared/breeding/performanceBudgets'
import { createBreedingActorAuthorityV1 } from '../../server/domain/breeding/authorization'
import { DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT } from '../../server/domain/breeding/campaignOptions'
import {
  BreedingParentDiscoveryAuthorityError,
  discoverBreedingParentsV1,
  type BreedingParentDiscoverySheetReader,
  type BreedingParentDiscoveryStoredSheet,
} from '../../server/useCases/discoverBreedingParents'

const ruleset = rulesetJson as Record<string, string>
const operationId = (value: number): string => `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
const profile: PlayerProfile = {
  schemaVersion: 1,
  id: 'profile_parent01',
  displayName: 'Parent Owner',
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'trainer-owner' }],
}
const command = (input: {
  readonly role?: 'gm' | 'player'
  readonly selectedTrainerSlug?: string | null
  readonly value?: number
} = {}) => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: operationId(input.value ?? 1),
  commandKind: 'preview-breeding',
  actor: {
    profileId: input.role === 'gm' ? 'campaign-gm' : profile.id,
    selectedTrainerSlug: input.selectedTrainerSlug === undefined
      ? input.role === 'gm' ? null : 'trainer-owner'
      : input.selectedTrainerSlug,
  },
  ruleset: {
    rulesetId: ruleset.rulesetId,
    definitionSha256: ruleset.definitionSha256,
  },
  scopes: [],
  payload: {
    ownerTrainerSlug: 'trainer-owner',
    breederTrainerSlug: 'trainer-owner',
    parentRefs: [
      { pokemonSheetSlug: 'pokemon-parent-a', expectedSheetRevision: 2 },
      { pokemonSheetSlug: 'pokemon-parent-b', expectedSheetRevision: 3 },
    ],
    optionSnapshotDefinitionSha256: DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT.definitionSha256,
  },
})
const actor = (input: {
  readonly role?: 'gm' | 'player'
  readonly selectedTrainerSlug?: string | null
  readonly minute?: number
  readonly value?: number
} = {}) => {
  const role = input.role ?? 'player'
  const operation = command({
    role,
    selectedTrainerSlug: input.selectedTrainerSlug,
    value: input.value,
  })
  return createBreedingActorAuthorityV1({
    role,
    command: operation,
    authenticatedPrincipalSha256: 'a'.repeat(64),
    authenticationPolicyDefinitionSha256: 'b'.repeat(64),
    profile: role === 'player' ? profile : null,
    evaluatedAtCampaignMinute: input.minute ?? 120,
  })
}
const row = (
  kind: 'pokemon' | 'trainer',
  slug: string,
  revision: number,
  document: Record<string, unknown>,
): BreedingParentDiscoveryStoredSheet => ({ kind, slug, revision, updatedAt: 1, document })
const baseRows = (): BreedingParentDiscoveryStoredSheet[] => [
  row('trainer', 'trainer-owner', 5, {
    slug: 'trainer-owner',
    currentTeam: ['pokemon-parent-a', 'pokemon-parent-c'],
    boxedPokemon: ['pokemon-parent-b', 'pokemon-bad-gender', 'pokemon-missing'],
    player: true,
  }),
  row('trainer', 'trainer-hidden', 7, {
    slug: 'trainer-hidden',
    currentTeam: ['pokemon-hidden'],
    boxedPokemon: [],
  }),
  row('pokemon', 'pokemon-parent-a', 2, {
    slug: 'pokemon-parent-a',
    nickname: 'Leaf',
    species: 'Bulbasaur',
    gender: 'Female',
    level: 25,
    player: false,
    gm: { note: 'private-a' },
  }),
  row('pokemon', 'pokemon-parent-b', 3, {
    slug: 'pokemon-parent-b',
    nickname: 'Bloom',
    species: 'Ivysaur',
    gender: 'Male',
    level: 30,
    serverPrivate: { secret: 'private-b' },
  }),
  row('pokemon', 'pokemon-parent-c', 4, {
    slug: 'pokemon-parent-c',
    nickname: 'Spark',
    species: 'Pikachu',
    gender: 'Male',
    level: 28,
  }),
  row('pokemon', 'pokemon-bad-gender', 1, {
    slug: 'pokemon-bad-gender',
    nickname: '<script>Hidden</script>',
    species: 'Bulbasaur',
    gender: 'No Gender',
    level: 24,
  }),
  row('pokemon', 'pokemon-hidden', 8, {
    slug: 'pokemon-hidden',
    nickname: 'Private Parent',
    species: 'Venusaur',
    gender: 'Female',
    level: 40,
    player: true,
    mapSlug: 'secret-arena',
  }),
]
const reader = (rows = baseRows()): BreedingParentDiscoverySheetReader => ({
  get(kind, slug) {
    return rows.find(value => value.kind === kind && value.slug === slug) ?? null
  },
  list(kind) {
    return kind ? rows.filter(value => value.kind === kind) : rows
  },
})
const filter = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  trainerSheetSlug: 'trainer-owner',
  rosterFields: ['boxed-pokemon', 'current-team'],
  availability: 'all',
  speciesIds: [],
  ...overrides,
})
const selection = (...parentRefs: Array<[string, number]>) => ({
  schemaVersion: 1,
  parentRefs: parentRefs.map(([pokemonSheetSlug, expectedSheetRevision]) => ({
    pokemonSheetSlug,
    expectedSheetRevision,
  })),
})
const ownerInput = (overrides: Record<string, unknown> = {}) => ({
  sheets: reader(),
  actorAuthority: actor(),
  profile,
  campaignOptions: DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT,
  atCampaignMinute: 120,
  filter: filter(),
  selection: selection(),
  ...overrides,
})

describe('authorized Breeding parent discovery and safe previews', () => {
  it('discovers only the selected Profile-controlled Trainer roster and projects no private authority', () => {
    const projection = discoverBreedingParentsV1(ownerInput({
      selection: selection(['pokemon-parent-a', 2], ['pokemon-parent-b', 3]),
    }))
    expect(projection).toMatchObject({
      schemaVersion: 1,
      audience: 'owner',
      generatedAtCampaignMinute: 120,
      trainerSheets: [{
        trainerSheetSlug: 'trainer-owner',
        trainerSheetRevision: 5,
      }],
      selectedParentRefs: [
        { pokemonSheetSlug: 'pokemon-parent-a', expectedSheetRevision: 2 },
        { pokemonSheetSlug: 'pokemon-parent-b', expectedSheetRevision: 3 },
      ],
      compatibilityPreview: {
        status: 'requires-validation',
        reasonIds: [],
      },
    })
    expect(projection.compatibilityPreview?.previewId)
      .toMatch(/^breeding-parent-preview:v1:[0-9a-f]{32}$/u)
    expect(projection.compatibilityPreview?.requiredValidationIds).toEqual([
      'breeding.parent-validation.compatibility',
      'breeding.parent-validation.consent',
      'breeding.parent-validation.current-revisions',
      'breeding.parent-validation.location-facility',
      'breeding.parent-validation.maturity',
      'breeding.parent-validation.ownership-control',
    ])
    expect(projection.trainerSheets[0]?.candidates.map(value => value.parentSheetSlug)).toEqual([
      'pokemon-bad-gender',
      'pokemon-missing',
      'pokemon-parent-b',
      'pokemon-parent-a',
      'pokemon-parent-c',
    ])
    const serialized = JSON.stringify(projection)
    for (const marker of [
      profile.id,
      'trainer-hidden',
      'pokemon-hidden',
      'private-a',
      'private-b',
      'secret-arena',
      'definitionSha256',
      'serverPrivate',
      'mapSlug',
    ]) expect(serialized).not.toContain(marker)
    expect(parseBreedingParentDiscoveryProjectionV1(structuredClone(projection))).toEqual(projection)
  })

  it('applies strict roster, availability, and canonical Species filters after authorization', () => {
    const selectable = discoverBreedingParentsV1(ownerInput({
      filter: filter({
        rosterFields: ['current-team'],
        availability: 'selectable',
        speciesIds: ['bulbasaur'],
      }),
    }))
    expect(selectable.trainerSheets[0]?.candidates.map(value => value.parentSheetSlug))
      .toEqual(['pokemon-parent-a'])

    const unavailable = discoverBreedingParentsV1(ownerInput({
      filter: filter({ availability: 'unavailable' }),
    }))
    expect(unavailable.trainerSheets[0]?.candidates).toEqual([
      expect.objectContaining({
        parentSheetSlug: 'pokemon-bad-gender',
        label: 'script Hidden /script',
        availability: {
          status: 'unavailable',
          reasonIds: ['breeding.parent-discovery.gender-mismatch'],
        },
      }),
      expect.objectContaining({
        parentSheetSlug: 'pokemon-missing',
        parentSheetRevision: null,
        availability: {
          status: 'unavailable',
          reasonIds: ['breeding.parent-discovery.sheet-unavailable'],
        },
      }),
    ])
  })

  it('returns bounded structural incompatibility reasons without claiming final authorization', () => {
    const projection = discoverBreedingParentsV1(ownerInput({
      selection: selection(['pokemon-parent-a', 2], ['pokemon-parent-c', 4]),
    }))
    expect(projection.compatibilityPreview).toEqual({
      previewId: expect.stringMatching(/^breeding-parent-preview:v1:[0-9a-f]{32}$/u),
      status: 'unavailable',
      reasonIds: ['breeding.compatibility.no-shared-egg-group'],
      requiredValidationIds: [
        'breeding.parent-validation.compatibility',
        'breeding.parent-validation.consent',
        'breeding.parent-validation.current-revisions',
        'breeding.parent-validation.location-facility',
        'breeding.parent-validation.maturity',
        'breeding.parent-validation.ownership-control',
      ],
    })
  })

  it('rejects hidden, stale, duplicate, and filtered-out selections with one non-enumerating error', () => {
    for (const attemptedSelection of [
      selection(['pokemon-hidden', 8]),
      selection(['pokemon-parent-a', 99]),
      selection(['pokemon-parent-a', 2], ['pokemon-parent-a', 2]),
    ]) {
      let thrown: unknown
      try {
        discoverBreedingParentsV1(ownerInput({ selection: attemptedSelection }))
      }
      catch (error) { thrown = error }
      expect(thrown).toBeInstanceOf(Error)
      if (attemptedSelection.parentRefs.length === 2) {
        expect(thrown).toBeInstanceOf(BreedingParentDiscoveryValidationError)
      }
      else {
        expect(thrown).toEqual(expect.objectContaining({ code: 'breeding.parent-discovery.stale-selection' }))
        expect(String((thrown as Error).message)).not.toMatch(/hidden|parent-a|revision 99/iu)
      }
    }
    expect(() => discoverBreedingParentsV1(ownerInput({
      filter: filter({ availability: 'unavailable' }),
      selection: selection(['pokemon-parent-a', 2]),
    }))).toThrowError(expect.objectContaining({ code: 'breeding.parent-discovery.stale-selection' }))
  })

  it('allows authenticated GM campaign discovery without inferring Profile control, consent, or overrides', () => {
    const projection = discoverBreedingParentsV1({
      sheets: reader(),
      actorAuthority: actor({ role: 'gm', value: 2 }),
      profile: null,
      campaignOptions: DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT,
      atCampaignMinute: 120,
      filter: filter({ trainerSheetSlug: null }),
      selection: selection(),
    })
    expect(projection.audience).toBe('gm')
    expect(projection.trainerSheets.map(value => value.trainerSheetSlug)).toEqual([
      'trainer-hidden',
      'trainer-owner',
    ])
    expect(projection.trainerSheets[0]?.candidates[0]).toMatchObject({
      parentSheetSlug: 'pokemon-hidden',
      ownerTrainerSlug: 'trainer-hidden',
      availability: { status: 'selectable', reasonIds: [] },
    })
    expect(JSON.stringify(projection)).not.toMatch(/profile_parent01|consent|override|secret-arena/iu)
  })

  it('projects the maximum 64-Trainer and 2,048-candidate preview inside its release budgets', () => {
    const budget = BREEDING_PERFORMANCE_BUDGET_POLICY_V1.preview
    const trainers: BreedingParentDiscoveryStoredSheet[] = []
    const pokemon: BreedingParentDiscoveryStoredSheet[] = []
    for (let trainerIndex = 0; trainerIndex < budget.maximumProjectedTrainers; trainerIndex += 1) {
      const trainerSlug = `trainer-performance-${String(trainerIndex).padStart(2, '0')}`
      const boxedPokemon: string[] = []
      const candidatesPerTrainer = budget.maximumProjectedCandidates / budget.maximumProjectedTrainers
      for (let pokemonIndex = 0; pokemonIndex < candidatesPerTrainer; pokemonIndex += 1) {
        const pokemonSlug = `${trainerSlug}-pokemon-${String(pokemonIndex).padStart(2, '0')}`
        boxedPokemon.push(pokemonSlug)
        pokemon.push(row('pokemon', pokemonSlug, 1, {
          slug: pokemonSlug,
          nickname: `Candidate ${trainerIndex}-${pokemonIndex}`,
          species: 'Bulbasaur',
          gender: pokemonIndex % 2 === 0 ? 'Female' : 'Male',
          level: 25,
        }))
      }
      trainers.push(row('trainer', trainerSlug, 1, {
        slug: trainerSlug,
        currentTeam: [],
        boxedPokemon,
      }))
    }
    const storedRows = [...trainers, ...pokemon]
    const startedAt = performance.now()
    const projection = discoverBreedingParentsV1({
      sheets: reader(storedRows),
      actorAuthority: actor({ role: 'gm', value: 86 }),
      profile: null,
      campaignOptions: DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT,
      atCampaignMinute: 120,
      filter: filter({ trainerSheetSlug: null }),
      selection: selection(),
    })
    const elapsed = performance.now() - startedAt

    expect(projection.trainerSheets).toHaveLength(budget.maximumProjectedTrainers)
    expect(projection.trainerSheets.flatMap(value => value.candidates))
      .toHaveLength(budget.maximumProjectedCandidates)
    expect(breedingPerformanceJsonUtf8Bytes(projection))
      .toBeLessThanOrEqual(budget.maximumProjectionUtf8Bytes)
    expect(elapsed).toBeLessThanOrEqual(budget.maximumElapsedMilliseconds)

    const overflowPokemonSlug = 'trainer-performance-00-pokemon-overflow'
    const overflowTrainer = trainers[0]!
    const overflowDocument = overflowTrainer.document as Record<string, unknown>
    const candidateOverflowRows = [
      ...storedRows.filter(value => value !== overflowTrainer),
      row('trainer', overflowTrainer.slug, overflowTrainer.revision, {
        ...overflowDocument,
        boxedPokemon: [...(overflowDocument.boxedPokemon as string[]), overflowPokemonSlug],
      }),
      row('pokemon', overflowPokemonSlug, 1, {
        slug: overflowPokemonSlug,
        nickname: 'Overflow Candidate',
        species: 'Bulbasaur',
        gender: 'Female',
        level: 25,
      }),
    ]
    expect(() => discoverBreedingParentsV1({
      sheets: reader(candidateOverflowRows),
      actorAuthority: actor({ role: 'gm', value: 87 }),
      profile: null,
      campaignOptions: DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT,
      atCampaignMinute: 120,
      filter: filter({ trainerSheetSlug: null }),
      selection: selection(),
    })).toThrowError(expect.objectContaining({ code: 'breeding.parent-discovery.limit-exceeded' }))

    const trainerOverflowRows = [
      ...storedRows,
      row('trainer', 'trainer-performance-overflow', 1, {
        slug: 'trainer-performance-overflow',
        currentTeam: [],
        boxedPokemon: [],
      }),
    ]
    expect(() => discoverBreedingParentsV1({
      sheets: reader(trainerOverflowRows),
      actorAuthority: actor({ role: 'gm', value: 88 }),
      profile: null,
      campaignOptions: DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT,
      atCampaignMinute: 120,
      filter: filter({ trainerSheetSlug: null }),
      selection: selection(),
    })).toThrowError(expect.objectContaining({ code: 'breeding.parent-discovery.limit-exceeded' }))
  }, 15_000)

  it('fails closed for stale actors, Profile drift, IDOR Trainer filters, ambiguous links, and corrupt rosters', () => {
    expect(() => discoverBreedingParentsV1(ownerInput({ atCampaignMinute: 121 })))
      .toThrowError(expect.objectContaining({ code: 'breeding.parent-discovery.invalid-authority' }))
    expect(() => discoverBreedingParentsV1(ownerInput({
      profile: { ...profile, displayName: 'Changed' },
    }))).toThrowError(expect.objectContaining({ code: 'breeding.parent-discovery.unauthorized' }))
    expect(() => discoverBreedingParentsV1(ownerInput({
      filter: filter({ trainerSheetSlug: 'trainer-hidden' }),
    }))).toThrowError(expect.objectContaining({
      code: 'breeding.parent-discovery.unauthorized',
      message: 'Parent discovery is unavailable for this viewer.',
    }))

    const ambiguous = baseRows()
    const hiddenTrainer = ambiguous.find(value => value.slug === 'trainer-hidden')!
    ;(hiddenTrainer.document as Record<string, unknown>).boxedPokemon = ['pokemon-parent-a']
    expect(() => discoverBreedingParentsV1(ownerInput({ sheets: reader(ambiguous) })))
      .toThrowError(expect.objectContaining({ code: 'breeding.parent-discovery.ambiguous-link' }))

    const corrupt = baseRows()
    const ownerTrainer = corrupt.find(value => value.slug === 'trainer-owner')!
    ;(ownerTrainer.document as Record<string, unknown>).currentTeam = ['pokemon-parent-a', 42]
    expect(() => discoverBreedingParentsV1(ownerInput({ sheets: reader(corrupt) })))
      .toThrowError(expect.objectContaining({ code: 'breeding.parent-discovery.corrupt-storage' }))
  })

  it('rejects unknown, enriched, sparse, accessor-backed, and malformed shared boundary data', () => {
    expect(() => parseBreedingParentDiscoveryFilterV1({
      ...filter(),
      mapSlug: 'arena',
    })).toThrowError(expect.objectContaining({ code: 'breeding.parent-discovery.unknown-field' }))
    expect(() => parseBreedingParentSelectionV1({
      schemaVersion: 1,
      parentRefs: new Array(1),
    })).toThrow(BreedingParentDiscoveryValidationError)
    const accessor = filter() as Record<string, unknown>
    Object.defineProperty(accessor, 'trainerSheetSlug', {
      enumerable: true,
      get: () => 'trainer-owner',
    })
    expect(() => parseBreedingParentDiscoveryFilterV1(accessor))
      .toThrow(BreedingParentDiscoveryValidationError)
    expect(() => parseBreedingParentDiscoveryFilterV1(filter({
      rosterFields: ['current-team', 'boxed-pokemon'],
    }))).toThrowError(expect.objectContaining({ code: 'breeding.parent-discovery.invalid-invariant' }))
    expect(() => discoverBreedingParentsV1(ownerInput({
      profile: { ...profile, browserAuthority: true },
    }))).toThrow(BreedingParentDiscoveryAuthorityError)
  })
})
