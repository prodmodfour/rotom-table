<script setup lang="ts">
import { computed, ref } from 'vue'
import RefLink from '~/components/RefLink.vue'
import {
  trainerSheetsBySlug,
  resolveTrainerStats,
  resolveTrainerSkills,
  resolveTrainerCapabilities,
  resolveAdvancement,
  computeTrainerMaxHp,
  computeTrainerMaxAp,
  TRAINER_SKILL_ORDER,
} from '~/data/trainerSheets'
import type { TrainerSkillKey, TrainerStatKey } from '~/types/trainerSheet'

/** Map a skill key (``medicineEd``) back to its display label (``Medicine Ed``). */
const SKILL_LABEL: Record<TrainerSkillKey, string> = Object.fromEntries(
  TRAINER_SKILL_ORDER,
) as Record<TrainerSkillKey, string>

const skillLabel = (key: TrainerSkillKey | string): string =>
  SKILL_LABEL[key as TrainerSkillKey] ?? key

const skillLabels = (
  value: TrainerSkillKey | TrainerSkillKey[] | undefined,
): string => {
  if (!value) return ''
  return Array.isArray(value) ? value.map(skillLabel).join(', ') : skillLabel(value)
}

const route = useRoute()
const slug = String(route.params.slug ?? '')
const sheet = trainerSheetsBySlug.get(slug) ?? null

useHead(() => ({
  title: sheet ? `${sheet.name} · Trainer Sheet` : 'Trainer not found · Rotom Table',
}))

type TabKey = 'trainer' | 'combat' | 'inventory' | 'features' | 'edges'

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: 'trainer',   label: 'Trainer' },
  { key: 'combat',    label: 'Combat' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'features',  label: 'Features' },
  { key: 'edges',     label: 'Edges' },
]

const activeTab = ref<TabKey>('trainer')

// ---------------------------------------------------------------------------
// Derived data (computed once — sheet is static)
// ---------------------------------------------------------------------------

const stats     = computed(() => sheet ? resolveTrainerStats(sheet) : [])
const skills    = computed(() => sheet ? resolveTrainerSkills(sheet) : [])
const capRes    = computed(() => sheet ? resolveTrainerCapabilities(sheet) : { rows: [], other: [] })
const adv       = computed(() => sheet ? resolveAdvancement(sheet) : [])

const maxHp     = computed(() => sheet ? computeTrainerMaxHp(sheet) : 0)
const maxAp     = computed(() => sheet ? computeTrainerMaxAp(sheet) : 0)
const currentHp = computed(() => sheet?.currentHp ?? maxHp.value)
const apLeft    = computed(() => sheet?.ap?.left ?? maxAp.value)

const totalRow = (key: TrainerStatKey) =>
  stats.value.find((s) => s.key === key)?.total ?? 0

const injuries = computed(() => sheet?.currentInjuries ?? 0)
/** PTU: Trainer Injured HP threshold = floor(Max HP × (1 - 0.1 × injuries)). */
const injuredHp = computed(() =>
  Math.max(0, Math.floor(maxHp.value * (1 - 0.1 * injuries.value))),
)

const tickValue = computed(() => Math.max(1, Math.ceil(maxHp.value / 10)))

const orderedFeatures = computed(() => sheet?.features ?? [])
const orderedEdges    = computed(() => sheet?.edges ?? [])
const orderedClasses  = computed(() => sheet?.classes ?? [])
</script>

