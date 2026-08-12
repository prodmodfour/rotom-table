---
name: ui-design-workflow
description: Mandatory Rotom Table workflow for every UI task, including planning, implementing, modifying, reviewing, or debugging Nuxt/Vue pages and components, CSS, layouts, responsive behavior, accessibility presentation, interactions, design-system primitives, and three.js visuals. Uses a resource-capped Codex native image-generation wrapper to create target-state mockups before substantive visible changes.
compatibility: Requires Linux user systemd and an authenticated Codex CLI with native image generation.
---

# Rotom Table UI Design Workflow

Load and follow this skill whenever work touches the visible or interactive UI, even when the user did not ask for a mockup.

## Non-negotiable trigger

This skill applies to:

- pages, layouts, Vue components, CSS, visual tokens, icons, and typography;
- interaction states, navigation, forms, overlays, responsive behavior, and accessibility presentation;
- three.js scenes, cameras, controls, visual effects, and UI layered over rendered worlds;
- visual bug fixes, UI reviews, screenshot changes, and frontend implementation plans.

For a substantive visible change, generate a target-state mockup before editing implementation code. Load the skill but skip image generation only when the work is provably non-visual (for example, test plumbing or type-only refactoring), when the user explicitly opts out, or when the requested change is an exact mechanical edit with no design choice. State the reason briefly when skipping.

## Design authority

Before composing a mockup brief:

1. Read `DESIGN.md`; it is normative.
2. Read the relevant existing page/component/styles and the active implementation-plan ticket.
3. For encounter UI, also inspect:
   - `docs/encounter-workspace/design-system.md`
   - `data/encounter-workspace/design-tokens.v1.json`
   - relevant `Encounter*` primitives and visual baselines.
4. Preserve the product context: Field Guide, Workshop, or Live Encounter.
5. Do not let an image generator invent mechanics, permissions, privacy behavior, or canonical PTU text. Use only app-owned `data/reference/*.json` for PTU runtime facts.

A generated mockup is a design aid, never product authority. Domain contracts, authorised projections, `DESIGN.md`, and structured design tokens override it.

## Workflow

### 1. Establish the current state

Inspect the relevant implementation and existing visual state. When a current-state screenshot materially improves the target design, use the Playwright browser skill against liveplay and save a privacy-safe screenshot. Never start deprecated local hosting.

Do not include campaign secrets, real player information, credentials, or unreleased story content in reference images.

### 2. Write a target-state brief

Use [the design brief template](references/design-brief-template.md). Include only details relevant to the task, but always identify:

- product context and screen/state;
- target viewport or breakpoint;
- primary user task or decision;
- information hierarchy and exact required copy;
- components and interaction states that must be visible;
- invariants, accessibility requirements, and forbidden patterns.

If a critical visual choice is ambiguous, ask one focused question. Otherwise proceed without asking for separate mockup permission; UI work already activates this workflow.

### 3. Generate through the bounded wrapper

Never invoke raw `codex` for mockups. Resolve the script relative to this skill directory and call it by absolute path:

```bash
/path/to/project/.pi/skills/ui-design-workflow/scripts/pi-codex-ui-mockup \
  --name concise-screen-state \
  --out-dir .pi/artifacts/ui-mockups \
  -- "$(cat /path/to/brief.txt)"
```

Attach a current screenshot or visual reference when useful:

```bash
/path/to/project/.pi/skills/ui-design-workflow/scripts/pi-codex-ui-mockup \
  --reference /absolute/path/current-state.png \
  --name target-state \
  -- "target-state design brief"
```

The wrapper:

- enables Codex's native image-generation tool;
- disables shell/code, browser, apps, plugins-by-use, computer control, and sub-agents for the child task;
- runs ephemerally in a user-systemd cgroup;
- caps memory at 768 MiB, swap at 128 MiB, tasks at 64, file size at 64 MiB, and runtime at four minutes;
- uses a global non-blocking lock so image jobs cannot overlap;
- copies results to `.pi/artifacts/ui-mockups/` by default.

Run variants sequentially, never concurrently. Generate one screen or breakpoint per invocation. One initial concept plus one targeted revision is normally enough; do not create speculative batches.

If the bounded invocation fails, do not repeatedly retry. Report the failure, retain any diagnostic, and continue from normative design authority unless unresolved visual ambiguity genuinely blocks the task.

### 4. Inspect before implementation

Open the generated image with `read` and check it against `DESIGN.md` and the task:

- primary task/actor is immediately obvious;
- semantic colours retain their meanings;
- matte surfaces dominate and glass is limited to world overlays;
- no overlay soup, badge flood, raw IDs, tiny essential text, or colour-only meaning;
- required desktop/mobile, keyboard, touch, focus, reduced-motion, and privacy states remain plausible;
- generated labels do not introduce unsupported mechanics or copy.

Treat text rendering and fine geometry as conceptual; do not copy image artifacts into the product. If revision is needed, issue one focused follow-up brief rather than broad restyling.

### 5. Implement and validate

Implement with existing tokens and primitives instead of sampling arbitrary colours, radii, shadows, fonts, or spacing from the image. Preserve authoritative pending/accepted/corrected state boundaries and liveplay behavior.

Use focused validation appropriate to the touched UI. For encounter design-system changes, run `npm run check:encounter-design` and focused tests where relevant. Validate the completed flow in liveplay with Playwright when browser behavior or responsive presentation changed. Follow the repository's bounded-worker and closure-only full-suite rules.

Report:

- mockup path and the brief used;
- implementation files changed;
- focused validation performed;
- any deliberate differences between mockup and implementation.

## Model provenance

The native Codex image tool does not expose a model-selection parameter or report its backend model. Never claim a mockup was generated by `gpt-image-2`. Explicit model selection would require a separate Images API workflow and API credentials; that is outside this wrapper.
