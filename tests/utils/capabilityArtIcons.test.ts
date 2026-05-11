import { describe, expect, it } from 'vitest'
import { capabilityArtSvg } from '~/utils/capabilityArt'
import { capabilityIconMarkup } from '~/utils/capabilityArtIcons'

describe('capability art icon markup', () => {
  it('renders known icon motifs with the provided accent color', () => {
    const markup = capabilityIconMarkup('aura-reader', '#83a598')

    expect(markup).toContain('s10-17 27-17')
    expect(markup).toContain('cx="32" cy="33" r="10"')
    expect(markup).toContain('fill="#83a598"')
  })

  it('renders a stable fallback motif for unknown icon keys', () => {
    const markup = capabilityIconMarkup('not-a-real-icon', '#fabd2f')

    expect(markup).toContain('cx="32" cy="32" r="22"')
    expect(markup).toContain('>?</text>')
    expect(markup).toContain('stroke="#fabd2f"')
  })

  it('keeps the public capability SVG composed from extracted icon markup', () => {
    const svg = capabilityArtSvg('Aura Reader', 'sm')

    expect(svg).toContain('Aura Reader capability art')
    expect(svg).toContain('<g transform="translate(16 12)">')
    expect(svg).toContain('s10-17 27-17')
    expect(svg).toContain('width="62"')
  })
})
