# 无证书 macOS arm64 预览打包备忘

本地打 DeepSeek Orb 预览包时用这份。正式带证书发布仍看 [apps/desktop/README.md](README.md) 的 Package 节，以及 [Electron 打包 Agent Note](../../.agents/notes/implemented/architecture/2026-08-25-electron-desktop-packaging-and-updates.md)。

这条路径**不是发布通道**：产物进 `unsigned-artifacts/`，不写发布完成记录，`upload:*` 会因缺记录失败。不要提交 DMG / `.app`，不要上传。

---

## 1. 每次怎么打

在仓库根目录：

```sh
export DSH_DESKTOP_APP_ID="${DSH_DESKTOP_APP_ID:-ai.deepseek.orb}"
export NODE_OPTIONS="--use-system-ca${NODE_OPTIONS:+ $NODE_OPTIONS}"
pnpm run package:desktop:mac:arm64:unsigned
```

| 项 | 值 |
|---|---|
| 机器 | Apple Silicon（`mac-arm64`） |
| 必需环境 | `DSH_DESKTOP_APP_ID`（反向域名）。本机预览用占位 `ai.deepseek.orb` |
| 本机 TLS | 必须带 `NODE_OPTIONS=--use-system-ca`，否则拉 npm / Electron zip 会 `unable to verify the first certificate` |
| 不需要 | Developer ID、Team ID、notarytool、COS、更新源 |
| 耗时 | 冷启动更长（下 Electron zip）；本机完整跑一次大约 4 分钟量级 |
| 产物根 | `apps/desktop/.desktop-build/targets/mac-arm64/unsigned-artifacts/` |

打完应看到：

- DMG：`unsigned-artifacts/deepseek-harness-<version>-mac-arm64.dmg`（约 200MB）
- 未封装应用：`unsigned-artifacts/mac-arm64/DeepSeek Orb.app`
- 日志里：`skipped macOS code signing  reason=identity explicitly is set to null`

当前壳版本是 `0.1.5-rc.2`，所以文件名带这个号。换版本后文件名跟着变。

---

## 2. 这条命令实际做了什么

`package:desktop:mac:arm64:unsigned` → `apps/desktop/scripts/package-target.ts mac-arm64 --unsigned`。顺序是：

1. `pnpm run build:official`（含 Host/Client `tsc`+tsdown、Computer Use 的 `macos-sck-capture` 可执行文件和 dylib）
2. `release:pack` 打 dsh / vendor / landlock tarball，再 pack 私有 `@deepseek-ai/dsh-desktop-host`
3. `prepare:runtime` / `prepare:packages` / `prepare:dsh`：上游 Node、pnpm、把生产依赖树铺进该 target 的 `dsh/`
4. 从 npm 拉 `dshmarket@1.50.0` 写成 `plugins/dshmarket-1.50.0.tgz`
5. Desktop 自己的 `build`：`tsc`、tsdown、`macos-selection`、**`macos-sck-napi.node` + `libmacos-sck-capture.dylib`**
6. electron-builder：`DSH_DESKTOP_UNSIGNED=1`，`identity: null`，只出 DMG（没有 ZIP 更新载荷），清掉签名相关环境变量

`--unsigned` 不能和 `--prepare-only` 一起用。`prepare:desktop` 不是这条命令的前半截；完整 `package:*` 会自己再跑一遍官方构建和准备，避免吃到过期的 dsh 树。

每个 target 的可变状态都在 `apps/desktop/.desktop-build/targets/<target>/` 下隔离。Node.js zip 缓存在 `.desktop-build/downloads`，按版本/平台/架构命名。

---

## 3. 装包与打开

1. **完全退出**正在跑的 DeepSeek Orb：Cmd-Q。只关窗口不够，Dock 里还可能留着进程。
2. 打开 DMG，把 DeepSeek Orb 拖到「应用程序」，覆盖旧的 `/Applications/DeepSeek Orb.app`。也可以直接开 `unsigned-artifacts/mac-arm64/DeepSeek Orb.app` 看效果。
3. Gatekeeper 拦的话：按住 Control 点图标 → 打开。这是 adhoc 无证书包，系统会警告，正常。
4. 第一次启动会 seed 插件市场、对 profile 做 peer 校验。加载页转完应进主窗口，设置 → 插件里能看到 Plugin Market。

