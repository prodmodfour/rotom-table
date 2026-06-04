import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const readProductFile = (...segments: string[]) => readFileSync(join(process.cwd(), ...segments), 'utf8')

describe('private VPS outer access gate docs', () => {
  it('lists acceptable gate examples without requiring one vendor', () => {
    const privateVpsDoc = readProductFile('docs/private-vps-hosting.md')

    expect(privateVpsDoc).toContain('## Outer access gate')
    expect(privateVpsDoc).toContain('private network')
    expect(privateVpsDoc).toContain('VPN')
    expect(privateVpsDoc).toContain('Tailscale')
    expect(privateVpsDoc).toContain('Cloudflare Access')
    expect(privateVpsDoc).toContain('Reverse-proxy basic authentication')
    expect(privateVpsDoc).toContain('no single vendor is required')
  })

  it('makes clear that arbitrary internet users and GM Login are outside the trust boundary', () => {
    const privateVpsDoc = readProductFile('docs/private-vps-hosting.md')
    const securityDoc = readProductFile('SECURITY.md')

    expect(privateVpsDoc).toContain('must not be reachable by arbitrary internet users')
    expect(privateVpsDoc).toContain("separate from Rotom Table's GM/Player role picker")
    expect(privateVpsDoc).toContain('GM Login is not enough')
    expect(privateVpsDoc).toContain('not a password, account system, or public authentication layer')
    expect(securityDoc).toContain('GM Login is not enough')
    expect(securityDoc).toContain('arbitrary internet users can reach')
  })

  it('gives operators concrete checks before sharing a host URL', () => {
    const privateVpsDoc = readProductFile('docs/private-vps-hosting.md')

    expect(privateVpsDoc).toContain('Before sharing a host URL')
    expect(privateVpsDoc).toContain('binds to `127.0.0.1`')
    expect(privateVpsDoc).toContain('blocks direct public access')
    expect(privateVpsDoc).toContain('cannot load `/login` or `/api/health`')
    expect(privateVpsDoc).toContain('covers normal page loads, mutating API routes, and WebSocket upgrades')
  })
})
