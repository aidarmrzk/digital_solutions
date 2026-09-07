import { BASE_MAX_ID, BASE_MIN_ID, PAGE_SIZE } from "./constants"

type Status = "invalid" | "duplicate" | "added"
type SelectionReason =
  | "not_found"
  | "already_selected"
  | "selected"
  | "already_unselected"
  | "unselected"
  | "moved_not_selected"
  | "target_not_selected"
  | "target_not_found"
  | "noop"
  | "reordered"

export interface Item {
  id: number
}

export interface StateMeta {
  selectedCount: number
  totalCount: number
}

export interface ListQuery {
  filter?: string
  offset?: number
  limit?: number
}

export interface ReorderPayload {
  movedId: unknown
  targetId?: unknown
  position?: "before" | "after" | "start" | "end"
}

const toIdString = (value: unknown): string => String(value)

const matchesFilter = (id: number, filter: string): boolean => {
  if (!filter) {
    return true
  }
  return toIdString(id).includes(filter)
}

const toFiniteInteger = (value: unknown): number | null => {
  const num = Number(value)
  if (!Number.isSafeInteger(num)) {
    return null
  }
  return num
}

export class AppStore {
  private addedLowerIds: number[] = []
  private addedUpperIds: number[] = []
  private addedSet = new Set<number>()

  private selectedSet = new Set<number>()
  private selectedOrder: number[] = []

  private revision = 0

  getStateMeta(): StateMeta {
    return {
      selectedCount: this.selectedOrder.length,
      totalCount: BASE_MAX_ID - BASE_MIN_ID + 1 + this.addedSet.size,
    }
  }

  idExists(id: number): boolean {
    if (id >= BASE_MIN_ID && id <= BASE_MAX_ID) {
      return true
    }
    return this.addedSet.has(id)
  }

  private addOne(rawId: unknown): { id: unknown; status: Status } {
    const id = toFiniteInteger(rawId)
    if (id === null) {
      return { id: rawId, status: "invalid" }
    }

    if ((id >= BASE_MIN_ID && id <= BASE_MAX_ID) || this.addedSet.has(id)) {
      return { id, status: "duplicate" }
    }

    this.addedSet.add(id)
    if (id < BASE_MIN_ID) {
      this.addedLowerIds.push(id)
      this.addedLowerIds.sort((a, b) => a - b)
    } else {
      this.addedUpperIds.push(id)
      this.addedUpperIds.sort((a, b) => a - b)
    }

    this.revision += 1
    return { id, status: "added" }
  }

  addMany(ids: unknown[] | unknown): {
    results: Array<{ id: unknown; status: Status }>
  } {
    const normalized = Array.isArray(ids) ? ids : [ids]
    const uniqueInRequest = [...new Set(normalized)]
    const results = uniqueInRequest.map((id) => this.addOne(id))

    return {
      results,
    }
  }

  select(idValue: unknown): {
    ok: boolean
    reason: SelectionReason
  } {
    const id = toFiniteInteger(idValue)
    if (id === null || !this.idExists(id)) {
      return { ok: false, reason: "not_found" }
    }

    if (this.selectedSet.has(id)) {
      return { ok: true, reason: "already_selected" }
    }

    this.selectedSet.add(id)
    this.selectedOrder.push(id)
    this.revision += 1

    return { ok: true, reason: "selected" }
  }

  unselect(idValue: unknown): {
    ok: boolean
    reason: SelectionReason
  } {
    const id = toFiniteInteger(idValue)
    if (id === null || !this.idExists(id)) {
      return { ok: false, reason: "not_found" }
    }

    if (!this.selectedSet.has(id)) {
      return { ok: true, reason: "already_unselected" }
    }

    this.selectedSet.delete(id)
    this.selectedOrder = this.selectedOrder.filter((item) => item !== id)
    this.revision += 1

    return { ok: true, reason: "unselected" }
  }

  reorder({ movedId, targetId, position = "before" }: ReorderPayload): {
    ok: boolean
    reason: SelectionReason
  } {
    const moved = toFiniteInteger(movedId)
    const target =
      targetId === null || targetId === undefined
        ? null
        : toFiniteInteger(targetId)

    if (moved === null || !this.selectedSet.has(moved)) {
      return { ok: false, reason: "moved_not_selected" }
    }

    if (target !== null && !this.selectedSet.has(target)) {
      return { ok: false, reason: "target_not_selected" }
    }

    if (target !== null && moved === target) {
      return { ok: true, reason: "noop" }
    }

    const next = this.selectedOrder.filter((id) => id !== moved)

    if (target === null) {
      if (position === "start") {
        next.unshift(moved)
      } else {
        next.push(moved)
      }
      this.selectedOrder = next
      this.revision += 1
      return { ok: true, reason: "reordered" }
    }

    const targetIndex = next.indexOf(target)
    if (targetIndex === -1) {
      return { ok: false, reason: "target_not_found" }
    }

    const insertIndex = position === "after" ? targetIndex + 1 : targetIndex
    next.splice(insertIndex, 0, moved)

    this.selectedOrder = next
    this.revision += 1
    return { ok: true, reason: "reordered" }
  }

  queryRight({ filter = "", offset = 0, limit = PAGE_SIZE }: ListQuery) {
    const normalizedFilter = String(filter || "").trim()
    const start = Math.max(0, Number(offset) || 0)
    const size = Math.max(1, Number(limit) || PAGE_SIZE)

    let matched = 0
    const items: Item[] = []

    for (const id of this.selectedOrder) {
      if (!matchesFilter(id, normalizedFilter)) {
        continue
      }

      if (matched < start) {
        matched += 1
        continue
      }

      if (items.length < size) {
        items.push({ id })
        matched += 1
        continue
      }

      break
    }

    const visibleCount = this.selectedOrder.filter((id) =>
      matchesFilter(id, normalizedFilter),
    ).length

    return {
      items,
      offset: start,
      limit: size,
      hasMore: start + items.length < visibleCount,
      nextOffset: start + items.length,
      totalMatched: visibleCount,
    }
  }

  queryLeft({ filter = "", offset = 0, limit = PAGE_SIZE }: ListQuery) {
    const normalizedFilter = String(filter || "").trim()
    const start = Math.max(0, Number(offset) || 0)
    const size = Math.max(1, Number(limit) || PAGE_SIZE)

    const items: Item[] = []
    let matched = 0
    let totalMatched = 0

    const processId = (id: number): void => {
      if (this.selectedSet.has(id)) {
        return
      }
      if (!matchesFilter(id, normalizedFilter)) {
        return
      }

      if (totalMatched >= start && items.length < size) {
        items.push({ id })
      }

      totalMatched += 1
      matched += 1
    }

    for (const id of this.addedLowerIds) {
      processId(id)
    }

    for (let id = BASE_MIN_ID; id <= BASE_MAX_ID; id += 1) {
      processId(id)
    }

    for (const id of this.addedUpperIds) {
      processId(id)
    }

    return {
      items,
      offset: start,
      limit: size,
      hasMore: start + items.length < totalMatched,
      nextOffset: start + items.length,
      totalMatched,
      scanned: matched,
    }
  }
}
