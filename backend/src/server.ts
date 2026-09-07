import cors from "cors"
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express"
import { PAGE_SIZE } from "./constants"
import { RequestOrchestrator } from "./queue"
import { AppStore } from "./store"

const app = express()
app.use(cors())
app.use(express.json())

const store = new AppStore()
const orchestrator = new RequestOrchestrator(store)

const getIdempotencyKey = (req: Request): string | null => {
  const raw = req.headers["x-idempotency-key"]
  return typeof raw === "string" ? raw : null
}

const parseLimit = (value: unknown): number => {
  const raw = Number(value)
  if (!Number.isFinite(raw) || raw <= 0) {
    return PAGE_SIZE
  }
  return Math.min(200, Math.floor(raw))
}

const parseOffset = (value: unknown): number => {
  const raw = Number(value)
  if (!Number.isFinite(raw) || raw < 0) {
    return 0
  }
  return Math.floor(raw)
}

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ ok: true, state: store.getStateMeta() })
})

app.get(
  "/api/left",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await orchestrator.enqueueState({
        operation: {
          type: "left_query",
          filter: String(req.query.filterId || "").trim(),
          offset: parseOffset(req.query.offset),
          limit: parseLimit(req.query.limit),
        },
        idempotencyKey: getIdempotencyKey(req),
      })
      res.json(result)
    } catch (error) {
      next(error)
    }
  },
)

app.get(
  "/api/right",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await orchestrator.enqueueState({
        operation: {
          type: "right_query",
          filter: String(req.query.filterId || "").trim(),
          offset: parseOffset(req.query.offset),
          limit: parseLimit(req.query.limit),
        },
        idempotencyKey: getIdempotencyKey(req),
      })
      res.json(result)
    } catch (error) {
      next(error)
    }
  },
)

app.post(
  "/api/items/add",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const payload = req.body || {}
      const ids = Array.isArray(payload.ids) ? payload.ids : [payload.id]

      const result = await orchestrator.enqueueAdd({
        operation: { ids },
        idempotencyKey: getIdempotencyKey(req),
      })

      res.json(result)
    } catch (error) {
      next(error)
    }
  },
)

app.post(
  "/api/selection",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const payload = req.body || {}
      const action = payload.action
      if (action !== "select" && action !== "unselect") {
        return res
          .status(400)
          .json({ ok: false, error: "action must be select or unselect" })
      }

      const result = await orchestrator.enqueueState({
        operation: {
          type: action,
          id: payload.id,
        },
        idempotencyKey: getIdempotencyKey(req),
      })

      return res.json(result)
    } catch (error) {
      return next(error)
    }
  },
)

app.post(
  "/api/right/reorder",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const payload = req.body || {}

      const result = await orchestrator.enqueueState({
        operation: {
          type: "reorder",
          movedId: payload.movedId,
          targetId: payload.targetId ?? null,
          position: payload.position || "before",
        },
        idempotencyKey: getIdempotencyKey(req),
      })

      res.json(result)
    } catch (error) {
      next(error)
    }
  },
)

app.get(
  "/api/state",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await orchestrator.enqueueState({
        operation: { type: "state_snapshot" },
        idempotencyKey: getIdempotencyKey(req),
      })

      res.json(result)
    } catch (error) {
      next(error)
    }
  },
)

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  res
    .status(500)
    .json({ ok: false, error: error.message || "Unexpected server error" })
})

const port = Number(process.env.PORT || 3000)
const server = app.listen(port, () => {
  console.log(`Backend listening on port ${port}`)
})

const shutdown = (): void => {
  orchestrator.stop()
  server.close(() => {
    process.exit(0)
  })
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
