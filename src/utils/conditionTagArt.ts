export type ConditionTagSize = 'xs' | 'sm' | 'md' | 'lg'

export interface ConditionTagDefinition {
  /** Short label rendered inside the badge. */
  label: string
  /** Badge background. */
  color: string
  /** Icon glyph family used by the inline SVG builder. */
  icon: string
}

export const CONDITION_TAGS: Record<string, ConditionTagDefinition> = {
  Burned:          { label: 'BRN',  color: '#fb4b0b', icon: 'flame' },
  Paralysis:       { label: 'PAR',  color: '#f2a408', icon: 'bolt' },
  Frozen:          { label: 'FRZ',  color: '#61cfd7', icon: 'snow' },
  Poisoned:        { label: 'PSN',  color: '#b64be8', icon: 'poison' },
  Sleep:           { label: 'SLP',  color: '#777777', icon: 'sleep' },

  'Badly Poisoned': { label: 'TOX',  color: '#8f3fb0', icon: 'toxic' },
  'Bad Sleep':      { label: 'BSLP', color: '#665c99', icon: 'bad-sleep' },
  Confused:         { label: 'CNF',  color: '#ffb84d', icon: 'confused' },
  Cursed:           { label: 'CRS',  color: '#6c3a9c', icon: 'curse' },
  Disabled:         { label: 'DIS',  color: '#8a8f98', icon: 'disabled' },
  Rage:             { label: 'RAG',  color: '#d7192c', icon: 'rage' },
  Flinch:           { label: 'FLN',  color: '#ff7a2f', icon: 'flinch' },
  Infatuation:      { label: 'INF',  color: '#d88cff', icon: 'heart' },
  Suppressed:       { label: 'SUP',  color: '#5c8dff', icon: 'suppress' },
  Fainted:          { label: 'FNT',  color: '#12151b', icon: 'faint' },
  Blindness:        { label: 'BLD',  color: '#56606b', icon: 'blind' },
  'Total Blindness': { label: 'TBLD', color: '#050608', icon: 'total-blind' },
  Slowed:           { label: 'SLO',  color: '#9fd36b', icon: 'slow' },
  Stuck:            { label: 'STK',  color: '#9a6b45', icon: 'stuck' },
  Trapped:          { label: 'TRP',  color: '#b56cff', icon: 'trap' },
  Tripped:          { label: 'TRIP', color: '#ff7a2f', icon: 'trip' },
  Vulnerable:       { label: 'VUL',  color: '#ff1f2d', icon: 'vulnerable' },
}

const FALLBACK_TAG: ConditionTagDefinition = { label: '???', color: '#66707a', icon: 'generic' }

