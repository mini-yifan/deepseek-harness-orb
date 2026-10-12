import { describe, expect, it } from 'vitest'
import {
  compositeCursor,
  CURSOR_EDGE_MARGIN,
  cursorDrawPlacement,
  flipRows,
  resolveCursorAlpha,
} from '../src/cursor.ts'

const bounds = { x: 100, y: 100, width: 800, height: 600 }
const size = { width: 32, height: 32 }
const hotspot = { x: 2, y: 3 }

describe('cursor placement', () => {
  it('lands the bitmap so the hotspot sits on the pointer', () => {
    expect(cursorDrawPlacement({ x: 500, y: 300 }, hotspot, size, bounds)).toEqual({ x: 398, y: 197 })
  })

  it('keeps a pointer just outside the region, because the bitmap still overlaps it', () => {
    expect(cursorDrawPlacement({ x: 100 - CURSOR_EDGE_MARGIN, y: 100 }, hotspot, size, bounds)).toEqual({ x: -14, y: -3 })
    expect(cursorDrawPlacement(
      { x: 900 + CURSOR_EDGE_MARGIN, y: 700 + CURSOR_EDGE_MARGIN },
      hotspot,
      size,
      bounds,
    )).toEqual({ x: 810, y: 609 })
  })

  it('leaves the raster alone when the pointer is past the margin', () => {
    expect(cursorDrawPlacement({ x: 99 - CURSOR_EDGE_MARGIN - 1, y: 300 }, hotspot, size, bounds)).toBeUndefined()
    expect(cursorDrawPlacement({ x: 500, y: 701 + CURSOR_EDGE_MARGIN }, hotspot, size, bounds)).toBeUndefined()
  })

  it('refuses an empty bitmap or a non-finite coordinate', () => {
    expect(cursorDrawPlacement({ x: 500, y: 300 }, hotspot, { width: 0, height: 32 }, bounds)).toBeUndefined()
    expect(cursorDrawPlacement({ x: 500, y: 300 }, hotspot, { width: 32, height: 0 }, bounds)).toBeUndefined()
    expect(cursorDrawPlacement({ x: Number.NaN, y: 300 }, hotspot, size, bounds)).toBeUndefined()
    expect(cursorDrawPlacement({ x: 500, y: 300 }, hotspot, size, { ...bounds, width: Number.POSITIVE_INFINITY })).toBeUndefined()
  })
})

describe('cursor alpha resolution', () => {
  it('keeps a colour plane that already carries alpha', () => {
    const color = Buffer.from([1, 2, 3, 255, 4, 5, 6, 128])
    const resolved = resolveCursorAlpha({ width: 2, height: 1, color })
    expect(resolved).toBe(color)
  })

  it('falls back to the AND mask for a legacy cursor with no alpha', () => {
    const color = Buffer.from([10, 20, 30, 0, 40, 50, 60, 0])
    // A black mask pixel paints the colour plane; a white one keeps the destination.
    const mask = Buffer.from([0, 0, 0, 0, 255, 255, 255, 255])
    const resolved = resolveCursorAlpha({ width: 2, height: 1, color, mask })
    expect([...resolved]).toEqual([10, 20, 30, 255, 0, 0, 0, 0])
  })

  it('draws nothing when a transparent plane has no mask to fall back on', () => {
    const color = Buffer.alloc(8)
    expect([...resolveCursorAlpha({ width: 2, height: 1, color })]).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
  })

  it('returns an empty plane for an empty bitmap', () => {
    expect(resolveCursorAlpha({ width: 0, height: 0, color: Buffer.alloc(0) }).length).toBe(0)
  })
})

describe('row flipping', () => {
  it('reverses bottom-up rows into top-down order', () => {
    const pixels = Buffer.from([
      1, 1, 1, 1,
      2, 2, 2, 2,
      3, 3, 3, 3,
    ])
    flipRows(pixels, 4, 3)
    expect([...pixels]).toEqual([
      3, 3, 3, 3,
      2, 2, 2, 2,
      1, 1, 1, 1,
    ])
  })

  it('keeps a single row and a degenerate stride untouched', () => {
    const single = Buffer.from([1, 2, 3, 4])
    flipRows(single, 4, 1)
    expect([...single]).toEqual([1, 2, 3, 4])
    const empty = Buffer.alloc(0)
    flipRows(empty, 0, 4)
    expect(empty.length).toBe(0)
  })
})

describe('cursor compositing', () => {
  function raster(): Buffer {
    const target = Buffer.alloc(4 * 4 * 4)
    for (let index = 0; index < 16; index += 1) {
      target[index * 4] = 100
      target[index * 4 + 1] = 100
      target[index * 4 + 2] = 100
      target[index * 4 + 3] = 255
    }
    return target
  }

  it('replaces a pixel when the cursor is opaque', () => {
    const target = raster()
    const cursor = Buffer.from([1, 2, 3, 255])
    compositeCursor(target, 4, 4, cursor, 1, 1, { x: 2, y: 1 })
    expect([...target.subarray((1 * 4 + 2) * 4, (1 * 4 + 2) * 4 + 4)]).toEqual([1, 2, 3, 255])
    expect([...target.subarray(0, 4)]).toEqual([100, 100, 100, 255])
  })

  it('blends a partially transparent pixel over the desktop', () => {
    const target = raster()
    const cursor = Buffer.from([200, 0, 0, 128])
    compositeCursor(target, 4, 4, cursor, 1, 1, { x: 0, y: 0 })
    expect([...target.subarray(0, 4)]).toEqual([150, 50, 50, 255])
  })

  it('skips fully transparent pixels and clips what falls outside the raster', () => {
    const target = raster()
    const cursor = Buffer.from([
      0, 0, 0, 0, 1, 1, 1, 255,
      2, 2, 2, 255, 3, 3, 3, 255,
    ])
    compositeCursor(target, 4, 4, cursor, 2, 2, { x: -1, y: -1 })
    // Only the bottom-right cursor pixel survives the clip, landing on the target origin.
    expect([...target.subarray(0, 4)]).toEqual([3, 3, 3, 255])
    const clipped = raster()
    compositeCursor(clipped, 4, 4, cursor, 2, 2, { x: 2, y: 2 })
    // The transparent top-left pixel leaves the desktop alone; the rest land in the corner.
    expect([...clipped.subarray(10 * 4, 10 * 4 + 4)]).toEqual([100, 100, 100, 255])
    expect([...clipped.subarray(11 * 4, 11 * 4 + 4)]).toEqual([1, 1, 1, 255])
    expect([...clipped.subarray(14 * 4, 14 * 4 + 4)]).toEqual([2, 2, 2, 255])
    expect([...clipped.subarray(15 * 4, 15 * 4 + 4)]).toEqual([3, 3, 3, 255])
  })

  it('does nothing for a degenerate raster or cursor', () => {
    const target = raster()
    const before = [...target]
    compositeCursor(target, 0, 4, Buffer.alloc(4), 1, 1, { x: 0, y: 0 })
    compositeCursor(target, 4, 4, Buffer.alloc(0), 0, 0, { x: 0, y: 0 })
    expect([...target]).toEqual(before)
  })
})
