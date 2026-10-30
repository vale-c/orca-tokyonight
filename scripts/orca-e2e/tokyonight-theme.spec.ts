import { execFileSync } from 'node:child_process'
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { disablePluginSystem, editorTokenColor, enableDevPlugins, openRepoFile } from './helpers/plugin-smoke'
import { discoverActivePtyId, execInTerminal, waitForTerminalOutput } from './helpers/terminal'

const PLUGIN = process.env.TOKYONIGHT_PLUGIN_DIR as string
const SHOTS = process.env.TOKYONIGHT_SHOTS_DIR as string
const DEMO_ROOT = process.env.TOKYONIGHT_DEMO_DIR as string
const KEY = 'vale-c.tokyonight'
const STYLES = [
  { id: 'tokyonight-night', title: 'Tokyo Night', base: 'dark' },
  { id: 'tokyonight-storm', title: 'Tokyo Night Storm', base: 'dark' },
  { id: 'tokyonight-moon', title: 'Tokyo Night Moon', base: 'dark' },
  { id: 'tokyonight-day', title: 'Tokyo Night Day', base: 'light' }
] as const
const CODE_FILE = 'src/palette.ts'
const CODE = `// Resolve the palette for the active workspace.
import { createTheme, type Theme } from './theme'

export type Style = 'night' | 'storm' | 'moon' | 'day'

export interface Workspace {
  name: string
  tabs: number
  style: Style
  pinned?: boolean
}

const BACKGROUNDS: Record<Style, string> = {
  night: '#1a1b26',
  storm: '#24283b',
  moon: '#222436',
  day: '#e1e2e7'
}

/** Pick a compact layout once a workspace has more than a dozen tabs. */
export function openWorkspace(ws: Workspace): Theme {
  const theme = createTheme({ contrast: 0.92, accent: 'blue' })
  if (ws.tabs > 12 && !ws.pinned) {
    return theme.compact()
  }
  return { ...theme, title: \`\${ws.name} (\${ws.style})\`, background: BACKGROUNDS[ws.style] }
}

export async function loadWorkspaces(url: URL): Promise<Workspace[]> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(\`atlas: \${response.status}\`)
  return (await response.json()).filter((ws: Workspace) => /^[a-z-]+$/.test(ws.name))
}
`

const PALETTE_SCRIPT = `names='black red green yellow blue magenta cyan white'
i=0
for name in $names; do printf '\\033[3%sm%-9s\\033[0m' $i $name; i=$((i + 1)); done; echo
i=0
for name in $names; do printf '\\033[9%sm%-9s\\033[0m' $i $name; i=$((i + 1)); done; echo
for i in 0 1 2 3 4 5 6 7; do printf '\\033[4%sm         \\033[0m' $i; done; echo
for i in 0 1 2 3 4 5 6 7; do printf '\\033[10%sm         \\033[0m' $i; done; echo
`

const DEMO_COMMITS: { message: string; files: Record<string, string> }[] = [
  {
    message: 'Scaffold atlas',
    files: {
      'package.json': '{ "name": "atlas", "private": true }\n',
      'tsconfig.json': '{ "compilerOptions": { "strict": true } }\n'
    }
  },
  {
    message: 'Add the theme factory',
    files: {
      'src/theme.ts':
        'export type Theme = Record<string, unknown> & { compact(): Theme }\n' +
        'export const createTheme = (options: object): Theme => ({ ...options, compact: () => createTheme(options) })\n'
    }
  },
  { message: 'Resolve the palette per workspace', files: { [CODE_FILE]: CODE } },
  { message: 'Document the palette script', files: { 'README.md': '# atlas\n', 'scripts/palette.sh': PALETTE_SCRIPT } }
]
const DEMO_EDITS: Record<string, string> = {
  'README.md': '# atlas\n\nWorkspaces that follow the Tokyo Night palette.\n',
  'src/compact.ts': 'export const COMPACT_TAB_LIMIT = 12\n'
}
const TERMINAL_DEMO = [
  "PROMPT='%F{4}atlas%f %F{5}main%f %F{2}❯%f '; clear",
  'git log --graph --oneline --decorate',
  'git status -sb',
  'sh scripts/palette.sh'
]

