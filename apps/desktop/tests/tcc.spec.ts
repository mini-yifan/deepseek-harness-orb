import { describe, expect, it, vi } from 'vitest'
import {
  isTccRight,
  TccController,
  tccReady,
  TCC_SETTINGS_URL,
} from '../src/tcc.ts'

function host(overrides: {
  platform?: NodeJS.Platform
  appName?: string
  screenGranted?: boolean
  accessibilityGranted?: boolean
} = {}) {
  const openExternal = vi.fn(async () => undefined)
  return {
    openExternal,
    controller: new TccController({
      platform: overrides.platform ?? 'darwin',
      appName: () => overrides.appName ?? 'DeepSeek Orb',
      screenGranted: () => overrides.screenGranted === true,
      accessibilityGranted: () => overrides.accessibilityGranted === true,
      openExternal,
    }),
  }
}

describe('TccController', () => {
  it('treats non-Darwin as inapplicable and ready', () => {
    const { controller } = host({ platform: 'win32', screenGranted: false, accessibilityGranted: false })
    const status = controller.status()
    expect(status).toEqual({
      applicable: false,
      appName: 'DeepSeek Orb',
      screen: 'granted',
      accessibility: 'granted',
    })
    expect(tccReady(status)).toBe(true)
  })

  it('reports missing until Settings is opened, then needsRelaunch', async () => {
    const { controller, openExternal } = host()
    expect(controller.status()).toMatchObject({
      applicable: true,
      screen: 'missing',
      accessibility: 'missing',
    })
    expect(tccReady(controller.status())).toBe(false)
    await controller.open('screen')
    expect(openExternal).toHaveBeenCalledWith(TCC_SETTINGS_URL.screen)
    expect(controller.status().screen).toBe('needsRelaunch')
    expect(controller.status().accessibility).toBe('missing')
  })

  it('reports granted when the host probes succeed', async () => {
    const { controller } = host({ screenGranted: true, accessibilityGranted: true })
    await controller.open('accessibility')
    expect(controller.status()).toMatchObject({
      screen: 'granted',
      accessibility: 'granted',
    })
    expect(tccReady(controller.status())).toBe(true)
  })

  it('narrows IPC rights', () => {
    expect(isTccRight('screen')).toBe(true)
    expect(isTccRight('accessibility')).toBe(true)
    expect(isTccRight('finder')).toBe(false)
  })
})
