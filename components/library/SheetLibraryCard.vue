<script setup lang="ts">
import LibraryCardMedia from '~/components/library/LibraryCardMedia.vue'
import LibraryCardShell from '~/components/library/LibraryCardShell.vue'
import type { SheetLibraryItem } from '~/utils/sheetLibrary'
import { sheetEditorPath } from '~/utils/sheetRoutes'

defineProps<{
  item: SheetLibraryItem
  canDrag: boolean
  isDraggingSelf: boolean
}>()

const emit = defineEmits<{
  contextmenu: [event: MouseEvent, item: SheetLibraryItem]
  dragstart: [event: DragEvent, item: SheetLibraryItem]
  dragend: []
}>()
</script>

<template>
  <LibraryCardShell
    :to="sheetEditorPath(item.kind, item.slug)"
    :can-drag="canDrag"
    :is-dragging-self="isDraggingSelf"
    :variant="item.kind === 'trainer' ? 'accented' : 'default'"
    @contextmenu="emit('contextmenu', $event, item)"
    @dragstart="emit('dragstart', $event, item)"
    @dragend="emit('dragend')"
  >
    <template v-if="item.kind === 'pokemon'">
      <LibraryCardMedia
        :image-url="item.spriteUrl"
        :image-alt="item.sheet.species"
        fallback-label="?"
      />
      <div class="sheet-card__body">
        <div class="sheet-card__heading">
          <h3>{{ item.sheet.nickname }}</h3>
          <span v-if="item.sheet.shiny" class="badge shiny" title="Shiny">★</span>
        </div>
        <p class="sheet-card__species">
          {{ item.sheet.species }} · Lv {{ item.sheet.level }}
        </p>
        <ul class="sheet-card__meta">
          <li v-if="item.sheet.nature">{{ item.sheet.nature }}</li>
          <li v-if="item.sheet.gender">{{ item.sheet.gender }}</li>
          <li v-if="item.types.length" class="sheet-card__types">
            <TypeBadge
              v-for="type in item.types"
              :key="`${item.slug}-${type}`"
              :type="type"
              size="xs"
            />
          </li>
        </ul>
      </div>
    </template>

    <template v-else>
      <LibraryCardMedia class="trainer-icon">
        <span aria-hidden="true">🎯</span>
      </LibraryCardMedia>
      <div class="sheet-card__body">
        <div class="sheet-card__heading">
          <h3>{{ item.sheet.name }}</h3>
        </div>
        <p class="sheet-card__species">
          Trainer · Lv {{ item.sheet.level }}
          <span v-if="item.sheet.classes?.length">
            · {{ item.sheet.classes.map((c) => c.name).join(', ') }}
          </span>
        </p>
        <ul class="sheet-card__meta">
          <li v-if="item.sheet.skillBackground?.name">{{ item.sheet.skillBackground.name }}</li>
          <li v-if="item.sheet.sex">{{ item.sheet.sex }}</li>
          <li v-if="item.sheet.playedBy">PB: {{ item.sheet.playedBy }}</li>
        </ul>
      </div>
    </template>
  </LibraryCardShell>
</template>

<style scoped>
.trainer-icon {
  font-size: 1.8rem;
}

.sheet-card__body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.sheet-card__heading {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.sheet-card__heading h2,
.sheet-card__heading h3 {
  margin: 0;
  font-family: var(--font-book);
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--ink-bright);
}

.sheet-card__species {
  margin: 0;
  color: var(--ink-soft);
  font-size: 0.88rem;
}

.sheet-card__meta {
  list-style: none;
  margin: 0.25rem 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.5rem;
  color: var(--ink-muted);
  font-size: 0.76rem;
  letter-spacing: 0.04em;
}

.sheet-card__meta li {
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  background: var(--paper-inset);
  border: 1px solid var(--rule);
}

.sheet-card__meta .sheet-card__types {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.22rem;
  padding: 0;
  border: 0;
  background: transparent;
}

.badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.22rem 0.65rem;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.74rem;
  letter-spacing: 0.06em;
  white-space: nowrap;
}

.badge.shiny {
  background: rgba(221, 210, 176, 0.16);
  color: var(--ink-bright);
  padding: 0.18rem 0.5rem;
  font-size: 0.95rem;
  line-height: 1;
}
</style>
