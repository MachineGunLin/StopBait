import type { StopBaitRule, RecentRecord } from '../shared/types'
import {
  STORAGE_KEYS,
  ensureRulesInitialized,
  getRulesFromStorage,
  getWhitelistAuthors,
  incPurifiedCount,
  setWhitelistAuthors,
} from '../shared/storage'
import { createDefaultRules } from '../shared/defaultRules'

/**
 * StopBait - 内容拦截引擎（Content Script）
 *
 * 目标：
 * 1) MutationObserver 监听小红书瀑布流动态加载
 * 2) 通过 section.note-item 与 .title 父节点鲁棒定位卡片标题
 * 3) 支持 contains（包含）和 regex（正则字面量）
 * 4) 命中后对卡片做毛玻璃遮罩，并覆盖“查看/原因”按钮
 * 5) 最近 10 条命中原因（Session 内存）给 Popup 查询
 * 6) 命中计数实时写入 chrome.storage.local，供 Popup 实时更新
 */

const DIM_CLASS = 'mw-dimmed'
const OVERLAY_STYLE_ID = 'mw-overlay-style'
const OVERLAY_CLASS = 'mw-overlay'
const TOOLBAR_CLASS = 'mw-toolbar'
const REASON_PANEL_CLASS = 'mw-reason-panel'
const REASON_BACK_CLASS = 'mw-reason-back'
const REASON_BOX_CLASS = 'mw-reason-box'

const EFFECT = {
  // 视觉升级：毛玻璃遮罩
  blur: 20,
}

type CardState = {
  matchedRuleId?: string
  cardUid?: string
  authorId?: string
  authorName?: string
  revealed?: boolean
  reported?: boolean
}

const defaultRules: StopBaitRule[] = createDefaultRules()

let rules: StopBaitRule[] = []
let whitelistMap = new Map<string, string | undefined>()
const stateByCard = new Map<HTMLElement, CardState>()
const recent: RecentRecord[] = []

let cardSeq = 0
function getCardUid(cardEl: HTMLElement): string {
  const existing = cardEl.dataset.mwUid
  if (existing) return existing
  cardSeq++
  const uid = `mw_${cardSeq}`
  cardEl.dataset.mwUid = uid
  return uid
}

const overlayByCard = new Map<HTMLElement, HTMLDivElement>()
const toolbarByCard = new Map<HTMLElement, HTMLDivElement>()
const reasonPanelByCard = new Map<HTMLElement, HTMLDivElement>()
let nextOverlayTick = 0

function injectGlobalStyles() {
  if (document.getElementById(OVERLAY_STYLE_ID)) return

  const style = document.createElement('style')
  style.id = OVERLAY_STYLE_ID
  style.textContent = `
.${DIM_CLASS} { transition: opacity .18s ease; }

.${OVERLAY_CLASS} {
  position: fixed;
  z-index: 2147483647;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.38);
  background: rgba(255, 255, 255, 0.3);
  backdrop-filter: blur(${EFFECT.blur}px) saturate(118%);
  -webkit-backdrop-filter: blur(${EFFECT.blur}px) saturate(118%);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.18);
  pointer-events: none;
}

.${TOOLBAR_CLASS} {
  position: absolute;
  right: 8px;
  top: 8px;
  display: flex;
  gap: 6px;
  pointer-events: auto;
}

.${TOOLBAR_CLASS} button {
  cursor: pointer;
  border: 1px solid rgba(255,255,255,0.42);
  background: rgba(24,24,27,0.28);
  color: rgba(255,255,255,0.92);
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 12px;
  line-height: 1;
  backdrop-filter: blur(2px);
}

.${TOOLBAR_CLASS} button:hover { background: rgba(24,24,27,0.40); }

.${REASON_PANEL_CLASS} {
  position: absolute;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 16px;
  color: rgba(255,255,255,0.97);
  text-shadow: 0 1px 2px rgba(0,0,0,0.45);
  font-size: 13px;
  line-height: 1.45;
  text-wrap: balance;
  text-wrap: pretty;
  overflow-wrap: anywhere;
  word-break: break-word;
  pointer-events: auto;
}

.${REASON_BOX_CLASS} {
  max-width: calc(100% - 28px);
  border-radius: 10px;
  padding: 12px;
  background: rgba(255,255,255,0.6);
  color: rgb(39,39,42);
  text-shadow: none;
}

@media (prefers-color-scheme: dark) {
  .${REASON_BOX_CLASS} {
    background: rgba(0,0,0,0.6);
    color: #ffffff;
    text-shadow: 0 1px 2px rgba(0,0,0,0.35);
  }
}

.${REASON_BACK_CLASS} {
  position: absolute;
  top: 8px;
  right: 8px;
  border: 1px solid rgba(255,255,255,0.42);
  background: rgba(24,24,27,0.3);
  color: rgba(255,255,255,0.95);
  border-radius: 999px;
  width: 22px;
  height: 22px;
  line-height: 20px;
  text-align: center;
  cursor: pointer;
}
`

  document.head.appendChild(style)
}

