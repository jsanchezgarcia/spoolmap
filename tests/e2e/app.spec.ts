import AxeBuilder from "@axe-core/playwright"
import JSZip from "jszip"
import { expect, test, type Page } from "@playwright/test"
import { threeMfFixture } from "../../src/test/threeMfFixture"

test.beforeEach(async ({ page }) => {
  await page.goto("/")
})

async function importFixture(page: Page): Promise<void> {
  const inventory = JSON.stringify([
    {
      id: "red-pla",
      brand: "Fixture",
      material: "PLA",
      material_type: "Basic",
      color: "Signal red",
      rgb: "#ff0000",
      remaining_grams: 750,
    },
    {
      id: "green-petg",
      brand: "Fixture",
      material: "PETG",
      material_type: "Basic",
      color: "Leaf green",
      rgb: "#00ff00",
      remaining_grams: 600,
    },
    {
      id: "blue-petg",
      brand: "Fixture",
      material: "PETG",
      material_type: "Basic",
      color: "Ocean blue",
      rgb: "#0066cc",
      remaining_grams: 500,
    },
    {
      id: "yellow-petg",
      brand: "Fixture",
      material: "PETG",
      material_type: "Basic",
      color: "Warm yellow",
      rgb: "#ffd400",
      remaining_grams: 500,
    },
    {
      id: "black-petg",
      brand: "Fixture",
      material: "PETG",
      material_type: "Basic",
      color: "Carbon black",
      rgb: "#111111",
      remaining_grams: 500,
    },
    {
      id: "white-petg",
      brand: "Fixture",
      material: "PETG",
      material_type: "Basic",
      color: "Paper white",
      rgb: "#f8f8f8",
      remaining_grams: 500,
    },
  ])
  const project = await threeMfFixture({
    model: `<model xmlns:p="fixture"><metadata name="Title">Browser Fixture</metadata><resources><object id="7"><components><component p:path="/3D/Objects/body.model" objectid="20" /></components></object></resources><build><item objectid="7" /></build></model>`,
    extraFiles: {
      "3D/Objects/body.model": `<model><resources><object id="20"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="20" y="0" z="0"/><vertex x="0" y="20" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2" /></triangles></mesh></object></resources></model>`,
    },
  })
  await page.locator('input[data-file="inventory"]').setInputFiles({
    name: "spools.json",
    mimeType: "application/json",
    buffer: Buffer.from(inventory),
  })
  await page.locator('input[data-file="model"]').setInputFiles({
    name: "browser-fixture.3mf",
    mimeType: "application/vnd.ms-package.3dmanufacturing-3dmodel+xml",
    buffer: Buffer.from(project),
  })
  await expect(page.getByRole("heading", { name: "Matches" })).toBeVisible()
}

test("renders the import workflow without horizontal page overflow", async ({ page }) => {
  await expect(
    page.getByRole("heading", { name: "Choose your spools before loading the AMS." }),
  ).toBeVisible()
  await expect(page.getByText("Local-first.", { exact: true })).toBeVisible()
  await expect(page.getByRole("list", { name: "How Spoolmap works" })).toBeVisible()
  await expect(
    page.getByRole("link", { name: /Export JSON from 3DFilamentProfiles/ }),
  ).toHaveAttribute("href", "https://3dfilamentprofiles.com/my/spools")
  await expect(page.getByText(/paste any JSON array of spools/i)).toBeVisible()
  await expect(page.getByRole("button", { name: "Paste JSON" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Try a sample project" })).toBeVisible()
  await expect(page.getByRole("contentinfo")).toContainText("Files stay in this browser")
  await expect(page.getByRole("contentinfo")).toContainText("0.1.0")
  await expect(page.getByRole("contentinfo")).toContainText("not affiliated with Bambu Lab")
  await expect(page.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main")
  await expect(page.getByRole("region", { name: "Spool inventory" })).toBeVisible()
  await expect(page.getByRole("region", { name: "3MF project" })).toBeVisible()
  if ((page.viewportSize()?.width ?? 1000) <= 1120) {
    await expect(page.locator(".drop-hint").first()).toBeHidden()
  }
  await expect(page.getByRole("link", { name: "View source on GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/jsanchezgarcia/spoolmap",
  )

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    viewportHeight: window.innerHeight,
    footerBottom: document.querySelector("footer")?.getBoundingClientRect().bottom ?? 0,
    chooseTop: document.querySelector(".file-action > span")?.getBoundingClientRect().top ?? 0,
    pasteTop: document.querySelector("[data-paste-inventory]")?.getBoundingClientRect().top ?? 0,
  }))
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
  expect(dimensions.footerBottom).toBeGreaterThan(dimensions.viewportHeight - 8)
  expect(Math.abs(dimensions.chooseTop - dimensions.pasteTop)).toBeLessThan(4)
})

test("loads a sample project without asking for files", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-desktop",
    "The sample path is covered once; other projects still exercise the landing CTA.",
  )
  await page.getByRole("button", { name: "Try a sample project" }).click()
  await expect(page.getByRole("heading", { name: "Matches" })).toBeVisible()
  await expect(
    page.locator("#matches").getByText("Sample toadstool", { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: /Download for Bambu Studio or Orca/ }),
  ).toBeEnabled()
  await expect(page.getByText(/ΔE: 0 exact/)).toBeVisible()
})

test("imports a pasted JSON spool list", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop")
  await page.getByRole("button", { name: "Paste JSON" }).click()
  const dialog = page.getByRole("dialog", { name: "Paste a JSON inventory" })
  await expect(dialog).toBeVisible()
  await dialog.getByRole("textbox", { name: "JSON" }).fill(
    JSON.stringify([
      {
        brand: "Pasted",
        material: "PLA",
        color: "Signal red",
        rgb: "#ff0000",
      },
    ]),
  )
  await dialog.getByRole("button", { name: "Use this list" }).click()
  await expect(page.getByRole("region", { name: "Spool inventory" })).toContainText("1 spool")
  await expect(page.getByRole("status")).toContainText("1 spool saved on this device")
})

