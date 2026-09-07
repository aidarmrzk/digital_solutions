import { ADD_BATCH_MS, IDEMPOTENCY_TTL_MS, STATE_BATCH_MS } from "./constants"
import { AppStore } from "./store"

interface IdempotencyEntry<T> {
  result: T
  expiresAt: number
}

type Resolve<T> = (value: T) => void

type Reject = (reason?: unknown) => void

type StateOperation =
  | { type: "left_query"; filter?: string; offset?: number; limit?: number }
  | { type: "right_query"; filter?: string; offset?: number; limit?: number }
  | { type: "state_snapshot" }
  | { type: "select"; id: unknown }
  | { type: "unselect"; id: unknown }
  | {
      type: "reorder"
      movedId: unknown
      targetId?: unknown
      position?: "before" | "after" | "start" | "end"
    }

type AddOperation = { id?: unknown; ids?: unknown[] }

type QueueTask<TPayload, TResult> = {
  operation: TPayload
  idempotencyKey: string | null
  signature: string
  resolve: Resolve<TResult>
  reject: Reject
}

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`
  }

  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
  const serialized = entries.map(
    ([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`,
  )
  return `{${serialized.join(",")}}`
}

const now = (): number => Date.now()

export class RequestOrchestrator {
  private store: AppStore
  private addQueue: Array<QueueTask<AddOperation, unknown>> = []
  private stateQueue: Array<QueueTask<StateOperation, unknown>> = []
  private idempotency = new Map<string, IdempotencyEntry<unknown>>()
  private addTimer: NodeJS.Timeout
  private stateTimer: NodeJS.Timeout

  constructor(store: AppStore) {
    this.store = store

    this.addTimer = setInterval(() => {
      this.flushAddQueue()
    }, ADD_BATCH_MS)

    this.stateTimer = setInterval(() => {
      this.flushStateQueue()
    }, STATE_BATCH_MS)
  }

  stop(): void {
    clearInterval(this.addTimer)
    clearInterval(this.stateTimer)
  }

  private cleanupIdempotency(): void {
    const current = now()
    for (const [key, value] of this.idempotency.entries()) {
      if (value.expiresAt <= current) {
        this.idempotency.delete(key)
      }
    }
  }

  private getCached<T>(key: string | null): T | null {
    if (!key) {
      return null
    }
    this.cleanupIdempotency()
    const entry = this.idempotency.get(key)
    if (!entry) {
      return null
    }
    return entry.result as T
  }

  private setCached(key: string | null, result: unknown): void {
    if (!key) {
      return
    }
    this.idempotency.set(key, {
      result,
      expiresAt: now() + IDEMPOTENCY_TTL_MS,
    })
  }

  enqueueAdd({
    operation,
    idempotencyKey,
  }: {
    operation: AddOperation
    idempotencyKey: string | null
  }): Promise<unknown> {
    const cached = this.getCached(idempotencyKey)
    if (cached) {
      return Promise.resolve(cached)
    }

    return new Promise((resolve, reject) => {
      this.addQueue.push({
        operation,
        idempotencyKey,
        signature: `add:${stableStringify(operation)}`,
        resolve,
        reject,
      })
    })
  }

  enqueueState({
    operation,
    idempotencyKey,
  }: {
    operation: StateOperation
    idempotencyKey: string | null
  }): Promise<unknown> {
    const cached = this.getCached(idempotencyKey)
    if (cached) {
      return Promise.resolve(cached)
    }

    return new Promise((resolve, reject) => {
      this.stateQueue.push({
        operation,
        idempotencyKey,
        signature: `state:${stableStringify(operation)}`,
        resolve,
        reject,
      })
    })
  }

  private groupBySignature<TPayload, TResult>(
    batch: Array<QueueTask<TPayload, TResult>>,
  ): Map<string, Array<QueueTask<TPayload, TResult>>> {
    const groups = new Map<string, Array<QueueTask<TPayload, TResult>>>()
    for (const task of batch) {
      if (!groups.has(task.signature)) {
        groups.set(task.signature, [])
      }
      groups.get(task.signature)?.push(task)
    }
    return groups
  }

  private resolveGroup(
    group: Array<QueueTask<unknown, unknown>>,
    result: unknown,
  ): void {
    for (const task of group) {
      if (task.idempotencyKey) {
        this.setCached(task.idempotencyKey, result)
      }
      task.resolve(result)
    }
  }

  private rejectGroup(
    group: Array<QueueTask<unknown, unknown>>,
    error: unknown,
  ): void {
    for (const task of group) {
      task.reject(error)
    }
  }

  private async flushAddQueue(): Promise<void> {
    if (this.addQueue.length === 0) {
      return
    }

    const batch = this.addQueue.splice(0, this.addQueue.length)
    const groups = this.groupBySignature(batch)

    for (const [, group] of groups.entries()) {
      try {
        const payload = group[0]?.operation
        const result = this.processAdd(payload)
        this.resolveGroup(group as Array<QueueTask<unknown, unknown>>, result)
      } catch (error) {
        this.rejectGroup(group as Array<QueueTask<unknown, unknown>>, error)
      }
    }
  }

  private processAdd(payload?: AddOperation) {
    const ids = Array.isArray(payload?.ids) ? payload.ids : [payload?.id]
    const data = this.store.addMany(ids)
    return {
      ok: true,
      queuedAt: now(),
      mode: "add_batch_10s",
      ...data,
      state: this.store.getStateMeta(),
    }
  }

  private async flushStateQueue(): Promise<void> {
    if (this.stateQueue.length === 0) {
      return
    }

    const batch = this.stateQueue.splice(0, this.stateQueue.length)
    const groups = this.groupBySignature(batch)

    for (const [, group] of groups.entries()) {
      try {
        const payload = group[0]?.operation
        const result = this.processState(payload)
        this.resolveGroup(group as Array<QueueTask<unknown, unknown>>, result)
      } catch (error) {
        this.rejectGroup(group as Array<QueueTask<unknown, unknown>>, error)
      }
    }
  }

  private processState(payload?: StateOperation) {
    if (!payload) {
      throw new Error("State payload is required")
    }

    switch (payload.type) {
      case "left_query":
        return {
          ok: true,
          mode: "state_batch_1s",
          data: this.store.queryLeft(payload),
          state: this.store.getStateMeta(),
        }
      case "right_query":
        return {
          ok: true,
          mode: "state_batch_1s",
          data: this.store.queryRight(payload),
          state: this.store.getStateMeta(),
        }
      case "state_snapshot":
        return {
          ok: true,
          mode: "state_batch_1s",
          data: this.store.getStateMeta(),
        }
      case "select":
        return {
          ok: true,
          mode: "state_batch_1s",
          data: this.store.select(payload.id),
          state: this.store.getStateMeta(),
        }
      case "unselect":
        return {
          ok: true,
          mode: "state_batch_1s",
          data: this.store.unselect(payload.id),
          state: this.store.getStateMeta(),
        }
      case "reorder":
        return {
          ok: true,
          mode: "state_batch_1s",
          data: this.store.reorder(payload),
          state: this.store.getStateMeta(),
        }
      default:
        throw new Error(
          `Unsupported operation type: ${(payload as { type?: string }).type}`,
        )
    }
  }
}
