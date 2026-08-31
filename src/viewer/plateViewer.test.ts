import { describe, expect, it, vi } from "vitest"
import { PlateViewer, renderViewerStatus } from "./plateViewer"

class FakeElement {
  readonly children: FakeElement[] = []
  readonly attributes = new Map<string, string>()
  readonly ownerDocument = {
    createElement: () => new FakeElement(),
  }
  readonly classList = {
    hidden: false,
    toggle: (_name: string, force: boolean) => {
      this.classList.hidden = force
    },
  }
  className = ""
  textContent = ""

  set innerHTML(_value: string) {
    throw new Error("innerHTML must not be used for viewer status")
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children.splice(0, this.children.length, ...children)
  }

  append(...children: FakeElement[]): void {
    this.children.push(...children)
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }
}

describe("viewer security boundary", () => {
  it("renders worker errors as text instead of executable markup", () => {
    const status = new FakeElement()
    const attack = '<img src=x onerror="globalThis.pwned=true">'

    renderViewerStatus(status as unknown as HTMLDivElement, attack, false)

    expect(status.children).toHaveLength(1)
    expect(status.children[0].textContent).toBe(attack)
    expect(status.classList.hidden).toBe(false)
  })

  it("shows a fallback instead of throwing when WebGL cannot start", () => {
    const viewer = new PlateViewer()
    const container = new FakeElement()
    Object.assign(viewer, { webglFailed: true })

    expect(() => viewer.mount(container as unknown as HTMLElement)).not.toThrow()
    expect(container.children.length).toBeGreaterThan(0)
    expect(container.children.some((child) => child.className === "viewer-status")).toBe(true)
  })

  it("reports attachment against the current host and no-ops relayout without a canvas", () => {
    const viewer = new PlateViewer()
    const container = new FakeElement()

    expect(viewer.isAttachedTo(container as unknown as HTMLElement)).toBe(false)
    expect(() => viewer.relayout()).not.toThrow()
  })

  it("fully releases project state when the viewer is closed", () => {
    const viewer = new PlateViewer()
    const terminate = vi.fn()
    Object.assign(viewer, {
      worker: { terminate },
      workerReady: true,
      projectBytes: new ArrayBuffer(8),
      pendingPlate: { id: "plate-1", objectIds: ["1"] },
      requestedPlateId: "plate-1",
      loadedPlateId: "plate-1",
    })

    viewer.closeProject()

    expect(terminate).toHaveBeenCalledOnce()
    expect(Reflect.get(viewer, "worker")).toBeNull()
    expect(Reflect.get(viewer, "projectBytes")).toBeNull()
    expect(Reflect.get(viewer, "pendingPlate")).toBeNull()
    expect(Reflect.get(viewer, "workerReady")).toBe(false)
    expect(Reflect.get(viewer, "status")).toBeNull()
    expect(Reflect.get(viewer, "labels")).toBeNull()
  })
})
