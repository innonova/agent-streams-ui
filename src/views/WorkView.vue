<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ApiError, api } from '@/api/client'
import type { Profile } from '@/api/types'
import AgentPane from '@/components/AgentPane.vue'
import ModalForm from '@/components/ModalForm.vue'
import ResizeHandle from '@/components/ResizeHandle.vue'
import WorkTree from '@/components/WorkTree.vue'
import { useResizable } from '@/composables/useResizable'
import { useAgentsStore } from '@/stores/agents'
import { useAttentionStore } from '@/stores/attention'
import { useNotificationsStore } from '@/stores/notifications'
import { usePreferencesStore } from '@/stores/preferences'
import { useProjectsStore } from '@/stores/projects'
import { useSessionStore } from '@/stores/session'
import { groupNames } from '@/tree'

/**
 * The one screen: the tree of everything there is on the left, the
 * selected agent beside it. There is no page above this one and no bar
 * across the top: what the application is for is on screen, and the few
 * things about the application itself (who is logged in, the theme, the
 * connection) sit under the tree.
 *
 * On a phone the two are pages, the tree first: it is the list one comes
 * back to, and the back button does that.
 */
const props = defineProps<{ agentId?: string }>()
const router = useRouter()
const agents = useAgentsStore()
const projects = useProjectsStore()
const session = useSessionStore()
const preferences = usePreferencesStore()
const notifications = useNotificationsStore()
useAttentionStore() // the title and the favicon count what waits, whatever is on screen

const treePane = useResizable('work-tree', 300, 220, 560)
const wide = window.matchMedia('(min-width: 768px)')
const LAST_KEY = 'last-agent'

onMounted(async () => {
  if (!projects.loaded)
    await projects
      .load()
      .catch((e) => notifications.push('error', e instanceof ApiError ? e.message : String(e)))
  // With room for both, the screen opens on the agent last looked at.
  const last = localStorage.getItem(LAST_KEY)
  if (!props.agentId && last && wide.matches)
    void router.replace({ name: 'agent', params: { agentId: last } })
})

/** The selected agent may not be in any list yet (a deep link, a notification): fetched, and its stream's agents with it. */
const missing = ref(false)
watch(
  () => props.agentId,
  async (id) => {
    missing.value = false
    if (!id) return
    localStorage.setItem(LAST_KEY, id)
    if (agents.byId.has(id)) return
    try {
      const row = await api.agent(id)
      if (props.agentId !== id) return
      if (!agents.byProject.has(row.agent.projectId)) await agents.load(row.agent.projectId)
      if (!agents.byId.has(id)) agents.byId.set(id, row) // an archived one is in no list
    } catch (e) {
      if (props.agentId !== id) return
      if (e instanceof ApiError && e.status === 404) {
        missing.value = true
        localStorage.removeItem(LAST_KEY)
      } else notifications.push('error', e instanceof ApiError ? e.message : String(e))
    }
  },
  { immediate: true },
)
const selected = computed(() => (props.agentId ? agents.byId.get(props.agentId) : undefined))
function leaveAgent() {
  localStorage.removeItem(LAST_KEY)
  void router.replace({ name: 'work' })
}

// ---- the application's own few things, under the tree ------------------------

const THEMES = ['system', 'light', 'dark'] as const
function nextTheme() {
  preferences.setTheme(THEMES[(THEMES.indexOf(preferences.theme) + 1) % THEMES.length]!)
}
async function logout() {
  await session.logout()
  await router.push({ name: 'login' })
}

// ---- a new agent ---------------------------------------------------------------

