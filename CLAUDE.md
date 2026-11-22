# agent-streams-ui

The web UI being built for streams (`../agent-manager/docs/streams.md`),
served by the manager under `/next/` while `agent-manager-ui` stays in
use at `/`. It talks to the same manager over the same API. Its design
and the decisions behind it are in `docs/design.md`; read it before
changing how the screen is organised, and update it when a decision
changes.

## What it is, in one paragraph

One screen. The tree of every stream and project on the left, under the
groups they were put in; the selected agent beside it, with the flow of
its work and the chat as two records, each with its own input. No page
above that one and no bar across the top. Everything else is added only
when it has been considered, and opens beside the selected agent rather
than instead of it.

## Rules that follow from the design

- **Do not port a feature of the old UI because it exists.** Each one is
  considered first: whether it is wanted, and where it belongs on the
  one screen.
- **Nothing takes the selected agent away.** A view of an agent's files,
  features or changes opens with the agent still selected and in sight.
- **Look at the screen.** A change to what is shown is looked at in a
  browser, at desktop, low and phone sizes, before it is called done; a
  green suite over a screen nobody looked at is not a finished change.
  Tests of layout measure geometry (`e2e/work.spec.ts` does).
- **The copied parts stay copies.** `TranscriptView`, `TranscriptItem`,
  `ToolCallItem`, `ActivityLine`, `ChatPane`, `TurnInput` and the
  stores under `src/stores/` came from `agent-manager-ui` unchanged and
  hold hard-won detail (the sparse item array, scroll pinning, the iOS
  viewport). Change them for a reason, and say so.
- The item array of a transcript has holes while history is paged in.
  Every loop over it expects them.

## Stack and commands

Vue 3, Vite, Tailwind 4 (configured in CSS), Pinia, vue-router;
vitest and Playwright.

```
npm run dev            # Vite on 5173, /api proxied to the manager on 4268 (AGENT_MANAGER_URL)
npx vue-tsc --noEmit -p tsconfig.app.json
npx vitest run
npm run lint && npm run format
npx playwright test    # starts its own daemon and manager on 4298 and Vite on 5174
npm run build          # dist/, with base /next/
```

The Playwright suite uses fixed ports of its own (4298, 5174), so it can
run while `agent-manager-ui`'s (4299, 5173) does; one run of this one at
a time. Both sibling repositories must be built first.

## Finishing work

Completed work is committed, pushed and deployed without asking first.
Deploy: `npm run build` here, then `npm run install:ui-next` in
`../agent-manager`, which swaps the directory the installed manager
serves under `/next/` without restarting it. Still ask first for
force-pushes, history rewrites, deleting branches and work beyond what
was asked.

## You may be running inside this system

The installed manager on port 4268 is a person's live workspace: demos
and probes go to a separate instance. Tests must never touch
`~/.config/agent-manager`, `~/.local/state/agent-manager` or
`~/streams`; the test backend sets every directory to its own.