test("confirms before clearing an open project", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop")
  await importFixture(page)
  await page.getByRole("button", { name: "Clear project" }).click()
  const dialog = page.getByRole("dialog", { name: "Clear project?" })
  await expect(dialog).toBeVisible()
  await dialog.getByRole("button", { name: "Keep it" }).click()
  await expect(page.getByRole("heading", { name: "Matches" })).toBeVisible()

  await page.getByRole("button", { name: "Clear project" }).click()
  await page
    .getByRole("dialog", { name: "Clear project?" })
    .getByRole("button", { name: "Clear project" })
    .click()
  await expect(
    page.getByRole("heading", { name: "Choose your spools before loading the AMS." }),
  ).toBeVisible()
  await expect(page.getByRole("region", { name: "Spool inventory" })).toContainText("6 spools")
})

test("sends feedback without leaving Spoolmap", async ({ page }) => {
  await page.route("**/api/feedback", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }),
  )
  await page.getByRole("button", { name: "Feedback" }).click()
  const dialog = page.getByRole("dialog", { name: "What should work better?" })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole("textbox", { name: /Message/ })).toBeFocused()
  const accessibility = await new AxeBuilder({ page })
    .include(".feedback-dialog")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze()
  expect(accessibility.violations).toEqual([])
  await dialog.getByRole("textbox", { name: /Message/ }).fill("The plate picker is unclear.")
  await dialog.getByRole("button", { name: "Send feedback" }).click()
  await expect(dialog.getByRole("status")).toHaveText("Sent. Thank you.")
})

test("keeps an open spool menu inside the narrow page", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-narrow")
  await importFixture(page)

  await page
    .getByRole("button", { name: /More spools/ })
    .first()
    .click()
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))

  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
  await expect(page.getByRole("listbox").first()).toBeVisible()
})

test("wraps pathological slicer profile names without widening the page", async ({ page }) => {
  const inventory = JSON.stringify([
    {
      id: "white",
      brand: "Fixture",
      material: "PLA",
      material_type: "Basic",
      color: "White",
      rgb: "#ffffff",
    },
  ])
  const project = await threeMfFixture({
    settings: JSON.stringify({
      filament_colour: ["#ffffff"],
      filament_type: ["PLA"],
      filament_vendor: ["Fixture"],
      filament_settings_id: [
        `Fixture white @ Bambu Lab A1 0.2 nozzle ${"(concatenated-source-file.3mf)".repeat(30)}`,
      ],
    }),
  })
  await page.locator('input[data-file="inventory"]').setInputFiles({
    name: "spools.json",
    mimeType: "application/json",
    buffer: Buffer.from(inventory),
  })
  await page.locator('input[data-file="model"]').setInputFiles({
    name: "long-profile.3mf",
    mimeType: "application/vnd.ms-package.3dmanufacturing-3dmodel+xml",
    buffer: Buffer.from(project),
  })
  await expect(page.getByRole("heading", { name: "Matches" })).toBeVisible()

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})

