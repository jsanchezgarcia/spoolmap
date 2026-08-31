/** Pull a JSON string array that follows a key in Bambu/Orca project_settings.config. */
export function extractStringArray(source: string, key: string): string[] {
  try {
    const parsed: unknown = JSON.parse(source)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const value = (parsed as Record<string, unknown>)[key]
      return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : []
    }
  } catch {
    // Some older slicer files use `key = [...]` lines instead of JSON.
  }

  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const ini = source.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*=\\s*(\\[[^\\n]*\\])`))
  return ini?.[1] ? parseJsonStringArray(ini[1]) : []
}

function parseJsonStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.map((item) => String(item))
  } catch {
    // fall through to a tolerant scanner
  }
  const result: string[] = []
  const re = /"((?:\\.|[^"\\])*)"/g
  let match: RegExpExecArray | null
  while ((match = re.exec(raw))) {
    result.push(match[1].replace(/\\"/g, '"'))
  }
  return result
}
