export type Confirmation = {
  title: string
  body: string
  confirmLabel: string
  eyebrow?: string
}

/** A single product-owned confirmation surface for every destructive action. */
export function createConfirmDialog(): (confirmation: Confirmation) => Promise<boolean> {
  const dialog = document.createElement("dialog")
  dialog.className = "confirm-dialog"
  dialog.setAttribute("aria-labelledby", "confirm-dialog-title")
  dialog.setAttribute("aria-describedby", "confirm-dialog-body")
  dialog.innerHTML = `
    <form method="dialog">
      <div class="confirm-dialog-mark" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="confirm-dialog-copy">
        <p class="confirm-dialog-eyebrow"></p>
        <h2 id="confirm-dialog-title"></h2>
        <p id="confirm-dialog-body"></p>
      </div>
      <div class="confirm-dialog-actions">
        <button class="confirm-dialog-cancel" type="submit" value="cancel">Keep it</button>
        <button class="confirm-dialog-submit" type="submit" value="confirm"></button>
      </div>
    </form>`
  document.body.append(dialog)

  const eyebrow = dialog.querySelector<HTMLElement>(".confirm-dialog-eyebrow")!
  const title = dialog.querySelector<HTMLElement>("#confirm-dialog-title")!
  const body = dialog.querySelector<HTMLElement>("#confirm-dialog-body")!
  const submit = dialog.querySelector<HTMLButtonElement>(".confirm-dialog-submit")!
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close("cancel")
  })

  return (confirmation) => {
    if (dialog.open) dialog.close("cancel")
    const previousFocus = document.activeElement as HTMLElement | null
    eyebrow.textContent = confirmation.eyebrow ?? "Saved on this device"
    title.textContent = confirmation.title
    body.textContent = confirmation.body
    submit.textContent = confirmation.confirmLabel
    dialog.returnValue = "cancel"

    return new Promise<boolean>((resolve) => {
      const finish = () => {
        dialog.removeEventListener("close", finish)
        previousFocus?.focus({ preventScroll: true })
        resolve(dialog.returnValue === "confirm")
      }
      dialog.addEventListener("close", finish)
      dialog.showModal()
    })
  }
}
