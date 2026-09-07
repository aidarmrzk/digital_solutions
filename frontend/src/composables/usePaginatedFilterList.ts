import { computed, ref, type Ref } from "vue"

type FetchParams = {
  filterId: string
  offset: number
  limit: number
}

type FetchPayload<T> = {
  items: T[]
  hasMore: boolean
  nextOffset: number
  totalMatched: number
}

type UsePaginatedFilterListOptions<T> = {
  limit?: number
  fetcher: (params: FetchParams) => Promise<FetchPayload<T>>
  loadErrorMessage: string
}

export const usePaginatedFilterList = <T>(
  options: UsePaginatedFilterListOptions<T>,
) => {
  const limit = options.limit ?? 20

  const filterInput = ref<string>("")
  const activeFilter = ref<string>("")
  const items: Ref<T[]> = ref([])
  const loading = ref<boolean>(false)
  const loadingMore = ref<boolean>(false)
  const error = ref<string>("")
  const hasMore = ref<boolean>(true)
  const nextOffset = ref<number>(0)
  const totalMatched = ref<number>(0)

  const scroller: Ref<HTMLElement | null> = ref(null)

  let observer: IntersectionObserver | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  const fetchPage = async ({
    reset = false,
  }: { reset?: boolean } = {}): Promise<void> => {
    if (loading.value || loadingMore.value) {
      return
    }

    if (!reset && !hasMore.value) {
      return
    }

    error.value = ""
    if (reset) {
      loading.value = true
    } else {
      loadingMore.value = true
    }

    try {
      const payload = await options.fetcher({
        filterId: activeFilter.value,
        offset: reset ? 0 : nextOffset.value,
        limit,
      })

      items.value = reset ? payload.items : items.value.concat(payload.items)
      hasMore.value = payload.hasMore
      nextOffset.value = payload.nextOffset
      totalMatched.value = payload.totalMatched
    } catch (err) {
      error.value =
        err instanceof Error ? err.message : options.loadErrorMessage
    } finally {
      loading.value = false
      loadingMore.value = false
    }
  }

  const handleFilter = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }

    debounceTimer = setTimeout(() => {
      activeFilter.value = filterInput.value.trim()
      hasMore.value = true
      nextOffset.value = 0
      fetchPage({ reset: true })
    }, 220)
  }

  const setupObserver = () => {
    const root = scroller.value
    if (!root) {
      return
    }

    const sentinel = root.querySelector("[data-sentinel]")
    if (!sentinel) {
      return
    }

    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            fetchPage()
          }
        }
      },
      {
        root,
        threshold: 0.1,
      },
    )

    observer.observe(sentinel)
  }

  const cleanup = () => {
    if (observer) {
      observer.disconnect()
    }

    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }
  }

  const footerText = computed(() => {
    if (loading.value) {
      return "Loading..."
    }

    if (!hasMore.value) {
      return `End of list (${totalMatched.value})`
    }

    return "Scroll to load more"
  })

  return {
    filterInput,
    items,
    loading,
    loadingMore,
    error,
    hasMore,
    totalMatched,
    scroller,
    footerText,
    fetchPage,
    handleFilter,
    setupObserver,
    cleanup,
  }
}
