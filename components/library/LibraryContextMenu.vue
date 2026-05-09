<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { PhArrowsOutCardinal, PhPencilSimple, PhTrash } from '@phosphor-icons/vue'
import type { FolderMoveDestination } from '~/utils/folderBrowser'

type ContextMode = 'menu' | 'rename' | 'move' | 'delete'

const props = withDefaults(defineProps<{
  x: number
  y: number
  targetKind: string
  targetLabel: string
  isFolderTarget: boolean
  mode: ContextMode
  input: string
  busy: boolean
  error: string | null
  moveDestinations: FolderMoveDestination[]
  deleteFolderSuffix: string
  deleteItemSuffix: string
}>(), {
  error: null,
})

const emit = defineEmits<{
  'update:input': [value: string]
  close: []
  enterMove: []
  enterRename: []
  enterDelete: []
  submit: []
}>()

const inputRef = ref<HTMLInputElement | HTMLSelectElement | null>(null)

const focusInput = async () => {
  if (props.mode !== 'move' && props.mode !== 'rename') return
  await nextTick()
  inputRef.value?.focus()
  if (props.mode === 'rename' && inputRef.value && 'select' in inputRef.value) {
    inputRef.value.select()
  }
}

watch(() => props.mode, () => {
  void focusInput()
})

onMounted(() => {
  void focusInput()
})
</script>

<template>
  <div class="ctx-backdrop" @click="emit('close')" @contextmenu.prevent="emit('close')"></div>
  <div
    class="ctx-menu"
    role="menu"
    :style="{ left: `${x}px`, top: `${y}px` }"
    @click.stop
    @contextmenu.prevent
  >
    <header class="ctx-header">
      <span class="ctx-kind">{{ targetKind }}</span>
      <span class="ctx-target">{{ targetLabel }}</span>
    </header>

    <template v-if="mode === 'menu'">
      <button type="button" class="ctx-item" role="menuitem" @click="emit('enterMove')">
        <PhArrowsOutCardinal :size="16" weight="bold" />
        <span>Move…</span>
      </button>
      <button type="button" class="ctx-item" role="menuitem" @click="emit('enterRename')">
        <PhPencilSimple :size="16" weight="bold" />
        <span>Rename…</span>
      </button>
      <button type="button" class="ctx-item ctx-item--danger" role="menuitem" @click="emit('enterDelete')">
        <PhTrash :size="16" weight="bold" />
        <span>Delete</span>
      </button>
    </template>

    <form v-else-if="mode === 'rename'" class="ctx-form" @submit.prevent="emit('submit')">
      <label class="ctx-label">
        New name
        <input
          ref="inputRef"
          :value="input"
          type="text"
          class="ctx-input"
          :disabled="busy"
          @input="emit('update:input', ($event.target as HTMLInputElement).value)"
          @keydown.escape.prevent="emit('close')"
        />
      </label>
      <p v-if="error" class="ctx-error" role="alert">{{ error }}</p>
      <div class="ctx-actions">
        <button type="button" class="ctx-btn" :disabled="busy" @click="emit('close')">Cancel</button>
        <button type="submit" class="ctx-btn ctx-btn--primary" :disabled="busy">Rename</button>
      </div>
    </form>

    <form v-else-if="mode === 'move'" class="ctx-form" @submit.prevent="emit('submit')">
      <label class="ctx-label">
        Move to
        <select
          ref="inputRef"
          :value="input"
          class="ctx-input"
          :disabled="busy || moveDestinations.length === 0"
          @change="emit('update:input', ($event.target as HTMLSelectElement).value)"
          @keydown.escape.prevent="emit('close')"
        >
          <option v-if="moveDestinations.length === 0" value="" disabled>
            No other destinations
          </option>
          <option v-for="d in moveDestinations" :key="`d-${d.value}`" :value="d.value">
            {{ d.label }}
          </option>
        </select>
      </label>
      <p v-if="error" class="ctx-error" role="alert">{{ error }}</p>
      <div class="ctx-actions">
        <button type="button" class="ctx-btn" :disabled="busy" @click="emit('close')">Cancel</button>
        <button
          type="submit"
          class="ctx-btn ctx-btn--primary"
          :disabled="busy || moveDestinations.length === 0"
        >
          Move
        </button>
      </div>
    </form>

    <div v-else-if="mode === 'delete'" class="ctx-form">
      <p class="ctx-confirm">
        <template v-if="isFolderTarget">
          Delete folder <strong>{{ targetLabel }}</strong> {{ deleteFolderSuffix }}
        </template>
        <template v-else>
          Delete {{ targetKind.toLowerCase() }} <strong>{{ targetLabel }}</strong>{{ deleteItemSuffix }}
        </template>
      </p>
      <p v-if="error" class="ctx-error" role="alert">{{ error }}</p>
      <div class="ctx-actions">
        <button type="button" class="ctx-btn" :disabled="busy" @click="emit('close')">Cancel</button>
        <button type="button" class="ctx-btn ctx-btn--danger" :disabled="busy" @click="emit('submit')">
          Delete
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ctx-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: transparent;
}

.ctx-menu {
  position: fixed;
  z-index: 50;
  min-width: 220px;
  max-width: min(320px, 90vw);
  border: 1px solid var(--rule);
  border-radius: 10px;
  background: var(--paper-soft);
  color: var(--ink);
  box-shadow: var(--shadow-card), 0 8px 24px rgba(0, 0, 0, 0.35);
  padding: 0.4rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.ctx-header {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.4rem 0.55rem 0.55rem;
  border-bottom: 1px solid var(--rule-soft);
  margin-bottom: 0.25rem;
}

.ctx-kind {
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.ctx-target {
  font-family: var(--font-book);
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--ink-bright);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ctx-item {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.45rem 0.6rem;
  border: none;
  background: transparent;
  color: var(--ink);
  font: inherit;
  text-align: left;
  border-radius: 7px;
  cursor: pointer;
}

.ctx-item:hover,
.ctx-item:focus-visible {
  background: var(--paper-hover);
  color: var(--ink-bright);
  outline: none;
}

.ctx-item--danger {
  color: #d36464;
}

.ctx-item--danger:hover,
.ctx-item--danger:focus-visible {
  background: rgba(220, 80, 80, 0.16);
  color: #f08585;
}

.ctx-form {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  padding: 0.35rem 0.55rem 0.55rem;
}

.ctx-label {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.ctx-input {
  font: inherit;
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.5rem 0.65rem;
  outline: none;
}

.ctx-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.18);
}

.ctx-confirm {
  margin: 0;
  color: var(--ink-soft);
  line-height: 1.4;
  font-size: 0.9rem;
}

.ctx-error {
  margin: 0;
  color: #d36464;
  font-size: 0.82rem;
}

.ctx-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.4rem;
}

.ctx-btn {
  border: 1px solid var(--rule);
  border-radius: 8px;
  background: var(--paper-soft);
  color: var(--ink);
  padding: 0.45rem 0.85rem;
  font: inherit;
  cursor: pointer;
  letter-spacing: 0.04em;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.ctx-btn:hover:not(:disabled) {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
  color: var(--ink-bright);
}

.ctx-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ctx-btn--primary {
  border-color: var(--accent);
  color: var(--accent);
}

.ctx-btn--danger {
  border-color: rgba(220, 80, 80, 0.6);
  color: #d36464;
}

.ctx-btn--danger:hover:not(:disabled) {
  background: rgba(220, 80, 80, 0.16);
  color: #f08585;
}
</style>
