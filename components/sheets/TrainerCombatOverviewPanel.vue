<script setup lang="ts">
import {
  EVASION_BONUS_MAX,
  EVASION_BONUS_MIN,
  formatSignedModifier,
} from '~/utils/evasion'
import type { TrainerEvasionBonusKey } from '~/composables/sheets/useTrainerSheetRowActions'
import type { TrainerSheet } from '~/types/trainerSheet'

const otherCapsCsv = defineModel<string>('otherCapsCsv', { required: true })

type TrainerEvasionSummary = {
  speed: { total: number; base: number; bonus: number }
  physical: { total: number; base: number; bonus: number }
  special: { total: number; base: number; bonus: number }
}

defineProps<{
  sheet: TrainerSheet
  currentHp: number
  maxHp: number
  fullMaxHp: number
  maxAp: number
  tickValue: number
  hpThresholds: {
    half: number
    third: number
    quarter: number
  }
  attackTotal: number
  specialAttackTotal: number
  speedTotal: number
  trainerEvasion: TrainerEvasionSummary
}>()

const emit = defineEmits<{
  setCurrentHp: [value: unknown]
  setEvasionBonus: [key: TrainerEvasionBonusKey, value: number | undefined]
}>()
</script>

<template>
  <div class="trainer-combat-overview">
    <div class="combat-strip">
      <div class="combat-cell">
        <span>Current HP</span>
        <strong>
          <EditableCell
            :model-value="currentHp"
            type="number"
            :min="0"
            :max="maxHp"
            @update:model-value="emit('setCurrentHp', $event)"
          />
        </strong>
      </div>
      <div
        class="combat-cell"
        title="Formula Max HP = Level × 2 + (HP × 3) + 10. Injuries reduce the effective Max HP by 1/10 each."
      >
        <span>Max HP</span>
        <strong>{{ maxHp }}<small v-if="maxHp !== fullMaxHp">full {{ fullMaxHp }}</small></strong>
      </div>
      <div class="combat-cell" title="A Tick is 1/10th of full maximum Hit Points, rounded down.">
        <span>Tick</span><strong>{{ tickValue }}</strong>
      </div>
      <div class="combat-cell" title="Fractional HP values use full Max HP before the injury cap.">
        <span>½ HP</span><strong>{{ hpThresholds.half }}</strong>
      </div>
      <div class="combat-cell" title="Fractional HP values use full Max HP before the injury cap.">
        <span>⅓ HP</span><strong>{{ hpThresholds.third }}</strong>
      </div>
      <div class="combat-cell" title="Fractional HP values use full Max HP before the injury cap.">
        <span>¼ HP</span><strong>{{ hpThresholds.quarter }}</strong>
      </div>
      <div class="combat-cell">
        <span>DR</span>
        <strong><EditableCell v-model="sheet.damageReduction" type="number" :min="0" /></strong>
      </div>
      <div class="combat-cell">
        <span>Lv</span>
        <strong><EditableCell v-model="sheet.level" type="number" :min="1" /></strong>
      </div>
      <div class="combat-cell"><span>CS Atk</span><strong>{{ attackTotal }}</strong></div>
      <div class="combat-cell"><span>CS SAtk</span><strong>{{ specialAttackTotal }}</strong></div>
      <div class="combat-cell"><span>Speed</span><strong>{{ speedTotal }}</strong></div>
    </div>

    <div class="grid-two">
      <div class="block">
        <h2 class="block-title">Action Points</h2>
        <table class="data-table ap-table">
          <thead><tr><th>Left</th><th>Spent</th><th>Bound</th><th>Drained</th><th>Max</th></tr></thead>
          <tbody>
            <tr>
              <td><EditableCell v-model="sheet.ap!.left"    type="number" :min="0" /></td>
              <td><EditableCell v-model="sheet.ap!.spent"   type="number" :min="0" /></td>
              <td><EditableCell v-model="sheet.ap!.bound"   type="number" :min="0" /></td>
              <td><EditableCell v-model="sheet.ap!.drained" type="number" :min="0" /></td>
              <td><strong>{{ maxAp }}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="block">
        <h2 class="block-title">Evasion</h2>
        <ul class="kv-list evasion-list">
          <li title="Stat evasion = floor(Speed Total / 5), capped at +6 from stats.">
            <span class="evasion-list__label">Speed Evasion <small>stat {{ trainerEvasion.speed.base }}</small></span>
            <span class="evasion-list__value">
              <strong>{{ trainerEvasion.speed.total }}</strong>
              <span class="evasion-list__bonus">
                bonus
                <EditableCell
                  :model-value="trainerEvasion.speed.bonus"
                  type="number"
                  :min="EVASION_BONUS_MIN"
                  :max="EVASION_BONUS_MAX"
                  :format="formatSignedModifier"
                  @update:model-value="(v) => emit('setEvasionBonus', 'speedBonus', v as number | undefined)"
                />
              </span>
            </span>
          </li>
          <li title="Stat evasion = floor(Defense Total / 5), capped at +6 from stats.">
            <span class="evasion-list__label">Physical Evasion <small>stat {{ trainerEvasion.physical.base }}</small></span>
            <span class="evasion-list__value">
              <strong>{{ trainerEvasion.physical.total }}</strong>
              <span class="evasion-list__bonus">
                bonus
                <EditableCell
                  :model-value="trainerEvasion.physical.bonus"
                  type="number"
                  :min="EVASION_BONUS_MIN"
                  :max="EVASION_BONUS_MAX"
                  :format="formatSignedModifier"
                  @update:model-value="(v) => emit('setEvasionBonus', 'physicalBonus', v as number | undefined)"
                />
              </span>
            </span>
          </li>
          <li title="Stat evasion = floor(Special Defense Total / 5), capped at +6 from stats.">
            <span class="evasion-list__label">Special Evasion <small>stat {{ trainerEvasion.special.base }}</small></span>
            <span class="evasion-list__value">
              <strong>{{ trainerEvasion.special.total }}</strong>
              <span class="evasion-list__bonus">
                bonus
                <EditableCell
                  :model-value="trainerEvasion.special.bonus"
                  type="number"
                  :min="EVASION_BONUS_MIN"
                  :max="EVASION_BONUS_MAX"
                  :format="formatSignedModifier"
                  @update:model-value="(v) => emit('setEvasionBonus', 'specialBonus', v as number | undefined)"
                />
              </span>
            </span>
          </li>
        </ul>
        <div class="muted condition-block">
          <strong>Conditions:</strong>
          <ConditionPicker v-model="sheet.conditions" />
        </div>
        <p class="muted">
          <strong>Digestion:</strong>
          <EditableCell v-model="sheet.digestion" placeholder="—" />
        </p>
      </div>
    </div>

    <div class="block">
      <h2 class="block-title">Capabilities</h2>
      <ul class="cap-grid">
        <li>
          <span class="cap-label">Overland</span>
          <span class="cap-value">
            <EditableCell v-model="sheet.capabilities!.overland" type="number" :min="0" />
          </span>
        </li>
        <li>
          <span class="cap-label">Throw Range</span>
          <span class="cap-value">
            <EditableCell v-model="sheet.capabilities!.throwingRange" type="number" :min="0" />
          </span>
        </li>
        <li>
          <span class="cap-label">High Jump</span>
          <span class="cap-value">
            <EditableCell v-model="sheet.capabilities!.highJump" type="number" :min="0" />
          </span>
        </li>
        <li>
          <span class="cap-label">Long Jump</span>
          <span class="cap-value">
            <EditableCell v-model="sheet.capabilities!.longJump" type="number" :min="0" />
          </span>
        </li>
        <li>
          <span class="cap-label">Swim</span>
          <span class="cap-value">
            <EditableCell v-model="sheet.capabilities!.swim" type="number" :min="0" />
          </span>
        </li>
        <li>
          <span class="cap-label">Power</span>
          <span class="cap-value">
            <EditableCell v-model="sheet.capabilities!.power" type="number" :min="0" />
          </span>
        </li>
        <li>
          <span class="cap-label">Sky</span>
          <span class="cap-value">
            <EditableCell v-model="sheet.capabilities!.sky" type="number" :min="0" />
          </span>
        </li>
        <li>
          <span class="cap-label">Levitate</span>
          <span class="cap-value">
            <EditableCell v-model="sheet.capabilities!.levitate" type="number" :min="0" />
          </span>
        </li>
        <li>
          <span class="cap-label">Burrow</span>
          <span class="cap-value">
            <EditableCell v-model="sheet.capabilities!.burrow" type="number" :min="0" />
          </span>
        </li>
      </ul>
      <p class="muted-help capabilities-help">
        <strong>Other capabilities:</strong>
        <EditableCell v-model="otherCapsCsv" placeholder="Telepath, Aura Reader" />
      </p>
    </div>
  </div>
