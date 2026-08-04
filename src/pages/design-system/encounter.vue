<script setup lang="ts">
import type {
  EncounterActionSummary,
  EncounterDecisionSummary,
  EncounterParticipantSummary,
} from '#shared/encounterWorkspace/primitives'
import {
  ENCOUNTER_CONTEXTS,
  ENCOUNTER_DENSITIES,
  ENCOUNTER_VISUAL_STATES,
} from '#shared/encounterWorkspace/designTokens'

useHead({ title: 'Encounter design system · Rotom Table' })

const participant: EncounterParticipantSummary = {
  id: 'gallery-luxray',
  name: 'Luxray',
  role: 'Mira’s active Pokémon',
  portraitUrl: '/api/profile-sprites/pokemon/luxray',
  side: { id: 'scarlet', label: 'Mira’s team', symbol: '◆', color: '#d94b5b' },
  relationship: 'Ally',
  hp: { current: 58, maximum: 68, temporary: 5 },
  injuries: 1,
  conditions: ['Focused', 'Injured'],
  resources: [{ id: 'standard', label: 'Standard', current: 1, maximum: 1 }],
  currentTurn: true,
  controlled: true,
}

const availableAction: EncounterActionSummary = {
  id: 'gallery-thunder-fang',
  name: 'Thunder Fang',
  category: 'Attacks and Moves',
  source: 'Move',
  timing: 'Standard Action',
  cost: '1 Standard Action',
  usage: 'At-Will',
  scope: 'One adjacent foe',
  availability: 'available',
  state: 'idle',
  recommended: true,
}

const unavailableAction: EncounterActionSummary = {
  id: 'gallery-spark',
  name: 'Spark',
  category: 'Attacks and Moves',
  source: 'Move',
  timing: 'Standard Action',
  cost: '1 Standard Action',
  usage: 'EOT',
  scope: 'One adjacent foe',
  availability: 'unavailable',
  unavailableReason: 'Used on the previous turn.',
}

const decision: EncounterDecisionSummary = {
  id: 'gallery-static-response',
  ownerLabel: 'Mira may respond',
  headline: 'Static can activate',
  prompt: 'Choose whether Luxray uses Static before play continues.',
  publicSummary: 'Waiting for one response.',
  timingLabel: 'Reaction · 22 seconds remain',
  canPass: true,
  canCancel: false,
  options: [
    { id: 'use', label: 'Use Static', description: 'Resolve the authorised Reaction.', selected: true },
    { id: 'hold', label: 'Keep it available', description: 'Do not activate this trigger.' },
    { id: 'invalid', label: 'Use on Rowan', disabled: true, disabledReason: 'Rowan is not an eligible target.' },
  ],
}

const contexts = ENCOUNTER_CONTEXTS
const densities = ENCOUNTER_DENSITIES
const states = ENCOUNTER_VISUAL_STATES
const themes = ['dark', 'light'] as const
const semanticColors = ['brand', 'focus', 'pending', 'success', 'danger', 'info'] as const
const motionCues = ['pulse', 'lock', 'sweep', 'travel', 'impact', 'settle', 'correct'] as const
</script>

