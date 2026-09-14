# 使用桌面端

[English](desktop.md) | 中文

桌面端在同一 Desktop Host 上打开 Electron 主窗口，并在 macOS 上再打开一颗悬浮球。主窗口沿用 Web UI，新建会话默认走 standard；悬浮球锁死 Computer Use，并把后台编码委派成侧栏里可见的标准会话。

## 启动前准备

从仓库根目录安装依赖。需要 Node.js `^22.19 || >=24` 与仓库锁定的 pnpm `11.7.0`：

```sh
pnpm install
```

模型调用需要 [DeepSeek API 密钥](https://platform.deepseek.com/)。悬浮球只在 macOS 创建；Windows 仍只有主窗口。Computer Use 截屏需要屏幕录制权限，点击与输入需要辅助功能权限；系统不会替你弹出授权框。

## 从源码启动

在仓库根目录执行：

```sh
pnpm run dev:desktop
```

该命令会构建 Host、客户端、Web 前端和 Electron 壳，投影一次性开发项目，然后启动未打包的 Electron。已经构建过时，可用下面这条跳过构建：

```sh
pnpm run start:desktop
```

启动成功后，主窗口先显示「正在启动 DeepSeek Harness…」，Host 就绪后载入 Web UI。macOS 上还会出现一颗始终置顶的圆形悬浮球。开发模式默认把 Harness home 写到 `apps/desktop/.desktop-build/development/home`，不会改你日常 CLI 使用的 `$DSH_HOME`。启动前 `export DEEPSEEK_API_KEY=…` 会传给 Host；也可以启动后在主窗口里保存密钥。

## 配置密钥与工作区

主窗口与 [Web UI](./index.zh.md) 相同：打开**设置 → 模型**，输入密钥并保存。点击**选择工作区**，添加要操作的项目目录。未选中工作区时，会话输入框不可用。

## 使用主窗口

主窗口默认新建 standard 会话，模式选择器保持可用。在这里写代码、改文件、跑命令，和浏览器里的 Web UI 是同一条路径。悬浮球委派出来的后台会话也会出现在侧栏，可以打开、接着聊、停止。球自己的 Computer Use 会话不会出现在侧栏。

关掉主窗口不会退出应用。悬浮球出现后 Dock 图标仍在。退出请用 Dock、Cmd+Q，或球右键「退出 DeepSeek Harness」。Dock 图标或悬浮球右键「打开主窗口」可以再打开主窗口。

## 使用 macOS 悬浮球

Host 就绪后才会创建球。把球拖到屏幕边缘会贴边。单击展开面板，再点收起。面板只有 transcript、输入框和停止按钮；没有模式选择器、语音、划词或圈选。

输入框占位符是「向桌面 agent 发送消息…」。发送后，球会话使用 Computer Use 与视觉模型。停止按钮只取消球的 Computer Use 会话，不会停止侧栏里的标准会话。右键菜单提供「打开主窗口」和「退出 DeepSeek Harness」；只有明确退出才会结束进程。

## 球如何把任务分给后台

球上的 Computer Use Agent 自己判断当前这句话怎么走，运行时没有单独的分类器：

- 看得见的 GUI（打开微信、在 Pages 里点按钮）只用 click / input_text / scroll / hotkey / wait，不调后台 Agent。
- 同一件后台产物的后续修改（刚写完 Word，再说把字体改成绿色）会在已有标准会话上再发一条消息。
- 无关的新后台工作（做完 Word 再做一个五子棋）会新建一条空白标准会话。

这些后台会话和你在主窗口里打字新建的会话是同一种。文件与终端由那条标准 Agent 使用 bash/fs；球自己的 bash 只留给 GUI 循环里的短命令。

## 限制

悬浮球只做 Mac。没有语音、划词、圈选、拖拽或逐次点击批准。Electron `contentProtection` 会把桌面 chrome 从截屏里藏起；没有 ScreenCaptureKit 窗口排除。Computer Use 包是签名 runtime extra，不是 Desktop Host 的 npm 依赖。

## 继续阅读

- [桌面端 README](../../../apps/desktop/README.zh.md) — 开发变量、打包与更新
- [Computer Use](../../../packages/experimental/tool-computer-use/README.zh.md) — GUI 工具与权限
- [配置模型](./providers.zh.md)