</template>

<style scoped>
.trainer-combat-overview {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.grid-two {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 0.85rem;
}

.block {
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-inset);
  padding: 0.7rem 0.85rem;
}

.block-title {
  margin: 0 0 0.5rem;
  font-family: var(--font-book);
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-bright);
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
}

.muted { color: var(--ink-muted); font-size: 0.85rem; }
.muted-help { color: var(--ink-muted); font-size: 0.78rem; margin: 0 0 0.4rem; }

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
}

.data-table th,
.data-table td {
  padding: 0.35rem 0.5rem;
  text-align: left;
  border-bottom: 1px solid var(--rule);
  vertical-align: top;
}

.data-table th {
  font-weight: 600;
  color: var(--ink-bright);
}

.data-table thead th {
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-muted);
  background: transparent;
  font-weight: 600;
}

.kv-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.kv-list li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.28rem 0;
  border-bottom: 1px dashed var(--rule);
  font-size: 0.88rem;
}

.kv-list li:last-child { border-bottom: 0; }

.evasion-list li {
  align-items: flex-start;
}

.evasion-list__label {
  display: inline-flex;
  flex-direction: column;
  gap: 0.08rem;
}

.evasion-list__label small,
.evasion-list__bonus {
  color: var(--ink-muted);
  font-size: 0.72rem;
  font-weight: 400;
}

