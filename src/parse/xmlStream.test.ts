import { describe, expect, it } from "vitest"
import { createXmlTagReader, forEachXmlTag } from "./xmlStream"

describe("xml tag stream", () => {
  it("walks complete tags without a regular expression", () => {
    const tags: string[] = []
    forEachXmlTag(`noise <vertex x="1"/> mid <triangle v1="0"/>`, (tag) => tags.push(tag))
    expect(tags).toEqual([`<vertex x="1"/>`, `<triangle v1="0"/>`])
  })

  it("reassembles a tag split across chunks without keeping processed text", () => {
    const tags: string[] = []
    const reader = createXmlTagReader(
      64,
      (tag) => tags.push(tag),
      () => new Error("overlong"),
    )
    reader.push("<tri")
    reader.push("angle v1='0'")
    reader.push("/><vertex x='1'/>")
    reader.finish()
    expect(tags).toEqual(["<triangle v1='0'/>", "<vertex x='1'/>"])
  })

  it("rejects an overlong unfinished tag before joining every prefix", () => {
    const reader = createXmlTagReader(
      8,
      () => undefined,
      () => new Error("overlong"),
    )
    expect(() => reader.push(`<${"x".repeat(9)}`)).toThrow("overlong")
  })

  it("rejects leftover text that grows past the tag budget across chunks", () => {
    const reader = createXmlTagReader(
      8,
      () => undefined,
      () => new Error("overlong"),
    )
    reader.push("<abc")
    expect(() => reader.push("defghij")).toThrow("overlong")
  })
})
