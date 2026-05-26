#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import process from 'node:process'

export const SESSION_HOST_ENABLE_ENV = 'ROTOM_ENABLE_SESSION_HOST'
export const SESSION_HOST_ENABLE_VALUE = '1'
export const DEFAULT_BASE_URL = 'http://localhost:3000'
export const DEFAULT_PLAYER_TABS = 1

export const FOCUSED_SMOKE_TESTS = Object.freeze([
  'tests/server/sessionTokenCommandTwoClientSmoke.test.ts',
  'tests/composables/map-editor/sessionClientIntegration.test.ts',
])

const HELP_TEXT = `Track 2 multi-tab local smoke helper

Usage:
  npm run smoke:session:multi-tab -- [options]

Options:
  --base-url <url>       Rotom Table origin to open. Default: ${DEFAULT_BASE_URL}
  --map <slug>           Map slug to open as /maps/<slug>?session=1 for GM/player tabs.
  --player-tabs <count>  Number of player session-map tabs to open. Default: ${DEFAULT_PLAYER_TABS}
  --no-open              Print URLs and checklist without opening a browser.
  --skip-checks          Do not run the focused automated token/client smoke tests.
  --browser <command>    Custom browser/opener command. The URL is appended as the final arg.
  --help                 Show this help.

Before running the browser portion, start Rotom Table separately with:
  ${SESSION_HOST_ENABLE_ENV}=${SESSION_HOST_ENABLE_VALUE} npm run dev
`

export class SmokeCliError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SmokeCliError'
  }
}

const ensureStringValue = (args, index, flag) => {
  const value = args[index + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new SmokeCliError(`${flag} requires a value`)
  }
  return value
}

const parsePositiveInteger = (value, flag) => {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new SmokeCliError(`${flag} must be a positive integer`)
  }
  return parsed
}

export const parseSmokeCliArgs = (args) => {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    mapSlug: null,
    playerTabs: DEFAULT_PLAYER_TABS,
    openBrowser: true,
    runChecks: true,
    browserCommand: null,
    help: false,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    switch (arg) {
      case '--base-url':
        options.baseUrl = ensureStringValue(args, index, arg)
        index += 1
        break
      case '--map':
      case '--map-slug':
        options.mapSlug = ensureStringValue(args, index, arg)
        index += 1
        break
      case '--player-tabs':
        options.playerTabs = parsePositiveInteger(ensureStringValue(args, index, arg), arg)
        index += 1
        break
      case '--no-open':
      case '--dry-run':
        options.openBrowser = false
        break
      case '--skip-checks':
        options.runChecks = false
        break
      case '--browser':
        options.browserCommand = ensureStringValue(args, index, arg)
        index += 1
        break
      case '--help':
      case '-h':
        options.help = true
        break
      default:
        throw new SmokeCliError(`Unknown option: ${arg}`)
    }
  }

  return options
}

export const normalizeBaseUrl = (baseUrl = DEFAULT_BASE_URL) => {
  const trimmed = String(baseUrl).trim()
  if (trimmed.length === 0) throw new SmokeCliError('--base-url cannot be empty')

  let parsed
  try {
    parsed = new URL(trimmed)
  } catch (error) {
    throw new SmokeCliError(`--base-url must be an absolute http(s) URL: ${error.message}`)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SmokeCliError('--base-url must use http:// or https://')
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, '')
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString().replace(/\/$/, '')
}

const urlFor = (baseUrl, pathAndQuery) => new URL(pathAndQuery, `${baseUrl}/`).toString()

const normalizeMapSlug = (mapSlug) => {
  if (mapSlug === null || mapSlug === undefined) return null
  const trimmed = String(mapSlug).trim().replace(/^\/+|\/+$/g, '')
  if (trimmed.length === 0) throw new SmokeCliError('--map cannot be empty')
  return trimmed
}

const mapPathFor = (mapSlug, sessionMode) => {
  const encodedSlug = mapSlug.split('/').map(encodeURIComponent).join('/')
  return `/maps/${encodedSlug}${sessionMode ? '?session=1' : ''}`
}

