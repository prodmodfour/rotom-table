# Rotom Table target-state brief

Create one stable `brief.md` per screen/state. Use only fields that materially guide the target; omit irrelevant fields. Keep hard requirements, authoritative facts, and reversible design assumptions distinct.

```markdown
# <screen / feature and state>

## Product context
- Context: Field Guide | Workshop | Live Encounter
- Audience / authorised projection: player | GM | public observer | other
- Entry point:
- Primary task or blocking decision:
- Success state:

## Target
- Viewport: <width × height and desktop/tablet/mobile>
- Fidelity: polished product UI | structural wireframe
- Current-state reference: <Image N and role, or none>

## Authoritative inputs inspected
- DESIGN.md sections:
- Design tokens / primitives:
- Relevant implementation:
- Domain contract / authorised projection:
- Active ticket, when applicable:

## Hard requirements
- Required information hierarchy:
  1.
  2.
  3.
- Required regions / components:
- Required interaction states: idle | focused | selected | pending | accepted | corrected | unavailable | error
- Exact visible copy (verbatim):
- Data permitted to use neutral placeholders:
- Must preserve:
- Must change:
- Must not reveal:

## Inferred design assumptions
- <safe, reversible visual choices made autonomously where authority is silent>

## Acceptance criteria
- <observable pixel-level conditions for hierarchy, content, state, design-system fidelity, and artifact control>

## Accessibility and responsive intent
- Keyboard/focus cues to communicate:
- Touch target expectations:
- Non-colour state cues:
- Narrow/wide transformation:
- Motion/reduced-motion implication:

## Visual direction within DESIGN.md
- Product-context atmosphere:
- Semantic colours and their roles:
- Applicable component anatomy / signature motif:
- Density / typography intent:

## Constraints / avoid
- no unsupported mechanics, permissions, privacy behavior, or canonical PTU copy
- no campaign secrets, real player information, credentials, or unreleased story content
- no device frame, watermark, official-game imitation, generic neon sci-fi treatment, universal glass, badge flood, overlay soup, raw IDs, tiny essential text, or colour-only meaning
```

## Prompt rules

- Describe a target state, not implementation code.
- Make one task or decision visually primary.
- Quote exact labels that matter. Never ask the generator to invent PTU rules text.
- Identify every attachment as an edit target, current-state reference, style reference, or supporting asset.
- Include only information authorised for the named projection.
- Name the intended breakpoint. Use separate sequential mockups for materially different breakpoints.
- Prefer existing Rotom Table tokens, shape grammar, and component anatomy over free-form styling.
- Treat `DESIGN.md`, authorised projections, domain contracts, and structured tokens as authority. A reference screenshot may document current state but cannot override those sources.
- Record visual assumptions instead of asking for taste preferences. Ask only when a consequential non-aesthetic product fact has no safe authoritative answer.

## Targeted revision addendum

Append these fields to a copied prompt for each revision:

```text
Input images: Image 1 is the edit target and current highest-scoring iteration. <Label others.>
Primary revision: Change only <one highest-impact weakness>.
Reason: <pixel evidence tied to the brief or quality rubric>.
Exact change: <specific visual delta>.
Invariants: preserve <all high-scoring content, state, hierarchy, layout, copy, privacy, and product-language details>.
Avoid: redesigning unaffected regions, adding mechanics/copy/data, or weakening authorised state boundaries.
```

## Short example

```markdown
# Breeding project consent review — pending participant

## Product context
- Context: Workshop
- Audience / authorised projection: project owner
- Primary task or blocking decision: identify the unresolved consent and understand the safe next action
- Success state: the owner can send a reminder but cannot create the project prematurely

## Target
- Viewport: 1440 × 900 desktop
- Fidelity: polished product UI

## Hard requirements
- Required information hierarchy:
  1. project identity and validation state
  2. participant consent rows with one pending response
  3. primary next action and concise unavailable reason
- Required regions / components: compact header, participant rows, pending decision surface, action footer
- Required interaction states: focused, pending, unavailable
- Exact visible copy (verbatim): “Awaiting consent”, “Send reminder”, “Create project”
- Data permitted to use neutral placeholders: participant names and portraits
- Must preserve: explicit save/validation state and semantic amber for pending
- Must change: make the unresolved participant and next action obvious without opening an inspector
- Must not reveal: private campaign notes or diagnostic IDs

## Acceptance criteria
- One pending row dominates before secondary metadata.
- Create project remains visible with a textual unavailable reason.
- Focus is visible without relying on colour alone.

## Accessibility and responsive intent
- Keyboard/focus cues to communicate: visible focus on participant row and reminder action
- Touch target expectations: 44 px primary controls
- Narrow/wide transformation: desktop split hierarchy can collapse to one column

## Constraints / avoid
- no glass cards, raw IDs, all-red pending treatment, or invented mechanics
```