const newAgentIn = ref<string | null>(null)
const profiles = ref<Profile[]>([])
const agentForm = ref({ name: '', profile: '', model: '' })
const formError = ref<string | null>(null)
const formBusy = ref(false)
async function openNewAgent(projectId: string) {
  const project = projects.byId.get(projectId)?.project
  formError.value = null
  agentForm.value = { name: '', profile: project?.defaultProfile ?? '', model: '' }
  newAgentIn.value = projectId
  profiles.value = (
    await api.profiles(project?.host).catch(() => ({ profiles: [] as Profile[] }))
  ).profiles.filter((p) => p.supported)
  if (!agentForm.value.profile) agentForm.value.profile = profiles.value[0]?.name ?? ''
}
async function createAgent() {
  if (!newAgentIn.value) return
  formBusy.value = true
  formError.value = null
  try {
    const agent = await agents.create(newAgentIn.value, {
      name: agentForm.value.name.trim(),
      profile: agentForm.value.profile || undefined,
      model: agentForm.value.model.trim() || undefined,
    })
    newAgentIn.value = null
    await router.push({ name: 'agent', params: { agentId: agent.id } })
  } catch (e) {
    formError.value = e instanceof ApiError ? e.message : String(e)
  } finally {
    formBusy.value = false
  }
}

// ---- a new stream --------------------------------------------------------------

const newStream = ref(false)
const streamForm = ref({ name: '', purpose: '', group: '' })
function openNewStream() {
  formError.value = null
  streamForm.value = { name: '', purpose: '', group: '' }
  newStream.value = true
}
async function createStream() {
  formBusy.value = true
  formError.value = null
  try {
    const stream = await projects.createStream({
      name: streamForm.value.name.trim(),
      purpose: streamForm.value.purpose.trim() || undefined,
      group: streamForm.value.group.trim() || null,
    })
    newStream.value = false
    // open, so the next thing to do with it (an agent) is in sight
    const open = new Set<string>(JSON.parse(localStorage.getItem('tree-open') ?? '[]') as string[])
    open.add(stream.id)
    localStorage.setItem('tree-open', JSON.stringify([...open]))
    await openNewAgent(stream.id)
  } catch (e) {
    formError.value = e instanceof ApiError ? e.message : String(e)
  } finally {
    formBusy.value = false
  }
}
const field =
  'w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-base dark:border-slate-700 dark:bg-slate-800'
</script>

