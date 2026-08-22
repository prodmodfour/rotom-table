import { isContestEffectId, isContestStatId, parseContestOperationId, type ContestStatId } from './ids'

export type ContestPreparationCommandV1 =
  | { readonly schemaVersion: 1, readonly commandKind: 'consume-poffin', readonly operationId: string, readonly trainerSheetSlug: string, readonly trainerRevision: number, readonly pokemonSheetSlug: string, readonly pokemonRevision: number, readonly sourceSection: 'foodStuff'|'pokemonItems', readonly sourceRowId: string, readonly statId: ContestStatId }
  | { readonly schemaVersion: 1, readonly commandKind: 'record-grooming', readonly operationId: string, readonly trainerSheetSlug: string, readonly trainerRevision: number, readonly pokemonSheetSlug: string, readonly pokemonRevision: number }
  | { readonly schemaVersion: 1, readonly commandKind: 'flexible-preparations', readonly operationId: string, readonly trainerSheetSlug: string, readonly trainerRevision: number, readonly pokemonSheetSlug: string, readonly pokemonRevision: number, readonly fromStatId: ContestStatId, readonly toStatId: ContestStatId, readonly dice: 1|2 }
  | { readonly schemaVersion: 1, readonly commandKind: 'craft-poffins', readonly operationId: string, readonly trainerSheetSlug: string, readonly trainerRevision: number, readonly statId: ContestStatId, readonly reviewedBerryItemIds: readonly string[] }
  | { readonly schemaVersion: 1, readonly commandKind: 'craft-contest-item', readonly operationId: string, readonly trainerSheetSlug: string, readonly trainerRevision: number, readonly itemId: 'Fancy Clothes'|'Contest Accessory'|'Contest Fashion' }
  | { readonly schemaVersion: 1, readonly commandKind: 'bind-created-move', readonly operationId: string, readonly trainerSheetSlug: string, readonly trainerRevision: number, readonly pokemonSheetSlug: string, readonly pokemonRevision: number, readonly moveName: string, readonly typeId: ContestStatId, readonly effectId: string, readonly sourceFeatureId: 'Innovation'|'Passing Waltz'|'Beguiling Dance' }

export interface ContestPreparationResultV1 {
  readonly schemaVersion: 1
  readonly operationId: string
  readonly commandKind: ContestPreparationCommandV1['commandKind']
  readonly exactRetry: boolean
  readonly trainerRevision: number
  readonly pokemonRevision: number | null
  readonly message: string
}
const slug = (value: unknown, field: string): string => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,119}$/u.test(value) ? value : (() => { throw new Error(`${field} is invalid`) })()
const revision = (value: unknown, field: string): number => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : (() => { throw new Error(`${field} is invalid`) })()
export const parseContestPreparationCommand = (value: unknown): ContestPreparationCommandV1 => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Contest preparation command must be an object.')
  const row = value as Record<string, unknown>
  if (row.schemaVersion !== 1 || !['consume-poffin','record-grooming','flexible-preparations','craft-poffins','craft-contest-item','bind-created-move'].includes(String(row.commandKind))) throw new Error('Contest preparation command version or kind is unsupported.')
  const fieldsByKind = {
    'consume-poffin': ['schemaVersion','commandKind','operationId','trainerSheetSlug','trainerRevision','pokemonSheetSlug','pokemonRevision','sourceSection','sourceRowId','statId'],
    'record-grooming': ['schemaVersion','commandKind','operationId','trainerSheetSlug','trainerRevision','pokemonSheetSlug','pokemonRevision'],
    'flexible-preparations': ['schemaVersion','commandKind','operationId','trainerSheetSlug','trainerRevision','pokemonSheetSlug','pokemonRevision','fromStatId','toStatId','dice'],
    'craft-poffins': ['schemaVersion','commandKind','operationId','trainerSheetSlug','trainerRevision','statId','reviewedBerryItemIds'],
    'craft-contest-item': ['schemaVersion','commandKind','operationId','trainerSheetSlug','trainerRevision','itemId'],
    'bind-created-move': ['schemaVersion','commandKind','operationId','trainerSheetSlug','trainerRevision','pokemonSheetSlug','pokemonRevision','moveName','typeId','effectId','sourceFeatureId'],
  } as const
  const fields = fieldsByKind[row.commandKind as keyof typeof fieldsByKind]
  if (Object.keys(row).length !== fields.length || fields.some(field => !Object.hasOwn(row, field))) throw new Error('Contest preparation command fields are invalid.')
  parseContestOperationId(row.operationId)
  slug(row.trainerSheetSlug, 'trainerSheetSlug'); revision(row.trainerRevision, 'trainerRevision')
  if (row.commandKind !== 'craft-poffins' && row.commandKind !== 'craft-contest-item') { slug(row.pokemonSheetSlug, 'pokemonSheetSlug'); revision(row.pokemonRevision, 'pokemonRevision') }
  if ('statId' in row && !isContestStatId(row.statId)) throw new Error('statId is invalid.')
  if (row.commandKind === 'consume-poffin') {
    if (row.sourceSection !== 'foodStuff' && row.sourceSection !== 'pokemonItems') throw new Error('sourceSection is invalid.')
    if (typeof row.sourceRowId !== 'string' || !row.sourceRowId || row.sourceRowId.length > 160) throw new Error('sourceRowId is invalid.')
  }
  if (row.commandKind === 'flexible-preparations') {
    if (!isContestStatId(row.fromStatId) || !isContestStatId(row.toStatId) || row.fromStatId === row.toStatId || (row.dice !== 1 && row.dice !== 2)) throw new Error('Flexible Preparations choices are invalid.')
  }
  if (row.commandKind === 'bind-created-move') {
    if (typeof row.moveName !== 'string' || row.moveName.trim() !== row.moveName || !row.moveName || row.moveName.length > 160) throw new Error('Created Move name is invalid.')
    if (!isContestStatId(row.typeId) || !isContestEffectId(row.effectId) || !['Innovation','Passing Waltz','Beguiling Dance'].includes(String(row.sourceFeatureId))) throw new Error('Created Move Contest identity is invalid.')
  }
  if (row.commandKind === 'craft-contest-item' && !['Fancy Clothes','Contest Accessory','Contest Fashion'].includes(String(row.itemId))) throw new Error('Contest Trends itemId is invalid.')
  if (row.commandKind === 'craft-poffins' && (!Array.isArray(row.reviewedBerryItemIds) || row.reviewedBerryItemIds.length !== 1 || row.reviewedBerryItemIds.some(id => typeof id !== 'string' || !id || id.length > 160) || new Set(row.reviewedBerryItemIds).size !== row.reviewedBerryItemIds.length)) throw new Error('Choose unique reviewed berry inputs.')
  return structuredClone(row) as unknown as ContestPreparationCommandV1
}
