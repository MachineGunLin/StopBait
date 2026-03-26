import { useEffect, useMemo, useState } from 'react'
import type { RecentRecord } from '../shared/types'
import type { StopBaitRule, WhitelistAuthor } from '../shared/types'
import {
  ensureRulesInitialized,
  getStarterPacksInitialized,
  getPurifiedCount,
  getRulesFromStorage,
  getWhitelistAuthors,
  setStarterPacksInitialized,
  setRulesToStorage,
  setWhitelistAuthors,
} from '../shared/storage'
import { createDefaultRules } from '../shared/defaultRules'

const COUNT_KEY = 'stopbait_filtered_count'
const RULE_KEY = 'stopbait_rules'
const WHITELIST_KEY = 'stopbait_whitelist_authors'

type StarterPack = {
  id: string
  name: string
  rules: Omit<StopBaitRule, 'createdAt'>[]
}

const starterPacks: StarterPack[] = [
  {
    id: 'anxiety',
    name: '拒绝焦虑包',
    rules: [
      {
        id: 'starter_anxiety_age_money',
        type: 'regex',
        enabled: true,
        name: 'Starter/焦虑：年龄+存款+收入',
        patternLiteral: '/\\d+岁.*(赚|存|拿|入).*[万k]/',
      },
      {
        id: 'starter_anxiety_bigtech',
        type: 'regex',
        enabled: true,
        name: 'Starter/焦虑：大厂离职裸辞副业',
        patternLiteral: '/(大厂离职|裸辞.*天|副业|翻身|认知差)/',
      },
      {
        id: 'starter_anxiety_keywords',
        type: 'regex',
        enabled: true,
        name: 'Starter/焦虑：话术关键词',
        patternLiteral: '/(mbti|情绪价值|能量场|内核|觉醒|听劝|30岁|中年)/i',
      },
    ],
  },
  {
    id: 'clickbait',
    name: '拒绝标题党包',
    rules: [
      {
        id: 'starter_clickbait_words',
        type: 'regex',
        enabled: true,
        name: 'Starter/标题党：绝了谁懂顶级天花板',
        patternLiteral:
          '/(真的绝了|谁懂啊|顶级|天花板|惊呆了|不看后悔|绝绝子|狠狠|封神|真香|从夯到拉|教科书级|最(离谱|靠谱|好用))/',
      },
    ],
  },
  {
    id: 'gender',
    name: '拒绝性别对立包',
    rules: [
      {
        id: 'starter_gender_tension',
        type: 'regex',
        enabled: true,
        name: 'Starter/性别对立：攻击性语境',
        patternLiteral: '/(普信|避雷|下头|避坑|典型|这种|又是)(男人|女人)/',
      },
    ],
  },
]

