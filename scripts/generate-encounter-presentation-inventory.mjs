import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const source = readFileSync(resolve(root, 'shared/livePlayCommands.ts'), 'utf8')
const block = source.match(/export const LIVE_PLAY_COMMAND_TYPES = \{([\s\S]*?)\n\} as const/)
if (!block) throw new Error('LIVE_PLAY_COMMAND_TYPES could not be read.')
const commands = [...block[1].matchAll(/^\s*([A-Z_]+):\s*'([^']+)'/gm)]
  .map(([, constant, type]) => ({ constant, type }))

const kindFor = (type) => {
  if (type === 'moveToken') return 'movement'
  if (type === 'useMove' || type === 'resolveMove') return 'move'
  if (type === 'useManeuver' || type === 'updateAttackOfOpportunity') return 'maneuver'
  if (type === 'useAbility') return 'ability'
  if (type === 'useOrder') return 'order'
  if (type === 'throwPokeball') return 'capture'
  if (/Hazard/.test(type)) return 'hazard'
  if (/FieldEffect/.test(type)) return 'field-effect'
  if (/TerrainVoxel/.test(type)) return 'terrain'
  if (/Initiative/.test(type)) return 'initiative'
  if (type === 'setScene') return 'scene'
  if (type === 'shopCheckout') return 'shop'
  if (type === 'grantExperience') return 'system'
  return 'token'
}
const actionFor = (type, kind) => {
  if (type === 'moveToken') return 'movement.shift'
  if (type === 'resolveMove' || type === 'useMove') return 'move.declare'
  if (type === 'useManeuver') return 'maneuver.declare'
  if (type === 'useAbility') return 'ability.declare:<modeId>'
  if (type === 'useOrder') return 'order.declare'
  if (type === 'throwPokeball') return 'capture.throw'
  if (kind === 'initiative') return 'initiative.advance'
  if (kind === 'scene') return 'scene.manage'
  if (kind === 'field-effect') return 'field.manage'
  if (kind === 'hazard') return 'hazard.manage'
  if (kind === 'terrain') return 'terrain.manage'
  if (kind === 'shop') return 'shop.checkout'
  return 'token.manage'
}

const commandEntries = commands.map(({ constant, type }) => {
  const sourceKind = kindFor(type)
  return {
    inventoryId: `live-play:${type}`,
    wireType: type,
    constant,
    sourceKind,
    interactionRoles: sourceKind === 'shop'
      ? ['campaign-operation']
      : ['activated-action'],
    genericActionId: actionFor(type, sourceKind),
    authorityPath: type === 'useAbility'
      ? 'retired-reader-only'
      : type === 'shopCheckout'
        ? 'authoritative-shop-command'
        : 'authoritative-live-play-command',
    acceptedAdapter: type === 'useAbility'
      ? 'deprecated-rejection'
      : type === 'shopCheckout'
        ? null
        : 'acceptedEncounterPresentationFromLivePlayCommand',
    snapshotProjection: type === 'shopCheckout'
      ? 'out-of-encounter-shop-surface'
      : 'encounter-action-or-gm-management-surface',
    migrationStatus: type === 'useAbility'
      ? 'retired'
      : type === 'shopCheckout'
        ? 'out-of-encounter'
        : 'generic-contract',
  }
})

