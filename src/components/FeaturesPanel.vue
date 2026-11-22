<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError } from '@/api/client'
import type { Feature, FeatureStatus } from '@/api/types'
import { latest, slugify, STATUS_ORDER } from '@/features'
import { renderMarkdown } from '@/markdown'
import { useDraftsStore } from '@/stores/drafts'
import { useFeaturesStore } from '@/stores/features'
import { useNotificationsStore } from '@/stores/notifications'
import { useProjectsStore } from '@/stores/projects'
import FeatureStatusBadge from './FeatureStatusBadge.vue'
import ModalForm from './ModalForm.vue'

/**
 * The features of the selected agent's stream, beside the agent: a
 * report is read, answered and closed here with the agent that wrote it
 * still in front of you, its flow one glance to the left. The list
 * first, what awaits a person on top; one feature opened takes the
 * pane, and the list is one step back.
 */
const props = defineProps<{ projectId: string }>()
const features = useFeaturesStore()
const projects = useProjectsStore()
const notifications = useNotificationsStore()
const drafts = useDraftsStore()
const route = useRoute()
const router = useRouter()

const project = computed(() => projects.byId.get(props.projectId)?.project)
const list = computed(() => features.byProject.get(props.projectId) ?? [])
const loaded = ref(false)
watch(
  () => props.projectId,
  async (id) => {
    loaded.value = features.byProject.has(id)
    await features.load(id).catch(report)
    loaded.value = true
  },
  { immediate: true },
)
function report(e: unknown) {
  notifications.push('error', e instanceof ApiError ? e.message : String(e))
}
const act = (fn: () => Promise<unknown>) => fn().catch(report)

/** Done features are the past: counted, and shown when asked for. */
const showDone = ref(false)
const groups = computed(() =>
  STATUS_ORDER.map((status) => ({ status, items: list.value.filter((f) => f.status === status) }))
    .filter((g) => g.items.length)
    .filter((g) => g.status !== 'done' || showDone.value),
)
const doneCount = computed(() => list.value.filter((f) => f.status === 'done').length)
/** Where features come from more than one place (a project of several repositories), a row says which. */
const places = computed(() => new Set(list.value.map((f) => f.repo)).size > 1)

/** The one opened is in the address, so a reload or a link comes back to it. */
const openSlug = computed(() =>
  typeof route.query.feature === 'string' ? route.query.feature : null,
)
const opened = computed(() => list.value.find((f) => f.slug === openSlug.value) ?? null)
const show = (slug: string | null) =>
  router.replace({ query: { ...route.query, feature: slug ?? undefined } })

const responseKey = (slug: string) => `feature-response:${props.projectId}/${slug}`
const response = computed({
  get: () => (openSlug.value ? drafts.get(responseKey(openSlug.value)) : ''),
  set: (v: string) => {
    if (openSlug.value) drafts.set(responseKey(openSlug.value), v)
  },
})
async function respond(f: Feature) {
  const text = response.value.trim()
  if (!text) return
  await act(async () => {
    await features.respond(props.projectId, f.slug, text)
    drafts.set(responseKey(f.slug), '')
  })
}
const setStatus = (f: Feature, status: FeatureStatus) =>
  act(() => features.setStatus(props.projectId, f.slug, status))

// ---- a new feature, and editing one ------------------------------------------

