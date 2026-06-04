import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const readProductFile = (...segments: string[]) => readFileSync(join(process.cwd(), ...segments), 'utf8')

describe('private VPS readiness summary', () => {
  it('summarizes the runtime, deployment path, hosted-write policy, validation, and follow-ups', () => {
    const docsIndex = readProductFile('docs/README.md')
    const summary = readProductFile('docs/private-vps-readiness-summary.md')

    expect(docsIndex).toContain('[Private VPS readiness summary](private-vps-readiness-summary.md)')

    expect(summary).toContain('private trusted-table hosting')
    expect(summary).toContain('does not claim public SaaS')
    expect(summary).toContain('Node.js 24 LTS')
    expect(summary).toContain('`.nvmrc`')
    expect(summary).toContain('`.node-version`')
    expect(summary).toContain('`>=24 <25`')
    expect(summary).toContain('no Node 22 fallback')

    expect(summary).toContain('systemd with a direct Node.js runtime')
    expect(summary).toContain('`npm run start`')
    expect(summary).toContain('`node .output/server/index.mjs`')
    expect(summary).toContain('`NITRO_HOST=127.0.0.1`')
    expect(summary).toContain('outer access gate')
    expect(summary).toContain('Docker and Compose were intentionally not added')

    expect(summary).toContain('ROTOM_ENABLE_HOSTED_WRITES=1')
    expect(summary).toContain('any value other than exactly `1`')
    expect(summary).toContain('Non-production local development writes remain available')
    expect(summary).toContain('not authentication, authorization, rate limiting, abuse monitoring, or a backup substitute')

    expect(summary).toContain('npm ci')
    expect(summary).toContain('npm run typecheck')
    expect(summary).toContain('npm test')
    expect(summary).toContain('npm run build')
    expect(summary).toContain('/api/health')

    expect(summary).toContain('real authentication and authorization')
    expect(summary).toContain('hosted persistence designed for multi-user operation')
    expect(summary).toContain('Legacy `/sessions` surfaces remain guarded maintenance paths')
  })
})
