<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue"
import { usePaginatedFilterList } from "../composables/usePaginatedFilterList"
import { useApiClient, type Item } from "../composables/useApiClient"

interface Props {
  refreshKey: number
}

interface Emits {
  (e: "changed"): void
}

const props = defineProps<Props>()

const emit = defineEmits<Emits>()

const { getLeft, changeSelection, addItems } = useApiClient()

const addInput = ref<string>("")
const addError = ref<string>("")
const isAdding = ref<boolean>(false)
const pendingSelectIds = ref<Set<number>>(new Set())
const skipNextRefresh = ref<boolean>(false)

const {
  filterInput,
  items,
  loadingMore,
  error,
  totalMatched,
  scroller,
  footerText,
  fetchPage,
  handleFilter,
  setupObserver,
  cleanup,
} = usePaginatedFilterList<Item>({
  fetcher: async ({ filterId, offset, limit }) => {
    const response = await getLeft({ filterId, offset, limit })
    return response.data
  },
  loadErrorMessage: "Failed to load left list",
})

const toggleSelection = async (id: number): Promise<void> => {
  if (pendingSelectIds.value.has(id)) {
    return
  }

  pendingSelectIds.value.add(id)

  try {
    await changeSelection({ action: "select", id })
    skipNextRefresh.value = true
    await fetchPage({ reset: true })
    emit("changed")
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to select item"
  } finally {
    pendingSelectIds.value.delete(id)
  }
}

const addNew = async (): Promise<void> => {
  if (isAdding.value) {
    return
  }

  addError.value = ""
  const raw = addInput.value.trim()
  if (!raw) {
    addError.value = "Enter an ID"
    return
  }

  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed)) {
    addError.value = "ID must be a safe integer"
    return
  }

  isAdding.value = true
  try {
    const response = await addItems([parsed])
    const first = response.results?.[0]
    if (!first || first.status !== "added") {
      addError.value = `Cannot add ID ${parsed}: ${first?.status || "unknown result"}`
    }
    addInput.value = ""
    skipNextRefresh.value = true
    await fetchPage({ reset: true })
    emit("changed")
  } catch (err) {
    addError.value = err instanceof Error ? err.message : "Failed to add item"
  } finally {
    isAdding.value = false
  }
}

watch(
  () => props.refreshKey,
  () => {
    if (skipNextRefresh.value) {
      skipNextRefresh.value = false
      return
    }

    fetchPage({ reset: true })
  },
)

onMounted(async () => {
  await fetchPage({ reset: true })
  setupObserver()
})

onBeforeUnmount(cleanup)
</script>

<template>
  <section
    class="grid min-h-[50vh] grid-rows-[auto_auto_1fr] rounded-3xl border border-stone-300 bg-amber-50 p-4 shadow-lg lg:min-h-[74vh]"
  >
    <header class="mb-4 flex items-center justify-between gap-3">
      <div>
        <h2 class="m-0 text-lg font-semibold">Left Window</h2>
        <p class="mt-1 mb-0 text-sm text-stone-600">
          All items except selected
        </p>
      </div>
      <span
        class="min-w-12 rounded-full border border-stone-300 bg-white px-3 py-1.5 text-center"
      >
        {{ totalMatched }}
      </span>
    </header>

    <div class="mb-3 grid gap-2">
      <input
        v-model="filterInput"
        type="text"
        placeholder="Filter by ID"
        class="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 outline-none focus:border-amber-700"
        @input="handleFilter"
      />
      <div class="grid grid-cols-[1fr_auto] gap-2">
        <input
          v-model="addInput"
          type="text"
          placeholder="Add new ID"
          class="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 outline-none focus:border-amber-700"
          @keydown.enter.prevent="addNew"
        />
        <button
          :disabled="isAdding"
          class="flex min-w-16 cursor-pointer items-center justify-center rounded-xl border border-amber-700 bg-amber-700 px-3 py-2 text-white transition hover:bg-amber-800 disabled:cursor-wait disabled:opacity-65"
          @click="addNew"
        >
          <span
            v-if="isAdding"
            class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
            aria-hidden="true"
          />
          <span v-else>Add</span>
        </button>
      </div>
      <p v-if="addError" class="m-0 text-sm text-red-700">{{ addError }}</p>
    </div>

    <div
      ref="scroller"
      class="max-h-[44vh] overflow-auto rounded-xl border border-stone-300 bg-white lg:max-h-[65vh]"
    >
      <div
        v-if="error"
        class="border-b border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
      >
        {{ error }}
      </div>
      <div
        v-for="item in items"
        :key="item.id"
        class="flex items-center justify-between border-b border-stone-200 px-3 py-2.5"
      >
        <span>ID {{ item.id }}</span>
        <button
          :disabled="pendingSelectIds.has(item.id)"
          class="flex min-w-16 cursor-pointer items-center justify-center bg-transparent p-0 text-amber-800 disabled:cursor-wait disabled:opacity-60"
          @click="toggleSelection(item.id)"
        >
          <span
            v-if="pendingSelectIds.has(item.id)"
            class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-amber-800 border-t-transparent"
            aria-hidden="true"
          />
          <span v-else>Select</span>
        </button>
      </div>
      <div data-sentinel class="px-3 py-2.5 text-center text-sm text-stone-600">
        {{ footerText }}
      </div>
      <div
        v-if="loadingMore"
        class="px-3 py-2.5 text-center text-sm text-stone-600"
      >
        Loading next 20...
      </div>
    </div>
  </section>
</template>
