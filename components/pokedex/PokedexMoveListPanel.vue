<script setup lang="ts">
import type { MoveToken } from '~/utils/pokedex/entryDetails'
import type { PokedexLevelUpMove } from '~/types/pokemon'

defineProps<{
  eggMoveTokens: MoveToken[]
  levelUpMoves: PokedexLevelUpMove[] | undefined
  tmHmTokens: MoveToken[]
  tutorMoveTokens: MoveToken[]
}>()
</script>

<template>
  <section
    v-if="levelUpMoves?.length || tmHmTokens.length || eggMoveTokens.length || tutorMoveTokens.length"
    class="book-section book-section--moves"
  >
    <h3 class="book-section__title">Move List</h3>

    <template v-if="levelUpMoves?.length">
      <p class="subsection-title">Level Up Move List</p>
      <ul class="move-list">
        <li
          v-for="move in levelUpMoves"
          :key="`${move.level}-${move.name}`"
        >
          <span class="move-level">{{ move.level }}</span>
          <span class="move-name"><RefLink kind="move" :name="move.name" /></span>
          <span class="move-sep">-</span>
          <span class="move-type"><TypeBadge :type="move.type" size="xs" /></span>
        </li>
      </ul>
    </template>

    <template v-if="tmHmTokens.length">
      <p class="subsection-title">TM/HM Move List</p>
      <p class="paragraph paragraph--indent">
        <template v-for="(token, i) in tmHmTokens" :key="`tm-${i}`"
          ><span v-if="i > 0">, </span
          ><RefLink kind="move" :name="token.name" :display="token.display"
        /></template>
      </p>
    </template>

    <template v-if="eggMoveTokens.length">
      <p class="subsection-title">Egg Move List</p>
      <p class="paragraph paragraph--indent">
        <template v-for="(token, i) in eggMoveTokens" :key="`egg-${i}`"
          ><span v-if="i > 0">, </span
          ><RefLink kind="move" :name="token.name" :display="token.display"
        /></template>
      </p>
    </template>

    <template v-if="tutorMoveTokens.length">
      <p class="subsection-title">Tutor Move List</p>
      <p class="paragraph paragraph--indent">
        <template v-for="(token, i) in tutorMoveTokens" :key="`tut-${i}`"
          ><span v-if="i > 0">, </span
          ><RefLink kind="move" :name="token.name" :display="token.display"
        /></template>
      </p>
    </template>
  </section>
</template>