function makeRuleId() {
  return `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function inferRuleType(input: string): 'regex' | 'contains' {
  const s = input.trim()
  return isRegexLiteral(s) ? 'regex' : 'contains'
}

function isRegexLiteral(input: string): boolean {
  return /^\/.+\/[gimsuy]*$/.test(input.trim())
}

function isValidRegexLiteral(input: string): boolean {
  const s = input.trim()
  if (!isRegexLiteral(s)) return false
  const bodyEnd = s.lastIndexOf('/')
  const source = s.slice(1, bodyEnd)
  const flags = s.slice(bodyEnd + 1)
  try {
    new RegExp(source, flags)
    return true
  } catch {
    return false
  }
}

function normalizeContainsInput(input: string): string {
  return input
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
}

function formatRuleFriendly(r: StopBaitRule): string {
  if (r.type === 'contains') {
    const words = normalizeContainsInput(r.patternLiteral).split(' ').filter(Boolean)
    if (words.length > 1) return `包含：${words.join(' + ')}`
    if (words.length === 1) return `包含：${words[0]}`
  }
  return r.name
}

export default function App() {
  const [count, setCount] = useState(0)
  const [recent, setRecent] = useState<RecentRecord[]>([])
  const [open, setOpen] = useState(true)
  const [rules, setRules] = useState<StopBaitRule[]>([])
  const [newRuleInput, setNewRuleInput] = useState('')
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [whitelist, setWhitelist] = useState<WhitelistAuthor[]>([])
  const [confirmRemoveAuthorId, setConfirmRemoveAuthorId] = useState<string | null>(null)

  useEffect(() => {
    getPurifiedCount().then(setCount).catch(() => setCount(0))
    ensureRulesInitialized(createDefaultRules())
      .then(async (baseRules) => {
        const inited = await getStarterPacksInitialized()
        if (!inited) {
          const key = (r: Pick<StopBaitRule, 'type' | 'patternLiteral'>) =>
            `${r.type}:${r.patternLiteral}`
          const keySet = new Set(baseRules.map((r) => key(r)))
          const injectRules = starterPacks
            .flatMap((p) => p.rules)
            .filter((r) => !keySet.has(key(r)))
            .map((r) => ({
              ...r,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            }))
          const nextRules = [...baseRules, ...injectRules]
          await setRulesToStorage(nextRules)
          await setStarterPacksInitialized(true)
          setRules(nextRules)
          return
        }
        setRules(baseRules)
      })
      .catch(() => setRules([]))
    getWhitelistAuthors().then(setWhitelist).catch(() => setWhitelist([]))

    // 实时刷新计数器
    const onChanged = (changes: Record<string, any>, areaName: string) => {
      if (areaName !== 'local') return
      const ch = changes[COUNT_KEY]
      if (ch && typeof ch.newValue === 'number') {
        setCount(ch.newValue)
      }
      if (changes[RULE_KEY]?.newValue && Array.isArray(changes[RULE_KEY].newValue)) {
        setRules(changes[RULE_KEY].newValue as StopBaitRule[])
      }
      if (
        changes[WHITELIST_KEY]?.newValue &&
        Array.isArray(changes[WHITELIST_KEY].newValue)
      ) {
        setWhitelist(changes[WHITELIST_KEY].newValue as WhitelistAuthor[])
      }
    }
    chrome.storage.onChanged.addListener(onChanged)

    return () => chrome.storage.onChanged.removeListener(onChanged)
  }, [])

  const refreshRules = async () => {
    const latest = await getRulesFromStorage()
    setRules(latest ?? [])
  }

  const refreshWhitelist = async () => {
    const latest = await getWhitelistAuthors()
    setWhitelist(latest ?? [])
  }

  useEffect(() => {
    // 从当前标签页 content_script 拉取最近 10 条（Session 内存）
    getPurifiedCount().then(setCount).catch(() => {})
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs?.[0]?.id
      if (!tabId) return
      chrome.tabs.sendMessage(tabId, { type: 'get_recent' }, (resp) => {
        if (resp?.recent && Array.isArray(resp.recent)) setRecent(resp.recent)
      })
    })
  }, [open])

  const recentTitle = useMemo(() => {
    const n = recent.length
    if (n === 0) return '暂时没有命中记录'
    if (n < 10) return `最近命中 ${n} 条`
    return '最近命中 10 条'
  }, [recent])

  const savedTimeText = useMemo(() => {
    const seconds = count * 20
    if (seconds >= 60) {
      const minutes = Math.round((seconds / 60) * 10) / 10
      return `已为你节省约 ${minutes} 分钟的无意义内耗`
    }
    return `已为你节省约 ${seconds} 秒的无意义内耗`
  }, [count])

  const packEnabledMap = useMemo(() => {
    const keySet = new Set(rules.map((r) => `${r.type}:${r.patternLiteral}`))
    const map: Record<string, boolean> = {}
    for (const pack of starterPacks) {
      map[pack.id] = pack.rules.every((r) => keySet.has(`${r.type}:${r.patternLiteral}`))
    }
    return map
  }, [rules])

  const handleTogglePack = async (packId: string, enabled: boolean) => {
    const pack = starterPacks.find((p) => p.id === packId)
    if (!pack) return

    const current = (await getRulesFromStorage()) ?? []
    const key = (r: Pick<StopBaitRule, 'type' | 'patternLiteral'>) =>
      `${r.type}:${r.patternLiteral}`
    const currentKeySet = new Set(current.map((r) => key(r)))

    let next = [...current]
    if (enabled) {
      for (const preset of pack.rules) {
        if (!currentKeySet.has(key(preset))) {
          next.push({
            ...preset,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          })
        }
      }
    } else {
      const packKeySet = new Set(pack.rules.map((r) => key(r)))
      next = next.filter((r) => !packKeySet.has(key(r)))
    }

    await setRulesToStorage(next)
    await refreshRules()
  }

  const handleDeleteRule = async (id: string) => {
    const current = (await getRulesFromStorage()) ?? []
    const next = current.filter((r) => r.id !== id)
    await setRulesToStorage(next)
    await refreshRules()
  }

  const handleStartEdit = (rule: StopBaitRule) => {
    setEditingId(rule.id)
    setEditingValue(rule.patternLiteral)
    setError('')
  }

  const handleSaveEdit = async (rule: StopBaitRule) => {
    const raw = editingValue.trim()
    if (!raw) return
    const type = inferRuleType(raw)
    const value = type === 'regex' ? raw : normalizeContainsInput(raw)
    if (type === 'regex' && !isValidRegexLiteral(value)) {
      setError('正则格式有误，请使用 /表达式/ 或 /表达式/gi 这种格式')
      return
    }

    const current = (await getRulesFromStorage()) ?? []
    const next = current.map((r) =>
      r.id === rule.id
        ? {
            ...r,
            type,
            patternLiteral: value,
            name:
              type === 'contains'
                ? `包含：${value.split(' ').filter(Boolean).join(' + ')}`
                : r.name,
            updatedAt: Date.now(),
          }
        : r,
    )
    await setRulesToStorage(next)
    setEditingId(null)
    setEditingValue('')
    setError('')
    await refreshRules()
  }

  const handleAddRule = async () => {
    setError('')
    const raw = newRuleInput.trim()
    if (!raw) return
    const current = (await getRulesFromStorage()) ?? []
    const type = inferRuleType(raw)
    const value = type === 'regex' ? raw : normalizeContainsInput(raw)
    if (!value) return
    if (type === 'regex' && !isValidRegexLiteral(value)) {
      setError('正则格式有误，请使用 /表达式/ 或 /表达式/gi 这种格式')
      return
    }
    const dup = current.some((r) => r.type === type && r.patternLiteral === value)
    if (dup) return

    const rule: StopBaitRule = {
      id: makeRuleId(),
      type,
      enabled: true,
      name:
        type === 'regex'
          ? '手动添加：正则规则'
          : `包含：${value.split(' ').filter(Boolean).join(' + ')}`,
      patternLiteral: value,
      createdAt: Date.now(),
    }
    const next = [...current, rule]
    await setRulesToStorage(next)
    setNewRuleInput('')
    await refreshRules()
  }

  const handleClearWhitelist = async () => {
    await setWhitelistAuthors([])
    await refreshWhitelist()
    setConfirmRemoveAuthorId(null)
  }

  const handleRemoveWhitelistAuthor = async (id: string) => {
    const current = (await getWhitelistAuthors()) ?? []
    const next = current.filter((a) => a.id !== id)
    await setWhitelistAuthors(next)
    await refreshWhitelist()
    setConfirmRemoveAuthorId(null)
  }

  const handleOpenAuthorProfile = (id: string) => {
    const url = `https://www.xiaohongshu.com/user/profile/${encodeURIComponent(id)}`
    chrome.tabs.create({ url })
  }

  const formatAuthorName = (a: WhitelistAuthor) =>
    a.name && a.name.trim() ? a.name.trim() : '未名博主'

  return (
    <div className="w-[360px] bg-white p-4 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="flex items-center justify-between">
        <div className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          别想骗我点击 StopBait
        </div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400">心智防火墙</div>
      </div>

      <div className="mt-3 rounded-xl bg-black px-3 py-3 text-white shadow-sm dark:bg-zinc-900">
        <button className="w-full text-left" onClick={() => setOpen((v) => !v)}>
          <div className="text-xs opacity-90">已过滤低质量内容</div>
          <div className="mt-1 text-2xl font-bold tabular-nums">{count}</div>
        </button>
        <div className="mt-1 text-xs text-white/80">{savedTimeText}</div>
      </div>

      <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-2 text-xs font-semibold text-zinc-700 dark:text-zinc-100">过滤方案</div>
        <div className="space-y-2">
          {starterPacks.map((pack) => {
            const checked = !!packEnabledMap[pack.id]
            return (
              <label
                key={pack.id}
                className="flex items-center justify-between rounded-md bg-zinc-50 px-2 py-2 dark:bg-zinc-800"
              >
                <span className="text-xs text-zinc-800 dark:text-zinc-100">{pack.name}</span>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => handleTogglePack(pack.id, e.target.checked)}
                  className="h-4 w-4 accent-blue-600 dark:accent-blue-400"
                />
              </label>
            )
          })}
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-100">白名单管理</div>
          <button
            onClick={handleClearWhitelist}
            className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-[11px] leading-none text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            清空全部白名单
          </button>
        </div>
        <div className="max-h-[110px] space-y-1 overflow-auto pr-1">
          {whitelist.length === 0 ? (
            <div className="text-xs text-zinc-500 dark:text-zinc-400">暂无加白作者</div>
          ) : (
            whitelist.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between rounded-md bg-zinc-50 px-2 py-1.5 dark:bg-zinc-800"
              >
                <div className="min-w-0">
                  <div className="truncate text-xs text-zinc-700 dark:text-zinc-100">
                    {formatAuthorName(a)}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleOpenAuthorProfile(a.id)}
                    className="rounded-md border border-zinc-300 bg-transparent px-2 py-0.5 text-[11px] text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-700"
                    title="打开主页"
                  >
                    🔗
                  </button>
                  <button
                    onClick={() => {
                      if (confirmRemoveAuthorId === a.id) {
                        handleRemoveWhitelistAuthor(a.id)
                      } else {
                        setConfirmRemoveAuthorId(a.id)
                      }
                    }}
                    className="rounded-md border border-zinc-300 bg-transparent px-2 py-0.5 text-[11px] text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-700"
                    title="移除该作者"
                  >
                    {confirmRemoveAuthorId === a.id ? '确认' : '🗑'}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-2 text-xs font-semibold text-zinc-700 dark:text-zinc-100">规则管理</div>
        <div className="max-h-[180px] overflow-auto space-y-2 pr-1">
          {rules.length === 0 ? (
            <div className="text-xs text-zinc-500 dark:text-zinc-400">暂无规则</div>
          ) : (
            rules.map((r) => (
              <div
                key={r.id}
                className="rounded-md border border-zinc-200 bg-white px-2 py-2 dark:border-zinc-700 dark:bg-zinc-900"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium text-zinc-700 dark:text-zinc-100">
                      {formatRuleFriendly(r)}
                    </div>
                    {editingId === r.id ? (
                      <input
                        value={editingValue}
                        onChange={(e) => setEditingValue(e.target.value)}
                        className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-800 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      />
                    ) : (
                      <div className="break-all text-xs text-zinc-500 dark:text-zinc-400">{r.patternLiteral}</div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1 self-start">
                    {editingId === r.id ? (
                      <>
                        <button
                          onClick={() => handleSaveEdit(r)}
                          className="h-fit rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-[11px] leading-none text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        >
                          保存
                        </button>
                        <button
                          onClick={() => {
                            setEditingId(null)
                            setEditingValue('')
                            setError('')
                          }}
                          className="h-fit rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-[11px] leading-none text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        >
                          取消
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => handleStartEdit(r)}
                          className="h-fit rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-[11px] leading-none text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                          title="编辑规则"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => handleDeleteRule(r.id)}
                          className="h-fit rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-[11px] leading-none text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                          title="删除规则"
                        >
                          删除
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="mt-3 space-y-2">
          <input
            value={newRuleInput}
            onChange={(e) => setNewRuleInput(e.target.value)}
            placeholder="输入关键词（支持空格分隔）"
            className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-800 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <div className="text-[11px] text-zinc-400 dark:text-zinc-500">
            <div>*例如：输入 大厂 裸辞（同时包含这两个词）</div>
            <div>或者使用专家模式 /正则/</div>
          </div>
          {error && <div className="text-[11px] text-red-500">{error}</div>}
          <div className="flex justify-end">
            <button
              onClick={handleAddRule}
              className="rounded-md bg-black px-3 py-1.5 text-xs text-white hover:opacity-90 dark:bg-zinc-800 dark:hover:bg-zinc-700"
            >
              添加
            </button>
          </div>
        </div>
      </div>

      {open && (
        <div className="mt-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-2 text-xs font-medium text-zinc-700 dark:text-zinc-100">{recentTitle}</div>
          {recent.length === 0 ? (
            <div className="text-xs text-zinc-500 dark:text-zinc-400">继续浏览小红书，会实时更新。</div>
          ) : (
            <div className="max-h-[320px] overflow-auto pr-1">
              {recent.map((r) => (
                <div
                  key={`${r.ruleId}:${r.ts}`}
                  className="mb-3 last:mb-0 rounded-md bg-zinc-50 p-2 dark:bg-zinc-800"
                >
                  <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">{r.title}</div>
                  <div className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-300">
                    规则：{r.ruleName}
                  </div>
                  <div className="mt-1 break-all text-[11px] text-zinc-500 dark:text-zinc-400">
                    {r.patternLiteral}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

