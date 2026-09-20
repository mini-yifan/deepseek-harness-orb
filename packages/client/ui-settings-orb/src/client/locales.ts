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
  | 'millifractionTitle'
  | 'millifractionDescription'
  | 'millifractionToggle'
  | 'tccTitle'
  | 'tccDescription'
  | 'tccAppHint'
  | 'tccScreenName'
  | 'tccScreenReason'
  | 'tccScreenPath'
  | 'tccScreenOpen'
  | 'tccAccessibilityName'
  | 'tccAccessibilityReason'
  | 'tccAccessibilityPath'
  | 'tccAccessibilityOpen'
  | 'tccStatusMissing'
  | 'tccStatusGranted'
  | 'tccStatusNeedsRelaunch'
  | 'tccFooter'

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
  overlayTitle: '悬浮球 Agent',
  overlayDescription: '悬浮球 Computer Use 会话使用的模型与思考强度。',
  backgroundTitle: '后台 Agent',
  backgroundDescription: '新建后台 code_agent 会话使用的模型与思考强度。',
  emptyCatalog: '暂无可用模型。',
  defaultEffort: '默认',
  selectionTitle: '划词工具栏',
  selectionDescription: '在其他应用中划选文字后显示搜索、翻译和发给 Agent。',
  selectionToggle: '启用划词工具栏',
  millifractionTitle: '千分比坐标',
  millifractionDescription: '新建 overlay 对话使用截图的 0–1000 比例。关闭后使用已附加图片的像素。更改此项会新建对话。',
  millifractionToggle: '使用千分比坐标',
  tccTitle: 'Mac 权限',
  tccDescription: 'Computer Use 需要屏幕录制与辅助功能。点按钮打开系统设置对应页。',
  tccAppHint: '在列表里打开 {name}。',
  tccScreenName: '屏幕录制',
  tccScreenReason: '让 agent 看见当前窗口。',
  tccScreenPath: '系统设置 → 隐私与安全性 → 屏幕录制',
  tccScreenOpen: '打开「屏幕录制」设置',
  tccAccessibilityName: '辅助功能',
  tccAccessibilityReason: '让 agent 点击和输入。',
  tccAccessibilityPath: '系统设置 → 隐私与安全性 → 辅助功能',
  tccAccessibilityOpen: '打开「辅助功能」设置',
  tccStatusMissing: '未开启',
  tccStatusGranted: '已开启',
  tccStatusNeedsRelaunch: '已开启，请退出后重开',
  tccFooter: '打开开关后必须完全退出 {name} 再打开。只关主窗口无效。',
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
  overlayTitle: 'Floating-ball Agent',
  overlayDescription: 'Model and reasoning effort for the ball\'s Computer Use session.',
  backgroundTitle: 'Background Agent',
  backgroundDescription: 'Model and reasoning effort for new background code_agent sessions.',
  emptyCatalog: 'No models available.',
  defaultEffort: 'Default',
  selectionTitle: 'Selection toolbar',
  selectionDescription: 'After a drag-select in another app, offer Search, Translate, and Send to Agent.',
  selectionToggle: 'Enable the selection toolbar',
  millifractionTitle: 'Millifraction coordinates',
  millifractionDescription: 'New overlay chats use 0–1000 fractions of the screenshot. Turn off to use pixels of the attached image. Changing this creates a new conversation.',
  millifractionToggle: 'Use millifraction coordinates',
  tccTitle: 'Mac permissions',
  tccDescription: 'Computer Use needs Screen Recording and Accessibility. Each button opens that System Settings pane.',
  tccAppHint: 'In the list, turn on {name}.',
  tccScreenName: 'Screen Recording',
  tccScreenReason: 'Lets the agent see the current window.',
  tccScreenPath: 'System Settings → Privacy & Security → Screen Recording',
  tccScreenOpen: 'Open Screen Recording settings',
  tccAccessibilityName: 'Accessibility',
  tccAccessibilityReason: 'Lets the agent click and type.',
  tccAccessibilityPath: 'System Settings → Privacy & Security → Accessibility',
  tccAccessibilityOpen: 'Open Accessibility settings',
  tccStatusMissing: 'Off',
  tccStatusGranted: 'On',
  tccStatusNeedsRelaunch: 'On — quit and reopen',
  tccFooter: 'After you turn the switches on, quit {name} fully, then open it again. Closing the main window does not quit.',
}
