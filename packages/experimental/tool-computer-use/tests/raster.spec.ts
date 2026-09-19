import { describe, expect, it } from 'vitest'
import { FAKE_DESKTOP_PNG, FAKE_WINDOW_PNG } from '../src/fake.ts'
import {
  isUsableObservationRaster,
  MIN_USABLE_OBSERVATION_EDGE,
  observationRasterSize,
} from '../src/raster.ts'

function pngHeader(width: number, height: number, type = 'IHDR'): Uint8Array {
  const data = new Uint8Array(24)
  data.set(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), 0)
  data.set(Uint8Array.from(type, char => char.charCodeAt(0)), 12)
  data[16] = (width >>> 24) & 0xff
  data[17] = (width >>> 16) & 0xff
  data[18] = (width >>> 8) & 0xff
  data[19] = width & 0xff
  data[20] = (height >>> 24) & 0xff
  data[21] = (height >>> 16) & 0xff
  data[22] = (height >>> 8) & 0xff
  data[23] = height & 0xff
  return data
}

function jpegSof(
  width: number,
  height: number,
  options: {
    readonly marker?: number
    readonly prefix?: Uint8Array
    readonly stuffing?: boolean
    readonly sofLength?: number
    readonly truncateAfterMarker?: boolean
  } = {},
): Uint8Array {
  const marker = options.marker ?? 0xc0
  const prefix = options.prefix ?? Uint8Array.of()
  const stuffing = options.stuffing === true ? Uint8Array.of(0xff) : Uint8Array.of()
  const sofLength = options.sofLength ?? 11
  const head = Uint8Array.of(0xff, 0xd8, ...prefix, ...stuffing, 0xff, marker)
  if (options.truncateAfterMarker === true) return head
  const segment = Uint8Array.of(
    (sofLength >> 8) & 0xff, sofLength & 0xff,
    0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
  )
  const data = new Uint8Array(head.length + segment.length)
  data.set(head, 0)
  data.set(segment.subarray(0, Math.min(segment.length, Math.max(0, sofLength))), head.length)
  return data
}

describe('observation raster headers', () => {
  it('reads the 1×1 fixture PNG and rejects it as unusable', () => {
    expect(observationRasterSize(FAKE_DESKTOP_PNG)).toEqual({ width: 1, height: 1 })
    expect(isUsableObservationRaster(FAKE_DESKTOP_PNG)).toBe(false)
    expect(MIN_USABLE_OBSERVATION_EDGE).toBe(2)
  })

  it('accepts a 3×3 PNG and a 2×2 JPEG', () => {
    expect(observationRasterSize(FAKE_WINDOW_PNG)).toEqual({ width: 3, height: 3 })
    expect(isUsableObservationRaster(FAKE_WINDOW_PNG)).toBe(true)
    const jpeg = jpegSof(2, 2)
    expect(observationRasterSize(jpeg)).toEqual({ width: 2, height: 2 })
    expect(isUsableObservationRaster(jpeg)).toBe(true)
    expect(observationRasterSize(jpegSof(2, 2, { marker: 0xc2 }))).toEqual({ width: 2, height: 2 })
    expect(observationRasterSize(jpegSof(2, 2, {
      prefix: Uint8Array.of(0xff, 0xe0, 0x00, 0x04, 0x00, 0x00),
    }))).toEqual({ width: 2, height: 2 })
    expect(observationRasterSize(jpegSof(2, 2, { stuffing: true }))).toEqual({ width: 2, height: 2 })
    expect(observationRasterSize(Uint8Array.of(
      0xff, 0xd8, 0xff, 0xd0, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x02, 0x00, 0x02, 0x01, 0x01, 0x11, 0x00,
    ))).toEqual({ width: 2, height: 2 })
    expect(observationRasterSize(Uint8Array.of(
      0xff, 0xd8, 0xff, 0x01, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x02, 0x00, 0x02, 0x01, 0x01, 0x11, 0x00,
    ))).toEqual({ width: 2, height: 2 })
    expect(observationRasterSize(Uint8Array.of(
      0xff, 0xd8, 0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x02, 0x00, 0x02, 0x01, 0x01, 0x11, 0x00,
    ))).toEqual({ width: 2, height: 2 })
  })

  it('rejects a 1×1 JPEG, truncated bytes, and non-image data', () => {
    expect(isUsableObservationRaster(jpegSof(1, 1))).toBe(false)
    expect(observationRasterSize(Uint8Array.of(1, 2, 3))).toBeUndefined()
    expect(isUsableObservationRaster(Uint8Array.of(1, 2, 3))).toBe(false)
    expect(observationRasterSize(FAKE_DESKTOP_PNG.subarray(0, 16))).toBeUndefined()
    const wrongSig = pngHeader(3, 3)
    wrongSig[3] = 0x00
    expect(observationRasterSize(wrongSig)).toBeUndefined()
    expect(observationRasterSize(pngHeader(3, 3, 'IEND'))).toBeUndefined()
    expect(observationRasterSize(pngHeader(0, 2))).toBeUndefined()
    expect(observationRasterSize(pngHeader(2, 0))).toBeUndefined()
    expect(observationRasterSize(Uint8Array.of(0xff, 0xd8, 0x00, 0xc0))).toBeUndefined()
    expect(observationRasterSize(Uint8Array.of(0xff, 0xd8, 0xff, 0xff))).toBeUndefined()
    expect(observationRasterSize(Uint8Array.of(0xff, 0xd8, 0xff, 0xd9))).toBeUndefined()
    expect(observationRasterSize(Uint8Array.of(0xff, 0xd8, 0xff, 0xda))).toBeUndefined()
    expect(observationRasterSize(jpegSof(2, 2, { truncateAfterMarker: true }))).toBeUndefined()
    expect(observationRasterSize(Uint8Array.of(0xff, 0xd8, 0xff, 0xc0, 0x00, 0x01))).toBeUndefined()
    expect(observationRasterSize(Uint8Array.of(0xff, 0xd8, 0xff, 0xc0, 0x00, 0x08, 0x08))).toBeUndefined()
    expect(observationRasterSize(jpegSof(2, 2, { sofLength: 6 }))).toBeUndefined()
    expect(observationRasterSize(jpegSof(2, 0))).toBeUndefined()
    expect(observationRasterSize(jpegSof(0, 2))).toBeUndefined()
    expect(observationRasterSize(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00))).toBeUndefined()
    expect(observationRasterSize(jpegSof(2, 2, { marker: 0xc4, prefix: Uint8Array.of() }))).toBeUndefined()
    expect(observationRasterSize(Uint8Array.of(
      0xff, 0xd8, 0xff, 0xc4, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x02, 0x00, 0x02, 0x01, 0x01, 0x11, 0x00,
    ))).toEqual({ width: 2, height: 2 })
    expect(observationRasterSize(jpegSof(2, 2, { marker: 0xc8 }))).toBeUndefined()
    expect(observationRasterSize(jpegSof(2, 2, { marker: 0xcc }))).toBeUndefined()
    expect(observationRasterSize(Uint8Array.of(0xff, 0x00, 0xff, 0xc0))).toBeUndefined()
    expect(observationRasterSize(Uint8Array.of(0xff, 0xd8))).toBeUndefined()
    expect(observationRasterSize(Uint8Array.of(0xff, 0xd8, 0xff, 0x02, 0x00, 0x04, 0x00, 0x00))).toBeUndefined()
  })
})
