# Rotom Table UI mockup brief template

Use only the fields that materially guide the target state. Keep the brief concise enough that hierarchy remains clear.

```text
Screen / feature:
Product context: Field Guide | Workshop | Live Encounter
Target state:
Viewport: width × height, desktop/tablet/mobile
Audience / role: player | GM | public observer | other authorised projection

Primary task or blocking decision:
Primary actor / object:
Required information hierarchy:
1.
2.
3.

Required regions / components:
Required interaction states: idle | focused | selected | pending | accepted | corrected | unavailable | error
Exact visible copy (verbatim):
Data that may use neutral placeholders:

Current-state reference: attached image N and its role
Must preserve:
Must change:
Must not reveal:

Accessibility requirements:
Responsive behavior to communicate:
Motion/reduced-motion implication, if relevant:

Visual direction within DESIGN.md:
Constraints / avoid:
```

## Prompt rules

- Describe a target state, not implementation code.
- State one primary task or decision.
- Quote exact labels that matter. Do not ask the generator to invent PTU rules text.
- Identify each attached image as current-state reference, style reference, or edit target.
- Include only authorised information for the requested role.
- Name the intended breakpoint; use separate sequential mockups for materially different breakpoints.
- Prefer existing Rotom Table tokens, shape grammar, and component anatomy over free-form styling.
- Explicitly avoid device frames, watermarks, official-game imitation, generic neon sci-fi treatment, universal glass, badge floods, and overlay soup unless a narrower task constraint already supersedes one of these.

## Short example

```text
Screen / feature: Breeding project consent review
Product context: Workshop
Target state: owner reviews participants and unresolved consent before project creation
Viewport: 1440 × 900 desktop
Audience / role: project owner

Primary task or blocking decision: understand which participant still needs consent and what can happen next
Primary actor / object: proposed breeding project
Required information hierarchy:
1. project identity and validation state
2. participant consent rows with one pending response
3. primary next action and safe unavailable reason

Required regions / components: compact header, participant rows, pending decision surface, action footer
Required interaction states: focused, pending, unavailable
Exact visible copy (verbatim): "Awaiting consent", "Send reminder", "Create project"
Data that may use neutral placeholders: participant names and portraits

Must preserve: explicit save/validation state, semantic amber for pending, matte Workshop surfaces
Must change: make the unresolved participant and next action obvious without opening an inspector
Must not reveal: private campaign notes or diagnostic IDs

Accessibility requirements: visible keyboard focus, text reason for unavailable action, 44px primary controls
Responsive behavior to communicate: desktop split hierarchy that can collapse to one column
Constraints / avoid: no glass cards, no raw IDs, no all-red state treatment, no invented mechanics
```