test("materializes spool options only for the open picker", async ({ page }) => {
  await importFixture(page)

  await expect(page.locator(".spool-menu-option")).toHaveCount(0)
  await page
    .getByRole("button", { name: /More spools/ })
    .first()
    .click()
  await expect(page.locator(".spool-menu-option")).toHaveCount(6)
  await page.keyboard.press("Escape")
  await expect(page.locator(".spool-menu-option")).toHaveCount(0)

  await page
    .getByRole("button", { name: /More spools/ })
    .first()
    .click()
  await expect(page.locator(".spool-menu-option")).toHaveCount(6)
})

test("filters a large spool menu without losing keyboard navigation", async ({ page }) => {
  await importFixture(page)

  await page
    .getByRole("button", { name: /More spools/ })
    .first()
    .click()
  const filter = page.getByRole("searchbox", { name: "Filter spools" })
  const trigger = page.getByRole("button", { name: /More spools/ }).first()
  const listbox = page.getByRole("listbox").first()
  const listboxId = await listbox.getAttribute("id")
  await expect(filter).toBeFocused()
  expect(listboxId).not.toBeNull()
  await expect(trigger).toHaveAttribute("aria-controls", listboxId!)
  await expect(listbox.locator(":scope > :not([role='option']):not([role='group'])")).toHaveCount(0)
  await expect(listbox.getByRole("group", { name: /recommended/ })).toBeVisible()

  await filter.fill("ocean petg")
  const visibleOptions = page.locator(".spool-menu-option:visible")
  await expect(visibleOptions).toHaveCount(1)
  await expect(visibleOptions.first()).toContainText("Ocean blue")

  await page.keyboard.press("ArrowDown")
  await expect(visibleOptions.first()).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(page.locator(".spool-menu-option")).toHaveCount(0)
})

test("updates a spool choice without remounting the 3D viewer", async ({ page }) => {
  await importFixture(page)

  const viewer = page.locator("[data-plate-viewer]")
  await expect(viewer).toBeVisible()
  await viewer.evaluate((element) => {
    element.setAttribute("data-test-viewer-instance", "preserved")
  })

  await page.locator(".alternative").nth(1).click()

  await expect(viewer).toHaveAttribute("data-test-viewer-instance", "preserved")
  await expect(page.locator(".alternative").nth(1)).toHaveAttribute("aria-pressed", "true")
})

test("confirms destructive actions without leaving the product UI", async ({ page }) => {
  await importFixture(page)
  const clearInventory = page.getByRole("button", { name: "Clear inventory" })

  await clearInventory.click()
  const dialog = page.getByRole("dialog", { name: "Clear spool inventory?" })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText(
    "This removes the saved inventory from this device. You can import it again anytime.",
  )
  await expect(dialog.getByRole("button", { name: "Keep it" })).toBeFocused()
  await expect(dialog.getByRole("button", { name: "Keep it" })).toHaveCSS("cursor", "pointer")
  await expect(dialog.getByRole("button", { name: "Clear inventory" })).toHaveCSS(
    "cursor",
    "pointer",
  )

  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
  await expect(clearInventory).toBeFocused()
  await expect(page.getByRole("region", { name: "Spool inventory" })).toContainText("6 spools")

  await clearInventory.click()
  await dialog.getByRole("button", { name: "Clear inventory" }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole("status")).toContainText("Spool inventory cleared")
})

test("uses the same confirmation language for saved-project actions", async ({ page }) => {
  await importFixture(page)
  const recents = page.locator(".recent-drawer")
  await expect(recents).toBeVisible()
  await recents.locator("summary").click()

  await page.getByRole("button", { name: /Remove Browser Fixture from saved history/ }).click()
  const removeDialog = page.getByRole("dialog", { name: "Remove saved project?" })
  await expect(removeDialog).toContainText("“Browser Fixture” will be removed from this device.")
  await removeDialog.getByRole("button", { name: "Keep it" }).click()

  await page.getByRole("button", { name: "Clear saved history" }).click()
  const clearDialog = page.getByRole("dialog", { name: "Clear saved projects?" })
  await expect(clearDialog).toContainText(
    "This removes all recent projects and stored 3MF files from this device. Your spool inventory stays.",
  )
  const results = await new AxeBuilder({ page })
    .include(".confirm-dialog")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze()
  expect(results.violations).toEqual([])
  await page.keyboard.press("Escape")
})

