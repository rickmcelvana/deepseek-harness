# Upstream defect report — drafts for GitHub Discussions

Four findings from building, packaging, and running the Windows Desktop application on a
standalone pnpm installation. They are independent; post them as separate topics if you prefer.

Shared environment: Windows 11 x64, Node v22.22.3, pnpm 11.7.0 installed standalone
(`@pnpm/exe`, not the npm-installed JavaScript package). Findings 1, 3, and 4 are reproduced at
`0.1.7-alpha.1`; finding 2 was reported at `0.1.5-rc.2` and is fixed upstream.

| # | Finding | State at `0.1.7-alpha.1` |
|---|---|---|
| 1 | `dev:desktop` and `package:desktop:*` cannot start under the standalone pnpm | present |
| 2 | Desktop packaging fails on a stale `fs-ext` expectation | fixed upstream |
| 3 | The packaged Desktop application cannot launch: the shell omits runtime peer dependencies | present |
| 4 | Packaged DOCX→PDF conversion fails while the prepared runtime passes | present |

Note on policy: `CONTRIBUTING.md` states that this repository cannot accept external pull
requests, so these are reports rather than pull requests. A fork branch carrying the fixes is
linked for reference only.

---

## 1. `dev:desktop` and `package:desktop:*` cannot start under the standalone pnpm

### What happens

```sh
pnpm install
pnpm run dev:desktop
```

```
TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".exe" for
C:\Users\<user>\AppData\Local\pnpm\package-manager-store\v11\links\@pnpm\exe\11.7.0\<hash>\node_modules\@pnpm\exe\pnpm.exe
```

`pnpm run package:desktop:win:x64:unsigned` fails identically, before its first build step. Both
are still reproducible at `0.1.7-alpha.1`.

### Cause

`apps/desktop/scripts/dev.ts` and `apps/desktop/scripts/package-target.ts` both start pnpm as
`node $npm_execpath`. That holds only while pnpm is installed as a JavaScript package. The
standalone `@pnpm/exe` distribution sets `npm_execpath` to `pnpm.exe`, so Node is asked to parse
a PE executable as JavaScript.

`scripts/pnpm-invocation.ts` already implements the correct rule — a JavaScript entrypoint runs
through `process.execPath`, every other entrypoint is spawned directly — and is used by
`build.ts`, `run-gates.ts`, `coverage-partitions.ts`, `run-web-snapshots.ts`, and
`release/pack.ts`. These two Desktop launchers spawn `node $npm_execpath` directly instead.

`scripts/release/process.ts` (`pnpmCommand`) and `scripts/build-exe-for-python-sdk.ts` carry
their own private variants of the same rule, so the repository now resolves this entrypoint in
four places.

### Substitutes that do not work

- **Presetting `npm_execpath`** — `pnpm run` overwrites it for every script it starts, so the
  preset value never reaches the script.
- **Corepack** — resolves its own pnpm (v12.4.1 here) and rejects the pinned 11.7.0 with
  `ERR_PNPM_BAD_PM_VERSION`.

The workaround that does work is `pnpm exec`, which preserves a preset `npm_execpath`:

```powershell
$env:npm_execpath = 'node_modules\.pnpm\pnpm@11.7.0\node_modules\pnpm\bin\pnpm.cjs'
pnpm exec tsx apps/desktop/scripts/package-target.ts win-x64 --unsigned
```

### A second, latent issue in the same resolver

`pnpmInvocation` treats a Windows `.cmd`/`.bat` entrypoint as directly spawnable. Node refuses to
spawn one without a shell and reports `EINVAL` (measured on 22.22.3), and the resolver never uses
a shell, so that entrypoint fails with an opaque spawn error rather than an actionable one.
`scripts/build-exe-for-python-sdk.ts` already guards this case in its own private resolver.

### Suggested fix

Route both launchers through `pnpmInvocation`, and reject a Windows command shim with a clear
message.

- Branch: https://github.com/rickmcelvana/deepseek-harness/tree/fix/desktop-pnpm-entrypoint
- Verified at `0.1.5-rc.2`: `pnpm run package:desktop:win:x64:unsigned` completes with **no**
  environment override and produces `deepseek-harness-0.1.5-rc.2-win-x64.exe` (171.7 MB, NSIS +
  block map).
- Verified at `0.1.7-alpha.1`: the same command produces
  `deepseek-harness-0.1.7-alpha.1-win-x64.exe` (299.2 MB). The resolver returns the `.exe`
  itself and `pnpm --version` exits 0.

---

## 2. Desktop packaging fails on a stale `fs-ext` expectation (fixed upstream)

### What happened

At `0.1.5-rc.2`, `pnpm run package:desktop:*` got through `prepare-runtime` and
`prepare-package-set`, then failed in `prepare:dsh` with:

```
Cannot find module 'fs-ext'
```

### Cause

