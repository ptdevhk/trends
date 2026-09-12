/**
 * Hand-checked happy-path payload for POST /api/research/channels-briefing.
 * Share ids are the 2026-09-10 curator golden set from the work-item demo —
 * not invented. Cover URLs are example.invalid so tests never hit WeChat.
 */
export const CHANNELS_BRIEFING_GOLDEN_URLS = [
  'https://weixin.qq.com/sph/ALr3ch0zp9',
  'https://weixin.qq.com/sph/A3F4F1Vabv',
  'https://weixin.qq.com/sph/Ah85Fcapqh',
] as const

export const CHANNELS_BRIEFING_FIXTURE = {
  success: true as const,
  briefing: {
    oneLiner:
      '明天别只聊“谁在买五轴”。这三条内容讲的是同一条需求链：AI 服务器要把热带走 → 冷板 / 歧管 / UQD 接头要上量。',
    generatedAt: '2026-09-10T12:00:00.000Z',
    posts: [
      {
        shareId: 'ALr3ch0zp9',
        url: 'https://weixin.qq.com/sph/ALr3ch0zp9',
        author: '9月22日23日深圳液冷全产业链展',
        caption:
          '4.5亿！年产1200万套，AI散热领域龙头奇宏电子（AVC）深圳扩建AI服务器液冷散热产线！',
        createtime: 1756000000,
        likes: 111,
        comments: 8,
        forwards: 551,
        favs: 165,
        coverUrl: 'https://example.invalid/covers/ALr3ch0zp9.jpg',
      },
      {
        shareId: 'A3F4F1Vabv',
        url: 'https://weixin.qq.com/sph/A3F4F1Vabv',
        author: '9月22日23日深圳液冷全产业链展',
        caption:
          '40家液冷接头供应商。封面点名奇宏 AVC、Staubli、Parker、Danfoss、Auras、酷冷至尊、比亚迪、英维克、立敏达。',
        createtime: 1757040000,
        likes: 43,
        comments: 2,
        forwards: 293,
        favs: 76,
        coverUrl: null,
      },
      {
        shareId: 'Ah85Fcapqh',
        url: 'https://weixin.qq.com/sph/Ah85Fcapqh',
        author: '压铸WEEKLY',
        caption: '拓普集团上半年营收近142亿元，布局机器人、液冷业务寻找新增长点。',
        createtime: 1756500000,
        likes: 38,
        comments: 1,
        forwards: 93,
        favs: 60,
        coverUrl: 'https://example.invalid/covers/Ah85Fcapqh.jpg',
      },
    ],
    coreTrends: [
      '液冷从“概念”变成深圳扩产订单。',
      '接头是卡脖子件，名单已经铺开。',
    ],
    weakSignals: ['三条都没有点名机床品牌或五轴型号。'],
    opportunities: [
      {
        who: '奇宏电子（AVC）深圳新产线',
        sell: '立加 / 高速钻攻',
        why: '年产 1200 万套冷板 + UQD',
      },
    ],
    sources: [
      'https://weixin.qq.com/sph/ALr3ch0zp9',
      'https://weixin.qq.com/sph/A3F4F1Vabv',
      'https://weixin.qq.com/sph/Ah85Fcapqh',
    ],
  },
}