function parseRegexLiteral(literal: string): { source: string; flags: string } | null {
  const s = literal.trim()
  // 形如 /.../i 或 /.../
  if (!s.startsWith('/')) return null
  const lastSlash = s.lastIndexOf('/')
  if (lastSlash <= 0) return null
  const source = s.slice(1, lastSlash)
  const flags = s.slice(lastSlash + 1)
  return { source, flags }
}

function tryBuildRegExp(rule: StopBaitRule): RegExp | null {
  if (rule.type !== 'regex') return null
  const parsed = parseRegexLiteral(rule.patternLiteral)
  if (!parsed) return null
  try {
    return new RegExp(parsed.source, parsed.flags || 'i')
  } catch {
    return null
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function splitSmartKeywords(input: string): string[] {
  return input
    .trim()
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean)
}

function buildSmartContainsRegex(input: string): RegExp | null {
  const words = splitSmartKeywords(input)
  if (!words.length) return null
  // 多词输入时要求“全部包含，顺序不限”：^(?=.*词1)(?=.*词2).*
  const lookaheads = words.map((w) => `(?=.*${escapeRegex(w)})`).join('')
  return new RegExp(`^${lookaheads}.*$`, 'i')
}

function matchTitle(titleText: string): StopBaitRule | null {
  // “宁可误杀一千，不可放过一个” => 顺序匹配，命中就立刻返回
  for (const rule of rules) {
    if (!rule.enabled) continue

    if (rule.type === 'contains') {
      const smart = buildSmartContainsRegex(rule.patternLiteral)
      if (smart && smart.test(titleText)) return rule
      continue
    }

    const re = tryBuildRegExp(rule)
    if (!re) continue
    if (re.test(titleText)) return rule
  }
  return null
}

function resolveCardsFromNode(node: Node): HTMLElement[] {
  if (!(node instanceof Element)) return []

  const set = new Set<HTMLElement>()

  try {
    if ((node as HTMLElement).matches?.('section.note-item')) {
      set.add(node as HTMLElement)
    }
  } catch {
    // ignore：类名/结构变动时走兜底
  }

  try {
    const candidates = node.querySelectorAll?.('section.note-item')
    candidates?.forEach((el) => set.add(el as HTMLElement))
  } catch {
    // ignore
  }

  if (set.size) return [...set]

  // 兜底鲁棒：如果 node 不是 note-item，找 .title 再向上找父节点（兼容类名变化）
  try {
    const titleEls = node.querySelectorAll?.('.title')
    titleEls?.forEach((t) => {
      const parent = (t as HTMLElement).parentElement
      const card = parent?.closest?.('section') ?? parent
      if (card instanceof HTMLElement) set.add(card)
    })
  } catch {
    // ignore
  }

  return [...set]
}

function extractCardTitle(cardEl: HTMLElement): string | null {
  try {
    // 按你的要求：目标通常是 .title，类名变化时会在外层用 .title 父节点兜底定位 card
    const titleEl =
      cardEl.querySelector?.('.title') ?? cardEl.querySelector?.('span.title')

    const text = titleEl?.textContent?.trim()
    if (!text) return null
    return text
  } catch {
    return null
  }
}

function extractAuthorInfo(cardEl: HTMLElement): { id: string; name?: string } | null {
  try {
    const links = Array.from(
      cardEl.querySelectorAll('a[href*="/user/profile/"]'),
    ) as HTMLAnchorElement[]
    if (!links.length) return null

    // 尽量选“作者区域”的链接，而不是其他嵌套区域
    const scored = links
      .map((link) => {
        const href = link.getAttribute('href') ?? ''
        const m = href.match(/\/user\/profile\/([^/?#]+)/)
        if (!m?.[1]) return null

        let score = 0
        const text = link.textContent?.trim()
        if (text) score += 4
        if ((link.closest('[class*="author"]') as HTMLElement | null)) score += 5
        if ((link.closest('[class*="user"]') as HTMLElement | null)) score += 2
        if (link.querySelector('img')) score += 1
        if ((link.getAttribute('href') ?? '').includes('xsec_token')) score += 1

        return {
          id: decodeURIComponent(m[1]),
          score,
          link,
        }
      })
      .filter(Boolean) as Array<{ id: string; score: number; link: HTMLAnchorElement }>

    if (!scored.length) return null
    scored.sort((a, b) => b.score - a.score)
    const picked = scored[0]

    // 名称优先从作者区域里的文本拿；再回退 link 文本 / 图片 alt
    const authorContainer =
      (picked.link.closest('[class*="author"]') as HTMLElement | null) ??
      (picked.link.parentElement as HTMLElement | null)

    const nameFromContainer =
      authorContainer?.querySelector?.('[class*="name"]')?.textContent?.trim() ||
      authorContainer?.querySelector?.('.name')?.textContent?.trim() ||
      undefined

    const name =
      nameFromContainer ||
      picked.link.textContent?.trim() ||
      (picked.link.querySelector('img') as HTMLImageElement | null)?.alt?.trim() ||
      undefined

    return { id: picked.id, name }
  } catch {
    return null
  }
}

function applyDim(cardEl: HTMLElement) {
  cardEl.classList.add(DIM_CLASS)
  const overlay = overlayByCard.get(cardEl)
  if (overlay) overlay.style.display = ''
}

function applyReveal(cardEl: HTMLElement) {
  cardEl.classList.remove(DIM_CLASS)
  const overlay = overlayByCard.get(cardEl)
  if (overlay) overlay.style.display = 'none'
}

function ensureOverlay(cardEl: HTMLElement, _initialRule: StopBaitRule) {
  if (overlayByCard.has(cardEl)) return

  const overlay = document.createElement('div')
  overlay.className = OVERLAY_CLASS

  const toolbar = document.createElement('div')
  toolbar.className = TOOLBAR_CLASS

  const btnReveal = document.createElement('button')
  btnReveal.textContent = '查看'

  const btnReason = document.createElement('button')
  btnReason.textContent = '原因'

  const btnWhitelist = document.createElement('button')
  btnWhitelist.textContent = '❤️ 信任'

  btnReveal.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    const st = stateByCard.get(cardEl) ?? {}
    const isDimmed = cardEl.classList.contains(DIM_CLASS)
    if (isDimmed) applyReveal(cardEl)
    else applyDim(cardEl)
    st.revealed = !isDimmed
    stateByCard.set(cardEl, st)
  })

  btnReason.addEventListener('click', async (e) => {
    e.preventDefault()
    e.stopPropagation()
    const st = stateByCard.get(cardEl)
    if (!st?.matchedRuleId) return

    const latestRules = await getRulesFromStorage()
    rules = latestRules ?? rules
    const rule = rules.find((r) => r.id === st.matchedRuleId)
    if (!rule) return
    const reasonPanel = reasonPanelByCard.get(cardEl)
    const toolbarEl = toolbarByCard.get(cardEl)
    if (!reasonPanel || !toolbarEl) return
    const txt = reasonPanel.querySelector('.mw-reason-text')
    if (txt) txt.textContent = `由于命中：${rule.name}（${rule.patternLiteral}）`
    toolbarEl.style.display = 'none'
    reasonPanel.style.display = 'flex'
  })

  btnWhitelist.addEventListener('click', async (e) => {
    e.preventDefault()
    e.stopPropagation()
    const st = stateByCard.get(cardEl)
    const authorId = st?.authorId
    if (!authorId) return

    const list = await getWhitelistAuthors()
    if (!list.some((a) => a.id === authorId)) {
      const next = [...list, { id: authorId, name: st?.authorName || '未名博主' }]
      await setWhitelistAuthors(next)
      whitelistMap = new Map(next.map((a) => [a.id, a.name]))
    } else if (st?.authorName) {
      // 如果已存在但之前没有昵称，补写一次昵称
      const next = list.map((a) =>
        a.id === authorId && !a.name ? { ...a, name: st.authorName } : a,
      )
      await setWhitelistAuthors(next)
      whitelistMap = new Map(next.map((a) => [a.id, a.name]))
    }

    // 立即解冻当前页同作者卡片
    for (const [el, s] of stateByCard.entries()) {
      if (s.authorId === authorId) {
        applyReveal(el)
        const ov = overlayByCard.get(el)
        ov?.remove()
        overlayByCard.delete(el)
        s.matchedRuleId = undefined
      }
    }
  })

  toolbar.appendChild(btnReveal)
  toolbar.appendChild(btnReason)
  toolbar.appendChild(btnWhitelist)

  const reasonPanel = document.createElement('div')
  reasonPanel.className = REASON_PANEL_CLASS
  reasonPanel.innerHTML = `
    <button class="${REASON_BACK_CLASS}" aria-label="返回">×</button>
    <div class="${REASON_BOX_CLASS}">
      <div class="mw-reason-text"></div>
    </div>
  `
  const backBtn = reasonPanel.querySelector(`.${REASON_BACK_CLASS}`) as HTMLButtonElement
  backBtn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    reasonPanel.style.display = 'none'
    toolbar.style.display = 'flex'
  })
  overlay.appendChild(toolbar)
  overlay.appendChild(reasonPanel)

  document.body.appendChild(overlay)
  overlayByCard.set(cardEl, overlay)
  toolbarByCard.set(cardEl, toolbar)
  reasonPanelByCard.set(cardEl, reasonPanel)

  // 初次立刻定位
  updateOverlayPositions()
}

