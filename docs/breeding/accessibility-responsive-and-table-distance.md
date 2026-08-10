# Breeding Workshop accessibility, responsive, and table-distance acceptance

BR-078 completes the component-level interaction acceptance for `/breeding`. The executable matrix is `data/breeding-automation/workshop-interaction-acceptance.json`. Browser-engine, axe, multi-context, reconnect, and visual-regression automation remains the separate BR-079 owner; it must consume this matrix rather than redefine it.

## Product and authority boundary

The page is a Workshop surface. Matte cards, explicit revisions and campaign time, visible unavailable/recovery states, and fully labelled controls take priority over spectacle. Accessibility behavior changes presentation focus only. It never accepts a command, derives a mechanic, changes consent, or makes Egg ownership optimistic.

The component inputs remain server-projected and role-private. Focus management cannot reveal a hidden parent, transfer counterpart, Profile, command, roll, read set, receipt, or aggregate identifier.

## Accepted viewport and zoom matrix

| Effective CSS width | Representative use | Accepted layout |
| ---: | --- | --- |
| 320 px | Small phone or 400% desktop reflow | One-column flow, one-column wizard progress, full-width essential actions, viewport-contained scrolling dialogs |
| 390 px | Common touch phone | One-column cards and bottom-aligned decision sheets with no hover dependency |
| 768 px | Tablet or 200% desktop zoom | Collapsed ownership controls and single-column activity cards |
| 1440 px and wider | Desktop/shared table display | Bounded 96 rem reading width and two-column card scanning |

No essential region requires two-dimensional scrolling. Grid tracks use `minmax(0, 1fr)`, narrow breakpoints collapse fixed card columns, human labels may wrap, and modal block size is bounded by the dynamic viewport. Zoom increases text and reflows controls rather than clipping essential labels.

## Keyboard and focus acceptance

- Every action is a native button, link, select, input, radio, checkbox, or `details/summary` control.
- The Project wizard receives focus at its visible heading when opened. Changing steps focuses the new visible step heading. Escape closes when no confirmation is being settled, and closing restores the opening control.
- The Egg-gift dialog receives focus at its labelled recipient field. Tab and Shift+Tab remain inside the modal, Escape closes when safe, and closing restores the transfer setup control.
- The hatch dialog receives focus at its visible heading. Tab and Shift+Tab remain inside the modal, Escape cannot dismiss an in-flight submission, and closing restores the hatch control.
- Focus is a three-pixel electric-cyan outline with offset, not colour alone.
- No drag, spatial gesture, right-click, or hover-only action exists in the Workshop flow.

`src/composables/breeding/useBreedingFocusBoundary.ts` owns only this reusable focus containment/restoration behavior.

## Screen-reader acceptance

- The page has one `main` Workshop landmark and visible heading-labelled sections.
- Loading, selection counts, recovery, and accepted transitions use polite status semantics.
- Failures and invalid same-Trainer gift destinations use alert semantics.
- Both modal dialogs use `aria-modal="true"` and visible headings through `aria-labelledby`.
- Project and Egg progress uses native `progress` plus complete campaign-minute text alternatives.
- Native fieldsets, legends, labels, radio controls, checkbox controls, and disclosures preserve browser semantics.
- Decorative icons are hidden. Semantic state always includes text; colour and motion are never the only cue.
- Raw operation, offer, consent, Project, Egg, Profile, command, receipt, read-set, and hash identities are not used as accessible names.

Passive changes do not create an assertive announcement stream. A system recovery message remains distinct from a rules decision.

## Touch acceptance

Essential controls are at least 44 CSS pixels in both relevant dimensions. Larger labels expand radio and checkbox hit areas. Buttons, selects, disclosures, and option rows use direct manipulation behavior. Mobile layouts make primary controls full width where this improves reliable table use.

## Reduced-motion acceptance

Every Workshop component has a `prefers-reduced-motion: reduce` path. Hatch reveal animation, smooth scrolling, and incidental transitions are removed while static status copy and semantic colour/shape remain. There is no continuous decorative animation.

## Table-distance acceptance

At a 1440×900 or larger shared display:

- the page title is at least 32 CSS pixels;
- primary tasks are named in visible headings;
- campaign status and recovery are readable without opening an inspector;
- essential controls remain at least 44 CSS pixels;
- accepted, pending, warning, recovery, and destructive states include explicit text;
- no raw aggregate ID is the normal label;
- one current decision remains visually primary.

This is a campaign-maintenance view, not a public projection. The GM must still avoid displaying private owner cards to the table; structural server projection remains the privacy authority.

## Component and real-browser verification

BR-078 component acceptance remains implemented by:

- `tests/components/breedingWorkshopAccessibilityAcceptance.test.ts`;
- the five focused `tests/components/breeding*.test.ts` Workshop suites; and
- the self-hashed matrix in `data/breeding-automation/workshop-interaction-acceptance.json`.

BR-079 consumes that matrix without redefining it. `tests/nuxt/BreedingWorkshopAccessibility.test.ts` mounts the role-private shell, activity, consent, and hatch surfaces through Nuxt's `mountSuspended` harness. `tests/e2e/breeding-workshop.spec.ts` runs the production Nitro app in desktop Chromium and a Pixel 7 project, with deterministic server-created and browser-verified projections. It verifies:

- zero serious or critical axe findings for WCAG 2 A/AA and WCAG 2.1 AA tags;
- 320, 390, 768, and 1440 CSS-pixel reflow with no essential horizontal overflow and 44-pixel actions;
- keyboard entry, modal containment, safe Escape, and opener focus restoration;
- reduced-motion static equivalence;
- simultaneous GM and player contexts with structurally different private parent views;
- bounded failed-load messaging, explicit Retry, full reconnect, and no duplicate aggregate cards;
- selector-only consent and hatch requests carrying the selected Profile snapshot, with no browser command, read set, receipt, roll, or mechanics claim;
- no Project, Egg, or transfer-consent identity in rendered owner text or local persistence; and
- desktop/mobile Workshop and hatch-dialog screenshot baselines.

The immutable browser evidence inventory is `data/breeding-automation/workshop-browser-acceptance.json`. Run the focused browser suite with `npx playwright test tests/e2e/breeding-workshop.spec.ts --workers=1`; Playwright builds and serves the production Nitro output on its isolated campaign root. Treat an axe violation, projection-hash rejection, privacy difference, unexpected screenshot change, overflow, or reconnect duplication as a release failure, not as a baseline to waive casually.
