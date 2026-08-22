<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { PhCheckCircle, PhFlask, PhWarning } from '@phosphor-icons/vue'
import { CONTEST_EFFECT_IDS, CONTEST_STAT_IDS, type ContestEffectId, type ContestStatId } from '#shared/contests/ids'
import type { ContestPreparationCommandV1, ContestPreparationResultV1 } from '#shared/contests/preparationOperations'
import type { CharacterSheet } from '~/types/characterSheet'
import type { InventoryEntry, TrainerSheet } from '~/types/trainerSheet'

const props = defineProps<{ trainerSheets: readonly TrainerSheet[], pokemonSheets: readonly CharacterSheet[], profileId?: string | null }>()
const { isGm } = useAuth()
const emit = defineEmits<{ accepted: [result: ContestPreparationResultV1] }>()
const form = reactive({ kind: 'consume-poffin' as ContestPreparationCommandV1['commandKind'], trainerSlug: '', pokemonSlug: '', statId: 'cute' as ContestStatId, source: '', fromStatId: 'cute' as ContestStatId, toStatId: 'cool' as ContestStatId, dice: 1 as 1|2, berryName: '', contestItemId: 'Contest Accessory' as 'Fancy Clothes'|'Contest Accessory'|'Contest Fashion', createdMoveName: '', createdMoveEffectId: 'excitement' as ContestEffectId, createdMoveSourceFeatureId: 'Innovation' as 'Innovation'|'Passing Waltz'|'Beguiling Dance' })
const root = ref<HTMLElement | null>(null)
const busy = ref(false)
const error = ref('')
const notice = ref('')
const uncertainCommand = ref<ContestPreparationCommandV1 | null>(null)
const trainer = computed(() => props.trainerSheets.find(row => row.slug === form.trainerSlug) ?? null)
const pokemon = computed(() => props.pokemonSheets.find(row => row.slug === form.pokemonSlug) ?? null)
const poffinRows = computed(() => {
  const rows: Array<{ section: 'foodStuff'|'pokemonItems', row: InventoryEntry }> = []
  for (const section of ['foodStuff','pokemonItems'] as const) for (const row of trainer.value?.inventory?.[section] ?? []) if (row.name === 'Poffin' && (row.qty ?? 0) > 0 && row.id) rows.push({ section, row })
  return rows
})
const berryNames = computed(() => [...new Set(Object.values(trainer.value?.inventory ?? {}).flat().filter((row): row is InventoryEntry => Boolean(row && /berry$/i.test(row.name) && (row.qty ?? 0) > 0)).map(row => row.name))].sort())
const selectedPoffin = computed(() => poffinRows.value.find(entry => `${entry.section}:${entry.row.id}` === form.source) ?? null)
const operationId = (): string => `contest-op:v1:${crypto.randomUUID()}`
const errorMessage = (reason: unknown): string => {
  const row = reason as { data?: { statusMessage?: string, message?: string }, message?: string }
  return row?.data?.statusMessage ?? row?.data?.message ?? row?.message ?? 'Preparation authority rejected the action.'
}
const send = async (command: ContestPreparationCommandV1): Promise<void> => {
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const response = await $fetch<{ ok: true, result: ContestPreparationResultV1 }>('/api/contests/preparation', { method: 'POST', body: { ...command, ...(props.profileId ? { profileId: props.profileId } : {}) } })
    uncertainCommand.value = null; notice.value = response.result.exactRetry ? `Recovered: ${response.result.message}` : response.result.message; emit('accepted', response.result)
  } catch (reason) {
    const row = reason as { statusCode?: number, status?: number, response?: { status?: number } }
    const status = row?.statusCode ?? row?.status ?? row?.response?.status ?? 0
    uncertainCommand.value = status >= 400 && status < 500 ? null : command
    error.value = `${errorMessage(reason)}${uncertainCommand.value ? ' The outcome is uncertain; retry this exact operation.' : ''}`
  } finally { busy.value = false }
}
const submit = async (): Promise<void> => {
  if (uncertainCommand.value) { error.value = 'Resolve the uncertain preparation operation before starting another.'; return }
  if (!trainer.value) return
  busy.value = true; error.value = ''; notice.value = ''
  const base = { schemaVersion: 1 as const, operationId: operationId(), trainerSheetSlug: trainer.value.slug, trainerRevision: trainer.value.revision ?? 0 }
  let command: ContestPreparationCommandV1
  if (form.kind === 'craft-poffins') command = { ...base, commandKind: 'craft-poffins', statId: form.statId, reviewedBerryItemIds: [form.berryName] }
  else if (form.kind === 'craft-contest-item') command = { ...base, commandKind: 'craft-contest-item', itemId: form.contestItemId }
  else {
    if (!pokemon.value) { busy.value = false; error.value = 'Choose a Pokémon sheet.'; return }
    const pair = { ...base, pokemonSheetSlug: pokemon.value.slug, pokemonRevision: pokemon.value.revision ?? 0 }
    if (form.kind === 'consume-poffin') {
      if (!selectedPoffin.value) { busy.value = false; error.value = 'Choose an available canonical Poffin stack.'; return }
      command = { ...pair, commandKind: 'consume-poffin', sourceSection: selectedPoffin.value.section, sourceRowId: selectedPoffin.value.row.id!, statId: form.statId }
    } else if (form.kind === 'record-grooming') command = { ...pair, commandKind: 'record-grooming' }
    else if (form.kind === 'bind-created-move') command = { ...pair, commandKind: 'bind-created-move', moveName: form.createdMoveName, typeId: form.statId, effectId: form.createdMoveSourceFeatureId === 'Passing Waltz' ? 'get-ready' : form.createdMoveSourceFeatureId === 'Beguiling Dance' ? 'excitement' : form.createdMoveEffectId, sourceFeatureId: form.createdMoveSourceFeatureId }
    else command = { ...pair, commandKind: 'flexible-preparations', fromStatId: form.fromStatId, toStatId: form.toStatId, dice: form.dice }
  }
  busy.value = false
  await send(command)
}
const retryUncertain = async (): Promise<void> => { if (uncertainCommand.value) await send(uncertainCommand.value) }
watch(error, async (message) => { if (message) { await nextTick(); root.value?.querySelector<HTMLElement>('.prep-retry, select:not(:disabled), input:not(:disabled), button:not(:disabled)')?.focus() } })
watch(trainer, () => { form.source = ''; form.berryName = '' })
watch(selectedPoffin, (entry) => { if (entry?.row.contestPoffinStatId) form.statId = entry.row.contestPoffinStatId })
</script>

