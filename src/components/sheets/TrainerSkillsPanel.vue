<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ResolvedTrainerSkill } from '~/utils/sheets/trainerDerived'
import type { TrainerSkillKey } from '~/types/trainerSheet'

const props = defineProps<{
  skills: readonly ResolvedTrainerSkill[]
}>()

const emit = defineEmits<{
  setSkillRankBonus: [key: TrainerSkillKey, rankBonus: number | undefined]
  setSkillModifier: [key: TrainerSkillKey, modifier: number | undefined]
}>()

const selectedSkillKey = ref<TrainerSkillKey | null>(null)
const skillModalTitleId = 'trainer-skill-sources-modal-title'

const selectedSkill = computed(() =>
  props.skills.find((skill) => skill.key === selectedSkillKey.value) ?? null,
)

const formatSkillModifier = (value: unknown): string =>
  typeof value === 'number' && value !== 0
    ? value > 0 ? `+${value}` : String(value)
    : '+0'

const openSkillModal = (key: TrainerSkillKey): void => {
  selectedSkillKey.value = key
}

const closeSkillModal = (): void => {
  selectedSkillKey.value = null
}

const numericInputValue = (event: Event): number | undefined | null => {
  const raw = (event.target as HTMLInputElement).value.trim()
  if (!raw) return undefined
  if (raw === '-' || raw === '+') return null

  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

const setSelectedRankBonus = (event: Event): void => {
  const skill = selectedSkill.value
  if (!skill) return

  const value = numericInputValue(event)
  if (value === null) return
  emit('setSkillRankBonus', skill.key, value)
}

const setSelectedMiscModifier = (event: Event): void => {
  const skill = selectedSkill.value
  if (!skill) return

  const value = numericInputValue(event)
  if (value === null) return
  emit('setSkillModifier', skill.key, value)
}
</script>

<template>
  <div class="block">
    <div class="skills-grid">
      <div
        v-for="s in skills"
        :key="s.key"
        :class="['skill-row', {
          raised: s.raised,
          lowered: s.lowered,
        }]"
      >
        <span class="skill-label">{{ s.label }}</span>
        <span class="skill-rank">
          <button
            type="button"
            class="skill-rank-button"
            :title="`Show ${s.label} skill sources`"
            @click="openSkillModal(s.key)"
          >
            {{ s.rank }}
          </button>
        </span>
        <span class="skill-dice">
          <span>{{ s.dice }}</span>
          <span v-if="s.modifier !== 0" class="skill-modifier">{{ formatSkillModifier(s.modifier) }}</span>
        </span>
      </div>
    </div>
  </div>

  <Teleport to="body">
    <div
      v-if="selectedSkill"
      class="skill-modal-backdrop"
      @pointerdown.self="closeSkillModal"
    >
      <section
        class="skill-modal"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="skillModalTitleId"
        tabindex="-1"
        @keydown.esc="closeSkillModal"
      >
        <header class="skill-modal-header">
          <div>
            <p class="skill-modal-eyebrow">Skill calculation</p>
            <h3 :id="skillModalTitleId">{{ selectedSkill.label }}</h3>
          </div>
          <button type="button" class="skill-modal-close" aria-label="Close" @click="closeSkillModal">×</button>
        </header>

        <div class="skill-modal-summary">
          <div>
            <span class="summary-label">Rank</span>
            <strong>{{ selectedSkill.rank }}</strong>
          </div>
          <div>
            <span class="summary-label">Roll</span>
            <strong>{{ selectedSkill.dice }} {{ formatSkillModifier(selectedSkill.modifier) }}</strong>
          </div>
        </div>

        <p v-if="selectedSkill.automaticRank !== selectedSkill.rank" class="skill-modal-note">
          Automatic rank before miscellaneous/manual rank adjustments is {{ selectedSkill.automaticRank }}.
        </p>

        <section class="skill-modal-section">
          <h4>Rank sources</h4>
          <ol class="source-list">
            <li
              v-for="source in selectedSkill.rankSources"
              :key="source.id"
              :class="{ 'is-muted': !source.applied }"
            >
              <div>
                <strong>{{ source.label }}</strong>
                <span>{{ source.detail }}</span>
              </div>
            </li>
          </ol>

          <label class="misc-bonus-field">
            <span>Miscellaneous rank bonus</span>
            <input
              type="number"
              step="1"
              :value="selectedSkill.rankBonus"
              @input="setSelectedRankBonus"
            >
          </label>
          <p class="skill-modal-note">
            This changes the skill rank after Background and rank-up Edges are applied.
          </p>
        </section>

        <section class="skill-modal-section">
          <h4>Non-rank bonus sources</h4>
          <ol v-if="selectedSkill.modifierSources.length" class="source-list">
            <li
              v-for="source in selectedSkill.modifierSources"
              :key="source.id"
              :class="{ 'is-muted': !source.applied }"
            >
              <div>
                <strong>{{ source.label }}</strong>
                <span>{{ source.detail }}</span>
              </div>
              <span class="source-amount">{{ formatSkillModifier(source.modifier) }}</span>
            </li>
          </ol>
          <p v-else class="skill-modal-empty">No automatic Edge bonuses for this skill.</p>

          <label class="misc-bonus-field">
            <span>Miscellaneous non-rank bonus</span>
            <input
              type="number"
              step="1"
              :value="selectedSkill.miscModifier"
              @input="setSelectedMiscModifier"
            >
          </label>
          <p class="skill-modal-note">
            This is a flat modifier to the roll result; it does not change rank or dice.
          </p>
        </section>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.block {
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-inset);
  padding: 0.7rem 0.85rem;
}

