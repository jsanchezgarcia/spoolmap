const MAX_MESSAGE_LENGTH = 4000
const MAX_REPLY_LENGTH = 254
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PRODUCTION_ORIGIN = "https://spoolmap.com"
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])
const SENDER_ADDRESS = "feedback@spoolmap.com"

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

function cleanText(value) {
  return typeof value === "string" ? value.replaceAll("\0", "").trim() : ""
}

function isAllowedOrigin(request) {
  const origin = request.headers.get("origin")
  if (!origin) return false

  try {
    const url = new URL(origin)
    return (
      origin === PRODUCTION_ORIGIN || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))
    )
  } catch {
    return false
  }
}

function callerKey(request) {
  return request.headers.get("cf-connecting-ip") || "unknown"
}

export async function handleFeedback(request, env, createEmailMessage) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405)
  if (!isAllowedOrigin(request)) return json({ error: "Origin not allowed." }, 403)
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return json({ error: "Send feedback as JSON." }, 415)
  }

  const declaredSize = Number(request.headers.get("content-length") || 0)
  if (declaredSize > 12_000) return json({ error: "Feedback is too large." }, 413)

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: "Feedback could not be read." }, 400)
  }

  const message = cleanText(body?.message)
  const replyTo = cleanText(body?.replyTo)
  const website = cleanText(body?.website)
  if (website) return json({ ok: true })
  if (!message) return json({ error: "Write a message first." }, 400)
  if (message.length > MAX_MESSAGE_LENGTH) {
    return json({ error: "Keep feedback under 4,000 characters." }, 400)
  }
  if (replyTo.length > MAX_REPLY_LENGTH || (replyTo && !EMAIL_PATTERN.test(replyTo))) {
    return json({ error: "Enter a valid reply email or leave it blank." }, 400)
  }

  const { success } = await env.FEEDBACK_RATE_LIMIT.limit({ key: callerKey(request) })
  if (!success) return json({ error: "Too many messages right now. Try again shortly." }, 429)

  const recipient = cleanText(env.FEEDBACK_RECIPIENT)
  if (!recipient || recipient.length > MAX_REPLY_LENGTH || !EMAIL_PATTERN.test(recipient)) {
    return json({ error: "Feedback could not be sent. Try again shortly." }, 503)
  }

  const headers = [
    `From: Spoolmap feedback <${SENDER_ADDRESS}>`,
    `To: ${recipient}`,
    "Subject: Spoolmap feedback",
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
  ]
  if (replyTo) headers.push(`Reply-To: ${replyTo}`)
  const raw = `${headers.join("\r\n")}\r\n\r\n${message.replaceAll("\n", "\r\n")}\r\n`

  try {
    await env.FEEDBACK_EMAIL.send(createEmailMessage(SENDER_ADDRESS, recipient, raw))
  } catch {
    return json({ error: "Feedback could not be sent. Try again shortly." }, 503)
  }
  return json({ ok: true })
}
