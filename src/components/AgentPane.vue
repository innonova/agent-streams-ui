<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError, api } from '@/api/client'
import type { ChatMessage, TurnImage } from '@/api/types'
import { useResizable } from '@/composables/useResizable'
import { windowSize } from '@/model'
import { useAgentsStore } from '@/stores/agents'
import { useChatStore } from '@/stores/chat'
import { useDraftsStore } from '@/stores/drafts'
import { useFeaturesStore } from '@/stores/features'
import { useNotesStore } from '@/stores/notes'
import { useNotificationsStore } from '@/stores/notifications'
import { usePresenceStore } from '@/stores/presence'
import { useProjectsStore } from '@/stores/projects'
import ActivityLine from './ActivityLine.vue'
import ChatPane from './ChatPane.vue'
import FeaturesPanel from './FeaturesPanel.vue'
import FlowStrip from './FlowStrip.vue'
import NotesPanel from './NotesPanel.vue'
import NudgeNotice from './NudgeNotice.vue'
import ResizeHandle from './ResizeHandle.vue'
import StateBadge from './StateBadge.vue'
import TranscriptView from './TranscriptView.vue'
import TurnInput from './TurnInput.vue'

/**
 * One agent: who it is in a line, then the two records of working with
 * it, each with its own input. The flow of its work, where a message is
 * the direct conversation (a turn, or a steer into the one it is in);
 * and the chat beside it, where a message is left for it to read when it
 * chooses and where its questions and decisions stand. Either can be put
 * away; where the pane is too narrow for both they are tabs.
 *
 * The pane beside the flow is a place, and the chat is what is usually
 * in it. The stream's features and notes open there too: beside the
 * agent, not instead of it, so that what is looked at stays the
 * selected agent's and the flow stays in sight while a report is read.
 */
const props = defineProps<{ agentId: string }>()
const emit = defineEmits<{ tree: []; gone: [] }>()
const agents = useAgentsStore()
const chat = useChatStore()
const drafts = useDraftsStore()
const notifications = useNotificationsStore()
const presence = usePresenceStore()
const projects = useProjectsStore()
const route = useRoute()
const router = useRouter()
const features = useFeaturesStore()
const notes = useNotesStore()

const fail = (e: unknown) =>
  notifications.push(
    'error',
    e instanceof ApiError ? e.message : String((e as Error)?.message ?? e),
  )

const current = computed(() => agents.byId.get(props.agentId))
const project = computed(() =>
  current.value ? projects.byId.get(current.value.agent.projectId)?.project : undefined,
)
const items = computed(() => agents.items.get(props.agentId) ?? [])
const messages = computed(() => chat.of(props.agentId))
const openQuestions = computed(() => chat.questionsOf(props.agentId))

watch(
  () => props.agentId,
  (id) => presence.setViewing(id),
  { immediate: true },
)
onUnmounted(() => presence.setViewing(null))
const othersHere = computed(() => presence.others(props.agentId))
const othersTyping = computed(() => othersHere.value.filter((u) => u.typing))

// ---- the two panes ---------------------------------------------------------