<template>
  <main class="gallery-page rt-design-system" data-rt-design-system="1" data-rt-context="field-guide">
    <header class="gallery-hero">
      <p class="rt-type-label-sm gallery-eyebrow">Rotom encounter design system · v1</p>
      <h1 class="rt-type-display-lg">Living field terminal primitives</h1>
      <p class="rt-type-body-md">
        Canonical visual states, themes, contexts, densities, motion cues, and accessible component anatomy.
        This gallery is presentation evidence only; it executes no mechanics.
      </p>
    </header>

    <nav class="gallery-nav" aria-label="Gallery sections">
      <a class="rt-control" href="#tokens">Tokens</a>
      <a class="rt-control" href="#contexts">Contexts</a>
      <a class="rt-control" href="#components">Components</a>
      <a class="rt-control" href="#states">States</a>
      <a class="rt-control" href="#motion">Motion</a>
      <a class="rt-control" href="#accessibility">Accessibility</a>
    </nav>

    <section id="tokens" class="gallery-section" aria-labelledby="tokens-heading">
      <header>
        <p class="rt-type-label-sm gallery-eyebrow">EUX-010 · EUX-012 · EUX-013</p>
        <h2 id="tokens-heading" class="rt-type-heading-md">Semantic tokens and typography</h2>
      </header>

      <div class="gallery-theme-grid">
        <article
          v-for="theme in themes"
          :key="theme"
          class="gallery-theme rt-surface"
          :class="`gallery-theme--${theme}`"
          :data-rt-theme="theme"
          data-rt-elevation="1"
        >
          <h3 class="rt-type-heading-md">{{ theme }} theme</h3>
          <div class="gallery-swatches" aria-label="Semantic colour roles">
            <div v-for="color in semanticColors" :key="color" class="gallery-swatch">
              <span :style="{ background: `var(--rt-${color})` }" aria-hidden="true" />
              <strong>{{ color }}</strong>
            </div>
          </div>
          <p class="rt-type-body-sm">
            Brand, focus, pending, success, danger, and information remain separate semantic roles.
          </p>
        </article>
      </div>

      <div class="gallery-type rt-surface" data-rt-elevation="1">
        <p class="rt-type-display-xl">Display XL</p>
        <p class="rt-type-display-lg">Display large</p>
        <p class="rt-type-heading-md">Heading medium</p>
        <p class="rt-type-action-md">Action medium</p>
        <p class="rt-type-body-md">Body medium stays readable at table distance and targets a useful line length.</p>
        <p class="rt-type-body-sm">Body small carries explanations without becoming essential tiny text.</p>
        <p class="rt-type-label-sm">SHORT LABEL</p>
        <p class="rt-type-meta-xs">Secondary metadata</p>
        <p class="rt-numeric">HP 058 / 068 · Initiative 18 · 02m</p>
      </div>
    </section>

    <section id="contexts" class="gallery-section" aria-labelledby="contexts-heading">
      <header>
        <p class="rt-type-label-sm gallery-eyebrow">EUX-011</p>
        <h2 id="contexts-heading" class="rt-type-heading-md">Product contexts and densities</h2>
      </header>

      <div class="gallery-context-grid">
        <article
          v-for="context in contexts"
          :key="context"
          class="gallery-context rt-surface"
          :data-rt-context="context"
          data-rt-elevation="1"
        >
          <p class="rt-type-label-sm">{{ context }}</p>
          <h3 class="rt-type-heading-md">Context surface</h3>
          <p class="rt-type-body-sm">
            {{ context === 'field-guide' ? 'Reading-first hierarchy and generous rhythm.' : context === 'workshop' ? 'Compact labelled authoring controls and explicit state.' : 'Actor, decision, and accepted event hierarchy over a restrained world.' }}
          </p>
          <button type="button" class="rt-control">Example control</button>
        </article>
      </div>

      <div class="gallery-density-grid">
        <article
          v-for="density in densities"
          :key="density"
          class="gallery-density rt-surface"
          :data-rt-density="density"
          data-rt-elevation="1"
        >
          <strong class="rt-type-action-md">{{ density }}</strong>
          <button type="button" class="rt-control">Control height</button>
          <span class="rt-type-meta-xs">Density changes rhythm, not semantic hierarchy.</span>
        </article>
      </div>
    </section>

    <section id="components" class="gallery-section" aria-labelledby="components-heading">
      <header>
        <p class="rt-type-label-sm gallery-eyebrow">EUX-014 · EUX-015</p>
        <h2 id="components-heading" class="rt-type-heading-md">Component primitives</h2>
      </header>

      <div class="gallery-component-grid">
        <div class="gallery-component">
          <h3 class="rt-type-label-sm">Participant</h3>
          <EncounterParticipantCard :participant="participant" variant="owner" />
        </div>
        <div class="gallery-component">
          <h3 class="rt-type-label-sm">Action</h3>
          <EncounterActionCard :action="availableAction" />
        </div>
        <div class="gallery-component gallery-component--wide">
          <h3 class="rt-type-label-sm">Decision</h3>
          <EncounterDecisionCard :decision="decision" :active="false" :focus-on-activate="false" />
        </div>
        <div class="gallery-component">
          <h3 class="rt-type-label-sm">Status</h3>
          <div class="gallery-inline">
            <EncounterStatusChip label="Poisoned" tone="danger" symbol="!" />
            <EncounterStatusChip label="In range" tone="focus" symbol="◎" />
            <EncounterStatusChip label="Reaction" tone="pending" symbol="◆" />
            <EncounterStatusChip label="Selected" tone="focus" interactive selected />
          </div>
        </div>
        <div class="gallery-component">
          <h3 class="rt-type-label-sm">Utility</h3>
          <div class="gallery-inline">
            <EncounterUtilityControl label="Open tactical view" shortcut="T">
              <template #icon>◎</template>
            </EncounterUtilityControl>
            <EncounterUtilityControl label="Save" treatment="primary" />
            <EncounterUtilityControl label="Delete" treatment="danger" />
          </div>
        </div>
        <div class="gallery-component gallery-component--wide">
          <h3 class="rt-type-label-sm">Inspector</h3>
          <EncounterInspectorPanel title="Why is this available?" summary="3 authoritative contributions" authorized open>
            <p>Luxray is the current controlled actor, Crobat is adjacent, and the Standard Action remains available.</p>
          </EncounterInspectorPanel>
        </div>
      </div>
    </section>

    <section id="states" class="gallery-section" aria-labelledby="states-heading">
      <header>
        <p class="rt-type-label-sm gallery-eyebrow">EUX-016</p>
        <h2 id="states-heading" class="rt-type-heading-md">Visual state contract</h2>
      </header>
      <div class="gallery-state-grid">
        <article
          v-for="state in states"
          :key="state"
          class="gallery-state rt-surface rt-signal-spine"
          :data-rt-state="state"
          data-rt-elevation="1"
        >
          <strong class="rt-type-action-md">{{ state }}</strong>
          <span class="rt-type-body-sm">State remains identifiable by text, border, and shape—not colour alone.</span>
        </article>
      </div>
      <EncounterActionCard :action="unavailableAction" />
    </section>

    <section id="motion" class="gallery-section" aria-labelledby="motion-heading">
      <header>
        <p class="rt-type-label-sm gallery-eyebrow">EUX-017</p>
        <h2 id="motion-heading" class="rt-type-heading-md">Finite motion vocabulary</h2>
      </header>
      <div class="gallery-motion-grid">
        <EncounterMotionCue v-for="cue in motionCues" :key="cue" :cue="cue">
          <div class="gallery-motion rt-surface" data-rt-elevation="1">
            <strong>{{ cue }}</strong>
          </div>
        </EncounterMotionCue>
      </div>
      <p class="rt-type-body-sm">Reduced motion collapses every cue to a direct one-millisecond settle while preserving state and sequence.</p>
    </section>

    <section id="accessibility" class="gallery-section" aria-labelledby="accessibility-heading">
      <header>
        <p class="rt-type-label-sm gallery-eyebrow">EUX-018</p>
        <h2 id="accessibility-heading" class="rt-type-heading-md">Accessibility annotations</h2>
      </header>
      <div class="gallery-annotations">
        <article class="rt-surface" data-rt-elevation="1">
          <h3 class="rt-type-action-md">Keyboard and focus</h3>
          <p>Actions, participants, decisions, chips, inspectors, and utility controls are native controls. Active decisions focus their heading and restore policy belongs to the workspace state machine.</p>
        </article>
        <article class="rt-surface" data-rt-elevation="1">
          <h3 class="rt-type-action-md">Sensory independence</h3>
          <p>Every semantic colour has a text label, border treatment, symbol, state copy, or signal-spine role. User side colour always accompanies side name and symbol.</p>
        </article>
        <article class="rt-surface" data-rt-elevation="1">
          <h3 class="rt-type-action-md">Touch and reflow</h3>
          <p>Primary controls target at least 44×44px. Cards reflow without hover-only disclosure, and narrow tactical interactions will open full screen.</p>
        </article>
        <article class="rt-surface" data-rt-elevation="1">
          <h3 class="rt-type-action-md">Privacy</h3>
          <p>The inspector renders only when its authorised projection is present. CSS is never used to conceal private mechanic content.</p>
        </article>
      </div>
    </section>
  </main>
