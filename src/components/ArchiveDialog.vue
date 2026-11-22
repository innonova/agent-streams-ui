<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ApiError, api } from '@/api/client'
import type { ArchivePlan, Project } from '@/api/types'
import { useProjectsStore } from '@/stores/projects'
import ModalForm from './ModalForm.vue'

/**
 * Putting a stream away: what it will do is shown before it is done.
 * Its clones come off the disk, and nothing that exists only in a clone
 * goes with them, so the dialog says what is pushed first, what is not
 * committed and would be lost (which takes the person's word), which
 * agents are compacted, and what stands in the way. Once it is under
 * way the dialog follows it to the end.
 */
const props = defineProps<{ project: Project }>()
const emit = defineEmits<{ close: []; done: [] }>()
const projects = useProjectsStore()

const plan = ref<ArchivePlan | null>(null)
const error = ref<string | null>(null)
const discard = ref(false)
const compact = ref(true)
const busy = ref(false)
/** Under way: asked for and accepted. */
const going = ref(false)
/** Asked for: from here on what the manager says of this stream is about this attempt, once it says it has begun. */
let asked = false
let begun = false

async function load() {
  plan.value = null
  error.value = null
  try {
    plan.value = (await api.archivePlan(props.project.id)).plan
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : String(e)
  }
}
onMounted(load)

const size = (kb: number) =>
  kb >= 1024 * 1024
    ? `${(kb / 1024 / 1024).toFixed(1)} GB`
    : kb < 512
      ? 'under 1 MB'
      : `${Math.round(kb / 1024)} MB`
const lost = computed(() => plan.value?.uncommitted ?? [])
const blocked = computed(() => plan.value?.blocked ?? [])
const compacted = computed(() => (plan.value?.agents ?? []).filter((a) => a.compact))
const ready = computed(
  () => !!plan.value && blocked.value.length === 0 && (lost.value.length === 0 || discard.value),
)

async function submit() {
  if (!ready.value || busy.value) return
  busy.value = true
  error.value = null
  asked = true
  begun = false
  try {
    await projects.putAway(props.project.id, { discard: discard.value, compact: compact.value })
    going.value = true
    follow()
  } catch (e) {
    asked = false
    error.value = e instanceof ApiError ? e.message : String(e)
    void load() // what stood in the way may have changed
  } finally {
    busy.value = false
  }
}

const moving = computed(() => projects.moving.get(props.project.id))
const progress = computed(() => moving.value?.progress)
/** What the manager last said, read as news of this attempt: what it said of an earlier one is not. */
function follow() {
  const m = moving.value
  if (!asked || !m) return
  if (m.archive?.state === 'archiving') begun = true
  if (m.archive?.state === 'archived' && !m.progress.step) return emit('done')
  if (begun && m.progress.error) {
    asked = false
    going.value = false
    error.value = m.progress.error
    void load()
  }
}
watch(moving, follow)
</script>

<template>
  <ModalForm
    :title="`Put ${project.name} away`"
    :error="error"
    :busy="busy || going"
    :disabled="!ready"
    submit-label="put away"
    data-test="archive-dialog"
    @close="emit('close')"
    @submit="submit"
  >
    <p v-if="going" class="text-base" data-test="archive-progress">
      <span class="animate-pulse">Putting it away…</span>
      <span v-if="progress?.step" class="text-slate-500 dark:text-slate-400">
        {{ progress.step }}</span
      >
    </p>
    <p v-else-if="!plan && !error" class="text-base text-slate-500 dark:text-slate-400">
      Looking at its clones and asking their remotes…
    </p>
    <template v-else-if="plan">
      <p class="text-base">
        Its folder, its agents and everything kept of them stay, and it can be brought back.
        <template v-if="plan.clones.length">
          Its {{ plan.clones.length === 1 ? 'clone comes' : `${plan.clones.length} clones come` }}
          off the disk:
          <span class="font-medium" data-test="archive-reclaim">{{ size(plan.reclaimKb) }}</span
          >.
        </template>
        <template v-else>It has no clones to remove.</template>
      </p>

      <div v-if="blocked.length" data-test="archive-blocked">
        <p class="text-sm font-semibold text-red-700 dark:text-red-300">In the way</p>
        <ul class="list-disc pl-5 text-sm text-red-700 dark:text-red-300">
          <li v-for="b in blocked" :key="b">{{ b }}</li>
        </ul>
      </div>

      <div v-if="plan.pushes.length" data-test="archive-pushes">
        <p class="text-sm font-semibold text-slate-600 dark:text-slate-300">Pushed first</p>
        <ul class="text-sm">
          <li v-for="p in plan.pushes" :key="`${p.clone}/${p.branch}`">
            {{ p.clone }}: <span class="font-mono">{{ p.branch }}</span>
            <span class="text-slate-500 dark:text-slate-400">
              · {{ p.commits }} commit{{ p.commits === 1 ? '' : 's' }} no remote has</span
            >
          </li>
        </ul>
      </div>

      <div v-if="lost.length" data-test="archive-uncommitted">
        <p class="text-sm font-semibold text-amber-700 dark:text-amber-300">
          Not committed: lost with the clones
        </p>
        <ul class="text-sm">
          <li v-for="u in lost" :key="u.clone">
            {{ u.clone }}:
            <template v-if="u.count">
              {{ u.count }} file{{ u.count === 1 ? '' : 's' }}
              <span class="font-mono text-xs text-slate-500 dark:text-slate-400"
                >{{ u.files.slice(0, 12).join(', ') }}{{ u.count > 12 ? ', …' : '' }}</span
              >
            </template>
            <template v-if="u.stashes">
              {{ u.count ? ' and ' : '' }}{{ u.stashes }} stashed change{{
                u.stashes === 1 ? '' : 's'
              }}
            </template>
          </li>
        </ul>
        <label class="mt-1 flex items-center gap-2 text-sm">
          <input v-model="discard" type="checkbox" data-test="archive-discard" />
          let these go
        </label>
      </div>

      <div v-if="plan.agents.length" data-test="archive-agents">
        <p class="text-sm font-semibold text-slate-600 dark:text-slate-300">
          {{ plan.agents.length === 1 ? 'Its agent is' : `Its ${plan.agents.length} agents are` }}
          stopped, and kept
        </p>
        <ul class="text-sm">
          <li v-for="a in plan.agents" :key="a.id" :title="a.why">
            {{ a.name }}
            <span class="text-slate-500 dark:text-slate-400"
              >· {{ a.compact && compact ? 'compacted first' : 'as it is' }}</span
            >
          </li>
        </ul>
        <label
          v-if="compacted.length"
          class="mt-1 flex items-center gap-2 text-sm"
          title="An agent that was active within the hour still has its context in the vendor's cache: compacting it now is cheap, and it comes back with a short context and its dialog word for word."
        >
          <input v-model="compact" type="checkbox" data-test="archive-compact" />
          compact {{ compacted.length === 1 ? compacted[0]!.name : 'those recently active' }} first
          (takes minutes)
        </label>
      </div>

      <p v-if="plan.unreachable.length" class="text-sm text-amber-700 dark:text-amber-300">
        The remote of {{ plan.unreachable.join(', ') }} could not be asked; judged by what the clone
        last knew.
      </p>
    </template>
  </ModalForm>
</template>