function updateOverlayPositions() {
  nextOverlayTick++
  const tick = nextOverlayTick

  for (const [cardEl, overlay] of overlayByCard.entries()) {
    if (!cardEl.isConnected) {
      overlay.remove()
      overlayByCard.delete(cardEl)
      toolbarByCard.delete(cardEl)
      reasonPanelByCard.delete(cardEl)
      continue
    }

    const rect = cardEl.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      overlay.style.display = 'none'
      continue
    }

    // 避免完全在屏幕外导致 overlay 漂移
    const isOutside =
      rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0
    if (isOutside) {
      overlay.style.display = 'none'
      continue
    }

    // overlay：放右上角附近
    overlay.style.display = ''

    const left = rect.left
    const top = rect.top

    // fixed 坐标系：不需要加 scrollX/scrollY
    overlay.style.left = `${Math.max(0, left)}px`
    overlay.style.top = `${Math.max(0, top)}px`
    overlay.style.width = `${Math.max(0, rect.width)}px`
    overlay.style.height = `${Math.max(0, rect.height)}px`
  }

  // 防止同一帧多次滚动时覆盖
  if (tick !== nextOverlayTick) return
}

function reEvalAndApplyState(cardEl: HTMLElement, titleText: string) {
  const st: CardState = stateByCard.get(cardEl) ?? {}
  const cardUid = st.cardUid ?? getCardUid(cardEl)
  st.cardUid = cardUid
  const author = extractAuthorInfo(cardEl)
  st.authorId = author?.id
  st.authorName = author?.name

  // 白名单优先：直接放行
  if (st.authorId && whitelistMap.has(st.authorId)) {
    applyReveal(cardEl)
    const overlay = overlayByCard.get(cardEl)
    overlay?.remove()
    overlayByCard.delete(cardEl)
    st.matchedRuleId = undefined
    stateByCard.set(cardEl, st)
    return
  }

  const match = matchTitle(titleText)

  if (!match) {
    // 不再匹配：移除淡化与 overlay
    applyReveal(cardEl)
    const overlay = overlayByCard.get(cardEl)
    overlay?.remove()
    overlayByCard.delete(cardEl)
    stateByCard.set(cardEl, st)
    st.matchedRuleId = undefined
    return
  }

  st.matchedRuleId = match.id

  // 淡化命中卡片
  applyDim(cardEl)

  // 悬浮按钮
  ensureOverlay(cardEl, match)

  // 命中计数/最近记录只做一次（防止重复累加）
  if (!st.reported) {
    st.reported = true
    const record: RecentRecord = {
      cardUid,
      title: titleText,
      ruleId: match.id,
      ruleName: match.name,
      patternLiteral: match.patternLiteral,
      ts: Date.now(),
    }
    recent.push(record)

    // 最近最多 10 条
    while (recent.length > 10) recent.shift()

    // 实时增加计数器（持久化）
    incPurifiedCount(1).catch(() => {
      // ignore
    })
  } else {
    // 如果你现场修改规则导致 reason 变化，这里同步最近记录（按 cardUid 查找，避免 shift 导致下标错位）
    const r = recent.find((x) => x.cardUid === cardUid)
    if (r) {
      r.ruleId = match.id
      r.ruleName = match.name
      r.patternLiteral = match.patternLiteral
      r.title = titleText
      r.ts = r.ts ?? Date.now()
    }
  }

  stateByCard.set(cardEl, st)
}

