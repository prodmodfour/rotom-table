/**
 * Folder helpers for the sheets index.
 *
 * Pokémon sheets live under ``data/sheets/**\/*.json`` and trainer sheets
 * under ``data/trainers/**\/*.json``. Authors organise them by dropping
 * files into subdirectories — that path becomes the *folder* shown on the
 * index page. No JSON edit is required, but a sheet may set ``folder``
 * explicitly to override the auto-derived label.
 *
 * Keep this module side-effect-free so it can be imported from both the
 * data-glob loaders and the index page.
 */

/**
 * Strip a leading ``./<root>/`` prefix from a glob key and return the
 * directory portion that remains. ``root`` is e.g. ``"sheets"`` or
 * ``"trainers"``.
 *
 *   ``./sheets/bolt-pikachu.json``                     → ``""``
 *   ``./sheets/team-alpha/specs-chikorita.json``       → ``"team-alpha"``
 *   ``./sheets/npcs/wild/oddish.json``                 → ``"npcs/wild"``
 */
export const folderFromGlobKey = (key: string, root: string): string => {
  const prefix = `./${root}/`
  if (!key.startsWith(prefix)) return ''
  const rest = key.slice(prefix.length)
  const lastSlash = rest.lastIndexOf('/')
  if (lastSlash === -1) return ''
  return rest.slice(0, lastSlash)
}

/**
 * Pretty-print a folder path for display. Splits on ``/`` then on
 * ``-`` / ``_`` / whitespace, Title-Cases each word, and rejoins with
 * `` / ``.
 *
 *   ``"team-alpha"``    → ``"Team Alpha"``
 *   ``"npcs/wild_two"`` → ``"Npcs / Wild Two"``  (then aliased)
 *
 * Common abbreviations are upper-cased (NPC, GM, PC) so that
 * ``"npcs"`` reads as ``"NPCs"``.
 */
const ABBREVIATIONS: Record<string, string> = {
  npc:  'NPC',
  npcs: 'NPCs',
  gm:   'GM',
  gms:  'GMs',
  pc:   'PC',
  pcs:  'PCs',
  tm:   'TM',
  hm:   'HM',
}

const titleCaseWord = (word: string): string => {
  if (!word) return ''
  const lower = word.toLowerCase()
  if (lower in ABBREVIATIONS) return ABBREVIATIONS[lower]
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
}

export const formatFolderLabel = (path: string): string => {
  if (!path) return ''
  return path
    .split('/')
    .map((segment) =>
      segment
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map(titleCaseWord)
        .join(' '),
    )
    .join(' / ')
}

export interface FolderGroup<T> {
  /** Raw folder path, e.g. ``"team-alpha"`` or ``""`` for root files. */
  path: string
  /** Display label, e.g. ``"Team Alpha"`` or ``"Default"``. */
  label: string
  items: T[]
}

const ROOT_LABEL = 'Default'

/**
 * Group items by their ``folder`` field. The empty / undefined folder is
 * surfaced first as ``"Default"`` so unfoldered sheets remain visible
 * without surprising relocation.
 */
export const groupByFolder = <T extends { folder?: string }>(
  items: ReadonlyArray<T>,
): FolderGroup<T>[] => {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const path = item.folder ?? ''
    const list = map.get(path)
    if (list) list.push(item)
    else map.set(path, [item])
  }

  const entries = Array.from(map.entries()).sort(([a], [b]) => {
    if (a === b) return 0
    if (a === '') return -1 // root group always first
    if (b === '') return 1
    return a.localeCompare(b)
  })

  return entries.map(([path, list]) => ({
    path,
    label: path ? formatFolderLabel(path) : ROOT_LABEL,
    items: list,
  }))
}
