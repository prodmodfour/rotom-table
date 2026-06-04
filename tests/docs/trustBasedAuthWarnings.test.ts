import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const readProductFile = (...segments: string[]) => readFileSync(join(process.cwd(), ...segments), 'utf8')
const visibleText = (source: string) => source.replace(/\s+/g, ' ')

describe('trust-based auth warning text', () => {
  it('keeps the login UI explicit that the role picker is not public authentication', () => {
    const loginPage = visibleText(readProductFile('src/pages/login.vue'))

    expect(loginPage).toContain('trust-based table role picker')
    expect(loginPage).toContain('not public authentication')
    expect(loginPage).toContain('outer access gate')
  })

  it('keeps player profile docs scoped to trusted table workflow controls', () => {
    const playerProfilesDoc = readProductFile('docs/player-profiles.md')

    expect(playerProfilesDoc).toContain('trust-based table workflow controls')
    expect(playerProfilesDoc).toContain('not public authentication')
    expect(playerProfilesDoc).toContain('outer layer such as VPN/Tailscale')
  })

  it('keeps private VPS and security docs from implying arbitrary public-user safety', () => {
    const privateVpsDoc = readProductFile('docs/private-vps-hosting.md')
    const securityDoc = readProductFile('SECURITY.md')

    expect(privateVpsDoc).toContain('private trusted-table hosting')
    expect(privateVpsDoc).toContain('not public authentication')
    expect(privateVpsDoc).toContain('outer gate such as a private network')
    expect(securityDoc).toContain('trust-based tabletop tool')
    expect(securityDoc).toContain('not hardened public authentication')
    expect(securityDoc).toContain('Do not expose this application publicly')
  })
})
