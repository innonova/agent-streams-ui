<script setup lang="ts">
import { computed } from 'vue'
import type { AgentState } from '@/api/types'

/**
 * An agent's state in the tree. A long tree is read at a glance, so the
 * states that need nobody are a quiet mark (a ring for idle, a dot that
 * beats while it works) and only the ones that need a person are words:
 * a tree of thirty agents with "idle" written thirty times hides the one
 * that waits.
 */
const props = defineProps<{ state: AgentState; background?: number; error?: string | null }>()

const word = computed(() =>
  props.state === 'waiting-input'
    ? 'waiting'
    : props.state === 'waiting-permission'
      ? 'permission'
      : props.state === 'error'
        ? 'error'
        : null,
)
const title = computed(() => {
  const base =
    props.state === 'waiting-input'
      ? 'waiting for an answer'
      : props.state === 'waiting-permission'
        ? 'waiting for a permission to be answered'
        : props.state === 'error'
          ? (props.error ?? 'failed')
          : props.state === 'exited'
            ? 'its session has ended; a message starts it again'
            : props.state
  return props.background ? `${base} · ${props.background} background job(s) pending` : base
})
</script>

<template>
  <span
    class="flex shrink-0 items-center gap-1"
    :title="title"
    :data-state="state"
    :data-background="background || undefined"
  >
    <span v-if="background" class="text-xs text-slate-400 dark:text-slate-500"
      >{{ background }} bg</span
    >
    <span
      v-if="word"
      class="rounded px-1.5 py-px text-xs font-medium"
      :class="
        state === 'error'
          ? 'bg-red-100 text-red-900 dark:bg-red-900 dark:text-red-100'
          : 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100'
      "
      >{{ word }}</span
    >
    <span
      v-else-if="state === 'working'"
      class="h-2 w-2 animate-pulse rounded-full bg-blue-500 dark:bg-blue-400"
    />
    <span
      v-else-if="state === 'starting'"
      class="h-2 w-2 animate-pulse rounded-full border border-slate-400 dark:border-slate-500"
    />
    <span
      v-else-if="state === 'idle'"
      class="h-2 w-2 rounded-full border border-emerald-600/70 dark:border-emerald-400/60"
    />
    <span v-else class="h-2 w-2" />
  </span>
</template>
