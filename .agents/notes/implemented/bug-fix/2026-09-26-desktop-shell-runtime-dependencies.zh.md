# Agent Note: 打包 Desktop 外壳的运行时依赖闭包

Status: implemented

[English](2026-09-26-desktop-shell-runtime-dependencies.md) | 中文

[打包运行时决策](../architecture/2026-09-08-desktop-bundled-runtime-and-external-plugins.zh.md) 拥有 `extraResources/dsh` 运行时树与外部插件依赖；本笔记拥有外壳自身的 ASAR 依赖闭包。

## 问题

`0.1.7-alpha.1` 让 [dsh-api-gateway](../../../../packages/api/gateway) 成为 Desktop 外壳的直接依赖，随后打包后的 Windows 应用无法启动。Electron 主进程报出 `ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/cordis'`，导入方为 `app.asar\node_modules\@deepseek-ai\dsh-typert-protocol\lib\index.js`，并且从未执行到应用代码。

electron-builder 收集生产依赖闭包时只遍历 `dependencies` 与 `optionalDependencies`，从不遍历 `peerDependencies`。`@deepseek-ai/cordis` 是每个 harness 包的 peer，而 `dsh-typert-protocol` 在模块加载时导入它。pnpm 的严格链接器把 peer 解析在依赖方旁边，而不是导入包的根目录，于是收集器打包了依赖方却丢掉了 peer。外壳树中因此有 `dsh-typert-protocol` 而没有 `cordis`，主进程在链接模块时失败。`0.1.5` 的外壳没有声明任何根级 `dsh-*` 包，因此该缺陷随本版本进入。

同一闭包中还缺四个包：网关注入与 [client-connection](../../../../packages/client/connection) 导入的 peer `@deepseek-ai/dsh-client-connection` 与 `@deepseek-ai/dsh-scope`；网关注入 `lib/types/client/remote-events.js` 导入的 `@deepseek-ai/dsh-util-crypto`；以及外壳自身的 `lib/main.js` 导入的外部包 `node-addon-require-builtin`。

## 决策

[apps/desktop/package.json](../../../../apps/desktop/package.json) 将这五个包全部声明为 `dependencies`。外壳在运行时导入它们，因此该声明陈述的是外壳的生产闭包；锁文件记录了 `workspace:^` 链接。

## 考虑过的替代方案

**通过 electron-builder 的 `files` 或 `extraResources` 条目复制这些包。** 外壳会携带没有任何声明负责的包，而且之后每新增一个 harness 包都会悄悄再需要一条条目。

**以 hoisted 或 `shamefully-hoist` 方式安装外壳。** 非扁平布局是有意为之（[pnpm over Yarn](../process/2026-06-16-pnpm-over-yarn.zh.md)），工作区的其他所有使用方也都从同一布局安装。

**把 `cordis` 声明为导入它的那些包的依赖。** 为满足一个打包器而改写 harness 的 peer 约定，会改变那些包所有使用方的依赖图。

## 后果

打包后的应用可以启动。`ws` 的可选性能 peer `bufferutil` 与 `utf-8-validate`，以及 `debug` 的 `supports-color`，仍然不在打包树中；它们各自在自己的防护下加载。

已通过在隔离的 `DSH_HOME` 与用户数据目录下启动打包后的 `win-unpacked` 应用验证：主进程在没有模块错误的情况下打开了窗口，并初始化了 profile 主目录。从打包后的 `lib/main.js` 遍历启动图可解析每一个硬导入，且打包树中包含全部五个包。
