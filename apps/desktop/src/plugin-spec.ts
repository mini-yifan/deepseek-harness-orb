/** Validate Plugin Market npm specs without the old profile mutator. */

import { valid } from 'semver'

const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)$/u
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/u
const IGNORED_PLUGIN_ARGS = new Set(['-w', '--save-exact', '--reporter=ndjson', '--ignore-scripts'])

export type DesktopPluginMutation =
  | { readonly type: 'plugin-add'; readonly spec: string }
  | { readonly type: 'plugin-remove'; readonly name: string }

function assertPackageName(name: string): void {
  if (!PACKAGE_NAME_PATTERN.test(name)) throw new Error(`desktop project: invalid npm package name ${JSON.stringify(name)}`)
}

function assertVersion(version: string): void {
  if (!VERSION_PATTERN.test(version)) throw new Error(`desktop project: invalid exact version ${JSON.stringify(version)}`)
}

/**
 * Validate one registry package spec and return its package name.
 * @param spec - npm registry name with an optional version or tag.
 * @returns Requested package name.
 */
export function packageNameFromSpec(spec: string): string {
  if (spec === '' || spec.startsWith('-') || /[\s\\]/u.test(spec) || spec.includes('://')
    || spec.startsWith('file:') || /^(?:github:|gist:|git\+|git:)/u.test(spec)) {
    throw new Error(`desktop project: unsupported npm package spec ${JSON.stringify(spec)}`)
  }
  if (spec.startsWith('@')) {
    const slash = spec.indexOf('/')
    if (slash === -1) throw new Error(`desktop project: invalid scoped package spec ${JSON.stringify(spec)}`)
    const versionAt = spec.indexOf('@', slash)
    const name = versionAt === -1 ? spec : spec.slice(0, versionAt)
    assertPackageName(name)
    if (versionAt !== -1) assertVersion(spec.slice(versionAt + 1))
    return name
  }
  const versionAt = spec.indexOf('@')
  const name = versionAt === -1 ? spec : spec.slice(0, versionAt)
  assertPackageName(name)
  if (versionAt !== -1) assertVersion(spec.slice(versionAt + 1))
  return name
}

/**
 * Parse Plugin Market `dsh plugin` arguments into an add or remove.
 * @param args - positional plugin command plus flags such as `-w`.
 * @returns the matching mutation.
 */
export function parseDesktopPluginArgs(args: readonly string[]): DesktopPluginMutation {
  const positional: string[] = []
  for (const arg of args) {
    if (IGNORED_PLUGIN_ARGS.has(arg)) continue
    if (arg.startsWith('-')) throw new Error(`desktop project: unsupported plugin argument ${JSON.stringify(arg)}`)
    positional.push(arg)
  }
  const [command, target] = positional
  if (command === 'add') {
    if (target === undefined) throw new Error('desktop project: plugin add requires an npm package spec')
    const name = packageNameFromSpec(target)
    const version = target.slice(name.length + 1)
    if (valid(version) !== version) {
      throw new Error(`desktop project: plugin add requires an exact npm version ${JSON.stringify(target)}`)
    }
    return { type: 'plugin-add', spec: target }
  }
  if (command === 'remove') {
    if (target === undefined) throw new Error('desktop project: plugin remove requires a package name')
    assertPackageName(target)
    return { type: 'plugin-remove', name: target }
  }
  throw new Error(`desktop project: unsupported plugin command ${JSON.stringify(command)}`)
}
