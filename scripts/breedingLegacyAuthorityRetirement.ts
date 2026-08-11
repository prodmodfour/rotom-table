export const BREEDING_LEGACY_AUTHORITY_RETIREMENT_V1 = Object.freeze({
  schemaVersion: 1 as const,
  policyId: 'ptu-1.05-breeding-legacy-authority-retirement-v1' as const,
  ticket: 'BR-089' as const,
  mapEggAuthority: Object.freeze({
    status: 'retired' as const,
    forbiddenRuntimeKeys: Object.freeze(['capabilityEggs', 'hatchHours'] as const),
    scannedRuntimePaths: Object.freeze([
      'server/domain/capabilityAutomation/clientCapabilities.ts',
      'server/domain/capabilityAutomation/validateSelections.ts',
      'server/domain/capabilityAutomation/executeMechanic.ts',
      'server/useCases/executeCapabilityAction.ts',
    ] as const),
    quarantineOnlyPath: 'server/useCases/manageBreedingArchives.ts' as const,
    replacementOwner: 'server/useCases/applyPokemonEggWarmerCapability.ts' as const,
    replacementOperation: 'apply-egg-warmer-capability' as const,
    productContext: 'breeding-workshop' as const,
  }),
  sheetCompatibility: Object.freeze({
    status: 'read-only-projection' as const,
    fields: Object.freeze(['eggMoves', 'inheritedMoves', 'inheritedRemaining'] as const),
    saveAdapter: 'server/domain/breeding/legacyAdapters.ts' as const,
    setupSaveOwner: 'server/useCases/saveSheet.ts' as const,
    dedicatedWriters: Object.freeze([
      'server/domain/breeding/childSheetConstruction.ts',
      'server/useCases/recordPokemonInheritanceLearning.ts',
    ] as const),
    uiPaths: Object.freeze([
      'src/components/sheets/PokemonKnownMovesPanel.vue',
      'src/components/sheets/PokemonTrainingPanel.vue',
      'src/components/sheets/PokemonSheetEditor.vue',
      'src/composables/sheets/usePokemonSheetRowActions.ts',
    ] as const),
    lineageAuthority: 'typed-origin-and-permanent-move-provenance-only' as const,
  }),
  incompleteWizardSelection: Object.freeze({
    status: 'ephemeral-parent-preview-padding' as const,
    owner: 'server/useCases/loadBreedingProjectWizard.ts' as const,
    identifiers: Object.freeze([
      'wizard-parent-placeholder-a',
      'wizard-parent-placeholder-b',
      'wizard-parent-placeholder-c',
    ] as const),
    persistenceAuthority: 'none' as const,
    childCreationAuthority: 'none' as const,
  }),
  childCreation: Object.freeze({
    status: 'single-complete-atomic-writer' as const,
    hatchOwner: 'server/useCases/completePokemonEggHatch.ts' as const,
    completeDocumentBuilder: 'server/domain/breeding/childSheetConstruction.ts' as const,
    initializedRepository: 'server/storage/initializedPokemonSheetRepository.ts' as const,
    placeholderWrite: 'forbidden' as const,
    genericCreateOrFollowupSaveAuthority: 'none' as const,
  }),
  compatibilityExceptions: Object.freeze({
    documentaryWildGenerator: 'may-emit-nonauthoritative-compatibility-data' as const,
    reviewedLegacyMigration: 'may-bind-only-an-existing-origin-with-audit-evidence' as const,
    quarantinedMapMetadata: 'diagnostic-only-no-runtime-result' as const,
  }),
  verification: Object.freeze({
    acceptanceTest: 'tests/server/breedingLegacyAuthorityRetirement.test.ts' as const,
    saveAndConcurrencyTest: 'tests/server/saveSheet.test.ts' as const,
    adapterTest: 'tests/server/breedingLegacyAdapters.test.ts' as const,
    componentTest: 'tests/components/pokemonBreedingLegacyFields.test.ts' as const,
    command: 'npm run check:breeding-retirement' as const,
  }),
})

export const BREEDING_LEGACY_AUTHORITY_RETIREMENT_DEFINITION_SHA256 =
  'd20550f41f06f9c5f47377f386a08621c2cfacf2e3c8579c44c126dd513b94fb' as const