function processCard(cardEl: HTMLElement, _opts?: { forceRecheck?: boolean }) {
  try {
    const titleText = extractCardTitle(cardEl)
    if (!titleText) return

    reEvalAndApplyState(cardEl, titleText)
  } catch {
    // 绝不让拦截逻辑阻断页面
  }
}

function startMutationObserver() {
  const queuedCards = new Set<HTMLElement>()
  let debounceTimer: number | null = null
  const flush = () => {
    for (const cardEl of queuedCards) processCard(cardEl)
    queuedCards.clear()
    requestAnimationFrame(() => updateOverlayPositions())
  }
  const scheduleFlush = () => {
    if (debounceTimer !== null) window.clearTimeout(debounceTimer)
    debounceTimer = window.setTimeout(flush, 120)
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        const cards = resolveCardsFromNode(node)
        for (const cardEl of cards) queuedCards.add(cardEl)
      }
    }
    scheduleFlush()
  })

  observer.observe(document.documentElement, { childList: true, subtree: true })
}

function initialScan() {
  const cards = document.querySelectorAll?.('section.note-item')
  cards?.forEach((c) => processCard(c as HTMLElement))
}

function wireOverlayPositioningLoop() {
  let scheduled = false
  const schedule = () => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      updateOverlayPositions()
    })
  }
  window.addEventListener('scroll', schedule, { passive: true })
  window.addEventListener('resize', schedule)
}

function wireMessages() {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'get_recent') {
      sendResponse({ recent })
    }
  })
}

function wireStorageSync() {
  let rescanTimer: number | null = null
  const scheduleRescan = () => {
    if (rescanTimer !== null) window.clearTimeout(rescanTimer)
    rescanTimer = window.setTimeout(() => initialScan(), 100)
  }

  chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName !== 'local') return
    if (changes[STORAGE_KEYS.rules]) {
      const latest = await getRulesFromStorage()
      if (latest) rules = latest
      scheduleRescan()
    }
    if (changes[STORAGE_KEYS.whitelist]) {
      const latest = await getWhitelistAuthors()
      whitelistMap = new Map(latest.map((a) => [a.id, a.name]))
      scheduleRescan()
    }
  })
}

async function init() {
  injectGlobalStyles()
  wireOverlayPositioningLoop()
  wireMessages()
  wireStorageSync()
  rules = await ensureRulesInitialized(defaultRules)
  const wl = await getWhitelistAuthors()
  whitelistMap = new Map(wl.map((a) => [a.id, a.name]))

  initialScan()
  startMutationObserver()
}

init().catch(() => {
  // ignore：避免影响页面
})

