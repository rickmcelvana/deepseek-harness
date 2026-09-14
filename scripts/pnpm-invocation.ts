/** Resolve shell-free child-process invocations for the pnpm process that launched a package script. */

/**
 * Resolve pnpm's executable and arguments from its lifecycle environment.
 * A JavaScript entrypoint runs through the current Node.js binary; any other entrypoint runs
 * directly, which covers the standalone pnpm executable. A Windows command shim has no
 * shell-free form and is rejected rather than spawned.
 * @param args - Arguments to pass to pnpm.
 * @param environment - Lifecycle environment containing `npm_execpath`.
 * @returns A command and argument array suitable for `spawn` or `spawnSync` without a shell.
 */
export function pnpmInvocation(
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): { command: string; args: string[] } {
  const entrypoint = environment.npm_execpath
  if (entrypoint === undefined || entrypoint === '') {
    throw new Error('pnpm invocation: npm_execpath is unavailable; invoke the script through pnpm run.')
  }
  if (/\.[cm]?js$/iu.test(entrypoint)) {
    return { command: process.execPath, args: [entrypoint, ...args] }
  }
  // Node refuses to spawn a .cmd/.bat without a shell (EINVAL), and this module never uses one.
  if (/\.(?:cmd|bat)$/iu.test(entrypoint)) {
    throw new Error(`pnpm invocation: npm_execpath ${entrypoint} is a Windows command shim, which cannot run without a shell; invoke the script through a pnpm installation that exposes a JavaScript entrypoint.`)
  }
  return { command: entrypoint, args: [...args] }
}
