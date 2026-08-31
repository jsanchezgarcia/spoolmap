import { describe, expect, it, vi } from "vitest"
import { handleFeedback } from "./feedback.js"

function request(body, headers = {}) {
  const result = new Request("https://spoolmap.com/api/feedback", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://spoolmap.com",
      "CF-Connecting-IP": "203.0.113.10",
      ...headers,
    },
    body: JSON.stringify(body),
  })
  if (headers.Origin === null) result.headers.delete("Origin")
  return result
}

function environment(allowed = true) {
  return {
    FEEDBACK_RATE_LIMIT: { limit: vi.fn().mockResolvedValue({ success: allowed }) },
    FEEDBACK_EMAIL: { send: vi.fn().mockResolvedValue(undefined) },
    FEEDBACK_RECIPIENT: "owner@example.com",
  }
}

const createEmailMessage = (from, to, raw) => ({ from, to, raw })

describe("feedback endpoint", () => {
  it("emails a valid message without storing it", async () => {
    const env = environment()
    const response = await handleFeedback(
      request({ message: "The plate picker is unclear.", replyTo: "maker@example.com" }),
      env,
      createEmailMessage,
    )

    expect(response.status).toBe(200)
    expect(env.FEEDBACK_EMAIL.send).toHaveBeenCalledOnce()
    expect(env.FEEDBACK_EMAIL.send.mock.calls[0][0].raw).toContain("Reply-To: maker@example.com")
    expect(env.FEEDBACK_EMAIL.send.mock.calls[0][0].raw).toContain("To: owner@example.com")
    expect(env.FEEDBACK_EMAIL.send.mock.calls[0][0].raw).toContain("The plate picker is unclear.")
    expect(env.FEEDBACK_RATE_LIMIT.limit).toHaveBeenCalledWith({ key: "203.0.113.10" })
    expect(response.headers.get("Cache-Control")).toBe("no-store")
  })

  it("rejects invalid input before sending", async () => {
    const env = environment()
    const response = await handleFeedback(
      request({ message: "Hello", replyTo: "not-an-email" }),
      env,
      createEmailMessage,
    )

    expect(response.status).toBe(400)
    expect(env.FEEDBACK_EMAIL.send).not.toHaveBeenCalled()
    expect(env.FEEDBACK_RATE_LIMIT.limit).not.toHaveBeenCalled()
  })

  it("quietly accepts honeypot submissions without sending", async () => {
    const env = environment()
    const response = await handleFeedback(
      request({ message: "Spam", website: "https://spam.example" }),
      env,
      createEmailMessage,
    )

    expect(response.status).toBe(200)
    expect(env.FEEDBACK_EMAIL.send).not.toHaveBeenCalled()
  })

  it("throttles excess messages", async () => {
    const env = environment(false)
    const response = await handleFeedback(request({ message: "Hello" }), env, createEmailMessage)

    expect(response.status).toBe(429)
    expect(env.FEEDBACK_EMAIL.send).not.toHaveBeenCalled()
  })

  it("uses a separate rate-limit key for each caller", async () => {
    const env = environment()

    await handleFeedback(
      request({ message: "First" }, { "CF-Connecting-IP": "203.0.113.20" }),
      env,
      createEmailMessage,
    )
    await handleFeedback(
      request({ message: "Second" }, { "CF-Connecting-IP": "203.0.113.21" }),
      env,
      createEmailMessage,
    )

    expect(env.FEEDBACK_RATE_LIMIT.limit).toHaveBeenNthCalledWith(1, { key: "203.0.113.20" })
    expect(env.FEEDBACK_RATE_LIMIT.limit).toHaveBeenNthCalledWith(2, { key: "203.0.113.21" })
  })

  it.each(["http://localhost:5173", "http://127.0.0.1:4173", "http://[::1]:5173"])(
    "accepts local development origin %s",
    async (origin) => {
      const response = await handleFeedback(
        request({ message: "Hello" }, { Origin: origin }),
        environment(),
        createEmailMessage,
      )

      expect(response.status).toBe(200)
    },
  )

  it.each([
    null,
    "https://example.com",
    "https://spoolmap.com.example.com",
    "https://localhost:5173",
  ])("rejects untrusted origin %s", async (origin) => {
    const headers = { Origin: origin }
    const env = environment()
    const response = await handleFeedback(
      request({ message: "Hello" }, headers),
      env,
      createEmailMessage,
    )

    expect(response.status).toBe(403)
    expect(env.FEEDBACK_RATE_LIMIT.limit).not.toHaveBeenCalled()
    expect(env.FEEDBACK_EMAIL.send).not.toHaveBeenCalled()
  })

  it("fails safely when the feedback recipient secret is unavailable", async () => {
    const env = environment()
    delete env.FEEDBACK_RECIPIENT
    const response = await handleFeedback(request({ message: "Hello" }), env, createEmailMessage)

    expect(response.status).toBe(503)
    expect(env.FEEDBACK_EMAIL.send).not.toHaveBeenCalled()
  })

  it("returns a safe error when delivery fails", async () => {
    const env = environment()
    env.FEEDBACK_EMAIL.send.mockRejectedValue(new Error("provider details"))
    const response = await handleFeedback(request({ message: "Hello" }), env, createEmailMessage)

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: "Feedback could not be sent. Try again shortly.",
    })
  })
})