<template>
  <div
    class="flex h-[var(--app-h,100%)] translate-y-[var(--app-top,0px)] bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100"
    data-test="work"
  >
    <aside
      class="min-h-0 w-full shrink-0 flex-col border-slate-200 bg-white md:flex md:w-[var(--tree-w)] md:border-r dark:border-slate-800 dark:bg-slate-900"
      :class="agentId ? 'hidden' : 'flex'"
      :style="{ '--tree-w': `${treePane.width.value}px` }"
      data-test="tree-pane"
    >
      <WorkTree
        :key="newStream ? 'reopen' : 'tree'"
        :agent-id="agentId"
        @new-agent="openNewAgent"
        @new-stream="openNewStream"
      />
      <footer
        class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-200 px-3 py-1.5 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400"
        data-test="tree-footer"
      >
        <span
          v-if="session.offline"
          class="rounded bg-amber-100 px-1.5 text-amber-900 dark:bg-amber-900 dark:text-amber-100"
          data-test="disconnected"
          >reconnecting…</span
        >
        <span
          v-else-if="!session.daemonConnected"
          class="rounded bg-red-100 px-1.5 text-red-900 dark:bg-red-900 dark:text-red-100"
          data-test="daemon-down"
          >daemon unreachable</span
        >
        <span class="truncate" data-test="user">{{ session.user?.name }}</span>
        <span class="grow" />
        <button
          type="button"
          class="hover:text-slate-900 dark:hover:text-slate-100"
          title="colour theme: as the system, light, dark"
          data-test="theme"
          @click="nextTheme"
        >
          {{ preferences.theme }}
        </button>
        <a
          href="/"
          class="hover:text-slate-900 dark:hover:text-slate-100"
          title="the interface this one is replacing: files, features, changes and settings are still there"
          >current UI</a
        >
        <button
          type="button"
          class="hover:text-slate-900 dark:hover:text-slate-100"
          @click="logout"
        >
          log out
        </button>
      </footer>
    </aside>
    <div class="hidden md:flex">
      <ResizeHandle @start="treePane.start" />
    </div>
    <main class="min-h-0 min-w-0 grow flex-col md:flex" :class="agentId ? 'flex' : 'hidden'">
      <AgentPane
        v-if="agentId && selected"
        :key="agentId"
        :agent-id="agentId"
        @tree="router.push({ name: 'work' })"
        @gone="leaveAgent"
      />
      <div
        v-else
        class="flex grow flex-col items-center justify-center gap-3 px-6 text-center text-base text-slate-400 dark:text-slate-500"
        data-test="empty"
      >
        <template v-if="agentId && missing">
          <p>That agent is no longer there.</p>
          <button
            type="button"
            class="rounded border border-slate-300 px-3 py-1 text-slate-600 dark:border-slate-700 dark:text-slate-300"
            @click="leaveAgent"
          >
            back to the tree
          </button>
        </template>
        <p v-else-if="agentId">…</p>
        <p v-else>Pick an agent in the tree, or start one with the + on a stream.</p>
      </div>
    </main>

    <ModalForm
      v-if="newAgentIn"
      :title="`New agent in ${projects.byId.get(newAgentIn)?.project.name ?? ''}`"
      :error="formError"
      :busy="formBusy"
      @close="newAgentIn = null"
      @submit="createAgent"
    >
      <label class="block text-base">
        <span class="mb-1 block text-slate-600 dark:text-slate-300">Name</span>
        <input
          v-model="agentForm.name"
          required
          autofocus
          :class="field"
          data-test="new-agent-name"
        />
      </label>
      <label class="block text-base">
        <span class="mb-1 block text-slate-600 dark:text-slate-300">Profile</span>
        <select v-model="agentForm.profile" :class="field" data-test="new-agent-profile">
          <option v-for="p in profiles" :key="p.name" :value="p.name">{{ p.name }}</option>
        </select>
      </label>
      <label class="block text-base">
        <span class="mb-1 block text-slate-600 dark:text-slate-300">Model</span>
        <input
          v-model="agentForm.model"
          placeholder="the profile's default"
          :class="field"
          data-test="new-agent-model"
        />
        <span class="mt-1 block text-sm text-slate-500 dark:text-slate-400"
          >For Claude, a name ending in [1m] asks for the 1M context window.</span
        >
      </label>
    </ModalForm>

    <ModalForm
      v-if="newStream"
      title="New stream"
      :error="formError"
      :busy="formBusy"
      submit-label="start"
      @close="newStream = false"
      @submit="createStream"
    >
      <p class="text-sm text-slate-500 dark:text-slate-400">
        A stream is a piece of work that is not tied to a repository. It gets a folder of its own
        for its instructions, features and docs, and clones the repositories it needs as it goes.
      </p>
      <label class="block text-base">
        <span class="mb-1 block text-slate-600 dark:text-slate-300">Name</span>
        <input
          v-model="streamForm.name"
          required
          autofocus
          pattern="[a-z0-9][a-z0-9-]{0,62}"
          :class="field"
          data-test="new-stream-name"
        />
        <span class="mt-1 block text-sm text-slate-500 dark:text-slate-400"
          >Lower-case letters, digits and hyphens. It names the folder and the branches, and cannot
          be changed.</span
        >
      </label>
      <label class="block text-base">
        <span class="mb-1 block text-slate-600 dark:text-slate-300">What it is for</span>
        <textarea
          v-model="streamForm.purpose"
          rows="4"
          :class="field"
          data-test="new-stream-purpose"
        />
        <span class="mt-1 block text-sm text-slate-500 dark:text-slate-400"
          >The first thing its agents read. It can be written later.</span
        >
      </label>
      <label class="block text-base">
        <span class="mb-1 block text-slate-600 dark:text-slate-300">Group</span>
        <input
          v-model="streamForm.group"
          list="new-stream-groups"
          placeholder="none"
          maxlength="60"
          :class="field"
          data-test="new-stream-group"
        />
        <datalist id="new-stream-groups">
          <option v-for="n in groupNames(projects.rows)" :key="n" :value="n" />
        </datalist>
      </label>
    </ModalForm>
  </div>
</template>