test("has no automatically detectable WCAG A or AA violations", async ({ page }) => {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze()

  expect(results.violations).toEqual([])
})

test("keeps the loaded workspace accessible in dark mode", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" })
  await page.reload()
  await importFixture(page)

  await expect(page.locator("html")).toHaveCSS("background-color", "rgb(16, 20, 22)")
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark")
  expect(
    await page.locator(".brand-logo").evaluate((image: HTMLImageElement) => image.currentSrc),
  ).toContain("spoolmap-logo-dark.svg")
  await expect(
    page.locator('meta[name="theme-color"][media="(prefers-color-scheme: dark)"]'),
  ).toHaveAttribute("content", "#101416")
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze()
  expect(results.violations).toEqual([])
})

test("saves imported inventory on this device by default", async ({ page }) => {
  const inventory = JSON.stringify([
    {
      id: "red-pla",
      brand: "Fixture",
      material: "PLA",
      material_type: "Basic",
      color: "Signal red",
      rgb: "#ff0000",
      remaining_grams: 750,
    },
  ])
  await page.locator('input[data-file="inventory"]').setInputFiles({
    name: "spools.json",
    mimeType: "application/json",
    buffer: Buffer.from(inventory),
  })

  await expect(page.getByRole("status")).toContainText("1 spool saved on this device")
  await expect(page.getByRole("button", { name: "Clear inventory" })).toBeVisible()
  await page.reload()
  await expect(page.getByRole("region", { name: "Spool inventory" })).toContainText("1 spool")
})

test("guides a model-only project without broken singular copy", async ({ page }) => {
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  const project = await threeMfFixture({
    settings: JSON.stringify({
      filament_colour: ["#ffffff"],
      filament_type: ["PLA"],
      filament_vendor: ["Fixture"],
      filament_settings_id: ["Fixture white"],
    }),
  })
  await page.locator('input[data-file="model"]').setInputFiles({
    name: "single-color.3mf",
    mimeType: "application/vnd.ms-package.3dmanufacturing-3dmodel+xml",
    buffer: Buffer.from(project),
  })

  await expect(page.getByRole("heading", { name: "Matches" })).toBeVisible()
  await page.getByRole("button", { name: /Whole model/ }).click()
  await expect(page.getByText("No spool to load")).toBeVisible()
  await expect(page.getByRole("button", { name: /1 color still needs a spool/ })).toBeDisabled()
  await expect(page.getByText("1 colors", { exact: false })).toHaveCount(0)
})

test("keeps the loaded workspace usable and accessible at this viewport", async ({ page }) => {
  await importFixture(page)
  await expect(page.locator("canvas").first()).toBeVisible()
  const firstPicker = page.locator(".match-row").first().locator("[data-spool-menu]")
  await firstPicker.click()
  const lastSpool = page.locator(".match-row").first().locator(".spool-menu-option").last()
  await lastSpool.click()
  await expect(page.locator(".match-row").first().locator(".spool-picker-mismatch")).toBeVisible()
  const layout = await page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>(".plate-grid")
    const canvas = document.querySelector<HTMLCanvasElement>("canvas")
    const compactCopy = document.querySelector<HTMLElement>(".inputs.is-compact .station-copy")
    const compactAction = document.querySelector<HTMLElement>(".inputs.is-compact .file-action")
    const copyBox = compactCopy?.getBoundingClientRect()
    const actionBox = compactAction?.getBoundingClientRect()
    return {
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      gridHeight: grid?.getBoundingClientRect().height ?? 0,
      gridScrollWidth: grid?.scrollWidth ?? 0,
      gridClientWidth: grid?.clientWidth ?? 0,
      canvasTouchAction: canvas ? getComputedStyle(canvas).touchAction : "",
      compactControlsOverlap: Boolean(
        copyBox &&
          actionBox &&
          copyBox.left < actionBox.right &&
          copyBox.right > actionBox.left &&
          copyBox.top < actionBox.bottom &&
          copyBox.bottom > actionBox.top,
      ),
      overflowers: [...document.querySelectorAll<HTMLElement>("body *")]
        .filter(
          (element) =>
            element.getBoundingClientRect().right > document.documentElement.clientWidth + 1,
        )
        .slice(0, 8)
        .map((element) => ({
          tag: element.tagName,
          className: element.className,
          right: Math.round(element.getBoundingClientRect().right),
          scrollWidth: element.scrollWidth,
        })),
    }
  })
  expect(layout.pageOverflow, JSON.stringify(layout.overflowers)).toBeLessThanOrEqual(0)
  if ((page.viewportSize()?.width ?? 1000) <= 760) {
    expect(layout.gridHeight).toBeLessThanOrEqual(300)
    expect(layout.canvasTouchAction).toContain("pan-y")
  }
  if ((page.viewportSize()?.width ?? 1000) <= 460) {
    expect(layout.compactControlsOverlap).toBe(false)
  }
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze()
  expect(results.violations).toEqual([])
})

