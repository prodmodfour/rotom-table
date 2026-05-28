<script setup lang="ts">
import { computed } from 'vue'
import LibraryCardBadge from '~/components/library/LibraryCardBadge.vue'
import LibraryCardMedia from '~/components/library/LibraryCardMedia.vue'
import LibraryCardMetaList from '~/components/library/LibraryCardMetaList.vue'
import LibraryCardShell from '~/components/library/LibraryCardShell.vue'
import LibraryCardText from '~/components/library/LibraryCardText.vue'
import { sheetLibraryAccessBadge, type SheetLibraryItem } from '~/utils/sheetLibrary'
import { sheetEditorPath } from '~/utils/sheetRoutes'

const props = defineProps<{
  item: SheetLibraryItem
  canDrag: boolean
  isDraggingSelf: boolean
}>()

const accessBadge = computed(() => sheetLibraryAccessBadge(props.item))

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
      <LibraryCardText
        :title="item.sheet.nickname"
        :subtitle="`${item.sheet.species} · Lv ${item.sheet.level}`"
      >
        <template #title-extra>
          <LibraryCardBadge v-if="item.sheet.shiny" variant="shiny" title="Shiny">
            ★
          </LibraryCardBadge>
        </template>
        <LibraryCardMetaList>
          <li v-if="item.sheet.nature">{{ item.sheet.nature }}</li>
          <li v-if="item.sheet.gender">{{ item.sheet.gender }}</li>
          <li v-if="item.types.length" class="library-card-meta-list__badges">
            <TypeBadge
              v-for="type in item.types"
              :key="`${item.slug}-${type}`"
              :type="type"
              size="xs"
            />
          </li>
        </LibraryCardMetaList>
        <LibraryCardBadge
          v-if="accessBadge"
          :variant="accessBadge.variant"
          spacing="stacked"
          :title="accessBadge.title"
        >
          {{ accessBadge.label }}
        </LibraryCardBadge>
      </LibraryCardText>
    </template>

    <template v-else>
      <LibraryCardMedia
        class="trainer-icon"
        :image-url="item.spriteUrl"
        :image-alt="`${item.sheet.name} trainer sprite`"
        fallback-label="🎯"
      />
      <LibraryCardText
        :title="item.sheet.name"
        :subtitle="[
          `Trainer · Lv ${item.sheet.level}`,
          item.sheet.classes?.length ? item.sheet.classes.map((c) => c.name).join(', ') : '',
        ].filter(Boolean).join(' · ')"
      >
        <LibraryCardMetaList>
          <li v-if="item.sheet.skillBackground?.name">{{ item.sheet.skillBackground.name }}</li>
          <li v-if="item.sheet.sex">{{ item.sheet.sex }}</li>
          <li v-if="item.sheet.playedBy">PB: {{ item.sheet.playedBy }}</li>
        </LibraryCardMetaList>
        <LibraryCardBadge
          v-if="accessBadge"
          :variant="accessBadge.variant"
          spacing="stacked"
          :title="accessBadge.title"
        >
          {{ accessBadge.label }}
        </LibraryCardBadge>
      </LibraryCardText>
    </template>
  </LibraryCardShell>
</template>

<style scoped>
.trainer-icon {
  font-size: 1.8rem;
}
</style>
