export type ThemeChoice = 'system' | 'light' | 'dark'

const storageKey = 'agentanywhere:theme'
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')

export function readTheme(): ThemeChoice {
  try {
    const saved = localStorage.getItem(storageKey)
    if (saved === 'light' || saved === 'dark') return saved
  } catch { /* use the system preference when browser storage is unavailable */ }
  return 'system'
}

export function applyTheme(choice: ThemeChoice) {
  const resolved = choice === 'system' ? systemTheme.matches ? 'dark' : 'light' : choice
  document.documentElement.dataset.theme = resolved
  document.documentElement.dataset.themeChoice = choice
  document.documentElement.style.colorScheme = resolved
}

export function saveTheme(choice: ThemeChoice) {
  try {
    if (choice === 'system') localStorage.removeItem(storageKey)
    else localStorage.setItem(storageKey, choice)
  } catch { /* the active page still uses the selected theme */ }
  applyTheme(choice)
}

applyTheme(readTheme())
systemTheme.addEventListener('change', () => {
  if (readTheme() === 'system') applyTheme('system')
})
