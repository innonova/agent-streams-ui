<script setup lang="ts">
import type { Rollup } from '@/tree'

/** What a folded group or stream holds that is worth knowing without opening it. */
defineProps<{ rollup: Rollup }>()
</script>

<template>
  <span class="flex shrink-0 items-center gap-1.5 text-xs" data-test="rollup">
    <span
      v-if="rollup.waiting"
      class="rounded bg-amber-100 px-1.5 py-px font-medium text-amber-900 dark:bg-amber-900 dark:text-amber-100"
      :title="`${rollup.waiting} waiting for a person (an answer, a permission, or a question open in a chat)`"
      data-test="rollup-waiting"
      >{{ rollup.waiting }}</span
    >
    <span
      v-if="rollup.failed"
      class="rounded bg-red-100 px-1.5 py-px font-medium text-red-900 dark:bg-red-900 dark:text-red-100"
      :title="`${rollup.failed} failed`"
      data-test="rollup-failed"
      >{{ rollup.failed }}</span
    >
    <span
      v-if="rollup.working"
      class="flex items-center gap-1 text-slate-500 dark:text-slate-400"
      :title="`${rollup.working} at work`"
      data-test="rollup-working"
      ><span class="h-2 w-2 animate-pulse rounded-full bg-blue-500 dark:bg-blue-400" />{{
        rollup.working
      }}</span
    >
  </span>
</template>