export const conditionTagFallbackDefinition = (canonical: string): ConditionTagDefinition => {
  const label = canonical
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 4)
    .toUpperCase() || FALLBACK_TAG.label
  return { ...FALLBACK_TAG, label }
}

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const iconMarkup = (icon: string): string => {
  switch (icon) {
    case 'flame':
      return '<path d="M14.7 23.7C8.7 23.7 5 20 5 15.6c0-3.5 2.1-6.2 5.1-8.8.1 2.6 1.2 4 2.8 4.8 1.7-3.5.9-6.3-.5-9 4.8 2.1 8.7 6.2 8.7 11.7 0 5.8-3.9 9.4-6.4 9.4Z"/><path fill="rgba(255,255,255,.45)" d="M14.5 21.5c-2.8 0-4.5-1.8-4.5-4 0-1.9 1.1-3.3 2.5-4.7.2 1.5.9 2.4 2.1 2.9.9-1.8.8-3.3.2-5 2.7 1.5 4.5 3.7 4.5 6.3 0 2.7-1.9 4.5-4.8 4.5Z"/>'
    case 'bolt':
      return '<path d="M15.9 1.5 5.4 14.1h6.6L9.1 24.5l11.7-14.1h-6.9l2-8.9Z"/>'
    case 'snow':
      return '<g stroke="white" stroke-width="2.4" stroke-linecap="round"><path d="M13 2.5v21"/><path d="M4 7.8 22 18.2"/><path d="M22 7.8 4 18.2"/></g><g stroke="white" stroke-width="1.6" stroke-linecap="round"><path d="M9 4.8 13 8.4l4-3.6"/><path d="M9 21.2l4-3.6 4 3.6"/></g>'
    case 'poison':
      return '<circle cx="13" cy="10" r="7.5"/><rect x="7" y="17" width="12" height="5" rx="2"/><circle fill="rgba(182,75,232,.8)" cx="10.5" cy="10" r="2.1"/><circle fill="rgba(182,75,232,.8)" cx="15.5" cy="10" r="2.1"/><path fill="rgba(182,75,232,.8)" d="M11 15h4l-2 2.3z"/>'
    case 'sleep':
      return '<text x="6" y="10" font-size="9" font-family="Arial, sans-serif" font-weight="900">Z</text><text x="10" y="17" font-size="12" font-family="Arial, sans-serif" font-weight="900">Z</text><text x="15" y="25" font-size="15" font-family="Arial, sans-serif" font-weight="900">Z</text>'
    case 'toxic':
      return '<path d="M13 2.5c5 6 8 10 8 14.2 0 4.4-3.5 7.3-8 7.3s-8-2.9-8-7.3c0-4.2 3-8.2 8-14.2Z"/><path fill="rgba(143,63,176,.82)" d="M8.5 12.5h9v2.5h-9zM11.8 8.8h2.5v9.2h-2.5z"/>'
    case 'bad-sleep':
      return '<text x="4" y="11" font-size="9" font-family="Arial, sans-serif" font-weight="900">Z</text><text x="9" y="18" font-size="12" font-family="Arial, sans-serif" font-weight="900">Z</text><path d="M18.5 9c2.6 3.1 4.1 5.2 4.1 7.5 0 2.4-1.9 4.1-4.1 4.1s-4.1-1.7-4.1-4.1c0-2.3 1.5-4.4 4.1-7.5Z"/>'
    case 'confused':
      return '<path fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" d="M17.6 8.1c-3.5-3.3-9.7-.8-9.4 4 .3 4.5 6.5 5.1 8 2 1.3-2.6-1.9-4.8-4-3.1"/><circle cx="18.7" cy="20.8" r="2.1"/>'
    case 'curse':
      return '<path d="M15 2.5c-5.9 1-9.9 5.7-9.9 11.2 0 6 4.8 10.3 10.8 10.3 3.1 0 5.8-1.2 7.7-3.1-7.3.7-12.5-3.7-12.5-10.3 0-3.4 1.5-6.2 3.9-8.1Z"/><path fill="rgba(108,58,156,.8)" d="M18.8 6.3 20 9.6l3.4 1.2-3.4 1.1-1.2 3.4-1.1-3.4-3.4-1.1 3.4-1.2z"/>'
    case 'disabled':
      return '<rect x="5" y="7" width="16" height="13" rx="3"/><path fill="rgba(138,143,152,.82)" d="M8 11h10v2.5H8zM8 15.5h7v2.2H8z"/><path d="M5 22 23 4" stroke="white" stroke-width="2.8" stroke-linecap="round"/>'
    case 'rage':
      return '<path d="m13 2 2.7 7.2 7.6-1.3-4.9 5.9 4.9 5.9-7.6-1.3L13 25.5l-2.7-7.1-7.6 1.3 4.9-5.9-4.9-5.9 7.6 1.3Z"/><rect fill="rgba(204,36,29,.82)" x="11.6" y="7" width="2.8" height="9" rx="1.2"/><circle fill="rgba(204,36,29,.82)" cx="13" cy="20" r="1.6"/>'
    case 'flinch':
      return '<path d="m13 2.5 2.1 7.4 7.4-2.1-5.3 5.6 5.3 5.6-7.4-2.1-2.1 7.4-2.1-7.4-7.4 2.1 5.3-5.6-5.3-5.6 7.4 2.1Z"/>'
    case 'heart':
      return '<path d="M13 23.3 5.5 16C1.2 11.8 3.9 5.1 9.1 5.1c2.2 0 3.4 1.1 3.9 2.1.5-1 1.7-2.1 3.9-2.1 5.2 0 7.9 6.7 3.6 10.9Z"/>'
    case 'suppress':
      return '<rect x="5" y="6" width="16" height="12" rx="2.5"/><path d="M4 22 22 4" stroke="white" stroke-width="2.8" stroke-linecap="round"/><path fill="rgba(69,133,136,.8)" d="M8 10h10v3H8z"/>'
    case 'faint':
      return '<circle cx="13" cy="13" r="9"/><g stroke="rgba(60,56,54,.9)" stroke-width="2.3" stroke-linecap="round"><path d="m8.5 9.5 4 4M12.5 9.5l-4 4M14.5 9.5l4 4M18.5 9.5l-4 4"/></g><path fill="rgba(60,56,54,.9)" d="M9 18h8v2H9z"/>'
    case 'blind':
      return '<path d="M3.5 13.5s3.8-6 9.5-6 9.5 6 9.5 6-3.8 6-9.5 6-9.5-6-9.5-6Z"/><circle fill="rgba(102,92,84,.88)" cx="13" cy="13.5" r="3.2"/><path d="M4.5 23 22 4" stroke="white" stroke-width="2.5" stroke-linecap="round"/>'
    case 'total-blind':
      return '<path d="M3.5 13.5s3.8-6 9.5-6 9.5 6 9.5 6-3.8 6-9.5 6-9.5-6-9.5-6Z"/><g stroke="rgba(5,6,8,.9)" stroke-width="2.3" stroke-linecap="round"><path d="m8.5 9 9 9M17.5 9l-9 9"/></g>'
    case 'slow':
      return '<circle cx="13" cy="13" r="9"/><path fill="rgba(152,151,26,.82)" d="M12 7h2.5v7l5 2.7-1.2 2.1-6.3-3.5z"/>'
    case 'stuck':
      return '<path d="M13 3.5a5.2 5.2 0 0 1 5.2 5.2c0 4.3-5.2 12.8-5.2 12.8S7.8 13 7.8 8.7A5.2 5.2 0 0 1 13 3.5Z"/><circle fill="rgba(175,122,59,.82)" cx="13" cy="8.7" r="2.1"/><rect x="6" y="20" width="14" height="2.5" rx="1.2"/>'
    case 'trap':
      return '<g fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round"><rect x="5" y="5" width="16" height="16" rx="2"/><path d="M10 5v16M16 5v16M5 10h16M5 16h16"/></g>'
    case 'trip':
      return '<path d="M7 6h7l3 4h5v3h-7l-3-4H7z"/><path d="M6 18h15v3H6z"/><path d="m8 23 4-5 4 5z"/>'
    case 'vulnerable':
      return '<circle cx="13" cy="13" r="9" fill="none" stroke="white" stroke-width="2.4"/><circle cx="13" cy="13" r="4.5" fill="none" stroke="white" stroke-width="2.2"/><circle cx="13" cy="13" r="1.8"/><path d="M13 2v4M13 20v4M2 13h4M20 13h4" stroke="white" stroke-width="2" stroke-linecap="round"/>'
    default:
      return '<circle cx="13" cy="13" r="9"/><text x="13" y="18" text-anchor="middle" fill="rgba(124,111,100,.85)" font-size="14" font-family="Arial, sans-serif" font-weight="900">!</text>'
  }
}

