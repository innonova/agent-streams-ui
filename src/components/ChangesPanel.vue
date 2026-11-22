<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from 'vue'
import ResizeHandle from '@/components/ResizeHandle.vue'
import { useResizable } from '@/composables/useResizable'
import { useRoute, useRouter } from 'vue-router'
import { useChangesStore } from '@/stores/changes'
import { useProjectsStore } from '@/stores/projects'
import { useFeaturesStore } from '@/stores/features'
import type { Commit } from '@/api/types'
import { when } from '@/time'

const DiffViewer = defineAsyncComponent(() => import('@/components/DiffViewer.vue'))

/**
 * What changed in the selected agent's stream, beside the agent: the
 * commits in its clones (a project's repositories), newest first, with
 * who made each and for which feature; a commit's files; a file's diff.
 * Carried over from agent-manager-ui's changes page. What is different
 * here is the grounding: the list opens on what the selected agent
 * committed, with everyone's one click away, and a commit's "who" leads
 * to that moment in the flow beside this.
 */
const props = defineProps<{ projectId: string; agentId: string }>()
const listPane = useResizable('changes-list', 320)
const filesPane = useResizable('changes-files', 256)
const route = useRoute()
const router = useRouter()
const changes = useChangesStore()
const projects = useProjectsStore()
const features = useFeaturesStore()
const inline = ref(false)

const repos = computed(() =>
  (projects.byId.get(props.projectId)?.project.repos ?? []).filter((r) => !r.folder),
)
const featureList = computed(() => features.byProject.get(props.projectId) ?? [])

const STATUS_LETTER: Record<string, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
}
const STATUS_CLASS: Record<string, string> = {
  modified: 'text-[#895503] dark:text-[#e2c08d]',
  added: 'text-[#587c0c] dark:text-[#81b88b]',
  deleted: 'text-[#ad0707] dark:text-[#c74e39]',
  renamed: 'text-[#895503] dark:text-[#e2c08d]',
  untracked: 'text-[#007100] dark:text-[#73c991]',
}

/** The commit list, newest first; the "you last looked here" divider goes before the first read commit. */
const dividerAt = computed(() => {
  const i = changes.commits.findIndex((c) => !c.unread)
  return i === -1 ? changes.commits.length : i
})

// Whose commits: the selected agent's, or everyone's in the stream. The
// agent's is what one is here for; the choice is remembered.
const WHOSE_KEY = 'changes-whose'
const whose = ref<'agent' | 'all'>(localStorage.getItem(WHOSE_KEY) === 'all' ? 'all' : 'agent')
function setWhose(w: 'agent' | 'all') {
  whose.value = w
  localStorage.setItem(WHOSE_KEY, w)
  applyFilters()
}
const featureFilter = ref<string | null>(null)
const repoFilter = ref<string | null>(null)
function applyFilters() {
  changes.setFilters({
    repo: repoFilter.value,
    feature: featureFilter.value,
    agent: whose.value === 'agent' ? props.agentId : null,
  })
}
function setFilter(kind: 'repo' | 'feature', value: string | null) {
  if (kind === 'repo') repoFilter.value = value
  else featureFilter.value = value
  applyFilters()
}

onMounted(async () => {
  if (!features.byProject.has(props.projectId))
    void features.load(props.projectId).catch(() => undefined)
  changes.active = true
  await changes.select(props.projectId)
  applyFilters()
})
// another agent is selected under this panel: its stream's changes, and its own commits
watch(
  () => [props.projectId, props.agentId] as const,
  async ([id], [was]) => {
    if (!features.byProject.has(id)) void features.load(id).catch(() => undefined)
    if (id !== was) {
      featureFilter.value = null
      repoFilter.value = null
      await changes.select(id)
    }
    applyFilters()
  },
)

// The marker moves to HEAD when the reader puts the panel away, not when
// they open it, so "you last looked here" means the last time they had it
// open. A tab closed on it has not looked away, so nothing fires there.
onUnmounted(() => {
  void changes.moveMarker()
  changes.active = false
})

