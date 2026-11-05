// Generates the Tokyo Night app and terminal themes from the vendored palette.
// Usage: node scripts/build.mjs           write {themes,terminal}/*.json and scripts/deviations.json
//        node scripts/build.mjs --check   exit 1 if a committed file differs from the output
// Each mapping names an upstream color. A trailing note names the tokyonight.nvim highlight group
// it comes from (lua/tokyonight/groups/*.lua) when the row is not self-evident.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(import.meta.dirname, '..')
const PALETTE = JSON.parse(readFileSync(path.join(ROOT, 'scripts', 'tokyonight-palette.json'), 'utf8'))
const STYLES = ['night', 'storm', 'moon', 'day']

const APP_TOKENS = {
  '--background': 'bg', // Normal
  '--editor-surface': 'bg',
  '--foreground': 'fg',
  '--card': 'bg_float', // NormalFloat
  '--card-foreground': 'fg_float',
  '--popover': 'bg_popup', // Pmenu
  '--popover-foreground': 'fg',
  '--primary': 'blue', // TabLineSel
  '--primary-foreground': 'black',
  '--secondary': 'bg_highlight',
  '--secondary-foreground': 'fg',
  '--muted': 'bg_statusline', // StatusLine
  '--muted-foreground': 'fg_sidebar',
  '--accent': 'bg_highlight', // CursorLine, also Orca's editor line highlight
  '--accent-foreground': 'fg',
  '--border': 'fg_gutter', // Whitespace, AerialGuide: upstream's thin guide lines
  '--input': 'fg_gutter',
  '--ring': 'blue',
  '--chart-1': 'rainbow.0', // rainbow: blue, yellow, green, teal, magenta
  '--chart-2': 'rainbow.1',
  '--chart-3': 'rainbow.2',
  '--chart-4': 'rainbow.3',
  '--chart-5': 'rainbow.4',
  '--sidebar': 'bg_sidebar', // NormalSB
  '--sidebar-foreground': 'fg_sidebar',
  '--sidebar-primary': 'blue',
  '--sidebar-primary-foreground': 'black',
  '--sidebar-accent': 'bg_highlight',
  '--sidebar-accent-foreground': 'fg',
  '--sidebar-border': 'border', // WinSeparator
  '--sidebar-ring': 'blue'
}

