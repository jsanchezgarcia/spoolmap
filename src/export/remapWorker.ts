import { remapThreeMf, type FilamentColorRemap } from "./remapThreeMf"

type RemapRequest = {
  source: ArrayBuffer
  originalName: string
  remaps: FilamentColorRemap[]
}

self.addEventListener("message", async (event: MessageEvent<RemapRequest>) => {
  try {
    const result = await remapThreeMf(event.data.source, event.data.originalName, event.data.remaps)
    self.postMessage({ ok: true, result })
  } catch (error) {
    self.postMessage({
      ok: false,
      message: error instanceof Error ? error.message : "The export worker failed.",
    })
  }
})