const inventory = {
  schemaVersion: 1,
  contractSchemaVersion: 1,
  description: 'Exhaustive machine-readable inventory of accepted command and non-command encounter presentation sources.',
  commands: commandEntries,
  nonCommandSources: [
    {
      inventoryId: 'native:ability-declaration',
      sourceKind: 'ability',
      interactionRoles: ['activated-action', 'choice-only'],
      genericActionId: 'ability.declare:<modeId>',
      authorityPath: 'ability-declaration-intent',
      acceptedAdapter: 'acceptedEncounterPresentationFromAbility',
      migrationStatus: 'generic-contract',
    },
    {
      inventoryId: 'native:pending-move-response',
      sourceKind: 'move',
      interactionRoles: ['interrupt-reaction', 'choice-only', 'spatial-choice'],
      genericActionId: 'interaction.respond',
      authorityPath: 'durable-pending-move-resolution',
      acceptedAdapter: 'withAcceptedEncounterPresentation',
      migrationStatus: 'generic-contract',
    },
    {
      inventoryId: 'native:pending-ability-response',
      sourceKind: 'ability',
      interactionRoles: ['triggered-optional', 'interrupt-reaction', 'choice-only'],
      genericActionId: 'interaction.respond',
      authorityPath: 'authorized-ability-response-view',
      acceptedAdapter: 'pendingEncounterInteractionFromAbilityView',
      migrationStatus: 'generic-contract',
    },
    {
      inventoryId: 'projection:passive-sources',
      sourceKind: 'ability|capability|edge|feature',
      interactionRoles: ['passive-provider', 'triggered-automatic', 'triggered-optional'],
      genericActionId: null,
      authorityPath: 'encounter-snapshot-projection',
      acceptedAdapter: null,
      migrationStatus: 'generic-contract',
    },
    {
      inventoryId: 'projection:inventory-affordances',
      sourceKind: 'item',
      interactionRoles: ['contextual-affordance'],
      genericActionId: null,
      authorityPath: 'encounter-snapshot-projection',
      acceptedAdapter: null,
      migrationStatus: 'generic-contract',
    },
  ],
  presentationSurfaces: [
    {
      inventoryId: 'snapshot:encounter-presentation',
      implementationPath: 'server/useCases/loadLiveTableSnapshot.ts',
      contract: 'EncounterPresentationProjection',
      authority: 'server-role-projection',
      migrationStatus: 'generic-contract',
    },
    {
      inventoryId: 'client:legacy-context-menu-adapter',
      implementationPath: 'src/utils/encounterPresentation/legacyContextMenuProjection.ts',
      contract: 'EncounterActionOffer|EncounterContextualAffordance',
      authority: 'server-inclusion-local-decoration',
      migrationStatus: 'compatibility-only',
    },
    {
      inventoryId: 'client:generic-interaction-panel',
      implementationPath: 'src/components/map/EncounterPresentationPanel.vue',
      contract: 'EncounterPresentationProjection',
      authority: 'presentation-only',
      migrationStatus: 'generic-contract',
    },
    {
      inventoryId: 'client:generic-vfx-overlay',
      implementationPath: 'src/components/map/EncounterVfxOverlay.vue',
      contract: 'AcceptedEncounterPresentation.vfx',
      authority: 'presentation-only',
      migrationStatus: 'generic-contract',
    },
    {
      inventoryId: 'client:announcement-history-runtime',
      implementationPath: 'src/composables/map-editor/useEncounterPresentationRuntime.ts',
      contract: 'AcceptedEncounterPresentation',
      authority: 'deduplicated-presentation-only',
      migrationStatus: 'generic-contract',
    },
    {
      inventoryId: 'durable:accepted-realtime',
      implementationPath: 'server/livePlay/acceptedCommandRealtime.ts',
      contract: 'AcceptedEncounterPresentation',
      authority: 'accepted-command-facts',
      migrationStatus: 'generic-contract',
    },
    {
      inventoryId: 'durable:accepted-replay',
      implementationPath: 'server/domain/encounterPresentation/replay.ts',
      contract: 'AcceptedEncounterPresentation',
      authority: 'bounded-durable-history',
      migrationStatus: 'generic-contract',
    },
    {
      inventoryId: 'recovery:pending-interactions',
      implementationPath: 'server/domain/encounterPresentation/pendingAdapters.ts',
      contract: 'EncounterPendingInteractionView',
      authority: 'authorized-response-and-public-summary',
      migrationStatus: 'generic-contract',
    },
  ],
}
const output = resolve(root, 'data/encounter-presentation/action-source-inventory.json')
const serialized = `${JSON.stringify(inventory, null, 2)}\n`
if (process.argv.includes('--check')) {
  const current = readFileSync(output, 'utf8')
  if (current !== serialized) {
    console.error('[encounter-presentation-inventory] generated inventory is stale; run npm run generate:encounter-presentation-inventory')
    process.exit(1)
  }
  console.log('[encounter-presentation-inventory] generated inventory is current.')
}
else {
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, serialized)
  console.log(output)
}