// The chat's width is the one dragged and remembered, and never more than
// half the pane: beside the tree on a small screen, the flow keeps its share.
const chatPane = useResizable('agent-chat', 520, 320, 1400, 'left')
const chatEl = ref<HTMLElement | null>(null)
/** A drag starts from the width the chat has, which in a small window is less than the one remembered. */
function startChatDrag(e: PointerEvent) {
  const shown = chatEl.value?.getBoundingClientRect().width
  if (shown) chatPane.width.value = Math.round(shown)
  chatPane.start(e)
}
const LAYOUTS = ['flow', 'both', 'chat'] as const
type Layout = (typeof LAYOUTS)[number]
const LAYOUT_KEY = 'agent-panes'
const LAYOUT_TITLE: Record<Layout, string> = {
  flow: 'the flow alone: the chat is put away, and what the agent asks or says in it is counted here',
  both: 'the flow and the chat side by side, each with its own input',
  chat: 'what is beside the flow alone, the flow folded to one line above it',
}
const layout = ref<Layout>(LAYOUTS.find((l) => l === localStorage.getItem(LAYOUT_KEY)) ?? 'both')
function setLayout(l: Layout) {
  layout.value = l
  localStorage.setItem(LAYOUT_KEY, l)
}
/** What is in the pane beside the flow: the chat, or something of the agent's stream. */
const BESIDE = ['chat', 'features', 'notes'] as const
type Beside = (typeof BESIDE)[number]
const BESIDE_KEY = 'agent-beside'
const beside = ref<Beside>(
  // a link to a feature opens the features, whatever was there last
  typeof route.query.feature === 'string'
    ? 'features'
    : (BESIDE.find((b) => b === localStorage.getItem(BESIDE_KEY)) ?? 'chat'),
)
function setBeside(b: Beside) {
  beside.value = b
  localStorage.setItem(BESIDE_KEY, b)
  if (layout.value === 'flow') setLayout('both')
  tab.value = 'beside'
  // an opened feature is in the address: gone from it when the features are put away
  if (b !== 'features' && route.query.feature !== undefined)
    void router.replace({ query: { ...route.query, feature: undefined } })
}
/** As tabs, the one in front is the pane the layout keeps: the one beside the flow, unless it was put away. */
const firstTab = () => (layout.value === 'flow' ? 'flow' : 'beside')
const tab = ref<'beside' | 'flow'>(firstTab())
/** What of the stream waits for a person, for the tabs: reports to read, and open notes. */
const toRead = computed(() => {
  const id = current.value?.agent.projectId
  return id ? (features.byProject.get(id) ?? []).filter((f) => f.status === 'review').length : 0
})
const openNotes = computed(() => {
  const id = current.value?.agent.projectId
  return id ? (notes.byProject.get(id)?.open ?? 0) : 0
})
watch(
  () => current.value?.agent.projectId,
  (id) => {
    if (!id) return
    if (!features.byProject.has(id)) void features.load(id).catch(() => undefined)
    if (!notes.byProject.has(id)) void notes.load(id).catch(() => undefined)
  },
  { immediate: true },
)

/** What the agent said while the chat was put away, counted on the way back to it. */
const seenUpTo = ref(new Map<string, number>())
watch(
  [
    () => props.agentId,
    () => (chat.messages.has(props.agentId) ? (messages.value.at(-1)?.id ?? 0) : undefined),
    layout,
  ],
  ([id, last]) => {
    if (last === undefined) return
    if (layout.value !== 'flow' || !seenUpTo.value.has(id))
      seenUpTo.value = new Map(seenUpTo.value).set(id, last)
  },
  { immediate: true },
)
const unseen = computed(() => {
  const upTo = seenUpTo.value.get(props.agentId)
  if (upTo === undefined || layout.value !== 'flow') return 0
  return messages.value.filter(
    (m) => m.from === 'agent' && m.id > upTo && !(m.kind === 'question' && !m.closedAt),
  ).length
})
/** Left beside the agent's work and not read: with the chat put away, the only sign of where a message went. */
const waiting = computed(
  () => messages.value.filter((m) => m.from === 'person' && m.via === 'aside' && !m.readAt).length,
)
const chatNews = computed(() =>
  layout.value !== 'flow'
    ? []
    : [
        {
          key: 'questions',
          n: openQuestions.value,
          text: `${openQuestions.value} ?`,
          tone: 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100',
          title: 'the agent has a question open in the chat',
        },
        {
          key: 'new',
          n: unseen.value,
          text: `${unseen.value} new`,
          tone: 'bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-100',
          title: 'said by the agent in the chat since you put it away',
        },
        {
          key: 'waiting',
          n: waiting.value,
          text: `${waiting.value} waiting`,
          tone: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
          title:
            'left beside its work and not read yet: the agent has been told a message waits, and gets it as its next turn if this one ends first',
        },
      ].filter((c) => c.n > 0),
)
const showChat = () => setBeside('chat')

// ---- loading ---------------------------------------------------------------

/** An item index to scroll the flow to (`?item=<index>`, or a chat message located in it). */
const scrollTarget = ref<number | null>(null)
watch(
  () => [props.agentId, route.query.item] as const,
  async ([id, itemQ]) => {
    const n = typeof itemQ === 'string' && Number.isInteger(Number(itemQ)) ? Number(itemQ) : null
    try {
      if (n != null) {
        await agents.loadUntil(id, n)
        scrollTarget.value = n
      } else {
        await agents.loadItems(id)
        scrollTarget.value = null
      }
    } catch (e) {
      fail(e)
    }
  },
  { immediate: true },
)
/** The agent's open question the chat's input is answering. */
const replyTo = ref<ChatMessage | null>(null)
watch(
  () => props.agentId,
  (id) => {
    replyTo.value = null
    tab.value = firstTab()
    const projectId = agents.byId.get(id)?.agent.projectId
    if (projectId) chat.load(id, projectId).catch((e) => fail(e))
  },
  { immediate: true },
)
// the record may arrive after the pane (a deep link): the chat is loaded once the stream is known
watch(
  () => current.value?.agent.projectId,
  (projectId, was) => {
    if (projectId && !was && !chat.messages.has(props.agentId))
      chat.load(props.agentId, projectId).catch((e) => fail(e))
  },
)
// answered or dismissed meanwhile, here or by someone else: nothing left to answer
watch(
  () => messages.value.find((m) => m.id === replyTo.value?.id)?.closedAt,
  (closedAt) => {
    if (closedAt) replyTo.value = null
  },
)

