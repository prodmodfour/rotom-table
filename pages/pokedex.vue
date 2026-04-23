<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import pokedexData from '~/ptu-data/data/pokedex.json'
import { pokemonCatalogBySpecies } from '~/data/pokemonCatalog'
import type { PokedexCapabilities, PokedexRecord } from '~/types/pokemon'

useHead({
  title: 'Pokédex · Rotom Table',
})

type DisplayPokedexEntry = PokedexRecord & {
  id: string
}

const normalizeText = (value: string) => value.trim().toLowerCase()

const allEntries: DisplayPokedexEntry[] = [...(pokedexData as PokedexRecord[])]
  .filter((entry): entry is PokedexRecord => Boolean(entry?.species))
  .sort((left, right) => left.species.localeCompare(right.species))
  .map((entry, index) => ({
    ...entry,
    id: `${index}-${entry.species.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  }))

const searchTerm = ref('')
const selectedId = ref<string | null>(allEntries[0]?.id ?? null)

const filteredEntries = computed(() => {
  const query = normalizeText(searchTerm.value)

  if (!query) {
    return allEntries
  }

  return allEntries.filter((entry) => {
    const haystacks = [
      entry.species,
      ...(entry.types ?? []),
      entry.source_gen ?? '',
    ]

    return haystacks.some((value) => normalizeText(value).includes(query))
  })
})

watch(
  filteredEntries,
  (entries) => {
    if (entries.length === 0) {
      selectedId.value = null
      return
    }

    if (!selectedId.value || !entries.some((entry) => entry.id === selectedId.value)) {
      selectedId.value = entries[0].id
    }
  },
  { immediate: true },
)

const selectedEntry = computed(
  () => filteredEntries.value.find((entry) => entry.id === selectedId.value)
    ?? allEntries.find((entry) => entry.id === selectedId.value)
    ?? null,
)

const selectedSprite = computed(() => {
  if (!selectedEntry.value) {
    return null
  }

  return pokemonCatalogBySpecies.get(selectedEntry.value.species) ?? null
})

const isPlacementOnly = computed(() => {
  if (!selectedEntry.value) {
    return false
  }

  return !selectedEntry.value.base_stats && !selectedEntry.value.abilities && !selectedEntry.value.level_up_moves
})

const rawEntry = computed(() => {
  if (!selectedEntry.value) {
    return ''
  }

  return JSON.stringify(selectedEntry.value, null, 2)
})

const genderSummary = computed(() => {
  const entry = selectedEntry.value

  if (!entry) {
    return null
  }

  if (entry.genderless) {
    return 'Genderless'
  }

  if (entry.male_pct != null || entry.female_pct != null) {
    return `${entry.male_pct ?? 0}% M / ${entry.female_pct ?? 0}% F`
  }

  return null
})

const capabilityRows = computed(() => {
  const capabilities = selectedEntry.value?.capabilities as PokedexCapabilities | undefined

  if (!capabilities) {
    return []
  }

  return [
    ['Overland', capabilities.overland],
    ['Sky', capabilities.sky],
    ['Swim', capabilities.swim],
    ['Levitate', capabilities.levitate],
    ['Burrow', capabilities.burrow],
    ['Jump', capabilities.jump],
    ['Power', capabilities.power],
  ].filter(([, value]) => value !== undefined && value !== null)
})

const capabilityOther = computed(() => selectedEntry.value?.capabilities?.other ?? [])
const skillRows = computed(() => Object.entries(selectedEntry.value?.skills ?? {}))
const typeSummary = computed(() => selectedEntry.value?.types?.join(' / ') ?? 'Unknown type')
</script>

<template>
  <div class="pokedex-layout">
    <aside class="pokedex-sidebar">
      <AppNavigation />

      <section class="panel-card sidebar-card">
        <div class="panel-heading">
          <h1>Pokédex</h1>
          <span class="badge">{{ filteredEntries.length }} shown</span>
        </div>

        <p class="sidebar-copy">
          Browse every Pokémon cache entry currently stored in <code>ptu-data/data/pokedex.json</code>.
        </p>

        <label class="search-field">
          <span class="sr-only">Search the Pokédex</span>
          <input v-model.trim="searchTerm" type="search" placeholder="Search species, type, or source gen…" />
        </label>

        <div v-if="filteredEntries.length > 0" class="entry-list">
          <button
            v-for="entry in filteredEntries"
            :key="entry.id"
            :class="['entry-button', { active: entry.id === selectedId }]"
            type="button"
            @click="selectedId = entry.id"
          >
            <span class="entry-name">{{ entry.species }}</span>
            <span class="entry-meta">
              {{ entry.types?.join(' / ') || 'Unknown type' }}
              <template v-if="entry.source_gen"> · {{ entry.source_gen }}</template>
            </span>
          </button>
        </div>

        <p v-else class="empty-state">
          No Pokédex entries match that search.
        </p>
      </section>
    </aside>

    <main class="pokedex-detail">
      <template v-if="selectedEntry">
        <section class="panel-card hero-card">
          <div class="hero-inner">
            <div v-if="selectedSprite" class="sprite-frame">
              <img :src="selectedSprite.spriteUrl" :alt="selectedEntry.species" />
            </div>

            <div class="hero-copy">
              <div class="hero-heading">
                <div>
                  <h2>{{ selectedEntry.species }}</h2>
                  <p class="type-copy">{{ typeSummary }}</p>
                </div>

                <div class="hero-badges">
                  <span v-if="selectedEntry.source_gen" class="badge">{{ selectedEntry.source_gen }}</span>
                  <span v-if="isPlacementOnly" class="badge warn">Placement only</span>
                </div>
              </div>

              <div class="summary-grid">
                <div v-if="selectedEntry.size">
                  <dt>Size</dt>
                  <dd>{{ selectedEntry.size }}</dd>
                </div>
                <div v-if="selectedEntry.width != null && selectedEntry.height != null">
                  <dt>Sprite Size</dt>
                  <dd>{{ selectedEntry.width }}m × {{ selectedEntry.height }}m</dd>
                </div>
                <div v-if="selectedEntry.base != null">
                  <dt>Base</dt>
                  <dd>{{ selectedEntry.base }} × {{ selectedEntry.base }}</dd>
                </div>
                <div v-if="selectedEntry.clearance != null">
                  <dt>Clearance</dt>
                  <dd>{{ selectedEntry.clearance }}m</dd>
                </div>
                <div v-if="selectedEntry.weight != null">
                  <dt>Weight Class</dt>
                  <dd>{{ selectedEntry.weight }}</dd>
                </div>
                <div v-if="genderSummary">
                  <dt>Gender</dt>
                  <dd>{{ genderSummary }}</dd>
                </div>
                <div v-if="selectedEntry.evolution_stage != null">
                  <dt>Evolution Stage</dt>
                  <dd>{{ selectedEntry.evolution_stage }}</dd>
                </div>
                <div v-if="selectedEntry.evolutions_remaining != null">
                  <dt>Evolutions Remaining</dt>
                  <dd>{{ selectedEntry.evolutions_remaining }}</dd>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div class="detail-grid">
          <section class="panel-card">
            <div class="panel-heading compact">
              <h3>Base Stats</h3>
            </div>

            <dl v-if="selectedEntry.base_stats" class="stats-grid">
              <div>
                <dt>HP</dt>
                <dd>{{ selectedEntry.base_stats.hp }}</dd>
              </div>
              <div>
                <dt>Attack</dt>
                <dd>{{ selectedEntry.base_stats.atk }}</dd>
              </div>
              <div>
                <dt>Defense</dt>
                <dd>{{ selectedEntry.base_stats.def }}</dd>
              </div>
              <div>
                <dt>Sp. Attack</dt>
                <dd>{{ selectedEntry.base_stats.spatk }}</dd>
              </div>
              <div>
                <dt>Sp. Defense</dt>
                <dd>{{ selectedEntry.base_stats.spdef }}</dd>
              </div>
              <div>
                <dt>Speed</dt>
                <dd>{{ selectedEntry.base_stats.spd }}</dd>
              </div>
            </dl>

            <p v-else class="empty-state">No base stats recorded.</p>
          </section>

          <section class="panel-card">
            <div class="panel-heading compact">
              <h3>Abilities</h3>
            </div>

            <div v-if="selectedEntry.abilities" class="ability-groups">
              <div>
                <h4>Basic</h4>
                <ul>
                  <li v-for="ability in selectedEntry.abilities.basic ?? []" :key="`basic-${ability}`">
                    {{ ability }}
                  </li>
                </ul>
              </div>
              <div>
                <h4>Advanced</h4>
                <ul>
                  <li v-for="ability in selectedEntry.abilities.advanced ?? []" :key="`advanced-${ability}`">
                    {{ ability }}
                  </li>
                </ul>
              </div>
              <div>
                <h4>High</h4>
                <ul>
                  <li v-for="ability in selectedEntry.abilities.high ?? []" :key="`high-${ability}`">
                    {{ ability }}
                  </li>
                </ul>
              </div>
            </div>

            <p v-else class="empty-state">No ability data recorded.</p>
          </section>

          <section class="panel-card">
            <div class="panel-heading compact">
              <h3>Evolution</h3>
            </div>

            <div v-if="selectedEntry.evolutions?.length" class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Stage</th>
                    <th>Species</th>
                    <th>Minimum Level</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="evolution in selectedEntry.evolutions" :key="`${evolution.stage}-${evolution.species}`">
                    <td>{{ evolution.stage }}</td>
                    <td>{{ evolution.species }}</td>
                    <td>{{ evolution.min_level ?? '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p v-else class="empty-state">No evolution data recorded.</p>
          </section>

          <section class="panel-card">
            <div class="panel-heading compact">
              <h3>Capabilities</h3>
            </div>

            <template v-if="capabilityRows.length || capabilityOther.length">
              <dl v-if="capabilityRows.length" class="capability-grid">
                <div v-for="[label, value] in capabilityRows" :key="label">
                  <dt>{{ label }}</dt>
                  <dd>{{ value }}</dd>
                </div>
              </dl>

              <div v-if="capabilityOther.length" class="capability-other">
                <h4>Other</h4>
                <ul>
                  <li v-for="capability in capabilityOther" :key="capability">
                    {{ capability }}
                  </li>
                </ul>
              </div>
            </template>

            <p v-else class="empty-state">No capability data recorded.</p>
          </section>

          <section class="panel-card">
            <div class="panel-heading compact">
              <h3>Skills</h3>
            </div>

            <dl v-if="skillRows.length" class="skill-grid">
              <div v-for="[skill, value] in skillRows" :key="skill">
                <dt>{{ skill }}</dt>
                <dd>{{ value }}</dd>
              </div>
            </dl>

            <p v-else class="empty-state">No skill data recorded.</p>
          </section>

          <section class="panel-card detail-wide">
            <div class="panel-heading compact">
              <h3>Level-Up Moves</h3>
              <span class="badge">{{ selectedEntry.level_up_moves?.length ?? 0 }}</span>
            </div>

            <div v-if="selectedEntry.level_up_moves?.length" class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Level</th>
                    <th>Move</th>
                    <th>Type</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="move in selectedEntry.level_up_moves" :key="`${move.level}-${move.name}`">
                    <td>{{ move.level }}</td>
                    <td>{{ move.name }}</td>
                    <td>{{ move.type }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p v-else class="empty-state">No level-up moves recorded.</p>
          </section>

          <section class="panel-card detail-wide">
            <div class="panel-heading compact">
              <h3>Raw Cache Entry</h3>
            </div>

            <pre class="json-block">{{ rawEntry }}</pre>
          </section>
        </div>
      </template>

      <section v-else class="panel-card empty-card">
        <h2>No entry selected</h2>
        <p class="empty-state">Pick a Pokémon from the sidebar to inspect its PTU data.</p>
      </section>
    </main>
  </div>
</template>

<style scoped>
.pokedex-layout {
  display: grid;
  grid-template-columns: minmax(320px, 380px) minmax(0, 1fr);
  min-height: 100vh;
}

.pokedex-sidebar {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
  border-right: 1px solid rgba(96, 165, 250, 0.2);
  background:
    linear-gradient(180deg, rgba(4, 13, 30, 0.98), rgba(5, 11, 24, 0.94)),
    radial-gradient(circle at top, rgba(29, 78, 216, 0.18), transparent 55%);
  max-height: 100vh;
  overflow: auto;
}

.pokedex-detail {
  min-width: 0;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  background:
    radial-gradient(circle at top, rgba(37, 99, 235, 0.1), transparent 35%),
    #050d1b;
}

.panel-card {
  border: 1px solid rgba(96, 165, 250, 0.22);
  border-radius: 18px;
  background: rgba(8, 20, 43, 0.82);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.22);
  padding: 1rem;
}

.sidebar-card {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}

.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.85rem;
}

.panel-heading.compact {
  margin-bottom: 0.75rem;
}

.panel-heading h1,
.panel-heading h2,
.panel-heading h3,
.hero-heading h2 {
  margin: 0;
}

.badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.28rem 0.7rem;
  background: rgba(37, 99, 235, 0.18);
  color: #bfdbfe;
  font-size: 0.78rem;
  white-space: nowrap;
}

.badge.warn {
  background: rgba(234, 179, 8, 0.18);
  color: #fde68a;
}

.sidebar-copy,
.empty-state {
  margin: 0 0 0.9rem;
  color: rgba(191, 219, 254, 0.76);
  line-height: 1.5;
}

.search-field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-bottom: 0.85rem;
}

input {
  width: 100%;
  border: 1px solid rgba(96, 165, 250, 0.22);
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.96);
  color: #eff6ff;
  padding: 0.72rem 0.85rem;
  outline: none;
}

input:focus {
  border-color: rgba(125, 211, 252, 0.8);
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.15);
}

.entry-list {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  overflow: auto;
  min-height: 0;
}

.entry-button {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.35rem;
  padding: 0.85rem 0.9rem;
  border: 1px solid rgba(96, 165, 250, 0.22);
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.8);
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    transform 0.15s ease;
}

.entry-button:hover {
  border-color: rgba(125, 211, 252, 0.7);
  background: rgba(16, 33, 63, 0.92);
  transform: translateY(-1px);
}

.entry-button.active {
  border-color: rgba(125, 211, 252, 0.82);
  background: rgba(11, 47, 92, 0.85);
}

.entry-name {
  font-weight: 700;
}

.entry-meta,
.type-copy {
  color: rgba(191, 219, 254, 0.76);
  font-size: 0.83rem;
  line-height: 1.4;
}

.hero-card {
  padding: 1.1rem;
}

.hero-inner {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 1rem;
  align-items: center;
}

.sprite-frame {
  width: 124px;
  height: 124px;
  display: grid;
  place-items: center;
  padding: 0.75rem;
  border-radius: 18px;
  border: 1px solid rgba(96, 165, 250, 0.18);
  background: rgba(9, 18, 35, 0.7);
}

.sprite-frame img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
}

.hero-copy {
  min-width: 0;
}

.hero-heading {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: flex-start;
  margin-bottom: 0.9rem;
}

.hero-badges {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.summary-grid,
.stats-grid,
.capability-grid,
.skill-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.summary-grid div,
.stats-grid div,
.capability-grid div,
.skill-grid div {
  border: 1px solid rgba(96, 165, 250, 0.18);
  border-radius: 14px;
  padding: 0.75rem 0.85rem;
  background: rgba(9, 18, 35, 0.6);
}

.summary-grid dt,
.stats-grid dt,
.capability-grid dt,
.skill-grid dt {
  font-size: 0.76rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(125, 211, 252, 0.74);
}

.summary-grid dd,
.stats-grid dd,
.capability-grid dd,
.skill-grid dd {
  margin: 0.35rem 0 0;
  font-weight: 700;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.detail-wide {
  grid-column: 1 / -1;
}

.ability-groups {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}

.ability-groups > div,
.capability-other {
  border: 1px solid rgba(96, 165, 250, 0.18);
  border-radius: 14px;
  padding: 0.75rem 0.85rem;
  background: rgba(9, 18, 35, 0.6);
}

.ability-groups h4,
.capability-other h4 {
  margin: 0 0 0.6rem;
}

.ability-groups ul,
.capability-other ul {
  margin: 0;
  padding-left: 1.1rem;
  color: rgba(219, 234, 254, 0.9);
}

.table-wrap {
  overflow: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th,
 td {
  padding: 0.7rem 0.75rem;
  border-bottom: 1px solid rgba(96, 165, 250, 0.15);
  text-align: left;
}

th {
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(125, 211, 252, 0.74);
}

.json-block {
  margin: 0;
  padding: 1rem;
  border-radius: 14px;
  border: 1px solid rgba(96, 165, 250, 0.18);
  background: rgba(9, 18, 35, 0.75);
  color: #dbeafe;
  overflow: auto;
  line-height: 1.5;
}

.empty-card {
  max-width: 720px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

code {
  font-family: "SFMono-Regular", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.9em;
}

@media (max-width: 1200px) {
  .detail-grid,
  .ability-groups {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 1040px) {
  .pokedex-layout {
    grid-template-columns: 1fr;
  }

  .pokedex-sidebar {
    max-height: none;
    border-right: 0;
    border-bottom: 1px solid rgba(96, 165, 250, 0.2);
  }
}

@media (max-width: 720px) {
  .hero-inner,
  .summary-grid,
  .stats-grid,
  .capability-grid,
  .skill-grid {
    grid-template-columns: 1fr;
  }

  .hero-heading {
    flex-direction: column;
  }

  .hero-badges {
    justify-content: flex-start;
  }
}
</style>
