<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ApiError } from '@/api/client'
import type { NoteItem } from '@/api/types'
import { useDraftsStore } from '@/stores/drafts'
import { useNotesStore } from '@/stores/notes'
import { useNotificationsStore } from '@/stores/notifications'

/**
 * The notes of the selected agent's stream, beside the agent: small
 * actionable items, written as they come up, often while the agent
 * works on something else. The add box first and always; open items as
 * a checklist; done ones folded away. Nothing here reaches an agent
 * until someone asks it to take care of the notes, which is the point:
 * writing one down disturbs nobody.
 */
const props = defineProps<{ projectId: string }>()
const notes = useNotesStore()
const notifications = useNotificationsStore()
const drafts = useDraftsStore()

const report = (e: unknown) =>
  notifications.push('error', e instanceof ApiError ? e.message : String(e))
watch(
  () => props.projectId,
  (id) => void notes.load(id).catch(report),
  { immediate: true },
)
const all = computed(() => notes.byProject.get(props.projectId)?.items ?? [])
const open = computed(() => all.value.filter((n) => !n.done))
const done = computed(() => all.value.filter((n) => n.done))
const showDone = ref(false)
const draftKey = computed(() => `note-new:${props.projectId}`)
const text = computed({
  get: () => drafts.get(draftKey.value),
  set: (v: string) => drafts.set(draftKey.value, v),
})
const busy = ref(false)
async function add() {
  const t = text.value.trim()
  if (!t || busy.value) return
  busy.value = true
  // The box empties at once: what is typed while this one is on its way
  // is the next note, and must not be wiped when the first is confirmed.
  text.value = ''
  try {
    await notes.add(props.projectId, t)
  } catch (e) {
    report(e)
    text.value = text.value.trim() ? `${t}\n\n${text.value}` : t // refused: back in the box, ahead of anything typed since
  } finally {
    busy.value = false
  }
}
/** Enter is a newline, as in the inputs; the modifier or the button adds. */
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Enter' || e.isComposing || !(e.ctrlKey || e.metaKey)) return
  e.preventDefault()
  void add()
}
/** Ticks or unticks; a tick the manager refuses leaves the box as it was, not as it was clicked. */
const tick = (n: NoteItem, value: boolean, e: Event) =>
  notes.update(props.projectId, n.id, { done: value }).catch((err) => {
    ;(e.target as HTMLInputElement).checked = !value
    report(err)
  })
const remove = (n: NoteItem) => notes.remove(props.projectId, n.id).catch(report)

/** Editing in place: the title and body back into one text, saved on blur or with the modifier. */
const editing = ref<{ id: string; text: string } | null>(null)
function startEdit(n: NoteItem) {
  editing.value = { id: n.id, text: n.body ? `${n.title}\n\n${n.body}` : n.title }
}
async function saveEdit() {
  const e = editing.value
  if (!e) return
  editing.value = null
  const t = e.text.trim()
  if (t) await notes.update(props.projectId, e.id, { text: t }).catch(report)
}
</script>

<template>
  <div class="flex min-h-0 grow flex-col" data-test="notes-panel">
    <div class="flex shrink-0 items-end gap-2 border-b border-slate-200 p-3 dark:border-slate-800">
      <textarea
        v-model="text"
        rows="2"
        class="max-h-40 min-w-0 grow resize-none overflow-y-auto rounded border border-slate-300 bg-white px-3 py-2 text-base focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
        placeholder="A small thing to do, as it comes to you… (the first line is its title)"
        data-test="note-input"
        @keydown="onKey"
      />
      <button
        class="shrink-0 rounded bg-blue-600 px-3 py-2 text-base text-white hover:bg-blue-700 disabled:opacity-50"
        :disabled="busy || !text.trim()"
        data-test="note-add"
        @click="add"
      >
        add
      </button>
    </div>
    <div class="min-h-0 grow overflow-y-auto px-3 py-2">
      <p
        v-if="all.length === 0"
        class="px-1 py-2 text-base text-slate-500 dark:text-slate-400"
        data-test="notes-empty"
      >
        Small actionable items, never features. Kept by the manager and not in a repository, so
        adding one while an agent works touches nothing it commits. Tell the agent to take care of
        the notes when there are enough; it ticks them off as it goes.
      </p>
      <ul class="divide-y divide-slate-100 dark:divide-slate-800" data-test="notes-open">
        <li
          v-for="n in open"
          :key="n.id"
          class="group/note flex items-start gap-2 py-2"
          data-test="note"
          :data-id="n.id"
        >
          <input
            type="checkbox"
            class="mt-1 h-4 w-4 shrink-0"
            :checked="false"
            data-test="note-tick"
            @change="tick(n, true, $event)"
          />
          <div v-if="editing?.id === n.id" class="min-w-0 grow">
            <textarea
              v-model="editing.text"
              rows="3"
              class="w-full rounded border border-blue-500 bg-white px-2 py-1 text-base dark:bg-slate-800"
              data-test="note-edit-input"
              @blur="saveEdit"
              @keydown.ctrl.enter.prevent="saveEdit"
              @keydown.meta.enter.prevent="saveEdit"
              @keydown.escape="editing = null"
            />
          </div>
          <div v-else class="min-w-0 grow" @dblclick="startEdit(n)">
            <p class="text-base">{{ n.title }}</p>
            <p v-if="n.body" class="text-sm whitespace-pre-wrap text-slate-500 dark:text-slate-400">
              {{ n.body }}
            </p>
          </div>
          <span class="shrink-0 font-mono text-xs text-slate-400" :title="n.date">{{ n.id }}</span>
          <button
            type="button"
            class="shrink-0 text-sm text-slate-400 opacity-0 group-hover/note:opacity-100 hover:text-slate-800 dark:hover:text-slate-100 pointer-coarse:opacity-100"
            title="edit"
            data-test="note-edit"
            @click="startEdit(n)"
          >
            edit
          </button>
          <button
            type="button"
            class="shrink-0 text-slate-400 opacity-0 group-hover/note:opacity-100 hover:text-red-700 pointer-coarse:opacity-100"
            title="remove"
            data-test="note-remove"
            @click="remove(n)"
          >
            ×
          </button>
        </li>
      </ul>
      <button
        v-if="done.length"
        type="button"
        class="mt-3 text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
        data-test="notes-done-toggle"
        @click="showDone = !showDone"
      >
        {{ showDone ? '▾' : '▸' }} {{ done.length }} done
      </button>
      <ul v-if="showDone" class="mt-1" data-test="notes-done">
        <li
          v-for="n in done"
          :key="n.id"
          class="flex items-start gap-2 py-1 text-slate-400 dark:text-slate-500"
          data-test="note-done"
        >
          <input
            type="checkbox"
            class="mt-1 h-4 w-4 shrink-0"
            :checked="true"
            @change="tick(n, false, $event)"
          />
          <span class="min-w-0 grow text-base line-through">{{ n.title }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>
