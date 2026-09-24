/** Build a 1024 rounded-rectangle Desktop icon from `build/icon-source.png`. */

import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const repoRoot = resolve(packageRoot, '..', '..')
const size = 1024
const radius = Math.round(size * 0.2)
const source = join(packageRoot, 'build', 'icon-source.png')
const output = join(packageRoot, 'build', 'icon.png')
const require = createRequire(join(repoRoot, 'packages/attachment/attachment-local/package.json'))
const sharp = require('sharp')

/**
 * Corner mat around the artwork. Interior whites stay because they do not touch the edge.
 * @param {number} red
 * @param {number} green
 * @param {number} blue
 * @param {number} alpha
 * @returns {boolean}
 */
function isCornerMat(red, green, blue, alpha) {
  return alpha > 200 && red >= 248 && green >= 248 && blue >= 248
}

mkdirSync(dirname(output), { recursive: true })
const { data, info } = await sharp(source)
  .ensureAlpha()
  .resize(size, size, { fit: 'cover' })
  .raw()
  .toBuffer({ resolveWithObject: true })

const pixels = Buffer.from(data)
const width = info.width
const height = info.height
const channels = info.channels
const seen = new Uint8Array(width * height)
const queue = []

/**
 * Queue one edge-connected mat pixel.
 * @param {number} x
 * @param {number} y
 */
function enqueue(x, y) {
  if (x < 0 || y < 0 || x >= width || y >= height) return
  const index = y * width + x
  if (seen[index] === 1) return
  const offset = index * channels
  if (!isCornerMat(pixels[offset], pixels[offset + 1], pixels[offset + 2], pixels[offset + 3])) return
  seen[index] = 1
  pixels[offset + 3] = 0
  queue.push(index)
}

for (let x = 0; x < width; x += 1) {
  enqueue(x, 0)
  enqueue(x, height - 1)
}
for (let y = 0; y < height; y += 1) {
  enqueue(0, y)
  enqueue(width - 1, y)
}

for (let cursor = 0; cursor < queue.length; cursor += 1) {
  const index = queue[cursor]
  const x = index % width
  const y = (index - x) / width
  enqueue(x - 1, y)
  enqueue(x + 1, y)
  enqueue(x, y - 1)
  enqueue(x, y + 1)
}

const mask = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${String(size)}" height="${String(size)}">`
  + `<rect width="${String(size)}" height="${String(size)}" rx="${String(radius)}" ry="${String(radius)}" fill="#fff"/>`
  + '</svg>',
)

await sharp(pixels, { raw: { width, height, channels } })
  .png()
  .composite([{ input: mask, blend: 'dest-in' }])
  .toFile(output)
