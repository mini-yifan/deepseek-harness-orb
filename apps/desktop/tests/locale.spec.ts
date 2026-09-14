import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { en, formatDesktopMessage, resolveDesktopLocale, zh } from '../src/locale.ts'

describe('desktop locale dictionaries', () => {
  it('ships the same key set in English and Chinese', () => {
    expect(Object.keys(zh)).toEqual(Object.keys(en))
    expect(resolveDesktopLocale('zh-Hans-CN')).toEqual({ id: 'zh-CN', messages: zh })
    expect(resolveDesktopLocale('en-US')).toEqual({ id: 'en', messages: en })
    expect(resolveDesktopLocale('fr-FR')).toEqual({ id: 'en', messages: en })
  })

  it('formats named values without consuming unknown placeholders', () => {
    expect(formatDesktopMessage('{name}@{version} {missing}', { name: 'plugin', version: '1.2.3' }))
      .toBe('plugin@1.2.3 {missing}')
  })

  it('owns overlay copy for placeholder, stop, new conversation, history, and disconnect', () => {
    expect(en.floatingNewConversation).toBe('New')
    expect(zh.floatingNewConversation).toBe('新建')
    expect(en.floatingHistory).toBe('History')
    expect(zh.floatingHistory).toBe('历史')
    expect(en.floatingUntitledConversation).toBe('Untitled conversation')
    expect(zh.floatingUntitledConversation).toBe('未命名对话')
    expect(en.floatingHistoryEmpty).toBe('No Computer Use chats yet.')
    expect(zh.floatingHistoryEmpty).toBe('还没有 Computer Use 对话。')
    expect(en).not.toHaveProperty('floatingSend')
    expect(zh).not.toHaveProperty('floatingSend')
  })

  it('keeps visible plugin-manager and floating HTML copy in the locale dictionaries', () => {
    const plugin = readFileSync(new URL('../renderer/plugin-manager.html', import.meta.url), 'utf8')
    const floating = readFileSync(new URL('../renderer/floating.html', import.meta.url), 'utf8')
    const staticText = [...`${plugin}\n${floating}`.matchAll(/>([^<]*\p{L}[^<]*)</gu)].map(match => match[1]?.trim())
    expect(staticText).toEqual([])
  })
})
