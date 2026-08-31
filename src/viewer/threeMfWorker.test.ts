import JSZip from "jszip"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { withDeclaredUncompressedSize } from "../test/zipDeclaredSize"

type Request =
  | { type: "initialize"; bytes: ArrayBuffer }
  | { type: "plate"; requestId: number; objectIds: string[] }

type Response = {
  type: "ready" | "progress" | "plate" | "error"
  requestId?: number
  message?: string
  geometries?: Array<{ triangleCount: number; positions: Float32Array }>
}

const messages: Response[] = []
const workerScope = {
  onmessage: null as ((event: MessageEvent<Request>) => void) | null,
  postMessage(message: Response): void {
    messages.push(message)
  },
}

async function waitFor(predicate: (message: Response) => boolean): Promise<Response> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const found = messages.find(predicate)
    if (found) return found
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(`Worker response timed out: ${JSON.stringify(messages)}`)
}

async function projectBytes(
  componentPath: string,
  componentXml = `
    <model><resources><object type="model" id="2"><mesh>
      <vertices>
        <vertex x="0" y="0" z="0"/>
        <vertex x="1" y="0" z="0"/>
        <vertex x="0" y="1" z="0"/>
      </vertices>
      <triangles><triangle v1="0" v2="1" v3="2"/></triangles>
    </mesh></object></resources></model>`,
): Promise<ArrayBuffer> {
  const archive = new JSZip()
  archive.file(
    "3D/3dmodel.model",
    `<model><resources><object type="model" id="1"><components><component objectid="2" p:path="${componentPath}"/></components></object></resources><build><item objectid="1"/></build></model>`,
  )
  archive.file("3D/Objects/part.model", componentXml)
  return archive.generateAsync({ type: "arraybuffer" })
}

async function initialize(bytes: ArrayBuffer): Promise<Response> {
  workerScope.onmessage?.({
    data: { type: "initialize", bytes },
  } as MessageEvent<Request>)
  return waitFor((message) => message.type === "ready" || message.type === "error")
}

beforeAll(async () => {
  vi.stubGlobal("self", workerScope)
  await import("./threeMfWorker")
})

beforeEach(() => {
  messages.length = 0
})

describe("3MF viewer worker hardening", () => {
  it("loads bounded valid geometry", async () => {
    expect(await initialize(await projectBytes("/3D/Objects/part.model"))).toMatchObject({
      type: "ready",
    })

    workerScope.onmessage?.({
      data: { type: "plate", requestId: 1, objectIds: ["1"] },
    } as MessageEvent<Request>)
    const result = await waitFor((message) => message.type === "plate" || message.type === "error")

    expect(result.type).toBe("plate")
    expect(result.geometries?.[0].triangleCount).toBe(1)
    expect(result.geometries?.[0].positions).toHaveLength(9)
  })

  it("rejects traversal and non-canonical component paths", async () => {
    expect(await initialize(await projectBytes("/3D/../secret.model"))).toMatchObject({
      type: "ready",
    })

    workerScope.onmessage?.({
      data: { type: "plate", requestId: 2, objectIds: ["1"] },
    } as MessageEvent<Request>)
    const result = await waitFor((message) => message.type === "error")

    expect(result).toMatchObject({
      requestId: 2,
      message: "The project contains an invalid component path.",
    })
  })

  it("rejects traversal paths embedded in the ZIP directory", async () => {
    const archive = new JSZip()
    archive.file("3D/3dmodel.model", "<model/>")
    archive.file("3D/../escaped.model", "<model/>")

    const result = await initialize(await archive.generateAsync({ type: "arraybuffer" }))

    expect(result).toMatchObject({
      type: "error",
      message: "The project contains an unsafe archive path.",
    })
  })

  it("rejects triangles that reference missing vertices", async () => {
    const invalidMesh = `
      <model><resources><object id="2"><mesh>
        <vertices><vertex x="0" y="0" z="0"/></vertices>
        <triangles><triangle v1="0" v2="1" v3="2"/></triangles>
      </mesh></object></resources></model>`
    expect(
      await initialize(await projectBytes("/3D/Objects/part.model", invalidMesh)),
    ).toMatchObject({ type: "ready" })

    workerScope.onmessage?.({
      data: { type: "plate", requestId: 3, objectIds: ["1"] },
    } as MessageEvent<Request>)
    const result = await waitFor((message) => message.type === "error")

    expect(result.message).toBe("The project contains a triangle with an invalid vertex reference.")
  })

  it("rejects archives with oversized declared expansion before previewing", async () => {
    const hostile = withDeclaredUncompressedSize(
      new Uint8Array(await projectBytes("/3D/Objects/part.model")),
      "3D/Objects/part.model",
      513 * 1024 * 1024,
    )

    expect(await initialize(new Uint8Array(hostile).buffer)).toMatchObject({
      type: "error",
      message: "This project expands beyond the safe preview limit.",
    })
  })
})
