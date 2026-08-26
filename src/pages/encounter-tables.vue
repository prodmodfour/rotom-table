<script setup lang="ts">
import { PhArrowClockwise, PhLockKey, PhUploadSimple } from '@phosphor-icons/vue'
import AppNavigation from '~/components/AppNavigation.vue'
import EncounterToolkitNavigation from '~/components/encounters/EncounterToolkitNavigation.vue'
import EncounterToolkitTableDetail from '~/components/encounters/EncounterToolkitTableDetail.vue'
import EncounterToolkitTableEditor from '~/components/encounters/EncounterToolkitTableEditor.vue'
import EncounterToolkitTableLibrary from '~/components/encounters/EncounterToolkitTableLibrary.vue'
import { useAuth } from '~/composables/useAuth'
import { useGmCampaignToolkitTables } from '~/composables/encounters/useGmCampaignToolkitTables'

useHead({ title: 'Campaign Toolkit · Tables · Rotom Table' })

const { isGm } = useAuth()
const {
  visibleTables,
  selectedTable,
  sourceReview,
  draft,
  loading,
  detailLoading,
  saving,
  error,
  conflict,
  announcement,
  searchTerm,
  statusFilter,
  environmentFilter,
  minimumLevel,
  maximumLevel,
  environments,
  editorMode,
  refresh,
  selectTable: selectTableAuthority,
  beginCreate: beginCreateAuthority,
  beginEdit: beginEditAuthority,
  cancelEdit: cancelEditAuthority,
  saveDraft: saveDraftAuthority,
  archiveOrRestore,
  copySelected,
  exportSelected,
  importFile,
  reloadAfterConflict,
} = useGmCampaignToolkitTables()

const selectedTableId = computed(() => selectedTable.value?.tableId ?? null)
const importInput = ref<HTMLInputElement | null>(null)
const detailShell = ref<HTMLElement | null>(null)
const focusDetail = async (): Promise<void> => { await nextTick(); detailShell.value?.focus() }
const selectTable = async (table: (typeof visibleTables.value)[number]): Promise<void> => { await selectTableAuthority(table); await focusDetail() }
const beginCreate = async (): Promise<void> => { beginCreateAuthority(); await focusDetail() }
const beginEdit = async (): Promise<void> => { beginEditAuthority(); await focusDetail() }
const cancelEdit = async (): Promise<void> => { cancelEditAuthority(); await focusDetail() }
const saveDraft = async (): Promise<void> => { if (await saveDraftAuthority()) await focusDetail() }
const chooseImport = (): void => importInput.value?.click()
const onImport = async (event: Event): Promise<void> => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) await importFile(file)
  input.value = ''
}
</script>

<template>
  <div class="toolkit-page">
    <AppNavigation />

    <header class="toolkit-header">
      <div class="toolkit-title">
        <div>
          <p class="eyebrow">GM Workshop</p>
          <h1>Campaign Toolkit</h1>
        </div>
        <div class="header-actions">
          <input ref="importInput" class="sr-only" type="file" accept="application/json,.json" @change="onImport">
          <button type="button" class="utility-action" @click="chooseImport"><PhUploadSimple :size="18" aria-hidden="true" /> Import table</button>
          <button type="button" class="icon-action" aria-label="Refresh campaign tables" :disabled="loading" @click="refresh(true)"><PhArrowClockwise :size="20" :class="{ spinning: loading }" aria-hidden="true" /></button>
        </div>
      </div>
      <p class="toolkit-subtitle">Build reviewed campaign material, keep private preparation private, and hand accepted packages to the Encounter Builder.</p>
      <EncounterToolkitNavigation active="tables" />
    </header>

    <main v-if="isGm" class="toolkit-workspace">
      <div class="notice-stack" aria-live="polite">
        <div v-if="error" class="notice error" role="alert"><strong>Table action could not finish</strong><span>{{ error }}</span></div>
        <div v-if="conflict" class="notice conflict" role="alert">
          <div><strong>This table has a newer accepted revision</strong><span>{{ conflict }}</span></div>
          <button type="button" @click="reloadAfterConflict">Reload accepted revision</button>
        </div>
      </div>

      <div class="workspace-grid">
        <EncounterToolkitTableLibrary
          v-model:search-term="searchTerm"
          v-model:status-filter="statusFilter"
          v-model:environment-filter="environmentFilter"
          v-model:minimum-level="minimumLevel"
          v-model:maximum-level="maximumLevel"
          :tables="visibleTables"
          :selected-table-id="selectedTableId"
          :loading="loading"
          :environments="environments"
          @select="selectTable"
          @create="beginCreate"
        />

        <section ref="detailShell" class="detail-shell" aria-label="Selected encounter table" tabindex="-1">
          <div v-if="detailLoading" class="detail-state" role="status">Loading accepted revision…</div>
          <EncounterToolkitTableEditor
            v-else-if="draft && (editorMode === 'create' || editorMode === 'edit')"
            v-model="draft"
            :mode="editorMode"
            :saving="saving"
            @save="saveDraft"
            @cancel="cancelEdit"
          />
          <EncounterToolkitTableDetail
            v-else-if="selectedTable"
            :table="selectedTable"
            :source-review="sourceReview"
            :busy="saving"
            @edit="beginEdit"
            @copy="copySelected"
            @export="exportSelected"
            @archive="archiveOrRestore"
          />
          <div v-else class="detail-state">
            <strong>No table selected</strong>
            <span>Choose a campaign table or create a new one.</span>
            <button type="button" @click="beginCreate">Create encounter table</button>
          </div>
        </section>
      </div>
    </main>

    <main v-else class="access-gate">
      <PhLockKey :size="42" weight="duotone" aria-hidden="true" />
      <h2>GM preparation workspace</h2>
      <p>Campaign tables and generation material are available only to the active GM.</p>
    </main>

    <p class="sr-only" aria-live="polite">{{ announcement }}</p>
  </div>
