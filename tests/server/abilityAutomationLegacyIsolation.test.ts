import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ABILITY_AUTOMATION_LEGACY_COMPATIBILITY_POLICY } from '#shared/abilityAutomation/legacyCompatibility'
import { selectNativeAbilityRuntime } from '../../server/domain/abilityAutomation/runtimeSelection'

const root = process.cwd()

const productionSourceFiles = (directory: string): string[] => readdirSync(directory)
  .flatMap((name) => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) return productionSourceFiles(path)
    return /\.(?:ts|vue)$/.test(name) ? [path] : []
  })

const source = (path: string): string => readFileSync(join(root, path), 'utf8')

const manifestRow = (
  overrides: Partial<{
    canonicalId: string
    baseStatus: 'blocked' | 'assisted' | 'complete'
    runtimeKind: 'unimplemented' | 'abilityspec-v1'
  }> = {},
) => ({
  canonicalId: overrides.canonicalId ?? 'Moxie',
  baseStatus: overrides.baseStatus ?? 'complete',
  runtime: {
    kind: overrides.runtimeKind ?? 'abilityspec-v1',
    version: 1,
    definitionHash: 'a'.repeat(64),
    sourceModule: 'server/domain/abilityAutomation/specs/moxie.ts',
  },
})

describe('ability automation legacy isolation after runtime retirement', () => {
  it('allows historical readers but retires every production legacy write path', () => {
    expect(ABILITY_AUTOMATION_LEGACY_COMPATIBILITY_POLICY).toEqual({
      schemaVersion: 2,
      readerBoundaries: ['shared-command-schema', 'historical-data-reader', 'test-migration-fixture'],
      productionExecution: 'retired',
      productionWrites: 'native-only',
      legacyHttpRoute: 'authenticated-gone-tombstone',
      legacySessionCommand: 'non-retryable-rejection',
      nativeRuntimeFallback: 'forbidden',
    })
  })

  it('keeps the legacy transaction registry out of every production import graph', () => {
    const files = [
      ...productionSourceFiles(join(root, 'server')),
      ...productionSourceFiles(join(root, 'src')),
    ]
    const directImports = files
      .filter((path) => {
        const value = readFileSync(path, 'utf8')
        return value.includes("from '~/utils/abilityAutomation'")
          || value.includes('from "~/utils/abilityAutomation"')
          || value.includes("from './abilityAutomation'")
          || value.includes('from "./abilityAutomation"')
          || value.includes('abilityAutomationLegacyCompatibility')
          || value.includes('domain/abilityAutomation/legacyCompatibility')
          || value.includes('abilityAutomation/legacyNames')
      })
      .map(path => relative(root, path))
      .sort()

    expect(directImports).toEqual([])
    expect(existsSync(join(root, 'server/domain/abilityAutomation/legacyCompatibility.ts'))).toBe(false)
    expect(existsSync(join(root, 'src/utils/abilityAutomationLegacyCompatibility.ts'))).toBe(false)
  })

  it('tombstones old HTTP/session commands and exposes only the native client gateway', () => {
    const mapAction = source('server/useCases/applyMapTokenTableAction.ts')
    const sessionAction = source('server/useCases/applyUseTableActionCommand.ts')
    const route = source('server/api/maps/tokens/use-ability.post.ts')
    const clientCommands = source('src/composables/map-editor/useLivePlayCommands.ts')
    const clientRoutes = source('src/utils/apiRoutes.ts')
    const mapPage = source('src/pages/maps/[slug].vue')
    const socket = source('server/utils/sessionWebSocketServer.ts')

    for (const value of [mapAction, sessionAction]) {
      expect(value).not.toContain('resolveLegacyMapAbilityAutomationTransaction')
      expect(value).not.toContain('resolveMapAbilityAutomationTransaction')
      expect(value).not.toContain('buildLegacyTokenAbilityMenuOptions')
      expect(value).not.toContain('applyAbilityActivationToSheet')
      expect(value).not.toContain('appendAbilityAutomationLogEntry')
    }
    expect(mapAction).toContain('LEGACY_USE_ABILITY_RETIRED_MESSAGE')
    expect(sessionAction).toContain('RETIRED_SESSION_USE_ABILITY_MESSAGE')

    expect(route).toContain('statusCode: 410')
    expect(route).not.toContain('readObjectBody')
    expect(route).not.toContain('executeLivePlayTableActionCommandUseCase')
    expect(socket).toContain('Legacy session useAbility execution is retired')
    expect(socket).not.toContain('UseAbilityCommand |')

    expect(clientCommands).not.toContain('LIVE_PLAY_COMMAND_TYPES.USE_ABILITY')
    expect(clientCommands).not.toContain('const useAbility')
    expect(clientRoutes).not.toContain("useAbility: '/api/maps/tokens/use-ability'")
    expect(mapPage).toContain('useAbilityAutomationGateway')
  })

  it('routes every former post-Move Ability hook through native overlays only', () => {
    const followUps = source('server/domain/moveAutomation/abilityFollowUps.ts')
    const followUpSpecs = source('server/domain/moveAutomation/abilityFollowUpSpecs.ts')
    const moxie = source('server/domain/abilityAutomation/mechanics/aa080MoveIntegration.ts')
    const panel = source('src/composables/map-editor/useMoveAutomationPanel.ts')

    for (const retired of ['Moxie', 'Celebrate', 'Cute Charm', 'Poison Point']) {
      expect(followUpSpecs).not.toContain(`displayName: '${retired}'`)
    }
    expect(followUps).not.toContain('buildMoxieTriggerPrompts')
    expect(followUps).not.toContain('buildCelebrateTriggerPrompts')
    expect(followUps).not.toContain('buildCuteCharmReactionPrompts')
    expect(followUps).not.toContain('buildPoisonPointReactionPrompts')
    expect(followUps).toContain('buildSpiteReactionPrompts')
    expect(moxie).toContain('ability.moxie.optional-attack-stage')
    expect(panel).not.toContain('moxieTriggerPrompts')
    expect(panel).not.toContain('cuteCharmReactionPrompts')
    expect(panel).not.toContain('poisonPointReactionPrompts')
    expect(panel).not.toContain('celebrateTriggerPrompts')
    expect(source('src/utils/sheetAbilityActivation.ts')).not.toContain('computeSheetAbilityEvasionBonus')
    expect(source('src/utils/sheetAbilityActivation.ts')).toContain("status: 'retired'")
    expect(source('src/utils/sheetEvasionBonuses.ts')).not.toContain('sheetAbilityActivation')
    expect(source('src/components/sheets/PokemonAbilitiesEdgesPanel.vue')).not.toContain('Activate')
    expect(source('src/utils/mapTokenAbilities.ts')).not.toContain('isSheetAbilityActivated')
    expect(source('src/utils/sheets/persistence.ts')).toContain('delete persisted.activated')

    for (const path of [
      'src/utils/moveAutomationMoxie.ts',
      'src/utils/moveAutomationCelebrate.ts',
      'src/utils/moveAutomationCuteCharm.ts',
      'src/utils/moveAutomationPoisonPoint.ts',
      'src/utils/abilityAutomationLog.ts',
    ]) expect(existsSync(join(root, path))).toBe(false)
  })

  it('retains old command/data shapes only as explicit compatibility readers', () => {
    expect(source('shared/livePlayCommands.ts')).toContain("USE_ABILITY: 'useAbility'")
    expect(source('shared/sessionTableActionCommands.ts')).toContain("USE_ABILITY_COMMAND_TYPE = 'useAbility'")
    expect(source('src/utils/abilityAutomation.ts')).not.toContain('resolveMapAbilityAutomationTransaction')
    expect(source('src/utils/abilityAutomation.ts')).toContain("status: 'retired'")
  })

  it('selects only manifest-certified native registrations', () => {
    const registration = {
      canonicalId: 'Moxie',
      kind: 'abilityspec-v1' as const,
      version: 1,
      definitionHash: 'a'.repeat(64),
      sourceModule: 'server/domain/abilityAutomation/specs/moxie.ts',
      definition: { id: 'moxie' },
    }

    expect(selectNativeAbilityRuntime(manifestRow(), registration)).toEqual({
      kind: 'native',
      registration,
    })
    expect(selectNativeAbilityRuntime(manifestRow({ baseStatus: 'blocked' }), registration)).toEqual({
      kind: 'unavailable',
      reason: 'manifest-base-status-not-complete',
    })
    expect(selectNativeAbilityRuntime(
      manifestRow({ runtimeKind: 'unimplemented' }),
      registration,
    )).toEqual({
      kind: 'unavailable',
      reason: 'manifest-runtime-not-native',
    })
    expect(selectNativeAbilityRuntime(manifestRow(), null)).toEqual({
      kind: 'unavailable',
      reason: 'registration-missing',
    })
    expect(selectNativeAbilityRuntime(manifestRow(), { ...registration, canonicalId: 'Celebrate' })).toEqual({
      kind: 'unavailable',
      reason: 'registration-canonical-id-mismatch',
    })
    expect(selectNativeAbilityRuntime(manifestRow(), { ...registration, version: 2 })).toEqual({
      kind: 'unavailable',
      reason: 'registration-metadata-mismatch',
    })
  })
})
