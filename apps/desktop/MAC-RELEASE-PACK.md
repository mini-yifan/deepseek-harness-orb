# DeepSeek Orb macOS 打包发布指南

> 面向本机(gaoyifan 的 Apple Silicon Mac)的可复现操作手册。
> 记录了 2026-09-21 首次成功打出 `0.1.5-rc.2` 可对外发布版的完整流程、内部原理和全部踩过的坑。
> 按本文档操作,可以在任何一次全新打包中完整复现。

---

## 1. 概述

**打包对象**:DeepSeek Orb —— deepseek-harness 仓库的 Electron 桌面壳(`apps/desktop`),内嵌完整的 dsh Node 运行时、插件市场组件与预打包插件。

**「可对外发布」的标准**:

1. 所有可执行文件用 **Developer ID Application** 证书签名(硬化运行时 + 安全时间戳);
2. App 与 DMG 都通过 **Apple 公证**(notarization)并 **staple**(票据永久附在文件里);
3. `spctl` / `stapler validate` 验收通过 —— 别人的 Mac 上双击安装、启动,**全程无 Gatekeeper 安全警告**。

**产物 5 件套**(位于 `apps/desktop/.desktop-build/targets/mac-arm64/artifacts/`):

| 文件 | 用途 |
|---|---|
| `deepseek-harness-<版本>-mac-arm64.dmg` | 给用户下载安装的安装包(≈200MB) |
| `deepseek-harness-<版本>-mac-arm64.zip` | 自动更新 payload(≈206MB) |
| `deepseek-harness-<版本>-mac-arm64.zip.blockmap` | 增量更新差分包索引 |
| `rc-mac.yml`(正式版为 `latest-mac.yml`) | 更新通道元数据 |
| `mac-arm64-release.json` | 发布完成记录,`upload:mac:arm64` 上传前校验用 |

**总耗时参考**:30–60 分钟。构建+签名约 15–20 分钟;Apple 公证排队 10–30 分钟;网络不稳定时公证上传需要重试。

---

## 2. 一次性准备(本机已完成,换机/重建时照此办理)

### 2.1 Apple 开发者账号三件套

需要 **99 美元/年的 Apple Developer Program 付费会员**。对外分发(不上 App Store)需要:

