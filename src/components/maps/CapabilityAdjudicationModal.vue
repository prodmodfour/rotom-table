<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { EncounterActionOffer } from '#shared/encounterPresentation/contracts'
import { items } from '~~/data/ptuReference'
import pokedexJson from '~~/data/reference/pokedex.json'
import { PTU_NATURE_OPTIONS } from '~/utils/ptuNatures'
import type { PokedexRecord } from '~/types/pokemon'

interface ParticipantChoice { readonly id: string; readonly label: string }
const props = defineProps<{ offer: EncounterActionOffer; participants: readonly ParticipantChoice[] }>()
const emit = defineEmits<{
  submit: [value: { decision: 'accept' | 'reject'; optionId: string | null; description: string | null }]
  cancel: []
}>()
const decision = ref<'accept' | 'reject'>('accept')
const optionId = ref('')
const description = ref('')
const error = ref('')
const auraHue = ref('blue')
const auraTone = ref<'brightened' | 'darkened' | 'neutral'>('neutral')
const alluringSpecies = ref('Pidgey')
const alluringLevel = ref(5)
const sprouterKind = ref<'growth' | 'berry-yield'>('growth')
const sprouterBerry = ref('Oran Berry')
const sprouterQuantity = ref(1)
const fortuneResult = ref<'returns' | 'runs-away'>('returns')
const zygardeCells = ref<10 | 50 | 100>(10)
const zygardeForm = ref<'10-percent' | '50-percent'>('10-percent')
const zygardeNature = ref('Hardy')
const zygardeLevel = ref(20)
const dreamMode = ref<'private-view' | 'dream-mist-image'>('private-view')
const dreamViewerIds = ref<string[]>([])
const telepathyAwareness = ref<'unaware' | 'aware'>('unaware')
const canonicalBerryChoices = items.filter(entry => /berry/i.test(entry.name))
const canonicalSpeciesChoices = (pokedexJson as PokedexRecord[])
  .map(entry => entry.species).sort((left, right) => left.localeCompare(right))

const optionKind = computed(() => {
  if (props.offer.source.canonicalId === 'Aura Reader') return 'aura'
  if (props.offer.source.canonicalId === 'Alluring') return 'alluring'
  if (props.offer.source.canonicalId === 'Sprouter') return 'sprouter'
  if (props.offer.source.canonicalId === 'Fortune') return 'fortune'
  if (props.offer.source.canonicalId === 'Zygarde Cells') return 'zygarde'
  if (props.offer.source.canonicalId === 'Dream Reader') return 'dream'
  if (props.offer.source.canonicalId === 'Telepath') return 'telepath'
  return null
})
const requiresOption = computed(() => optionKind.value !== null)
const retainedOption = (): string | null => {
  if (optionKind.value === 'aura') return `hue:${auraHue.value.trim()};tone:${auraTone.value}`
  if (optionKind.value === 'alluring') return `species:${alluringSpecies.value.trim()};level:${alluringLevel.value}`
  if (optionKind.value === 'sprouter') return sprouterKind.value === 'growth'
    ? 'growth' : `berry-yield:item:${sprouterBerry.value.trim()};qty:${sprouterQuantity.value}`
  if (optionKind.value === 'fortune') return fortuneResult.value
  if (optionKind.value === 'zygarde') return `cells:${zygardeCells.value};form:${zygardeForm.value};nature:${zygardeNature.value.trim()};level:${zygardeLevel.value}`
  if (optionKind.value === 'dream') {
    return dreamMode.value === 'private-view' ? 'private-view' : `dream-mist-image:viewers:${dreamViewerIds.value.join(',')}`
  }
  if (optionKind.value === 'telepath') return telepathyAwareness.value
  return optionId.value.trim() || null
}

watch(() => props.offer.offerId, () => {
  decision.value = 'accept'
  optionId.value = ''
  description.value = ''
  auraHue.value = 'blue'
  auraTone.value = 'neutral'
  alluringSpecies.value = 'Pidgey'
  alluringLevel.value = 5
  sprouterKind.value = 'growth'
  sprouterBerry.value = 'Oran Berry'
  sprouterQuantity.value = 1
  fortuneResult.value = 'returns'
  zygardeCells.value = 10
  zygardeForm.value = '10-percent'
  zygardeNature.value = 'Hardy'
  zygardeLevel.value = 20
  dreamMode.value = 'private-view'
  dreamViewerIds.value = []
  telepathyAwareness.value = 'unaware'
  error.value = ''
}, { immediate: true })

