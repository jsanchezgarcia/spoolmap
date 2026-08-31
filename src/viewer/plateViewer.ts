import {
  AmbientLight,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"

type ColorPass = "original" | "spools"

/**
 * Bambu 3MFs sit on the bed Z-up with the door edge at -Y, so "front" looks
 * along +Y from outside the machine and the presets follow the plate, not the
 * Three.js Y-up defaults.
 */
export type ViewPreset = "top" | "bottom" | "front" | "back" | "left" | "right"

type Axis = readonly [number, number, number]

const DEFAULT_VIEW: Axis = [1.25, -1.55, 1]
const MAX_PROJECT_BYTES = 200 * 1024 * 1024

/**
 * Sitting exactly on the orbit pole leaves OrbitControls without an azimuth to
 * turn, which kills every drag except tipping away from the pole. The vertical
 * views therefore lean two degrees toward the front of the bed: still read as
 * straight down, but orbiting from them behaves normally.
 */
const POLE_TILT = 0.035

const VIEW_PRESETS: Record<ViewPreset, Axis> = {
  top: [0, -POLE_TILT, 1],
  bottom: [0, -POLE_TILT, -1],
  front: [0, -1, 0],
  back: [0, 1, 0],
  left: [-1, 0, 0],
  right: [1, 0, 0],
}

type GeometryGroup = { start: number; count: number; filamentIndex: number }

type GeometryResult = {
  rootId: string
  objectId: string
  transform: number[]
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  groups: GeometryGroup[]
  triangleCount: number
}

type WorkerResponse =
  | { type: "ready" }
  | { type: "progress"; requestId: number; message: string }
  | { type: "plate"; requestId: number; geometries: GeometryResult[] }
  | { type: "error"; requestId?: number; message: string }

type ViewerMesh = Mesh<BufferGeometry, MeshStandardMaterial[]> & {
  userData: {
    objectId: string
    partId: string
    originalMaterials: MeshStandardMaterial[]
    spoolMaterials: MeshStandardMaterial[]
  }
}

function threeMatrix(values: number[]): Matrix4 {
  return new Matrix4().set(
    values[0],
    values[3],
    values[6],
    values[9],
    values[1],
    values[4],
    values[7],
    values[10],
    values[2],
    values[5],
    values[8],
    values[11],
    0,
    0,
    0,
    1,
  )
}

/** Render worker-provided status text without interpreting it as markup. */
export function renderViewerStatus(
  status: HTMLDivElement,
  message: string,
  loading: boolean,
): void {
  status.replaceChildren()
  if (message) {
    if (loading) {
      const spinner = status.ownerDocument.createElement("i")
      spinner.className = "spinner"
      spinner.setAttribute("aria-hidden", "true")
      status.append(spinner)
    }
    const text = status.ownerDocument.createElement("span")
    text.textContent = message
    status.append(text)
  }
  status.classList.toggle("is-hidden", !message)
}

export class PlateViewer {
  private readonly scene = new Scene()
  private readonly camera = new PerspectiveCamera(36, 1, 0.1, 10000)
  private readonly model = new Group()
  private renderer: WebGLRenderer | null = null
  private webglFailed = false
  private controls: OrbitControls | null = null
  private grid: GridHelper | null = null
  private worker: Worker | null = null
  private projectBytes: ArrayBuffer | null = null
  private workerReady = false
  private pendingPlate: { id: string; objectIds: string[] } | null = null
  private requestedPlateId: string | null = null
  private loadedPlateId: string | null = null
  private requestId = 0
  private status: HTMLDivElement | null = null
  private labels: HTMLDivElement | null = null
  private resizeObserver: ResizeObserver | null = null
  private originalColors = new Map<number, string>()
  private spoolColors = new Map<number, string>()
  private originalMaterialsByFilament = new Map<number, Set<MeshStandardMaterial>>()
  private spoolMaterialsByFilament = new Map<number, Set<MeshStandardMaterial>>()

  constructor() {
    this.scene.background = new Color("#202729")
    this.scene.add(this.model)
    this.scene.add(new AmbientLight("#ffffff", 1.65))
    const key = new DirectionalLight("#ffffff", 2.8)
    key.position.set(1, -1.5, 2.5)
    this.scene.add(key)
    const fill = new DirectionalLight("#b9d8e5", 1.1)
    fill.position.set(-2, 1, 0.8)
    this.scene.add(fill)
    this.camera.up.set(0, 0, 1)
  }

  openProject(bytes: ArrayBuffer): void {
    if (bytes.byteLength > MAX_PROJECT_BYTES) {
      this.closeProject()
      this.setStatus("3D preview unavailable. This project is too large to preview safely.", false)
      return
    }
    this.projectBytes = bytes
    this.pendingPlate = null
    this.startWorker()
    this.loadedPlateId = null
    this.clearModel()
    this.setStatus("Preparing 3MF geometry…", true)
  }

  /** Release the copied 3MF payload and every viewer resource owned by it. */
  closeProject(): void {
    this.worker?.terminate()
    this.worker = null
    this.workerReady = false
    this.projectBytes = null
    this.pendingPlate = null
    this.requestedPlateId = null
    this.loadedPlateId = null
    this.requestId++
    this.clearModel()
    this.setStatus("", false)
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.status = null
    this.labels = null
  }

  private mountFallback(container: HTMLElement, message: string): void {
    container.replaceChildren()
    this.labels = null
    this.status = container.ownerDocument.createElement("div")
    this.status.className = "viewer-status"
    this.status.setAttribute("role", "status")
    container.append(this.status)
    this.setStatus(message, false)
  }

  private startWorker(): void {
    this.worker?.terminate()
    this.worker = new Worker(new URL("./threeMfWorker.ts", import.meta.url), {
      type: "module",
    })
    this.workerReady = false
    this.requestedPlateId = null
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      this.receive(event.data)
    }
    this.worker.onerror = () => {
      this.setStatus("The 3D worker stopped unexpectedly.", false)
    }
    if (this.projectBytes) {
      this.worker.postMessage({ type: "initialize", bytes: this.projectBytes })
    }
  }

  mount(container: HTMLElement): void {
    if (this.webglFailed) {
      this.mountFallback(container, "This browser cannot draw the 3D preview.")
      return
    }
    if (!this.renderer) {
      try {
        this.renderer = new WebGLRenderer({
          antialias: true,
          powerPreference: "high-performance",
        })
      } catch {
        this.webglFailed = true
        this.mountFallback(container, "This browser cannot draw the 3D preview.")
        return
      }
      this.renderer.outputColorSpace = SRGBColorSpace
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
      this.renderer.domElement.setAttribute(
        "aria-label",
        "Linked comparison of original 3MF colors and selected spool colors",
      )
      this.controls = new OrbitControls(this.camera, this.renderer.domElement)
      this.controls.enablePan = true
      this.controls.screenSpacePanning = true
      this.controls.addEventListener("change", () => this.draw())
    }

    container.replaceChildren(this.renderer.domElement)
    this.labels = container.ownerDocument.createElement("div")
    this.labels.className = "viewer-labels"
    this.labels.setAttribute("aria-hidden", "true")
    const originalLabel = container.ownerDocument.createElement("span")
    originalLabel.textContent = "Original 3MF"
    const spoolLabel = container.ownerDocument.createElement("span")
    spoolLabel.textContent = "Your spools"
    this.labels.replaceChildren(originalLabel, spoolLabel)
    container.append(this.labels)
    this.status = container.ownerDocument.createElement("div")
    this.status.className = "viewer-status"
    this.status.setAttribute("role", "status")
    container.append(this.status)
    this.resizeObserver?.disconnect()
    this.resizeObserver = new ResizeObserver(() => this.resize(container))
    this.resizeObserver.observe(container)
    this.resize(container)
    if (this.loadedPlateId) this.setStatus("", false)
    else if (this.pendingPlate) this.setStatus("Preparing 3MF geometry…", true)
  }

  showPlate(id: string | null, objectIds: string[]): void {
    if (!id) {
      this.pendingPlate = null
      this.requestedPlateId = null
      this.clearModel()
      this.setStatus("Select a plate to inspect in 3D.", false)
      return
    }
    this.pendingPlate = { id, objectIds }
    if (this.loadedPlateId === id || this.requestedPlateId === id) return
    if (this.requestedPlateId && this.requestedPlateId !== id) {
      this.startWorker()
      this.setStatus("Switching plate…", true)
      return
    }
    if (!this.workerReady || !this.worker) {
      this.setStatus("Preparing 3MF geometry…", true)
      return
    }
    this.requestedPlateId = id
    const requestId = ++this.requestId
    this.setStatus("Reading plate geometry…", true)
    this.worker.postMessage({ type: "plate", requestId, objectIds })
  }

  setColors(originalColors: Map<number, string>, spoolColors: Map<number, string>): void {
    this.originalColors = originalColors
    this.spoolColors = spoolColors
    for (const [filamentIndex, materials] of this.originalMaterialsByFilament) {
      const color = originalColors.get(filamentIndex) ?? "#D7DADD"
      materials.forEach((material) => material.color.set(color))
    }
    for (const [filamentIndex, materials] of this.spoolMaterialsByFilament) {
      const color = spoolColors.get(filamentIndex) ?? originalColors.get(filamentIndex) ?? "#D7DADD"
      materials.forEach((material) => material.color.set(color))
    }
    this.draw()
  }

  recenter(): void {
    if (this.model.children.length > 0) this.frameModel()
  }

  setView(preset: ViewPreset): void {
    const box = this.modelBox()
    if (!box) return
    this.pointCamera(box, VIEW_PRESETS[preset])
    this.draw()
  }

  private receive(message: WorkerResponse): void {
    if (message.type === "ready") {
      this.workerReady = true
      const pending = this.pendingPlate
      if (pending) {
        this.requestedPlateId = null
        this.showPlate(pending.id, pending.objectIds)
      }
      return
    }
    if (message.type === "progress") {
      if (message.requestId === this.requestId) {
        this.setStatus(message.message, true)
      }
      return
    }
    if (message.type === "error") {
      if (message.requestId === undefined || message.requestId === this.requestId) {
        this.requestedPlateId = null
        const detail = message.message.slice(0, 300)
        this.setStatus(`3D preview unavailable. ${detail}`, false)
      }
      return
    }
    if (message.requestId !== this.requestId) return
    this.buildModel(message.geometries)
    this.loadedPlateId = this.requestedPlateId
    this.requestedPlateId = null
    this.setStatus("", false)
  }

  private buildModel(results: GeometryResult[]): void {
    this.clearModel()
    let triangles = 0
    for (const result of results) {
      const geometry = new BufferGeometry()
      geometry.setAttribute("position", new BufferAttribute(result.positions, 3))
      geometry.setAttribute("normal", new BufferAttribute(result.normals, 3))
      geometry.setIndex(new BufferAttribute(result.indices, 1))
      const originalMaterials = result.groups.map(({ filamentIndex }, materialIndex) => {
        geometry.addGroup(
          result.groups[materialIndex].start,
          result.groups[materialIndex].count,
          materialIndex,
        )
        const material = new MeshStandardMaterial({
          color: this.originalColors.get(filamentIndex) ?? "#D7DADD",
          roughness: 0.72,
          metalness: 0,
        })
        const set =
          this.originalMaterialsByFilament.get(filamentIndex) ?? new Set<MeshStandardMaterial>()
        set.add(material)
        this.originalMaterialsByFilament.set(filamentIndex, set)
        return material
      })
      const spoolMaterials = result.groups.map(({ filamentIndex }) => {
        const material = new MeshStandardMaterial({
          color:
            this.spoolColors.get(filamentIndex) ??
            this.originalColors.get(filamentIndex) ??
            "#D7DADD",
          roughness: 0.72,
          metalness: 0,
        })
        const set =
          this.spoolMaterialsByFilament.get(filamentIndex) ?? new Set<MeshStandardMaterial>()
        set.add(material)
        this.spoolMaterialsByFilament.set(filamentIndex, set)
        return material
      })
      const mesh = new Mesh(geometry, originalMaterials) as ViewerMesh
      mesh.matrixAutoUpdate = false
      mesh.matrix.copy(threeMatrix(result.transform))
      mesh.matrixWorldNeedsUpdate = true
      mesh.userData.objectId = result.rootId
      mesh.userData.partId = result.objectId
      mesh.userData.originalMaterials = originalMaterials
      mesh.userData.spoolMaterials = spoolMaterials
      this.model.add(mesh)
      triangles += result.triangleCount
    }
    this.model.updateWorldMatrix(true, true)
    this.frameModel()
    this.status?.setAttribute("aria-label", `${triangles.toLocaleString()} triangles loaded`)
  }

  private modelBox(): Box3 | null {
    if (this.model.children.length === 0) return null
    const box = new Box3().setFromObject(this.model)
    return box.isEmpty() ? null : box
  }

  /**
   * Camera up stays +Z so OrbitControls keeps orbiting around the plate normal;
   * the axis views only move the eye, and OrbitControls nudges the exactly
   * top-down and bottom-up cases off the pole so orbiting still works.
   */
  private pointCamera(box: Box3, axis: Axis): void {
    const center = box.getCenter(new Vector3())
    const size = box.getSize(new Vector3())
    const radius = Math.max(size.x, size.y, size.z, 1)
    const verticalFov = (this.camera.fov * Math.PI) / 180
    const distance = (radius * 0.62) / Math.tan(verticalFov / 2) / Math.min(this.camera.aspect, 1)
    this.camera.near = Math.max(distance / 1000, 0.01)
    this.camera.far = distance * 20
    this.camera.position
      .set(axis[0], axis[1], axis[2])
      .normalize()
      .multiplyScalar(distance * 1.3)
      .add(center)
    this.camera.updateProjectionMatrix()
    if (this.controls) {
      this.controls.target.copy(center)
      this.controls.minDistance = radius * 0.08
      this.controls.maxDistance = distance * 8
      this.controls.update()
    }
  }

  private frameModel(): void {
    const box = this.modelBox()
    if (!box) {
      this.setStatus("No printable geometry was found on this plate.", false)
      return
    }
    this.pointCamera(box, DEFAULT_VIEW)
    const center = box.getCenter(new Vector3())
    const size = box.getSize(new Vector3())
    const radius = Math.max(size.x, size.y, size.z, 1)

    if (this.grid) this.scene.remove(this.grid)
    const gridSize = Math.max(size.x, size.y, radius) * 1.7
    this.grid = new GridHelper(gridSize, 12, "#d8401f", "#526064")
    this.grid.rotation.x = Math.PI / 2
    this.grid.position.set(center.x, center.y, box.min.z - radius * 0.006)
    this.scene.add(this.grid)
    this.draw()
  }

  private clearModel(): void {
    for (const child of [...this.model.children]) {
      const mesh = child as ViewerMesh
      mesh.geometry?.dispose()
      mesh.userData.originalMaterials.forEach((material) => material.dispose())
      mesh.userData.spoolMaterials.forEach((material) => material.dispose())
      this.model.remove(child)
    }
    this.originalMaterialsByFilament.clear()
    this.spoolMaterialsByFilament.clear()
    this.loadedPlateId = null
    if (this.grid) {
      this.scene.remove(this.grid)
      this.grid.dispose()
      this.grid = null
    }
    this.draw()
  }

  private resize(container: HTMLElement): void {
    if (!this.renderer) return
    const width = Math.max(container.clientWidth, 1)
    const height = Math.max(container.clientHeight, 1)
    this.camera.aspect = Math.max(Math.floor(width / 2), 1) / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
    this.draw()
  }

  private setStatus(message: string, loading: boolean): void {
    if (!this.status) return
    renderViewerStatus(this.status, message, loading)
  }

  private draw(): void {
    if (!this.renderer) return
    const size = this.renderer.getSize(new Vector2())
    const width = Math.max(Math.floor(size.x), 1)
    const height = Math.max(Math.floor(size.y), 1)

    const leftWidth = Math.max(Math.floor(width / 2), 1)
    const rightWidth = Math.max(width - leftWidth, 1)
    this.renderer.setScissorTest(true)

    this.camera.aspect = leftWidth / height
    this.camera.updateProjectionMatrix()
    this.applyMaterials("original")
    this.renderer.setViewport(0, 0, leftWidth, height)
    this.renderer.setScissor(0, 0, leftWidth, height)
    this.renderer.render(this.scene, this.camera)

    this.camera.aspect = rightWidth / height
    this.camera.updateProjectionMatrix()
    this.applyMaterials("spools")
    this.renderer.setViewport(leftWidth, 0, rightWidth, height)
    this.renderer.setScissor(leftWidth, 0, rightWidth, height)
    this.renderer.render(this.scene, this.camera)
    this.renderer.setScissorTest(false)
  }

  private applyMaterials(mode: ColorPass): void {
    for (const child of this.model.children) {
      const mesh = child as ViewerMesh
      mesh.material =
        mode === "original" ? mesh.userData.originalMaterials : mesh.userData.spoolMaterials
    }
  }
}
