<script setup lang="ts">
import {
  PhArrowClockwise,
  PhCheckCircle,
  PhEgg,
  PhFlask,
  PhLockKey,
  PhThermometerHot,
  PhWarning,
  PhX,
} from '@phosphor-icons/vue'
import { computed, reactive, ref, watch } from 'vue'
import type {
  ItemBreedingSourcePreviewV1,
  ItemBreedingWorkflowProjectionV1,
} from '#shared/breeding/itemWorkflows'
import type { BreedingItemWorkflowStatus } from '~/composables/breeding/useBreedingItemWorkflows'

const props = defineProps<{
  projection: ItemBreedingWorkflowProjectionV1 | null
  preview: ItemBreedingSourcePreviewV1 | null
  status: BreedingItemWorkflowStatus
  message: string | null
}>()
const emit = defineEmits<{
  retry: []
  dismiss: []
  saveWarmer: [warmerUnitOptionId: string, eggOptionIds: readonly string[]]
  previewFossil: [sourceOptionId: string, machineOptionId: string, speciesOptionId: string]
  previewArtificial: [chemistryOptionId: string]
  commitPreview: [selectedOptionIds: readonly string[]]
  cancelPreview: []
}>()
const selectedWarmer = ref('')
const selectedEggs = ref<string[]>([])
const fossilSource = ref('')
const fossilMachine = ref('')
const fossilSpecies = ref('')
const chemistry = ref('')
const decisionSelections = reactive<Record<string, string>>({})
const busy = computed(() => ['loading','previewing','submitting'].includes(props.status))
const uncertain = computed(() => props.status === 'uncertain')
const currentWarmer = computed(() => props.projection?.eggWarmer.units.find(value => value.optionId === selectedWarmer.value) ?? null)
const warmerChanged = computed(() => {
  const current = [...(currentWarmer.value?.assignedEggOptionIds ?? [])].sort()
  const selected = [...selectedEggs.value].sort()
  return current.length !== selected.length || current.some((value, index) => value !== selected[index])
})
const canSaveWarmer = computed(() => Boolean(props.projection?.eggWarmer.availability.enabled
  && selectedWarmer.value && selectedEggs.value.length <= 4 && warmerChanged.value && !busy.value && !uncertain.value))
const previewReady = computed(() => Boolean(props.preview && props.preview.choices.every(choice => {
  const value = decisionSelections[choice.choiceId] ?? ''
  return choice.minimum === 0 ? true : Boolean(value)
})))
const selectedDecisionOptionIds = computed(() => props.preview?.choices.flatMap(choice => {
  const value = decisionSelections[choice.choiceId]
  return value ? [value] : []
}).sort() ?? [])

const syncProjection = (projection: ItemBreedingWorkflowProjectionV1 | null): void => {
  if (!projection) return
  if (!projection.eggWarmer.units.some(value => value.optionId === selectedWarmer.value)) {
    selectedWarmer.value = projection.eggWarmer.units[0]?.optionId ?? ''
  }
  const warmer = projection.eggWarmer.units.find(value => value.optionId === selectedWarmer.value)
  selectedEggs.value = [...(warmer?.assignedEggOptionIds ?? [])]
  if (!projection.fossil.sourceOptions.some(value => value.optionId === fossilSource.value)) fossilSource.value = projection.fossil.sourceOptions[0]?.optionId ?? ''
  if (!projection.fossil.machineOptions.some(value => value.optionId === fossilMachine.value)) fossilMachine.value = projection.fossil.machineOptions[0]?.optionId ?? ''
  if (!projection.fossil.speciesOptions.some(value => value.optionId === fossilSpecies.value)) fossilSpecies.value = projection.fossil.speciesOptions[0]?.optionId ?? ''
  if (!projection.artificial.chemistryOptions.some(value => value.optionId === chemistry.value)) chemistry.value = projection.artificial.chemistryOptions[0]?.optionId ?? ''
}
watch(() => props.projection, syncProjection, { immediate: true })
watch(selectedWarmer, (value) => {
  const warmer = props.projection?.eggWarmer.units.find(entry => entry.optionId === value)
  selectedEggs.value = [...(warmer?.assignedEggOptionIds ?? [])]
})
watch(() => props.preview, (preview) => {
  Object.keys(decisionSelections).forEach(key => delete decisionSelections[key])
  preview?.choices.forEach(choice => { decisionSelections[choice.choiceId] = '' })
})
const eggAssignedToOtherUnit = (optionId: string): boolean => Boolean(props.projection?.eggWarmer.units.some(unit => (
  unit.optionId !== selectedWarmer.value && unit.assignedEggOptionIds.includes(optionId)
)))
const toggleEgg = (optionId: string): void => {
  const selected = selectedEggs.value.includes(optionId)
  if (selected) selectedEggs.value = selectedEggs.value.filter(value => value !== optionId)
  else if (selectedEggs.value.length < 4) selectedEggs.value = [...selectedEggs.value, optionId].sort()
}
const launchFossil = (): void => {
  if (fossilSource.value && fossilMachine.value && fossilSpecies.value) emit('previewFossil', fossilSource.value, fossilMachine.value, fossilSpecies.value)
}
const submitDecision = (): void => {
  if (previewReady.value) emit('commitPreview', selectedDecisionOptionIds.value)
}
</script>

