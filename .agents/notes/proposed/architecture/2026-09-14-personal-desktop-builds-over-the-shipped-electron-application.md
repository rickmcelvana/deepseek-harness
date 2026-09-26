# Agent Note: Personal desktop builds over the shipped Electron application

Status: proposed

English | [中文](2026-09-14-personal-desktop-builds-over-the-shipped-electron-application.zh.md)

## Problem

This repository already ships the desktop application that a personal build would otherwise be written to create. `apps/desktop` is the Electron shell and `apps/desktop-host` is the Host it starts under a bundled upstream Node.js; the Host boots the installed dsh project over versioned framed byte pipes and the `dsh-app://` protocol, and the application opens no listening port. One release identity binds the shell, the Web client, the dsh runtime, the bundled Node.js, and the bundled pnpm to the same exact version, so a dsh upgrade is a Desktop release ([packaging and updates](../../implemented/architecture/2026-08-25-electron-desktop-packaging-and-updates.md)).

A user who wants a desktop build of their own — their plugin set, agent presets, theme, and default settings — is therefore tempted to write a second shell. Community wrappers do that, and each one recreates the version split the shipped design exists to prevent: it re-implements the byte-pipe transport, the asset protocol, the profile ownership, the plugin transactions, and the update path, then drifts as either side moves.

This note answers not how to build a desktop application, but which parts of the Desktop experience a personal build can change without becoming a fork, and which ownership boundary keeps that build working across upstream changes.

## Proposal

Use the shipped application as the personal desktop build, and personalize it only through state a deployment already owns. Add no second shell, no second transport, and no second update channel.

### Keep one shell and one Host

`apps/desktop` and `apps/desktop-host` stay as upstream ships them. The personal build is a checkout of this repository at an upstream commit, so the shell, the Host, and dsh keep one version by construction, and no untested combination exists for a maintainer to qualify separately.

### Personalize runtime state, not source

The personal layer is Harness-home state rather than committed source. That keeps the checkout a mirror of upstream, so upstream tracking is a fast-forward with no conflict to resolve.

| What is personalized | Where it lives | Survives `git pull --ff-only` |
|---|---|---|
| External plugins | `dependencies` in `$DSH_HOME/profiles/desktop` | Yes |
| Enabled bundle order | `dsh.profile.bundles` in that profile | Yes |
| Agent presets | The user preset directory under `$DSH_HOME` | Yes |
| Sessions, settings, and credentials | `$DSH_HOME` product data shared with the CLI | Yes |
| Theme and locale selection | Client settings | Yes |

Electron exclusively owns that profile, so only shell-owned UI mutates it: personal plugins are installed through the application's plugin manager, because the CLI cannot boot or mutate `$DSH_HOME/profiles/desktop`.

### Track upstream with a fast-forward

Keep a fork whose default branch follows upstream and pull with `--ff-only`; a rejected pull is the signal that a local commit exists and belongs in the personal layer instead. The lockstep release identity means the pulled commit, not a version range, decides which dsh the shell runs.

Commits that cannot follow the default branch — a local packaging fix, or an identity patch — live on a named branch instead. The current patch set is on `local/desktop-build`, a descendant of the released commit that carries the [Desktop launcher pnpm entrypoint fix](../../implemented/bug-fix/2026-09-14-desktop-launcher-pnpm-entrypoint.md), the [Desktop shell runtime dependency closure fix](../../implemented/bug-fix/2026-09-26-desktop-shell-runtime-dependencies.md), and the `project-doc-site.spec.ts` junction fixture. Replacing a machine restores that working state by cloning the fork, checking the branch out, running `pnpm install`, and rebuilding; the default branch never carries the patches, so the next pull still fast-forwards.

Rebasing the branch onto a pulled default branch applies the patches to the new release and re-records each Agent Note against it. A patch the release has adopted is dropped rather than resolved.

### Build and run it

Development first, then a personal installer, both on Windows x64. Unsigned packaging needs `DSH_DESKTOP_APP_ID` and the native build prerequisites, and writes no update metadata; Linux is not a supported Desktop release target.

```sh
pnpm install
pnpm run dev:desktop
pnpm run package:desktop:win:x64:unsigned
```

A signed build that accepts the official update origin then receives upstream Desktop releases directly. A compatible upgrade refreshes the shared package links in `$DSH_HOME/profiles/desktop` while keeping plugin files, configuration, and versions in place, so the personal layer survives the update that keeps it current.

### Accept or patch the identity surface

Product name, application id, icons, and the update origin are build configuration inside `electron-builder.config.mjs`, and the sidebar brand is a composition choice owned by [`dsh-client-ui-brand-official`](../../../../packages/client/ui-brand-official/README.md). A personal build either accepts the official identity and stays a pure mirror, or carries a small patch series that must be rebased on every pull.

## Alternatives considered

**Tauri 2 shell.** Tauri replaces Chromium with the platform WebView, so the shell must re-implement the framed byte-pipe transport, the `dsh-app://` asset protocol with its index injections, and process teardown over a Rust core, while the signing, notarization, differential-update, and bundled-Node.js and pnpm tooling remains Electron-specific. The client UI is snapshotted against Chromium, so a WebKit renderer on macOS introduces presentation differences that no gate covers, and the result is the unmaintained fork this note exists to avoid.

**Standalone wrapper over published dsh releases.** Resolving `@deepseek-ai/dsh` from npm separates the wrapper's version from the runtime's and forces the wrapper to re-derive the transport, the profile ownership, and the client-asset match that `apps/desktop-host` already implements — the version split the release identity forbids.

**A renamed fork with its own update channel.** Renaming the product and owning the update origin means carrying packaging, signing, notarization, and upload as a permanent fork, and every upstream Desktop change becomes a merge rather than a pull.

**Adopting a community wrapper.** A wrapper maintained outside this repository cannot guarantee that the shell, the Web client, the dsh runtime, and the bundled Node.js stay on one version, so it drifts by construction and no gate in this repository verifies it.

## Acceptance criteria

- `pnpm run dev:desktop` launches the application from a clean checkout on Windows x64 and completes one task end to end.
- `pnpm run package:desktop:win:x64:unsigned` writes an installer under `.desktop-build/targets/win-x64/unsigned-artifacts/` that installs and launches.
- The personal plugins, presets, theme, and settings are present after a fresh launch while `git status` is clean, proving the personal layer is runtime state.
- `git pull --ff-only` advances the checkout to the upstream commit with no conflict.
- `$DSH_HOME/profiles/desktop` is the only profile the personal plugin set changes; CLI profiles are unaffected.

## Risks

- The application is pre-stable at `0.1.5-rc.2`; the profile layout, plugin APIs, and Host protocol carry no compatibility promise, so a personal plugin set can break on a pull.
- An accepted official update replaces the shell, so personalization held outside runtime state is lost by that update.
- Windows x64 is the only target verifiable locally; macOS packaging requires the release environment's signing and notarization credentials.
- Unsigned installers carry no update metadata, so the automatic update path is exercised only by an official release or a fully signed personal build.