// keyboard: up and down move through the commit list
const commitIndex = computed(() => {
  const s = changes.selection
  if (s?.kind !== 'commit') return -1
  return changes.commits.findIndex((c) => c.hash === s.hash)
})
function openCommit(repo: string, hash: string, subject: string) {
  void changes.openCommit(repo, hash, subject)
}
/** Go to the moment a turn made the commit: in the flow beside this when it was this agent's, at the other agent otherwise. */
function goToTurn(c: Commit) {
  if (!c.agentId || c.item == null) return
  if (c.agentId === props.agentId)
    void router.replace({ query: { ...route.query, item: String(c.item) } })
  else
    void router.push({
      name: 'agent',
      params: { agentId: c.agentId },
      query: { item: String(c.item) },
    })
}
function onListKey(e: KeyboardEvent) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  const n = changes.commits.length
  if (!n) return
  const cur = commitIndex.value
  const next = e.key === 'ArrowDown' ? Math.min(n - 1, cur + 1) : Math.max(0, cur < 0 ? 0 : cur - 1)
  const c = changes.commits[next]
  if (c) openCommit(c.repo, c.hash, c.subject)
  e.preventDefault()
}

const selectedFileTitle = computed(() => {
  const s = changes.selection
  if (!s) return ''
  return s.kind === 'commit'
    ? `${s.repo} · ${s.hash.slice(0, 8)} — ${s.label}`
    : `${s.repo} · working tree`
})
</script>