</template>

<style scoped>
.toolkit-page { min-height: 100vh; background: radial-gradient(circle at 72% -8%, color-mix(in srgb, var(--accent) 9%, transparent), transparent 30rem), var(--paper); color: var(--ink); }
.toolkit-header { border-bottom: 1px solid var(--rule); padding: 1.5rem clamp(1rem, 4vw, 3rem) 0; background: color-mix(in srgb, var(--paper-soft) 90%, transparent); }
.toolkit-title { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; }
.eyebrow { margin: 0 0 0.3rem; color: var(--accent); font: 800 0.72rem var(--font-mono); letter-spacing: 0.13em; text-transform: uppercase; }
h1 { margin: 0; font-size: clamp(1.8rem, 4vw, 3rem); letter-spacing: -0.035em; }
.toolkit-subtitle { max-width: 760px; margin: 0.65rem 0 1.25rem; color: var(--ink-muted); line-height: 1.55; }
.header-actions { display: flex; gap: 0.45rem; }
.utility-action, .icon-action { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem; border: 1px solid var(--rule); border-radius: 9px; padding: 0.55rem 0.75rem; background: var(--paper-soft); color: var(--ink); font: inherit; font-weight: 750; cursor: pointer; }
.icon-action { width: 44px; padding: 0; }
.utility-action:hover, .icon-action:hover { border-color: var(--accent); color: var(--accent); }
.utility-action:focus-visible, .icon-action:focus-visible, .notice button:focus-visible, .detail-state button:focus-visible, .detail-shell:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.spinning { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.toolkit-workspace { max-width: 1580px; margin: 0 auto; padding: 1.15rem clamp(0.75rem, 2vw, 1.5rem) 2rem; }
.notice-stack { display: grid; gap: 0.55rem; margin-bottom: 0.8rem; }
.notice { display: flex; justify-content: space-between; align-items: center; gap: 1rem; border: 1px solid var(--rule); border-left-width: 4px; border-radius: 9px; padding: 0.7rem 0.85rem; background: var(--paper-soft); }
.notice > div, .notice.error { display: flex; flex-wrap: wrap; gap: 0.45rem 0.8rem; }
.notice strong { color: var(--ink); }
.notice span { color: var(--ink-muted); }
.notice.error { border-left-color: var(--accent-strong, #ff4553); }
.notice.conflict { border-left-color: #efb34c; }
.notice button { min-height: 44px; flex: none; border: 1px solid #efb34c; border-radius: 8px; padding: 0.45rem 0.65rem; background: transparent; color: #efb34c; font: inherit; font-weight: 750; cursor: pointer; }
.workspace-grid { display: grid; grid-template-columns: minmax(330px, 0.82fr) minmax(520px, 1.5fr); gap: 1rem; align-items: start; }
.detail-shell { min-width: 0; border: 1px solid var(--rule); border-radius: 16px; padding: clamp(1rem, 2.5vw, 1.5rem); background: var(--paper-soft); box-shadow: var(--shadow-card); }
.detail-state { min-height: 28rem; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.5rem; color: var(--ink-muted); text-align: center; }
.detail-state strong { color: var(--ink); font-size: 1.15rem; }
.detail-state button { min-height: 44px; margin-top: 0.45rem; border: 1px solid var(--accent); border-radius: 9px; padding: 0.6rem 0.85rem; background: var(--accent-soft); color: var(--accent); font: inherit; font-weight: 800; cursor: pointer; }
.access-gate { min-height: 55vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem; color: var(--ink-muted); text-align: center; }
.access-gate h2 { margin-bottom: 0.35rem; color: var(--ink); }
.access-gate p { margin-top: 0; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (max-width: 1040px) { .workspace-grid { grid-template-columns: 1fr; } }
@media (max-width: 620px) { .toolkit-title { flex-direction: column; } .header-actions, .utility-action { width: 100%; } .header-actions .icon-action { flex: none; } .notice { align-items: flex-start; flex-direction: column; } .notice button { width: 100%; } }
@media (prefers-reduced-motion: reduce) { .spinning { animation: none; } }
</style>