/** A clean project named atlas, added and opened the way a user would, replacing the fixture repo. */
async function openDemoProject(page: Page, fixtureRepoPath: string): Promise<string> {
  const dir = join(DEMO_ROOT, 'atlas')
  await rm(dir, { recursive: true, force: true })
  const write = async (files: Record<string, string>) => {
    for (const [name, text] of Object.entries(files)) {
      await mkdir(join(dir, name, '..'), { recursive: true })
      await writeFile(join(dir, name), text)
    }
  }
  await mkdir(dir, { recursive: true })
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.name', 'atlas')
  git('config', 'user.email', 'atlas@example.com')
  git('config', 'core.pager', 'cat')
  git('config', 'color.ui', 'always')
  for (const commit of DEMO_COMMITS) {
    await write(commit.files)
    git('add', '.')
    git('commit', '-qm', commit.message)
    if (commit.files[CODE_FILE]) {
      git('tag', 'v0.3.0')
    }
  }
  git('branch', 'feature/compact')
  await write(DEMO_EDITS)
  const repoPath = await realpath(dir)
  await page.evaluate(
    async ({ repoPath, fixtureRepoPath }) => {
      const added = await window.api.repos.add({ path: repoPath })
      if ('error' in added) {
        throw new Error(added.error)
      }
      const store = window.__store!
      await store.getState().fetchRepos({ runtimeEnvironmentId: null, throwOnError: true })
      const fixture = store.getState().repos.find((repo) => repo.path === fixtureRepoPath)
      if (fixture) {
        await store.getState().removeProject(fixture.id, { hostId: fixture.executionHostId ?? 'local', errorFeedback: 'silent' })
      }
    },
    { repoPath, fixtureRepoPath }
  )
  await expect
    .poll(
      () =>
        page.evaluate(async (repoPath) => {
          const store = window.__store!
          const repo = store.getState().repos.find((entry) => entry.path === repoPath)
          if (!repo) {
            return null
          }
          await store.getState().fetchWorktrees(repo.id)
          const worktree = (store.getState().worktreesByRepo[repo.id] ?? [])[0]
          if (worktree) {
            store.getState().setActiveWorktree(worktree.id)
          }
          return store.getState().activeWorktreeId === worktree?.id ? worktree.id : null
        }, repoPath),
      { timeout: 15_000, message: 'the atlas project never became the active workspace' }
    )
    .not.toBeNull()
  return repoPath
}

const rgb = (hex: string): string =>
  `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`
const css = (page: Page, token: string): Promise<string> =>
  page.evaluate((name) => document.documentElement.style.getPropertyValue(name), token)

async function openSettings(page: Page, pane: string, section: string): Promise<void> {
  await page.evaluate((target) => {
    const state = window.__store?.getState()
    state?.openSettingsTarget({ pane: target, repoId: null })
    state?.openSettingsPage()
  }, pane)
  await expect(page.locator(`[data-settings-section="${section}"]`)).toBeVisible()
}

async function showTerminal(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window.__store!.getState()
    const worktreeId = state.activeWorktreeId!
    const tab = state.tabsByWorktree[worktreeId]?.[0]
    if (tab) {
      state.setActiveTab(tab.id)
    }
    state.setActiveTabType('terminal', worktreeId)
  })
}

