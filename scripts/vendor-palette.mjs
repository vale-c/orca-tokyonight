// Copies the computed Tokyo Night palettes and terminal colors out of a tokyonight.nvim checkout.
// Usage: node scripts/vendor-palette.mjs /path/to/tokyonight.nvim
// Writes scripts/tokyonight-palette.json. Run it only to move to a newer upstream commit.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const upstream = process.argv[2]
if (!upstream) {
  console.error('Pass the path of a tokyonight.nvim checkout.')
  process.exit(2)
}
const STYLES = { night: true, storm: true, moon: true, day: false }
const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']

/** The `local colors = { ... }` table of extras/lua/tokyonight_<style>.lua as JSON. */
function luaColors(style) {
  const source = readFileSync(path.join(upstream, 'extras', 'lua', `tokyonight_${style}.lua`), 'utf8')
  const block = /^local colors = (\{\n[\s\S]*?\n\})\n/m.exec(source)
  if (!block) {
    throw new Error(`${style}: no colors table in extras/lua`)
  }
  const json = block[1]
    .replace(/\{ ("[^\n]*") \}/g, '[$1]')
    .replace(/^(\s*)(\w+) = /gm, '$1"$2": ')
    .replace(/,(\s*[}\]])/g, '$1')
  const { _name, _style, none, ...colors } = JSON.parse(json)
  return colors
}

/** extras/ghostty/tokyonight_<style>: the 16 ANSI colors and the terminal's own colors. */
function ghostty(style) {
  const source = readFileSync(path.join(upstream, 'extras', 'ghostty', `tokyonight_${style}`), 'utf8')
  const value = (key) => {
    const match = new RegExp(`^${key} = (#[0-9a-f]{6})$`, 'm').exec(source)
    if (!match) {
      throw new Error(`${style}: ghostty has no ${key}`)
    }
    return match[1]
  }
  const palette = Array.from({ length: 16 }, (_, index) => {
    const match = new RegExp(`^palette = ${index}=(#[0-9a-f]{6})$`, 'm').exec(source)
    if (!match) {
      throw new Error(`${style}: ghostty has no palette color ${index}`)
    }
    return match[1]
  })
  return {
    background: value('background'),
    foreground: value('foreground'),
    cursor: value('cursor-color'),
    selectionBackground: value('selection-background'),
    selectionForeground: value('selection-foreground'),
    ...Object.fromEntries(ANSI.map((name, index) => [name, palette[index]])),
    ...Object.fromEntries(ANSI.map((name, index) => [`bright${name[0].toUpperCase()}${name.slice(1)}`, palette[index + 8]]))
  }
}

const commit = execFileSync('git', ['-C', upstream, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const out = { repository: 'https://github.com/folke/tokyonight.nvim', commit }
for (const [style, dark] of Object.entries(STYLES)) {
  const colors = luaColors(style)
  const terminal = ghostty(style)
  // Why: both extras come from one upstream palette, so a mismatch means a broken parse.
  for (const name of ANSI) {
    if (terminal[name] !== colors.terminal[name].toLowerCase()) {
      throw new Error(`${style}: ghostty ${name} ${terminal[name]} differs from extras/lua ${colors.terminal[name]}`)
    }
  }
  out[style] = { dark, colors, terminal }
}
writeFileSync(path.join(import.meta.dirname, 'tokyonight-palette.json'), `${JSON.stringify(out, null, 2)}\n`)
console.log(`Vendored ${Object.keys(STYLES).join(', ')} from ${commit}.`)
