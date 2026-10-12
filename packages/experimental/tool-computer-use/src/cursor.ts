/**
 * Cursor compositing for the Windows capture path.
 * macOS bakes the real pointer into the raster through `screencapture -x -C`, so the
 * agent can see where its clicks land. Windows `BitBlt` copies the desktop without the
 * cursor layer, so {@link compositeCursor} draws the same pointer into the capture.
 * The placement and blend rules are pure, so they stay testable without Win32.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use/src/cursor
 */

/**
 * Physical pixels of slack outside the capture region. A pointer just past the edge
 * still overlaps it with its bitmap, so it is drawn; farther out the raster is untouched.
 */
export const CURSOR_EDGE_MARGIN = 12

/** Capture-local top-left of the cursor bitmap, in physical pixels. */
export interface CursorPlacement {
  readonly x: number
  readonly y: number
}

/** A point in physical screen pixels. */
export interface CursorPoint {
  readonly x: number
  readonly y: number
}

/** Pixel size of a bitmap. */
export interface CursorSize {
  readonly width: number
  readonly height: number
}

/** A rectangle in physical screen pixels. */
export interface CursorRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** A cursor bitmap exactly as Win32 hands it over, both planes top-down 32-bit BGRA. */
export interface CursorBitmap {
  readonly width: number
  readonly height: number
  /** 32-bit BGRA colour plane, top-down, `width * height * 4` bytes. */
  readonly color: Buffer
  /**
   * 32-bit BGRA AND-mask plane, top-down, when Win32 supplied one. A white pixel keeps
   * the destination; a black pixel paints the colour plane.
   */
  readonly mask?: Buffer
}

/**
 * Reverse the row order of a tightly packed raster in place.
 * `GetDIBits` returns bottom-up rows; every cursor and capture plane is used top-down.
 * @param pixels - raster to reverse, mutated in place.
 * @param rowBytes - bytes per row.
 * @param height - number of rows.
 */
export function flipRows(pixels: Buffer, rowBytes: number, height: number): void {
  if (rowBytes <= 0 || height <= 1) return
  const scratch = Buffer.alloc(rowBytes)
  for (let top = 0, bottom = height - 1; top < bottom; top += 1, bottom -= 1) {
    const topAt = top * rowBytes
    const bottomAt = bottom * rowBytes
    pixels.copy(scratch, 0, topAt, topAt + rowBytes)
    pixels.copy(pixels, topAt, bottomAt, bottomAt + rowBytes)
    scratch.copy(pixels, bottomAt, 0, rowBytes)
  }
}

/**
 * Where the cursor bitmap lands inside a capture region.
 * The pointer is measured against the region grown by `margin`; a pointer farther out
 * returns undefined and the capture is left as `BitBlt` produced it.
 * @param pointer - pointer position in physical screen pixels.
 * @param hotspot - cursor hotspot inside its bitmap.
 * @param size - cursor bitmap size.
 * @param bounds - capture region in physical screen pixels.
 * @param margin - slack outside the region, {@link CURSOR_EDGE_MARGIN} by default.
 * @returns the capture-local top-left, or undefined when the cursor must not be drawn.
 */
export function cursorDrawPlacement(
  pointer: CursorPoint,
  hotspot: CursorPoint,
  size: CursorSize,
  bounds: CursorRect,
  margin: number = CURSOR_EDGE_MARGIN,
): CursorPlacement | undefined {
  if (size.width <= 0 || size.height <= 0) return undefined
  const finite = [
    pointer.x, pointer.y, hotspot.x, hotspot.y, margin,
    bounds.x, bounds.y, bounds.width, bounds.height,
  ]
  if (!finite.every(Number.isFinite)) return undefined
  if (pointer.x < bounds.x - margin || pointer.x > bounds.x + bounds.width + margin) return undefined
  if (pointer.y < bounds.y - margin || pointer.y > bounds.y + bounds.height + margin) return undefined
  return {
    x: Math.round(pointer.x - bounds.x - hotspot.x),
    y: Math.round(pointer.y - bounds.y - hotspot.y),
  }
}

/**
 * Resolve a cursor bitmap to top-down BGRA with a usable alpha channel.
 * A colour plane that carries alpha is used as it is. A legacy cursor whose colour
 * plane is fully transparent falls back to the AND mask: a white mask pixel keeps the
 * destination, a black one paints the colour plane.
 * @param cursor - bitmap from `GetIconInfo`.
 * @returns top-down BGRA pixels, `width * height * 4` bytes.
 */
export function resolveCursorAlpha(cursor: CursorBitmap): Buffer {
  const { width, height, color, mask } = cursor
  const pixels = width * height
  if (pixels <= 0) return Buffer.alloc(0)
  let hasAlpha = false
  for (let index = 3; index < pixels * 4; index += 4) {
    if ((color[index] ?? 0) !== 0) {
      hasAlpha = true
      break
    }
  }
  if (hasAlpha || mask === undefined) return color
  const out = Buffer.alloc(pixels * 4)
  for (let at = 0; at < pixels * 4; at += 4) {
    if ((mask[at] ?? 0) !== 0) continue
    out[at] = color[at] ?? 0
    out[at + 1] = color[at + 1] ?? 0
    out[at + 2] = color[at + 2] ?? 0
    out[at + 3] = 255
  }
  return out
}

/**
 * Alpha-blend one cursor bitmap into a BGRA raster. Pixels outside the target are clipped.
 * @param target - destination BGRA pixels, top-down, mutated in place.
 * @param targetWidth - destination width.
 * @param targetHeight - destination height.
 * @param cursor - top-down BGRA cursor pixels with a resolved alpha channel.
 * @param cursorWidth - cursor width.
 * @param cursorHeight - cursor height.
 * @param at - capture-local top-left for the cursor.
 */
export function compositeCursor(
  target: Buffer,
  targetWidth: number,
  targetHeight: number,
  cursor: Buffer,
  cursorWidth: number,
  cursorHeight: number,
  at: CursorPlacement,
): void {
  if (targetWidth <= 0 || targetHeight <= 0 || cursorWidth <= 0 || cursorHeight <= 0) return
  for (let row = 0; row < cursorHeight; row += 1) {
    const y = at.y + row
    if (y < 0 || y >= targetHeight) continue
    for (let column = 0; column < cursorWidth; column += 1) {
      const x = at.x + column
      if (x < 0 || x >= targetWidth) continue
      const source = (row * cursorWidth + column) * 4
      const alpha = cursor[source + 3] ?? 0
      if (alpha === 0) continue
      const destination = (y * targetWidth + x) * 4
      if (alpha === 255) {
        target[destination] = cursor[source] ?? 0
        target[destination + 1] = cursor[source + 1] ?? 0
        target[destination + 2] = cursor[source + 2] ?? 0
        target[destination + 3] = 255
        continue
      }
      const opacity = alpha / 255
      for (let channel = 0; channel < 3; channel += 1) {
        const under = target[destination + channel] ?? 0
        const over = cursor[source + channel] ?? 0
        target[destination + channel] = Math.round(under * (1 - opacity) + over * opacity)
      }
      target[destination + 3] = 255
    }
  }
}