async function choose(page: Page, select: string, option: string): Promise<void> {
  await page.getByRole('combobox', { name: select, exact: true }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

test('Tokyo Night styles load and switch', async ({ orcaPage, seededRepoPath }) => {
  test.setTimeout(240_000)
  try {
    await enableDevPlugins(orcaPage, [PLUGIN])
    // Why the install fallback: builds that turn development folders off still install local paths.
    const plugin = await orcaPage.evaluate(
      async ({ key, path }) => {
        const find = async () => (await window.api.plugins.refresh()).find((p) => p.pluginKey === key)
        let found = await find()
        if (!found) {
          await window.api.plugins.install({ kind: 'local-path', path })
          found = await find()
        }
        if (found?.status === 'pending' && found.consentFingerprint) {
          await window.api.plugins.consent({
            pluginKey: key,
            reviewedFingerprint: found.consentFingerprint,
            decision: 'approve'
          })
          found = await find()
        }
        return found
      },
      { key: KEY, path: PLUGIN }
    )
    expect(['idle', 'enabled'], JSON.stringify(plugin)).toContain(plugin?.status)
    await orcaPage.setViewportSize({ width: 1440, height: 900 })
    const demoPath = await openDemoProject(orcaPage, await realpath(seededRepoPath))
    await showTerminal(orcaPage)
    const ptyId = await discoverActivePtyId(orcaPage)
    for (const command of TERMINAL_DEMO) {
      await execInTerminal(orcaPage, ptyId, command)
    }
    await waitForTerminalOutput(orcaPage, 'magenta')

    for (const style of STYLES) {
      const theme = JSON.parse(await readFile(join(PLUGIN, 'themes', `${style.id}.json`), 'utf8'))
      const terminal = JSON.parse(await readFile(join(PLUGIN, 'terminal', `${style.id}.json`), 'utf8'))
      await openSettings(orcaPage, 'appearance', 'appearance')
      await orcaPage
        .getByRole('radiogroup', { name: 'Theme', exact: true })
        .getByRole('radio', { name: style.base === 'dark' ? 'Dark' : 'Light', exact: true })
        .click()
      await choose(orcaPage, style.base === 'dark' ? 'Dark theme' : 'Light theme', style.title)
      for (const token of Object.keys(theme.tokens)) {
        await expect.poll(() => css(orcaPage, token), { message: `${style.id} ${token}` }).toBe(theme.tokens[token])
      }

      await orcaPage.evaluate(
        async ({ id, base, colors }) => {
          const settings = await window.api.settings.set({
            [base === 'dark' ? 'terminalThemeDark' : 'terminalThemeLight']: `plugin:${id}`,
            terminalUseSeparateLightTheme: true,
            terminalPluginPalettes: [{ id: `plugin:${id}`, colors }]
          })
          window.__store?.setState({ settings })
        },
        { id: `${KEY}/${style.id}`, base: style.base, colors: terminal.terminal }
      )

      await orcaPage.evaluate(() => window.__store?.getState().closeSettingsPage())
      await openRepoFile(orcaPage, demoPath, CODE_FILE)
      const color = (name: string): string =>
        rgb(theme.tokenColors.find((rule: { name: string }) => rule.name === name).settings.foreground)
      await expect.poll(() => editorTokenColor(orcaPage, 'export'), { timeout: 15_000 }).toBe(color('Keywords'))
      await expect.poll(() => editorTokenColor(orcaPage, '// Resolve the palette for the active workspace.')).toBe(color('Comments'))
      await expect.poll(() => editorTokenColor(orcaPage, "'blue'")).toBe(color('Strings'))
      await expect.poll(() => editorTokenColor(orcaPage, '0.92')).toBe(color('Constants'))
      await orcaPage.evaluate(() => {
        const state = window.__store?.getState()
        state?.showRightSidebarFiles()
        state?.setRightSidebarOpen(true)
      })
      await orcaPage.waitForTimeout(800)
      await orcaPage.screenshot({ path: join(SHOTS, `${style.id}.png`) })
      await showTerminal(orcaPage)
      await orcaPage.waitForTimeout(800)
      await orcaPage.screenshot({ path: join(SHOTS, `${style.id}-terminal.png`) })
    }
  } finally {
    await disablePluginSystem(orcaPage).catch(() => undefined)
    await rm(join(DEMO_ROOT, 'atlas'), { recursive: true, force: true })
  }
})
