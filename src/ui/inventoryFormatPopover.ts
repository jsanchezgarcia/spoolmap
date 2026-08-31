import { inventoryFormatExample } from "../sample/inventoryFormat"

const README_FORMAT_URL = "https://github.com/jsanchezgarcia/spoolmap#inventory-json"

/** Hover or click the landing hint without stretching the import row. */
export function createInventoryFormatPopover(): {
  preview: (anchor: HTMLElement) => void
  toggle: (anchor: HTMLElement) => void
  hide: () => void
  delayHide: () => void
} {
  const popover = document.createElement("div")
  popover.className = "inventory-format-popover"
  popover.id = "inventory-format-popover"
  popover.setAttribute("role", "dialog")
  popover.setAttribute("aria-label", "JSON inventory example")
  popover.hidden = true
  popover.innerHTML = `
    <p>A JSON array of spools is enough. Each row needs <code>rgb</code> or <code>hex</code>. <code>brand</code>, <code>material</code>, and <code>color</code> are optional.</p>
    <pre>${inventoryFormatExample().trim()}</pre>
    <p><a href="${README_FORMAT_URL}" target="_blank" rel="noreferrer">Format notes on GitHub <span aria-hidden="true">↗</span></a></p>`
  document.body.append(popover)

  let pinned = false
  let hideTimer = 0
  let currentAnchor: HTMLElement | null = null

  const markAnchor = (open: boolean): void => {
    currentAnchor?.setAttribute("aria-expanded", open ? "true" : "false")
  }

  const place = (anchor: HTMLElement): void => {
    const gap = 8
    const rect = anchor.getBoundingClientRect()
    popover.hidden = false
    const width = Math.min(popover.offsetWidth || 360, window.innerWidth - 24)
    const left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12)
    const below = rect.bottom + gap
    const above = rect.top - gap - popover.offsetHeight
    const top =
      below + popover.offsetHeight <= window.innerHeight - 12 ? below : Math.max(12, above)
    popover.style.left = `${left}px`
    popover.style.top = `${top}px`
  }

  const show = (anchor: HTMLElement): void => {
    window.clearTimeout(hideTimer)
    if (currentAnchor && currentAnchor !== anchor) markAnchor(false)
    currentAnchor = anchor
    markAnchor(true)
    place(anchor)
  }

  const hide = (): void => {
    window.clearTimeout(hideTimer)
    pinned = false
    markAnchor(false)
    currentAnchor = null
    popover.hidden = true
  }

  const delayHide = (): void => {
    if (pinned) return
    window.clearTimeout(hideTimer)
    hideTimer = window.setTimeout(hide, 160)
  }

  popover.addEventListener("mouseenter", () => window.clearTimeout(hideTimer))
  popover.addEventListener("mouseleave", delayHide)
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !popover.hidden) hide()
  })
  document.addEventListener("pointerdown", (event) => {
    const target = event.target as Node
    if (popover.contains(target) || currentAnchor?.contains(target)) return
    if (!popover.hidden) hide()
  })

  return {
    preview: (anchor) => {
      if (!pinned) show(anchor)
    },
    toggle: (anchor) => {
      if (!popover.hidden && pinned && currentAnchor === anchor) {
        hide()
        return
      }
      pinned = true
      show(anchor)
    },
    hide,
    delayHide,
  }
}
