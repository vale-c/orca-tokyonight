// Runs the generated themes through Orca's own theme, Monaco and terminal code.
// Usage: ORCA_DIR=/path/to/orca node scripts/verify.mjs
import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const orcaDir = process.env.ORCA_DIR
if (!orcaDir) {
  console.error('Set ORCA_DIR to an Orca checkout with dependencies installed.')
  process.exit(2)
}
const { loadPluginSchemaModule } = await import(
  pathToFileURL(path.join(orcaDir, 'config', 'scripts', 'plugin-schema-module-loader.mjs')).href
)
const runtime = (file) => loadPluginSchemaModule(path.join('..', '..', file))
const { safePluginThemeTokens } = runtime('renderer/src/lib/plugin-theme-tokens.ts')
const { derivePluginMonacoTheme } = runtime('renderer/src/lib/plugin-monaco-theme.ts')
const { parsePluginAppThemeArtifact } = runtime('shared/plugins/artifacts/plugin-theme-artifact.ts')
const { parsePluginTerminalThemeArtifact } = runtime(
  'shared/plugins/artifacts/plugin-terminal-theme-artifact.ts'
)

const pluginDir = path.resolve(import.meta.dirname, '..')
const manifest = JSON.parse(readFileSync(path.join(pluginDir, 'orca-plugin.json'), 'utf8'))
const read = (relative) => readFileSync(path.join(pluginDir, relative), 'utf8')

const hexProbe = (value) => {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value.trim())
  if (!match) {
    return null
  }
  const [r, g, b] = [0, 2, 4].map((index) => parseInt(match[1].slice(index, index + 2), 16))
  return [r, g, b, match[2] ? parseInt(match[2], 16) / 255 : 1]
}

const failures = []
const check = (ok, message) => {
  if (!ok) {
    failures.push(message)
  }
}

for (const contribution of manifest.contributes.themes) {
  const { id, path: file } = contribution
  const raw = JSON.parse(read(file))
  const theme = parsePluginAppThemeArtifact(read(file))
  // Why no built-ins: the theme sets or derives every token in a contrast pair, so none apply.
  const safe = safePluginThemeTokens(theme.tokens, {}, hexProbe)
  const set = Object.keys(theme.tokens)
  for (const token of set.filter((token) => !(token in safe))) {
    check(false, `${id}: ${token} (${theme.tokens[token]}) dropped by safePluginThemeTokens`)
  }

  const monaco = derivePluginMonacoTheme({
    base: theme.base,
    read: (token) => safe[token] ?? '',
    probe: hexProbe,
    tokenColors: theme.tokenColors
  })
  check(monaco !== null, `${id}: derivePluginMonacoTheme returned null`)
  const rules = new Map((monaco?.data.rules ?? []).map((rule) => [rule.token, rule]))
  let dropped = 0
  for (const rule of raw.tokenColors.filter((rule) => rule.settings.foreground)) {
    for (const scope of rule.scope) {
      const shipped = rules.get(scope)?.foreground
      if (shipped?.toLowerCase() !== rule.settings.foreground.toLowerCase()) {
        dropped += 1
        check(false, `${id}: "${rule.name}" ${scope} ${rule.settings.foreground} became ${shipped ?? 'nothing'}`)
      }
    }
  }
  console.log(
    `${id}: tokens kept ${Object.keys(safe).length}/${set.length}, Monaco rules ${rules.size}, dropped syntax colors ${dropped}`
  )
}

for (const { id, path: file } of manifest.contributes.terminalThemes) {
  try {
    const { mode, terminal } = parsePluginTerminalThemeArtifact(read(file), 'strict')
    console.log(`${id} terminal: mode ${mode}, ${Object.keys(terminal).length} colors`)
  } catch (error) {
    check(false, `${id} terminal: ${error.message}`)
  }
}

if (failures.length) {
  console.error(`\n${failures.length} failure(s):\n${failures.join('\n')}`)
  process.exit(1)
}
console.log('All themes pass Orca runtime checks.')
