/** Render the floating-ball GIF's first frame as a 1024 rounded-rectangle app icon. */

import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const repoRoot = resolve(packageRoot, '..', '..')
const size = 1024
const radius = Math.round(size * 0.2)
const source = join(packageRoot, 'renderer', 'deepseek-avatar-square.gif')
const output = join(packageRoot, 'build', 'icon.png')
const require = createRequire(join(repoRoot, 'packages/attachment/attachment-local/package.json'))
const sharp = require('sharp')

mkdirSync(dirname(output), { recursive: true })
const mask = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${String(size)}" height="${String(size)}">`
  + `<rect width="${String(size)}" height="${String(size)}" rx="${String(radius)}" ry="${String(radius)}" fill="#fff"/>`
  + '</svg>',
)

await sharp(source, { animated: false, pages: 1 })
  .resize(size, size, { fit: 'cover' })
  .composite([{ input: mask, blend: 'dest-in' }])
  .png()
  .toFile(output)