.skills-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.35rem;
}

.skill-row {
  display: grid;
  grid-template-columns: minmax(7.25rem, 1fr) auto minmax(2.8rem, auto);
  align-items: center;
  gap: 0.5rem;
  min-height: 2.2rem;
  padding: 0.32rem 0.5rem;
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  background: var(--paper-inset);
}

.skill-row.raised {
  border-color: rgba(184, 187, 38, 0.45);
  background: rgba(184, 187, 38, 0.12);
}

.skill-row.lowered {
  border-color: rgba(255, 31, 45, 0.45);
  background: rgba(255, 31, 45, 0.12);
}

.skill-label {
  color: var(--ink);
  font-weight: 500;
  font-size: 0.86rem;
  line-height: 1.15;
}

.skill-rank {
  color: var(--ink-muted);
  font-size: 0.78rem;
  letter-spacing: 0.04em;
}

.skill-rank-button {
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper);
  color: var(--ink-soft);
  padding: 0.12rem 0.48rem;
  font: inherit;
  letter-spacing: inherit;
  cursor: pointer;
}

.skill-rank-button:hover,
.skill-rank-button:focus-visible {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
  outline: none;
}

.skill-dice {
  color: var(--accent);
  font-weight: 700;
  font-size: 0.82rem;
  display: inline-flex;
  justify-content: flex-end;
  gap: 0.25rem;
  align-items: baseline;
  min-width: 2.8rem;
  white-space: nowrap;
}

.skill-modifier {
  color: var(--ink-muted);
  font-weight: 600;
}

.skill-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 6000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.55);
}

.skill-modal {
  width: min(34rem, 100%);
  max-height: min(88vh, 44rem);
  overflow: auto;
  border: 1px solid var(--rule);
  border-radius: 14px;
  background: var(--paper);
  color: var(--ink);
  box-shadow: var(--shadow-card);
}

.skill-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  padding: 0.85rem 1rem;
  border-bottom: 1px solid var(--rule-soft);
  background: var(--paper-soft);
}

.skill-modal-eyebrow,
.skill-modal-note,
.skill-modal-empty {
  margin: 0;
  color: var(--ink-muted);
  font-size: 0.78rem;
}

.skill-modal-eyebrow {
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.skill-modal h3 {
  margin: 0.15rem 0 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
  font-size: 1.3rem;
}

.skill-modal-close {
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper);
  color: var(--ink-soft);
  width: 2rem;
  height: 2rem;
  font: inherit;
  font-size: 1.3rem;
  line-height: 1;
  cursor: pointer;
}

.skill-modal-close:hover,
.skill-modal-close:focus-visible {
  border-color: var(--accent);
  color: var(--accent);
  outline: none;
}

.skill-modal-summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
  padding: 0.85rem 1rem 0;
}

.skill-modal-summary > div {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper-inset);
  padding: 0.55rem 0.65rem;
}

.summary-label {
  display: block;
  color: var(--ink-muted);
  font-size: 0.68rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.skill-modal-summary strong {
  color: var(--accent);
  font-size: 1rem;
}

.skill-modal > .skill-modal-note {
  padding: 0.65rem 1rem 0;
}

.skill-modal-section {
  padding: 0.85rem 1rem;
  border-top: 1px solid var(--rule-soft);
}

.skill-modal-section:first-of-type {
  border-top: 0;
}

.skill-modal-section h4 {
  margin: 0 0 0.45rem;
  color: var(--ink-bright);
  font-size: 0.78rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.source-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.source-list li {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  background: var(--paper-inset);
  padding: 0.45rem 0.55rem;
}

.source-list li.is-muted {
  opacity: 0.68;
}

.source-list strong,
.source-list span {
  display: block;
}

.source-list strong {
  color: var(--ink-bright);
  font-size: 0.82rem;
}

.source-list span {
  color: var(--ink-soft);
  font-size: 0.78rem;
}

.source-amount {
  color: var(--accent) !important;
  font-weight: 700;
  white-space: nowrap;
}

.misc-bonus-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-top: 0.65rem;
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  background: var(--paper-inset);
  padding: 0.5rem 0.6rem;
  color: var(--ink-bright);
  font-size: 0.85rem;
  font-weight: 600;
}

.misc-bonus-field input {
  width: 5.5rem;
  border: 1px solid var(--rule-soft);
  border-radius: 6px;
  background: var(--paper);
  color: var(--ink-bright);
  padding: 0.25rem 0.35rem;
  font: inherit;
  text-align: right;
}

.misc-bonus-field input:focus {
  border-color: var(--accent);
  outline: none;
  box-shadow: 0 0 0 2px rgba(var(--accent-rgb), 0.16);
}

.misc-bonus-field + .skill-modal-note {
  margin-top: 0.4rem;
}
</style>
