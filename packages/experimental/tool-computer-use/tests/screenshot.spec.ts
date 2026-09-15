import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FAKE_DESKTOP_PNG } from '../src/fake.ts'
import { pairScreenshotFiles, screenshotFileStem, writeDesktopScreenshots } from '../src/screenshot.ts'

const homes: string[] = []

afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

describe('screenshot files', () => {
  it('stamps a single screen without an index suffix', () => {
    expect(screenshotFileStem(new Date(2026, 8, 15, 20, 10, 0), 0, 1)).toBe(
      'Screenshot 2026-09-15 at 20.10.00',
    )
  })

  it('names each display when several screens are saved', () => {
    expect(screenshotFileStem(new Date(2026, 8, 15, 20, 10, 0), 1, 2)).toBe(
      'Screenshot 2026-09-15 at 20.10.00 (screen 1)',
    )
  })

  it('writes unique PNG files onto Desktop', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-cu-shot-'))
    homes.push(home)
    const now = new Date(2026, 8, 15, 20, 10, 0)
    const first = await writeDesktopScreenshots(
      [{ data: FAKE_DESKTOP_PNG, mediaType: 'image/png', screenIndex: 0 }],
      { home, now },
    )
    expect(first).toEqual([join(home, 'Desktop', 'Screenshot 2026-09-15 at 20.10.00.png')])
    expect(await readFile(first[0]!)).toEqual(Buffer.from(FAKE_DESKTOP_PNG))
    const second = await writeDesktopScreenshots(
      [{ data: FAKE_DESKTOP_PNG, mediaType: 'image/png', screenIndex: 0 }],
      { home, now },
    )
    expect(second).toEqual([join(home, 'Desktop', 'Screenshot 2026-09-15 at 20.10.00 2.png')])
  })

  it('writes jpeg files for jpeg captures', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-cu-shot-jpg-'))
    homes.push(home)
    const jpeg = Uint8Array.of(0xff, 0xd8, 0xff)
    const paths = await writeDesktopScreenshots(
      [
        { data: jpeg, mediaType: 'image/jpeg', screenIndex: 0 },
        { data: jpeg, mediaType: 'image/jpeg', screenIndex: 1 },
      ],
      { home, now: new Date(2026, 8, 15, 8, 5, 9) },
    )
    expect(paths).toEqual([
      join(home, 'Desktop', 'Screenshot 2026-09-15 at 08.05.09 (screen 0).jpg'),
      join(home, 'Desktop', 'Screenshot 2026-09-15 at 08.05.09 (screen 1).jpg'),
    ])
  })

  it('refuses an empty capture list', async () => {
    await expect(writeDesktopScreenshots([], { home: tmpdir() })).rejects.toThrow(/no screenshot files/u)
  })

  it('pairs captures with observation screen indexes', () => {
    expect(pairScreenshotFiles(
      [{ data: FAKE_DESKTOP_PNG, mediaType: 'image/png' }],
      [{ screenIndex: 2 }],
    )).toEqual([{ data: FAKE_DESKTOP_PNG, mediaType: 'image/png', screenIndex: 2 }])
  })

  it('refuses captures and screens of different lengths', () => {
    expect(() => pairScreenshotFiles(
      [{ data: FAKE_DESKTOP_PNG, mediaType: 'image/png' }],
      [{ screenIndex: 0 }, { screenIndex: 1 }],
    )).toThrow(/disagree/u)
  })

  it('refuses a missing screen at a capture index', () => {
    const screens: Array<{ readonly screenIndex: number } | undefined> = [
      undefined,
      { screenIndex: 1 },
    ]
    expect(() => pairScreenshotFiles(
      [
        { data: FAKE_DESKTOP_PNG, mediaType: 'image/png' },
        { data: FAKE_DESKTOP_PNG, mediaType: 'image/png' },
      ],
      screens as Array<{ readonly screenIndex: number }>,
    )).toThrow(/disagree/u)
  })

  it('stamps with the current time when now is omitted', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-cu-shot-now-'))
    homes.push(home)
    const paths = await writeDesktopScreenshots(
      [{ data: FAKE_DESKTOP_PNG, mediaType: 'image/png', screenIndex: 0 }],
      { home },
    )
    expect(paths[0]?.startsWith(join(home, 'Desktop', 'Screenshot '))).toBe(true)
  })

  it('stops after 100 colliding screenshot names', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-cu-shot-unique-'))
    homes.push(home)
    const now = new Date(2026, 8, 15, 20, 10, 0)
    for (let i = 0; i < 100; i += 1) {
      await writeDesktopScreenshots(
        [{ data: FAKE_DESKTOP_PNG, mediaType: 'image/png', screenIndex: 0 }],
        { home, now },
      )
    }
    await expect(writeDesktopScreenshots(
      [{ data: FAKE_DESKTOP_PNG, mediaType: 'image/png', screenIndex: 0 }],
      { home, now },
    )).rejects.toThrow(/unique screenshot filename/u)
  })

  it('fails when Desktop cannot be created', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-cu-shot-denied-'))
    homes.push(home)
    const desktop = join(home, 'Desktop')
    await writeFile(desktop, 'not-a-directory')
    await expect(writeDesktopScreenshots(
      [{ data: FAKE_DESKTOP_PNG, mediaType: 'image/png', screenIndex: 0 }],
      { home },
    )).rejects.toThrow()
  })
})