换包后 Computer Use / 屏幕录制若行为不对，先确认 Dock 里旧进程已经死掉，再看下面「症状索引」。

---

## 4. 打完后产物里该有什么

在 `.app/Contents/` 里抽查这些，少一样就别拿去验证产品路径：

| 位置 | 用途 |
|---|---|
| `Resources/app.asar.unpacked/lib/macos-sck-napi.node` | Electron 主进程里调 ScreenCaptureKit |
| `Resources/app.asar.unpacked/lib/libmacos-sck-capture.dylib` | 上面 `.node` 链的 Swift 库（`@rpath`，和 `.node` 同目录） |
| `Resources/app.asar.unpacked/lib/macos-selection` | 划词工具条 helper |
| `Resources/plugins/dshmarket-1.50.0.tgz` | 首次启动 seed 插件市场 |
| `Resources/dsh/node_modules/@deepseek-ai/dsh-experimental-tool-computer-use/lib/macos-sck-capture` | **仅 CLI / 无 overlay-guard 时**用的 helper；Desktop 截屏不再 spawn 它 |
| `Resources/dsh/.../dsh-desktop-host/lib` 里协议 **8**、字符串 `sck-capture` | Host ↔ Electron 排除 overlay 的捕获 IPC |
| Dock / Finder 图标 | `build/icon.png`（悬浮球 GIF 第一帧做成的圆角矩形） |

`dsh/` 整棵树在 `signIgnore` 里，即使以后打**签名包**，helper 也不会变成 `ai.deepseek.orb`。所以 Desktop 排除 overlay 的截屏必须走 asarUnpack 里的 N-API，不能再 spawn helper。

---

## 5. 症状索引（按出现过的顺序）

### 5.1 打包阶段：`unable to verify the first certificate`

拉 npm tarball 或 Electron zip 时 TLS 失败。本机公司/系统证书不在 Node 默认 CA 里。

**做法：** 命令前加 `NODE_OPTIONS=--use-system-ca`（拼到已有 `NODE_OPTIONS` 后面，不要覆盖掉别的 flag）。不要为了过打包去关 TLS。

### 5.2 启动页「无法启动」：`dshmarket` peer 对不上 `@deepseek-ai/dsh-settings@0.1.5-rc.2`

种子市场包声明的 settings peer 是 caret-rc 线。npm `semver.satisfies` **默认**不让 `0.1.5-rc.2` 去匹配另一条 patch 线上的 prerelease range。只把市场版本从 1.47.0 升到 1.50.0 **不够**，1.50.0 还是同一条 peer range。

**代码里已经做的：**

- `validateDesktopPluginGraph` 使用 `satisfies(..., { includePrerelease: true })`
- 钉死 `DESKTOP_MARKET_VERSION = '1.50.0'`，tarball 文件名必须一致

**不要：** 为了过 peer 就不 seed 市场；产品要求打包后设置里始终有市场。

### 5.3 启动页「无法启动」：`ERR_PNPM_OUTDATED_LOCKFILE` / `--frozen-lockfile`

`installBundledMarket` 里 `pnpm add <tarball>` 之后会把 `package.json` 里的 `file:` 规格改成精确版本（`recordExactDependency`）。锁文件若没跟着重写，下一次 `pnpm install --frozen-lockfile` 就会炸。peer 校验若在重装之前抛错，pending 标记还会留着，下次启动继续撞同一面墙。

**代码里已经做的：**

- seed 后立刻再跑一次**不带** `--frozen-lockfile` 的 `pnpm install --ignore-scripts`
- `reconcileProfile` 碰到 outdated lockfile 会改用不冻结安装再试
- 打包应用的 `applyRelease` 若插件图仍是 `desktop profile:` 校验失败，会自动 `plugins-disable-all`（文件还在，bundle 收到 `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`）然后继续进应用，**不再卡在无法启动页**

自动禁用只发生在**打包** `applyRelease`，用户从插件管理器主动改插件不会走这条。冻结锁失败会先重试非冻结安装，不会为此禁用插件。

