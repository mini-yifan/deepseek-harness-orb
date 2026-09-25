/** Desktop main keeps the floating-ball IPC and context-menu arguments wired. */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const main = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/main.ts'), 'utf8')

describe('floating orb main wiring', () => {
  it('registers the shell and Settings handlers the previous orb exposed', () => {
    for (const channel of [
      'floatingOverlayPermissionSet',
      'floatingRunning',
      'floatingEditing',
      'floatingRestoreFront',
      'floatingTccOpen',
      'floatingTccRelaunch',
      'orbSupported',
      'orbSnapshot',
      'orbPickAvatar',
      'orbRestoreAvatar',
      'orbSetOverlayModel',
      'orbSetBackgroundModel',
      'orbSetSelectionEnabled',
      'orbSetMillifractionEnabled',
      'orbOpenTcc',
      'selectionSearch',
      'selectionTranslate',
      'selectionAttach',
      'selectionSetLanguage',
      'selectionInteract',
      'selectionSetContentSize',
    ]) {
      expect(main).toContain(`DESKTOP_IPC.${channel}`)
      expect(main).toContain(`ipcMain.handle(DESKTOP_IPC.${channel}`)
    }
  })

  it('passes model, selection, and millifraction menus into the overlay window', () => {
    expect(main).toContain('loadCatalog: loadFloatingModelCatalog')
    expect(main).toContain('onSelectOverlay: persistOverlayModel')
    expect(main).toContain('onSelectBackground: persistBackgroundModel')
    expect(main).toContain('selectionController?.toggle()')
    expect(main).toContain('confirmMillifractionEnabled')
    expect(main).toContain('createSelectionToolbarWindow')
    expect(main).toContain('selectionController.start()')
    expect(main).toContain('ORB_AVATAR_PATH')
  })
})
