import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const readProductFile = (...segments: string[]) => readFileSync(join(process.cwd(), ...segments), 'utf8')

describe('private VPS reverse proxy docs', () => {
  it('documents Caddy HTTPS termination to the loopback Nitro server', () => {
    const privateVpsDoc = readProductFile('docs/private-vps-hosting.md')

    expect(privateVpsDoc).toContain('## Reverse proxy example')
    expect(privateVpsDoc).toContain('uses Caddy')
    expect(privateVpsDoc).toContain('terminates HTTPS')
    expect(privateVpsDoc).toContain('reverse_proxy 127.0.0.1:3000')
    expect(privateVpsDoc).toContain('NITRO_HOST=127.0.0.1')
    expect(privateVpsDoc).toContain('curl -fsS https://rotom-table.example.com/api/health')
  })

  it('calls out WebSocket upgrade compatibility and the outer access gate boundary', () => {
    const privateVpsDoc = readProductFile('docs/private-vps-hosting.md')

    expect(privateVpsDoc).toContain('WebSocket upgrade support must work end-to-end')
    expect(privateVpsDoc).toContain('WebSocket /api/sessions/socket')
    expect(privateVpsDoc).toContain('handles WebSocket upgrades by default')
    expect(privateVpsDoc).toContain('outer access gate')
    expect(privateVpsDoc).toContain('not Rotom Table authentication')
    expect(privateVpsDoc).toContain('not a public-hosting safety layer')
  })
})
