<script setup lang="ts">
import draggable from "vuedraggable"
import { onBeforeUnmount, onMounted, ref, watch } from "vue"
import { usePaginatedFilterList } from "../composables/usePaginatedFilterList"
import { useRightDragAndDrop } from "../composables/useRightDragAndDrop"
import { useApiClient, type Item } from "../composables/useApiClient"

interface Props {
  refreshKey: number
}

interface Emits {
  (e: "changed"): void
}

const props = defineProps<Props>()

const emit = defineEmits<Emits>()

const { getRight, changeSelection, reorderRight } = useApiClient()
const pendingUnselectIds = ref<Set<number>>(new Set())
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
    const response = await getRight({ filterId, offset, limit })
    return response.data
  },
  loadErrorMessage: "Failed to load right list",
})

const unselect = async (id: number): Promise<void> => {
  if (pendingUnselectIds.value.has(id)) {
    return
  }

  pendingUnselectIds.value.add(id)

  try {
    await changeSelection({ action: "unselect", id })
    skipNextRefresh.value = true
    await fetchPage({ reset: true })
    emit("changed")
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to unselect item"
  } finally {
    pendingUnselectIds.value.delete(id)
  }
}

const { onDragStart, onDragEnd } = useRightDragAndDrop<Item>({
  items,
  reorder: reorderRight,
  onChanged: () => emit("changed"),
  onError: (message) => {
    error.value = message
  },
  rollback: async () => {
    await fetchPage({ reset: true })
  },
})

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
        <h2 class="m-0 text-lg font-semibold">Right Window</h2>
        <p class="mt-1 mb-0 text-sm text-stone-600">
          Selected items with drag sorting
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

      <draggable
        v-model="items"
        item-key="id"
        handle=".drag-handle"
        ghost-class="opacity-40"
        @start="onDragStart"
        @end="onDragEnd"
      >
        <template #item="{ element }">
          <div
            class="flex items-center justify-between gap-2 border-b border-stone-200 px-3 py-2.5"
          >
            <span
              class="drag-handle cursor-grab select-none tracking-widest text-stone-600"
            >
              ::
            </span>
            <span>ID {{ element.id }}</span>
            <button
              :disabled="pendingUnselectIds.has(element.id)"
              class="flex min-w-16 cursor-pointer items-center justify-center bg-transparent p-0 text-amber-800 disabled:cursor-wait disabled:opacity-60"
              @click="unselect(element.id)"
            >
              <span
                v-if="pendingUnselectIds.has(element.id)"
                class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-amber-800 border-t-transparent"
                aria-hidden="true"
              />
              <span v-else>Remove</span>
            </button>
          </div>
        </template>
      </draggable>

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