const SIZE_SCALE: Record<ConditionTagSize, number> = {
  xs: 0.42,
  sm: 0.64,
  md: 1,
  lg: 1.18,
}

export const conditionTagSvgMarkup = (
  canonical: string,
  tag: ConditionTagDefinition,
  size: ConditionTagSize = 'md',
): string => {
  const label = escapeXml(tag.label)
  const title = escapeXml(canonical)
  const viewWidth = Math.max(92, 58 + tag.label.length * 18)
  const scale = SIZE_SCALE[size]
  const width = Math.round(viewWidth * scale)
  const height = Math.round(32 * scale)
  const fontSize = tag.label.length > 3 ? 16 : 18
  return `<svg class="condition-tag-svg condition-tag-svg--${size}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewWidth} 32" width="${width}" height="${height}" role="img" aria-label="${title}"><title>${title}</title><rect x="0" y="0" width="${viewWidth}" height="32" rx="4.8" fill="${escapeXml(tag.color)}"/><path d="M2 2h${viewWidth - 4}v6c-13 2.2-29 2.2-44 0C39 5.9 21 5.7 2 8Z" fill="rgba(255,255,255,.16)"/><g transform="translate(5 3)" fill="white">${iconMarkup(tag.icon)}</g><text x="46" y="22.7" fill="white" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="900" letter-spacing="1.2">${label}</text></svg>`
}
