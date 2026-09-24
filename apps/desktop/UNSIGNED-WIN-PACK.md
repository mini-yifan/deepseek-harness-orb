# 无证书 Windows x64 本地打包备忘

在 Windows x64 上打 DeepSeek Orb 安装包时用这份。正式 EV 签名发布仍看 [README.zh.md](README.zh.md) 的「Windows EV 签名」。macOS 预览包看 [UNSIGNED-MAC-PACK.md](UNSIGNED-MAC-PACK.md)。

这条路径产出 NSIS 安装包 `deepseek-harness-<version>-win-x64.exe`。它不签名、不写发布完成记录，`upload:win:x64` 会因缺记录失败。不要提交 `.exe` 或 `win-unpacked/`。

应用 ID 与 [MAC-RELEASE-PACK.md](MAC-RELEASE-PACK.md) 保持一致：`com.miniyifan.deepseek-orb`。未签名包不写自动更新配置，但换 ID 等于换应用。

---

## 1. 每次怎么打

在仓库根目录，PowerShell：

```powershell
$env:DSH_DESKTOP_APP_ID = 'com.miniyifan.deepseek-orb'
$env:NODE_OPTIONS = '--use-system-ca'
pnpm run package:desktop:win:x64:unsigned
```

| 项 | 值 |
|---|---|
| 机器 | Windows x64。`win-x64` 拒绝其他平台和架构 |
| Node / pnpm | 仓库 `package.json` 的 `engines` 与 `packageManager`。本机用过 Node `v24.21.0`、pnpm `11.7.0` |
| Python | 在 `PATH` 上，或把 `PYTHON` 设为可执行文件。本机是 Python `3.11.3` |
| 应用 ID | `DSH_DESKTOP_APP_ID=com.miniyifan.deepseek-orb` |
| 本机 TLS | `NODE_OPTIONS=--use-system-ca`。否则拉 Electron zip 会报 `unable to verify the first certificate` |
| 不需要 | EV 证书、SignTool、SafeNet Token、PIN、COS、更新源 |
| 产物 | `apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts/deepseek-harness-<version>-win-x64.exe` |

当前壳版本是 `0.1.5-rc.2`，所以文件名是 `deepseek-harness-0.1.5-rc.2-win-x64.exe`。本机这次产物约 181 MB（189849922 字节）。换版本后文件名跟着 `apps/desktop/package.json` 的 `version` 变。

同目录还有可直接运行的 `win-unpacked\DeepSeek Orb.exe`。安装包才是要分发的文件。

打开产物目录：

```powershell
explorer.exe "apps\desktop\.desktop-build\targets\win-x64\unsigned-artifacts"
```

在仓库根目录执行。SmartScreen 会拦截未签名安装包，选择仍要运行。

---

## 2. 只做一次的准备

### 2.1 Visual C++ 构建工具

`cl.exe` 不在 `PATH` 上、并且没有 `vswhere.exe` 时，安装带 MSVC 的 Visual Studio 2022 Build Tools。`node-pty` 有预编译包时不会调用编译器；预编译对不上内置 Node 时，安装脚本会走 `node-gyp`。

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --accept-package-agreements --accept-source-agreements --disable-interactivity --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

装完后 `vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath` 应打印 `C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools`。这一步体积大，需要管理员权限。

### 2.2 预先放好 NSIS 和 7-Zip

electron-builder 26.15.3 打 NSIS 时要从 `electron-userland/electron-builder-binaries` 下载编译器。GitHub（`20.205.243.166:443`）超时会停在 `building target=nsis`，前面的官方构建已经做完也会失败。

把这三个文件放进 `%LOCALAPPDATA%\electron-builder\Cache`，校验和必须一致。electron-builder 先读这个缓存，命中后不再访问 GitHub。镜像：

`https://cdn.npmmirror.com/binaries/electron-builder-binaries/`

| 缓存路径（相对 Cache） | SHA-256 |
|---|---|
| `nsis-3.0.4.1\nsis-3.0.4.1.7z` | `9877df902530f96357d13a7a31ae2b9df67f48b11ffc9a1700a7c961574ec5fa` |
| `nsis-resources-3.4.1\nsis-resources-3.4.1.7z` | `593a9a92ef958321293ac6a2ee61e64bf1bd543142a5bd6b3d310709cc924103` |
| `7zip@1.0.0\7zip-win-x64.tar.gz` | `be071f15bd6da2f78fe81c6ddef2009b0c4d8a51f36b780cb806c7e6df95e1b3` |

仓库根目录执行。已有且校验通过的文件会跳过：

