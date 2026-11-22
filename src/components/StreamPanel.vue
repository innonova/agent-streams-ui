<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { ApiError, api } from '@/api/client'
import type { Clone, Repository } from '@/api/types'
import { renderMarkdown } from '@/markdown'
import { useNotificationsStore } from '@/stores/notifications'
import { useProjectsStore } from '@/stores/projects'

/**
 * The stream the selected agent belongs to, beside the agent: what it
 * is for, in the words its agents read first, and what it has cloned.
 * For a project of the older kind, its repositories. This is where a
 * stream's purpose is written and corrected, and where a repository is
 * brought in without asking an agent to.
 */
const props = defineProps<{ projectId: string }>()
const projects = useProjectsStore()
const notifications = useNotificationsStore()
const project = computed(() => projects.byId.get(props.projectId)?.project)
const isStream = computed(() => project.value?.kind === 'stream')
const report = (e: unknown) =>
  notifications.push('error', e instanceof ApiError ? e.message : String(e))

// ---- what it is for: the stream's instruction file --------------------------

const FILE = 'stream/AGENTS.md'
const text = ref<string | null>(null)
const editing = ref<string | null>(null)
const saving = ref(false)
async function loadText() {
  text.value = null
  if (!isStream.value) return
  try {
    const f = await api.file(props.projectId, FILE)
    text.value = f.binary ? '' : f.content
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) report(e)
    text.value = ''
  }
}
async function save() {
  if (editing.value === null) return
  saving.value = true
  try {
    await api.upload(
      props.projectId,
      FILE,
      new File([editing.value], 'AGENTS.md', { type: 'text/markdown' }),
      true,
    )
    text.value = editing.value
    editing.value = null
  } catch (e) {
    report(e)
  } finally {
    saving.value = false
  }
}

// ---- what it has cloned --------------------------------------------------------

const clones = ref<Clone[]>([])
const registry = ref<Repository[]>([])
const pick = ref('')
let timer: ReturnType<typeof setTimeout> | undefined
async function loadClones() {
  clearTimeout(timer)
  if (!isStream.value) return
  try {
    clones.value = (await api.clones(props.projectId)).clones
  } catch (e) {
    report(e)
    return
  }
  // one being made is watched until it is there or has failed
  if (clones.value.some((c) => c.state === 'cloning' || c.state === 'setting up'))
    timer = setTimeout(() => void loadClones(), 1000)
}
onUnmounted(() => clearTimeout(timer))
const available = computed(() =>
  registry.value.filter((r) => !clones.value.some((c) => c.name === r.name)),
)
async function use() {
  if (!pick.value) return
  try {
    await api.useRepository(props.projectId, pick.value)
    pick.value = ''
    await loadClones()
  } catch (e) {
    report(e)
  }
}
watch(
  () => [props.projectId, isStream.value] as const,
  () => {
    editing.value = null
    void loadText()
    void loadClones()
    if (isStream.value)
      api
        .repositories()
        .then((r) => (registry.value = r.repositories))
        .catch(report)
  },
  { immediate: true },
)
const heading =
  'mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400'
</script>