</template>

<style scoped>
.gallery-page {
  min-height: 100vh;
  overflow-x: clip;
  padding: clamp(var(--rt-space-4), 4vw, var(--rt-space-12));
}

.gallery-hero,
.gallery-section {
  width: min(100%, 86rem);
  margin-inline: auto;
}

.gallery-hero {
  display: grid;
  max-width: 70rem;
  gap: var(--rt-space-3);
  padding-block: var(--rt-space-8);
  text-align: center;
}

.gallery-hero p {
  max-width: 70ch;
  margin: 0 auto;
}

.gallery-eyebrow {
  color: var(--rt-brand);
  text-transform: uppercase;
}

.gallery-nav,
.gallery-inline,
.gallery-action-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--rt-space-2);
}

.gallery-nav {
  position: static;
  width: fit-content;
  max-width: calc(100% - var(--rt-space-4));
  margin: 0 auto var(--rt-space-8);
  padding: var(--rt-space-2);
  border: var(--rt-border-hairline) solid var(--rt-rule);
  border-radius: var(--rt-radius-medium) !important;
  background: color-mix(in srgb, var(--rt-surface-1) 94%, transparent);
  box-shadow: var(--rt-elevation-2);
}

.gallery-section {
  display: grid;
  gap: var(--rt-space-6);
  padding-block: var(--rt-space-8);
  border-top: var(--rt-border-hairline) solid var(--rt-rule);
}

