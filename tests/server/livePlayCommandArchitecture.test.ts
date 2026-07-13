import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LIVE_PLAY_COMMAND_TYPES, LIVE_PLAY_MAP_COMMAND_TYPE_VALUES } from '#shared/livePlayCommands'

const useCasesDir = join(process.cwd(), 'server/useCases')
const useCaseFiles = readdirSync(useCasesDir)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => ({ name, path: join(useCasesDir, name), text: readFileSync(join(useCasesDir, name), 'utf8') }))

const productionLivePlayCommandFiles = useCaseFiles.filter(({ text }) => (
  text.includes('createSqliteAuthoritativeLivePlayCommandExecutor')
))

const productionSheetChangingLivePlayCommandFiles = productionLivePlayCommandFiles.filter(({ name }) => [
  'applyLivePlaySheetCommand.ts',
  'applyLivePlayUseMoveCommand.ts',
  'applyMapTokenTableAction.ts',
  'applyResolveMoveCommand.ts',
  'applyThrowPokeballCommand.ts',
].includes(name))

describe('production live-play command architecture', () => {
  it('does not directly construct generic SQLite command executors or publish accepted-command events in use cases', () => {
    const directAcceptedPublishers = useCaseFiles
      .filter(({ text }) => text.includes('livePlayCommandAcceptedRealtimeEvent'))
      .map(({ name }) => name)
    const directGenericSqliteExecutors = useCaseFiles
      .filter(({ text }) => text.includes('createAuthoritativeLivePlayCommandExecutor({'))
      .map(({ name }) => name)

    expect(directAcceptedPublishers).toEqual([])
    expect(directGenericSqliteExecutors).toEqual([])
  })

  it('centralizes every production live-play command use case on the SQLite executor factory or an injected executor path', () => {
    expect(productionLivePlayCommandFiles.map(({ name }) => name).sort()).toEqual([
      'applyAttackOfOpportunityCommand.ts',
      'applyLivePlayInitiativeCommand.ts',
      'applyLivePlayMapEffectsCommand.ts',
      'applyLivePlaySceneCommand.ts',
      'applyLivePlaySheetCommand.ts',
      'applyLivePlayTerrainCommand.ts',
      'applyLivePlayUseMoveCommand.ts',
      'applyMapTokenAction.ts',
      'applyMapTokenTableAction.ts',
      'applyResolveMoveCommand.ts',
      'applyStartTurnModalCommand.ts',
      'applyThrowPokeballCommand.ts',
    ])

    const offenders = productionLivePlayCommandFiles
      .filter(({ text }) => !text.includes('createSqliteAuthoritativeLivePlayCommandExecutor'))
      .map(({ name }) => name)
    expect(offenders).toEqual([])
  })

  it('requires production accepted command persistence to use the commit hook and save operation results inside it', () => {
    const offenders = productionLivePlayCommandFiles
      .filter(({ text }) => !text.includes('commit:') || !text.includes('saveOpResult'))
      .map(({ name }) => name)
    expect(offenders).toEqual([])
  })

  it('does not directly publish full sheet update realtime events from production live-play commands', () => {
    const offenders = productionLivePlayCommandFiles
      .filter(({ text }) => (
        text.includes('sheetChannel(')
        || text.includes('sheetsChannel')
        || text.includes('publishRealtimeEvent')
        || text.includes('publishRealtime(')
      ))
      .map(({ name }) => name)
    expect(offenders).toEqual([])
  })

  it('does not instantiate realtime event repositories from production live-play command use cases', () => {
    const offenders = productionLivePlayCommandFiles
      .filter(({ text }) => (
        text.includes('createSqliteRealtimeEventRepository')
        || text.includes('sqliteRealtimeEventRepository')
        || text.includes('RealtimeEventRepository')
      ))
      .map(({ name }) => name)
    expect(offenders).toEqual([])
  })

  it('requires sheet-changing production commands to use the canonical durable sheet event helper before saveOpResult', () => {
    const missingHelper = productionSheetChangingLivePlayCommandFiles
      .filter(({ text }) => !text.includes('livePlaySheetUpdateRealtimeAppendInputs'))
      .map(({ name }) => name)
    const wrongOrder = productionSheetChangingLivePlayCommandFiles
      .filter(({ text }) => {
        const recordIndex = text.indexOf('recordRealtimeEvents(livePlaySheetUpdateRealtimeAppendInputs')
        const saveIndex = text.indexOf('saveOpResult(', recordIndex)
        return recordIndex < 0 || saveIndex < 0 || recordIndex > saveIndex
      })
      .map(({ name }) => name)

    expect(missingHelper).toEqual([])
    expect(wrongOrder).toEqual([])
  })

  it('the production map command use cases mention every current map live-play command type', () => {
    const combined = productionLivePlayCommandFiles.map(({ text }) => text).join('\n')
    const mapCommandTypes = new Set<string>(LIVE_PLAY_MAP_COMMAND_TYPE_VALUES)
    const missing = Object.entries(LIVE_PLAY_COMMAND_TYPES)
      .filter(([, type]) => mapCommandTypes.has(type))
      .filter(([constantName]) => !combined.includes(`LIVE_PLAY_COMMAND_TYPES.${constantName}`))
      .map(([, type]) => type)
    expect(missing).toEqual([])
  })
})
