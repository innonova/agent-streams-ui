<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { ApiError, api } from '@/api/client'
import type { Agent, AgentStatus } from '@/api/types'
import { events } from '@/api/events'
import { when } from '@/time'
import { useAgentsStore } from '@/stores/agents'
import { useAttentionStore } from '@/stores/attention'
import { useChatStore } from '@/stores/chat'
import { useHostsStore } from '@/stores/hosts'
import { useNotificationsStore } from '@/stores/notifications'
import { useProjectsStore, type ProjectRow } from '@/stores/projects'
import { addRollups, groupNames, groupRows, matches, rollup } from '@/tree'
import RollupMarks from './RollupMarks.vue'
import StateMark from './StateMark.vue'

/**
 * The tree: every stream and project there is, under the groups they
 * were put in, each with its agents. It is the way around the whole
 * application, on the page where the work is: there is no list of
 * projects elsewhere to go back to. A row that is folded says what in
 * it needs someone, so nothing has to be opened to find out.
 */
const props = defineProps<{ agentId?: string }>()
const emit = defineEmits<{ newAgent: [projectId: string]; newStream: [] }>()
const projects = useProjectsStore()
const agents = useAgentsStore()
const attention = useAttentionStore()
const chat = useChatStore()
const hosts = useHostsStore()
const notifications = useNotificationsStore()

const stored = (key: string): string[] => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]') as string[]
  } catch {
    return []
  }
}
/** Streams unfolded by the person, kept across reloads; the one holding the selected agent is open besides. */
const OPEN_KEY = 'tree-open'
const open = ref(new Set<string>(stored(OPEN_KEY)))
/** Groups are open unless folded: a group is for finding things, and a new one should show what is in it. */
const FOLDED_KEY = 'tree-groups-folded'
const folded = ref(new Set<string>(stored(FOLDED_KEY)))
const remember = () => {
  localStorage.setItem(OPEN_KEY, JSON.stringify([...open.value]))
  localStorage.setItem(FOLDED_KEY, JSON.stringify([...folded.value]))
}

const currentProject = computed(() =>
  props.agentId ? (agents.byId.get(props.agentId)?.agent.projectId ?? null) : null,
)
const isOpen = (id: string) => open.value.has(id)
const groupKey = (name: string | null) => name ?? ''
const isFolded = (name: string | null) => folded.value.has(groupKey(name))

/** A stream on a machine that is down is a toast; one that no longer exists is quietly forgotten. */
async function loadAgents(id: string) {
  try {
    await agents.load(id)
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      open.value.delete(id)
      remember()
      return
    }
    notifications.push(
      'error',
      `could not load the agents: ${e instanceof ApiError ? e.message : String(e)}`,
    )
  }
}
function toggle(id: string) {
  if (open.value.has(id)) open.value.delete(id)
  else {
    open.value.add(id)
    if (!agents.byProject.has(id)) void loadAgents(id)
  }
  remember()
}
function toggleGroup(name: string | null) {
  const key = groupKey(name)
  if (folded.value.has(key)) folded.value.delete(key)
  else folded.value.add(key)
  remember()
}
for (const id of open.value) if (!agents.byProject.has(id)) void loadAgents(id)
// the selected agent is always in sight: its stream open, its group unfolded
watch(
  currentProject,
  (id) => {
    if (!id) return
    if (!open.value.has(id)) open.value.add(id)
    const group = projects.byId.get(id)?.project.group ?? null
    folded.value.delete(groupKey(group))
    remember()
    if (!agents.byProject.has(id)) void loadAgents(id)
  },
  { immediate: true },
)

const rows = computed(() => projects.rows)
// which agents have a question open is part of every row, folded ones included
watch(rows, (list) => list.forEach((r) => chat.ensureProject(r.project.id)), { immediate: true })
const agentsOf = (id: string) => agents.byProject.get(id) ?? []

