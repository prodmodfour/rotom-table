#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import process from 'node:process'

export const SESSION_HOST_ENABLE_ENV = 'ROTOM_ENABLE_SESSION_HOST'
export const SESSION_HOST_ENABLE_VALUE = '1'
export const DEFAULT_SESSION_HOST_PORT = 3000
export const DEFAULT_SESSION_HOST_MODE = 'lan'

export const SESSION_HOST_MODES = Object.freeze({
  lan: Object.freeze({
    mode: 'lan',
    label: 'LAN / same Wi-Fi session host',
    host: '0.0.0.0',
    description: 'binds Nuxt to every local interface so trusted players on the same private network can connect',
    playerBaseUrl: 'http://<GM-LAN-IP>:3000',
    followUp: 'Open /sessions through the private LAN URL and share only the join code with trusted players.',
  }),
  tunnel: Object.freeze({
    mode: 'tunnel',
    label: 'Named Cloudflare Tunnel session host',
    host: '127.0.0.1',
    description: 'binds Nuxt to loopback so the named tunnel is the intentional remote exposure path',
    playerBaseUrl: 'https://table.example.com',
    followUp: 'Start cloudflared tunnel run <tunnel-name> separately and use the stable public hostname.',
  }),
})

const VALID_MODES = Object.keys(SESSION_HOST_MODES)

const HELP_TEXT = `live session host dev helper

Usage:
  npm run dev:session:lan -- [options]
  npm run dev:session:tunnel -- [options]
  node scripts/session-host-dev.mjs --mode <lan|tunnel> [options]

Options:
  --mode <lan|tunnel>  Hosting shape to use. Default: ${DEFAULT_SESSION_HOST_MODE}
  --port <port>        Nuxt port to pass through. Default: ${DEFAULT_SESSION_HOST_PORT}
  --print-only         Print the resolved safe command without starting Nuxt.
  --dry-run            Alias for --print-only.
  --help               Show this help.

Safe defaults:
  lan     => ${SESSION_HOST_ENABLE_ENV}=${SESSION_HOST_ENABLE_VALUE} npm run dev -- --host 0.0.0.0 --port ${DEFAULT_SESSION_HOST_PORT}
  tunnel  => ${SESSION_HOST_ENABLE_ENV}=${SESSION_HOST_ENABLE_VALUE} npm run dev -- --host 127.0.0.1 --port ${DEFAULT_SESSION_HOST_PORT}
`

export class SessionHostCliError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SessionHostCliError'
  }
}

const ensureStringValue = (args, index, flag) => {
  const value = args[index + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new SessionHostCliError(`${flag} requires a value`)
  }
  return value
}

const parsePort = (value, flag = '--port') => {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new SessionHostCliError(`${flag} must be an integer between 1 and 65535`)
  }
  return parsed
}

const normalizeMode = (mode) => {
  const normalized = String(mode ?? DEFAULT_SESSION_HOST_MODE).trim().toLowerCase()
  if (!Object.hasOwn(SESSION_HOST_MODES, normalized)) {
    throw new SessionHostCliError(`--mode must be one of: ${VALID_MODES.join(', ')}`)
  }
  return normalized
}

export const parseSessionHostCliArgs = (args) => {
  const options = {
    mode: DEFAULT_SESSION_HOST_MODE,
    port: DEFAULT_SESSION_HOST_PORT,
    printOnly: false,
    help: false,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    switch (arg) {
      case '--mode':
        options.mode = normalizeMode(ensureStringValue(args, index, arg))
        index += 1
        break
      case '--port':
        options.port = parsePort(ensureStringValue(args, index, arg), arg)
        index += 1
        break
      case '--print-only':
      case '--dry-run':
        options.printOnly = true
        break
      case '--help':
      case '-h':
        options.help = true
        break
      default:
        throw new SessionHostCliError(`Unknown option: ${arg}`)
    }
  }

  return options
}

