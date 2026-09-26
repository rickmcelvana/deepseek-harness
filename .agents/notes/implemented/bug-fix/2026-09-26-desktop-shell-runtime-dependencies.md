# Agent Note: Package the Desktop shell's runtime dependency closure

Status: implemented

English | [中文](2026-09-26-desktop-shell-runtime-dependencies.zh.md)

The [bundled-runtime decision](../architecture/2026-09-08-desktop-bundled-runtime-and-external-plugins.md) owns the `extraResources/dsh` runtime tree and external plugin dependencies; this note owns the shell's own ASAR dependency closure.

## Problem

`0.1.7-alpha.1` made [dsh-api-gateway](../../../../packages/api/gateway) a direct dependency of the Desktop shell, and the packaged Windows application stopped launching. The Electron main process reported `ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/cordis'`, imported from `app.asar\node_modules\@deepseek-ai\dsh-typert-protocol\lib\index.js`, and never reached application code.

electron-builder collects a production dependency closure by walking `dependencies` and `optionalDependencies`, never `peerDependencies`. `@deepseek-ai/cordis` is a peer of every harness package, and `dsh-typert-protocol` imports it at module load. pnpm's strict linker resolves a peer beside its dependent rather than at the importing package's root, so the collector packed the dependent and dropped the peer. The shell tree shipped `dsh-typert-protocol` without `cordis`, and the main process failed while linking modules. The `0.1.5` shell declared no root `dsh-*` packages, so the defect entered with this release.

Four further packages were absent from the same closure: `@deepseek-ai/dsh-client-connection` and `@deepseek-ai/dsh-scope`, the peers that the gateway and [client-connection](../../../../packages/client/connection) import; `@deepseek-ai/dsh-util-crypto`, imported by the gateway's `lib/types/client/remote-events.js`; and `node-addon-require-builtin`, an external package that the shell's own `lib/main.js` imports.

## Decision

[apps/desktop/package.json](../../../../apps/desktop/package.json) declares all five as `dependencies`. The shell imports each of them while it runs, so the declaration states the shell's production closure; the lockfile records the `workspace:^` links.

## Alternatives considered

**Copy the packages in through an electron-builder `files` or `extraResources` entry.** The shell would carry packages that no declaration accounts for, and each later harness package addition would silently need another entry.

**Install the shell hoisted, or with `shamefully-hoist`.** The non-flat layout is deliberate ([pnpm over Yarn](../process/2026-06-16-pnpm-over-yarn.md)), and every other workspace consumer installs from the same layout.

**Declare `cordis` as a dependency of the packages that import it.** Satisfying one packager by renaming the harness peer contract would change the dependency graph for every consumer of those packages.

## Consequences

The packaged application launches. `bufferutil` and `utf-8-validate`, `ws`'s optional performance peers, and `debug`'s `supports-color` stay absent from the packaged tree; each is loaded under its own guard.

Verified by launching the packaged `win-unpacked` application with an isolated `DSH_HOME` and user data directory: the main process opened its window without a module error and initialized the profile home. A walk of the launch graph from the packaged `lib/main.js` resolves every hard import, and the packaged tree contains all five packages.
