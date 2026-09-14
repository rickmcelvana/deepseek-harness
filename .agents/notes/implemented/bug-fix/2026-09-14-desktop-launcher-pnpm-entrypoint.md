# Agent Note: Bring the Desktop launchers onto the shell-free pnpm resolver

Status: implemented

English | [中文](2026-09-14-desktop-launcher-pnpm-entrypoint.zh.md)

## Problem

[2026-06-16-pnpm-over-yarn.md](../process/2026-06-16-pnpm-over-yarn.md) already records shell-free package-manager re-entry: scripts that start another pnpm command resolve `npm_execpath` by file form, and the native Windows pull-request job provisions `@pnpm/exe` so its inventory supplies a real PE entrypoint. Two Desktop launchers never adopted that resolver and kept spawning `node $npm_execpath`. Under the standalone `@pnpm/exe` distribution Node loaded `pnpm.exe` as JavaScript and failed with `ERR_UNKNOWN_FILE_EXTENSION`, so `pnpm run dev:desktop` and `pnpm run package:desktop:win:x64:unsigned` stopped before their first build step.

Two substitutes are unavailable. `pnpm run` overwrites `npm_execpath` for every script it starts, so a preset value never reaches the script, and Corepack resolves its own pnpm major and rejects the pinned version with `ERR_PNPM_BAD_PM_VERSION`. The resolver also treated a Windows `.cmd` or `.bat` entrypoint as directly spawnable.

## Decision

[dev.ts](../../../../apps/desktop/scripts/dev.ts) and [package-target.ts](../../../../apps/desktop/scripts/package-target.ts) call [pnpmInvocation](../../../../scripts/pnpm-invocation.ts) instead of spawning `process.execPath` with `npm_execpath`, so the pnpm that launched the script is the pnpm that runs the nested command.

A `.cmd` or `.bat` entrypoint has no shell-free form: Node refuses to spawn one without a shell and reports `EINVAL`, measured on Node 22.22.3. The resolver now rejects that entrypoint with an actionable message instead of returning it as a command.

## Alternatives considered

**A private guard in each Desktop launcher.** Each copy would duplicate the rule the resolver already centralizes, and the `EINVAL` gap would survive in every copy.

**Running pnpm through a shell.** The resolver spawns shell-free. A shell reintroduces quoting and metacharacter surface for entrypoints that legitimately contain spaces or `$`, such as `C:\Program Files\...` and the test fixture `$pnpm;.mjs`.

**Resolving the JavaScript package behind a `.cmd` shim through `PNPM_HOME`.** [build-exe-for-python-sdk.ts](../../../../scripts/build-exe-for-python-sdk.ts) does this for its own Windows build, but the fallback guesses a directory layout and can select a pnpm other than the one that launched the script.

## Consequences

Desktop development and packaging start under any pnpm distribution, including the standalone executable. The launchers lost their script-specific messages for a missing `npm_execpath` and now report the resolver's single message. A client test helper still resolves entrypoints privately and is unaffected.

[scripts/pnpm-invocation.spec.ts](../../../../scripts/pnpm-invocation.spec.ts) covers JavaScript entrypoints, directly spawned executables, rejected Windows shims, and an unavailable entrypoint. The launchers delegate to that resolver; their integration is observed through a completed Windows packaging run rather than a unit test.
