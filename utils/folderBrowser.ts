export interface FolderBreadcrumb {
  label: string
  path: string
}

export interface FolderTile {
  path: string
  label: string
  count: number
}

export interface FolderMoveDestination {
  value: string
  label: string
}

export type FolderMoveTarget =
  | { type: 'item'; folder: string }
  | { type: 'folder'; path: string }

export interface FolderedItem {
  folder: string
}

export const normalizeSearchText = (value: string): string => value.trim().toLowerCase()

export const folderPathFromQuery = (value: unknown): string => {
  if (typeof value !== 'string') return ''
  return value.replace(/^\/+|\/+$/g, '')
}

export const isInsideFolder = (folder: string, currentPath: string): boolean => {
  if (!currentPath) return true
  return folder === currentPath || folder.startsWith(currentPath + '/')
}

export const isSameOrDescendantFolder = (path: string, parentPath: string): boolean => {
  if (!parentPath) return Boolean(path)
  return path === parentPath || path.startsWith(parentPath + '/')
}

export const parentFolderPath = (path: string): string => {
  const slash = path.lastIndexOf('/')
  return slash >= 0 ? path.slice(0, slash) : ''
}

export const renameFolderPrefix = (path: string, from: string, to: string): string => {
  if (path === from) return to
  if (path.startsWith(from + '/')) return to + path.slice(from.length)
  return path
}

export const childFolderPaths = (
  folderPaths: Iterable<string>,
  currentPath: string,
): string[] => {
  const prefix = currentPath ? currentPath + '/' : ''
  const childPaths = new Set<string>()

  for (const path of folderPaths) {
    if (currentPath && !path.startsWith(prefix)) continue
    if (path === currentPath) continue

    const rest = currentPath ? path.slice(prefix.length) : path
    if (!rest) continue

    const slash = rest.indexOf('/')
    const childSeg = slash >= 0 ? rest.slice(0, slash) : rest
    childPaths.add(currentPath ? `${currentPath}/${childSeg}` : childSeg)
  }

  return Array.from(childPaths).sort((a, b) => a.localeCompare(b))
}

export const buildFolderBreadcrumbs = (
  currentPath: string,
  options: {
    homeLabel?: string
    formatSegment?: (segment: string) => string
  } = {},
): FolderBreadcrumb[] => {
  const { homeLabel = 'Home', formatSegment = (segment: string) => segment } = options
  const out: FolderBreadcrumb[] = [{ label: homeLabel, path: '' }]
  if (!currentPath) return out

  let acc = ''
  for (const seg of currentPath.split('/').filter(Boolean)) {
    acc = acc ? `${acc}/${seg}` : seg
    out.push({ label: formatSegment(seg), path: acc })
  }
  return out
}

export const buildVisibleFolderTiles = <T>(
  options: {
    folderPaths: Iterable<string>
    currentPath: string
    items: ReadonlyArray<T>
    folderOf?: (item: T) => string
    formatLabel?: (leaf: string) => string
  },
): FolderTile[] => {
  const {
    folderPaths,
    currentPath,
    items,
    folderOf = (item: T) => (item as FolderedItem).folder,
    formatLabel = (leaf: string) => leaf,
  } = options

  return childFolderPaths(folderPaths, currentPath).map((path) => {
    const subPrefix = path + '/'
    let count = 0
    for (const item of items) {
      const folder = folderOf(item)
      if (folder === path || folder.startsWith(subPrefix)) count++
    }
    const leaf = path.split('/').pop() ?? path
    return { path, label: formatLabel(leaf), count }
  })
}

export const nextAvailableFolderLeaf = (
  folderPaths: ReadonlySet<string> | Iterable<string>,
  currentPath: string,
  base = 'new_folder',
): string => {
  const folderSet = folderPaths instanceof Set ? folderPaths : new Set(folderPaths)
  const prefix = currentPath ? `${currentPath}/` : ''
  const exists = (name: string) => folderSet.has(prefix + name)
  if (!exists(base)) return base

  let n = 1
  while (exists(`${base}_${n}`)) n++
  return `${base}_${n}`
}

export const movedFolderPath = (sourcePath: string, targetPath: string): string => {
  const leaf = sourcePath.split('/').pop() ?? sourcePath
  return targetPath ? `${targetPath}/${leaf}` : leaf
}

export const canMoveFolderTo = (
  sourcePath: string,
  targetPath: string,
  existingFolders: ReadonlySet<string> | Iterable<string>,
): boolean => {
  if (sourcePath === targetPath) return false
  if (targetPath === sourcePath || targetPath.startsWith(sourcePath + '/')) return false

  const newPath = movedFolderPath(sourcePath, targetPath)
  if (newPath === sourcePath) return false

  const folderSet = existingFolders instanceof Set ? existingFolders : new Set(existingFolders)
  if (folderSet.has(newPath)) return false
  return true
}

export const folderMoveDestinationPaths = (
  folderPaths: Iterable<string>,
  target: FolderMoveTarget,
): string[] => {
  const candidates = ['', ...Array.from(folderPaths).sort((a, b) => a.localeCompare(b))]
  return candidates.filter((path) => {
    if (target.type === 'item') return path !== target.folder

    const selfPath = target.path
    if (path === selfPath) return false
    if (path.startsWith(selfPath + '/')) return false
    if (path === parentFolderPath(selfPath)) return false
    return true
  })
}

export const buildFolderMoveDestinations = (
  options: {
    folderPaths: Iterable<string>
    target: FolderMoveTarget
    rootLabel?: string
    formatLabel?: (path: string) => string
  },
): FolderMoveDestination[] => {
  const {
    folderPaths,
    target,
    rootLabel = 'Home (root)',
    formatLabel = (path: string) => path,
  } = options

  return folderMoveDestinationPaths(folderPaths, target).map((path) => ({
    value: path,
    label: path ? formatLabel(path) : rootLabel,
  }))
}
