/**
 * Walk complete XML tags in `text` without a regular expression, so a large
 * mesh chunk does not allocate a match list for every tag in one go.
 */
export function forEachXmlTag(text: string, onTag: (tag: string) => void): void {
  let cursor = 0
  while (cursor < text.length) {
    const start = text.indexOf("<", cursor)
    if (start < 0) return
    const end = text.indexOf(">", start + 1)
    if (end < 0) return
    onTag(text.slice(start, end + 1))
    cursor = end + 1
  }
}

/**
 * Incremental tag scanner for streamed 3MF XML. Completed tags are handed to
 * `onTag` and discarded; only the unfinished suffix after the last `>` is
 * retained. Chunks that do not yet contain a `>` are kept as separate pieces
 * and joined once, so a hostile overlong tag cannot go quadratic via `+=`.
 */
export function createXmlTagReader(
  maxTagChars: number,
  onTag: (tag: string) => void,
  overlongError: () => Error,
): { push(text: string): void; finish(text?: string): void } {
  const pending: string[] = []
  let pendingChars = 0

  const flushPending = (): string => {
    if (pending.length === 0) return ""
    const combined = pending.length === 1 ? pending[0] : pending.join("")
    pending.length = 0
    pendingChars = 0
    return combined
  }

  const rejectIfOverlong = (length: number): void => {
    if (length > maxTagChars) {
      pending.length = 0
      pendingChars = 0
      throw overlongError()
    }
  }

  const consume = (text: string): void => {
    const boundary = text.lastIndexOf(">")
    if (boundary < 0) {
      rejectIfOverlong(text.length)
      if (text) {
        pending.push(text)
        pendingChars = text.length
      }
      return
    }
    forEachXmlTag(text.slice(0, boundary + 1), onTag)
    const leftover = text.slice(boundary + 1)
    rejectIfOverlong(leftover.length)
    if (leftover) {
      pending.push(leftover)
      pendingChars = leftover.length
    }
  }

  return {
    push(text: string): void {
      if (!text) return
      if (text.lastIndexOf(">") < 0) {
        pendingChars += text.length
        rejectIfOverlong(pendingChars)
        pending.push(text)
        return
      }
      consume(pending.length ? flushPending() + text : text)
    },
    finish(text = ""): void {
      consume(pending.length || text ? flushPending() + text : text)
      if (pending.length) {
        forEachXmlTag(flushPending(), onTag)
      }
    },
  }
}