export const buildSmokeUrls = (input = {}) => {
  const baseUrl = normalizeBaseUrl(input.baseUrl ?? DEFAULT_BASE_URL)
  const mapSlug = normalizeMapSlug(input.mapSlug ?? null)
  const playerTabs = input.playerTabs ?? DEFAULT_PLAYER_TABS
  if (!Number.isInteger(playerTabs) || playerTabs < 1) {
    throw new SmokeCliError('playerTabs must be a positive integer')
  }

  const urls = [
    {
      key: 'gm-login',
      label: 'GM local role picker',
      profile: 'gm',
      url: urlFor(baseUrl, '/login'),
      required: true,
    },
    {
      key: 'gm-lobby',
      label: 'GM start/manage session lobby',
      profile: 'gm',
      url: urlFor(baseUrl, '/sessions#gm-lobby-title'),
      required: true,
    },
    {
      key: 'player-lobby',
      label: 'Player join session lobby',
      profile: 'player',
      url: urlFor(baseUrl, '/sessions#player-lobby-title'),
      required: true,
    },
  ]

  if (mapSlug !== null) {
    urls.push({
      key: 'gm-local-map',
      label: 'GM local-first map comparison',
      profile: 'gm',
      url: urlFor(baseUrl, mapPathFor(mapSlug, false)),
      required: false,
    })
    urls.push({
      key: 'gm-session-map',
      label: 'GM explicit session map',
      profile: 'gm',
      url: urlFor(baseUrl, mapPathFor(mapSlug, true)),
      required: true,
    })
    for (let index = 0; index < playerTabs; index += 1) {
      urls.push({
        key: `player-${index + 1}-session-map`,
        label: `Player ${index + 1} explicit session map`,
        profile: 'player',
        url: urlFor(baseUrl, mapPathFor(mapSlug, true)),
        required: true,
      })
    }
  } else {
    urls.push({
      key: 'map-library',
      label: 'Map library for choosing a smoke map',
      profile: 'gm',
      url: urlFor(baseUrl, '/maps'),
      required: false,
    })
  }

  return urls
}

export const buildAutomatedCheckCommand = () => ({
  command: 'npm',
  args: ['test', '--', ...FOCUSED_SMOKE_TESTS],
})

export const buildSmokeChecklist = (input = {}) => {
  const mapSlug = normalizeMapSlug(input.mapSlug ?? null)
  const baseUrl = normalizeBaseUrl(input.baseUrl ?? DEFAULT_BASE_URL)
  const automated = buildAutomatedCheckCommand()
  const mapLabel = mapSlug ?? '<map-slug>'
  const sessionMapPath = mapSlug === null ? '/maps/<map-slug>?session=1' : mapPathFor(mapSlug, true)
  const localMapPath = mapSlug === null ? '/maps/<map-slug>' : mapPathFor(mapSlug, false)

  return [
    `Start Rotom Table in a separate terminal with ${SESSION_HOST_ENABLE_ENV}=${SESSION_HOST_ENABLE_VALUE} npm run dev and confirm the app is reachable at ${baseUrl}.`,
    'Use separate browser profiles/windows for GM and player so their browser-local session identity records do not overwrite each other.',
    'GM profile: open /login, choose GM Login, then open /sessions#gm-lobby-title and press Start GM session. Confirm the join code is visible and the GM key is not shown in page chrome.',
    'Player profile: open /sessions#player-lobby-title, join with the GM join code and a safe display name, then confirm the player summary is active and does not reveal the GM key, join code, other players, hidden maps, or raw snapshots.',
    `Map setup: use a local map with at least one placed token (${mapLabel}). The explicit session route must be ${sessionMapPath}; plain ${localMapPath} remains local-first for comparison.`,
    'Token propagation: in the GM session-map tab, move or turn one token. The sender should avoid a command rejection, and each player session-map tab should show the same token position/facing after the server patch without a whole-map save or page reload.',
    'Optimistic/reject check: if a token move is rejected as stale, the banner should give player-safe refresh/retry guidance and the optimistic token state should roll back or reconcile to the server current state.',
    'Reconnect check: reload the player session-map tab and confirm the reconnect/snapshot banner recovers or clearly reports stale/missing map state instead of making browser-local edits authoritative.',
    `Automated verification: ${automated.command} ${automated.args.join(' ')} locks the fake two-client server command fanout plus client session-map/optimistic integration that this browser smoke is exercising.`,
    'Cleanup: use Forget in this browser for GM/player identities, stop the dev server, unset ROTOM_ENABLE_SESSION_HOST, and do not commit generated data/sessions/ or private map/sheet data from the smoke pass.',
  ]
}

