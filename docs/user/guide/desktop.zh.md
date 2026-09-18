# 使用桌面端

[English](desktop.md) | 中文

桌面端在同一 Desktop Host 上打开 Electron 主窗口，并在 macOS 上再打开一颗悬浮球。主窗口沿用 Web UI，新建会话默认走 standard；悬浮球锁死 Computer Use，其对话和委派编码会话出现在侧栏的 `dsh_orb` 文件夹下。

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

主窗口默认新建 standard 会话，模式选择器保持可用。在这里写代码、改文件、跑命令，和浏览器里的 Web UI 是同一条路径。悬浮球委派出来的后台会话也会出现在侧栏的 `dsh_orb` 下，可以打开、接着聊、停止。球新建或切换 Computer Use 对话时，主窗口保持当前会话。

关掉主窗口不会退出应用。悬浮球出现后 Dock 图标仍在。退出请用 Dock、Cmd+Q，或球右键「退出 DeepSeek Harness」。Dock 图标或悬浮球右键「打开主窗口」可以再打开主窗口。

## 使用 macOS 悬浮球

Host 就绪后才会创建球，出现在主显示器右沿、垂直方向中间稍下。悬停展开与主窗口外观一致的面板，球留在输入胶囊一角。单击固定面板；再点取消固定，指针离开后折叠。拖动移动球并夹在屏幕内，不吸边。面板显示 Compact 对话（与主窗口相同的对话记录）、单行输入（回车发送）、仅 Computer Use 会话运行时出现在输入胶囊里、与球相对一端的停止，以及左上角**历史**以列出并重新打开 `dsh_orb` 上的 Computer Use 对话，历史和新建之间的 **Access** 芯片（仅可查看、工作区内修改或完全权限；完全权限无需确认），右上角**新建**以在该文件夹上再开一条 Computer Use 对话。当 Computer Use agent 向用户提问时，展开面板会显示题目和选项或输入框，可直接在球上作答；Compact 对话留在输入框上方，主窗口仍可回答同一请求。没有发送按钮、模式选择器、语音或圈选。

在其他应用里拖拽划选后，工具条提供**搜索**（默认浏览器打开 Bing）、**翻译**（中文或英文，写入球当前 Computer Use 对话，不附带首帧截图）和 **发给 Agent**（把这段话作为一行 chip 贴在 overlay 输入框外侧；回车把你的指令加上完整原文作为普通 Computer Use 轮次发出，并附带首帧截图）。新建和其他 overlay 按钮会保留 chip，直到这次回车或点 chip 的关闭控件。点三个按钮以外的任意位置、按任意键、右击、中键或滚动都会收起这次的工具条。右键球可关闭工具条。Mac 需要允许辅助功能；第一次读取失败会打开系统设置。

输入框占位符是「向桌面 agent 发送消息…」。发送进入 Computer Use 会话。球默认使用 DeepSeek-V41-Flash、思考模式 Max，直到你在**悬浮球 Agent 设置**或设置 → **悬浮球**里改掉；该选择不会改主窗口新建对话的模型。停止按钮只取消球的 Computer Use 会话，不会停止侧栏里的标准会话。右键球可打开**打开主窗口**、**悬浮球 Agent 设置**和**后台 Agent 设置**（各自独立选择模型与思考强度；后台设置只作用于新建的 `code_agent` 会话）、开启或关闭划词，以及**退出 DeepSeek Harness**；只有明确退出才会结束进程。设置 → **悬浮球**还可自定义 GIF、PNG 或 WebP 球头像（2 MB 上限）并恢复默认；Access、打开主窗口和退出仍只在右键菜单。

球上 Computer Use 的 bash 和文件系统，以及 `dsh_orb` 或其子目录上新建的后台 `code_agent` 会话，跟随球上 Access 芯片（默认完全权限，存为桌面偏好）。点名的、在这棵目录树之外的后台会话留在普通的工作区内修改；该 agent 也会自己应答批准和向用户提问。在主窗口改 Access 后若继续在主窗口聊天，就按改后的权限；从球上发送会把球上芯片写回该 Agent。

## 球如何把任务分给后台

球上的 Computer Use Agent 自己判断当前这句话怎么走，运行时没有单独的分类器：

- 看得见的 GUI（打开微信、在 Pages 里点按钮）只用 GUI 工具（click、input_text、scroll、hotkey、wait、long_wait、screenshot、long_press、drag、open_in_browser、open_in_finder），不调后台 Agent。
- 短查询（今天天气、当前新闻标题）用球上对话里的 web_search 或 web_fetch。它不会启动后台 Agent，也不会在 GUI 里点来点去。
- 长任务（Word、PPT、Excel、网站，或写成 HTML 的调研报告）会启动后台 Code agent。球会告诉你它正在运行，并结束这一轮。
- 需要截图文件时用 screenshot：把捕获写到桌面并复制到剪贴板。
- 同一件后台产物的后续修改（刚写完 Word，再说把字体改成绿色）会在已有标准会话上再发一条消息，即使它还在运行。
- 无关的新后台工作（做完 Word 再做一个五子棋）会再开一条标准会话。

你点名文件夹（桌面、家目录路径）时，那条后台会话就用它。你说这里 / 这个文件夹 / 当前窗口且访达在最前时，它用那个访达文件夹。你说了这些词但访达不在最前时，球会请你去点那个访达窗口或给出路径。否则它会在 `dsh_orb` 下新建一个子目录。如果你点名的文件夹或窗口和球看到的不一致，它会先问你，而不是猜测。

问球现在在跑什么，它只列出这条 Computer Use 对话启动过的后台 agent（数量、最新任务、文件夹、running 或 idle）。新建对话从空列表开始。让它停掉其中一个时，该会话当前回合和已排队的追加都会结束；会话仍在，之后可以续写同一产物。球上的停止仍然只取消 Computer Use。

入队之后，Computer Use agent 会告诉你后台会话正在运行并结束这一轮，因此你可以继续聊天或给它新的 GUI 任务。那条标准会话结束且球空闲后，Computer Use 会汇报后台 agent 做成了什么。

这些后台会话和你在主窗口里打字新建的会话是同一种。文件与终端由那条标准 Agent 使用 bash/fs；球自己的 bash 只留给 GUI 循环里的短命令。

## 限制

悬浮球只做 Mac。Windows 仍在设置里列出「悬浮球」页，但全部控件禁用。没有语音、圈选或逐次点击批准。Computer Use 通过 ScreenCaptureKit 窗口排除，只在那一次截屏里省略球、展开面板和划词工具条，只在那一次 HID 期间让整扇 overlay 点击穿透并隐藏工具条；主窗口始终可被截到、可被点到。Computer Use 包是签名 runtime extra，不是 Desktop Host 的 npm 依赖。

## 继续阅读

- [桌面端 README](../../../apps/desktop/README.zh.md) — 开发变量、打包与更新
- [Computer Use](../../../packages/experimental/tool-computer-use/README.zh.md) — GUI 工具与权限
- [配置模型](./providers.zh.md)