```powershell
$ErrorActionPreference = 'Stop'
$mirror = 'https://cdn.npmmirror.com/binaries/electron-builder-binaries'
$cache = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache'
$files = @(
  @{ Rel = 'nsis-3.0.4.1/nsis-3.0.4.1.7z'; Dest = 'nsis-3.0.4.1\nsis-3.0.4.1.7z'; Sha = '9877df902530f96357d13a7a31ae2b9df67f48b11ffc9a1700a7c961574ec5fa' },
  @{ Rel = 'nsis-resources-3.4.1/nsis-resources-3.4.1.7z'; Dest = 'nsis-resources-3.4.1\nsis-resources-3.4.1.7z'; Sha = '593a9a92ef958321293ac6a2ee61e64bf1bd543142a5bd6b3d310709cc924103' },
  @{ Rel = '7zip@1.0.0/7zip-win-x64.tar.gz'; Dest = '7zip@1.0.0\7zip-win-x64.tar.gz'; Sha = 'be071f15bd6da2f78fe81c6ddef2009b0c4d8a51f36b780cb806c7e6df95e1b3' }
)
foreach ($file in $files) {
  $dest = Join-Path $cache $file.Dest
  New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
  if ((Test-Path $dest) -and ((Get-FileHash $dest -Algorithm SHA256).Hash.ToLower() -eq $file.Sha)) { continue }
  Invoke-WebRequest -Uri "$mirror/$($file.Rel)" -OutFile $dest -UseBasicParsing
  $hash = (Get-FileHash $dest -Algorithm SHA256).Hash.ToLower()
  if ($hash -ne $file.Sha) { throw "checksum mismatch for $($file.Dest): $hash" }
}
```

这些校验和来自已安装的 `app-builder-lib@26.15.3`（`out/toolsets/windows.js` 与 `out/toolsets/7zip.js`）。升级 electron-builder 后，先对一下这两个文件再沿用本表。

不要设置 `ELECTRON_BUILDER_BINARIES_MIRROR`。缓存路径按 GitHub 发布名存放；改镜像会换成另一条 URL，缓存对不上，下载还会撞上证书错误。

缓存被清空时，先跑本节再跑第 1 节。

---

## 3. 这条命令实际做了什么

`package:desktop:win:x64:unsigned` 调用 `apps/desktop/scripts/package-target.ts win-x64 --unsigned`。顺序是：

1. `pnpm run build:official`
2. `release:pack` 打 dsh、vendor、landlock，再 pack 私有 `@deepseek-ai/dsh-desktop-host`
3. `prepare:runtime` 下载并校验上游 Node `24.17.0`（`apps/desktop/scripts/prepare-runtime.ts`），并复制锁定的 pnpm
4. `prepare:packages` / `prepare:dsh` 把生产依赖铺进该 target 的 `dsh/`
5. 从 npm 下载 `dshmarket` tarball 到 `plugins/`
6. electron-builder：`DSH_DESKTOP_UNSIGNED=1`，`CSC_IDENTITY_AUTO_DISCOVERY=false`，Windows 7-Zip 过滤器 `BCJ`，只出 NSIS，不写更新元数据

完整 `package:*` 每次都重新做官方构建和准备。`prepare:desktop` 不是它的前半段。

可变状态在 `apps/desktop/.desktop-build/targets/win-x64/`。Node.js 压缩包缓存在 `apps/desktop/.desktop-build/downloads`。

本机在工具和 Electron 已经缓存时，从官方构建到 NSIS 大约十几分钟。第一次还要下载 Node、Electron 和生产依赖。

---

## 4. 密钥不在安装包里

安装包的 `resources` 里没有 `.env`，也没有 `DEEPSEEK_API_KEY` 赋值。

打包后的程序和 CLI 共用 `%USERPROFILE%\.dsh`。查找顺序是进程环境变量、`%USERPROFILE%\.dsh\.credentials.yaml`、项目 `.env`、`%USERPROFILE%\.dsh\.env`。本机这份 `.credentials.yaml` 里已经有密钥，所以第一次打开安装包不用再填。把 `.exe` 拷到没有这份文件的电脑上，仍然要填写密钥。

---

## 5. 失败时看哪里

| 现象 | 处理 |
|---|---|
| `connect ETIMEDOUT` 到 `20.205.243.166:443`，停在 `building target=nsis` | 按第 2.2 节把 NSIS 和 7-Zip 放进 Cache，再执行第 1 节 |
| `unable to verify the first certificate` | 确认第 1 节设了 `NODE_OPTIONS=--use-system-ca`，并且没有设置 `ELECTRON_BUILDER_BINARIES_MIRROR` |
| `desktop package: win-x64 requires a Windows x64 build host` | 换到 Windows x64 再打 |
| 正式命令 `pnpm run package:desktop:win:x64` 因缺少 `DSH_DESKTOP_WINDOWS_*` 失败 | 本地测试继续用 `:unsigned`。签名包需要证书文件、SignTool、SafeNet 容器和 Token PIN |
| 安装后不用填密钥 | 看第 4 节。这是本机 `%USERPROFILE%\.dsh` 里的已有密钥，不是安装包里的密钥 |