// ---- what the agent is doing ----------------------------------------------

const activity = computed(() => current.value?.status.activity ?? null)
/** The current thinking item's live text: only the last item counts, since nothing else appends while it streams. */
const liveThinkingText = computed(() => {
  if (activity.value?.kind !== 'thinking') return null
  const last = items.value[items.value.length - 1]
  return last?.item.kind === 'thinking' ? last.item.text : null
})
/**
 * A tool call whose result has not arrived: the manager's own activity
 * broadcast for it is throttled and can lag a turn that just started
 * one, but the flow already has it the instant the item does.
 */
const pendingToolUse = computed(() => {
  const last = items.value[items.value.length - 1]
  return last?.item.kind === 'tool_use' ? { name: last.item.name, since: last.at } : null
})
const effectiveActivity = computed(() => {
  const a = activity.value
  const pending = pendingToolUse.value
  if (!a || !pending || a.kind === 'tool' || a.kind === 'waiting') return a
  return { kind: 'tool' as const, tool: pending.name, tokens: a.tokens, since: pending.since }
})
const activeToolName = computed(() =>
  effectiveActivity.value?.kind === 'tool'
    ? (effectiveActivity.value.tool ?? pendingToolUse.value?.name ?? null)
    : null,
)
/** The activity overlay's measured height, so the flow's floating buttons can clear it. */
const activityHeight = ref(0)

const context = computed(() => {
  const c = current.value?.status.usage?.context
  if (!c) return null
  return {
    percent: Math.round((100 * c.used) / Math.max(1, c.size)),
    size: windowSize(c.size),
    title: `context window: ${c.used.toLocaleString()} of ${c.size.toLocaleString()} tokens in use. When it fills, the conversation is compacted: replaced by a summary of itself.`,
  }
})

// ---- acting ---------------------------------------------------------------

async function decide(requestId: string, option: string) {
  await agents.decide(props.agentId, requestId, option).catch(fail)
}

/** The last message sent, by flow index: stops at a withdrawal's marker (that message is gone already). */
const lastPromptIndex = computed((): number | null => {
  for (let i = items.value.length - 1; i >= 0; i--) {
    const s = items.value[i]
    if (!s) continue // the array has holes while history is paged in
    if (s.item.kind === 'system' && s.item.withdrawnFrom !== undefined) return null
    if (s.item.kind === 'user' && s.item.text) return s.index
  }
  return null
})
/**
 * The last message can be taken back to be edited and sent again: "that
 * was nonsense: stop, edit, go". The manager stops the turn if one runs
 * and hands the text back; a Claude agent also forgets the message and
 * its reply. What the reply did on disk stays, and the line left in the
 * flow says what.
 */