### 5.4 Computer Use：两个开关都开了仍「用户拒绝了应用程序、窗口、显示器捕捉」

系统设置里会出现**两行**都叫 DeepSeek Orb 的屏幕录制：

| 样子 | 实际身份 | 谁在用 |
|---|---|---|
| 带 App 图标 | Electron 主进程（`.app`） | 悬浮球门禁 `getMediaAccessStatus('screen')` |
| 绿色 exec | `macos-sck-capture`（`Identifier=macos-sck-capture`，adhoc CDHash 不同） | 旧实现里真正的 ScreenCaptureKit |

门禁看的是图标那条；真正截屏曾经 spawn helper，所以会出现「两个都开了仍 TCC 拒绝」。

**不要用这些办法（已经否决）：**

- 截屏前 `hide()` overlay 再 `desktopCapturer`：球和观察框彩带会闪
- 给 helper 换 bundle id / 签成同一 Team：无证书 TCC 按 **cdhash**，两个 Mach-O 合并不了；签名包里 helper 还在 `signIgnore` 的 `dsh/` 下，identifier 也不是 `ai.deepseek.orb`
- 在 Electron 里用 koffi 加载 helper：划词工具条已经否决过 Electron+koffi

**正确做法（已落地）：** ScreenCaptureKit 跑在 Electron 主进程。Host 协议 **8** 走 `sck-capture` / `sck-capture-ack`。CLI `dsh` 仍 spawn helper（授权落在 Terminal 上，这是对的）。Swift 库入口**禁止** `setActivationPolicy(.prohibited)`，否则会把 Orb 从 Dock 拿掉。N-API 必须用 `napi_create_async_work`，不能在 Electron 主线程上同步等 `@MainActor` 捕获，否则死锁。

装新包后：

1. Cmd-Q 再开
2. 系统设置里绿色 exec 那行是**旧 helper 留下的**，新截屏不再用它，用「−」删掉
3. 只保留带图标的那条并打开

### 5.5 换了新包，截屏 / 协议仍像旧的

常见原因：

- 没完全退出，旧 Electron 还在跑
- 只换了 DMG 里的某一半：壳和 Host 必须一起换。协议 7 的壳配协议 8 的 Host（或反过来）会在 `ready` 时报 `protocol N does not match Electron protocol M`
- 测的是 `/Applications` 里的旧 `.app`，不是刚打出来的 `unsigned-artifacts`

### 5.6 改了 `DSH_DESKTOP_APP_ID`

TCC（屏幕录制、辅助功能）按 bundle id 记。换 `appId` 等于换应用，系统设置里会当成新客户，旧授权不跟着走。本机预览请一直用同一个 `ai.deepseek.orb`，除非你故意要一条干净的 TCC 身份。

`productName` 是 DeepSeek Orb；源码 `start:desktop` 在系统设置里显示的是 **Electron**，不是 Orb。

### 5.7 打包日志里一堆 `Failed to create bin ... ENOENT ... chmod`

pnpm workspace 在部分包上建 `.bin` 失败。这次完整打包仍能成功结束。不要把这类 WARN 当成打包失败；看最后的 `exit_code` 和 DMG 是否写出来。

### 5.8 TypeScript：`exactOptionalPropertyTypes` 和 `signal: undefined`

给 `captureExcludedRegion` 传 `{ signal }` 而 `signal` 可能是 `undefined` 会在严格可选属性下编不过。只在有 AbortSignal 时展开：`...signal === undefined ? {} : { signal }`。

---

## 6. 启动后插件市场与第三方插件

产品意图：打包应用启动后设置 → 插件里**始终能看到市场**。市场是外部 MIT 包 `dshmarket@1.50.0`，不是 `DESKTOP_PROFILE_BUNDLES` 核心 bundle。

- 打包资源带 `extraResources/plugins/dshmarket-1.50.0.tgz`
- profile 里还没有这个精确 spec 时，内部 `pnpm add <tarball>` seed
- 第一次 seed 仍可能从 registry 拉市场自己的 npm 依赖，所以无网第一次启动可能慢或失败
- 第三方插件图校验失败时自动禁用第三方并继续进应用；市场作为外部 profile 插件保留这条策略

