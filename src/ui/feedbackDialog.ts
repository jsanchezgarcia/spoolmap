type FeedbackResponse = {
  ok?: boolean
  error?: string
}

/** Product-owned feedback form; messages are emailed and never stored by Spoolmap. */
export function createFeedbackDialog(): () => void {
  const dialog = document.createElement("dialog")
  dialog.className = "feedback-dialog"
  dialog.setAttribute("aria-labelledby", "feedback-dialog-title")
  dialog.innerHTML = `
    <form>
      <div class="feedback-dialog-mark" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="feedback-dialog-copy">
        <p class="feedback-dialog-eyebrow">Field report</p>
        <h2 id="feedback-dialog-title">What should work better?</h2>
        <p class="feedback-dialog-intro">Send a note directly to the person building Spoolmap. Nothing is stored on the site.</p>
        <label class="feedback-field">
          <span>Message</span>
          <textarea name="message" rows="5" maxlength="4000" required></textarea>
        </label>
        <label class="feedback-field">
          <span>Your email <small>Optional, only if you want a reply</small></span>
          <input name="replyTo" type="email" maxlength="254" autocomplete="email">
        </label>
        <label class="feedback-trap" aria-hidden="true">
          Website
          <input name="website" type="text" tabindex="-1" autocomplete="off">
        </label>
        <p class="feedback-dialog-status" role="status" aria-live="polite"></p>
      </div>
      <div class="feedback-dialog-actions">
        <button class="feedback-dialog-cancel" type="button">Cancel</button>
        <button class="feedback-dialog-submit" type="submit">Send feedback</button>
      </div>
    </form>`
  document.body.append(dialog)

  const form = dialog.querySelector<HTMLFormElement>("form")!
  const message = dialog.querySelector<HTMLTextAreaElement>("textarea[name='message']")!
  const cancel = dialog.querySelector<HTMLButtonElement>(".feedback-dialog-cancel")!
  const submit = dialog.querySelector<HTMLButtonElement>(".feedback-dialog-submit")!
  const status = dialog.querySelector<HTMLElement>(".feedback-dialog-status")!

  cancel.addEventListener("click", () => dialog.close())
  dialog.addEventListener("cancel", (event) => {
    if (submit.disabled) event.preventDefault()
  })
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog && !submit.disabled) dialog.close()
  })
  form.addEventListener("submit", async (event) => {
    event.preventDefault()
    if (!form.reportValidity()) return

    submit.disabled = true
    cancel.disabled = true
    submit.innerHTML = '<i class="spinner"></i> Sending…'
    status.textContent = ""

    try {
      const data = new FormData(form)
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: data.get("message"),
          replyTo: data.get("replyTo"),
          website: data.get("website"),
        }),
      })
      const result = (await response.json().catch(() => ({}))) as FeedbackResponse
      if (!response.ok || result.ok !== true) {
        throw new Error(result.error || "Feedback could not be sent.")
      }

      form.reset()
      status.className = "feedback-dialog-status is-success"
      status.textContent = "Sent. Thank you."
      submit.textContent = "Sent"
      window.setTimeout(() => dialog.close(), 900)
    } catch (error) {
      status.className = "feedback-dialog-status is-error"
      status.textContent = error instanceof Error ? error.message : "Feedback could not be sent."
      submit.disabled = false
      cancel.disabled = false
      submit.textContent = "Try again"
    }
  })
  dialog.addEventListener("close", () => {
    if (submit.disabled && submit.textContent !== "Sent") return
    submit.disabled = false
    cancel.disabled = false
    submit.textContent = "Send feedback"
    status.className = "feedback-dialog-status"
    status.textContent = ""
  })

  return () => {
    form.reset()
    status.className = "feedback-dialog-status"
    status.textContent = ""
    dialog.showModal()
    message.focus()
  }
}