<template>
  <div v-if="project" class="min-h-0 grow overflow-y-auto px-4 py-3" data-test="stream-panel">
    <p class="mb-3 text-sm text-slate-500 dark:text-slate-400">
      <template v-if="isStream"
        >A stream: work with a folder of its own, that clones the repositories it needs. Its agents
        start in <code class="font-mono">{{ project.path }}</code
        >.</template
      >
      <template v-else
        >A project: a list of repositories on this machine. Its agents start in the first.</template
      >
    </p>

    <template v-if="isStream">
      <div class="flex items-baseline gap-2">
        <h3 :class="heading">What it is for</h3>
        <span class="grow" />
        <button
          v-if="editing === null && text !== null"
          type="button"
          class="text-sm text-blue-700 hover:underline dark:text-blue-300"
          data-test="stream-edit"
          @click="editing = text"
        >
          edit
        </button>
      </div>
      <div v-if="editing !== null" class="mb-4">
        <textarea
          v-model="editing"
          rows="14"
          class="w-full rounded border border-slate-300 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-800"
          data-test="stream-text"
        />
        <div class="mt-1.5 flex items-center gap-2 text-sm">
          <button
            class="rounded bg-blue-600 px-3 py-1 text-white hover:bg-blue-700 disabled:opacity-50"
            :disabled="saving"
            data-test="stream-save"
            @click="save"
          >
            save
          </button>
          <button
            type="button"
            class="rounded px-2 py-1 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            @click="editing = null"
          >
            cancel
          </button>
          <span class="text-slate-400"
            >The stream's <code>AGENTS.md</code>: its agents read it when a session starts.</span
          >
        </div>
      </div>
      <!-- eslint-disable vue/no-v-html -- sanitised in renderMarkdown -->
      <div
        v-else-if="text"
        class="md-fit prose prose-sm dark:prose-invert mb-4 max-w-none rounded border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900"
        data-test="stream-purpose"
        v-html="renderMarkdown(text)"
      />
      <!-- eslint-enable vue/no-v-html -->
      <p v-else-if="text === ''" class="mb-4 text-sm text-slate-400">Nothing written yet.</p>

      <h3 :class="heading">
        Clones
        <span class="font-normal text-slate-400 dark:text-slate-500">{{ clones.length }}</span>
      </h3>
      <ul
        v-if="clones.length"
        class="mb-2 divide-y divide-slate-200 rounded border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900"
      >
        <li
          v-for="c in clones"
          :key="c.name"
          class="px-3 py-1.5"
          data-test="clone"
          :data-name="c.name"
        >
          <div class="flex items-baseline gap-2">
            <span class="font-medium">{{ c.name }}</span>
            <span
              v-if="c.state === 'ready'"
              class="font-mono text-sm text-slate-500 dark:text-slate-400"
              title="the branch it is on"
              data-test="clone-branch"
              >{{ c.branch ?? '?' }}</span
            >
            <span
              v-else
              class="rounded px-1.5 text-xs"
              :class="
                c.state === 'failed'
                  ? 'bg-red-100 text-red-900 dark:bg-red-900 dark:text-red-100'
                  : 'animate-pulse bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-100'
              "
              data-test="clone-state"
              >{{ c.state }}</span
            >
          </div>
          <p class="truncate font-mono text-xs text-slate-400" :title="c.path">{{ c.path }}</p>
          <pre
            v-if="c.message"
            class="mt-1 max-h-40 overflow-auto rounded bg-slate-100 p-2 text-xs whitespace-pre-wrap text-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >{{ c.message }}</pre>
        </li>
      </ul>
      <p v-else class="mb-2 text-sm text-slate-400">
        None yet. Its agents bring in what they need, or pick one here.
      </p>
      <form v-if="available.length" class="flex items-center gap-2" @submit.prevent="use">
        <select
          v-model="pick"
          class="min-w-0 grow rounded border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800"
          data-test="clone-pick"
        >
          <option value="">a repository from the registry…</option>
          <option v-for="r in available" :key="r.name" :value="r.name">{{ r.name }}</option>
        </select>
        <button
          class="shrink-0 rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          :disabled="!pick"
          data-test="clone-use"
        >
          clone
        </button>
      </form>
    </template>

    <template v-else>
      <h3 :class="heading">Repositories</h3>
      <ul
        class="divide-y divide-slate-200 rounded border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900"
      >
        <li v-for="r in project.repos" :key="r.path" class="px-3 py-1.5" data-test="repo">
          <span class="font-medium">{{ r.name }}</span>
          <p class="truncate font-mono text-xs text-slate-400" :title="r.path">{{ r.path }}</p>
        </li>
      </ul>
    </template>
  </div>
</template>