test("imports, validates, exports, and restores a complete plan", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-desktop",
    "The full workflow runs once; responsive projects cover layout and Axe.",
  )

  await importFixture(page)
  await expect(page.getByText("Ready to export", { exact: true })).toBeVisible()
  const downloadButton = page.getByRole("button", {
    name: /Download for Bambu Studio or Orca/,
  })
  await expect(downloadButton).toBeEnabled()

  const secondChoice = page.locator('[data-spool-menu="2"]')
  await expect(secondChoice).toBeVisible()
  await secondChoice.focus()
  await page.keyboard.press("ArrowDown")
  const spoolMenu = page.getByRole("listbox", {
    name: "All spools for design color 2",
  })
  await expect(spoolMenu).toBeVisible()
  await expect(spoolMenu.getByRole("option").first()).toBeFocused()
  await page.keyboard.press("End")
  await expect(spoolMenu.getByRole("option").last()).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(spoolMenu).toBeHidden()
  await expect(secondChoice).toBeFocused()
  await secondChoice.click()
  await expect(spoolMenu.locator(".spool-menu-swatch")).not.toHaveCount(0)
  await spoolMenu.getByRole("option", { name: "No spool selected" }).click()
  await expect(secondChoice).toBeFocused()
  await expect(page.getByText("1 of 2 colors assigned", { exact: true })).toBeVisible()
  await expect(downloadButton).toBeDisabled()

  await secondChoice.click()
  await spoolMenu.locator('[data-select-spool="green-petg"]').click()
  await expect(page.getByText("Ready to export", { exact: true })).toBeVisible()

  const downloadPromise = page.waitForEvent("download")
  await downloadButton.click()
  const download = await downloadPromise
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  const exported = await JSZip.loadAsync(Buffer.concat(chunks))
  const settings = JSON.parse(
    await exported.file("Metadata/project_settings.config")!.async("text"),
  ) as { filament_colour: string[]; filament_multi_colour: string[] }
  expect(settings.filament_colour).toEqual(["#FF0000", "#00FF00"])
  expect(settings.filament_multi_colour).toEqual(["#FF0000", "#00FF00"])
  expect(exported.file("3D/Objects/body.model")).not.toBeNull()
  await expect(page.getByRole("status")).toContainText(
    /downloaded.*confirm the final filament profiles and AMS slots/i,
  )
  await expect(page.locator(".notice")).toHaveCount(0, { timeout: 9_000 })

  await expect(page.getByText(/saved in this browser/)).toBeVisible()
  await page.reload()
  await page.getByRole("button", { name: "Restore Browser Fixture" }).click()
  await expect(page.getByRole("heading", { name: "Matches" })).toBeVisible()
  await expect(page.getByText("Ready to export", { exact: true })).toBeVisible()

  const loadedA11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze()
  expect(loadedA11y.violations).toEqual([])
})

test("downloads on an alternate hosted origin too", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-desktop",
    "The hosted export behavior is independent of viewport coverage.",
  )

  const baseUrl = String(testInfo.project.use.baseURL).replace("127.0.0.1", "0.0.0.0")
  await page.goto(baseUrl)
  await importFixture(page)

  const downloadButton = page.getByRole("button", {
    name: /Download for Bambu Studio or Orca/,
  })
  await expect(downloadButton).toBeEnabled()
  await expect(page.getByRole("button", { name: "More ways to export this project" })).toHaveCount(
    0,
  )

  const downloadPromise = page.waitForEvent("download")
  await downloadButton.click()
  await downloadPromise
  await expect(page.getByRole("status")).toContainText(
    /downloaded.*confirm the final filament profiles and AMS slots/i,
  )
})
