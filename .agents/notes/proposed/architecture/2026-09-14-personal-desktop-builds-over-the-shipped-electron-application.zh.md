# Agent Note: 基于已发布 Electron 应用的个人桌面构建

Status: proposed

[English](2026-09-14-personal-desktop-builds-over-the-shipped-electron-application.md) | 中文

## 问题

本仓库已经发布了个人构建本会另行编写的那个桌面应用。`apps/desktop` 是 Electron 壳，`apps/desktop-host` 是它在内置上游 Node.js 下启动的 Host；该 Host 通过带版本的分帧字节管道和 `dsh-app://` 协议启动已安装的 dsh 项目，应用不打开监听端口。发布身份把桌面壳、Web 客户端、dsh 运行时、内置 Node.js 与内置 pnpm 绑定到同一精确版本，因此升级 dsh 就是发布一次 Desktop（[打包与更新](../../implemented/architecture/2026-08-25-electron-desktop-packaging-and-updates.zh.md)）。

想要一个属于自己的桌面构建（自己的插件集、agent 预设、主题和默认设置）的用户，因此很容易去编写第二个壳。社区包装层正是这样做的，而每一个都重新制造了已发布设计本来要避免的版本分裂：它重新实现字节管道通信、资源协议、profile 归属、插件事务和更新路径，然后随着任何一侧的变化而漂移。

本 Agent Note 回答的不是如何构建桌面应用，而是个人构建可以改变 Desktop 体验的哪些部分而不至于变成 fork，以及哪种归属边界能让该构建在上游变化中持续可用。

## 提案

把已发布应用用作个人桌面构建，并且只通过部署本就拥有的状态来做个性化。不添加第二个壳、第二条通信通道或第二个更新频道。

### 保持一个壳和一个 Host

`apps/desktop` 和 `apps/desktop-host` 保持上游发布时的样子。个人构建只是本仓库在上游提交上的检出，因此桌面壳、Host 与 dsh 天然保持同一版本，也不存在需要单独验证的未经验证组合。

### 在运行时状态中个性化，而不是在源码中

个人层是 Harness 主目录状态，而不是提交到仓库的源码。这样检出就保持为上游的镜像，跟进上游因此只是一次无冲突的快进。

| 个性化内容 | 所在位置 | 能否通过 `git pull --ff-only` 保留 |
|---|---|---|
| 外部插件 | `$DSH_HOME/profiles/desktop` 中的 `dependencies` | 能 |
| 启用的 bundle 顺序 | 该 profile 中的 `dsh.profile.bundles` | 能 |
| agent 预设 | `$DSH_HOME` 下的用户预设目录 | 能 |
| 会话、设置与凭据 | 与 CLI 共享的 `$DSH_HOME` 产品数据 | 能 |
| 主题与 locale 选择 | 客户端设置 | 能 |

Electron 独占该 profile，因此只有壳自有 UI 会修改它：个人插件通过应用的插件管理器安装，因为 CLI 不能启动或修改 `$DSH_HOME/profiles/desktop`。

### 用快进方式跟进上游

保留一个默认分支跟随上游的 fork，并用 `--ff-only` 拉取；被拒绝的拉取就是一个信号，说明存在本地提交，而它本应属于个人层。发布身份锁定意味着决定壳运行哪个 dsh 的是被拉取的提交，而不是版本范围。

无法跟随默认分支的提交——本地打包修复或身份补丁——改放在命名分支上。当前补丁集位于 `local/desktop-build`，它是已发布提交的后代，承载 [Desktop 启动器 pnpm 入口修复](../../implemented/bug-fix/2026-09-14-desktop-launcher-pnpm-entrypoint.zh.md)、[Desktop 外壳运行时依赖闭包修复](../../implemented/bug-fix/2026-09-26-desktop-shell-runtime-dependencies.zh.md) 以及 `project-doc-site.spec.ts` 的 junction 夹具。更换机器时，通过克隆 fork、检出该分支、运行 `pnpm install` 并重新构建来恢复该工作状态；默认分支从不承载这些补丁，因此下一次拉取仍能快进。

