# Agent Note: Computer Use 的 macOS HID 发送

Status: implemented

[English](2026-09-13-computer-use-macos-hid.md) | 中文

## 问题

实验性 Computer Use 的 macOS 后端发出的 JXA `CGEvent` 输入看起来成功，但桌面收不到点击或所请求的文本。指针会移到映射点，随后左键按下/抬起要么没有送达，要么短到 AppKit 与 Electron 不把它当成点击。`input_text` 总是插入字母 `a`。热键对一个键盘事件设置修饰键标志，却发送另一个事件。滚动使用可变参数的 `CGEventCreateScrollWheelEvent`，JXA 不能可靠调用它。

JXA 把 CoreGraphics 的 `kCG*` 枚举暴露成字符串，并且无法把 `UniChar *` 传给 `CGEventKeyboardSetUnicodeString`。JavaScript 的 `null` 不是 C 的 `NULL`。虚拟键码 `0` 就是 `a` 键，因此被忽略 unicode 覆盖的键盘事件会打出 `a`。

## 决策

每个 HID 动作写入一个 UTF-8 JXA 文件，并对该文件运行 `/usr/bin/osascript -l JavaScript`。脚本保持 HID 系统状态的 `CGEventSource`，使用数值 CGEvent 类型与 `CGPointMake`，并在移动、按下、抬起之间休眠。双击是两次按下/抬起循环，click-state 先为 1 再为 2。

`input_text` 先点击聚焦，可选发送 Cmd+A，通过 `NSPasteboard` 加 Cmd+V 粘贴，可选按 Enter，并恢复先前的字符串剪贴板。JXA 在读取属性时就会调用无参 ObjC 方法，因此剪贴板的 `clearContents` 不能当成 JavaScript 函数来调用。热键按住修饰键，在同一即将发送的事件上设置标志，然后点按非修饰键。滚动先移到该点，再按每个 `scroll_level` 行刻度发送一次 `CGEventCreateScrollWheelEvent2`。`long_press` 通过 `longPressAt` 按 `durationSeconds` 按住左键。`drag` 通过 `dragFromTo` 在映射点之间插值十次 LeftMouseDragged（类型 6）步进。

## 考虑过的替代方案

**继续用 JavaScript 字符串调用 `CGEventKeyboardSetUnicodeString`。** JXA 接受该调用，但键码 0 仍映射为 `a`。`UniChar` 的 `Ref` 或 `NSData.bytes` 指针会抛出 `Ref has incompatible type`。

**System Events 的 `keystroke`。** 它需要第二项自动化 TCC 权限，而且对许多非拉丁字符串仍然失败。粘贴使用点击已经需要的辅助功能权限。

**按字符使用虚拟键码。** 那张表无法表达 CJK 或 emoji。粘贴按工具的 `text` 原样插入。

**`CGEventCreateScrollWheelEvent`。** 该 C API 是可变参数。`CGEventCreateScrollWheelEvent2` 是 JXA 能调用的非可变参数替代。

**用 MouseMoved（类型 5）插值拖拽路径。** 那只会移动光标。AppKit 与 Electron 收到的是 `mouseMoved:` 而不是 `mouseDragged:`，因此滑块、窗口标题栏和访达图标都不会被拖动。

## 影响

`input_text` 在 Cmd+V 期间覆盖字符串剪贴板，并且只恢复该字符串；其他剪贴板类型不会被恢复。事件内休眠是 HID 时序，不是 `postActionWaitMs`。测试仍然注入 `CommandRunner`，绝不向真实桌面发送事件。

## 测试

`packages/experimental/tool-computer-use/tests/macos.spec.ts` 捕获生成的 JXA，并断言 `clickAt`（含右键双击）、`pasteText` / `selectAll` / `pressEnter`、剪贴板 `clearContents` 作为属性而非 JS 调用、Cmd+C 的 `chord([55,8])`、带符号 `scrollAt` 增量的 `CGEventCreateScrollWheelEvent2`、`longPressAt`、`dragFromTo`，以及类型为 6 的 `postMouse(LEFT_DRAGGED`。空 `text` 不调用 `pasteText`。未知热键仍在 osascript 之前抛错。HID 子进程失败仍然点名辅助功能。