.gallery-section > header {
  display: grid;
  gap: var(--rt-space-1);
}

.gallery-section > header p {
  margin: 0;
}

.gallery-theme-grid,
.gallery-context-grid,
.gallery-density-grid,
.gallery-component-grid,
.gallery-state-grid,
.gallery-motion-grid,
.gallery-annotations {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 19rem), 1fr));
  gap: var(--rt-region-gap);
}

.gallery-theme,
.gallery-context,
.gallery-density,
.gallery-type,
.gallery-state,
.gallery-motion,
.gallery-annotations article {
  padding: var(--rt-card-padding);
}

.gallery-theme {
  display: grid;
  gap: var(--rt-space-3);
  background: var(--rt-bg-canvas);
  color: var(--rt-text);
}

.gallery-theme--light {
  color-scheme: light;
}

.gallery-swatches {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--rt-space-2);
}

.gallery-swatch {
  display: grid;
  gap: var(--rt-space-1);
  color: var(--rt-text);
  font-size: var(--rt-type-meta-xs-size);
}

.gallery-swatch > span {
  height: var(--rt-space-8);
  border: var(--rt-border-hairline) solid var(--rt-rule);
  border-radius: var(--rt-radius-small) !important;
}

.gallery-type {
  display: grid;
  gap: var(--rt-space-3);
}

.gallery-type p {
  margin-block: 0;
}

.gallery-context,
.gallery-density,
.gallery-state,
.gallery-component,
.gallery-motion,
.gallery-annotations article {
  display: grid;
  align-content: start;
  gap: var(--rt-space-3);
}

.gallery-context[data-rt-context='live-encounter'] {
  background: var(--rt-bg-world);
}

.gallery-component--wide {
  grid-column: 1 / -1;
}

.gallery-component > h3 {
  margin: 0;
  color: var(--rt-text-muted);
  text-transform: uppercase;
}

.gallery-state {
  min-height: 8rem;
  padding-left: calc(var(--rt-card-padding) + var(--rt-space-1));
}

.gallery-motion-grid {
  grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
}

.gallery-motion {
  display: grid;
  min-height: 6rem;
  place-items: center;
}

.gallery-annotations article p {
  margin: 0;
  max-width: 62ch;
}

@media (max-width: 639px) {
  .gallery-page {
    padding: var(--rt-space-3);
  }

  .gallery-nav {
    position: static;
    width: 100%;
  }

  .gallery-nav .rt-control {
    flex: 1 1 8rem;
  }
}
</style>
