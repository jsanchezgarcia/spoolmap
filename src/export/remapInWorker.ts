import type { FilamentColorRemap, RemappedThreeMf } from "./remapThreeMf"

type WorkerResponse = { ok: true; result: RemappedThreeMf } | { ok: false; message: string }

let worker: Worker | null = null
let queue: Promise<unknown> = Promise.resolve()

function exportWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./remapWorker.ts", import.meta.url), {
      type: "module",
    })
  }
  return worker
}

function resetWorker(): void {
  worker?.terminate()
  worker = null
}

/** Keeps archive decompression and recompression off the interaction thread. */
export function remapThreeMfInWorker(
  source: ArrayBuffer | Uint8Array,
  originalName: string,
  remaps: readonly FilamentColorRemap[],
): Promise<RemappedThreeMf> {
  const run = (): Promise<RemappedThreeMf> =>
    new Promise((resolve, reject) => {
      const current = exportWorker()
      const settle = (callback: () => void) => {
        current.removeEventListener("message", onMessage)
        current.removeEventListener("error", onError)
        callback()
      }
      const onMessage = (event: MessageEvent<WorkerResponse>) => {
        settle(() => {
          if (event.data.ok) resolve(event.data.result)
          else reject(new Error(event.data.message))
        })
      }
      const onError = (event: ErrorEvent) => {
        resetWorker()
        settle(() => reject(new Error(event.message || "The export worker failed.")))
      }

      current.addEventListener("message", onMessage)
      current.addEventListener("error", onError)

      // Do not transfer the live project buffer: users can export again after
      // changing a match, and detaching it would make that second export fail.
      const copy = source instanceof Uint8Array ? source.slice().buffer : source.slice(0)
      current.postMessage({ source: copy, originalName, remaps }, [copy])
    })

  const pending = queue.then(run, run)
  queue = pending.then(
    () => undefined,
    () => undefined,
  )
  return pending
}
