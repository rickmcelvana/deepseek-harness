# Agent Note: 让 Desktop 启动器改用无 shell 的 pnpm 解析器

Status: implemented

[English](2026-09-14-desktop-launcher-pnpm-entrypoint.md) | 中文

## 问题

[2026-06-16-pnpm-over-yarn.md](../process/2026-06-16-pnpm-over-yarn.zh.md) 已经记录了无 shell 的包管理器再进入：需要启动另一条 pnpm 命令的脚本按文件形式解析 `npm_execpath`，而原生 Windows 拉取请求作业会提供 `@pnpm/exe`，因此其清单会产生真实的 PE 入口。两个 Desktop 启动器从未采用该解析器，仍以 `node $npm_execpath` 启动。在独立分发的 `@pnpm/exe` 下，Node 把 `pnpm.exe` 当作 JavaScript 加载，并以 `ERR_UNKNOWN_FILE_EXTENSION` 失败，于是 `pnpm run dev:desktop` 与 `pnpm run package:desktop:win:x64:unsigned` 都在第一个构建步骤之前停止。

两种替代做法都不可用。`pnpm run` 会为它启动的每个脚本覆盖 `npm_execpath`，因此预设值永远到不了脚本；Corepack 则解析出自己的 pnpm 主版本，并以 `ERR_PNPM_BAD_PM_VERSION` 拒绝固定版本。该解析器此前还把 Windows 的 `.cmd` 或 `.bat` 入口当作可直接启动。

## 决策

[dev.ts](../../../../apps/desktop/scripts/dev.ts) 与 [package-target.ts](../../../../apps/desktop/scripts/package-target.ts) 调用 [pnpmInvocation](../../../../scripts/pnpm-invocation.ts)，而不是以 `process.execPath` 加上 `npm_execpath` 启动，因此启动脚本的 pnpm 就是运行嵌套命令的 pnpm。

`.cmd` 或 `.bat` 入口没有无 shell 的形式：Node 拒绝在没有 shell 的情况下启动它，并报 `EINVAL`，已在 Node 22.22.3 上实测。解析器现在会带有可操作信息地拒绝该入口，而不是把它当作命令返回。

## 考虑过的替代方案

**在每个 Desktop 启动器中各写一份防护。** 每份副本都会重复解析器已经集中的规则，而 `EINVAL` 缺口会在每份副本中留存。

**通过 shell 运行 pnpm。** 该解析器一律无 shell 启动。shell 会为那些合法包含空格或 `$` 的入口重新引入引号与元字符处理面，例如 `C:\Program Files\...` 和测试夹具 `$pnpm;.mjs`。

**通过 `PNPM_HOME` 解析 `.cmd` shim 背后的 JavaScript 包。** [build-exe-for-python-sdk.ts](../../../../scripts/build-exe-for-python-sdk.ts) 为它自己的 Windows 构建这样做，但该回退在猜测目录布局，可能选中与启动脚本的那个不同的 pnpm。

## 后果

桌面开发与打包现在可以在任何 pnpm 分发下启动，包括独立可执行文件。启动器失去了各自针对 `npm_execpath` 缺失的专属信息，改为报告解析器统一的信息。一个客户端测试辅助函数仍在私下解析入口，不受影响。

[scripts/pnpm-invocation.spec.ts](../../../../scripts/pnpm-invocation.spec.ts) 覆盖 JavaScript 入口、直接启动的可执行文件、被拒绝的 Windows shim，以及入口缺失。启动器委托给该解析器；它们之间的集成通过一次完成的 Windows 打包运行来观察，而不是通过单元测试。