<template>
  <div class="sheet-detail">
    <header class="sheet-header">
      <AppNavigation />
      <div class="back-row">
        <NuxtLink to="/sheets" class="back-link">← All sheets</NuxtLink>
      </div>
    </header>

    <article v-if="sheet" class="sheet-card">
      <!-- ===== Identity strip ===== -->
      <header class="identity-strip">
        <div class="identity-info">
          <h1>{{ sheet.name }}</h1>
          <p class="identity-meta">
            Lv {{ sheet.level }}<span v-if="sheet.sex"> · {{ sheet.sex }}</span>
            <span v-if="sheet.age"> · Age {{ sheet.age }}</span>
            <span v-if="sheet.height"> · {{ sheet.height }}</span>
            <span v-if="sheet.weight"> · {{ sheet.weight }}</span>
          </p>
          <p v-if="sheet.playedBy" class="identity-played-by">
            Played by <strong>{{ sheet.playedBy }}</strong>
          </p>
        </div>
        <div class="identity-vitals">
          <div class="vital">
            <span class="vital-label">Max HP</span>
            <span class="vital-value">{{ currentHp }} <span class="vital-divider">/</span> {{ maxHp }}</span>
          </div>
          <div class="vital">
            <span class="vital-label">AP</span>
            <span class="vital-value">{{ apLeft }} <span class="vital-divider">/</span> {{ maxAp }}</span>
          </div>
          <div class="vital">
            <span class="vital-label">Injuries</span>
            <span class="vital-value">{{ injuries }}</span>
          </div>
          <div class="vital">
            <span class="vital-label">Money</span>
            <span class="vital-value">${{ (sheet.money ?? 0).toLocaleString() }}</span>
          </div>
        </div>
      </header>

      <!-- ===== Tab nav ===== -->
      <nav class="tab-nav" aria-label="Sheet tabs">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          :class="['tab-btn', { active: activeTab === tab.key }]"
          @click="activeTab = tab.key"
        >{{ tab.label }}</button>
      </nav>

      <!-- =================================================================== -->
      <!-- TRAINER TAB                                                          -->
      <!-- =================================================================== -->
      <section v-if="activeTab === 'trainer'" class="tab-panel">
        <div class="grid-two">
          <!-- Stats -->
          <div class="block">
            <h2 class="block-title">Stats</h2>
            <table class="data-table stats-table">
              <thead>
                <tr>
                  <th>Stat</th>
                  <th>Base</th>
                  <th>Feats</th>
                  <th>Bonus</th>
                  <th>Lvl-Up</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="s in stats" :key="s.key">
                  <th>{{ s.label }}</th>
                  <td>{{ s.base }}</td>
                  <td>{{ s.feats || '—' }}</td>
                  <td>{{ s.bonus || '—' }}</td>
                  <td>{{ s.levelUp || '—' }}</td>
                  <td><strong>{{ s.total }}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Skill background + counts -->
          <div class="block">
            <h2 class="block-title">Skill Background</h2>
            <div v-if="sheet.skillBackground" class="bg-card">
              <div class="bg-name">{{ sheet.skillBackground.name }}</div>
              <p v-if="sheet.skillBackground.description" class="bg-desc">
                {{ sheet.skillBackground.description }}
              </p>
              <ul class="bg-list">
                <li v-if="sheet.skillBackground.adept">
                  <span class="bg-tag adept">Adept</span>
                  <span>{{ skillLabels(sheet.skillBackground.adept) }}</span>
                </li>
                <li v-if="sheet.skillBackground.novice">
                  <span class="bg-tag novice">Novice</span>
                  <span>{{ skillLabels(sheet.skillBackground.novice) }}</span>
                </li>
                <li v-if="sheet.skillBackground.pathetic && sheet.skillBackground.pathetic.length">
                  <span class="bg-tag pathetic">Pathetic</span>
                  <span>{{ skillLabels(sheet.skillBackground.pathetic) }}</span>
                </li>
              </ul>
            </div>

            <h2 class="block-title block-title--spaced">Milestones</h2>
            <ul class="kv-list">
              <li><span>Milestones</span><strong>{{ sheet.milestones ?? 0 }}</strong></li>
              <li><span>Dex EXP</span><strong>{{ sheet.dexExp ?? 0 }}</strong></li>
              <li><span>Misc EXP</span><strong>{{ sheet.miscExp ?? 0 }}</strong></li>
              <li><span>Bonus Skill Edges</span><strong>{{ sheet.bonusSkillEdges ?? 0 }}</strong></li>
              <li><span>Features remaining</span><strong>{{ sheet.remainingFeatures ?? 0 }}</strong></li>
              <li><span>Edges remaining</span><strong>{{ sheet.remainingEdges ?? 0 }}</strong></li>
            </ul>
          </div>
        </div>

        <!-- Skills grid -->
        <div class="block">
          <h2 class="block-title">Skills</h2>
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
              <span class="skill-rank">{{ s.rank }}</span>
              <span class="skill-dice">{{ s.dice }}<span v-if="s.modifier">{{ s.modifier > 0 ? '+' : '' }}{{ s.modifier }}</span></span>
            </div>
          </div>
        </div>

        <!-- Classes -->
        <div v-if="orderedClasses.length" class="block">
          <h2 class="block-title">Trainer Classes</h2>
          <ul class="ref-list-vertical">
            <li v-for="cls in orderedClasses" :key="cls.name">
              <RefLink kind="feature" :name="cls.name" />
              <span v-if="cls.specialisation" class="cls-spec">({{ cls.specialisation }})</span>
              <span v-if="cls.notes" class="cls-notes">— {{ cls.notes }}</span>
            </li>
          </ul>
        </div>

        <!-- Training feature -->
        <div v-if="sheet.trainingFeature" class="block">
          <h2 class="block-title">Training Feature</h2>
          <p><RefLink kind="feature" :name="sheet.trainingFeature" /></p>
        </div>

        <!-- Advancement -->
        <div class="block">
          <h2 class="block-title">Trainer Advancement</h2>
          <table class="data-table adv-table">
            <thead>
              <tr><th>Level</th><th>Stats</th><th>Att</th><th>Sp.Att</th><th>Notes</th></tr>
            </thead>
            <tbody>
              <tr v-for="row in adv" :key="row.level">
                <th>Lv {{ row.level }}</th>
                <td>{{ row.stats ?? '—' }}</td>
                <td>{{ row.attack ?? '—' }}</td>
                <td>{{ row.spAttack ?? '—' }}</td>
                <td class="notes-col">{{ row.notes ?? '' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Team / wishlist -->
        <div class="grid-two">
          <div v-if="sheet.currentTeam?.length" class="block">
            <h2 class="block-title">Current Team</h2>
            <ul class="ref-list-vertical">
              <li v-for="memberSlug in sheet.currentTeam" :key="memberSlug">
                <NuxtLink :to="`/sheets/${memberSlug}`">{{ memberSlug }}</NuxtLink>
              </li>
            </ul>
          </div>
          <div v-if="sheet.wishlist?.length" class="block">
            <h2 class="block-title">Pokémon Wishlist</h2>
            <ul class="chip-row">
              <li v-for="entry in sheet.wishlist" :key="entry">{{ entry }}</li>
            </ul>
          </div>
        </div>

        <!-- Narrative blocks -->
        <div class="narrative-grid">
          <div v-if="sheet.physicalDescription" class="narrative narrative--red">
            <h3>Physical Description</h3>
            <p>{{ sheet.physicalDescription }}</p>
          </div>
          <div v-if="sheet.background" class="narrative narrative--yellow">
            <h3>Background</h3>
            <p>{{ sheet.background }}</p>
          </div>
          <div v-if="sheet.personality" class="narrative narrative--purple">
            <h3>Personality</h3>
            <p>{{ sheet.personality }}</p>
          </div>
          <div v-if="sheet.goalsAndDreams" class="narrative narrative--green">
            <h3>Goals / Dreams / Obsessions</h3>
            <p>{{ sheet.goalsAndDreams }}</p>
          </div>
        </div>
      </section>

      <!-- =================================================================== -->
      <!-- COMBAT TAB                                                           -->
      <!-- =================================================================== -->
      <section v-if="activeTab === 'combat'" class="tab-panel">
        <div class="combat-strip">
          <div class="combat-cell"><span>Current HP</span><strong>{{ currentHp }}</strong></div>
          <div class="combat-cell"><span>Max HP</span><strong>{{ maxHp }}</strong></div>
          <div class="combat-cell"><span>Injured HP</span><strong>{{ injuredHp }}</strong></div>
          <div class="combat-cell"><span>Tick</span><strong>{{ tickValue }}</strong></div>
          <div class="combat-cell"><span>DR</span><strong>{{ sheet.damageReduction ?? 0 }}</strong></div>
          <div class="combat-cell"><span>Lv</span><strong>{{ sheet.level }}</strong></div>
          <div class="combat-cell"><span>CS Atk</span><strong>{{ totalRow('atk') }}</strong></div>
          <div class="combat-cell"><span>CS SAtk</span><strong>{{ totalRow('satk') }}</strong></div>
          <div class="combat-cell"><span>Speed</span><strong>{{ totalRow('spd') }}</strong></div>
        </div>

        <div class="grid-two">
          <div class="block">
            <h2 class="block-title">Action Points</h2>
            <table class="data-table ap-table">
              <thead><tr><th>Left</th><th>Spent</th><th>Bound</th><th>Drained</th><th>Max</th></tr></thead>
              <tbody>
                <tr>
                  <td>{{ sheet.ap?.left ?? maxAp }}</td>
                  <td>{{ sheet.ap?.spent ?? 0 }}</td>
                  <td>{{ sheet.ap?.bound ?? 0 }}</td>
                  <td>{{ sheet.ap?.drained ?? 0 }}</td>
                  <td><strong>{{ maxAp }}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="block">
            <h2 class="block-title">Evasion</h2>
            <ul class="kv-list">
              <li><span>Speed Evasion</span><strong>{{ sheet.evasion?.speed ?? 0 }}</strong></li>
              <li><span>Physical Evasion</span><strong>{{ sheet.evasion?.physical ?? 0 }}</strong></li>
              <li><span>Special Evasion</span><strong>{{ sheet.evasion?.special ?? 0 }}</strong></li>
            </ul>
            <p v-if="sheet.statusAfflictions" class="muted">
              <strong>Status:</strong> {{ sheet.statusAfflictions }}
            </p>
            <p v-if="sheet.digestion" class="muted">
              <strong>Digestion:</strong> {{ sheet.digestion }}
            </p>
          </div>
        </div>

        <div class="block">
          <h2 class="block-title">Capabilities</h2>
          <ul class="cap-grid">
            <li v-for="cap in capRes.rows" :key="cap.label">
              <span class="cap-label">{{ cap.label }}</span>
              <span class="cap-value">{{ cap.value }}</span>
            </li>
          </ul>
          <ul v-if="capRes.other.length" class="chip-row" style="margin-top: 0.6rem">
            <li v-for="o in capRes.other" :key="o"><RefLink kind="capability" :name="o" /></li>
          </ul>
        </div>

        <div class="block">
          <h2 class="block-title">Movelist</h2>
          <table v-if="sheet.movelist?.length" class="data-table movelist-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Cat.</th>
                <th>DB</th>
                <th>Damage Roll</th>
                <th>Frequency</th>
                <th>AC</th>
                <th>Range</th>
                <th>Effect</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(mv, idx) in sheet.movelist" :key="`${mv.name}-${idx}`">
                <th><RefLink kind="move" :name="mv.name" /></th>
                <td>
                  <span v-if="mv.type" class="type-pill" :data-type="mv.type">{{ mv.type }}</span>
                </td>
                <td>{{ mv.category ?? '' }}</td>
                <td>{{ mv.db ?? '' }}</td>
                <td>{{ mv.damageRoll ?? '' }}<span v-if="mv.damageRollMod">{{ mv.damageRollMod > 0 ? '+' : '' }}{{ mv.damageRollMod }}</span></td>
                <td>{{ mv.frequency ?? '' }}</td>
                <td>{{ mv.ac ?? '' }}</td>
                <td>{{ mv.range ?? '' }}</td>
                <td class="effect-col">{{ mv.effect ?? '' }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="muted">No moves recorded.</p>
        </div>

        <div v-if="sheet.abilities?.length" class="block">
          <h2 class="block-title">Abilities</h2>
          <ul class="kv-list">
            <li v-for="(a, idx) in sheet.abilities" :key="`${a.name}-${idx}`">
              <span><RefLink kind="ability" :name="a.name" /><span v-if="a.frequency" class="muted"> · {{ a.frequency }}</span></span>
              <span class="effect-col">{{ a.effect ?? '' }}</span>
            </li>
          </ul>
        </div>

        <div v-if="sheet.maneuvers?.length" class="block">
          <h2 class="block-title">Maneuvers</h2>
          <table class="data-table">
            <thead><tr><th>Name</th><th>Action</th><th>Cat.</th><th>AC</th><th>Range</th><th>Effect</th></tr></thead>
            <tbody>
              <tr v-for="(m, idx) in sheet.maneuvers" :key="`${m.name}-${idx}`">
                <th>{{ m.name }}</th>
                <td>{{ m.action ?? '' }}</td>
                <td>{{ m.category ?? '' }}</td>
                <td>{{ m.ac ?? '' }}</td>
                <td>{{ m.range ?? '' }}</td>
                <td class="effect-col">{{ m.effect ?? '' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="sheet.orders?.length" class="block">
          <h2 class="block-title">Pokémon Training &amp; Orders</h2>
          <ul class="kv-list">
            <li v-for="(o, idx) in sheet.orders" :key="`${o.name}-${idx}`">
              <span>
                <strong>{{ o.name }}</strong>
                <span v-if="o.tags?.length" class="muted"> · {{ o.tags.join(', ') }}</span>
              </span>
              <span class="effect-col">{{ o.effect ?? '' }}</span>
            </li>
          </ul>
        </div>
      </section>

      <!-- =================================================================== -->
      <!-- INVENTORY TAB                                                        -->
      <!-- =================================================================== -->
      <section v-if="activeTab === 'inventory'" class="tab-panel">
        <div v-if="sheet.equipmentSlots" class="block">
          <h2 class="block-title">Equipped</h2>
          <ul class="kv-list">
            <li><span>Main Hand</span><strong>{{ sheet.equipmentSlots.mainHand ?? '—' }}</strong></li>
            <li><span>Off Hand</span><strong>{{ sheet.equipmentSlots.offHand ?? '—' }}</strong></li>
            <li><span>Head</span><strong>{{ sheet.equipmentSlots.head ?? '—' }}</strong></li>
            <li><span>Body</span><strong>{{ sheet.equipmentSlots.body ?? '—' }}</strong></li>
            <li><span>Feet</span><strong>{{ sheet.equipmentSlots.feet ?? '—' }}</strong></li>
            <li><span>Accessory</span><strong>{{ sheet.equipmentSlots.accessory ?? '—' }}</strong></li>
          </ul>
        </div>

        <div class="grid-two">
          <div class="block inv-block inv-key">
            <h2 class="block-title">Key Items</h2>
            <table class="data-table inv-table">
              <thead><tr><th>Name</th><th>Qty</th><th>Cost</th><th>Description</th></tr></thead>
              <tbody>
                <tr v-for="(it, idx) in sheet.inventory?.keyItems ?? []" :key="`${it.name}-${idx}`">
                  <th>{{ it.name }}</th>
                  <td>{{ it.qty ?? '' }}</td>
                  <td>{{ it.cost ?? '' }}</td>
                  <td class="effect-col">{{ it.description ?? '' }}</td>
                </tr>
                <tr v-if="!sheet.inventory?.keyItems?.length"><td colspan="4" class="muted">—</td></tr>
              </tbody>
            </table>
          </div>

          <div class="block inv-block inv-pkmn">
            <h2 class="block-title">Pokémon Items</h2>
            <table class="data-table inv-table">
              <thead><tr><th>Name</th><th>Qty</th><th>Cost</th><th>Description</th></tr></thead>
              <tbody>
                <tr v-for="(it, idx) in sheet.inventory?.pokemonItems ?? []" :key="`${it.name}-${idx}`">
                  <th>{{ it.name }}</th>
                  <td>{{ it.qty ?? '' }}</td>
                  <td>{{ it.cost ?? '' }}</td>
                  <td class="effect-col">{{ it.description ?? '' }}</td>
                </tr>
                <tr v-if="!sheet.inventory?.pokemonItems?.length"><td colspan="4" class="muted">—</td></tr>
              </tbody>
            </table>
          </div>

          <div class="block inv-block inv-med">
            <h2 class="block-title">Medical Kit</h2>
            <table class="data-table inv-table">
              <thead><tr><th>Name</th><th>Qty</th><th>Cost</th><th>Description</th></tr></thead>
              <tbody>
                <tr v-for="(it, idx) in sheet.inventory?.medicalKit ?? []" :key="`${it.name}-${idx}`">
                  <th>{{ it.name }}</th>
                  <td>{{ it.qty ?? '' }}</td>
                  <td>{{ it.cost ?? '' }}</td>
                  <td class="effect-col">{{ it.description ?? '' }}</td>
                </tr>
                <tr v-if="!sheet.inventory?.medicalKit?.length"><td colspan="4" class="muted">—</td></tr>
              </tbody>
            </table>
          </div>

          <div class="block inv-block inv-balls">
            <h2 class="block-title">Poké Balls &amp; Accessories</h2>
            <table class="data-table inv-table">
              <thead><tr><th>Name</th><th>Qty</th><th>Cost</th><th>Mod</th><th>Description</th></tr></thead>
              <tbody>
                <tr v-for="(it, idx) in sheet.inventory?.pokeBalls ?? []" :key="`${it.name}-${idx}`">
                  <th>{{ it.name }}</th>
                  <td>{{ it.qty ?? '' }}</td>
                  <td>{{ it.cost ?? '' }}</td>
                  <td>{{ it.mod ?? '' }}</td>
                  <td class="effect-col">{{ it.description ?? '' }}</td>
                </tr>
                <tr v-if="!sheet.inventory?.pokeBalls?.length"><td colspan="5" class="muted">—</td></tr>
              </tbody>
            </table>
          </div>

          <div class="block inv-block inv-food">
            <h2 class="block-title">Food Stuff</h2>
            <table class="data-table inv-table">
              <thead><tr><th>Name</th><th>Qty</th><th>Cost</th><th>Description</th></tr></thead>
              <tbody>
                <tr v-for="(it, idx) in sheet.inventory?.foodStuff ?? []" :key="`${it.name}-${idx}`">
                  <th>{{ it.name }}</th>
                  <td>{{ it.qty ?? '' }}</td>
                  <td>{{ it.cost ?? '' }}</td>
                  <td class="effect-col">{{ it.description ?? '' }}</td>
                </tr>
                <tr v-if="!sheet.inventory?.foodStuff?.length"><td colspan="4" class="muted">—</td></tr>
              </tbody>
            </table>
          </div>

          <div class="block inv-block inv-equip">
            <h2 class="block-title">Equipment</h2>
            <table class="data-table inv-table">
              <thead><tr><th>Name</th><th>Slot</th><th>Cost</th><th>Description</th></tr></thead>
              <tbody>
                <tr v-for="(it, idx) in sheet.inventory?.equipment ?? []" :key="`${it.name}-${idx}`">
                  <th>{{ it.name }}</th>
                  <td>{{ it.slot ?? '' }}</td>
                  <td>{{ it.cost ?? '' }}</td>
                  <td class="effect-col">{{ it.description ?? '' }}</td>
                </tr>
                <tr v-if="!sheet.inventory?.equipment?.length"><td colspan="4" class="muted">—</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- =================================================================== -->
      <!-- FEATURES TAB                                                         -->
      <!-- =================================================================== -->
      <section v-if="activeTab === 'features'" class="tab-panel">
        <div class="block">
          <h2 class="block-title">Features ({{ orderedFeatures.length }})</h2>
          <table v-if="orderedFeatures.length" class="data-table feat-table">
            <thead>
              <tr>
                <th>Feature</th>
                <th>Tags</th>
                <th>Frequency / Action</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(f, idx) in orderedFeatures" :key="`${f.name}-${idx}`">
                <th><RefLink kind="feature" :name="f.name" /></th>
                <td>
                  <span v-for="t in f.tags ?? []" :key="t" class="badge tag-badge">{{ t }}</span>
                </td>
                <td>{{ f.frequency ?? '' }}</td>
                <td class="effect-col">{{ f.notes ?? '' }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="muted">No features taken.</p>
        </div>
      </section>

      <!-- =================================================================== -->
      <!-- EDGES TAB                                                            -->
      <!-- =================================================================== -->
      <section v-if="activeTab === 'edges'" class="tab-panel">
        <div class="block">
          <h2 class="block-title">Edges ({{ orderedEdges.length }})</h2>
          <table v-if="orderedEdges.length" class="data-table feat-table">
            <thead>
              <tr><th>Edge</th><th>Notes</th></tr>
            </thead>
            <tbody>
              <tr v-for="(e, idx) in orderedEdges" :key="`${e.name}-${idx}`">
                <th><RefLink kind="edge" :name="e.name" /></th>
                <td class="effect-col">{{ e.notes ?? '' }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="muted">No edges taken.</p>
        </div>
      </section>
    </article>

    <article v-else class="sheet-card">
      <h1>Trainer not found</h1>
      <p>No trainer for slug <code>{{ slug }}</code>.</p>
      <NuxtLink to="/sheets" class="back-link">← Back to all sheets</NuxtLink>
    </article>
  </div>
</template>

<style scoped>
.sheet-detail {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 0.85rem;
  min-height: 100vh;
  background:
    radial-gradient(circle at top, rgba(37, 99, 235, 0.1), transparent 35%),
    #050d1b;
  color: #eff6ff;
}

.sheet-header {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.back-link {
  color: #bae6fd;
  text-decoration: underline;
  text-decoration-color: rgba(186, 230, 253, 0.45);
  text-underline-offset: 0.18em;
}

.sheet-card {
  border: 1px solid rgba(96, 165, 250, 0.22);
  border-radius: 18px;
  background: rgba(8, 20, 43, 0.82);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.22);
  padding: 1rem;
}

/* ===== Identity ===== */
.identity-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 0.85rem;
  border-bottom: 1px solid rgba(96, 165, 250, 0.18);
}

.identity-info h1 {
  margin: 0 0 0.25rem;
  font-size: 1.6rem;
  letter-spacing: 0.02em;
}

.identity-meta {
  margin: 0;
  color: rgba(191, 219, 254, 0.85);
}

.identity-played-by {
  margin: 0.25rem 0 0;
  color: rgba(191, 219, 254, 0.65);
  font-size: 0.85rem;
}

.identity-vitals {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 0.45rem;
  min-width: 320px;
}

.vital {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.45rem 0.6rem;
  border: 1px solid rgba(96, 165, 250, 0.18);
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.72);
}

.vital-label {
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(191, 219, 254, 0.62);
}

.vital-value {
  font-size: 1.15rem;
  font-weight: 700;
  color: #f0f9ff;
}

.vital-divider {
  color: rgba(191, 219, 254, 0.45);
  font-weight: 400;
  margin: 0 0.18rem;
}

/* ===== Tabs ===== */
.tab-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin: 0.85rem 0;
}

.tab-btn {
  padding: 0.55rem 0.95rem;
  border: 1px solid rgba(96, 165, 250, 0.22);
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.72);
  color: #dbeafe;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}

.tab-btn:hover { border-color: rgba(125, 211, 252, 0.7); }

.tab-btn.active {
  background: rgba(11, 47, 92, 0.85);
  border-color: rgba(125, 211, 252, 0.82);
  color: #eff6ff;
}

.tab-panel {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

/* ===== Generic blocks ===== */
.grid-two {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 0.85rem;
}

.block {
  border: 1px solid rgba(96, 165, 250, 0.18);
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.62);
  padding: 0.7rem 0.85rem;
}

.block-title {
  margin: 0 0 0.5rem;
  font-size: 0.95rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(125, 211, 252, 0.85);
}

.block-title--spaced { margin-top: 0.85rem; }

.muted { color: rgba(191, 219, 254, 0.6); font-size: 0.85rem; }

/* ===== Tables ===== */
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.86rem;
}

.data-table th,
.data-table td {
  padding: 0.32rem 0.5rem;
  text-align: left;
  border-bottom: 1px solid rgba(96, 165, 250, 0.12);
}

.data-table th {
  font-weight: 600;
  color: #e0f2fe;
}

.data-table thead th {
  font-size: 0.74rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(186, 230, 253, 0.75);
  background: rgba(15, 23, 42, 0.55);
}

.stats-table tbody th { color: #fde68a; }

/* Skills */
.skills-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 0.3rem;
}

.skill-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: baseline;
  gap: 0.35rem;
  padding: 0.32rem 0.5rem;
  border: 1px solid rgba(96, 165, 250, 0.14);
  border-radius: 10px;
  background: rgba(8, 20, 43, 0.65);
}

.skill-row.raised {
  border-color: rgba(74, 222, 128, 0.4);
  background: rgba(20, 83, 45, 0.32);
}

.skill-row.lowered {
  border-color: rgba(248, 113, 113, 0.4);
  background: rgba(127, 29, 29, 0.28);
}

.skill-label { color: #e0f2fe; font-weight: 500; font-size: 0.86rem; }
.skill-rank  { color: rgba(186, 230, 253, 0.85); font-size: 0.78rem; }
.skill-dice  { color: #fde68a; font-weight: 700; font-size: 0.82rem; }

/* Background card */
.bg-card { display: flex; flex-direction: column; gap: 0.4rem; }
.bg-name { font-size: 1.05rem; font-weight: 700; color: #fde68a; }
.bg-desc { margin: 0; color: rgba(191, 219, 254, 0.78); font-size: 0.85rem; }

.bg-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.bg-list li {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.85rem;
}

.bg-tag {
  display: inline-flex;
  padding: 0.12rem 0.55rem;
  border-radius: 999px;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  border: 1px solid transparent;
}

.bg-tag.adept    { background: rgba(74, 222, 128, 0.2);  color: #bbf7d0; border-color: rgba(74, 222, 128, 0.4); }
.bg-tag.novice   { background: rgba(56, 189, 248, 0.18); color: #bae6fd; border-color: rgba(56, 189, 248, 0.4); }
.bg-tag.pathetic { background: rgba(248, 113, 113, 0.2); color: #fecaca; border-color: rgba(248, 113, 113, 0.4); }

/* Key/value lists */
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
  border-bottom: 1px dashed rgba(96, 165, 250, 0.12);
  font-size: 0.86rem;
}

.kv-list li:last-child { border-bottom: 0; }

.ref-list-vertical {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.32rem;
}

.cls-spec  { color: rgba(252, 211, 77, 0.92); margin-left: 0.3rem; }
.cls-notes { color: rgba(191, 219, 254, 0.7); margin-left: 0.4rem; }

/* Combat strip */
.combat-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
  gap: 0.4rem;
}

.combat-cell {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.4rem 0.5rem;
  border: 1px solid rgba(96, 165, 250, 0.18);
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.72);
  text-align: center;
}

.combat-cell span { font-size: 0.7rem; letter-spacing: 0.05em; text-transform: uppercase; color: rgba(191, 219, 254, 0.6); }
.combat-cell strong { font-size: 1.1rem; color: #fde68a; }

/* Capabilities */
.cap-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 0.35rem;
}

.cap-grid li {
  display: flex;
  justify-content: space-between;
  padding: 0.3rem 0.5rem;
  border: 1px solid rgba(96, 165, 250, 0.14);
  border-radius: 10px;
  background: rgba(8, 20, 43, 0.6);
}

.cap-label { color: rgba(191, 219, 254, 0.78); font-size: 0.82rem; }
.cap-value { color: #fde68a; font-weight: 700; font-size: 0.92rem; }

.chip-row {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.32rem;
}

.chip-row li {
  padding: 0.2rem 0.55rem;
  border: 1px solid rgba(96, 165, 250, 0.18);
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.72);
  font-size: 0.78rem;
  color: rgba(191, 219, 254, 0.85);
}

/* Movelist columns */
.movelist-table th,
.movelist-table td { vertical-align: top; }
.effect-col { color: rgba(191, 219, 254, 0.82); white-space: pre-wrap; max-width: 22rem; }
.notes-col { color: rgba(191, 219, 254, 0.6); }

/* Tag badges */
.tag-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.1rem 0.45rem;
  background: rgba(168, 85, 247, 0.22);
  color: #ddd6fe;
  font-size: 0.7rem;
  margin-right: 0.2rem;
}

/* Narrative panels */
.narrative-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 0.6rem;
}

.narrative {
  border-radius: 14px;
  padding: 0.7rem 0.85rem;
  border: 1px solid;
}

.narrative h3 {
  margin: 0 0 0.35rem;
  font-size: 0.95rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.narrative p { margin: 0; line-height: 1.5; color: rgba(238, 242, 255, 0.92); font-size: 0.88rem; }

.narrative--red    { background: rgba(127, 29, 29, 0.32); border-color: rgba(248, 113, 113, 0.45); }
.narrative--red h3 { color: #fecaca; }

.narrative--yellow { background: rgba(120, 53, 15, 0.32); border-color: rgba(252, 211, 77, 0.45); }
.narrative--yellow h3 { color: #fde68a; }

.narrative--purple { background: rgba(76, 29, 149, 0.32); border-color: rgba(192, 132, 252, 0.45); }
.narrative--purple h3 { color: #ddd6fe; }

.narrative--green  { background: rgba(20, 83, 45, 0.32); border-color: rgba(74, 222, 128, 0.45); }
.narrative--green h3 { color: #bbf7d0; }
</style>
