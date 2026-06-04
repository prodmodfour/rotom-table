import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const readProductFile = (...segments: string[]) => readFileSync(join(process.cwd(), ...segments), 'utf8')

describe('private VPS security mode docs', () => {
  it('distinguishes private VPS hosting from public visitor hardening', () => {
    const securityDoc = readProductFile('SECURITY.md')

    expect(securityDoc).toContain('## Private VPS mode')
    expect(securityDoc).toContain('private trusted-table hosting')
    expect(securityDoc).toContain('does not harden the app for arbitrary public visitors')
    expect(securityDoc).toContain('requires an outer access gate')
    expect(securityDoc).toContain('GM Login is not enough')
    expect(securityDoc).toContain('arbitrary internet users can reach')
  })

  it('keeps public service requirements explicit', () => {
    const securityDoc = readProductFile('SECURITY.md')

    expect(securityDoc).toContain('## Public service mode is separate')
    expect(securityDoc).toContain('Do not expose this application publicly')
    expect(securityDoc).toContain('real authentication and authorization')
    expect(securityDoc).toContain('persistence layer designed for hosted use')
    expect(securityDoc).toContain('route-by-route review of mutating API surfaces')
    expect(securityDoc).toContain('content/asset rights review')
    expect(securityDoc).toContain('separation of private campaign data from public/static reference data')
    expect(securityDoc).toContain('abuse monitoring')
    expect(securityDoc).toContain('rate limiting')
    expect(securityDoc).toContain('incident response')
  })

  it('keeps campaign data and backups classified as sensitive', () => {
    const securityDoc = readProductFile('SECURITY.md')

    expect(securityDoc).toContain('ROTOM_ENABLE_HOSTED_WRITES=1')
    expect(securityDoc).toContain('not authentication, authorization, rate limiting, abuse monitoring, or a replacement for backups')
    expect(securityDoc).toContain('Campaign JSON, private deployment configuration, and backup archives remain sensitive')
    expect(securityDoc).toContain('keep secrets, real deployment configuration, private campaign data, and generated backups out of Git')
  })
})