const takingBack = ref(false)
const withdrawal = computed(() => {
  const row = current.value
  const claude = row?.agent.profile === 'claude'
  return {
    reason: !row ? 'no agent' : row.status.state === 'starting' ? 'the agent is starting' : null,
    title:
      'take this message back to edit it: the agent is stopped if it still works on it, and the text returns to the input below. ' +
      (claude
        ? 'The agent forgets the message and its reply; what the reply changed on disk stays.'
        : `The agent still has the message (${row?.agent.profile} keeps its conversation out of reach).`),
    busy: takingBack.value,
  }
})
/** A message sent this recently is taken back at once: that is the slip being corrected. An older one asks first. */
const SLIP_MS = 2 * 60_000
const flowInput = ref<InstanceType<typeof TurnInput> | null>(null)
const chatInput = ref<InstanceType<typeof TurnInput> | null>(null)
async function withdraw() {
  const row = current.value
  const index = lastPromptIndex.value
  if (!row || index === null || takingBack.value) return
  const agentId = props.agentId
  const sent = items.value.find((s) => s?.index === index)
  if (!sent || sent.item.kind !== 'user') return
  const claude = row.agent.profile === 'claude'
  const working = row.status.state !== 'idle' && row.status.state !== 'exited'
  const minutes = Math.round((Date.now() - sent.at) / 60_000)
  if (Date.now() - sent.at > SLIP_MS && (claude || working)) {
    const ask =
      `This message was sent ${minutes} min ago. Take it back to edit it? ` +
      (working ? 'The agent is stopped. ' : '') +
      (claude
        ? 'It will have no memory of the message or of anything it did since; what it changed on disk stays.'
        : '')
    if (!confirm(ask.trim())) return
  }
  takingBack.value = true
  try {
    const { text } = await api.undo(agentId, index)
    const draft = drafts.get(agentId)
    drafts.set(agentId, draft.trim() ? `${text}\n\n${draft}` : text)
    if (props.agentId === agentId) flowInput.value?.restore(sent.item.images)
  } catch (e) {
    fail(e)
  } finally {
    takingBack.value = false
  }
}
/** The permission waiting for an answer, for the bar above the inputs where the flow may be out of sight. */
const pendingPermission = computed(() => {
  for (let i = items.value.length - 1; i >= 0; i--) {
    const it = items.value[i]?.item
    if (it?.kind === 'permission') return it.decision ? null : it
  }
  return null
})
/** The flow's input: a turn, or into the turn the agent is in. Its place is the flow, where the answer follows it. */
async function send(text: string, images: TurnImage[] = []) {
  const agentId = props.agentId
  try {
    const steer = current.value?.status.state === 'working'
    const { mode } = await api.turn(agentId, text, steer, images)
    drafts.set(agentId, '') // accepted: the draft is done; refused: it stays
    flowInput.value?.clearAttachments()
    if (mode === 'queued')
      notifications.push(
        'info',
        'the agent cannot take a message mid-turn; queued for when it finishes',
      )
  } catch (e) {
    fail(e)
  }
}
/** The chat's input: beside the work while the agent is in a turn, and what wakes it when it is not. */
async function say(text: string, images: TurnImage[] = []) {
  const agentId = props.agentId
  try {
    await chat.say(agentId, { text, images, replyTo: replyTo.value?.id })
    drafts.set(`${agentId}:chat`, '')
    chatInput.value?.clearAttachments()
    replyTo.value = null
  } catch (e) {
    fail(e)
  }
}
function answer(m: ChatMessage) {
  replyTo.value = m
  if (beside.value !== 'chat') setBeside('chat')
  void nextTick(() =>
    document.querySelector<HTMLTextAreaElement>('[data-test=chat-input]')?.focus(),
  )
}
const dismiss = (m: ChatMessage) => chat.close(m.agentId, m.id).catch(fail)
/**
 * Scrolls the flow to where a chat message is in it. The two records
 * share a clock and nothing else, so the place is found by time; what
 * was handed over as it was written is the person's own item with the
 * text in it, which settles it between two sent close together.
 */
async function locate(m: ChatMessage) {
  const agentId = props.agentId
  const aside = m.from === 'person' && m.via === 'aside'
  const t = aside ? m.readAt : m.at
  if (t == null) return
  const first = () => agents.items.get(agentId)?.find((s) => s)?.at ?? 0
  for (let guard = 0; guard < 200 && agents.hasEarlier(agentId) && first() > t; guard++)
    await agents.loadEarlier(agentId)
  const list = agents.items.get(agentId) ?? []
  let index: number | null = null
  if (m.from === 'person') {
    // an aside is marked read once the turn that carries it is under way, which can take a moment
    const near = list.filter(
      (s) =>
        s &&
        s.item.kind === 'user' &&
        s.at >= t - (aside ? 10_000 : 2000) &&
        (!aside || s.at <= t + 2000),
    )
    const own = near.find((s) => s.item.kind === 'user' && s.item.text.includes(m.text))
    index = (own ?? (aside ? undefined : near.find((s) => s.at >= t)))?.index ?? null
  }
  if (index === null)
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i]
      // a result is folded under its call: the call is the row to land on
      if (s && s.at <= t && s.item.kind !== 'tool_result') {
        index = s.index
        break
      }
    }
  if (index === null) {
    notifications.push('info', 'that moment is not in the flow')
    return
  }
  if (layout.value === 'chat') setLayout('both')
  tab.value = 'flow'
  scrollTarget.value = null // the same place again is still a request to go there
  await nextTick()
  scrollTarget.value = index
}