<template>
  <!-- as wide as the pane it is in: the list, a commit's files and the diff stacked when that is narrow, side by side with room -->
  <div class="@container flex min-h-0 grow flex-col" data-test="changes-panel">
    <div class="flex min-h-0 grow flex-col @4xl:flex-row">
      <!-- filters, working tree, the commit list -->
      <aside
        :style="{ '--pane-w': `${listPane.width.value}px` }"
        class="flex max-h-[38%] min-w-0 shrink-0 flex-col border-b border-slate-200 bg-white pt-2 @4xl:max-h-none @4xl:w-[var(--pane-w)] @4xl:border-r @4xl:border-b-0 dark:border-slate-800 dark:bg-slate-900"
      >
        <div class="flex flex-wrap items-center gap-1.5 px-3 pb-2 text-sm">
          <div
            class="flex overflow-hidden rounded border border-slate-300 dark:border-slate-700"
            role="group"
            aria-label="whose commits"
            data-test="changes-whose"
          >
            <button
              v-for="w in ['agent', 'all'] as const"
              :key="w"
              type="button"
              class="px-2 py-0.5 not-first:border-l not-first:border-slate-300 dark:not-first:border-slate-700"
              :class="
                whose === w
                  ? 'bg-slate-200 font-medium dark:bg-slate-700'
                  : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
              "
              :aria-pressed="whose === w"
              :data-test="`changes-${w}`"
              @click="setWhose(w)"
            >
              {{ w === 'agent' ? "this agent's" : "everyone's" }}
            </button>
          </div>
          <select
            v-if="repos.length > 1"
            class="rounded border border-slate-300 bg-white px-1 py-0.5 dark:border-slate-700 dark:bg-slate-900"
            data-test="filter-repo"
            :value="repoFilter ?? ''"
            @change="setFilter('repo', ($event.target as HTMLSelectElement).value || null)"
          >
            <option value="">all repos</option>
            <option v-for="r in repos" :key="r.name" :value="r.name">{{ r.name }}</option>
          </select>
          <select
            class="min-w-0 grow rounded border border-slate-300 bg-white px-1 py-0.5 dark:border-slate-700 dark:bg-slate-900"
            data-test="filter-feature"
            :value="featureFilter ?? ''"
            @change="setFilter('feature', ($event.target as HTMLSelectElement).value || null)"
          >
            <option value="">all features</option>
            <option v-for="f in featureList" :key="f.slug" :value="f.slug">{{ f.title }}</option>
          </select>
          <button
            class="text-blue-700 hover:underline dark:text-blue-300"
            title="read the commits again"
            data-test="commits-refresh"
            @click="changes.loadCommits()"
          >
            refresh
          </button>
        </div>
        <div
          class="min-h-0 grow overflow-auto pb-4 outline-none"
          tabindex="0"
          data-test="commits-list"
          @keydown="onListKey"
        >
          <!-- uncommitted work, above the commits -->
          <button
            v-for="w in changes.working"
            :key="`w-${w.repo}`"
            class="flex w-full items-center gap-2 px-3 py-1 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
            :class="
              changes.selection?.kind === 'working' && changes.selection.repo === w.repo
                ? 'bg-slate-200 dark:bg-slate-700'
                : ''
            "
            data-test="working-row"
            @click="changes.openWorking(w.repo, w.head)"
          >
            <span class="truncate text-slate-600 italic dark:text-slate-300"
              >working tree<span v-if="repos.length > 1" class="font-mono not-italic">
                · {{ w.repo }}</span
              ><span v-if="w.agent"> · {{ w.agent }}</span> · in progress</span
            >
            <span class="grow" />
            <span class="shrink-0 text-xs text-slate-400">{{ w.files }}</span>
          </button>

          <template v-for="(c, i) in changes.commits" :key="c.hash">
            <div
              v-if="i === dividerAt"
              class="flex items-center gap-2 px-3 py-1 text-xs text-blue-700 dark:text-blue-300"
              data-test="last-looked"
            >
              <span class="h-px grow bg-blue-300 dark:bg-blue-700" />you last looked here<span
                class="h-px grow bg-blue-300 dark:bg-blue-700"
              />
            </div>
            <button
              class="flex w-full flex-col gap-0.5 border-l-2 px-3 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
              :class="
                changes.selection?.kind === 'commit' && changes.selection.hash === c.hash
                  ? 'border-blue-500 bg-slate-200 dark:bg-slate-700'
                  : 'border-transparent'
              "
              data-test="commit-row"
              :data-hash="c.hash"
              @click="openCommit(c.repo, c.hash, c.subject)"
            >
              <span class="flex items-center gap-2 text-sm">
                <span class="truncate">{{ c.subject }}</span>
                <span class="grow" />
                <span class="shrink-0 font-mono text-xs text-slate-400">{{ c.shortHash }}</span>
              </span>
              <span class="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <span v-if="repos.length > 1" class="font-mono">{{ c.repo }}</span>
                <!-- a turn made it: the agent name links to that moment in its transcript -->
                <span
                  v-if="c.sessionId && c.item != null"
                  role="link"
                  tabindex="0"
                  class="cursor-pointer text-blue-700 hover:underline dark:text-blue-300"
                  data-test="commit-agent-link"
                  :title="`go to ${c.agent}'s transcript at this commit`"
                  @click.stop="goToTurn(c)"
                  @keydown.enter.stop.prevent="goToTurn(c)"
                  >{{ c.agent }}</span
                >
                <span v-else :class="c.agent ? 'text-slate-600 dark:text-slate-300' : ''">{{
                  c.agent ?? c.author
                }}</span>
                <span>·</span>
                <span>{{ when(c.at) }}</span>
                <span
                  v-if="c.feature"
                  class="rounded bg-violet-100 px-1 text-violet-900 dark:bg-violet-900 dark:text-violet-100"
                  data-test="commit-feature"
                  >{{ c.feature }}</span
                >
              </span>
            </button>
          </template>
          <div
            v-if="dividerAt === changes.commits.length && changes.commits.length"
            class="flex items-center gap-2 px-3 py-1 text-xs text-blue-700 dark:text-blue-300"
            data-test="last-looked"
          >
            <span class="h-px grow bg-blue-300 dark:bg-blue-700" />you last looked here<span
              class="h-px grow bg-blue-300 dark:bg-blue-700"
            />
          </div>
          <p
            v-if="!changes.loading && !changes.commits.length"
            class="px-3 py-2 text-sm text-slate-400 dark:text-slate-500"
            data-test="commits-empty"
          >
            {{
              whose === 'agent'
                ? 'No commits by this agent that the manager saw it make.'
                : 'No commits.'
            }}
          </p>
        </div>
        <p
          v-if="changes.error"
          class="px-3 py-2 text-sm text-red-700 dark:text-red-300"
          data-test="commits-error"
        >
          {{ changes.error }}
        </p>
      </aside>
      <div class="hidden @4xl:contents"><ResizeHandle @start="listPane.start" /></div>

      <!-- middle: the selected commit's (or working tree's) files; its handle goes with it -->
      <template v-if="changes.selection">
        <aside
          :style="{ '--pane-w': `${filesPane.width.value}px` }"
          class="flex max-h-[22%] min-w-0 shrink-0 flex-col border-b border-slate-200 bg-white @4xl:max-h-none @4xl:w-[var(--pane-w)] @4xl:border-r @4xl:border-b-0 dark:border-slate-800 dark:bg-slate-900"
        >
          <div
            class="truncate px-3 py-2 text-sm text-slate-500 dark:text-slate-400"
            data-test="commit-meta"
          >
            {{ selectedFileTitle }}
          </div>
          <div class="min-h-0 grow overflow-auto pb-4">
            <button
              v-for="f in changes.selFiles"
              :key="f.path"
              class="flex w-full items-center gap-2 truncate px-3 py-0.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
              :class="
                changes.openPath === f.path ? 'bg-slate-200 font-medium dark:bg-slate-700' : ''
              "
              :title="f.oldPath ? `${f.oldPath} → ${f.path}` : f.path"
              data-test="commit-file"
              :data-path="f.path"
              :data-status="f.status"
              @click="changes.openFile(f.path)"
            >
              <span class="truncate" :class="STATUS_CLASS[f.status]">{{ f.path }}</span>
              <span class="grow" />
              <span class="shrink-0 text-xs" :class="STATUS_CLASS[f.status]">{{
                STATUS_LETTER[f.status]
              }}</span>
            </button>
            <p
              v-if="!changes.selFiles.length"
              class="px-3 py-2 text-sm text-slate-400 dark:text-slate-500"
            >
              No files.
            </p>
          </div>
        </aside>
        <div class="hidden @4xl:contents"><ResizeHandle @start="filesPane.start" /></div>
      </template>

      <!-- right: the diff; min-h-0 so the column shrinks with the window when stacked
           under the lists, or the diff's pixel height gives the page a scrollbar -->
      <section class="flex min-h-0 min-w-0 grow flex-col">
        <div
          class="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2 text-base dark:border-slate-800 dark:bg-slate-900"
        >
          <span class="truncate font-mono text-sm" data-test="diff-path">{{
            changes.openPath ?? 'select a commit, then a file'
          }}</span>
          <span class="grow" />
          <label v-if="changes.open" class="flex items-center gap-1 text-sm text-slate-500">
            <input v-model="inline" type="checkbox" /> inline
          </label>
        </div>
        <div class="min-h-0 grow bg-white dark:bg-slate-950">
          <p v-if="!changes.open" class="p-6 text-base text-slate-400">
            Commits, newest first, with who made each and for which feature. Select one to see its
            files, then a file for its diff. The list refreshes when an agent finishes a turn.
          </p>
          <p
            v-else-if="changes.open.binary || changes.open.truncated"
            class="p-6 text-base text-slate-400"
            data-test="diff-unavailable"
          >
            {{ changes.open.binary ? 'Binary file.' : 'Too large to show.' }}
          </p>
          <DiffViewer
            v-else
            :path="changes.open.path"
            :before="changes.open.before ?? ''"
            :after="changes.open.after ?? ''"
            :inline="inline"
          />
        </div>
      </section>
    </div>
  </div>
</template>