const submit = (): void => {
  error.value = ''
  if (decision.value === 'accept' && !description.value.trim()) {
    error.value = 'An accepted adjudication requires a bounded retained result.'
    return
  }
  const option = retainedOption()
  if (decision.value === 'accept' && requiresOption.value && !option) {
    error.value = 'This adjudication requires its reviewed option identity.'
    return
  }
  if (decision.value === 'accept' && optionKind.value === 'dream' && dreamMode.value === 'dream-mist-image') {
    const viewers = dreamViewerIds.value
    if (!viewers.length || viewers.length > 16 || new Set(viewers).size !== viewers.length) {
      error.value = 'Select 1–16 unique authoritative Dream Mist viewers.'
      return
    }
  }
  if (decision.value === 'accept' && optionKind.value === 'alluring'
    && (!alluringSpecies.value.trim() || alluringLevel.value < 1 || alluringLevel.value > 100)) {
    error.value = 'Enter a canonical species and Level 1–100.'
    return
  }
  if (decision.value === 'accept' && optionKind.value === 'zygarde'
    && (!zygardeNature.value.trim() || zygardeLevel.value < 1 || zygardeLevel.value > 100
      || (zygardeCells.value === 10 && zygardeForm.value !== '10-percent'))) {
    error.value = 'Enter a legal Cell count, Forme, Nature, and Level 1–100.'
    return
  }
  emit('submit', {
    decision: decision.value,
    optionId: decision.value === 'accept' ? option : null,
    description: decision.value === 'accept' ? description.value.trim() : null,
  })
}
</script>