const interrupt = () => api.interrupt(props.agentId).catch(fail)
/** Calls the manager's pending question off: the person is here and will write. */
const holding = ref(false)
async function holdNudge() {
  holding.value = true
  await api.nudgeHold(props.agentId).catch(fail)
  holding.value = false
}

/** The few things done to an agent rather than said to it, behind one button: none of them is the work. */
const menu = ref(false)
const menuEl = ref<HTMLElement | null>(null)
function closeMenu(e: MouseEvent) {
  if (!menuEl.value?.contains(e.target as Node)) menu.value = false
}
watch(menu, (open) => {
  if (open) document.addEventListener('click', closeMenu, true)
  else document.removeEventListener('click', closeMenu, true)
})
onUnmounted(() => document.removeEventListener('click', closeMenu, true))
async function act(what: 'restart' | 'compact' | 'end' | 'archive') {
  menu.value = false
  const id = props.agentId
  if (what === 'restart') return api.restart(id).catch(fail)
  if (what === 'end') return api.stop(id).catch(fail)
  if (what === 'compact') {
    if (
      !confirm(
        "Compact this agent's context now? What it holds is replaced by a summary of it, and its dialog with you is handed back to it word for word. The dialog is weighed first if it has grown, which takes minutes; the flow says how it goes.",
      )
    )
      return
    return api
      .compact(id)
      .then(() => notifications.push('info', 'compaction asked for'))
      .catch(fail)
  }
  if (!confirm('Archive this agent? Its session ends; everything it said and did is kept.')) return
  await agents
    .archive(id)
    .then(() => emit('gone'))
    .catch(fail)
}
const busy = computed(() => {
  const s = current.value?.status.state
  return s === 'working' || s === 'starting'
})
</script>

