const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
const CENTRAL_DIRECTORY_HEADER_BYTES = 46
const UNCOMPRESSED_SIZE_OFFSET = 24
const FILE_NAME_LENGTH_OFFSET = 28
const EXTRA_FIELD_LENGTH_OFFSET = 30
const COMMENT_LENGTH_OFFSET = 32

/**
 * Rewrites only the ZIP central-directory size declaration for one entry.
 * This keeps the fixture tiny while exercising expansion-limit checks before
 * any entry contents are decompressed.
 */
export function withDeclaredUncompressedSize(
  archive: Uint8Array,
  entryName: string,
  size: number,
): Uint8Array {
  if (!Number.isSafeInteger(size) || size < 0 || size > 0xffff_ffff) {
    throw new Error("The declared ZIP size must fit in an unsigned 32-bit field.")
  }

  const patched = archive.slice()
  const view = new DataView(patched.buffer, patched.byteOffset, patched.byteLength)
  const decoder = new TextDecoder()

  for (let offset = 0; offset <= patched.byteLength - CENTRAL_DIRECTORY_HEADER_BYTES; ) {
    if (view.getUint32(offset, true) !== CENTRAL_DIRECTORY_SIGNATURE) {
      offset++
      continue
    }

    const fileNameLength = view.getUint16(offset + FILE_NAME_LENGTH_OFFSET, true)
    const extraFieldLength = view.getUint16(offset + EXTRA_FIELD_LENGTH_OFFSET, true)
    const commentLength = view.getUint16(offset + COMMENT_LENGTH_OFFSET, true)
    const nameStart = offset + CENTRAL_DIRECTORY_HEADER_BYTES
    const name = decoder.decode(patched.subarray(nameStart, nameStart + fileNameLength))

    if (name === entryName) {
      view.setUint32(offset + UNCOMPRESSED_SIZE_OFFSET, size, true)
      return patched
    }

    offset = nameStart + fileNameLength + extraFieldLength + commentLength
  }

  throw new Error(`ZIP entry not found: ${entryName}`)
}