const shellQuote = (value) => `'${String(value).replace(/'/g, `'"'"'`)}'`

const splitCommandForShell = (command) => {
  if (!command || String(command).trim().length === 0) return null
  return String(command).trim()
}

/**
 * @param {NodeJS.Platform | string} [platform]
 * @param {string | null} [browserCommand]
 */
export const openerForPlatform = (platform = process.platform, browserCommand = null) => {
  const customCommand = splitCommandForShell(browserCommand)
  if (customCommand !== null) {
    return (url) => ({ command: customCommand, args: [url], shell: true })
  }

  if (platform === 'darwin') return (url) => ({ command: 'open', args: [url], shell: false })
  if (platform === 'win32') return (url) => ({ command: 'cmd', args: ['/c', 'start', '', url], shell: false })
  return (url) => ({ command: 'xdg-open', args: [url], shell: false })
}

export const openSmokeUrls = (urls, options = {}) => {
  if (options.openBrowser === false) {
    return urls.map((entry) => ({ entry, opened: false, skipped: true, status: 0 }))
  }

  const buildCommand = openerForPlatform(process.platform, options.browserCommand ?? null)
  return urls.map((entry) => {
    const opener = buildCommand(entry.url)
    const shellArgs = opener.shell && opener.args.length === 1
      ? [`${opener.command} ${shellQuote(opener.args[0])}`]
      : opener.args
    const command = opener.shell ? shellArgs[0] : opener.command
    const args = opener.shell ? [] : shellArgs
    const result = spawnSync(command, args, {
      stdio: 'ignore',
      shell: opener.shell,
      detached: false,
    })

    return {
      entry,
      opened: result.status === 0,
      skipped: false,
      status: result.status,
      error: result.error?.message,
    }
  })
}

export const runFocusedSmokeTests = (options = {}) => {
  const check = buildAutomatedCheckCommand()
  return spawnSync(check.command, check.args, {
    stdio: options.stdio ?? 'inherit',
    shell: process.platform === 'win32',
  })
}

const printSection = (title) => {
  process.stdout.write(`\n## ${title}\n`)
}

export const runSmokeCli = (argv = process.argv.slice(2)) => {
  let options
  try {
    options = parseSmokeCliArgs(argv)
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${HELP_TEXT}`)
    return 2
  }

  if (options.help) {
    process.stdout.write(HELP_TEXT)
    return 0
  }

  let urls
  let checklist
  try {
    urls = buildSmokeUrls(options)
    checklist = buildSmokeChecklist(options)
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    return 2
  }

  process.stdout.write('Track 2 multi-tab local smoke helper\n')
  if (process.env[SESSION_HOST_ENABLE_ENV] !== SESSION_HOST_ENABLE_VALUE) {
    process.stdout.write(
      `\nWarning: this shell does not have ${SESSION_HOST_ENABLE_ENV}=${SESSION_HOST_ENABLE_VALUE}. ` +
      'The dev server process itself must be started with that flag or session endpoints and sockets fail closed.\n',
    )
  }

  printSection('URLs')
  for (const entry of urls) {
    process.stdout.write(`- [${entry.profile}] ${entry.label}: ${entry.url}\n`)
  }

  if (options.openBrowser) {
    printSection('Opening browser URLs')
    const results = openSmokeUrls(urls, options)
    for (const result of results) {
      const status = result.opened ? 'opened' : `failed${result.error ? ` (${result.error})` : ''}`
      process.stdout.write(`- ${status}: ${result.entry.url}\n`)
    }
  } else {
    printSection('Browser opening skipped')
    process.stdout.write('Use the URLs above in separate GM/player browser profiles.\n')
  }

  printSection('Checklist')
  checklist.forEach((item, index) => {
    process.stdout.write(`${index + 1}. ${item}\n`)
  })

  if (options.runChecks) {
    printSection('Focused automated smoke checks')
    const check = buildAutomatedCheckCommand()
    process.stdout.write(`Running: ${check.command} ${check.args.join(' ')}\n`)
    const result = runFocusedSmokeTests()
    return result.status ?? 1
  }

  return 0
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = runSmokeCli()
}
