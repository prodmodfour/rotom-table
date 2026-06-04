# Contributing

Rotom Table is a private trusted-table fan project and long-running hobby tool with filesystem-backed campaign data. Contributions should preserve that shape unless a future project direction explicitly changes it.

## Local setup

```bash
npm install
npm run dev
```

Open the local Nuxt URL and choose **GM Login** or **Player Login** depending on the workflow you want to inspect.

Optional helpers:

```bash
just
just encounter <region> <table> <count> preview
```

## Suggested checks

Before sharing a change, run:

```bash
npm run typecheck
npm test
npm run build
```

For move automation work, also run:

```bash
npm run check:move-automation
```

For move VFX work, copy the PR checklist from `docs/move-animations.md#copyable-pr-checklist-for-move-vfx-changes` into the PR description and run the focused tests/manual QA listed there when they apply.

## Data hygiene

- Do not commit personal campaign data, private player details, credentials, unreleased story notes, or one-off local scratch data.
- Check `git status` carefully before committing changes under `data/`, `encounter_tables/`, or any generated-output folder.
- Keep JSON data readable, formatted, and inspectable. Prefer explicit fields over opaque blobs.
- Generated wild sheets should be reviewed before committing and should only be committed if they are meant to serve as examples.

## Behaviour changes

- Update or add tests for behaviour changes.
- Keep server route handlers, use cases, shared helpers, and UI utilities separated by responsibility.
- Preserve private trusted-table and filesystem-backed assumptions unless the change explicitly includes a reviewed persistence/auth design.
- Avoid changing application behaviour in documentation-only or presentation-only passes.

## Fan-project boundaries

- Do not present the project as official, endorsed, or commercial.
- Do not claim ownership of Pokémon/PTU-related names, images, rules terms, or concepts.
- Do not add third-party assets or content unless their source and usage boundaries are understood.
- Keep notices in `NOTICE.md` and `docs/fan-project-notice.md` aligned when changing presentation language.
