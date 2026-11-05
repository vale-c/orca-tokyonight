// Generates the Tokyo Night app and terminal themes from the vendored palette.
// Usage: node scripts/build.mjs           write {themes,terminal}/*.json and scripts/deviations.json
//        node scripts/build.mjs --check   exit 1 if a committed file differs from the output
// Each mapping names an upstream color. A trailing note names the tokyonight.nvim highlight group
// it comes from (lua/tokyonight/groups/*.lua), or the extra (lua/tokyonight/extra/*.lua), when the
// row is not self-evident.
// A mapping is a palette color, or { role | blend, alpha, readable, min, mixedWith, percent }:
// `blend` mixes a palette color into bg at `alpha` with upstream's Util.blend_bg, and `readable`
// steps OKLCH lightness until the color (or `mixedWith` mixed `percent`% into it) and each listed
// token or palette color are at `min` (default 4.5:1) contrast.
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
  '--sidebar-ring': 'blue',
  '--worktree-sidebar-active': 'bg_visual', // QuickFixLine: the current item of a list
  '--tab-bar': { blend: 'bg_highlight', alpha: 0.8 }, // barbar BufferTabpageFill
  '--tab-active': 'bg', // barbar BufferCurrent
  '--tab-active-foreground': { role: 'fg', readable: ['--tab-active', '--tab-inactive'] }, // BufferCurrent
  '--tab-active-indicator': 'git.change', // bufferline BufferLineIndicatorSelected
  '--tab-inactive': { blend: 'bg_highlight', alpha: 0.4 }, // barbar BufferInactive
  '--tab-inactive-foreground': { blend: 'dark5', alpha: 0.8, readable: ['--tab-inactive'] }, // BufferInactive
  // Why fg_gutter, not WinSeparator's border: border is 1.05:1 on bg, so split editors would show
  // no edge. fg_gutter is upstream's guide-line color, as for --border.
  '--split-divider': 'fg_gutter',
  '--split-divider-hover': 'border_highlight', // FloatBorder: upstream's highlighted border
  '--chat-user-message': 'bg_dark', // extras/pi userMessageBg
  '--text-link': { role: 'teal', readable: ['--editor-surface'] }, // @markup.link, extras/pi mdLink
  // Why mixedWith: Orca writes chat diff text as --foreground mixed 30% into this hue, on the line
  // tint, so the hue steps until that text reads.
  '--diff-added': { role: 'git.add', readable: ['--diff-added-background'], mixedWith: '--foreground', percent: 30 }, // GitSignsAdd, delta line-numbers-plus-style
  '--diff-added-background': { role: 'diff.add', readable: ['--foreground'] }, // DiffAdd, delta plus-style
  '--diff-added-emphasis': { role: 'delta.add', readable: ['--foreground'] }, // delta plus-emph-style
  '--diff-removed': { role: 'git.delete', readable: ['--diff-removed-background'], mixedWith: '--foreground', percent: 30 }, // GitSignsDelete
  '--diff-removed-background': { role: 'diff.delete', readable: ['--foreground'] }, // DiffDelete, delta minus-style
  '--diff-removed-emphasis': { role: 'delta.delete', readable: ['--foreground'] }, // delta minus-emph-style
  // nvim-tree: NvimTreeGitNew, NvimTreeGitDirty, NvimTreeGitDeleted; ignored is the palette's
  // git.ignore and renamed is extras/eza git.renamed. Upstream has no copied color, and a copy is a
  // new path, which NvimTreeGitNew marks with git.add.
  '--git-decoration-added': { role: 'git.add', readable: ['--sidebar'], min: 3 },
  '--git-decoration-modified': { role: 'git.change', readable: ['--sidebar'], min: 3 },
  '--git-decoration-deleted': { role: 'git.delete', readable: ['--sidebar'], min: 3 },
  '--git-decoration-renamed': { role: 'blue1', readable: ['--sidebar'], min: 3 },
  '--git-decoration-untracked': { role: 'git.add', readable: ['--sidebar'], min: 3 },
  '--git-decoration-copied': { role: 'git.add', readable: ['--sidebar'], min: 3 },
  '--git-decoration-ignored': { role: 'git.ignore', readable: ['--sidebar'], min: 3 }
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
const DAY_TEXT = { role: 'fg', readable: ['bg_float', 'bg_popup', 'bg_highlight', 'bg_sidebar'] }
const DAY_MUTED = { role: 'fg_sidebar', readable: ['bg', 'bg_statusline', 'bg_sidebar'] }
// null leaves the token to Orca (scripts/derived-tokens.json says why).
// Why: Moon's and Day's sidebar text is under 4.5:1 on every upstream selection fill.
const NO_ACTIVE_ROW = { '--worktree-sidebar-active': null }
const OVERRIDES = {
  moon: NO_ACTIVE_ROW,
  day: {
    ...NO_ACTIVE_ROW,
    // Why: Day's fg is under 4.5:1 on every surface darker than bg, so no upstream fill for the
    // user's chat message reads.
    '--chat-user-message': null,
    // Why blue1, @markup.link.label: Day's teal leaves sRGB before it reaches 4.5:1 on bg.
    '--text-link': { role: 'blue1', readable: ['--editor-surface'] },
    // Why diff.delete: Day's tints must be lighter than bg for fg to read, and delta's darker pink
    // leaves sRGB before it gets there.
    '--diff-removed-emphasis': { role: 'diff.delete', readable: ['--foreground'] },
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
  ['--sidebar-accent', '--sidebar-accent-foreground'],
  ['--worktree-sidebar-active', '--sidebar-foreground'],
  ['--tab-active', '--tab-active-foreground'],
  ['--tab-inactive', '--tab-inactive-foreground'],
  ['--tab-inactive', '--tab-active-foreground'],
  ['--diff-added-background', '--foreground'],
  ['--diff-added-emphasis', '--foreground'],
  ['--diff-removed-background', '--foreground'],
  ['--diff-removed-emphasis', '--foreground'],
  ['--editor-surface', '--text-link']
]
const RINGS = [
  ['--ring', '--background'],
  ['--sidebar-ring', '--sidebar'],
  ['--tab-active-indicator', '--tab-active']
]
const GIT_DECORATIONS = ['added', 'modified', 'deleted', 'renamed', 'untracked', 'copied', 'ignored']
const MIN_STATUS_CONTRAST = 3
const MIN_TEXT_CONTRAST = 4.5
const MIN_RING_CONTRAST = 2
const MIN_SYNTAX_CONTRAST = 3
// Why above Orca's floors: margin so rounding in another color pipeline cannot tip a shade under.
const MARGIN = 0.05

const parseHex = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16))
const toHex = (rgb) =>
  `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`

