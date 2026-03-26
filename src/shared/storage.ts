import type { StopBaitRule, WhitelistAuthor } from './types'

export const STORAGE_KEYS = {
  rules: 'stopbait_rules',
  count: 'stopbait_filtered_count',
  whitelist: 'stopbait_whitelist_authors',
  starterPacksInitialized: 'stopbait_starter_packs_initialized',
} as const

const now = () => Date.now()

export async function getRulesFromStorage(): Promise<StopBaitRule[] | null> {
  const obj = await chrome.storage.local.get(STORAGE_KEYS.rules)
  const rules = obj[STORAGE_KEYS.rules]
  return Array.isArray(rules) ? (rules as StopBaitRule[]) : null
}

export async function setRulesToStorage(rules: StopBaitRule[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.rules]: rules })
}

export async function getPurifiedCount(): Promise<number> {
  const obj = await chrome.storage.local.get(STORAGE_KEYS.count)
  const v = obj[STORAGE_KEYS.count]
  return typeof v === 'number' ? v : 0
}

export async function setPurifiedCount(next: number): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.count]: next })
}

export async function incPurifiedCount(delta = 1): Promise<number> {
  // 注意：chrome.storage.local 非事务，简单做 get->set 足够当前场景。
  const current = await getPurifiedCount()
  const next = Math.max(0, current + delta)
  await setPurifiedCount(next)
  return next
}

export async function ensureRulesInitialized(
  defaultRules: StopBaitRule[],
): Promise<StopBaitRule[]> {
  const existing = await getRulesFromStorage()
  if (existing && existing.length) return existing
  const initial = defaultRules.map((r) => ({
    ...r,
    createdAt: r.createdAt ?? now(),
  }))
  await setRulesToStorage(initial)
  return initial
}

export async function getWhitelistAuthors(): Promise<WhitelistAuthor[]> {
  const obj = await chrome.storage.local.get(STORAGE_KEYS.whitelist)
  const list = obj[STORAGE_KEYS.whitelist]
  return Array.isArray(list) ? (list as WhitelistAuthor[]) : []
}

export async function setWhitelistAuthors(authors: WhitelistAuthor[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.whitelist]: authors })
}

export async function getStarterPacksInitialized(): Promise<boolean> {
  const obj = await chrome.storage.local.get(STORAGE_KEYS.starterPacksInitialized)
  return Boolean(obj[STORAGE_KEYS.starterPacksInitialized])
}

export async function setStarterPacksInitialized(value: boolean): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.starterPacksInitialized]: value })
}

