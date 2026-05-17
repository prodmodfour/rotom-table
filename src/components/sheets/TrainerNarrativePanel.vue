<script setup lang="ts">
const physicalDescription = defineModel<string | undefined>('physicalDescription')
const background = defineModel<string | undefined>('background')
const personality = defineModel<string | undefined>('personality')
const goalsAndDreams = defineModel<string | undefined>('goalsAndDreams')
</script>

<template>
  <div class="narrative-grid">
    <div class="narrative narrative--red">
      <h3>Physical Description</h3>
      <p>
        <EditableCell
          v-model="physicalDescription"
          type="textarea"
          placeholder="Physical description"
          multiline
        />
      </p>
    </div>
    <div class="narrative narrative--accent">
      <h3>Background</h3>
      <p>
        <EditableCell
          v-model="background"
          type="textarea"
          placeholder="Background"
          multiline
        />
      </p>
    </div>
    <div class="narrative narrative--purple">
      <h3>Personality</h3>
      <p>
        <EditableCell
          v-model="personality"
          type="textarea"
          placeholder="Personality"
          multiline
        />
      </p>
    </div>
    <div class="narrative narrative--green">
      <h3>Goals / Dreams / Obsessions</h3>
      <p>
        <EditableCell
          v-model="goalsAndDreams"
          type="textarea"
          placeholder="Goals & dreams"
          multiline
        />
      </p>
    </div>
  </div>
</template>

<style scoped src="./trainerProgressPanel.css"></style>
