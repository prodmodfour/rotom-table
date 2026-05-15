export const moveArrayItem = <T>(
  items: T[] | null | undefined,
  fromIndex: number | null | undefined,
  toIndex: number | null | undefined,
): void => {
  if (!items || fromIndex == null || toIndex == null) return
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return
  if (fromIndex === toIndex) return
  if (fromIndex < 0 || toIndex < 0) return
  if (fromIndex >= items.length || toIndex >= items.length) return

  const [item] = items.splice(fromIndex, 1)
  if (item === undefined) return
  items.splice(toIndex, 0, item)
}