<template>
  <section ref="root" class="preparation-workbench" aria-labelledby="preparation-workbench-title">
    <div class="workbench-heading"><PhFlask :size="26" weight="duotone" aria-hidden="true" /><div><p>Before enrollment</p><h3 id="preparation-workbench-title">Contest preparation</h3></div></div>
    <p>Consume Poffins, record Groomer care, reallocate prepared dice, craft two Poffins with a reviewed berry and Poffin Mixer, make a Contest Trends item, or let the GM bind reviewed Contest identity to a Feature-created Move. Every accepted action updates ordinary sheets atomically.</p>
    <p v-if="error" class="prep-message prep-message--error" role="alert"><PhWarning :size="18" />{{ error }}<button v-if="uncertainCommand" type="button" class="prep-retry" @click="retryUncertain">Retry exact operation</button></p>
    <p v-if="notice" class="prep-message prep-message--accepted" role="status"><PhCheckCircle :size="18" />{{ notice }}</p>
    <form @submit.prevent="submit">
      <label><span>Action</span><select v-model="form.kind"><option value="consume-poffin">Consume Poffin</option><option value="record-grooming">Record Groomer care</option><option value="flexible-preparations">Flexible Preparations</option><option value="craft-poffins">Craft Poffins</option><option value="craft-contest-item">Craft Contest Trends item</option><option v-if="isGm" value="bind-created-move">Bind a created Move</option></select></label>
      <label><span>Trainer</span><select v-model="form.trainerSlug" required><option value="">Choose a Trainer</option><option v-for="row in trainerSheets" :key="row.slug" :value="row.slug">{{ row.name || row.slug }}</option></select></label>
      <label v-if="!['craft-poffins','craft-contest-item'].includes(form.kind)"><span>Pokémon</span><select v-model="form.pokemonSlug" required><option value="">Choose a Pokémon</option><option v-for="row in pokemonSheets" :key="row.slug" :value="row.slug">{{ row.nickname || row.species || row.slug }}</option></select></label>
      <template v-if="form.kind === 'consume-poffin'"><label><span>Poffin source</span><select v-model="form.source" required><option value="">Choose an inventory stack</option><option v-for="entry in poffinRows" :key="`${entry.section}:${entry.row.id}`" :value="`${entry.section}:${entry.row.id}`">{{ entry.section }} · {{ entry.row.qty }} available · {{ entry.row.contestPoffinStatId ?? 'stat chosen on consumption' }}</option></select></label><label><span>Contest stat</span><select v-model="form.statId" :disabled="Boolean(selectedPoffin?.row.contestPoffinStatId)"><option v-for="stat in CONTEST_STAT_IDS" :key="stat" :value="stat">{{ stat }}</option></select></label></template>
      <template v-else-if="form.kind === 'flexible-preparations'"><label><span>Move dice from</span><select v-model="form.fromStatId"><option v-for="stat in CONTEST_STAT_IDS" :key="stat" :value="stat">{{ stat }}</option></select></label><label><span>Move dice to</span><select v-model="form.toStatId"><option v-for="stat in CONTEST_STAT_IDS" :key="stat" :value="stat" :disabled="stat === form.fromStatId">{{ stat }}</option></select></label><label><span>Dice</span><select v-model.number="form.dice"><option :value="1">1d6</option><option :value="2">2d6</option></select></label></template>
      <template v-else-if="form.kind === 'craft-poffins'"><label><span>Reviewed berry in inventory</span><select v-model="form.berryName" required><option value="">Choose a berry</option><option v-for="name in berryNames" :key="name" :value="name">{{ name }}</option></select></label><label><span>Desired Contest stat</span><select v-model="form.statId"><option v-for="stat in CONTEST_STAT_IDS" :key="stat" :value="stat">{{ stat }}</option></select></label></template><template v-else-if="form.kind === 'craft-contest-item'"><label><span>Contest Trends item</span><select v-model="form.contestItemId"><option value="Contest Accessory">Contest Accessory · $750</option><option value="Contest Fashion">Contest Fashion · $500</option><option value="Fancy Clothes">Fancy Clothes · $2500</option></select><small>Requires the Contest Trends Feature; equipment configuration remains in the ordinary inventory workflow.</small></label></template><template v-else-if="form.kind === 'bind-created-move'"><label><span>Created Move name</span><input v-model.trim="form.createdMoveName" required maxlength="160" /></label><label><span>Source Feature</span><select v-model="form.createdMoveSourceFeatureId"><option>Innovation</option><option>Passing Waltz</option><option>Beguiling Dance</option></select></label><label><span>Contest type</span><select v-model="form.statId"><option v-for="stat in CONTEST_STAT_IDS" :key="stat" :value="stat">{{ stat }}</option></select></label><label v-if="form.createdMoveSourceFeatureId === 'Innovation'"><span>Contest effect</span><select v-model="form.createdMoveEffectId"><option v-for="effect in CONTEST_EFFECT_IDS" :key="effect" :value="effect">{{ effect }}</option></select></label><p v-else class="bounded-note">{{ form.createdMoveSourceFeatureId === 'Passing Waltz' ? 'Dance Move effect: Get Ready!' : 'Beguiling Dance effect: Excitement' }}</p></template>
      <button class="prep-submit" :disabled="busy">{{ busy ? 'Awaiting authority…' : 'Apply preparation' }}</button>
    </form>
  </section>