<template>
  <section v-if="current" class="@container flex min-h-0 min-w-0 grow flex-col" data-test="agent">
    <header
      class="flex min-h-10 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-200 bg-white px-3 py-1.5 dark:border-slate-800 dark:bg-slate-900"
      data-test="agent-header"
    >
      <button
        type="button"
        class="-ml-1 rounded px-2 py-1 text-lg leading-none text-slate-600 hover:bg-slate-100 md:hidden dark:text-slate-300 dark:hover:bg-slate-800"
        aria-label="streams and agents"
        data-test="tree-button"
        @click="emit('tree')"
      >
        ☰
      </button>
      <!-- whose agent this is stays in sight: everything here is grounded in it -->
      <h1 class="flex min-w-0 items-baseline gap-1.5 text-base" data-test="agent-title">
        <span class="truncate text-slate-500 dark:text-slate-400" data-test="agent-stream">{{
          project?.name
        }}</span>
        <span class="text-slate-300 dark:text-slate-600">›</span>
        <span class="truncate font-semibold">{{ current.agent.name }}</span>
      </h1>
      <StateBadge
        :state="current.status.state"
        :background="current.status.background"
        :title="current.status.error ?? undefined"
      />
      <button
        v-if="openQuestions"
        type="button"
        class="rounded bg-amber-100 px-1.5 py-0.5 text-sm text-amber-900 dark:bg-amber-900 dark:text-amber-100"
        title="open questions from the agent, pinned in the chat"
        data-test="header-questions"
        @click="showChat"
      >
        {{ openQuestions }} ?
      </button>
      <span
        v-if="current.status.model ?? current.agent.model"
        class="hidden font-mono text-sm text-slate-500 @2xl:inline dark:text-slate-400"
        data-test="agent-model"
        >{{ current.status.model ?? current.agent.model }}</span
      >
      <span
        v-if="context"
        class="font-mono text-sm"
        :class="
          context.percent >= 80
            ? 'text-amber-700 dark:text-amber-300'
            : 'text-slate-500 dark:text-slate-400'
        "
        :title="context.title"
        data-test="agent-context"
        >ctx {{ context.percent }}% of {{ context.size }}</span
      >
      <span
        v-if="current.status.error"
        class="min-w-0 truncate text-sm text-red-700 dark:text-red-300"
        :title="current.status.error"
        >{{ current.status.error }}</span
      >
      <span
        v-if="othersHere.length"
        class="text-sm text-violet-700 dark:text-violet-300"
        data-test="presence"
        >{{ othersHere.map((u) => u.name).join(', ') }}
        {{ othersHere.length === 1 ? 'is' : 'are' }} here</span
      >
      <span class="grow" />
      <!-- which panes: as tabs (too narrow for two) there is nothing to choose -->
      <div
        class="hidden items-center overflow-hidden rounded border border-slate-300 text-sm @3xl:flex dark:border-slate-700"
        role="group"
        aria-label="panes shown"
        data-test="panes"
      >
        <button
          v-for="l in LAYOUTS"
          :key="l"
          type="button"
          class="border-slate-300 px-2 py-0.5 not-first:border-l dark:border-slate-700"
          :class="
            layout === l
              ? 'bg-slate-200 font-medium text-slate-900 dark:bg-slate-700 dark:text-slate-100'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
          "
          :title="LAYOUT_TITLE[l]"
          :aria-pressed="layout === l"
          :data-test="`panes-${l}`"
          @click="setLayout(l)"
        >
          {{ l === 'chat' ? beside : l }}
          <template v-if="l === 'chat' && beside === 'chat'">
            <span
              v-for="c in chatNews"
              :key="c.key"
              class="ml-0.5 rounded px-1"
              :class="c.tone"
              :title="c.title"
              :data-test="`panes-chat-${c.key}`"
              >{{ c.text }}</span
            >
          </template>
        </button>
      </div>
      <div ref="menuEl" class="relative">
        <button
          type="button"
          class="rounded border border-slate-300 px-2 py-0.5 text-sm text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          aria-haspopup="menu"
          :aria-expanded="menu"
          title="restart, compact, end the session, archive"
          data-test="agent-menu"
          @click="menu = !menu"
        >
          ⋯
        </button>
        <div
          v-if="menu"
          class="absolute right-0 z-30 mt-1 w-64 rounded border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900"
          role="menu"
          data-test="agent-menu-items"
        >
          <button
            type="button"
            role="menuitem"
            class="block w-full px-3 py-1.5 text-left hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800"
            :disabled="busy"
            data-test="agent-restart"
            @click="act('restart')"
          >
            restart
            <span class="block text-xs text-slate-500 dark:text-slate-400"
              >a fresh process with its conversation; refused while it works</span
            >
          </button>
          <button
            v-if="current.agent.profile === 'claude' || current.agent.profile === 'fake'"
            type="button"
            role="menuitem"
            class="block w-full px-3 py-1.5 text-left hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800"
            :disabled="busy"
            data-test="agent-compact"
            @click="act('compact')"
          >
            compact
            <span class="block text-xs text-slate-500 dark:text-slate-400"
              >its context becomes a summary, with the dialog handed back</span
            >
          </button>
          <button
            type="button"
            role="menuitem"
            class="block w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
            data-test="agent-end"
            @click="act('end')"
          >
            end session
            <span class="block text-xs text-slate-500 dark:text-slate-400"
              >its process ends; the next message starts it again</span
            >
          </button>
          <button
            type="button"
            role="menuitem"
            class="block w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
            data-test="agent-archive"
            @click="act('archive')"
          >
            archive
            <span class="block text-xs text-slate-500 dark:text-slate-400"
              >off the tree, everything kept</span
            >
          </button>
        </div>
      </div>
    </header>
    <!-- too narrow for two panes: tabs, the chat first unless it was put away -->
    <div
      class="flex shrink-0 border-b border-slate-200 bg-white text-base @3xl:hidden dark:border-slate-800 dark:bg-slate-900"
      data-test="pane-tabs"
    >
      <button
        v-for="t in ['chat', 'flow', 'features', 'notes'] as const"
        :key="t"
        type="button"
        class="grow border-b-2 px-2 py-2"
        :class="
          (t === 'flow' ? tab === 'flow' : tab === 'beside' && beside === t)
            ? 'border-blue-600 font-medium'
            : 'border-transparent text-slate-500 dark:text-slate-400'
        "
        :data-test="`pane-tab-${t}`"
        :aria-selected="t === 'flow' ? tab === 'flow' : tab === 'beside' && beside === t"
        @click="t === 'flow' ? (tab = 'flow') : setBeside(t)"
      >
        {{ t }}
        <span
          v-if="t === 'chat' && openQuestions"
          class="ml-1 rounded bg-amber-100 px-1.5 text-sm text-amber-900 dark:bg-amber-900 dark:text-amber-100"
          >{{ openQuestions }} ?</span
        >
        <span
          v-if="t === 'features' && toRead"
          class="ml-1 rounded bg-violet-100 px-1.5 text-sm text-violet-900 dark:bg-violet-900 dark:text-violet-100"
          >{{ toRead }}</span
        >
        <span v-if="t === 'notes' && openNotes" class="ml-1 text-sm text-slate-400">{{
          openNotes
        }}</span>
      </button>
    </div>
    <div
      class="grid min-h-0 grow grid-cols-1 grid-rows-[minmax(0,1fr)_auto_auto]"
      :class="
        layout === 'both'
          ? '@3xl:grid-cols-[minmax(18rem,1fr)_minmax(0,min(var(--chat-w),50%))]'
          : ''
      "
      :style="{ '--chat-w': `${chatPane.width.value}px` }"
      data-test="agent-panes"
    >
      <div
        class="relative min-h-0 min-w-0"
        :class="[
          tab === 'flow' ? 'block' : 'hidden',
          layout === 'chat' ? '@3xl:hidden' : '@3xl:col-start-1 @3xl:row-start-1 @3xl:block',
        ]"
        data-test="flow-pane"
      >
        <TranscriptView
          :items="items"
          :has-earlier="agents.hasEarlier(agentId)"
          :loading-earlier="agents.loadingEarlier.has(agentId)"
          :activity-height="activityHeight"
          :scroll-to="scrollTarget"
          :withdraw-index="lastPromptIndex"
          :withdraw="withdrawal"
          @decide="decide"
          @withdraw="withdraw"
          @load-earlier="agents.loadEarlier(agentId)"
        />
        <!-- an overlay, not inserted in the flow: see ActivityLine.vue -->
        <ActivityLine
          :activity="effectiveActivity"
          :thinking-text="liveThinkingText"
          :tool-name="activeToolName"
          @resize="activityHeight = $event"
        />
      </div>
      <div
        ref="chatEl"
        class="min-h-0 min-w-0 flex-col border-slate-200 dark:border-slate-800"
        :class="[
          tab === 'beside' ? 'flex' : 'hidden',
          layout === 'flow'
            ? '@3xl:hidden'
            : layout === 'both'
              ? '@3xl:col-start-2 @3xl:row-start-1 @3xl:flex @3xl:border-l'
              : '@3xl:flex',
          // what has no input of its own under it runs to the bottom of the screen
          layout === 'both' && beside !== 'chat' ? '@3xl:row-span-3' : '',
        ]"
        :data-test="beside === 'chat' ? 'chat-pane' : 'beside-pane'"
        :data-beside="beside"
      >
        <div v-if="layout === 'chat'" class="hidden shrink-0 @3xl:block">
          <FlowStrip
            :state="current.status.state"
            :activity="effectiveActivity"
            :tool-name="activeToolName"
            @open="setLayout('both')"
          />
        </div>
        <!-- what is in this pane: chosen here where there is room for two panes, in the tabs above otherwise -->
        <div
          class="hidden shrink-0 items-center gap-1 border-b border-slate-200 px-2 text-sm @3xl:flex dark:border-slate-800"
          role="tablist"
          aria-label="beside the flow"
          data-test="beside-tabs"
        >
          <button
            v-for="b in BESIDE"
            :key="b"
            type="button"
            role="tab"
            class="-mb-px border-b-2 px-2 py-1.5"
            :class="
              beside === b
                ? 'border-blue-600 font-medium text-slate-900 dark:text-slate-100'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            "
            :aria-selected="beside === b"
            :data-test="`beside-${b}`"
            @click="setBeside(b)"
          >
            {{ b }}
            <span
              v-if="b === 'chat' && openQuestions"
              class="ml-0.5 rounded bg-amber-100 px-1 text-xs text-amber-900 dark:bg-amber-900 dark:text-amber-100"
              data-test="beside-chat-questions"
              >{{ openQuestions }} ?</span
            >
            <span
              v-if="b === 'features' && toRead"
              class="ml-0.5 rounded bg-violet-100 px-1 text-xs text-violet-900 dark:bg-violet-900 dark:text-violet-100"
              title="reports for you to read"
              data-test="beside-features-count"
              >{{ toRead }}</span
            >
            <span
              v-if="b === 'notes' && openNotes"
              class="ml-0.5 text-xs text-slate-400"
              title="open notes"
              data-test="beside-notes-count"
              >{{ openNotes }}</span
            >
          </button>
          <span class="grow" />
          <span class="truncate text-xs text-slate-400 dark:text-slate-500">{{
            beside === 'chat' ? `with ${current.agent.name}` : `of ${project?.name ?? ''}`
          }}</span>
        </div>
        <FeaturesPanel v-if="beside === 'features'" :project-id="current.agent.projectId" />
        <NotesPanel v-else-if="beside === 'notes'" :project-id="current.agent.projectId" />
        <ChatPane
          v-else
          :messages="messages"
          :has-earlier="chat.earlier.has(agentId)"
          :loading-earlier="chat.loadingEarlier.has(agentId)"
          @answer="answer"
          @dismiss="dismiss"
          @locate="locate"
          @load-earlier="chat.loadEarlier(agentId)"
        />
      </div>
      <!-- the divider between the panes, on the chat's left edge -->
      <div
        v-if="layout === 'both'"
        class="z-10 hidden justify-self-start @3xl:col-start-2 @3xl:row-start-1 @3xl:flex"
      >
        <ResizeHandle @start="startChatDrag" />
      </div>
      <!-- where the flow may be out of sight (tabs, or folded to its line): the permission's
           answers as big buttons above the input, until answered -->
      <div
        v-if="pendingPermission"
        class="flex items-center gap-2 border-t border-amber-400 bg-amber-50 px-3 py-2 dark:border-amber-600 dark:bg-amber-950"
        :class="layout === 'chat' ? '' : '@3xl:hidden'"
        data-test="permission-bar"
      >
        <span class="min-w-0 grow truncate text-sm text-amber-900 dark:text-amber-100"
          ><span class="font-mono font-semibold">{{ pendingPermission.tool }}</span>
          {{ pendingPermission.title }}</span
        >
        <button
          v-for="o in pendingPermission.options"
          :key="o.id"
          class="shrink-0 rounded border px-4 py-3 text-base"
          :class="
            o.kind === 'deny'
              ? 'border-red-400 text-red-800 dark:border-red-700 dark:text-red-200'
              : 'border-emerald-500 bg-white text-emerald-800 dark:bg-slate-900 dark:text-emerald-200'
          "
          :data-test="`permission-bar-${o.kind}`"
          @click="decide(pendingPermission.requestId, o.id)"
        >
          {{ o.label }}
        </button>
      </div>
      <!-- an input under each pane, and what is written goes to the pane above it -->
      <div
        class="relative grid min-w-0 grid-cols-1"
        :class="
          layout === 'both' && beside === 'chat' ? '@3xl:col-span-2 @3xl:grid-cols-subgrid' : ''
        "
        data-test="composer"
      >
        <!-- typing floats right above the inputs, without moving anything -->
        <div
          v-if="othersTyping.length"
          class="pointer-events-none absolute bottom-full left-4 mb-2 rounded bg-white/90 px-2 py-0.5 text-sm text-violet-700 shadow-sm dark:bg-slate-900/90 dark:text-violet-300"
          data-test="presence-typing"
        >
          <span class="animate-pulse">{{
            othersTyping.map((u) => `${u.name} is typing…`).join(' · ')
          }}</span>
        </div>
        <div
          class="min-w-0"
          :class="[
            tab === 'flow' ? 'block' : 'hidden',
            layout === 'chat' ? '@3xl:hidden' : '@3xl:block',
          ]"
        >
          <!-- the notice lies over the input: to type, the person calls the manager's question off first -->
          <div class="relative">
            <TurnInput
              ref="flowInput"
              :key="agentId"
              :agent-id="agentId"
              :state="current.status.state"
              :queued="current.status.queued"
              :disabled="!!current.status.nudge"
              @send="send"
              @interrupt="interrupt"
              @typing="presence.typed()"
              @stopped-typing="presence.stoppedTyping()"
            />
            <NudgeNotice
              v-if="current.status.nudge"
              :nudge="current.status.nudge"
              :busy="holding"
              @hold="holdNudge"
            />
          </div>
        </div>
        <div
          v-if="beside === 'chat'"
          class="min-w-0 border-slate-200 dark:border-slate-800"
          :class="[
            tab === 'beside' ? 'block' : 'hidden',
            layout === 'flow'
              ? '@3xl:hidden'
              : layout === 'both'
                ? '@3xl:block @3xl:border-l'
                : '@3xl:block',
          ]"
        >
          <!-- the chat's input belongs to the chat: features and notes have their own ways to write -->
          <!-- beside the flow's input, that one's stop is the one -->
          <TurnInput
            ref="chatInput"
            :key="agentId"
            chat
            :agent-id="agentId"
            :state="current.status.state"
            :reply="replyTo ? { id: replyTo.id, excerpt: replyTo.text } : null"
            :interrupt-class="layout === 'both' ? '@3xl:hidden' : ''"
            @send="say"
            @interrupt="interrupt"
            @typing="presence.typed()"
            @stopped-typing="presence.stoppedTyping()"
            @cancel-reply="replyTo = null"
          />
        </div>
      </div>
    </div>
  </section>
</template>
