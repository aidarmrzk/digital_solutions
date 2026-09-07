import type { Ref } from "vue"

type DragEventPayload = {
  oldIndex?: number
  newIndex?: number
}

type ReorderPosition = "before" | "after" | "start" | "end"

type ReorderPayload = {
  movedId: number
  targetId: number | null
  position: ReorderPosition
}

type UseRightDragAndDropOptions<T extends { id: number }> = {
  items: Ref<T[]>
  reorder: (payload: ReorderPayload) => Promise<unknown>
  onChanged: () => void
  onError: (message: string) => void
  rollback: () => Promise<void>
}

export const useRightDragAndDrop = <T extends { id: number }>(
  options: UseRightDragAndDropOptions<T>,
) => {
  let dragSnapshot: number[] = []

  const onDragStart = () => {
    dragSnapshot = options.items.value.map((item) => item.id)
  }

  const resolveReorderTarget = (newIndex: number) => {
    let targetId: number | null = null
    let position: ReorderPosition = "start"

    if (options.items.value.length > 1) {
      if (newIndex === 0) {
        targetId = options.items.value[1]?.id ?? null
        position = targetId === null ? "start" : "before"
      } else {
        targetId = options.items.value[newIndex - 1]?.id ?? null
        position = targetId === null ? "start" : "after"
      }
    }

    return { targetId, position }
  }

  const onDragEnd = async (event: DragEventPayload): Promise<void> => {
    if (
      !event ||
      event.oldIndex === undefined ||
      event.newIndex === undefined ||
      event.oldIndex === event.newIndex
    ) {
      return
    }

    const movedId = dragSnapshot[event.oldIndex]
    const newIndex = event.newIndex

    if (movedId === undefined) {
      return
    }

    const { targetId, position } = resolveReorderTarget(newIndex)

    try {
      await options.reorder({ movedId, targetId, position })
      options.onChanged()
    } catch (err) {
      options.onError(
        err instanceof Error ? err.message : "Failed to reorder selected list",
      )
      await options.rollback()
    }
  }

  return {
    onDragStart,
    onDragEnd,
  }
}
