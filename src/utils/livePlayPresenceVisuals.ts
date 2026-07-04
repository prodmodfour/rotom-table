import type { LivePlayPresenceAccent } from '#shared/livePlayPresence'

export const LIVE_PLAY_PRESENCE_ACCENT_COLORS: Readonly<Record<LivePlayPresenceAccent, `#${string}`>> = {
  rose: '#fb7185',
  orange: '#fb923c',
  amber: '#f59e0b',
  lime: '#a3e635',
  green: '#22c55e',
  teal: '#14b8a6',
  cyan: '#22d3ee',
  blue: '#60a5fa',
  indigo: '#818cf8',
  violet: '#a78bfa',
  fuchsia: '#e879f9',
  slate: '#94a3b8',
}

export const livePlayPresenceAccentColor = (accent: LivePlayPresenceAccent): `#${string}` => (
  LIVE_PLAY_PRESENCE_ACCENT_COLORS[accent]
)