const query = ref('')
const groups = computed(() =>
  groupRows(
    rows.value.filter((r) =>
      matches(
        query.value,
        r,
        agentsOf(r.project.id).map((a) => a.agent.name),
      ),
    ),
  ),
)
/** With nothing grouped the tree is one list and needs no heading. */
const headed = computed(() => groups.value.some((g) => g.name !== null))
const rollupOf = (r: ProjectRow) => rollup(r.agentCounts, chat.questionsIn(r.project.id))
const groupRollup = (list: ProjectRow[]) => addRollups(list.map(rollupOf))
/** While something is searched for, what matched is shown whatever was folded. */
const showGroup = (name: string | null) => !!query.value.trim() || !isFolded(name)
const showAgents = (id: string) => !!query.value.trim() || isOpen(id)

/**
 * What is done to a stream rather than in it, behind the row's "⋯":
 * which group it is listed under, and its archived agents. Neither
 * deserves a line of the tree while nobody asks.
 */
const grouping = ref<string | null>(null)
const groupDraft = ref('')
const allGroups = computed(() => groupNames(rows.value))
function startGrouping(r: ProjectRow) {
  grouping.value = grouping.value === r.project.id ? null : r.project.id
  groupDraft.value = r.project.group ?? ''
  if (grouping.value) void loadArchived(r.project.id)
}
async function saveGroup(r: ProjectRow) {
  try {
    await projects.update(r.project.id, { group: groupDraft.value.trim() || null })
    grouping.value = null
  } catch (e) {
    notifications.push('error', e instanceof ApiError ? e.message : String(e))
  }
}

/** Archived agents, fetched when a stream's panel is opened. */
type AgentRow = { agent: Agent; status: AgentStatus }
const archived = ref(new Map<string, AgentRow[]>())
async function loadArchived(projectId: string) {
  const list = await api.archivedAgents(projectId).catch(() => [])
  archived.value = new Map(archived.value).set(projectId, list)
}
events.on((f) => {
  if ((f.type === 'agent.archived' || f.type === 'agent.removed') && grouping.value === f.projectId)
    void loadArchived(f.projectId)
})
</script>

