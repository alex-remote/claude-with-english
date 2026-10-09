import type { Host } from '../host'

// Where the plugin keeps its files. A mod cannot read CLAUDE_PLUGIN_DATA, so
// the path is built as Claude Code builds it: <plugins root>/data/<id>, the id
// with every character but letters, digits, `_` and `-` turned into `-`
// (manifest-reference.md › Environment variables; docs/references/
// claude-code-docs.md › 数据放哪). Never under `host.plugin.root`: an update
// moves that directory.

/** What the data directory is derived from, as the engine reports it. */
export type DataDirInputs = {
  /** `host.plugin.root` */
  pluginRoot: string
  /** `host.plugin.name`: the id's name when the plugin is loaded from a directory */
  pluginName: string
  home: string | undefined
  configDir: string | undefined
  pluginCacheDir: string | undefined
}

const trimEnd = (path: string) => (path.length > 1 ? path.replace(/\/+$/, '') : path)

/** `CLAUDE_CODE_PLUGIN_CACHE_DIR`, else `<CLAUDE_CONFIG_DIR or ~/.claude>/plugins`. */
export function pluginsRootOf(inputs: Pick<DataDirInputs, 'home' | 'configDir' | 'pluginCacheDir'>): string {
  if (inputs.pluginCacheDir) {
    return trimEnd(inputs.pluginCacheDir)
  }
  if (inputs.configDir) {
    return `${trimEnd(inputs.configDir)}/plugins`
  }
  if (inputs.home) {
    return `${trimEnd(inputs.home)}/.claude/plugins`
  }
  throw new Error('neither CLAUDE_CONFIG_DIR nor HOME is set, so the data directory is unknown')
}

/**
 * `<name>@<marketplace>` when the plugin runs from the install cache
 * (`<plugins root>/cache/<marketplace>/<name>/<version>/`), else `<name>@inline`
 * as for `--plugin-dir`.
 */
export function pluginIdOf(pluginsRoot: string, pluginRoot: string, pluginName: string): string {
  const prefix = `${pluginsRoot}/cache/`
  const root = trimEnd(pluginRoot)
  if (root.startsWith(prefix)) {
    const [marketplace, name, version] = root.slice(prefix.length).split('/')
    if (marketplace && name && version) {
      return `${name}@${marketplace}`
    }
  }
  return `${pluginName}@inline`
}

export const dirNameOfId = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, '-')

export function dataDirFrom(inputs: DataDirInputs): string {
  const pluginsRoot = pluginsRootOf(inputs)
  return `${pluginsRoot}/data/${dirNameOfId(pluginIdOf(pluginsRoot, inputs.pluginRoot, inputs.pluginName))}`
}

// One per Host: the environment cannot change under a running session
const cache = new WeakMap<Host, Promise<string>>()

/** The data directory's absolute path, without a trailing slash. */
export function dataDirOf(host: Host): Promise<string> {
  const known = cache.get(host)
  if (known) {
    return known
  }
  const found = (async () => {
    const [home, configDir, pluginCacheDir] = await Promise.all([
      host.env.home(),
      host.env.configDir(),
      host.env.pluginCacheDir(),
    ])
    return dataDirFrom({
      pluginRoot: host.plugin.root,
      pluginName: host.plugin.name,
      home,
      configDir,
      pluginCacheDir,
    })
  })()
  cache.set(host, found)
  found.catch(() => cache.delete(host))
  return found
}
