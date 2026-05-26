import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readText = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')

describe('Track 2 session backup and recovery runbook', () => {
  const runbook = readText('docs/track-2-session-backup-recovery.md')

  it('documents snapshot and event-log backup artifacts without changing the persistence model', () => {
    expect(runbook).toContain('data/sessions/<sessionId>/snapshot.json')
    expect(runbook).toContain('data/sessions/<sessionId>/events.jsonl')
    expect(runbook).toContain('latest valid `data/sessions/<sessionId>/snapshot.json` is the recovery baseline')
    expect(runbook).toContain('optional. It can support audit, troubleshooting, or future replay')
    expect(runbook).toContain('not sufficient by itself')
    expect(runbook).toContain('Track 2 does not add Postgres, Redis, Durable Objects, cloud object storage, automatic replication, or a hosted database')
  })

  it('documents the full local/private campaign data set to include in backups', () => {
    expect(runbook).toContain('data/maps/')
    expect(runbook).toContain('data/sheets/')
    expect(runbook).toContain('data/trainers/')
    expect(runbook).toContain('encounter_tables/')
    expect(runbook).toContain('External private assets')
    expect(runbook).toContain('Browser identity hints are continuity aids, not durable session authority')
    expect(runbook).toContain('player display names, player IDs, client IDs, assignments, command metadata, `opId` values, revisions')
  })

  it('documents safe backup timing and concrete private archive commands', () => {
    expect(runbook).toContain('Ask players to stop sending commands')
    expect(runbook).toContain('Stop `cloudflared tunnel run ...`')
    expect(runbook).toContain('snapshot.json.tmp-*')
    expect(runbook).toContain('tar -czf ../rotom-table-backups/rotom-session-$(date +%Y%m%d-%H%M%S).tgz')
    expect(runbook).toContain('rsync -a data/sessions/<sessionId>/')
    expect(runbook).toContain('Compress-Archive -Path data\\sessions\\<sessionId>,data\\maps,data\\sheets,data\\trainers,encounter_tables')
    expect(runbook).toContain('Keep the destination outside the repository')
  })

  it('documents restore, reconnect, and fail-closed recovery boundaries', () => {
    expect(runbook).toContain('npm run dev:session:lan')
    expect(runbook).toContain('npm run dev:session:tunnel')
    expect(runbook).toContain('/maps/<map-slug>?session=1')
    expect(runbook).toContain('Recovery tooling must validate the snapshot schema, session ID, revision, timestamps, authoritative state, players, clients, assignments, and map state')
    expect(runbook).toContain('Do not trust browser state')
    expect(runbook).toContain('Treat the event log as audit/troubleshooting data only')
    expect(runbook).toContain('start a fresh GM session and share the new join code rather than reusing or inventing old credentials')
  })

  it('keeps local/private data and no-secret boundaries visible', () => {
    expect(runbook).toContain('Do not commit these files or paste raw snapshots/event logs into issue trackers')
    expect(runbook).toContain('session-local GM keys and join codes')
    expect(runbook).toContain('named Cloudflare Tunnel config, credentials JSON, `cert.pem`, Access/WAF settings, tokens, private keys, and real `.env` files')
    expect(runbook).toContain('Backups are not encrypted by Rotom Table')
    expect(runbook).not.toContain('gmKey=')
    expect(runbook).not.toContain('joinCode=')
  })

  it('is linked from primary Track 2 docs and hosting runbooks', () => {
    expect(readText('README.md')).toContain('docs/track-2-session-backup-recovery.md')
    expect(readText('docs/README.md')).toContain('track-2-session-backup-recovery.md')
    expect(readText('docs/local-development.md')).toContain('track-2-session-backup-recovery.md')
    expect(readText('docs/track-2-roadmap.md')).toContain('track-2-session-backup-recovery.md')
    expect(readText('docs/track-2-session-protocol.md')).toContain('track-2-session-backup-recovery.md')
    expect(readText('docs/track-2-session-storage.md')).toContain('track-2-session-backup-recovery.md')
    expect(readText('docs/track-2-session-host-runtime.md')).toContain('track-2-session-backup-recovery.md')
    expect(readText('docs/track-2-lan-hosting.md')).toContain('track-2-session-backup-recovery.md')
    expect(readText('docs/track-2-cloudflare-tunnel-hosting.md')).toContain('track-2-session-backup-recovery.md')
  })
})
