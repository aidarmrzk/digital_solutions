<script setup lang="ts">
import { onMounted, ref } from "vue"
import LeftPanel from "./components/LeftPanel.vue"
import RightPanel from "./components/RightPanel.vue"
import { useApiClient, type StateMeta } from "./composables/useApiClient"

const { getState } = useApiClient()

const refreshKey = ref<number>(0)
const summary = ref<StateMeta>({
  selectedCount: 0,
  totalCount: 0,
})
const summaryError = ref<string>("")

const refreshSummary = async (): Promise<void> => {
  summaryError.value = ""
  try {
    const response = await getState()
    summary.value = response.data
  } catch (error) {
    summaryError.value =
      error instanceof Error ? error.message : "Failed to fetch state"
  }
}

const notifyChanged = async (): Promise<void> => {
  refreshKey.value += 1
  await refreshSummary()
}

onMounted(async () => {
  await refreshSummary()
})
</script>

<template>
  <main class="min-h-screen bg-stone-100 text-stone-900">
    <div class="mx-auto w-full max-w-6xl px-4 py-4 pb-8">
      <header
        class="rounded-[22px] border border-stone-300 bg-amber-50 px-6 py-5 shadow-lg"
      >
        <p class="m-0 text-xs uppercase tracking-[0.12em] text-amber-800">
          Fullstack Test Task
        </p>
        <h1
          class="m-0 mt-2 mb-4 text-3xl leading-tight font-semibold sm:text-4xl"
        >
          1,000,000 IDs with Server-Side State
        </h1>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div
            class="grid gap-1 rounded-2xl border border-stone-300 bg-white/70 p-3"
          >
            <span class="text-sm text-stone-600">Total Items</span>
            <strong class="text-xl">{{ summary.totalCount }}</strong>
          </div>
          <div
            class="grid gap-1 rounded-2xl border border-stone-300 bg-white/70 p-3"
          >
            <span class="text-sm text-stone-600">Selected</span>
            <strong class="text-xl">{{ summary.selectedCount }}</strong>
          </div>
        </div>
        <p v-if="summaryError" class="mt-3 text-sm text-red-700">
          {{ summaryError }}
        </p>
      </header>

      <section class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LeftPanel :refresh-key="refreshKey" @changed="notifyChanged" />
        <RightPanel :refresh-key="refreshKey" @changed="notifyChanged" />
      </section>
    </div>
  </main>
</template>
