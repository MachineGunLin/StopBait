export type RuleType = 'contains' | 'regex'

export type StopBaitRule = {
  id: string
  type: RuleType
  enabled: boolean
  name: string
  /**
   * - contains: 普通关键词
   * - regex: 正则字面量（形如 `/.../i` 或 `/.../`）
   */
  patternLiteral: string
  createdAt: number
  updatedAt?: number
}

export type RecentRecord = {
  cardUid?: string
  title: string
  ruleId: string
  ruleName: string
  patternLiteral: string
  ts: number
}

export type WhitelistAuthor = {
  id: string
  name?: string
}