const SYNTAX = [
  { name: 'Comments', role: 'comment', fontStyle: 'italic', scope: ['comment', 'punctuation.definition.comment'] },
  { name: 'Variables', role: 'fg', scope: ['variable'] }, // @variable
  { name: 'Builtin variables', role: 'red', scope: ['variable.language', 'support.variable'] }, // @variable.builtin
  { name: 'Parameters', role: 'yellow', scope: ['variable.parameter'] }, // @variable.parameter
  {
    name: 'Properties', // @property, @variable.member
    role: 'green1',
    scope: [
      'variable.other.property',
      'variable.other.object.property',
      'support.variable.property',
      'support.type.property-name',
      'meta.object-literal.key'
    ]
  },
  {
    name: 'Constants', // Constant, Boolean and Number link to it; enum members via @constant
    role: 'orange',
    scope: ['constant', 'variable.other.constant', 'variable.other.enummember']
  },
  {
    name: 'Builtin constants', // @constant.builtin -> Special
    role: 'blue1',
    scope: ['support.constant', 'constant.language.null', 'constant.language.undefined']
  },
  { name: 'Characters', role: 'green', scope: ['constant.character'] }, // Character
  { name: 'Escapes', role: 'magenta', scope: ['constant.character.escape'] }, // @string.escape
  { name: 'Strings', role: 'green', scope: ['string', 'punctuation.definition.string', 'markup.raw'] }, // @markup.raw -> String
  { name: 'Regular expressions', role: 'blue6', scope: ['string.regexp'] }, // @string.regexp
  { name: 'Keywords', role: 'purple', fontStyle: 'italic', scope: ['keyword', 'storage.type', 'storage.modifier'] },
  { name: 'Control flow', role: 'magenta', fontStyle: '', scope: ['keyword.control'] }, // Conditional, Repeat -> Statement
  { name: 'Return and await', role: 'purple', fontStyle: 'italic', scope: ['keyword.control.flow'] }, // @keyword.return
  { name: 'Function keyword', role: 'magenta', fontStyle: '', scope: ['storage.type.function'] }, // @keyword.function
  {
    name: 'Imports, modules and preprocessor', // @keyword.import, @module -> Include; Macro, Define -> PreProc
    role: 'cyan',
    fontStyle: '',
    scope: [
      'keyword.control.import',
      'keyword.control.export',
      'keyword.control.from',
      'keyword.control.directive',
      'meta.preprocessor',
      'entity.name.function.macro',
      'entity.name.namespace'
    ]
  },
  {
    name: 'Operators', // @operator; @keyword.operator links to it
    role: 'blue5',
    fontStyle: '',
    scope: ['keyword.operator', 'storage.type.function.arrow']
  },
  { name: 'Functions', role: 'blue', scope: ['entity.name.function'] }, // Function
  { name: 'Builtin functions', role: 'blue1', scope: ['support.function'] }, // @function.builtin -> Special
  {
    name: 'Types', // Type
    role: 'blue1',
    scope: ['entity.name.type', 'entity.name.class', 'entity.other.inherited-class', 'support.type', 'support.class']
  },
  { name: 'Punctuation', role: 'fg_dark', scope: ['punctuation', 'meta.brace'] }, // @punctuation.bracket
  {
    name: 'Delimiters and interpolation', // @punctuation.delimiter, @punctuation.special
    role: 'blue5',
    scope: [
      'punctuation.separator',
      'punctuation.terminator',
      'punctuation.accessor',
      'punctuation.definition.template-expression',
      'punctuation.section.embedded'
    ]
  },
  { name: 'Tags', role: 'magenta', scope: ['entity.name.tag'] }, // @tag -> Label -> Statement
  { name: 'JSX tags', role: 'red', scope: ['entity.name.tag.tsx', 'entity.name.tag.js'] }, // @tag.tsx, @tag.javascript
  { name: 'Tag delimiters', role: 'blue1', scope: ['punctuation.definition.tag'] }, // @tag.delimiter -> Delimiter -> Special
  { name: 'Attributes', role: 'green1', scope: ['entity.other.attribute-name'] }, // @tag.attribute -> @property
  {
    name: 'Decorators', // @attribute, @annotation -> PreProc
    role: 'cyan',
    scope: ['meta.decorator', 'punctuation.decorator', 'entity.name.function.decorator', 'storage.type.annotation']
  },
  { name: 'Labels', role: 'blue', scope: ['entity.name.label'] }, // @label
  { name: 'Headings', role: 'blue', fontStyle: 'bold', scope: ['markup.heading', 'entity.name.section'] }, // Title
  { name: 'Bold', fontStyle: 'bold', scope: ['markup.bold'] },
  { name: 'Italic', fontStyle: 'italic', scope: ['markup.italic'] },
  { name: 'Strikethrough', fontStyle: 'strikethrough', scope: ['markup.strikethrough'] },
  { name: 'Links', role: 'teal', fontStyle: 'underline', scope: ['markup.underline.link'] }, // @markup.link, @markup.link.url
  { name: 'Link text', role: 'blue1', scope: ['string.other.link'] }, // @markup.link.label -> SpecialChar -> Special
  { name: 'Inline code', role: 'blue', scope: ['markup.inline.raw'] }, // @markup.raw.markdown_inline
  {
    name: 'List markers', // @markup.list.markdown
    role: 'orange',
    fontStyle: 'bold',
    scope: ['punctuation.definition.list', 'beginning.punctuation.definition.list']
  },
  { name: 'Inserted', role: 'git.add', scope: ['markup.inserted'] }, // diffAdded
  { name: 'Deleted', role: 'git.delete', scope: ['markup.deleted'] }, // diffRemoved
  { name: 'Changed', role: 'git.change', scope: ['markup.changed'] }, // diffChanged
  { name: 'Invalid', role: 'error', scope: ['invalid'] } // Error
]

// Orca terminal keys read from upstream's extras/ghostty, verbatim.
const TERMINAL = ['background', 'foreground', 'cursor', 'selectionBackground', 'selectionForeground']
const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
const brightKey = (name) => `bright${name[0].toUpperCase()}${name.slice(1)}`
const CURSOR_ACCENT = 'bg' // Cursor: fg = bg; ghostty does not set it

