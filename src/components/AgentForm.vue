<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ApiError, api } from '@/api/client'
import type { Agent, AgentState, Profile } from '@/api/types'
import { hasLongWindow, withLongWindow } from '@/model'
import { useAgentsStore } from '@/stores/agents'
import { useNotificationsStore } from '@/stores/notifications'
import { useProjectsStore } from '@/stores/projects'
import ModalForm from './ModalForm.vue'

/**
 * An agent's settings, the same form for a new one and an existing one:
 * what it is called, which CLI and model run it, whether it asks before
 * it acts, and whether the manager asks it to go on when it stops. For
 * an existing agent the name and the question on stopping apply at once;
 * model, effort and permissions are the session's, and wait for a
 * restart, which the form offers while the agent is idle.
 */
const props = defineProps<{
  /** The stream or project a new agent is made in. */
  projectId: string
  /** The agent being edited; absent for a new one. */
  agent?: Agent
  state?: AgentState
}>()
const emit = defineEmits<{ close: []; done: [agent: Agent] }>()
const agents = useAgentsStore()
const projects = useProjectsStore()
const notifications = useNotificationsStore()

const project = computed(() => projects.byId.get(props.projectId)?.project)
const form = ref({
  name: props.agent?.name ?? '',
  profile: props.agent?.profile ?? project.value?.defaultProfile ?? '',
  model: props.agent?.model ?? '',
  effort: props.agent?.effort ?? '',
  permissions: props.agent?.permissions ?? ('bypass' as 'bypass' | 'ask'),
  nudge: props.agent?.nudge ?? false,
})
const profiles = ref<Profile[]>([])
onMounted(async () => {
  if (props.agent) return
  profiles.value = (
    await api.profiles(project.value?.host).catch(() => ({ profiles: [] as Profile[] }))
  ).profiles.filter((p) => p.supported)
  if (!profiles.value.some((p) => p.name === form.value.profile))
    form.value.profile = profiles.value[0]?.name ?? ''
})
const error = ref<string | null>(null)
const busy = ref(false)

async function save(andRestart = false) {
  error.value = null
  busy.value = true
  try {
    const f = form.value
    if (!props.agent) {
      const made = await agents.create(props.projectId, {
        name: f.name.trim(),
        profile: f.profile || undefined,
        model: f.model.trim() || undefined,
        effort: f.effort || undefined,
        permissions: f.permissions,
      })
      // The question on stopping is not a session setting: set once the
      // agent exists. If that fails the agent is made all the same: the
      // form closes on it, so that a second "create" cannot make another.
      if (f.nudge)
        await api
          .updateAgent(made.id, { nudge: true })
          .catch((e) =>
            notifications.push(
              'error',
              `the agent was made, but not set to be asked to go on: ${e instanceof ApiError ? e.message : String(e)}`,
            ),
          )
      emit('done', made)
      return
    }
    const r = await api.updateAgent(props.agent.id, {
      name: f.name.trim(),
      model: f.model.trim() || null,
      effort: f.effort || null,
      permissions: f.permissions,
      nudge: f.nudge,
    })
    const row = agents.byId.get(props.agent.id)
    if (row) row.agent = r.agent
    if (andRestart) await api.restart(props.agent.id)
    else if (r.appliesAtRestart.length)
      notifications.push('info', `${r.appliesAtRestart.join(', ')} take effect at the next restart`)
    emit('done', r.agent)
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
const LONG_WINDOW_TITLE =
  "Claude's 1M window is asked for by [1m] at the end of the model name; without it the window is the model's default, 200K for some. With no model set, Claude Code's own settings decide. The agent's header shows the window it got."
const field =
  'mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800'
</script>

<template>
  <ModalForm
    :title="agent ? `Edit ${agent.name}` : `New agent in ${project?.name ?? ''}`"
    :error="error"
    :busy="busy"
    :submit-label="agent ? 'save' : 'create'"
    :secondary-label="agent && state === 'idle' ? 'save and restart' : undefined"
    @close="emit('close')"
    @submit="save(false)"
    @secondary="save(true)"
  >
    <label class="text-base">
      <span class="text-slate-600 dark:text-slate-300">Name</span>
      <input v-model="form.name" :class="field" required autofocus data-test="agent-name" />
    </label>
    <label v-if="!agent" class="text-base">
      <span class="text-slate-600 dark:text-slate-300">Profile</span>
      <select v-model="form.profile" :class="field" data-test="agent-profile">
        <option v-for="p in profiles" :key="p.name" :value="p.name">
          {{ p.name }}<template v-if="p.description"> — {{ p.description }}</template>
        </option>
      </select>
    </label>
    <div class="grid grid-cols-2 gap-3">
      <div>
        <label class="text-base">
          <span class="text-slate-600 dark:text-slate-300">Model</span>
          <input
            v-model="form.model"
            :class="[field, 'font-mono text-sm']"
            placeholder="vendor default"
            title="The vendor's model name, passed as is at the next session start."
            data-test="agent-model"
          />
        </label>
        <label
          v-if="(agent?.profile ?? form.profile) === 'claude'"
          class="mt-1.5 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300"
          :title="LONG_WINDOW_TITLE"
        >
          <input
            type="checkbox"
            :checked="hasLongWindow(form.model)"
            :disabled="!form.model.trim()"
            data-test="agent-1m"
            @change="
              form.model = withLongWindow(form.model, ($event.target as HTMLInputElement).checked)
            "
          />
          1M context window
        </label>
      </div>
      <label class="text-base">
        <span class="text-slate-600 dark:text-slate-300">Effort</span>
        <select v-model="form.effort" :class="field" data-test="agent-effort">
          <option value="">vendor default</option>
          <option v-for="e in ['low', 'medium', 'high', 'xhigh', 'max']" :key="e" :value="e">
            {{ e }}
          </option>
        </select>
      </label>
    </div>
    <label class="text-base">
      <span class="text-slate-600 dark:text-slate-300">Permissions</span>
      <select v-model="form.permissions" :class="field" data-test="agent-permissions">
        <option value="bypass">bypass — the agent acts without asking</option>
        <option value="ask">ask — gated tools wait for your answer here</option>
      </select>
    </label>
    <label
      class="flex items-start gap-2 text-base"
      title="For an agent on a long job. When a turn ends, a model reads its last message: if it needs you, you are paged; if it has work left, the manager asks it a few minutes later whether it can go on, needs you, or is done. A question, not an order, and not asked again until it has worked half an hour more."
    >
      <input v-model="form.nudge" type="checkbox" class="mt-1.5" data-test="agent-nudge" />
      <span>
        When it stops, ask it whether it can go on
        <span class="block text-sm text-slate-500 dark:text-slate-400"
          >and page me if it needs me</span
        >
      </span>
    </label>
    <p v-if="agent" class="text-sm text-slate-500 dark:text-slate-400">
      The name and the question on stopping apply at once. Model, effort and permissions are the
      session's: they take effect at the next restart, which "save and restart" does now while the
      agent is idle.
    </p>
  </ModalForm>
</template>