1. **Team ID** —— [developer.apple.com/account](https://developer.apple.com/account) → Membership details,10 位大写字母数字。
2. **Developer ID Application 证书** —— 钥匙串访问 → 证书助理 → 从证书颁发机构请求证书(存到磁盘,生成 CSR 的同时私钥进入登录钥匙串)→ 开发者网站 Certificates → `+` → Developer ID Application → 上传 CSR → 下载 `.cer` 双击导入。**必须**是 "Developer ID Application",不是 "Apple Development"。
3. **公证凭据** —— 三种方案任选其一。本机采用 **App Store Connect API 密钥**(因为 account.apple.com 网页版未登录,App 专用密码方案不可用):
   - [appstoreconnect.apple.com](https://appstoreconnect.apple.com) → 用户和访问 → 集成 → App Store Connect API;
   - 首次使用需同意服务条款、点「请求访问」(个人账号自动获批);
   - 生成密钥:名称随意、角色选 **App 管理(App Manager)** → 下载 `.p8` 文件(**只能下载一次!**)→ 立即妥善保存;
   - 页面上的 **Issuer ID** 和密钥的 **密钥 ID** 一并记下。

### 2.2 本机现成凭据速查表

| 项目 | 值 |
|---|---|
| 签名身份(`DSH_DESKTOP_MACOS_SIGNING_IDENTITY`) | `yifan Gao (29P7XSCRQN)`(注意:**不带** `Developer ID Application:` 前缀) |
| 证书 SHA-1 | `6548043723550A283E0C62BC6E1C497749C972CD` |
| 证书有效期 | 至 **2031-09-03** |
| Team ID | `29P7XSCRQN` |
| 公证密钥 ID(`APPLE_API_KEY_ID`) | `TS5PGXAKMP` |
| 公证 Issuer ID(`APPLE_API_ISSUER`) | `6b7cb795-eb55-49f8-8c24-1d8dd88a9c59` |
| `.p8` 私钥路径(`APPLE_API_KEY`) | `~/.appstoreconnect/AuthKey_TS5PGXAKMP.p8`(权限 600) |
| 环境变量文件 | `~/.deepseek-desktop-release.env`(权限 600) |
| 应用 ID(`DSH_DESKTOP_APP_ID`,暂定) | `com.miniyifan.deepseek-orb`(对外发布后**不可再改**,自动更新靠它识别应用) |

环境变量文件内容(`~/.deepseek-desktop-release.env`):

```sh
export DSH_DESKTOP_APP_ID='com.miniyifan.deepseek-orb'
export DSH_DESKTOP_MACOS_SIGNING_IDENTITY='yifan Gao (29P7XSCRQN)'
export DSH_DESKTOP_MACOS_TEAM_ID='29P7XSCRQN'
export APPLE_API_KEY="$HOME/.appstoreconnect/AuthKey_TS5PGXAKMP.p8"
export APPLE_API_KEY_ID='TS5PGXAKMP'
export APPLE_API_ISSUER='6b7cb795-eb55-49f8-8c24-1d8dd88a9c59'
export DOWNLOAD_TEST_ORIGIN='https://download.example.com'   # 测试渠道占位;正式分发换真实下载域名
```

### 2.3 凭据自检命令

```sh
# 1. 签名证书存在且私钥可用:应列出 "Developer ID Application: yifan Gao (29P7XSCRQN)"
security find-identity -v -p codesigning

# 2. 公证凭据可用:应输出 "Successfully received submission history."
xcrun notarytool history \
  --key ~/.appstoreconnect/AuthKey_TS5PGXAKMP.p8 \
  --key-id TS5PGXAKMP \
  --issuer 6b7cb795-eb55-49f8-8c24-1d8dd88a9c59
```

### 2.4 凭据丢失/过期怎么办

- **`.p8` 丢失**(只能下载一次):到 App Store Connect → 集成 → 撤销旧密钥 → 重新生成并下载,更新 `~/.deepseek-desktop-release.env` 里的 `APPLE_API_KEY` 路径与 `APPLE_API_KEY_ID`(Issuer ID 不变)。API 密钥本身**永不过期**。
- **证书过期**(2031-09-03 前 Apple 会提醒):重新走 §2.1 第 2 步创建新证书,然后更新 `DSH_DESKTOP_MACOS_SIGNING_IDENTITY`。旧版本用户通过自动更新换到新签名的包即可平滑过渡。
- **换机器打包**:在旧机器钥匙串访问里把「Developer ID Application 证书 + 私钥」导出为 `.p12`(设强密码),新机器导入;`.p8` 文件直接拷贝。

---

## 3. 日常打包流程(标准路径)

### 3.1 前置条件检查

```sh
xcrun --version                 # Xcode Command Line Tools
node -v && pnpm -v              # Node 24.x / pnpm 11.7(仓库 engines 要求)
df -h / | tail -1               # 磁盘至少留 30GB(构建目录 + 各类缓存)
cd /Users/gaoyifan/Desktop/Project/deepseek-harness && pnpm install   # 依赖就位
```

**版本一致性**:根 `package.json` 与 `apps/desktop/package.json` 的 `version` 必须完全相同(打包脚本会校验)。需要改版本时两处一起改。

**打开 VPN**:公证上传必须走代理(原因见 §5.3)。VPN 需要设置 **macOS 系统代理**(大多数客户端的「系统代理」开关)或 TUN/增强模式。`scutil --proxy` 里应看到 `HTTPSEnable : 1`。

### 3.2 一条命令打包

```sh
source ~/.deepseek-desktop-release.env
export NODE_USE_SYSTEM_CA=1                     # 必需,见 §5.1
cd /Users/gaoyifan/Desktop/Project/deepseek-harness/apps/desktop
pnpm package:mac:arm64
```

> 注意:必须通过 `pnpm` 包脚本调用(脚本内部依赖 `npm_execpath`),不要直接 `tsx scripts/package-target.ts`。

**产物落盘位置**:`apps/desktop/.desktop-build/targets/mac-arm64/artifacts/`。日志里看到 `desktop macOS notarization: verified disk image ...` 即为成功。

### 3.3 观察进度的关键日志行

| 日志片段 | 含义 |
|---|---|
| `release pack: family dsh, 268 tarball(s)` | dsh 运行时组件打包完成 |
| `desktop package set: prepared ...` | 依赖清单就绪 |
| `electron-builder version=...` | 进入 electron-builder 打包 |
| `building target=macOS zip` | ZIP 通道:App 已公证盖章,正在打 ZIP |
| `building target=DMG` | DMG 通道:正在构建/公证 DMG |
| `desktop macOS packaging: App notarization and ZIP completed` | ZIP 通道全部完成 |
| `desktop macOS notarization: verified disk image` | DMG 公证并验收完成 |
| `desktop package: ... exited with 1` | 失败,看上文报错对照 §5 |

### 3.4 Apple 公证提交状态查询

```sh
xcrun notarytool history --key ~/.appstoreconnect/AuthKey_TS5PGXAKMP.p8 \
  --key-id TS5PGXAKMP --issuer 6b7cb795-eb55-49f8-8c24-1d8dd88a9c59 | head -20

# 查单个提交(把 <id> 换成 history 里的 id):
xcrun notarytool info <id> --key ~/.appstoreconnect/AuthKey_TS5PGXAKMP.p8 \
  --key-id TS5PGXAKMP --issuer 6b7cb795-eb55-49f8-8c24-1d8dd88a9c59
```

状态含义:`In Progress` = 排队/处理中(几分钟到半小时+);`Accepted` = 公证通过;`Invalid` = 被拒(用 `xcrun notarytool log <id> ...` 看原因)。

---

## 4. 流水线内部发生了什么(原理)

入口:`apps/desktop/scripts/package-target.ts`。**一条命令跑完整条流水线**,没有断点续传(失败重跑会从头执行,但各阶段产物有缓存,重跑比首次快)。

| # | 阶段 | 做什么 | 耗时参考 |
|---|---|---|---|
| 1 | `pnpm run build:official` | 编译全仓库(TypeScript + tsdown 打包 ~180 个子包 + 原生模块) | 7–10 min |
| 2 | `release:pack --family dsh` | 把 268 个 dsh 组件打成 npm tarball | ~2 min |
| 3 | `apps/desktop-host pack` | 桌面宿主包 | <1 min |
| 4 | `release:pack --family vendor` | 9 个 vendor 包(cordis 等) | ~1 min |
| 5 | native/system entry pack | landlock 运行时 | <1 min |
| 6 | `prepare:runtime` / `prepare:packages` / `prepare:dsh` | 下载独立 Node + pnpm;按锁定文件安装生产依赖;**用 Developer ID 证书对运行时里每个 Mach-O 预签名**;跑运行时冒烟 | 3–15 min(取决于 npm 源,见 §5.2) |
| 7 | `packBundledMarket` | 从 registry.npmjs.org 下载插件市场 tarball | <1 min |
| 8 | electron-builder `--dir` | 组装 `.app`;对每个可执行文件用 Developer ID 证书签名(硬化运行时 + 安全时间戳);对 App 做深签名校验(拒绝其他颁发者/Team ID) | 2–5 min |
| 9 | 双通道 artifact lanes(`scripts/package-macos.ts`) | **ZIP 通道**:复制 App → 提交公证 → 等 Accepted → staple → 打 ZIP + blockmap + 通道 yml。**DMG 通道**:复制 App → 构建 DMG → electron-builder 钩子自动提交公证 → staple → 跑 Gatekeeper 验收。两通道并行 | 10–40 min |
| 10 | 收尾 | 产物 rename 进 `artifacts/`;写 `mac-arm64-release.json` | <1 min |

签名身份不接受「钥匙串里随便第一个证书」:配置显式校验 `DSH_DESKTOP_MACOS_SIGNING_IDENTITY` 与 `DSH_DESKTOP_MACOS_TEAM_ID`,并且拒绝带 `Developer ID Application:` 前缀的写法。

---

## 5. 本机三大网络坑与修复(重点)

### 5.1 electron-builder 下载资源报 `unable to verify the first certificate`

**原因**:本机网络有透明代理拦截,其根证书装在系统钥匙串,而 Node 默认只用内置证书库。
**修复**:打包前 `export NODE_USE_SYSTEM_CA=1`(Node 22.15+ 支持,进程树全部继承)。
**验证**:`NODE_USE_SYSTEM_CA=1 node -e "fetch('https://github.com').then(r=>console.log(r.status))"` 能返回状态码即通。

### 5.2 `prepare:dsh` 阶段 pnpm 安装超时

**原因**:`apps/desktop/scripts/prepare-dsh.ts` **硬编码** npmjs 官方源(0.1.5-rc.2 时点在第 74 与 86 行),并过滤掉所有 `npm_*/pnpm_*` 环境变量,所以 `npm_config_registry` 传不进去。官方源在本机网络只有 20–40 KiB/s,解析+下载 500 个包经常超时(`[23] The operation was aborted due to timeout`)。

**修复:临时补丁脚本,用 npmmirror 镜像**(内容与官方一致,pnpm 会按 lockfile 的 sha512 校验完整性),打完包**必须还原**:

```sh
# 1. 修改 apps/desktop/scripts/prepare-dsh.ts 两处:

# 第 74 行,把:
      '--config.registry=https://registry.npmjs.org/',
# 改为:
      `--config.registry=${process.env.DSH_DESKTOP_NPM_REGISTRY ?? 'https://registry.npmjs.org/'}`,

# 第 86 行,把:
        NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/',
# 改为:
        NPM_CONFIG_REGISTRY: process.env.DSH_DESKTOP_NPM_REGISTRY ?? 'https://registry.npmjs.org/',

# 2. 打包时带上:
export DSH_DESKTOP_NPM_REGISTRY=https://registry.npmmirror.com

# 3. 打包完成后还原(不要提交):
git checkout apps/desktop/scripts/prepare-dsh.ts
```

同时建议 `export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`,加速 electron 二进制下载。

### 5.3 公证上传被 SNI 封锁(必须开 VPN)

**现象特征**(按诊断顺序):
1. `xcrun notarytool history` / `notarytool info` **正常**(走 `appstoreconnect.apple.com`,不被封);
2. 打包报 `Failed to notarize via notarytool ... HTTPClientError.connectTimeout`;
3. `curl -v https://notary-submissions-prod.s3.us-west-2.amazonaws.com/` → TCP 能连上,但 **TLS ClientHello 一发出就 `Connection reset by peer`** —— 这是针对 `*.amazonaws.com` 上传域名的 SNI 封锁,IPv4/IPv6 都一样。

**原因**:公证文件必须 PUT 到 Apple 的 AWS S3 桶 `notary-submissions-prod`(us-west-2),该域名在本网络被墙。API 主机没事,**只有上传主机被封**。

**修复**:打开 VPN,且要求设置 **macOS 系统代理**(notarytool 是 Swift/URLSession 程序,读系统代理,不读环境变量)。验证:

```sh
scutil --proxy | grep -E "HTTPSEnable|HTTPSProxy"     # HTTPSEnable : 1, HTTPSProxy : 127.0.0.1
curl -sS --max-time 10 -o /dev/null -w "%{http_code}\n" \
  https://notary-submissions-prod.s3.us-west-2.amazonaws.com/    # 返回 403 即通(未带认证的正常拒绝)
```

**注意**:即使 VPN 开着,200MB 级 DMG 的分片上传仍会随机超时(报 `deadlineExceeded` 或 `connectTimeout`,有时传完 34/34 个分片后卡在「完成分片上传」请求)。这是代理链路抖动,**重试即可**,成功概率高(见 §6)。

---

## 6. 公证失败后的低成本重试(重要)

失败分两类,处理方式不同:

### 6.1 构建阶段失败(§5.1/§5.2 的报错)

直接修复对应问题后重跑 `pnpm package:mac:arm64`。构建产物有缓存,重跑较快。

### 6.2 公证阶段失败(报错出现在 `building target=DMG/zip` 之后)

**关键事实**:
- 失败时,已签名的 `.app` 仍完好保留在 `artifacts/mac-arm64/DeepSeek Orb.app`——**不用重新构建**;
- 但已构建的 DMG/ZIP 在临时目录里,失败时会被脚本自动清理;
- 已上传到 Apple 的提交(In Progress)对应的本地文件已不存在,其票据救不回来,不用等它;
- ZIP 通道成功过一次的话,**App 的公证已被 Apple 接受**,重跑时可用 `xcrun stapler staple` 直接给 App 补票,**无需重传 App**。

**重试方式一(推荐,简单)**:直接重跑 `pnpm package:mac:arm64`。缺点是全流程重来(约 20 分钟到公证环节)。

**重试方式二(快,推荐公证阶段反复失败时)**:写一个驱动脚本只重跑 artifact lanes,复用已签名的 App。完整可用版本(保存为 `/tmp/dsh-notarize-v3.mts`,在 `apps/desktop` 下执行 `pnpm exec tsx /tmp/dsh-notarize-v3.mts`):

```ts
/** 重跑 ZIP/DMG artifact lanes;ZIP 通道用 stapler 补票,DMG 通道带重试。 */
import { spawn, execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, rename, rm, stat } from 'node:fs/promises'
import { promisify } from 'node:util'
import { basename, dirname, join } from 'node:path'

const execute = promisify(execFile)
const APP_ROOT = '/Users/gaoyifan/Desktop/Project/deepseek-harness/apps/desktop'
const ARTIFACTS_ROOT = join(APP_ROOT, '.desktop-build/targets/mac-arm64/artifacts')
const APP_PATH = join(ARTIFACTS_ROOT, 'mac-arm64', 'DeepSeek Orb.app')
const version = (JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8'))).version
const base = `deepseek-harness-${version}-mac-arm64`

function runPnpm(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('pnpm', args, { cwd: APP_ROOT, env: process.env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`pnpm ${args.join(' ')} exited with ${String(code ?? signal)}`))
    })
  })
}

function electronBuilderArgs(format, appPath, output) {
  return ['exec', 'electron-builder', '--config', 'electron-builder.config.mjs',
    '--mac', format, '--arm64', '--publish', 'never', '--config.mac.notarize=false',
    '--prepackaged', appPath, '--config.directories.output', output]
}

async function copyApp(source, destination) {
  await execute('/usr/bin/ditto', [source, destination])
}

const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms) })
const root = await mkdtemp(join(dirname(ARTIFACTS_ROOT), 'notarization-'))

try {
  // ---- ZIP 通道:App 公证已被 Apple 接受过 → stapler 补票即可,无需重传
  const zipApp = join(root, 'zip', basename(APP_PATH))
  const zipOutput = join(root, 'zip-artifacts')
  await copyApp(APP_PATH, zipApp)
  await execute('/usr/bin/xcrun', ['stapler', 'staple', zipApp])
  await execute('/usr/bin/xcrun', ['stapler', 'validate', zipApp])
  console.log('ZIP lane: app stapled and validated')
  await runPnpm(electronBuilderArgs('zip', zipApp, zipOutput))
  for (const filename of [`${base}.zip`, `${base}.zip.blockmap`, 'rc-mac.yml']) {
    const file = join(zipOutput, filename)
    const details = await stat(file)
    if (!details.isFile() || details.size === 0) throw new Error(`missing or empty artifact ${file}`)
    await rename(file, join(ARTIFACTS_ROOT, filename))
  }
  console.log(`ZIP lane promoted`)

  // ---- DMG 通道:重新构建并公证,失败自动重试(最多 5 次)
  const dmgOutput = join(root, 'dmg-artifacts')
  let promoted = false
  for (let attempt = 1; attempt <= 5 && !promoted; attempt += 1) {
    console.log(`DMG lane: attempt ${attempt} of 5`)
    const dmgApp = join(root, `dmg-${attempt}`, basename(APP_PATH))
    await copyApp(APP_PATH, dmgApp)
    try {
      await runPnpm(electronBuilderArgs('dmg', dmgApp, dmgOutput))
      const details = await stat(join(dmgOutput, `${base}.dmg`))
      if (!details.isFile() || details.size === 0) throw new Error(`empty ${base}.dmg`)
      await rename(join(dmgOutput, `${base}.dmg`), join(ARTIFACTS_ROOT, `${base}.dmg`))
      promoted = true
    } catch (error) {
      console.log(`DMG attempt ${attempt} failed: ${error.message.slice(0, 200)}`)
      await rm(dmgApp, { recursive: true, force: true })
      await rm(dmgOutput, { recursive: true, force: true })
      await sleep(20_000)
    }
  }
  if (!promoted) throw new Error('DMG lane failed after 5 attempts')

  await rm(APP_PATH, { recursive: true })
  await rename(zipApp, APP_PATH)
  console.log('ARTIFACT LANES COMPLETE')
} finally {
  await rm(root, { recursive: true, force: true })
}
```

执行前需要加载的环境(和正常打包一致):

```sh
source ~/.deepseek-desktop-release.env
export NODE_USE_SYSTEM_CA=1
cd /Users/gaoyifan/Desktop/Project/deepseek-harness/apps/desktop
pnpm exec tsx /tmp/dsh-notarize-v3.mts
```

> 前提:ZIP 通道重试用的是「App 公证已被 Apple 接受」这个事实。如果是全新构建(还没有任何 Accepted 的 App 提交),`stapler staple` 会失败,此时直接重跑 `pnpm package:mac:arm64`。

> 成功后驱动脚本把盖章的 App 放回 `artifacts/mac-arm64/`。但 `mac-arm64-release.json` 不会被写出(那是 `package-target.ts` 的职责),需要上传时手工补一份(照 artifacts 里现存文件的格式)或重跑一次完整打包。

---

## 7. 产物验收(发布前必做)

```sh
A=apps/desktop/.desktop-build/targets/mac-arm64/artifacts

# 1. DMG 公证票据
xcrun stapler validate "$A/deepseek-harness-<版本>-mac-arm64.dmg"
#    期望:The validate action worked!

# 2. App 的 Gatekeeper 验收(决定别人双击时的体验)
spctl -a -vv "$A/mac-arm64/DeepSeek Orb.app"
#    期望:accepted / source=Notarized Developer ID / origin=Developer ID Application: yifan Gao (29P7XSCRQN)

# 3. App 票据
xcrun stapler validate "$A/mac-arm64/DeepSeek Orb.app"
#    期望:The validate action worked!

# 4. 签名深校验(可选)
codesign --verify --deep --strict "$A/mac-arm64/DeepSeek Orb.app"
```

**终极验收**:把 DMG 发到另一台**没装过开发工具**的 Mac:下载 → 双击打开 → 拖进 Applications → 双击启动,全程无安全警告。

---

## 8. 快速本地测试(未签名,不占公证额度)

```sh
cd apps/desktop
DSH_DESKTOP_APP_ID='com.miniyifan.deepseek-orb' pnpm package:mac:arm64:unsigned
```

产物在 `.desktop-build/targets/mac-arm64/unsigned-artifacts/`。自己机器能直接跑;拷到别的 Mac 可能需右键 → 打开。**正式分发必须走签名+公证**。

---

## 9. 其他目标平台(简述)

| 命令 | 要求 |
|---|---|
| `pnpm package:mac:x64` | Intel Mac,或 Apple Silicon + Rosetta |
| `pnpm package:win:x64` | 必须在 Windows x64 主机上执行;需要 EV 代码签名证书 + SafeNet USB 令牌 + SignTool(`DSH_DESKTOP_WINDOWS_*` 四个环境变量;PIN 不能含 `]`、引号、换行) |

详细要求见 `apps/desktop/README.md`(§macOS 打包、§Windows EV signing)、`apps/desktop/UNSIGNED-MAC-PACK.md` 与 `apps/desktop/UNSIGNED-WIN-PACK.md`。Windows 本地未签名安装包按 `UNSIGNED-WIN-PACK.md` 打。

---

## 10. 发布与自动更新(后续要做的)

当前产物里的更新地址是**占位符**(`https://download.example.com`,写在 `rc-mac.yml` 里)。要做正式自动更新:

1. 准备真实下载域名与腾讯 COS 桶,在打包/上传环境设置:
   - 测试渠道:`DOWNLOAD_TEST_ORIGIN`(HTTPS 域名)+ `DOWNLOAD_TEST_COS_BUCKET` / `DOWNLOAD_TEST_COS_SECRET_ID` / `DOWNLOAD_TEST_COS_SECRET_KEY`;
   - 生产渠道:`DSH_DESKTOP_AUTO_UPDATE_ENV=production`(固定 origin `https://download.deepseek.com`)+ `DOWNLOAD_PROD_COS_*` 三件套;
2. **用设置了真实 origin 的环境重新打包**(origin 会写进更新元数据);
3. `pnpm upload:mac:arm64` —— 上传前会校验 `mac-arm64-release.json` 与产物版本、大小、SHA-512 一致性,按「版本化产物 → 通道 yml(no-cache)最后传」的顺序上传,且永不删除历史对象。

**改 `DSH_DESKTOP_APP_ID` 的最后机会是第一次对外发布之前**;发布后它就是应用的唯一身份,改了等于另一个应用(老用户无法自动更新)。

---

## 11. 2026-09-21 首次成功记录(基线对照)

- 版本 `0.1.5-rc.2`,Apple Silicon (`mac-arm64`),产物 5 件套齐全,`spctl` 验收 `source=Notarized Developer ID`。
- 遇到并解决的问题,按顺序:
  1. electron-builder TLS 证书错误 → `NODE_USE_SYSTEM_CA=1`;
  2. `prepare:dsh` 官方源安装超时 → 临时补丁 + `DSH_DESKTOP_NPM_REGISTRY=https://registry.npmmirror.com`(用后还原);
  3. 公证上传 SNI 封锁 → 用户开启 VPN(系统代理 127.0.0.1:7892)后可通;
  4. VPN 链路上大文件分片上传随机超时 → ZIP/DMG 各重试 1–2 次后成功(Apple 排队曾达 23 分钟,属正常)。
- 当天 Apple 侧留下多个 `In Progress`/`Accepted` 提交,均为重试产物,无需清理(Apple 自动过期)。

---

## 12. 从零到发布的检查清单

```sh
# □ 1. VPN 已开且设置了系统代理(scutil --proxy 看到 HTTPSEnable: 1)
# □ 2. 凭据自检(§2.3 两条命令都通过)
# □ 3. 版本号一致性:根 package.json 与 apps/desktop/package.json 相同
# □ 4. (网络差时)给 prepare-dsh.ts 打 npm 镜像补丁(§5.2)
# □ 5. 打包:
source ~/.deepseek-desktop-release.env
export NODE_USE_SYSTEM_CA=1
export DSH_DESKTOP_NPM_REGISTRY=https://registry.npmmirror.com   # 仅补丁后需要
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
cd /Users/gaoyifan/Desktop/Project/deepseek-harness/apps/desktop
pnpm package:mac:arm64
# □ 6. 公证阶段反复失败时:用 §6.2 驱动脚本重试(保持 VPN 开着)
# □ 7. 验收:§7 的三条命令全部通过
# □ 8. 真机安装冒烟:自己 Mac 装一遍,核心功能可用
# □ 9. (如打过补丁)git checkout apps/desktop/scripts/prepare-dsh.ts
# □ 10. 分发 DMG;需要自动更新时按 §10 重新打包并上传
```

---

## 附:关键文件路径速查

| 文件 | 作用 |
|---|---|
| `apps/desktop/electron-builder.config.mjs` | electron-builder 配置(签名/公证/产物/钩子) |
| `apps/desktop/scripts/package-target.ts` | 打包流水线总入口 |
| `apps/desktop/scripts/package-macos.ts` | ZIP/DMG 双通道编排(含并行公证语义) |
| `apps/desktop/scripts/prepare-dsh.ts` | 运行时依赖安装(硬编码 npm 源在此) |
| `apps/desktop/scripts/desktop-release-environment.mjs` | 环境变量校验规则 |
| `apps/desktop/scripts/verify-macos-signature.mjs` | 签名/公证/DMG 验收实现 |
| `apps/desktop/README.md` | 官方发布文档(含 Windows EV 与上传语义) |
| `~/.deepseek-desktop-release.env` | 本机打包环境变量 |
| `~/.appstoreconnect/AuthKey_TS5PGXAKMP.p8` | 公证 API 私钥(600,只能下载一次) |
