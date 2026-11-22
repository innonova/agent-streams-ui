# agent-streams-ui

The web UI being built for [agent-manager](../agent-manager) as it
becomes with streams: one screen, the tree of streams and agents beside
the agent being worked with. Served by the manager under `/next/` while
[agent-manager-ui](../agent-manager-ui) stays at `/`.

- What it is and why: `docs/design.md`.
- Working on it: `CLAUDE.md`.

```
npm install
npm run dev          # against the manager on 127.0.0.1:4268
npm run build        # dist/, served under /next/
```

Deploy: `npm run build`, then `npm run install:ui-next` in
`../agent-manager`.