/** tokyonight.nvim's Util.blend: `alpha` of `foreground` over `background`, per sRGB channel. */
function blend(foreground, alpha, background) {
  const [fg, bg] = [parseHex(foreground), parseHex(background)]
  const channel = (index) => Math.floor(Math.min(Math.max(0, alpha * fg[index] + (1 - alpha) * bg[index]), 255) + 0.5)
  return `#${[0, 1, 2].map((index) => channel(index).toString(16).padStart(2, '0')).join('')}`
}

/** CSS `color-mix(in srgb, a percent%, b)`, as Orca derives a token. */
function mix(a, percent, b) {
  const [x, y] = [parseHex(a), parseHex(b)]
  return toHex([0, 1, 2].map((index) => (x[index] * percent + y[index] * (100 - percent)) / 100))
}

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

/**
 * Steps OKLCH lightness away from the other colors (a, b unchanged keeps chroma and hue) until
 * `seen(color)`, the color as Orca paints it, reads on each of them.
 */
function readableOn(hex, backgrounds, target, seen = (color) => color) {
  const [L, a, b] = hexToOklab(hex)
  const step = luminance(seen(hex)) >= luminance(backgrounds[0]) ? 0.001 : -0.001
  const worst = (color) => Math.min(...backgrounds.map((background) => contrast(seen(color), background)))
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
  const { dark, colors, terminal, delta } = PALETTE[style]
  const palette = { ...colors, delta }
  const color = (name) => {
    const hex = name.split('.').reduce((node, key) => node?.[key], palette)
    if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) {
      throw new Error(`${style}: unknown palette color "${name}"`)
    }
    return hex.toLowerCase()
  }
  const bg = color('bg')
  // Why: proves this blend is upstream's, since delta.add is Util.blend_bg(green2, 0.45) upstream.
  if (blend(color('green2'), 0.45, bg) !== color('delta.add')) {
    throw new Error(`${style}: Util.blend_bg(green2, 0.45) is not extras/delta's ${color('delta.add')}`)
  }

  const mappings = { ...APP_TOKENS, ...OVERRIDES[style] }
  const tokens = {}
  const resolve = (token) => {
    if (token in tokens) {
      return tokens[token]
    }
    const mapping = mappings[token]
    if (!mapping) {
      throw new Error(`${style}: ${token} is not set by this style`)
    }
    const spec = typeof mapping === 'string' ? { role: mapping } : mapping
    const role = spec.blend ? `${spec.blend} at ${spec.alpha * 100}% on bg` : spec.role
    const upstream = spec.blend ? blend(color(spec.blend), spec.alpha, bg) : color(spec.role)
    let shipped = upstream
    if (spec.readable) {
      const floor = spec.min ?? MIN_TEXT_CONTRAST
      const surfaces = spec.readable.map((name) => (name.startsWith('--') ? resolve(name) : color(name)))
      const seen = spec.mixedWith ? (hex) => mix(resolve(spec.mixedWith), spec.percent, hex) : (hex) => hex
      shipped = readableOn(upstream, surfaces, floor + MARGIN, seen)
      if (shipped !== upstream) {
        const ratio = Math.min(...surfaces.map((surface) => contrast(seen(shipped), surface)))
        adjustments.push({ style, kind: 'app', name: token, role, upstream, shipped, ratio, floor })
      }
    }
    tokens[token] = shipped
    return shipped
  }
  const ordered = Object.keys(mappings).filter((token) => mappings[token] !== null)
  for (const token of ordered) {
    resolve(token)
  }
  const appTokens = Object.fromEntries(ordered.map((token) => [token, tokens[token]]))

  for (const [surface, text] of CONTRAST_PAIRS) {
    if (!(surface in appTokens && text in appTokens)) {
      continue
    }
    const ratio = contrast(appTokens[surface], appTokens[text])
    if (ratio < MIN_TEXT_CONTRAST) {
      throw new Error(`${style}: ${surface}/${text} is ${ratio.toFixed(2)}:1, under ${MIN_TEXT_CONTRAST}:1`)
    }
  }
  for (const [ring, surface] of RINGS) {
    const ratio = contrast(appTokens[ring], appTokens[surface])
    if (ratio < MIN_RING_CONTRAST) {
      throw new Error(`${style}: ${ring}/${surface} is ${ratio.toFixed(2)}:1, under ${MIN_RING_CONTRAST}:1`)
    }
  }
  for (const status of GIT_DECORATIONS) {
    const ratio = contrast(appTokens[`--git-decoration-${status}`], appTokens['--sidebar'])
    if (ratio < MIN_STATUS_CONTRAST) {
      throw new Error(`${style}: --git-decoration-${status} is ${ratio.toFixed(2)}:1 on --sidebar, under ${MIN_STATUS_CONTRAST}:1`)
    }
  }

  const syntaxHex = (rule, role) => {
    const upstream = color(role)
    const shipped = readableOn(upstream, [bg], MIN_SYNTAX_CONTRAST + MARGIN)
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
    [`themes/tokyonight-${style}.json`]: { base: dark ? 'dark' : 'light', tokens: appTokens, tokenColors },
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
