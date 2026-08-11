export const BREEDING_PRODUCTION_ACCEPTANCE_PROFILE_V1 = Object.freeze({
  schemaVersion: 1 as const,
  profileId: 'ptu-1.05-breeding-production-acceptance-v1' as const,
  ticket: 'BR-087' as const,
  dataPolicy: 'synthetic-no-campaign-data' as const,
  topology: Object.freeze({
    server: 'production-nitro-127.0.0.1:3017' as const,
    storage: 'file-backed-sqlite-wal' as const,
    browserContexts: Object.freeze(['authenticated-gm', 'selected-profile-player'] as const),
    browserProjects: Object.freeze(['chromium', 'mobile-chromium'] as const),
    campaignRoot: 'fresh-playwright-campaign' as const,
    testIsolation: 'single-worker-server-and-browser-runs' as const,
  }),
  scenarios: Object.freeze([
    Object.freeze({
      scenarioId: 'gm-player-multi-client' as const,
      evidence: Object.freeze([
        Object.freeze({
          path: 'tests/server/breedingProductionLikeAcceptance.test.ts' as const,
          requiredNeedle: 'keeps simultaneous GM and selected-Profile clients private across restart' as const,
        }),
        Object.freeze({
          path: 'tests/e2e/breeding-workshop.spec.ts' as const,
          requiredNeedle: 'GM and player browser contexts receive structurally different private Workshop views' as const,
        }),
      ]),
      expectedOutcome: 'independent authenticated clients receive structurally distinct server projections without cross-owner identity or mechanics leakage' as const,
    }),
    Object.freeze({
      scenarioId: 'long-timeskip' as const,
      evidence: Object.freeze([
        Object.freeze({
          path: 'tests/server/breedingCampaignClockBatch.test.ts' as const,
          requiredNeedle: 'continues a bounded 100-Egg page across a long timeskip without losing or duplicating progress' as const,
        }),
      ]),
      expectedOutcome: 'one long campaign-time advance settles only the deterministic 100-Egg prefix and an equal-target continuation settles the remainder exactly once' as const,
    }),
    Object.freeze({
      scenarioId: 'restart-recovery' as const,
      evidence: Object.freeze([
        Object.freeze({
          path: 'tests/server/breedingCampaignClockBatch.test.ts' as const,
          requiredNeedle: 'persists parent, child, segment, and exact replay across a file-database restart' as const,
        }),
        Object.freeze({
          path: 'tests/server/breedingHatchCompletion.test.ts' as const,
          requiredNeedle: 'recovers a pending hatch after process restart and exposes a replay gap without replaying mechanics' as const,
        }),
      ]),
      expectedOutcome: 'strict persisted operation evidence resumes after process restart and terminal replay remains publication-silent' as const,
    }),
    Object.freeze({
      scenarioId: 'dual-consent-transfer' as const,
      evidence: Object.freeze([
        Object.freeze({
          path: 'tests/server/breedingEggTransfer.test.ts' as const,
          requiredNeedle: 'orchestrates private source offer, recipient acceptance, and atomic ownership transfer without GM consent substitution' as const,
        }),
      ]),
      expectedOutcome: 'two independently authenticated positive consents precede one atomic ownership mutation and GM authority substitutes for neither participant' as const,
    }),
    Object.freeze({
      scenarioId: 'concurrent-hatch' as const,
      evidence: Object.freeze([
        Object.freeze({
          path: 'tests/server/breedingHatchCompletion.test.ts' as const,
          requiredNeedle: 'allows only one of two stale concurrent hatch commands across SQLite connections' as const,
        }),
      ]),
      expectedOutcome: 'two file-database contenders converge to one child, one roster link, one acquisition, one origin, and one bounded publication set' as const,
    }),
  ]),
  invariants: Object.freeze([
    'campaign-time-only-lifecycle-authority',
    'current-role-Profile-Trainer-and-revision-authorization',
    'server-structural-audience-privacy',
    'persisted-randomness-and-terminal-exact-retry',
    'dual-positive-transfer-consent-without-gm-substitution',
    'one-atomic-hatch-winner',
    'no-map-encounter-or-browser-mechanics-authority',
  ] as const),
  releaseCommand: 'npm run test:breeding-production-acceptance' as const,
})

export const BREEDING_PRODUCTION_ACCEPTANCE_PROFILE_DEFINITION_SHA256 =
  '0c0e565e8da7b01146b61a9ade65ae14c958662a541955a625fa99e5cf87e139' as const
