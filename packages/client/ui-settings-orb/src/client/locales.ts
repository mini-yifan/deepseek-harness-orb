/** Locale bundles for the Desktop floating-ball Settings page. */

/** Locale keys this section renders. */
export type OrbSettingsKey =
  | 'nav'
  | 'sectionIntro'
  | 'macosOnly'
  | 'unavailable'
  | 'error'
  | 'retry'
  | 'avatarTitle'
  | 'avatarDescription'
  | 'avatarAlt'
  | 'chooseImage'
  | 'restoreDefault'
  | 'tooLarge'
  | 'invalidType'
  | 'overlayTitle'
  | 'overlayDescription'
  | 'backgroundTitle'
  | 'backgroundDescription'
  | 'emptyCatalog'
  | 'defaultEffort'
  | 'selectionTitle'
  | 'selectionDescription'
  | 'selectionToggle'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh: Record<OrbSettingsKey, string> = {
  nav: '悬浮球',
  sectionIntro: '更改立即作用于 macOS 悬浮球。头像支持 GIF、PNG 或 WebP，建议不超过 2 MB。',
  macosOnly: '悬浮球仅 macOS 可用。',
  unavailable: '当前窗口无法读取桌面悬浮球设置。',
  error: '无法加载悬浮球设置。',
  retry: '重试',
  avatarTitle: '悬浮球头像',
  avatarDescription: '选择一张 GIF、PNG 或 WebP 图片。恢复默认会重新使用自带头像。',
  avatarAlt: '悬浮球头像预览',
  chooseImage: '选择图片',
  restoreDefault: '恢复默认',
  tooLarge: '图片超过 2 MB。',
  invalidType: '请选择 GIF、PNG 或 WebP 图片。',
  overlayTitle: '叠加 Agent',
  overlayDescription: '悬浮球 Computer Use 会话使用的模型与思考强度。',
  backgroundTitle: '后台 Agent',
  backgroundDescription: '新建后台 code_agent 会话使用的模型与思考强度。',
  emptyCatalog: '暂无可用模型。',
  defaultEffort: '默认',
  selectionTitle: '划词工具栏',
  selectionDescription: '在其他应用中划选文字后显示搜索、翻译和发给 Agent。',
  selectionToggle: '启用划词工具栏',
}

/** English dictionary, checked complete against the zh key set. */
export const en: Record<OrbSettingsKey, string> = {
  nav: 'Floating ball',
  sectionIntro: 'Changes apply immediately to the macOS floating ball. The avatar accepts GIF, PNG, or WebP, with a suggested 2 MB cap.',
  macosOnly: 'The floating ball is available only on macOS.',
  unavailable: 'This window cannot read Desktop floating-ball settings.',
  error: 'Could not load floating-ball settings.',
  retry: 'Retry',
  avatarTitle: 'Ball image',
  avatarDescription: 'Choose a GIF, PNG, or WebP image. Restore default reuses the shipped avatar.',
  avatarAlt: 'Floating-ball image preview',
  chooseImage: 'Choose image',
  restoreDefault: 'Restore default',
  tooLarge: 'The image is larger than 2 MB.',
  invalidType: 'Choose a GIF, PNG, or WebP image.',
  overlayTitle: 'Overlay Agent',
  overlayDescription: 'Model and reasoning effort for the ball\'s Computer Use session.',
  backgroundTitle: 'Background Agent',
  backgroundDescription: 'Model and reasoning effort for new background code_agent sessions.',
  emptyCatalog: 'No models available.',
  defaultEffort: 'Default',
  selectionTitle: 'Selection toolbar',
  selectionDescription: 'After a drag-select in another app, offer Search, Translate, and Send to Agent.',
  selectionToggle: 'Enable the selection toolbar',
}