</template>

<style scoped>
.preparation-workbench{margin-top:1.25rem;border-top:1px solid var(--rt-rule,var(--rule-soft));padding-top:1.15rem}.workbench-heading{display:flex;align-items:center;gap:.6rem}.workbench-heading>svg{color:var(--rt-focus,var(--info))}.workbench-heading p{margin:0;color:var(--rt-pending,var(--warn));font-size:.68rem;font-weight:900;letter-spacing:.1em;text-transform:uppercase}.workbench-heading h3{margin:.15rem 0 0;color:var(--rt-text-strong,var(--ink-bright));font:700 1.25rem var(--font-book)}.preparation-workbench>p{color:var(--rt-text-muted,var(--ink-muted));font-size:.78rem}.preparation-workbench form{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.7rem;align-items:end}.preparation-workbench label{display:grid;gap:.35rem;color:var(--rt-text-muted,var(--ink-muted));font-size:.72rem;font-weight:850}.preparation-workbench select,.preparation-workbench input{width:100%;min-height:44px;border:1px solid var(--rt-rule,var(--rule-soft));background:var(--rt-bg-canvas,var(--paper-inset));color:var(--rt-text-strong,var(--ink-bright));padding:.6rem}.prep-submit,.prep-retry{min-height:44px;border:1px solid var(--rt-focus,var(--info));background:transparent;color:var(--rt-text-strong,var(--ink-bright));font-weight:850;cursor:pointer}.prep-retry{margin-left:auto;padding:.5rem;border-color:currentColor}.prep-message{display:flex;align-items:center;gap:.4rem;padding:.6rem;border:1px solid}.prep-message--error{border-color:var(--rt-danger,var(--bad));color:var(--rt-danger,var(--bad))!important}.prep-message--accepted{border-color:var(--rt-success,var(--good));color:var(--rt-success,var(--good))!important}button:focus-visible,select:focus-visible,input:focus-visible{outline:3px solid var(--rt-focus,#59d8ff);outline-offset:3px}@media(max-width:700px){.preparation-workbench form{grid-template-columns:1fr}}
</style>