const EMPTY = { title: '', slug: '', body: '', priority: 100 }
const formKey = computed(() => `feature-new:${props.projectId}`)
const form = computed({
  get: () => {
    try {
      return { ...EMPTY, ...(JSON.parse(drafts.get(formKey.value) || '{}') as object) }
    } catch {
      return { ...EMPTY }
    }
  },
  set: (v: typeof EMPTY) => drafts.set(formKey.value, JSON.stringify(v)),
})
const patchForm = (patch: Partial<typeof EMPTY>) => (form.value = { ...form.value, ...patch })
const showNew = ref(false)
const showMore = ref(false)
const error = ref<string | null>(null)
const busy = ref(false)
async function create() {
  error.value = null
  busy.value = true
  try {
    const made = await features.create(props.projectId, {
      slug: form.value.slug || slugify(form.value.title),
      title: form.value.title,
      body: form.value.body,
      priority: Number(form.value.priority),
    })
    showNew.value = false
    showMore.value = false
    drafts.set(formKey.value, '')
    await show(made.slug)
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
const editing = ref<Feature | null>(null)
const edit = ref({ title: '', body: '', priority: 100 })
function startEdit(f: Feature) {
  editing.value = f
  edit.value = { title: f.title, body: f.body, priority: f.priority }
  error.value = null
}
async function saveEdit() {
  if (!editing.value) return
  error.value = null
  busy.value = true
  try {
    await features.update(props.projectId, editing.value.slug, {
      title: edit.value.title,
      body: edit.value.body,
      priority: Number(edit.value.priority),
    })
    editing.value = null
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
const where = computed(() =>
  project.value?.kind === 'stream'
    ? "the stream's own folder"
    : (project.value?.repos[0]?.name ?? 'the primary repository'),
)
const field =
  'mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800'
const small = 'rounded border px-2 py-0.5 text-sm'
</script>

<template>
  <div class="flex min-h-0 grow flex-col" data-test="features-panel">
    <!-- one feature, opened: the whole file, and what a person does with a report -->
    <template v-if="opened">
      <div
        class="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-slate-200 px-3 py-1.5 dark:border-slate-800"
      >
        <button
          type="button"
          class="text-sm text-blue-700 hover:underline dark:text-blue-300"
          data-test="feature-back"
          @click="show(null)"
        >
          ‹ features
        </button>
        <span class="grow" />
        <FeatureStatusBadge :status="opened.status" data-test="feature-status" />
        <button
          v-if="opened.status !== 'in-progress'"
          :class="[small, 'border-slate-300 dark:border-slate-700']"
          data-test="feature-edit"
          @click="startEdit(opened)"
        >
          edit
        </button>
        <button
          v-if="['review', 'blocked', 'planned'].includes(opened.status)"
          :class="[small, 'border-emerald-500 text-emerald-800 dark:text-emerald-200']"
          data-test="feature-done"
          @click="setStatus(opened, 'done')"
        >
          done
        </button>
        <button
          v-if="opened.status === 'planned' || opened.status === 'review'"
          :class="[small, 'border-red-400 text-red-800 dark:border-red-700 dark:text-red-200']"
          title="Park it: agents leave blocked features alone until it is reopened"
          data-test="feature-block"
          @click="setStatus(opened, 'blocked')"
        >
          block
        </button>
        <button
          v-if="['done', 'blocked', 'review'].includes(opened.status)"
          :class="[small, 'border-slate-300 dark:border-slate-700']"
          data-test="feature-reopen"
          @click="setStatus(opened, 'planned')"
        >
          reopen
        </button>
      </div>
      <div class="min-h-0 grow overflow-y-auto px-4 py-3" data-test="feature-body">
        <h2 class="text-lg font-semibold">{{ opened.title }}</h2>
        <p class="mb-3 font-mono text-sm text-slate-400">
          {{ opened.slug
          }}<template v-if="opened.status !== 'done'"> · p{{ opened.priority }}</template
          ><template v-if="places"> · {{ opened.repo }}</template
          ><template v-if="opened.dependsOn.length">
            · after {{ opened.dependsOn.join(', ') }}</template
          >
        </p>
        <!-- eslint-disable-next-line vue/no-v-html -- sanitised in renderMarkdown -->
        <div
          class="md-fit prose dark:prose-invert max-w-none"
          v-html="renderMarkdown(opened.body)"
        />
        <div v-if="opened.status !== 'in-progress'" class="mt-5">
          <textarea
            v-model="response"
            rows="3"
            class="w-full rounded border border-slate-300 bg-white px-3 py-2 text-base dark:border-slate-700 dark:bg-slate-800"
            placeholder="Respond to the report… (appended to the file as a dated Response section)"
            data-test="feature-response-input"
          />
          <div class="mt-2 flex items-start gap-2 text-sm">
            <button
              class="shrink-0 rounded bg-blue-600 px-3 py-1 text-white hover:bg-blue-700 disabled:opacity-50"
              :disabled="!response.trim()"
              data-test="feature-respond"
              @click="respond(opened)"
            >
              respond
            </button>
            <span class="text-slate-400"
              >Sets it back to planned; then ask the agent to work on it again, in the flow beside
              this.</span
            >
          </div>
        </div>
      </div>
    </template>

    <!-- the list: what awaits a person first -->
    <template v-else>
      <div class="min-h-0 grow overflow-y-auto px-3 py-2">
        <p
          v-if="loaded && list.length === 0"
          class="px-1 py-2 text-base text-slate-500 dark:text-slate-400"
          data-test="features-empty"
        >
          No features yet. A feature is a unit of work as a file: you write what is wanted, ask an
          agent to work on it in the flow, and read its report here. They are kept in {{ where }}.
        </p>
        <section v-for="g in groups" :key="g.status" class="mb-4" :data-status="g.status">
          <h3
            class="mb-1 px-1 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400"
          >
            {{ g.status === 'review' ? 'for you to read' : g.status }}
            <span class="font-normal text-slate-400 dark:text-slate-500">{{ g.items.length }}</span>
          </h3>
          <ul
            class="divide-y divide-slate-200 rounded border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900"
          >
            <li
              v-for="f in g.items"
              :key="`${f.repo}/${f.slug}`"
              data-test="feature-row"
              :data-slug="f.slug"
            >
              <button
                type="button"
                class="block w-full px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                @click="show(f.slug)"
              >
                <span class="flex items-baseline gap-2">
                  <span class="min-w-0 grow font-medium" data-test="feature-title">{{
                    f.title
                  }}</span>
                  <span
                    v-if="places"
                    class="shrink-0 rounded bg-slate-100 px-1.5 font-mono text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                    data-test="feature-repo"
                    >{{ f.repo }}</span
                  >
                  <span
                    v-if="f.status === 'done'"
                    class="shrink-0 text-xs text-slate-400"
                    :title="new Date(f.mtime).toLocaleString()"
                    >{{ new Date(f.mtime).toLocaleDateString() }}</span
                  >
                </span>
                <span
                  v-if="latest(f)"
                  class="mt-0.5 line-clamp-2 text-sm text-slate-500 dark:text-slate-400"
                  data-test="feature-latest"
                  ><span class="text-slate-400 dark:text-slate-500"
                    >{{ latest(f)!.kind }} {{ latest(f)!.date }} ·</span
                  >
                  {{ latest(f)!.text }}</span
                >
              </button>
            </li>
          </ul>
        </section>
      </div>
      <div
        class="flex shrink-0 items-center gap-3 border-t border-slate-200 px-3 py-1.5 text-sm dark:border-slate-800"
      >
        <button
          v-if="doneCount"
          type="button"
          class="text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
          data-test="features-done-toggle"
          @click="showDone = !showDone"
        >
          {{ showDone ? 'hide' : 'show' }} {{ doneCount }} done
        </button>
        <span class="grow" />
        <button
          class="rounded bg-blue-600 px-3 py-1 text-white hover:bg-blue-700"
          data-test="new-feature"
          @click="showNew = true"
        >
          new feature
        </button>
      </div>
    </template>

    <ModalForm
      v-if="showNew"
      title="New feature"
      :error="error"
      :busy="busy"
      @close="showNew = false"
      @submit="create"
    >
      <label class="text-base">
        <span class="text-slate-600 dark:text-slate-300">Title</span>
        <input
          :value="form.title"
          :class="field"
          required
          data-test="feature-title-input"
          @input="patchForm({ title: ($event.target as HTMLInputElement).value })"
        />
      </label>
      <label class="text-base">
        <span class="text-slate-600 dark:text-slate-300"
          >Description (markdown; this is what the agent is asked to do)</span
        >
        <textarea
          :value="form.body"
          rows="8"
          :class="[field, 'font-mono text-sm']"
          data-test="feature-body-input"
          @input="patchForm({ body: ($event.target as HTMLTextAreaElement).value })"
        />
      </label>
      <p class="text-sm text-slate-500 dark:text-slate-400">
        Saved as <code>features/{{ form.slug || slugify(form.title) || '…' }}.md</code> in
        {{ where }}.
        <button
          type="button"
          class="ml-1 text-blue-700 hover:underline dark:text-blue-300"
          data-test="feature-more"
          @click="showMore = !showMore"
        >
          {{ showMore ? 'fewer options' : 'more options' }}
        </button>
      </p>
      <template v-if="showMore">
        <label class="text-base">
          <span class="text-slate-600 dark:text-slate-300">File name (slug)</span>
          <input
            :value="form.slug"
            :class="[field, 'font-mono']"
            :placeholder="slugify(form.title) || 'derived from the title'"
            data-test="feature-slug-input"
            @input="patchForm({ slug: ($event.target as HTMLInputElement).value })"
          />
        </label>
        <label class="text-base">
          <span class="text-slate-600 dark:text-slate-300">Priority (lower first)</span>
          <input
            :value="form.priority"
            type="number"
            :class="field"
            data-test="feature-priority-input"
            @input="patchForm({ priority: Number(($event.target as HTMLInputElement).value) })"
          />
        </label>
      </template>
    </ModalForm>
    <ModalForm
      v-if="editing"
      title="Edit feature"
      submit-label="save"
      :error="error"
      :busy="busy"
      @close="editing = null"
      @submit="saveEdit"
    >
      <label class="text-base">
        <span class="text-slate-600 dark:text-slate-300">Title</span>
        <input v-model="edit.title" :class="field" required data-test="feature-edit-title" />
      </label>
      <label class="text-base">
        <span class="text-slate-600 dark:text-slate-300"
          >Description (markdown; the whole file below the frontmatter)</span
        >
        <textarea
          v-model="edit.body"
          rows="12"
          :class="[field, 'font-mono text-sm']"
          data-test="feature-edit-body"
        />
      </label>
      <label class="text-base">
        <span class="text-slate-600 dark:text-slate-300">Priority (lower first)</span>
        <input
          v-model="edit.priority"
          type="number"
          :class="field"
          data-test="feature-edit-priority"
        />
      </label>
    </ModalForm>
  </div>
</template>