<template>
  <div class="adjudication-backdrop" role="presentation" @click.self="emit('cancel')">
    <section class="adjudication-modal" role="dialog" aria-modal="true" :aria-labelledby="`adjudication-title-${offer.offerId}`">
      <header>
        <div>
          <p>Bounded GM adjudication · {{ offer.source.displayName }}</p>
          <h2 :id="`adjudication-title-${offer.offerId}`">{{ offer.presentation.label }}</h2>
        </div>
        <button type="button" aria-label="Close adjudication" @click="emit('cancel')">×</button>
      </header>
      <form @submit.prevent="submit">
        <fieldset>
          <legend>Decision</legend>
          <label><input v-model="decision" type="radio" value="accept"> Accept and retain result</label>
          <label><input v-model="decision" type="radio" value="reject"> Reject without mechanic</label>
        </fieldset>
        <fieldset v-if="decision === 'accept' && optionKind === 'aura'">
          <legend>Aura result</legend>
          <label><span>Hue</span><input v-model="auraHue" maxlength="40" autocomplete="off"></label>
          <label><span>Tone</span><select v-model="auraTone"><option value="brightened">Brightened</option><option value="darkened">Darkened</option><option value="neutral">Neutral</option></select></label>
        </fieldset>
        <fieldset v-if="decision === 'accept' && optionKind === 'alluring'">
          <legend>Encounter result</legend>
          <label><span>Canonical species</span><select v-model="alluringSpecies"><option v-for="species in canonicalSpeciesChoices" :key="species" :value="species">{{ species }}</option></select></label>
          <label><span>Level</span><input v-model.number="alluringLevel" type="number" min="1" max="100"></label>
        </fieldset>
        <fieldset v-if="decision === 'accept' && optionKind === 'sprouter'">
          <legend>Sprouter result</legend>
          <label><span>Result kind</span><select v-model="sprouterKind"><option value="growth">Plant growth</option><option value="berry-yield">Instant Berry yield</option></select></label>
          <label v-if="sprouterKind === 'berry-yield'"><span>Canonical Berry item</span><select v-model="sprouterBerry"><option v-for="item in canonicalBerryChoices" :key="item.name" :value="item.name">{{ item.name }}</option></select></label>
          <label v-if="sprouterKind === 'berry-yield'"><span>Quantity</span><input v-model.number="sprouterQuantity" type="number" min="1" max="20"></label>
        </fieldset>
        <fieldset v-if="decision === 'accept' && optionKind === 'fortune'">
          <legend>Low-Loyalty result</legend>
          <label><span>Outcome</span><select v-model="fortuneResult"><option value="returns">Returns</option><option value="runs-away">Runs away</option></select></label>
        </fieldset>
        <fieldset v-if="decision === 'accept' && optionKind === 'zygarde'">
          <legend>Zygarde assembly</legend>
          <label><span>Cells</span><select v-model.number="zygardeCells"><option :value="10">10</option><option :value="50">50</option><option :value="100">100</option></select></label>
          <label><span>Forme</span><select v-model="zygardeForm"><option value="10-percent">10% Forme</option><option value="50-percent">50% Forme</option></select></label>
          <label><span>Nature</span><select v-model="zygardeNature"><option v-for="nature in PTU_NATURE_OPTIONS" :key="nature" :value="nature">{{ nature }}</option></select></label>
          <label><span>Level</span><input v-model.number="zygardeLevel" type="number" min="1" max="100"></label>
        </fieldset>
        <fieldset v-if="decision === 'accept' && optionKind === 'dream'">
          <legend>Dream result</legend>
          <label><span>Mode</span><select v-model="dreamMode"><option value="private-view">Private dream reading</option><option value="dream-mist-image">Dream Mist image</option></select></label>
          <fieldset v-if="dreamMode === 'dream-mist-image'">
            <legend>Authorized Dream Mist viewers</legend>
            <label v-for="participant in participants" :key="participant.id"><input v-model="dreamViewerIds" type="checkbox" :value="participant.id">{{ participant.label }}</label>
          </fieldset>
        </fieldset>
        <fieldset v-if="decision === 'accept' && optionKind === 'telepath'">
          <legend>Mind-reading awareness</legend>
          <label><span>Target awareness</span><select v-model="telepathyAwareness"><option value="unaware">Unaware</option><option value="aware">Aware</option></select></label>
        </fieldset>
        <label v-if="decision === 'accept'">
          <span>Bounded retained result</span>
          <textarea v-model="description" maxlength="500" rows="4" />
        </label>
        <p v-if="error" role="alert">{{ error }}</p>
        <footer>
          <button type="button" @click="emit('cancel')">Cancel</button>
          <button type="submit" class="primary">Resolve adjudication</button>
        </footer>
      </form>
    </section>
  </div>
</template>

<style scoped>
.adjudication-backdrop { position: fixed; inset: 0; z-index: 1201; display: grid; place-items: center; padding: 1rem; background: rgb(4 8 16 / 72%); backdrop-filter: blur(4px); }
.adjudication-modal { width: min(38rem, 100%); padding: 1rem; border: 1px solid rgb(251 191 36 / 45%); border-radius: .9rem; color: #fff7df; background: #211b12; box-shadow: 0 1.5rem 5rem rgb(0 0 0 / 55%); }
header, footer { display: flex; align-items: center; justify-content: space-between; gap: .75rem; }
header p { margin: 0 0 .2rem; color: #fbbf24; font-size: .72rem; letter-spacing: .08em; text-transform: uppercase; }
h2 { margin: 0; font-size: 1.2rem; }
header button { border: 0; color: inherit; background: transparent; font-size: 1.6rem; }
form { display: grid; gap: .9rem; margin-top: 1rem; }
fieldset, label { display: grid; gap: .45rem; }
fieldset label { display: flex; align-items: center; gap: .45rem; }
input:not([type='radio']), select, textarea { width: 100%; padding: .55rem .65rem; border: 1px solid rgb(251 191 36 / 30%); border-radius: .45rem; color: inherit; background: #302718; }
form > p { margin: 0; color: #fca5a5; }
footer { justify-content: flex-end; }
footer button { padding: .55rem .8rem; border: 1px solid rgb(251 191 36 / 30%); border-radius: .45rem; color: inherit; background: #3a2f1d; }
footer .primary { border-color: #f59e0b; background: #92400e; }
</style>
