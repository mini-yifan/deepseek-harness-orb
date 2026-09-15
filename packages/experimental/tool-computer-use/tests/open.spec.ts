import { mkdir, mkdtemp, realpath, writeFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  browserUrlHasCjkPercentEncoding,
  isForbiddenOpenPath,
  requireBrowserUrl,
  requireLongPressDuration,
  resolveFinderOpen,
} from '../src/open.ts'

const homes: string[] = []

afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

describe('long_press duration', () => {
  it('defaults to 3 and rejects values outside 1–10', () => {
    expect(requireLongPressDuration(undefined)).toBe(3)
    expect(requireLongPressDuration(1)).toBe(1)
    expect(requireLongPressDuration(10)).toBe(10)
    expect(() => requireLongPressDuration(0.9)).toThrow(/1 to 10/u)
    expect(() => requireLongPressDuration(10.1)).toThrow(/1 to 10/u)
    expect(() => requireLongPressDuration(Number.NaN)).toThrow(/1 to 10/u)
  })
})

describe('browser URLs', () => {
  it('rejects CJK percent-encoding and allows plain CJK and %20', () => {
    expect(browserUrlHasCjkPercentEncoding('https://example.com/search/%E5%88%98%E8%B0%A6')).toBe(true)
    expect(browserUrlHasCjkPercentEncoding('https://example.com/search?q=%E8%B6%85')).toBe(true)
    expect(browserUrlHasCjkPercentEncoding('https://example.com/search/刘谦')).toBe(false)
    expect(browserUrlHasCjkPercentEncoding('https://example.com/search?q=刘谦')).toBe(false)
    expect(browserUrlHasCjkPercentEncoding('https://example.com/search?q=hello%20world')).toBe(false)
    expect(browserUrlHasCjkPercentEncoding('')).toBe(false)
  })

  it('adds https and refuses non-http schemes and userinfo', () => {
    expect(requireBrowserUrl('www.bilibili.com')).toBe('https://www.bilibili.com')
    expect(requireBrowserUrl('https://example.com/search/刘谦')).toBe('https://example.com/search/刘谦')
    expect(() => requireBrowserUrl('https://example.com/%E5%88%98')).toThrow(/plain CJK/u)
    expect(() => requireBrowserUrl('ftp://example.com')).toThrow(/http\(s\)/u)
    expect(() => requireBrowserUrl('https://[')).toThrow(/valid http\(s\)/u)
    expect(() => requireBrowserUrl('https://user:pass@example.com')).toThrow(/userinfo/u)
    expect(() => requireBrowserUrl('   ')).toThrow(/non-empty/u)
  })
})

describe('finder paths', () => {
  it('blacklists system prefixes', () => {
    expect(isForbiddenOpenPath('/etc')).toBe(true)
    expect(isForbiddenOpenPath('/etc/passwd')).toBe(true)
    expect(isForbiddenOpenPath('/private/etc')).toBe(true)
    expect(isForbiddenOpenPath('/usr/bin')).toBe(true)
    expect(isForbiddenOpenPath('/Users/test/Desktop')).toBe(false)
  })

  it('resolves omitted path to Desktop and expands ~', async () => {
    const home = await mkdtemp(join(homedir(), 'dsh-cu-open-home-'))
    homes.push(home)
    const desktop = join(home, 'Desktop')
    const nested = join(desktop, 'notes.txt')
    await mkdir(desktop)
    await writeFile(nested, 'hi\n')
    await expect(resolveFinderOpen(undefined, false, home)).resolves.toEqual({
      path: await realpath(desktop),
      revealOnly: false,
    })
    await expect(resolveFinderOpen('~/Desktop/notes.txt', true, home)).resolves.toEqual({
      path: await realpath(nested),
      revealOnly: true,
    })
  })

  it('rejects missing and blacklisted paths', async () => {
    await expect(resolveFinderOpen('/no/such/computer-use-path', false)).rejects.toThrow(/does not exist/u)
    await expect(resolveFinderOpen('/etc', false)).rejects.toThrow(/system path is forbidden/u)
  })
})