<template>
  <section class="breeding-items" aria-labelledby="breeding-items-title" :aria-busy="busy">
    <header class="breeding-items__header">
      <div>
        <p class="breeding-items__eyebrow">Inventory-backed lifecycle authority</p>
        <h2 id="breeding-items-title">Egg &amp; restoration tools</h2>
        <p>Assign reusable equipment or begin one source-Egg workflow. Current custody and requirements are rebuilt before settlement.</p>
      </div>
      <span v-if="projection" class="breeding-items__clock">Campaign minute {{ projection.generatedAtCampaignMinute }}</span>
    </header>

    <div v-if="status === 'loading' && !projection" class="breeding-items__state" role="status" aria-live="polite">
      <PhArrowClockwise :size="22" class="breeding-items__spinner" aria-hidden="true" />
      <p>Loading current item custody and Egg authority…</p>
    </div>

    <template v-else-if="projection">
      <div v-if="message" class="breeding-items__notice" :data-state="status" :role="status === 'error' || status === 'conflict' ? 'alert' : 'status'" aria-live="polite">
        <component :is="status === 'accepted' ? PhCheckCircle : PhWarning" :size="21" weight="duotone" aria-hidden="true" />
        <p>{{ message }}</p>
        <button v-if="uncertain" type="button" class="breeding-items__button breeding-items__button--commit" @click="emit('retry')">
          <PhArrowClockwise :size="18" weight="bold" aria-hidden="true" />
          Retry exact command
        </button>
        <button v-else type="button" class="breeding-items__icon-button" aria-label="Dismiss item workflow message" @click="emit('dismiss')">
          <PhX :size="18" aria-hidden="true" />
        </button>
      </div>

      <article class="breeding-tool breeding-tool--warmer" :class="{ 'breeding-tool--unavailable': !projection.eggWarmer.availability.enabled }">
        <header class="breeding-tool__header">
          <span class="breeding-tool__icon"><PhThermometerHot :size="24" weight="duotone" aria-hidden="true" /></span>
          <div>
            <p class="breeding-tool__kind">Reusable incubation equipment</p>
            <h3>Egg Warmer assignment</h3>
          </div>
          <span class="breeding-tool__status" :data-available="projection.eggWarmer.availability.enabled">
            {{ projection.eggWarmer.availability.enabled ? `${selectedEggs.length} / 4 assigned` : 'Unavailable' }}
          </span>
        </header>
        <p class="breeding-tool__summary">Holds up to four Eggs. Each campaign day counts as two hatch-rate days while exact custody remains current.</p>
        <p v-if="projection.eggWarmer.availability.unavailableReason" class="breeding-tool__requirement">
          <PhWarning :size="18" weight="fill" aria-hidden="true" />{{ projection.eggWarmer.availability.unavailableReason }}
        </p>
        <div class="breeding-tool__warmer-layout">
          <label class="breeding-items__field">
            <span>Exact Egg Warmer unit</span>
            <select v-model="selectedWarmer" :disabled="busy || uncertain || projection.eggWarmer.units.length === 0">
              <option v-if="projection.eggWarmer.units.length === 0" value="">No current unit</option>
              <option v-for="unit in projection.eggWarmer.units" :key="unit.optionId" :value="unit.optionId" :disabled="unit.disabled">{{ unit.label }}</option>
            </select>
          </label>
          <fieldset class="breeding-tool__egg-list" :disabled="busy || uncertain || !selectedWarmer">
            <legend>Current owned incubating Eggs</legend>
            <p v-if="projection.eggWarmer.eggs.length === 0" class="breeding-tool__empty">No assignable Eggs.</p>
            <label
              v-for="egg in projection.eggWarmer.eggs"
              :key="egg.optionId"
              class="breeding-tool__egg"
              :class="{ 'breeding-tool__egg--selected': selectedEggs.includes(egg.optionId), 'breeding-tool__egg--disabled': egg.disabled || eggAssignedToOtherUnit(egg.optionId) }"
            >
              <input
                type="checkbox"
                :checked="selectedEggs.includes(egg.optionId)"
                :disabled="egg.disabled || eggAssignedToOtherUnit(egg.optionId) || (!selectedEggs.includes(egg.optionId) && selectedEggs.length >= 4)"
                @change="toggleEgg(egg.optionId)"
              >
              <span class="breeding-tool__egg-copy"><strong>{{ egg.label }}</strong><small>{{ eggAssignedToOtherUnit(egg.optionId) ? 'Assigned to another Egg Warmer unit' : `${egg.accumulatedCampaignMinutes} / ${egg.targetCampaignMinutes} campaign minutes` }}</small></span>
              <span class="breeding-tool__egg-progress"><span :style="{ width: `${egg.percent}%` }" /></span>
              <span class="breeding-tool__egg-selection">{{ selectedEggs.includes(egg.optionId) ? 'Selected' : `${egg.percent}%` }}</span>
            </label>
          </fieldset>
        </div>
        <footer class="breeding-tool__footer">
          <p>Assignment is mechanically inert until this exact save is accepted.</p>
          <button type="button" class="breeding-items__button breeding-items__button--commit" :disabled="!canSaveWarmer" @click="emit('saveWarmer', selectedWarmer, selectedEggs)">
            <PhCheckCircle :size="19" weight="bold" aria-hidden="true" />Save assignment
          </button>
        </footer>
      </article>

      <div class="breeding-tool-grid">
        <article class="breeding-tool" :class="{ 'breeding-tool--unavailable': !projection.fossil.availability.enabled }">
          <header class="breeding-tool__header">
            <span class="breeding-tool__icon"><PhEgg :size="24" weight="duotone" aria-hidden="true" /></span>
            <div><p class="breeding-tool__kind">Source Egg</p><h3>Fossil restoration</h3></div>
          </header>
          <p class="breeding-tool__summary">Consumes one explicitly GM-designated Fossil source. The Reanimation Machine remains reusable.</p>
          <p v-if="projection.fossil.availability.unavailableReason" class="breeding-tool__requirement"><PhWarning :size="18" weight="fill" aria-hidden="true" />{{ projection.fossil.availability.unavailableReason }}</p>
          <div class="breeding-tool__fields">
            <label class="breeding-items__field"><span>Fossil source</span><select v-model="fossilSource" :disabled="busy || uncertain || !projection.fossil.availability.enabled"><option v-for="item in projection.fossil.sourceOptions" :key="item.optionId" :value="item.optionId">{{ item.label }}</option></select></label>
            <label class="breeding-items__field"><span>Reanimation Machine</span><select v-model="fossilMachine" :disabled="busy || uncertain || !projection.fossil.availability.enabled"><option v-for="item in projection.fossil.machineOptions" :key="item.optionId" :value="item.optionId">{{ item.label }}</option></select></label>
            <label class="breeding-items__field"><span>Restored Species</span><select v-model="fossilSpecies" :disabled="busy || uncertain || !projection.fossil.availability.enabled"><option v-for="item in projection.fossil.speciesOptions" :key="item.optionId" :value="item.optionId">{{ item.label }}</option></select></label>
          </div>
          <button type="button" class="breeding-items__button" :disabled="busy || uncertain || !projection.fossil.availability.enabled || !fossilSource || !fossilMachine || !fossilSpecies" @click="launchFossil">Review restoration</button>
        </article>

        <article class="breeding-tool" :class="{ 'breeding-tool--unavailable': !projection.artificial.availability.enabled }">
          <header class="breeding-tool__header">
            <span class="breeding-tool__icon"><PhFlask :size="24" weight="duotone" aria-hidden="true" /></span>
            <div><p class="breeding-tool__kind">Playing God</p><h3>Artificial Egg</h3></div>
            <PhLockKey v-if="!projection.artificial.availability.enabled" :size="20" weight="fill" class="breeding-tool__lock" aria-hidden="true" />
          </header>
          <p class="breeding-tool__summary">Requires Playing God, one Chemistry Set, and $3,500. The Chemistry Set remains reusable.</p>
          <p v-if="projection.artificial.availability.unavailableReason" class="breeding-tool__requirement"><PhWarning :size="18" weight="fill" aria-hidden="true" />{{ projection.artificial.availability.unavailableReason }}</p>
          <div class="breeding-tool__fields">
            <label class="breeding-items__field"><span>Chemistry Set</span><select v-model="chemistry" :disabled="busy || uncertain || !projection.artificial.availability.enabled"><option v-if="projection.artificial.chemistryOptions.length === 0" value="">No current unit</option><option v-for="item in projection.artificial.chemistryOptions" :key="item.optionId" :value="item.optionId">{{ item.label }}</option></select></label>
            <div class="breeding-tool__cost"><span>Creation cost</span><strong>$3,500</strong></div>
          </div>
          <button type="button" class="breeding-items__button" :disabled="busy || uncertain || !projection.artificial.availability.enabled || !chemistry" @click="emit('previewArtificial', chemistry)">
            <PhLockKey v-if="!projection.artificial.availability.enabled" :size="17" weight="fill" aria-hidden="true" />Review creation
          </button>
        </article>
      </div>

      <aside v-if="preview" class="breeding-decision" aria-labelledby="breeding-item-decision-title">
        <header>
          <div><p class="breeding-items__eyebrow">Current server-issued choices</p><h3 id="breeding-item-decision-title">{{ preview.title }}</h3></div>
          <button type="button" class="breeding-items__icon-button" aria-label="Close source Egg review" :disabled="busy || uncertain" @click="emit('cancelPreview')"><PhX :size="20" aria-hidden="true" /></button>
        </header>
        <ul class="breeding-decision__summary"><li v-for="line in preview.summary" :key="line">{{ line }}</li></ul>
        <div class="breeding-decision__choices">
          <label v-for="choice in preview.choices" :key="choice.choiceId" class="breeding-items__field">
            <span>{{ choice.label }} <small v-if="choice.minimum === 0">Optional</small></span>
            <select v-model="decisionSelections[choice.choiceId]" :required="choice.minimum > 0" :disabled="busy || uncertain">
              <option value="">{{ choice.minimum > 0 ? 'Choose one…' : 'No selection' }}</option>
              <option v-for="item in choice.options" :key="item.optionId" :value="item.optionId" :disabled="item.disabled">{{ item.label }}</option>
            </select>
          </label>
        </div>
        <footer><p>Choices are revalidated against the current Trainer, tool custody, and campaign checkpoint.</p><button type="button" class="breeding-items__button breeding-items__button--commit" :disabled="busy || uncertain || !previewReady" @click="submitDecision">Confirm &amp; create Egg</button></footer>
      </aside>
    </template>
  </section>
