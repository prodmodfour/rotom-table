import { describe, expect, it } from 'vitest'
import { capabilityArtSvg, capabilityArtTitle } from '~/utils/capabilityArt'
import {
  CAPABILITY_ART_SIZE_PX,
  capabilityArtInitials,
  escapeCapabilityArtXml,
  fallbackCapabilityArt,
  hashCapabilityArtName,
  normalizeCapabilityArtName,
} from '~/utils/capabilityArtCore'

const knownCapabilityNames = new Set(['Mountable X', 'Materializer', 'Aura Reader', 'X-Ray Vision'])
const hasArt = (name: string): boolean => knownCapabilityNames.has(name)

describe('capability art core helpers', () => {
  it('normalizes capability art aliases without requiring renderer state', () => {
    expect(normalizeCapabilityArtName('Mountable 4', hasArt)).toBe('Mountable X')
    expect(normalizeCapabilityArtName('Materialiser', hasArt)).toBe('Materializer')
    expect(normalizeCapabilityArtName('Aura  Reader', hasArt)).toBe('Aura Reader')
    expect(normalizeCapabilityArtName('Teleporter', hasArt)).toBe('Teleporter')
    expect(normalizeCapabilityArtName('  X-Ray Vision  ', hasArt)).toBe('X-Ray Vision')
  })

  it('builds deterministic fallback art and short labels', () => {
    const palette = {
      backgrounds: ['#111111', '#222222'],
      accents: ['#aaaaaa', '#bbbbbb'],
    } as const

    expect(capabilityArtInitials('X-Ray Vision')).toBe('XRV')
    expect(capabilityArtInitials('')).toBe('CAP')
    expect(hashCapabilityArtName('Mushroom Harvest')).toBe(hashCapabilityArtName('Mushroom Harvest'))
    expect(fallbackCapabilityArt('Mushroom Harvest', palette)).toEqual(fallbackCapabilityArt('Mushroom Harvest', palette))
    expect(fallbackCapabilityArt('Mushroom Harvest', palette).label).toBe('MH')
  })

  it('escapes SVG-visible text and centralizes size rules', () => {
    expect(escapeCapabilityArtXml('A&B <C> "D"')).toBe('A&amp;B &lt;C&gt; &quot;D&quot;')
    expect(CAPABILITY_ART_SIZE_PX).toEqual({ sm: 62, md: 84, lg: 116, hero: 210 })
  })

  it('preserves public capability art title and SVG integration', () => {
    expect(capabilityArtTitle('Mountable 4')).toBe('Mountable X capability art')

    const svg = capabilityArtSvg('Bad & <Cap>', 'sm')
    expect(svg).toContain('capability-art-svg--sm')
    expect(svg).toContain('width="62"')
    expect(svg).toContain('aria-label="Bad &amp; &lt;Cap&gt; capability art"')
    expect(svg).toContain('<title>Bad &amp; &lt;Cap&gt; capability art</title>')
  })
})