// Day's fg is 4.52:1 on bg, so every darker Day surface puts fg, fg_sidebar and black under 4.5:1.
// A role can step its OKLCH lightness until it reads on the named surfaces, chroma and hue kept.
const darkened = (role, surfaces) => ({ role, surfaces })
const DAY_TEXT = darkened('fg', ['bg_float', 'bg_popup', 'bg_highlight', 'bg_sidebar'])
const DAY_MUTED = darkened('fg_sidebar', ['bg', 'bg_statusline', 'bg_sidebar'])
const OVERRIDES = {
  day: {
    '--card-foreground': DAY_TEXT,
    '--popover-foreground': DAY_TEXT,
    '--secondary-foreground': DAY_TEXT,
    '--accent-foreground': DAY_TEXT,
    '--sidebar-accent-foreground': DAY_TEXT,
    '--muted-foreground': DAY_MUTED,
    '--sidebar-foreground': DAY_MUTED,
    // Why fg: blue holds no palette color at 4.5:1 in Day, and Day's fg is itself a blue that does.
    '--primary': 'fg',
    '--primary-foreground': 'bg',
    '--sidebar-primary': 'fg',
    '--sidebar-primary-foreground': 'bg',
    '--ring': 'fg',
    '--sidebar-ring': 'fg'
  }
}

// Mirrors CONTRAST_PAIRS and RINGS in Orca's renderer/src/lib/plugin-theme-tokens.ts.
const CONTRAST_PAIRS = [
  ['--background', '--foreground'],
  ['--background', '--muted-foreground'],
  ['--card', '--card-foreground'],
  ['--popover', '--popover-foreground'],
  ['--primary', '--primary-foreground'],
  ['--secondary', '--secondary-foreground'],
  ['--muted', '--muted-foreground'],
  ['--accent', '--accent-foreground'],
  ['--sidebar', '--sidebar-foreground'],
  ['--sidebar-primary', '--sidebar-primary-foreground'],
  ['--sidebar-accent', '--sidebar-accent-foreground']
]
const RINGS = [
  ['--ring', '--background'],
  ['--sidebar-ring', '--sidebar']
]
const MIN_TEXT_CONTRAST = 4.5
const MIN_RING_CONTRAST = 2
const MIN_SYNTAX_CONTRAST = 3
// Why above Orca's floors: margin so rounding in another color pipeline cannot tip a shade under.
const TEXT_TARGET = 4.55
const SYNTAX_TARGET = 3.05

const parseHex = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16))
const toHex = (rgb) =>
  `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`

