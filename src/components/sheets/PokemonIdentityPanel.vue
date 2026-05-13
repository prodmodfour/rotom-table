<script setup lang="ts">
import type { CharacterSheet } from '~/types/characterSheet'

const eggGroupsCsv = defineModel<string>('eggGroupsCsv', { required: true })

const props = defineProps<{
  sheet: CharacterSheet
  spriteUrl: string | null
  sheetTypes: readonly string[]
  levelFromExperience: number | undefined
  levelIsExperienceDerived: boolean
  experienceToNextLevel: number | undefined
  genderOptions: readonly string[]
  natureOptions: readonly string[]
  naturePlusDisplay?: string
  natureMinusDisplay?: string
  isGm: boolean
}>()

</script>

<template>
  <section class="panel-card identity">
    <div class="identity__sprite">
      <img v-if="spriteUrl" :src="spriteUrl" :alt="sheet.species" />
      <span v-else class="sprite-missing">?</span>
    </div>

    <div class="identity__copy">
      <div class="identity__heading">
        <div>
          <h1>
            <EditableCell v-model="sheet.nickname" placeholder="Nickname" />
          </h1>
          <p class="identity__species">
            <EditableCell v-model="sheet.species" placeholder="Species" />
          </p>
          <div v-if="sheetTypes.length" class="identity__type-badges">
            <TypeBadge
              v-for="type in sheetTypes"
              :key="type"
              :type="type"
              size="sm"
            />
          </div>
        </div>
        <div class="identity__badges">
          <span
            class="badge"
            :title="levelIsExperienceDerived ? `Level ${levelFromExperience} from Total EXP` : 'Manual level'"
          >
            Lv
            <EditableCell
              v-model="sheet.level"
              type="number"
              :min="1"
              :readonly="levelIsExperienceDerived"
            />
          </span>
          <label v-if="isGm" class="badge player-toggle" :class="{ player: sheet.player }" title="Player">
            <input v-model="sheet.player" type="checkbox" /> Player
          </label>
          <span v-else-if="sheet.player" class="badge player-toggle player">Player</span>
          <label class="badge shiny-toggle" :class="{ shiny: sheet.shiny }" title="Shiny">
            <input v-model="sheet.shiny" type="checkbox" /> ★ Shiny
          </label>
        </div>
      </div>

      <dl class="identity__stats">
        <div>
          <dt>Total EXP</dt>
          <dd><EditableCell v-model="sheet.totalExp" type="number" /></dd>
        </div>
        <div>
          <dt>To Next Lvl</dt>
          <dd>
            <EditableCell
              :model-value="experienceToNextLevel"
              type="number"
              readonly
            />
          </dd>
        </div>
        <div>
          <dt>Gender</dt>
          <dd>
            <EditableCell
              v-model="sheet.gender"
              type="select"
              :options="genderOptions"
              placeholder="—"
            />
          </dd>
        </div>
        <div>
          <dt>Nature</dt>
          <dd>
            <EditableCell
              v-model="sheet.nature"
              type="select"
              :options="natureOptions"
              placeholder="Hardy / Modest / …"
            />
          </dd>
        </div>
        <div>
          <dt>Nat +</dt>
          <dd>
            <EditableCell
              :model-value="naturePlusDisplay"
              readonly
              placeholder="—"
            />
          </dd>
        </div>
        <div>
          <dt>Nat −</dt>
          <dd>
            <EditableCell
              :model-value="natureMinusDisplay"
              readonly
              placeholder="—"
            />
          </dd>
        </div>
        <div>
          <dt>Egg Group</dt>
          <dd>
            <EditableCell v-model="eggGroupsCsv" placeholder="Field, Fairy" />
          </dd>
        </div>
        <div>
          <dt>Scene Xp</dt>
          <dd><EditableCell v-model="sheet.scene!.sceneXp" type="number" /></dd>
        </div>
        <div>
          <dt># Pkmn</dt>
          <dd><EditableCell v-model="sheet.scene!.pkmnCount" type="number" /></dd>
        </div>
        <div>
          <dt>Modifiers</dt>
          <dd><EditableCell v-model="sheet.scene!.modifiers" type="number" /></dd>
        </div>
        <div>
          <dt>New Total</dt>
          <dd><EditableCell v-model="sheet.scene!.newTotal" type="number" /></dd>
        </div>
      </dl>
    </div>
  </section>
</template>

<style scoped>
.identity {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 1rem;
  align-items: center;
}

.identity__sprite {
  width: 110px;
  height: 110px;
  display: grid;
  place-items: center;
  padding: 0.4rem;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-inset);
}

.identity__sprite img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
}

.sprite-missing {
  color: var(--ink-faint);
  font-size: 1.5rem;
  font-weight: 700;
}

.identity__copy { min-width: 0; }

.identity__heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.75rem;
  margin-bottom: 0.6rem;
}

.identity__heading h1 {
  margin: 0;
  font-family: var(--font-book);
  font-size: 1.7rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ink-bright);
}

.identity__species {
  margin: 0.15rem 0 0;
  color: var(--ink-soft);
  font-size: 0.95rem;
  font-style: italic;
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.identity__type-badges {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.28rem;
  margin-top: 0.45rem;
}

.identity__badges {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border-radius: 999px;
  padding: 0.22rem 0.65rem;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.74rem;
  letter-spacing: 0.06em;
  white-space: nowrap;
}

.badge.player-toggle,
.badge.shiny-toggle {
  background: rgba(221, 210, 176, 0.16);
  color: var(--ink-bright);
  cursor: pointer;
  user-select: none;
}

.badge.player-toggle.player,
.badge.shiny-toggle.shiny {
  background: rgba(221, 210, 176, 0.28);
}

.badge.player-toggle input,
.badge.shiny-toggle input {
  width: 0.85em;
  height: 0.85em;
  margin: 0;
}

.identity__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0;
}

.identity__stats > div {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  padding: 0.45rem 0.65rem;
  background: var(--paper-inset);
  min-width: 0;
}

.identity__stats dt {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--ink-muted);
}

.identity__stats dd {
  margin: 0.18rem 0 0;
  font-weight: 700;
  color: var(--ink-bright);
}
</style>
