import { inventoryFormatExample } from "../sample/inventoryFormat"

type PasteResult = string | null

/** Lets operators paste a JSON spool list when they do not have an export file. */
export function createPasteInventoryDialog(): () => Promise<PasteResult> {
  const dialog = document.createElement("dialog")
  dialog.className = "feedback-dialog"
  dialog.setAttribute("aria-labelledby", "paste-inventory-title")
  dialog.innerHTML = `
    <form method="dialog">
      <div class="feedback-dialog-mark" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="feedback-dialog-copy">
        <p class="feedback-dialog-eyebrow">Spool list</p>
        <h2 id="paste-inventory-title">Paste a JSON inventory</h2>
        <p class="feedback-dialog-intro">A JSON array of spools is enough. Each row needs a color in <code>rgb</code> or <code>hex</code>. <code>brand</code>, <code>material</code>, and <code>color</code> are optional.</p>
        <pre class="inventory-format-example"></pre>
        <label class="feedback-field">
          <span>JSON</span>
          <textarea name="inventory" rows="8" required spellcheck="false" autocomplete="off"></textarea>
        </label>
        <p class="feedback-dialog-status" role="status" aria-live="polite"></p>
      </div>
      <div class="feedback-dialog-actions">
        <button class="feedback-dialog-cancel" type="button" value="cancel">Cancel</button>
        <button class="feedback-dialog-submit" type="submit" value="import">Use this list</button>
      </div>
    </form>`
  document.body.append(dialog)

  const form = dialog.querySelector<HTMLFormElement>("form")!
  const textarea = dialog.querySelector<HTMLTextAreaElement>("textarea[name='inventory']")!
  const example = dialog.querySelector<HTMLElement>(".inventory-format-example")!
  const cancel = dialog.querySelector<HTMLButtonElement>(".feedback-dialog-cancel")!
  const status = dialog.querySelector<HTMLElement>(".feedback-dialog-status")!
  example.textContent = inventoryFormatExample().trim()

  cancel.addEventListener("click", () => dialog.close("cancel"))
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close("cancel")
  })

  return () => {
    if (dialog.open) dialog.close("cancel")
    textarea.value = ""
    status.textContent = ""
    status.className = "feedback-dialog-status"
    dialog.returnValue = "cancel"

    return new Promise<PasteResult>((resolve) => {
      const finish = () => {
        dialog.removeEventListener("close", finish)
        form.removeEventListener("submit", onSubmit)
        resolve(dialog.returnValue === "import" ? textarea.value : null)
      }
      const onSubmit = (event: SubmitEvent) => {
        const action = (event.submitter as HTMLButtonElement | null)?.value ?? "cancel"
        if (action !== "import") return
        event.preventDefault()
        if (!textarea.value.trim()) {
          status.className = "feedback-dialog-status is-error"
          status.textContent = "Paste a JSON array first."
          return
        }
        dialog.close("import")
      }
      form.addEventListener("submit", onSubmit)
      dialog.addEventListener("close", finish)
      dialog.showModal()
      textarea.focus()
    })
  }
}