function luminance(hex) {
  const [r, g, b] = parseHex(hex).map((value) => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const fromLinear = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

function hexToOklab(hex) {
  const [r, g, b] = parseHex(hex).map((c) => toLinear(c / 255))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ]
}

function oklabToHex([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return toHex(
    [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
    ].map((c) => fromLinear(Math.min(1, Math.max(0, c))) * 255)
  )
}

/** Steps OKLCH lightness away from the backgrounds (a, b unchanged keeps chroma and hue). */
function readableOn(hex, backgrounds, dark, target) {
  const [L, a, b] = hexToOklab(hex)
  const step = dark ? 0.001 : -0.001
  const worst = (color) => Math.min(...backgrounds.map((background) => contrast(color, background)))
  let shipped = hex
  for (let next = L; worst(shipped) < target; next += step) {
    if (next < 0 || next > 1) {
      throw new Error(`cannot reach ${target}:1 for ${hex} on ${backgrounds.join(', ')}`)
    }
    shipped = oklabToHex([next, a, b])
  }
  return shipped
}

function buildStyle(style, adjustments) {
  const { dark, colors, terminal } = PALETTE[style]
  const color = (name) => {
    const hex = name.split('.').reduce((node, key) => node?.[key], colors)
    if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) {
      throw new Error(`${style}: unknown palette color "${name}"`)
    }
    return hex.toLowerCase()
  }
  const resolve = (key, fallback) => {
    const mapping = OVERRIDES[style]?.[key] ?? fallback
    if (typeof mapping === 'string') {
      return color(mapping)
    }
    const upstream = color(mapping.role)
    const surfaces = mapping.surfaces.map(color)
    const shipped = readableOn(upstream, surfaces, dark, TEXT_TARGET)
    const ratio = Math.min(...surfaces.map((surface) => contrast(shipped, surface)))
    adjustments.push({ style, kind: 'app', name: key, role: mapping.role, upstream, shipped, ratio, floor: MIN_TEXT_CONTRAST })
    return shipped
  }
  const bg = color('bg')

  const tokens = Object.fromEntries(Object.entries(APP_TOKENS).map(([token, name]) => [token, resolve(token, name)]))
  for (const [surface, text] of CONTRAST_PAIRS) {
    const ratio = contrast(tokens[surface], tokens[text])
    if (ratio < MIN_TEXT_CONTRAST) {
      throw new Error(`${style}: ${surface}/${text} is ${ratio.toFixed(2)}:1, under ${MIN_TEXT_CONTRAST}:1`)
    }
  }
  for (const [ring, surface] of RINGS) {
    const ratio = contrast(tokens[ring], tokens[surface])
    if (ratio < MIN_RING_CONTRAST) {
      throw new Error(`${style}: ${ring}/${surface} is ${ratio.toFixed(2)}:1, under ${MIN_RING_CONTRAST}:1`)
    }
  }

  const syntaxHex = (rule, role) => {
    const upstream = color(role)
    const shipped = readableOn(upstream, [bg], dark, SYNTAX_TARGET)
    if (shipped !== upstream) {
      const ratio = contrast(shipped, bg)
      adjustments.push({ style, kind: 'syntax', name: rule, role, upstream, shipped, ratio, floor: MIN_SYNTAX_CONTRAST })
    }
    return shipped
  }
  const tokenColors = SYNTAX.map(({ name, role, fontStyle, scope }) => ({
    name,
    scope,
    settings: {
      ...(role ? { foreground: syntaxHex(name, role) } : {}),
      ...(fontStyle !== undefined ? { fontStyle } : {})
    }
  }))

  const terminalTheme = {
    schemaVersion: 1,
    mode: dark ? 'dark' : 'light',
    terminal: {
      ...Object.fromEntries(TERMINAL.map((key) => [key, terminal[key]])),
      cursorAccent: color(CURSOR_ACCENT),
      ...Object.fromEntries(ANSI.map((name) => [name, terminal[name]])),
      ...Object.fromEntries(ANSI.map((name) => [brightKey(name), terminal[brightKey(name)]]))
    }
  }

  return {
    [`themes/tokyonight-${style}.json`]: { base: dark ? 'dark' : 'light', tokens, tokenColors },
    [`terminal/tokyonight-${style}.json`]: terminalTheme
  }
}

function assertUniqueScopes() {
  const seen = new Set()
  for (const scope of SYNTAX.flatMap((rule) => rule.scope)) {
    if (seen.has(scope)) {
      throw new Error(`scope "${scope}" is listed twice; the later rule would silently win`)
    }
    seen.add(scope)
  }
}

assertUniqueScopes()
const adjustments = []
const files = Object.assign({}, ...STYLES.map((style) => buildStyle(style, adjustments)))

console.log('Colors changed in OKLCH lightness only (app text to 4.5:1 on its surfaces, syntax to 3:1 on bg):')
console.log('style  kind    name                          role         upstream  shipped   ratio')
for (const { style, kind, name, role, upstream, shipped, ratio } of adjustments) {
  console.log(`${style.padEnd(6)} ${kind.padEnd(7)} ${name.padEnd(29)} ${role.padEnd(12)} ${upstream}   ${shipped}   ${ratio.toFixed(2)}`)
}
if (adjustments.some(({ ratio, floor }) => ratio < floor)) {
  throw new Error('an adjusted color is still under its contrast floor')
}
// Read by scripts/verify.mjs, which checks that each row ships and changes lightness only.
files['scripts/deviations.json'] = adjustments.map(({ style, kind, name, role, upstream, shipped }) => ({
  theme: `tokyonight-${style}`,
  kind,
  name,
  source: role,
  upstream,
  shipped
}))

const check = process.argv.includes('--check')
const stale = []
for (const [relative, data] of Object.entries(files)) {
  const file = path.join(ROOT, relative)
  const text = `${JSON.stringify(data, null, 2)}\n`
  if (check) {
    if (!existsSync(file) || readFileSync(file, 'utf8') !== text) {
      stale.push(relative)
    }
  } else {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, text)
  }
}
if (stale.length) {
  console.error(`Out of date (run node scripts/build.mjs): ${stale.join(', ')}`)
  process.exit(1)
}
console.log(check ? `All ${Object.keys(files).length} generated files are up to date.` : `Wrote ${Object.keys(files).length} files.`)
