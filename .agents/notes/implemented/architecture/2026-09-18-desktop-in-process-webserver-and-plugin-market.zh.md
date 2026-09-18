# Agent Note: In-process Desktop webServer and Plugin Market

Status: implemented

[English](2026-09-18-desktop-in-process-webserver-and-plugin-market.md) | 中文

## 问题

dsh-market（npm 上的 `dshmarket`）把 `/dsh-market/*` 挂在 `ctx.webServer` 上，并在存在 `desktopPnpm` 时通过该服务装插件。官方 Desktop 禁用了 `webserver`，把 `/dsh-market` 答成 SPA HTML 或 405，也没有 `desktopProfiles`／`desktopPnpm`。未打包的 `start:desktop` 每次启动还会清空 `.desktop-build/development/project` 并拒绝插件变更，因此把市场钉进 hoist 树也无法在重启后保留。

## 决策

Desktop 以 `listen: false` 启用 `@deepseek-ai/dsh-host-webserver`。激活不绑定 TCP 端口。`WebServer.dispatch(request)` 只匹配具名 exact／prefix 路由，未命中返回 `undefined`，以便 Desktop 保留 SPA `assetHandler`。Fetch 顺序为 `/.dsh/remote-stream`、`/api/*`、`/plugins/*`、具名 `webServer.dispatch`，然后是 SPA 资产。合成的 `IncomingMessage` 头转发 `Host` 与 `Origin`；`dsh-app://app` 使用 `Host: app` 与 `Origin: dsh-app://app`，以便市场的 `sameOrigin` POST 检查通过。

在 Loader 条目挂载之前，Desktop Host 提供 `desktopProfiles.current = { name: 'desktop', dir }` 以及带 `runPlugin`／`runExternalMarketPluginInstall` 的 `desktopPnpm`。这些方法发送 Host→Electron 的 `plugin-run` IPC（协议 6）。Electron 通过 `DesktopProjectManager.mutateWhileRunning` 运行内置 pnpm，不停止 Host，随后市场 UI 提示用户重启。GitHub、gist、git、file 和 URL spec 仍然被拒绝。

未打包启动把外部插件持久化在 `$DSH_HOME/profiles/desktop`，并重新链入被清空的 hoist 项目。链接器随后把各插件的宿主 peer 包从 hoist 放到 store 副本旁边，因为 Node ESM 对 store 插件做 realpath 后不会搜索 hoist 的 `node_modules`。`start:desktop` 在该 store 中钉入 `dshmarket@1.47.0`。`--skip-build` 会重建 `@deepseek-ai/dsh-host-webserver` 与 `@deepseek-ai/dsh-client-modules`，以便 Host 从这些包的 `lib/index.js` 加载 `dispatch` 以及 `/plugins` 载体注册。当载体已经提供时，client-modules 通过 `ctx.get('webServer')` 注册该路由，因为 Cordis 在插件 fiber 上通过属性访问服务需要 inject。市场包不是签名的 `DESKTOP_PROFILE_BUNDLES` 成员。打包应用默认预装市场不在本轮范围。

## 考虑过的替代方案

- **为市场 HTTP 在回环上监听。** Desktop 的产品规则是不监听端口。进程内 Fetch dispatch 保留该规则，仍能运行 node:http handler。
- **把 dsh-market 收进 `packages/` 或 `vendor/`。** 该插件是 MIT 许可的 npm 包，且已是 Cordis 插件。消费已发布包可避免第二份源码树，也避免把版权文件并入第一方包。
- **像插件管理窗口那样在市场安装前停止 Host。** `/dsh-market/install` 是 Host 上的流式 HTTP 响应；停止 Host 会切断该流。Host 存活时装包，再由用户重启以加载新的 Loader 条目，因为 `client-hmr` 保持禁用。
- **spawn `dsh plugin --profile web`。** 这会写入 `~/.dsh/profiles/web`，永远到不了 Desktop profile。CLI 也拒绝 `--profile desktop`。
- **对开发 hoist 树执行 `pnpm add`。** 该树是每次 `start:desktop` 重建的链接农场；直接修改会打乱工作区链接。持久 profile store 才是 pnpm 项目；hoist 只接收目录链接。宿主 peer 仍须链回 store，因为 ESM realpath 不会搜索 hoist。

## 后果

`start:desktop` 后，只要 `dshmarket` 已在开发 store 中，设置 → 插件即可显示插件市场。市场对 registry 包的安装能在下一次 hoist 重建后保留。仅 GitHub 的目录条目会以明确的不受支持 spec 错误失败。Desktop 仍不监听 TCP，仍不启用 `web-runtime` 或 `client-hmr`，也仍不允许 CLI 管理 `profile desktop`。

测试覆盖 `listen: false` 且无 TCPWRAP、`dispatch` 前缀命中与未命中、Host／Origin 的 `sameOrigin` 值、fetch 顺序、开发 store 链入 `dshmarket` 及其宿主 peer，以及 `github:` 拒绝。对 awesome-dsh-plugin 的 GUI 浏览／安装仍是本地 Desktop 运行。