`fs-ext` is not in `pnpm-lock.yaml` and not in any `package.json`. It was removed by the change
that replaced its NAN addon with the prebuilt Node-API `system.node` flock ("feat(native): add
prebuilt Node-API flock support") —
`.agents/notes/implemented/architecture/2026-09-07-prebuilt-system-primitives.md` records the
rationale. Beware when grepping: `/^fs-ext/` also matches `fs-extra`, which is still present.

Five places still assumed the module or its build output: the runtime payload smoke's
`checkFsExt()`, two rules in `apps/desktop/scripts/runtime-file-policy.ts`, an `allowBuilds`
entry in `apps/desktop/src/project-manager.ts`, twelve expectations in
`apps/desktop/tests/runtime-file-policy.spec.ts`, and a `vitest.config.ts` comment.

### Why removing the check was safe

On Windows the session write lock uses koffi, which the same smoke still exercises. The POSIX
flock face lives in the native addon and executes only off-Windows, so the removed assertion was
not the only coverage for anything that still ships.

### State now

The payload smoke no longer calls `checkFsExt()` and reports
`{node, platform, arch, koffi, sharp, html, pty, pnpm, grep, glob}`. The remaining references are
dead rules rather than a blocker. Kept here for the record; no action requested.

---

## 3. The packaged Desktop application cannot launch: the shell omits runtime peer dependencies

### What happens

Install the NSIS installer and launch the application. No window appears; the main process
reports:

```
A JavaScript error occurred in the main process
Uncaught Exception:
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@deepseek-ai/cordis' imported from
C:\Users\<user>\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\node_modules\
@deepseek-ai\dsh-typert-protocol\lib\index.js
```

### Cause

`0.1.7-alpha.1` added `@deepseek-ai/dsh-api-gateway` as a direct dependency of `apps/desktop`.
The `0.1.5-rc.2` shell declared no root `@deepseek-ai/dsh-*` packages at all, so this class of
failure was unreachable before the release.

electron-builder collects a production dependency closure by walking `dependencies` and
`optionalDependencies`, and never `peerDependencies`. `@deepseek-ai/cordis` is a peer of every
harness package, and `dsh-typert-protocol` imports it at module load. pnpm's strict layout
resolves a peer beside its dependent rather than at the importing package's root, so the
collector packs the dependent and drops the peer. The shell tree ships `dsh-typert-protocol`
without `cordis`, and the main process dies while linking modules — before any application code
runs, which is why the failure is a startup dialog rather than a feature error.

Four further packages are absent from the same closure:

- `@deepseek-ai/dsh-client-connection` and `@deepseek-ai/dsh-scope` — the peers of the gateway
  and of `client-connection`, whose `lib/index.js` imports `createScope` from `dsh-scope`;
  `dsh-scope` is itself peer-only, so it is dropped twice over.
- `@deepseek-ai/dsh-util-crypto` — a runtime import of the gateway's
  `lib/types/client/remote-events.js`.
- `node-addon-require-builtin` — an ordinary npm package that the shell's own `lib/main.js`
  imports directly.

### Suggested fix

Declare the shell's runtime closure in `apps/desktop/package.json` `dependencies`. The shell
imports these packages while it runs, so the declaration states the real production closure.

Copying the packages in through an electron-builder `files` or `extraResources` entry would work
but leaves them unaccounted for by any declaration, and each later harness package addition
would silently need one more entry. Installing the shell hoisted would contradict the deliberate
non-flat layout. Declaring `cordis` as a real dependency of the packages that import it would
change the harness peer contract for every consumer to satisfy one packager.

### Evidence after the fix

- A scan of the packaged tree resolves every hard import, and a walk of the launch graph from the
  packaged `lib/main.js` leaves only guarded or optional dependencies: `ws`'s `bufferutil` and
  `utf-8-validate`, and `debug`'s `supports-color` (loaded under its own `try`/`catch`).
- Launching the packaged `win-unpacked` application with an isolated `DSH_HOME` and user data
  directory opens the main window with no module error and initializes the profile home —
  application code the broken build never reached.

---

## 4. Packaged DOCX→PDF conversion fails while the prepared runtime passes

### What happens

`pnpm run package:desktop:win:x64:unsigned` builds the installer, then exits 1 in the final
packaged-runtime smoke:

```
Error: desktop runtime: docx conversion failed: OfficeToPdfError: LibreOffice conversion failed.
  [cause]: ConversionError: LibreOffice native conversion failed: loadComponentFromURL returned an empty reference
```

(`smoke-packaged-runtime.ts` ← `smoke-prepared-runtime.ts` ← `smoke-runtime.ts`)

### Why it reads as packaging-specific

The prepared (unpacked) smoke passes the same DOCX, XLSX, and PPTX→PDF checks in the same run,
and both trees contain the same 2050 payload files. The failure therefore tracks the
asar-packaged layout, or how the packaged runtime reaches LibreOffice, rather than the payload
set or the host process. The error surfaces from the conversion call itself rather than from
locating a binary, so a missing executable is not the leading explanation.

### Impact

The Windows packaging command cannot exit 0, although the installer is produced before this gate.
A failing post-build smoke also makes the release path red for a reason unrelated to the artifact.

### Status

Not diagnosed past the above; no fix is included in the branch below.

---

## Evidence summary

Everything exercised locally for these findings passes: `pnpm run doc-sync` (42 gates),
`scripts/pnpm-invocation.spec.ts`, `apps/desktop/tests/package-target.spec.ts` and
`package-target-stages.spec.ts`, `scripts/project-doc-site.spec.ts`, and the prepared-runtime
smoke's Office round trips. Findings 3 and 4 are independent of findings 1 and 2.

Fixes for findings 1 and 3, plus the junction fixture change that keeps `project-doc-site.spec.ts`
passing without a privileged symlink: `local/desktop-build` on
https://github.com/rickmcelvana/deepseek-harness