把该分支变基到拉取后的默认分支上，会将补丁应用到新发布，并针对它重新记录每篇 Agent Note。发布已采用的补丁直接丢弃，而不是去解决冲突。

### 构建并运行

先在开发模式下运行，再生成个人安装包，两者都在 Windows x64 上进行。未签名打包需要 `DSH_DESKTOP_APP_ID` 和原生构建前置条件，且不写入更新元数据；Linux 不是受支持的 Desktop 发布目标。

```sh
pnpm install
pnpm run dev:desktop
pnpm run package:desktop:win:x64:unsigned
```

接受官方更新源地址的已签名构建随后直接接收上游 Desktop 发布。兼容升级会刷新 `$DSH_HOME/profiles/desktop` 中的共享包链接，同时保留插件文件、配置与版本，因此个人层能在让它保持最新的那次更新中存活。

### 接受或修补身份层

产品名称、应用 ID、图标和更新源地址是 `electron-builder.config.mjs` 中的构建配置，而侧边栏品牌是由 [`dsh-client-ui-brand-official`](../../../../packages/client/ui-brand-official/README.zh.md) 拥有的组合选择。个人构建要么接受官方身份并保持为纯镜像，要么携带一小段每次拉取都必须变基的补丁序列。

## 考虑过的替代方案

**Tauri 2 壳。** Tauri 用平台 WebView 取代 Chromium，因此壳必须在 Rust 内核上重新实现分帧字节管道通信、带索引注入的 `dsh-app://` 资源协议以及进程退出流程，而签名、公证、差分更新以及内置 Node.js 与 pnpm 的工具链仍然只属于 Electron。客户端 UI 是针对 Chromium 建立的快照，因此 macOS 上的 WebKit 渲染进程会带来没有门禁覆盖的呈现差异，结果正是本 Agent Note 要避免的那个无人维护的 fork。

**基于已发布 dsh 版本的独立包装层。** 从 npm 解析 `@deepseek-ai/dsh` 会使包装层的版本与运行时版本分离，并迫使包装层重新推导 `apps/desktop-host` 已经实现的通信、profile 归属和客户端资源匹配——这正是发布身份所禁止的版本分裂。

**改名的 fork 与自有更新频道。** 更改产品名称并自持更新源地址意味着把打包、签名、公证和上传作为永久 fork 来维护，而每一次上游 Desktop 变更都变成合并而不是拉取。

**采用社区包装层。** 在本仓库之外维护的包装层无法保证桌面壳、Web 客户端、dsh 运行时与内置 Node.js 停留在同一版本，因此它天生就会漂移，本仓库也没有任何门禁验证它。

## 验收标准

- 在 Windows x64 上，`pnpm run dev:desktop` 能从干净检出启动应用并端到端完成一个任务。
- `pnpm run package:desktop:win:x64:unsigned` 会在 `.desktop-build/targets/win-x64/unsigned-artifacts/` 下写入可安装并启动的安装包。
- 全新启动后个人插件、预设、主题与设置都存在，而 `git status` 保持干净，证明个人层是运行时状态。
- `git pull --ff-only` 无冲突地把检出推进到上游提交。
- `$DSH_HOME/profiles/desktop` 是个人插件集唯一改动的 profile；CLI 的 profile 不受影响。

## 风险

- 应用处于 `0.1.5-rc.2` 预稳定阶段；profile 布局、插件 API 与 Host 协议都不带兼容性承诺，因此个人插件集可能在一次拉取后失效。
- 接受官方更新会替换桌面壳，因此不存放在运行时状态中的个性化会在该更新中丢失。
- Windows x64 是唯一可在本地验证的目标；macOS 打包需要发布环境的签名与公证凭据。
- 未签名安装包不携带更新元数据，因此自动更新路径只能由官方发布或完全签名的个人构建来验证。