源码启动（`start:desktop`）把市场钉在 `$DSH_HOME/profiles/desktop` 开发 store 里，和打包 tarball seed 是两条路径。

---

## 7. 签名包 vs 无证书包（和 TCC 的关系）

| | 无证书预览 | 正式签名 |
|---|---|---|
| 命令 | `package:desktop:mac:arm64:unsigned` | `package:desktop:mac:arm64` |
| 签名 | adhoc，`identity: null` | Developer ID + 公证 |
| TCC 键 | **CDHash**（每个 Mach-O 一行） | Team + identifier |
| 产物 | 仅 DMG，无 ZIP / 更新元数据 | DMG + ZIP + 更新通道 |
| 上传 | 没有完成记录，不能 `upload:*` | 需要 COS 与完成记录 |

两种包都要把 SCK 放进 Electron 主进程，才能让屏幕录制只剩带图标的那一条。只给 helper 加签名解不了无证书，也解不了 `signIgnore` 的 `dsh/`。

---

## 8. 明确不要做的事

- 不要 `git add` DMG、`.app`、`.desktop-build/`
- 不要对无证书产物跑 `upload:mac:*`
- 不要为了「看起来像正式包」去设签名环境变量；`--unsigned` 会把 `CSC_*` / `DSH_DESKTOP_MACOS_*` / `APPLE_*` 清掉
- 不要用 `desktopCapturer` + 藏球来躲 TCC
- 不要在 Electron 主线程同步调用 Swift `@MainActor` 捕获
- 不要在 dylib 入口里 `setActivationPolicy(.prohibited)`
- 不要假设「系统设置里开关开了」等于 ScreenCaptureKit 用的是同一个客户：看图标那行，看进程，不要看名字字符串

---

## 9. 相关代码与决策（要改行为时再打开）

| 主题 | 打开 |
|---|---|
| 打包入口 | `apps/desktop/scripts/package-target.ts` |
| electron-builder / asarUnpack / signIgnore | `apps/desktop/electron-builder.config.mjs` |
| 市场版本与 tarball 名 | `apps/desktop/src/market-plugin.ts` |
| peer `includePrerelease` | `apps/desktop/src/profile-packages.ts` |
| seed / frozen-lockfile / 自动禁用 | `apps/desktop/src/project-manager.ts` |
| Host 协议 8 | `apps/desktop/src/host-protocol.ts`、`apps/desktop-host/src/wire.ts` |
| Electron 里 SCK | `apps/desktop/src/macos-sck-napi.ts`、`apps/desktop/src/macos-sck-napi.c` |
| Swift CLI + 库 | `packages/experimental/tool-computer-use/src/macos-sck-capture.swift` |
| Desktop 走 IPC、CLI 走 helper | `packages/experimental/tool-computer-use/src/macos.ts` |
| overlay-guard | `.agents/notes/implemented/architecture/2026-09-14-desktop-overlay-guard.md` |
| 为何 SCK 必须进 Orb 进程 | `.agents/notes/implemented/architecture/2026-09-20-desktop-sck-in-process-identity.md` |
| 插件市场 seed | `.agents/notes/implemented/architecture/2026-09-18-desktop-in-process-webserver-and-plugin-market.md` |
| 悬浮球 TCC 门禁 | `.agents/notes/implemented/feature/2026-09-20-desktop-orb-tcc-gate.md` |

---

## 10. 打完后 30 秒自检

```sh
APP="apps/desktop/.desktop-build/targets/mac-arm64/unsigned-artifacts/mac-arm64/DeepSeek Orb.app"
ls -lh "$APP/Contents/Resources/app.asar.unpacked/lib/macos-sck-napi.node"
ls -lh "$APP/Contents/Resources/app.asar.unpacked/lib/libmacos-sck-capture.dylib"
ls -lh "$APP/Contents/Resources/plugins/dshmarket-1.50.0.tgz"
rg -n 'DESKTOP_HOST_PROTOCOL_VERSION = 8|"sck-capture"' \
  "$APP/Contents/Resources/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib"
```

四项都在，再装到 `/Applications`。先 Cmd-Q，再打开，再测 Computer Use 截屏。
