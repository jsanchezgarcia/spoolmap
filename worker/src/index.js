import { EmailMessage } from "cloudflare:email"
import { handleFeedback } from "./feedback.js"

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === "/api/feedback") {
      return handleFeedback(request, env, (from, to, raw) => new EmailMessage(from, to, raw))
    }
    return env.ASSETS.fetch(request)
  },
}
