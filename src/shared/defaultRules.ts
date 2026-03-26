import type { StopBaitRule } from './types'

export function createDefaultRules(): StopBaitRule[] {
  const now = Date.now()
  return [
    {
      id: 'age_money_wan_k',
      type: 'regex',
      enabled: true,
      name: '年龄+赚/存/拿/入 + 万k 话术',
      patternLiteral: '/\\d+岁.*(赚|存|拿|入).*[万k]/',
      createdAt: now,
    },
    {
      id: 'top_scarce_headlinebait',
      type: 'regex',
      enabled: true,
      name: '顶级/稀缺/天花板/教科书级 等标题党',
      patternLiteral: '/(顶级|稀缺|天花板|教科书级|保姆级|避坑|一定要)/',
      createdAt: now,
    },
    {
      id: 'sexual_tension_pure',
      type: 'regex',
      enabled: true,
      name: '性张力/纯欲/斩男 等标签营销',
      patternLiteral: '/(性张力|生理性喜欢|顶级女性特质|斩男|纯欲)/',
      createdAt: now,
    },
    {
      id: 'bigtech_depart_sidejob_flip',
      type: 'regex',
      enabled: true,
      name: '大厂离职/裸辞/副业/翻身/认知差',
      patternLiteral: '/(大厂离职|裸辞.*天|副业|翻身|认知差)/',
      createdAt: now,
    },
    {
      id: 'fear_of_missing_out',
      type: 'regex',
      enabled: true,
      name: '惊呆了/不看后悔/谁懂啊/真的绝了',
      patternLiteral: '/(惊呆了|不看后悔|谁懂啊|真的绝了)/',
      createdAt: now,
    },
  ]
}

