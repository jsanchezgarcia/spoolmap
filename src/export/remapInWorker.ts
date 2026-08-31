import type { FilamentColorRemap, RemappedThreeMf } from "./remapThreeMf"

type WorkerResponse = { ok: true; result: RemappedThreeMf } | { ok: false; message: string }

/** Keeps archive decompression and recompression off the interaction thread. */
export function remapThreeMfInWorker(
  source: ArrayBuffer | Uint8Array,
  originalName: string,
  remaps: readonly FilamentColorRemap[],
): Promise<RemappedThreeMf> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./remapWorker.ts", import.meta.url), {
      type: "module",
    })
    const finish = () => worker.terminate()

    worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
      finish()
      if (event.data.ok) resolve(event.data.result)
      else reject(new Error(event.data.message))
    })
    worker.addEventListener("error", (event) => {
      finish()
      reject(new Error(event.message || "The export worker failed."))
    })

    // Do not transfer the live project buffer: users can export again after
    // changing a match, and detaching it would make that second export fail.
    const copy = source instanceof Uint8Array ? source.slice().buffer : source.slice(0)
    worker.postMessage({ source: copy, originalName, remaps }, [copy])
  })
}
