const BASE_URL = import.meta.env.VITE_API_BASE_URL || ""

const makeKey = (): string => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

type RequestOptions = RequestInit & {
  idempotencyKey?: string
}

export interface Item {
  id: number
}

export interface StateMeta {
  selectedCount: number
  totalCount: number
}

export interface ListPayload {
  items: Item[]
  offset: number
  limit: number
  hasMore: boolean
  nextOffset: number
  totalMatched: number
}

interface ApiResult<T> {
  ok: boolean
  mode?: string
  data: T
  state?: StateMeta
  results?: Array<{ id: number | string; status: string }>
}

const request = async <T>(
  path: string,
  options: RequestOptions = {},
): Promise<ApiResult<T>> => {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Idempotency-Key": options.idempotencyKey || makeKey(),
      ...(options.headers || {}),
    },
  })

  const data = (await response.json()) as ApiResult<T> & { error?: string }
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || "Request failed")
  }
  return data
}

export const useApiClient = () => {
  const getLeft = ({
    filterId = "",
    offset = 0,
    limit = 20,
  }: {
    filterId?: string
    offset?: number
    limit?: number
  }) => {
    const query = new URLSearchParams({
      filterId: String(filterId || ""),
      offset: String(offset),
      limit: String(limit),
    })
    return request<ListPayload>(`/api/left?${query.toString()}`)
  }

  const getRight = ({
    filterId = "",
    offset = 0,
    limit = 20,
  }: {
    filterId?: string
    offset?: number
    limit?: number
  }) => {
    const query = new URLSearchParams({
      filterId: String(filterId || ""),
      offset: String(offset),
      limit: String(limit),
    })
    return request<ListPayload>(`/api/right?${query.toString()}`)
  }

  const getState = () => request<StateMeta>("/api/state")

  const addItems = (ids: number[]) =>
    request<unknown>("/api/items/add", {
      method: "POST",
      body: JSON.stringify({ ids }),
    })

  const changeSelection = ({
    action,
    id,
  }: {
    action: "select" | "unselect"
    id: number
  }) =>
    request<unknown>("/api/selection", {
      method: "POST",
      body: JSON.stringify({ action, id }),
    })

  const reorderRight = ({
    movedId,
    targetId,
    position,
  }: {
    movedId: number
    targetId: number | null
    position: "before" | "after" | "start" | "end"
  }) =>
    request<unknown>("/api/right/reorder", {
      method: "POST",
      body: JSON.stringify({ movedId, targetId, position }),
    })

  return {
    getLeft,
    getRight,
    getState,
    addItems,
    changeSelection,
    reorderRight,
  }
}