.evasion-list__value {
  display: inline-flex;
  align-items: baseline;
  gap: 0.45rem;
}

.evasion-list__value strong {
  color: var(--ink-bright);
  font-variant-numeric: tabular-nums;
}

.combat-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
  gap: 0.4rem;
}

.combat-cell {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.45rem 0.5rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper-inset);
  text-align: center;
}

.combat-cell span {
  font-size: 0.68rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.combat-cell strong {
  font-size: 1.15rem;
  color: var(--ink-bright);
  font-variant-numeric: tabular-nums;
  font-family: var(--font-book);
}

.combat-cell small {
  display: block;
  margin-top: 0.08rem;
  color: var(--ink-muted);
  font-family: var(--font-ui);
  font-size: 0.68rem;
  font-weight: 400;
  letter-spacing: 0.04em;
}

.condition-block {
  display: grid;
  gap: 0.45rem;
  margin: 0.55rem 0;
}

.condition-block > strong { color: var(--ink-bright); }

.cap-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 0.35rem;
}

.cap-grid li {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 0.3rem 0.55rem;
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  background: var(--paper-inset);
}

.cap-label { color: var(--ink-soft); font-size: 0.82rem; }
.cap-value { color: var(--ink-bright); font-weight: 700; font-size: 0.92rem; font-variant-numeric: tabular-nums; }

.capabilities-help { margin-top: 0.6rem; }
</style>
