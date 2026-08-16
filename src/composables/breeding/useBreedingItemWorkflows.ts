import { computed, onMounted, onUnmounted, ref, shallowRef, toValue, watch, type MaybeRefOrGetter } from 'vue'
import {
  parseItemBreedingOperationResult,
  parseItemBreedingSourcePreview,
  parseItemBreedingWorkflowProjection,
  type ItemBreedingOperationCommandV1,
  type ItemBreedingOperationResultV1,
  type ItemBreedingSourcePreviewV1,
  type ItemBreedingWorkflowProjectionV1,
} from '#shared/breeding/itemWorkflows'
import { isRealtimeEcho, sheetChannel } from '#shared/realtime'
import { subscribeChannel, type RealtimeEvent } from '~/composables/useRealtime'
import { useApiClient } from '~/composables/useApiClient'
import { BREEDING_API_PATHS } from '~/utils/apiRoutes'
import { getClientId } from '~/utils/clientId'
import { getErrorMessage } from '~/utils/errorMessages'
import {
  clearPendingItemBreedingOperation,
  createItemBreedingOperationId,
  loadPendingItemBreedingOperation,
  retainPendingItemBreedingOperation,
} from '~/utils/itemBreedingOperationStorage'

export type BreedingItemWorkflowStatus = 'idle' | 'loading' | 'previewing' | 'submitting' | 'accepted' | 'conflict' | 'uncertain' | 'error'
interface FossilDraft {
  readonly kind: 'fossil'
  readonly operationId: string
  readonly fossilSourceOptionId: string
  readonly machineOptionId: string
  readonly speciesOptionId: string
}
interface ArtificialDraft {
  readonly kind: 'artificial'
  readonly operationId: string
  readonly chemistryOptionId: string
}
type SourceDraft = FossilDraft | ArtificialDraft
export interface UseBreedingItemWorkflowsOptions {
  readonly trainerSheetSlug: MaybeRefOrGetter<string | null>
  readonly profileId: MaybeRefOrGetter<string | null>
}
const errorStatusCode = (error: unknown): number | null => {
  if (!error || typeof error !== 'object') return null
  const row = error as Record<string, unknown>
  for (const value of [row.statusCode, row.status, (row.response as Record<string, unknown> | undefined)?.status]) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

export const useBreedingItemWorkflows = (options: UseBreedingItemWorkflowsOptions) => {
  const { getJson, postJson } = useApiClient()
  const projection = shallowRef<ItemBreedingWorkflowProjectionV1 | null>(null)
  const preview = shallowRef<ItemBreedingSourcePreviewV1 | null>(null)
  const sourceDraft = shallowRef<SourceDraft | null>(null)
  const status = ref<BreedingItemWorkflowStatus>('idle')
  const message = ref<string | null>(null)
  const lastResult = shallowRef<ItemBreedingOperationResultV1 | null>(null)
  const lastCommand = shallowRef<ItemBreedingOperationCommandV1 | null>(null)
  let loadSequence = 0
  let unsubscribe: (() => void) | null = null
  let subscribedSlug: string | null = null

  const trainerSheetSlug = computed(() => toValue(options.trainerSheetSlug))
  const profileId = computed(() => toValue(options.profileId))
  const busy = computed(() => ['loading','previewing','submitting'].includes(status.value))
  const uncertain = computed(() => status.value === 'uncertain')
  const params = () => ({ ...(profileId.value ? { profileId: profileId.value } : {}) })

  const reconcilePending = (): void => {
    const slug = trainerSheetSlug.value
    if (!slug) return
    const pending = loadPendingItemBreedingOperation(slug)
    if (!pending) return
    status.value = 'uncertain'
    if (pending.profileId !== profileId.value) {
      lastCommand.value = null
      message.value = 'A breeding item result remains uncertain for another Profile. Switch back to that Profile before continuing.'
      return
    }
    lastCommand.value = pending.command
    message.value = 'The breeding item result is uncertain. Retry this exact command before starting another item workflow.'
  }
  const load = async (): Promise<void> => {
    const slug = trainerSheetSlug.value
    if (!slug) { projection.value = null; return }
    const sequence = ++loadSequence
    if (!uncertain.value) status.value = 'loading'
    try {
      const parsed = parseItemBreedingWorkflowProjection(await getJson<unknown>(BREEDING_API_PATHS.items, {
        params: { trainerSheetSlug: slug, ...params() },
      }))
      if (sequence !== loadSequence || parsed.trainer.trainerSheetSlug !== slug) return
      projection.value = parsed
      if (!uncertain.value) { status.value = 'idle'; message.value = null }
      reconcilePending()
    }
    catch (error) {
      if (sequence !== loadSequence || uncertain.value) return
      status.value = errorStatusCode(error) === 409 ? 'conflict' : 'error'
      message.value = getErrorMessage(error)
    }
  }
  const post = (body: unknown) => postJson<unknown>(BREEDING_API_PATHS.items, body, { params: params() })
  const executeExact = async (command: ItemBreedingOperationCommandV1): Promise<ItemBreedingOperationResultV1 | null> => {
    lastCommand.value = command
    status.value = 'submitting'
    message.value = 'Waiting for authoritative breeding settlement…'
    try {
      const result = parseItemBreedingOperationResult(await post(command))
      if (result.operationId !== command.operationId || result.kind !== command.kind
        || result.trainerSheetSlug !== command.trainerSheetSlug) {
        throw new Error('Breeding item result does not match its exact command.')
      }
      clearPendingItemBreedingOperation(command.trainerSheetSlug, command.operationId)
      lastCommand.value = null
      lastResult.value = result
      preview.value = null
      sourceDraft.value = null
      status.value = result.status === 'accepted' ? 'accepted' : 'conflict'
      message.value = result.message
      await load()
      status.value = result.status === 'accepted' ? 'accepted' : 'conflict'
      message.value = result.message
      return result
    }
    catch (error) {
      const code = errorStatusCode(error)
      if (code !== null && code >= 400 && code < 500) {
        clearPendingItemBreedingOperation(command.trainerSheetSlug, command.operationId)
        lastCommand.value = null
        status.value = 'conflict'
        message.value = getErrorMessage(error)
      }
      else {
        status.value = 'uncertain'
        message.value = 'The breeding item result is uncertain. Retry this exact command; do not submit another workflow.'
      }
      return null
    }
  }
  const retainAndExecute = (command: ItemBreedingOperationCommandV1) => {
    retainPendingItemBreedingOperation({ schemaVersion: 1, trainerSheetSlug: command.trainerSheetSlug,
      profileId: profileId.value, command })
    return executeExact(command)
  }
  const saveWarmerAssignment = async (warmerUnitOptionId: string, eggOptionIds: readonly string[]): Promise<void> => {
    const current = projection.value
    if (!current || busy.value || uncertain.value) return
    await retainAndExecute({ schemaVersion:1,kind:'assign-egg-warmer',operationId:createItemBreedingOperationId(),
      trainerSheetSlug:current.trainer.trainerSheetSlug,expectedTrainerRevision:current.trainer.trainerRevision,
      warmerUnitOptionId,eggOptionIds:[...eggOptionIds].sort() })
  }
  const previewFossil = async (fossilSourceOptionId: string, machineOptionId: string, speciesOptionId: string): Promise<void> => {
    const current=projection.value
    if(!current||busy.value||uncertain.value)return
    const draft:FossilDraft={kind:'fossil',operationId:createItemBreedingOperationId(),fossilSourceOptionId,machineOptionId,speciesOptionId}
    status.value='previewing';message.value='Rebuilding current Fossil choices…'
    try{
      const result=parseItemBreedingSourcePreview(await post({schemaVersion:1,action:'preview-fossil',operationId:draft.operationId,
        trainerSheetSlug:current.trainer.trainerSheetSlug,expectedTrainerRevision:current.trainer.trainerRevision,
        fossilSourceOptionId,machineOptionId,speciesOptionId}))
      if(result.kind!=='fossil'||result.operationId!==draft.operationId
        ||result.trainerSheetSlug!==current.trainer.trainerSheetSlug
        ||result.expectedTrainerRevision!==current.trainer.trainerRevision)throw new Error('Breeding item preview does not match its exact request.')
      sourceDraft.value=draft;preview.value=result;status.value='idle';message.value=null
    }catch(error){status.value=errorStatusCode(error)===409?'conflict':'error';message.value=getErrorMessage(error)}
  }
  const previewArtificial = async (chemistryOptionId: string): Promise<void> => {
    const current=projection.value
    if(!current||busy.value||uncertain.value)return
    const draft:ArtificialDraft={kind:'artificial',operationId:createItemBreedingOperationId(),chemistryOptionId}
    status.value='previewing';message.value='Rebuilding current Playing God choices…'
    try{
      const result=parseItemBreedingSourcePreview(await post({schemaVersion:1,action:'preview-artificial',operationId:draft.operationId,
        trainerSheetSlug:current.trainer.trainerSheetSlug,expectedTrainerRevision:current.trainer.trainerRevision,chemistryOptionId}))
      if(result.kind!=='artificial'||result.operationId!==draft.operationId
        ||result.trainerSheetSlug!==current.trainer.trainerSheetSlug
        ||result.expectedTrainerRevision!==current.trainer.trainerRevision)throw new Error('Breeding item preview does not match its exact request.')
      sourceDraft.value=draft;preview.value=result;status.value='idle';message.value=null
    }catch(error){status.value=errorStatusCode(error)===409?'conflict':'error';message.value=getErrorMessage(error)}
  }
  const commitPreview = async (selectedOptionIds: readonly string[]): Promise<void> => {
    const current=projection.value;const draft=sourceDraft.value;const currentPreview=preview.value
    if(!current||!draft||!currentPreview||busy.value||uncertain.value||draft.operationId!==currentPreview.operationId)return
    if(current.trainer.trainerSheetSlug!==currentPreview.trainerSheetSlug
      ||current.trainer.trainerRevision!==currentPreview.expectedTrainerRevision){status.value='conflict';message.value='The breeding Trainer changed after this review. Rebuild the current choices.';preview.value=null;sourceDraft.value=null;return}
    const base={schemaVersion:1 as const,operationId:draft.operationId,trainerSheetSlug:currentPreview.trainerSheetSlug,
      expectedTrainerRevision:currentPreview.expectedTrainerRevision,selectedOptionIds:[...selectedOptionIds].sort()}
    await retainAndExecute(draft.kind==='fossil'?{...base,kind:'restore-fossil',fossilSourceOptionId:draft.fossilSourceOptionId,
      machineOptionId:draft.machineOptionId,speciesOptionId:draft.speciesOptionId}:{...base,kind:'create-artificial-egg',chemistryOptionId:draft.chemistryOptionId})
  }
  const cancelPreview=():void=>{if(busy.value||uncertain.value)return;preview.value=null;sourceDraft.value=null;status.value='idle';message.value=null}
  const retryExact=async():Promise<void>=>{const slug=trainerSheetSlug.value;if(!slug||busy.value)return;const stored=loadPendingItemBreedingOperation(slug)
    if(stored&&stored.profileId!==profileId.value){status.value='uncertain';message.value='Switch back to the Profile that submitted this uncertain breeding item command.';return}
    const command=lastCommand.value??stored?.command??null;if(!command){status.value='conflict';message.value='No exact breeding item command is available to retry.';return}await executeExact(command)}
  const dismiss=():void=>{if(busy.value||uncertain.value)return;status.value='idle';message.value=null;lastResult.value=null}
  const subscribe=():void=>{const slug=trainerSheetSlug.value;if(typeof window==='undefined'||!slug||subscribedSlug===slug)return
    unsubscribe?.();subscribedSlug=slug;unsubscribe=subscribeChannel(sheetChannel('trainer',slug),(event:RealtimeEvent)=>{if(isRealtimeEcho(event,getClientId()))return;if(event.type==='updated')void load()})}
  watch([trainerSheetSlug,profileId],([slug],[previousSlug])=>{if(slug!==previousSlug){projection.value=null;preview.value=null;sourceDraft.value=null;subscribe()}void load()})
  onMounted(()=>{subscribe();reconcilePending();void load()})
  onUnmounted(()=>unsubscribe?.())
  return {projection,preview,status,message,lastResult,lastCommand,busy,uncertain,load,saveWarmerAssignment,
    previewFossil,previewArtificial,commitPreview,cancelPreview,retryExact,dismiss}
}