<template>
  <nav class="flex min-h-0 grow flex-col" data-test="work-tree">
    <div class="flex shrink-0 items-center gap-1.5 px-2 pt-2 pb-1.5">
      <input
        v-model="query"
        type="search"
        placeholder="find a stream or an agent"
        class="min-w-0 grow rounded border border-slate-300 bg-white px-2 py-1 text-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
        data-test="tree-filter"
      />
      <button
        type="button"
        class="shrink-0 rounded border border-slate-300 px-2 py-1 text-sm text-slate-700 hover:border-blue-500 hover:text-blue-700 dark:border-slate-700 dark:text-slate-200 dark:hover:border-blue-400 dark:hover:text-blue-300"
        title="Start a stream: a unit of work with a folder of its own, that clones the repositories it needs"
        data-test="new-stream"
        @click="emit('newStream')"
      >
        + stream
      </button>
    </div>
    <ul class="min-h-0 grow overflow-y-auto pb-2">
      <li
        v-for="g in groups"
        :key="groupKey(g.name)"
        data-test="tree-group"
        :data-group="g.name ?? ''"
      >
        <button
          v-if="headed"
          type="button"
          class="flex w-full items-center gap-1 px-2 pt-3 pb-1 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
          data-test="group-toggle"
          @click="toggleGroup(g.name)"
        >
          <svg
            class="h-3 w-3 shrink-0 transition-transform duration-100"
            :class="showGroup(g.name) ? 'rotate-90' : ''"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M6 3.5L10.5 8 6 12.5" />
          </svg>
          <span class="truncate">{{ g.name ?? 'not in a group' }}</span>
          <span class="font-normal text-slate-400 dark:text-slate-500">{{ g.rows.length }}</span>
          <span class="grow" />
          <RollupMarks v-if="!showGroup(g.name)" :rollup="groupRollup(g.rows)" />
        </button>
        <ul v-if="showGroup(g.name)">
          <li
            v-for="r in g.rows"
            :key="r.project.id"
            data-test="tree-stream"
            :data-kind="r.project.kind ?? 'project'"
            :data-open="showAgents(r.project.id) || undefined"
          >
            <div
              class="group/row flex items-center gap-1 py-1 pr-2 pl-2 text-[0.95rem] max-md:min-h-[44px] max-md:py-2.5"
              :class="
                r.project.id === currentProject
                  ? 'font-semibold text-slate-900 dark:text-slate-100'
                  : 'text-slate-700 dark:text-slate-300'
              "
            >
              <button
                type="button"
                class="flex min-w-0 grow items-center gap-1.5 text-left"
                :title="
                  (r.project.kind === 'stream'
                    ? 'a stream: its own folder and its own clones of the repositories it works on'
                    : 'a project: a list of repositories') + ` · ${r.project.path}`
                "
                data-test="stream-toggle"
                @click="toggle(r.project.id)"
              >
                <svg
                  class="h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-100 dark:text-slate-500"
                  :class="showAgents(r.project.id) ? 'rotate-90' : ''"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M6 3.5L10.5 8 6 12.5" />
                </svg>
                <!-- which of the two it is: a stream flows, a project is a set of boxes -->
                <svg
                  v-if="r.project.kind === 'stream'"
                  class="h-3.5 w-3.5 shrink-0 text-sky-600 dark:text-sky-400"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  aria-hidden="true"
                  data-test="kind-stream"
                >
                  <path
                    d="M1.5 5.5c2-2 3.5-2 5.5 0s3.5 2 5.5 0 M1.5 10.5c2-2 3.5-2 5.5 0s3.5 2 5.5 0"
                  />
                </svg>
                <svg
                  v-else
                  class="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linejoin="round"
                  aria-hidden="true"
                  data-test="kind-project"
                >
                  <rect x="2.5" y="2.5" width="11" height="4.5" rx="1" />
                  <rect x="2.5" y="9" width="11" height="4.5" rx="1" />
                </svg>
                <span class="truncate">{{ r.project.name }}</span>
                <span
                  v-if="hosts.isRemote(r.project.host)"
                  class="rounded bg-slate-100 px-1 text-[10px] font-normal text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                  >{{ r.project.host }}</span
                >
              </button>
              <RollupMarks v-if="!showAgents(r.project.id)" :rollup="rollupOf(r)" />
              <button
                type="button"
                class="shrink-0 rounded px-1 text-slate-400 opacity-0 group-hover/row:opacity-100 hover:bg-slate-100 hover:text-slate-800 focus:opacity-100 dark:hover:bg-slate-800 dark:hover:text-slate-100 pointer-coarse:opacity-100"
                :class="grouping === r.project.id ? 'opacity-100' : ''"
                title="Its group, and its archived agents"
                data-test="stream-group"
                @click="startGrouping(r)"
              >
                ⋯
              </button>
              <button
                type="button"
                class="shrink-0 rounded px-1 text-slate-400 opacity-0 group-hover/row:opacity-100 hover:bg-slate-100 hover:text-blue-700 focus:opacity-100 dark:hover:bg-slate-800 dark:hover:text-blue-300 pointer-coarse:opacity-100"
                :class="showAgents(r.project.id) ? 'opacity-100' : ''"
                title="New agent here"
                data-test="new-agent"
                @click="emit('newAgent', r.project.id)"
              >
                +
              </button>
            </div>
            <div
              v-if="grouping === r.project.id"
              class="mx-2 mb-1 ml-8 rounded border border-slate-200 px-2 py-1.5 dark:border-slate-700"
              data-test="stream-panel"
            >
              <form
                class="flex items-center gap-1.5"
                data-test="group-form"
                @submit.prevent="saveGroup(r)"
              >
                <label
                  class="shrink-0 text-xs text-slate-500 dark:text-slate-400"
                  :for="`group-${r.project.id}`"
                  >group</label
                >
                <input
                  :id="`group-${r.project.id}`"
                  v-model="groupDraft"
                  :list="`groups-${r.project.id}`"
                  placeholder="none"
                  maxlength="60"
                  class="min-w-0 grow rounded border border-slate-300 bg-white px-2 py-0.5 text-sm dark:border-slate-700 dark:bg-slate-800"
                  data-test="group-input"
                />
                <datalist :id="`groups-${r.project.id}`">
                  <option v-for="n in allGroups" :key="n" :value="n" />
                </datalist>
                <button
                  type="submit"
                  class="shrink-0 rounded bg-blue-600 px-2 py-0.5 text-sm text-white hover:bg-blue-700"
                  data-test="group-save"
                >
                  move
                </button>
              </form>
              <p class="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                archived agents:
                <span v-if="(archived.get(r.project.id) ?? []).length === 0">none</span>
              </p>
              <ul>
                <li
                  v-for="a in archived.get(r.project.id) ?? []"
                  :key="a.agent.id"
                  class="py-0.5 text-sm"
                  data-test="archived-row"
                >
                  <RouterLink
                    :to="{ name: 'agent', params: { agentId: a.agent.id } }"
                    class="text-slate-600 hover:underline dark:text-slate-300"
                    :title="`archived ${a.agent.archivedAt ? when(a.agent.archivedAt) : ''}`"
                    >{{ a.agent.name }}</RouterLink
                  >
                </li>
              </ul>
            </div>
            <ul v-if="showAgents(r.project.id)">
              <li v-for="a in agentsOf(r.project.id)" :key="a.agent.id" data-test="agent-row">
                <RouterLink
                  :to="{ name: 'agent', params: { agentId: a.agent.id } }"
                  class="flex items-center gap-2 py-1 pr-2.5 pl-9 text-[0.95rem] hover:bg-slate-100 max-md:min-h-[44px] max-md:py-2.5 dark:hover:bg-slate-800"
                  :class="[
                    a.agent.id === agentId
                      ? 'bg-blue-50 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                      : a.status.state === 'exited'
                        ? 'text-slate-400 dark:text-slate-500'
                        : 'text-slate-700 dark:text-slate-300',
                    attention.finishedAway.has(a.agent.id) ? 'font-semibold' : '',
                  ]"
                  :aria-current="a.agent.id === agentId ? 'page' : undefined"
                >
                  <span class="truncate">{{ a.agent.name }}</span>
                  <span
                    v-if="attention.finishedAway.has(a.agent.id)"
                    class="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500"
                    title="finished while you were away"
                    data-test="finished-away"
                  />
                  <span class="grow" />
                  <span
                    v-if="chat.questionsOf(a.agent.id)"
                    class="shrink-0 rounded bg-amber-100 px-1.5 py-px text-xs font-medium text-amber-900 dark:bg-amber-900 dark:text-amber-100"
                    :title="`${chat.questionsOf(a.agent.id)} open question(s) in its chat; it carries on meanwhile`"
                    data-test="agent-row-questions"
                    >{{ chat.questionsOf(a.agent.id) }} ?</span
                  >
                  <StateMark
                    :state="a.status.state"
                    :background="a.status.background"
                    :error="a.status.error"
                  />
                </RouterLink>
              </li>
              <li
                v-if="agents.byProject.has(r.project.id) && agentsOf(r.project.id).length === 0"
                class="py-1 pl-9 text-sm text-slate-400 dark:text-slate-500"
              >
                no agents yet
              </li>
            </ul>
          </li>
        </ul>
      </li>
      <li
        v-if="projects.loaded && groups.length === 0"
        class="px-3 py-6 text-center text-sm text-slate-400 dark:text-slate-500"
      >
        {{ query.trim() ? 'nothing by that name' : 'no streams yet' }}
      </li>
    </ul>
  </nav>
</template>