</template>

<style scoped>
.breeding-items{display:grid;gap:1rem}.breeding-items__header{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;padding:.25rem}.breeding-items__header h2,.breeding-tool h3,.breeding-decision h3{margin:0;color:var(--rt-text)}.breeding-items__header>div>p:last-child,.breeding-tool__summary{color:var(--rt-text-muted);margin:.45rem 0 0;max-width:70ch}.breeding-items__eyebrow,.breeding-tool__kind{margin:0 0 .2rem;color:var(--rt-focus);font-size:.75rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase}.breeding-items__clock{padding:.35rem .65rem;border:1px solid var(--rt-rule);border-radius:999px;color:var(--rt-text-muted);font-size:.78rem;white-space:nowrap}.breeding-tool,.breeding-decision,.breeding-items__state{border:1px solid var(--rt-rule);border-radius:var(--rt-radius-large);background:var(--rt-surface-1);box-shadow:var(--rt-elevation-1);padding:clamp(.9rem,2vw,1.25rem)}.breeding-tool--warmer{border-left:4px solid var(--rt-focus)}.breeding-tool--unavailable{border-color:color-mix(in srgb,var(--rt-pending) 48%,var(--rt-rule));background:color-mix(in srgb,var(--rt-pending) 5%,var(--rt-surface-1))}.breeding-tool__header{display:flex;align-items:center;gap:.7rem}.breeding-tool__header>div{flex:1}.breeding-tool__icon{display:grid;place-items:center;width:44px;height:44px;border-radius:10px;background:color-mix(in srgb,var(--rt-focus) 12%,var(--rt-surface-2));color:var(--rt-focus)}.breeding-tool__status{padding:.3rem .6rem;border-radius:999px;background:color-mix(in srgb,var(--rt-success) 13%,transparent);color:var(--rt-success);font-size:.78rem;font-weight:800}.breeding-tool__status[data-available="false"]{background:color-mix(in srgb,var(--rt-pending) 14%,transparent);color:var(--rt-pending)}.breeding-tool__lock{color:var(--rt-pending)}.breeding-tool__requirement{display:flex;gap:.45rem;align-items:flex-start;margin:.8rem 0 0;padding:.65rem .75rem;border-left:3px solid var(--rt-pending);background:color-mix(in srgb,var(--rt-pending) 8%,transparent);color:var(--rt-pending);font-size:.85rem;font-weight:700}.breeding-tool__warmer-layout{display:grid;grid-template-columns:minmax(13rem,.35fr) minmax(0,1fr);gap:1rem;margin-top:1rem}.breeding-items__field{display:grid;gap:.4rem;color:var(--rt-text-muted);font-size:.8rem;font-weight:750}.breeding-items__field>span{display:flex;justify-content:space-between;gap:.5rem}.breeding-items__field small{font-weight:600;color:var(--rt-pending)}.breeding-items__field select{width:100%;min-height:44px;border:1px solid var(--rt-rule);border-radius:8px;background:var(--rt-surface-2);color:var(--rt-text);padding:.55rem .7rem}.breeding-items__field select:focus-visible,.breeding-tool__egg:focus-within,.breeding-items__button:focus-visible,.breeding-items__icon-button:focus-visible{outline:2px solid var(--rt-focus);outline-offset:2px}.breeding-tool__egg-list{display:grid;gap:.5rem;min-width:0;margin:0;padding:0;border:0}.breeding-tool__egg-list legend{margin-bottom:.4rem;color:var(--rt-text-muted);font-size:.8rem;font-weight:750}.breeding-tool__egg{display:grid;grid-template-columns:auto minmax(9rem,1fr) minmax(5rem,.45fr) auto;align-items:center;gap:.65rem;min-height:58px;padding:.55rem .7rem;border:1px solid var(--rt-rule);border-radius:9px;background:var(--rt-surface-2);cursor:pointer}.breeding-tool__egg--selected{border-color:var(--rt-focus);background:color-mix(in srgb,var(--rt-focus) 7%,var(--rt-surface-2))}.breeding-tool__egg--disabled{opacity:.62}.breeding-tool__egg input{width:19px;height:19px;accent-color:var(--rt-focus)}.breeding-tool__egg-copy{display:grid}.breeding-tool__egg-copy small{color:var(--rt-text-muted)}.breeding-tool__egg-progress{height:6px;border-radius:999px;background:var(--rt-surface-3);overflow:hidden}.breeding-tool__egg-progress span{display:block;height:100%;background:var(--rt-focus)}.breeding-tool__egg-selection{min-width:4.5rem;text-align:right;color:var(--rt-focus);font-size:.78rem;font-weight:800}.breeding-tool__empty{margin:0;color:var(--rt-text-muted)}.breeding-tool__footer,.breeding-decision footer{display:flex;justify-content:space-between;align-items:center;gap:1rem;margin-top:1rem;padding-top:.85rem;border-top:1px solid var(--rt-rule)}.breeding-tool__footer p,.breeding-decision footer p{margin:0;color:var(--rt-text-muted);font-size:.8rem}.breeding-items__button{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;min-height:44px;padding:.6rem .9rem;border:1px solid var(--rt-focus);border-radius:8px;background:color-mix(in srgb,var(--rt-focus) 12%,var(--rt-surface-2));color:var(--rt-text);font-weight:800;cursor:pointer}.breeding-items__button--commit{border-color:var(--rt-brand);background:var(--rt-brand);color:var(--rt-on-brand)}.breeding-items__button:disabled{cursor:not-allowed;opacity:.42;filter:saturate(.45)}.breeding-items__icon-button{display:grid;place-items:center;width:44px;height:44px;border:1px solid var(--rt-rule);border-radius:8px;background:var(--rt-surface-2);color:var(--rt-text);cursor:pointer}.breeding-tool-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.breeding-tool-grid .breeding-tool{display:flex;flex-direction:column}.breeding-tool__fields{display:grid;gap:.7rem;margin:1rem 0}.breeding-tool-grid .breeding-items__button{margin-top:auto}.breeding-tool__cost{display:flex;align-items:center;justify-content:space-between;min-height:44px;padding:.55rem .7rem;border:1px solid var(--rt-rule);border-radius:8px;background:var(--rt-surface-2);color:var(--rt-text-muted);font-size:.8rem}.breeding-tool__cost strong{color:var(--rt-text);font-size:1rem}.breeding-decision{border-color:var(--rt-focus)}.breeding-decision>header{display:flex;justify-content:space-between;gap:1rem}.breeding-decision__summary{display:grid;gap:.3rem;margin:.75rem 0;color:var(--rt-text-muted)}.breeding-decision__choices{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem}.breeding-items__notice{display:flex;align-items:center;gap:.65rem;padding:.7rem .8rem;border:1px solid var(--rt-pending);border-radius:9px;background:color-mix(in srgb,var(--rt-pending) 8%,var(--rt-surface-1));color:var(--rt-pending)}.breeding-items__notice[data-state="accepted"]{border-color:var(--rt-success);background:color-mix(in srgb,var(--rt-success) 8%,var(--rt-surface-1));color:var(--rt-success)}.breeding-items__notice p{flex:1;margin:0}.breeding-items__state{display:flex;gap:.7rem;align-items:center;color:var(--rt-text-muted)}.breeding-items__state p{margin:0}.breeding-items__spinner{animation:breeding-item-spin .9s linear infinite}@keyframes breeding-item-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.breeding-items__spinner{animation:none}}@media(max-width:760px){.breeding-items__header,.breeding-tool__footer,.breeding-decision footer{align-items:stretch;flex-direction:column}.breeding-items__clock{align-self:flex-start}.breeding-tool__warmer-layout,.breeding-tool-grid,.breeding-decision__choices{grid-template-columns:1fr}.breeding-tool__egg{grid-template-columns:auto 1fr auto}.breeding-tool__egg-progress{grid-column:2/-1}.breeding-items__button{width:100%}}@media(max-width:430px){.breeding-tool__header{align-items:flex-start;flex-wrap:wrap}.breeding-tool__status{margin-left:52px}.breeding-tool__egg{padding:.5rem;gap:.45rem}.breeding-tool__egg-selection{min-width:0}.breeding-items__notice{align-items:flex-start;flex-wrap:wrap}}
</style>