export const resolveSessionHostConfig = (input = {}) => {
  const mode = normalizeMode(input.mode ?? DEFAULT_SESSION_HOST_MODE)
  const port = parsePort(input.port ?? DEFAULT_SESSION_HOST_PORT, 'port')
  const modeConfig = SESSION_HOST_MODES[mode]

  return {
    ...modeConfig,
    port,
    envName: SESSION_HOST_ENABLE_ENV,
    envValue: SESSION_HOST_ENABLE_VALUE,
    nuxtArgs: ['--host', modeConfig.host, '--port', String(port)],
  }
}

export const buildSessionHostDevCommand = (input = {}) => {
  const config = resolveSessionHostConfig(input)
  return {
    command: 'npm',
    args: ['run', 'dev', '--', ...config.nuxtArgs],
    env: {
      [SESSION_HOST_ENABLE_ENV]: SESSION_HOST_ENABLE_VALUE,
    },
    shell: process.platform === 'win32',
  }
}

const shellAssignmentForDisplay = (envName, envValue) => `${envName}=${envValue}`

export const formatSessionHostDevCommand = (input = {}) => {
  const config = resolveSessionHostConfig(input)
  const command = buildSessionHostDevCommand(config)
  return `${shellAssignmentForDisplay(config.envName, config.envValue)} ${command.command} ${command.args.join(' ')}`
}

export const buildSessionHostChecklist = (input = {}) => {
  const config = resolveSessionHostConfig(input)
  const command = formatSessionHostDevCommand(config)

  return [
    `Mode: ${config.label}.`,
    `Safe binding: ${config.host}:${config.port} (${config.description}).`,
    `Runtime gate: this helper sets ${config.envName}=${config.envValue} for the child Nuxt process only; no .env file, GM key, join code, tunnel credential, or session snapshot is generated by the script.`,
    `Equivalent command: ${command}`,
    `Player-facing base URL shape: ${config.playerBaseUrl.replace(':3000', `:${config.port}`)} (then /sessions#player-lobby-title or /maps/<slug>?session=1).`,
    config.followUp,
    'The existing /login GM/player role picker is still trust-based local UI, not public authentication.',
    'Live session live play must continue to use WebSocket /api/sessions/socket and server-authoritative commands, not whole-map autosave.',
    'Quick Tunnel remains development-smoke-test only; use LAN or a named Cloudflare Tunnel for supported table sessions.',
    'Before committing, confirm generated data/sessions/ snapshots/event logs, real .env files, GM keys, join codes, and private campaign data are not staged.',
  ]
}

const printSection = (title) => {
  process.stdout.write(`\n## ${title}\n`)
}

export const runSessionHostCli = (argv = process.argv.slice(2)) => {
  let options
  try {
    options = parseSessionHostCliArgs(argv)
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${HELP_TEXT}`)
    return 2
  }

  if (options.help) {
    process.stdout.write(HELP_TEXT)
    return 0
  }

  let config
  try {
    config = resolveSessionHostConfig(options)
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    return 2
  }

  const checklist = buildSessionHostChecklist(config)
  const command = buildSessionHostDevCommand(config)

  process.stdout.write('live session host dev helper\n')
  printSection('Resolved safe defaults')
  checklist.forEach((line) => process.stdout.write(`- ${line}\n`))

  if (options.printOnly) {
    printSection('Nuxt start skipped')
    process.stdout.write('Use the equivalent command above or run without --print-only to start the dev server.\n')
    return 0
  }

  printSection('Starting Nuxt')
  process.stdout.write(`Running: ${formatSessionHostDevCommand(config)}\n`)
  const result = spawnSync(command.command, command.args, {
    stdio: 'inherit',
    shell: command.shell,
    env: {
      ...process.env,
      ...command.env,
    },
  })

  if (result.error) {
    process.stderr.write(`Failed to start Nuxt: ${result.error.message}\n`)
    return 1
  }

  return result.status ?? (result.signal ? 130 : 1)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = runSessionHostCli()
}
