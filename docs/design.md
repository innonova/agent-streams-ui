# agent-streams-ui: design

The UI for the manager as it becomes with streams
(`agent-manager/docs/streams.md`). Started 2026-11-22. It is built
beside `agent-manager-ui`, which stays in use until this one can take
its place.

## Why a new one

The current UI grew from "a project is a list of repositories": a top
bar with a project switcher and tabs (agents, files, changes, features,
notes), a page listing projects in front of it all. The person's words
for what is wrong with that, which are the brief for this one:

- **The front page is the page where you work with the agents.** The
  list of projects is a configuration page awkwardly placed; every
  project is already listed in the tree beside the agent.
- **The other views lose their grounding.** Files, features and changes
  are decided by the agent selected, and going to them loses the
  selection.
- **Use the interactive view as the core, and do not add every existing
  feature because it exists.** Each is considered afterwards.
- **The tree wants another level**, so that streams can be organised
  instead of being one long flat list.

## The screen

One screen, and nothing above it.

```
┌────────────────┬────────────────────────────────────────────────┐
│ find… [+stream]│ stream › agent  state  ctx      [flow|both|chat] ⋯ │
│ GROUP          ├──────────────────────────┬─────────────────────┤
│  ≈ stream      │ flow                     │ chat                │
│     agent   ○  │                          │                     │
│     agent  1 ? │                          │                     │
│  ▤ project     │                          │                     │
│ GROUP      2 1 ├──────────────────────────┼─────────────────────┤
│ user theme out │ message the agent        │ say in the chat     │
└────────────────┴──────────────────────────┴─────────────────────┘
```

- **No top bar.** The application's own few things (who is logged in,
  the theme, the connection, the way back to the current UI) sit under
  the tree. The agent's header is one line. On a low screen the work
  gets the height.
- **Two addresses**: `/next/` and `/next/a/<agent id>`. An agent is
  found by its id; the manager says which stream it is in. With room
  for both panes, `/next/` opens on the agent last looked at.
- **On a phone the two are pages**, the tree first: it is the list one
  comes back to, and the back button does that. The agent's panes are
  tabs there, the chat in front, as in the current UI.

## The tree

- Three levels: **group**, then **stream or project**, then **agent**.
  A group is a label on the stream (`project.group` in the manager) and
  nothing else: no setting or permission follows from it. Named groups
  come first by name, the ungrouped last; with no groups at all there
  are no headings and the tree is the flat list it would have been.
- **Streams and projects are both there**, told apart by a mark (a wave
  for a stream, stacked boxes for a project) and nothing more: to work
  with an agent it does not matter which it is in.
- **A folded row says what in it needs someone**: how many wait for a
  person (an answer, a permission, an open question in a chat), how
  many failed, how many are at work. Nothing has to be opened to find
  out. Idle agents are not counted: they need nobody.
- **States that need nobody are quiet.** An idle agent is a ring, a
  working one a dot that beats; only waiting, permission and error are
  words. Thirty agents with "idle" written thirty times hide the one
  that waits.
- **Finding**: a field at the top filters by stream, group and (for
  streams whose agents are loaded) agent name, and shows what matched
  whatever was folded.
- A stream's "⋯" holds what is done to it rather than in it: its group,
  and its archived agents.
- The selected agent's stream is always open and its group unfolded.

## The agent

The flow and the chat as two records from the start, each with its own
input, as arrived at in the current UI over several rounds: the flow's
input is the direct conversation (a turn, or a steer), the chat's is
what is left beside the work. Either pane can be put away; too narrow
for both, they are tabs. The header keeps the stream's name before the
agent's, so what everything on screen is about stays in sight.

What is done to an agent rather than said to it (restart, compact, end
session, archive) is behind one "⋯": none of it is the work.

## Beside the flow

The pane beside the flow is a place, and the chat is what is usually in
it. The stream's **features** and **notes** open there too, chosen by a
small row of tabs at the top of that pane (and among the pane tabs
where there is room for one pane only), each with a count of what waits
for a person: open questions, reports to read, open notes.

This is the answer to "the other views lose their grounding": a report
is read, answered and closed with the agent that wrote it still
selected, its name in the header and its flow to the left, and the flow
keeps its input, so "do it again, but…" is typed without leaving. What
has no input of its own under it (features, notes) runs to the bottom
of the screen; the chat's input comes and goes with the chat.

- **Features**: the list first, in the order that matters to a person
  (for you to read, in progress, blocked, planned; done is counted and
  shown when asked for), each row saying where it stands by its latest
  report or response. One feature opened takes the pane, with what a
  person does to it (done, block, reopen, edit, respond) at the top and
  bottom, and is in the address (`?feature=<slug>`), so a reload or a
  link comes back to it. There is deliberately no button that sends
  the feature to the agent: asking is typed, in the flow beside it.
- **Notes**: the add box first and always, the open ones as a
  checklist, the done ones folded. The box empties the moment a note
  is sent, so what is typed next is the next note.
- **Stream** (for a project of the older kind, "project"): what it is
  for, which is its instruction file rendered and editable in place,
  and its clones with the branch each is on, with a way to bring a
  repository in from the registry. A project shows its repositories.
- What the pane last held is remembered per browser.

Files and changes are not there yet; when they come, this is where.

## Carried over unchanged

From `agent-manager-ui`, copied and not rewritten, because they hold
detail that was learned the hard way: the transcript (`TranscriptView`,
`TranscriptItem`, `ToolCallItem`), the activity line as an overlay, the
chat pane, the input with drafts and pasted images, the nudge notice,
the stores (the sparse item array and its paging, the chat's ordering
guard, presence, attention in the title and favicon, notifications),
the API and events clients, the iOS viewport handling, the Dark+
palette, and the reload on a stale chunk after a deploy.

## Not here, and not decided

Each of these exists in the current UI and is reached there (the
"current UI" link under the tree, and two links in the settings) until
it has been considered here:

- files and changes;
- what of a stream's clones is not yet landed on main;
- an agent's harness note, account usage;
- users, machines, the harness, models, method and framing texts, the
  learnings log;
- creating or editing a project of the old kind (a list of
  repositories);
- the installable app: there is one service worker for the origin, the
  current UI's, so push to a phone is turned on from either UI and a
  push that is tapped opens the current UI.

When one comes back it opens beside the selected agent, not instead of
it.

## The application's own things

Under the tree, in one line: the connection state when it is not fine,
an "update · reload" button when the manager serves a newer build of
this UI (announced as `ui-next.build`, apart from the other UI's
deploys), who is logged in, the settings (theme, text size, desktop
notifications, push), the way back to the current UI, and logging out.

What is done to an agent is behind the "⋯" in its header: edit (one
form for a new agent and an existing one), statistics, fork (a new
agent that begins with this one's whole conversation, here or in
another stream: how work that grew out of a conversation gets a place
of its own), restart, compact, end session, archive, delete.

## Served how

Built with base `/next/` and served by the manager from
`<install>/ui-next` (`AGENT_MANAGER_UI_NEXT_DIR`), with its
`index.html` for any path beneath `/next/`. Same origin, same cookie,
same API as the current UI. `npm run install:ui-next` in the manager
swaps the directory without restarting it.
