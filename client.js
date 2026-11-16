/**
 * Browser half of dsh-deepseek-pricing.
 *
 * Registers three seats in the DSH Web UI:
 *   conversation.input.left  — a compact peak/off-peak chip with a popover card
 *   settings.section         — the full price table, schedule and data sources
 *   plugins.detail.section   — the compact feature switches on the plugin page
 *
 * The Host half owns every network call and every price/holiday calculation;
 * this module only renders the JSON it receives from /api/deepseek-pricing/*.
 * Browser-only switches live in localStorage; switches that change Host
 * behaviour are written back through /api/deepseek-pricing/config so the
 * profile's cordis.patch.yml stays the one source of truth.
 */

window.__ModuleLoader__.load({
  id: 'dsh-deepseek-pricing',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    const NS = 'dsh-deepseek-pricing'
    const PKG = 'dsh-deepseek-pricing'
    const ROW_ID = 'deepseek-pricing'
    const API_STATE = '/api/deepseek-pricing/state'
    const API_REFRESH = '/api/deepseek-pricing/refresh'
    const API_CONFIG = '/api/deepseek-pricing/config'
    const LS_CURRENCY = 'dsh-deepseek-pricing.currency'
    const RELOAD_INTERVAL_MS = 30 * 60 * 1000

    const ZH = {
      loading: '加载中…',
      unavailable: '时段不可用',
      peakLabel: '高峰 · 全价',
      offPeakLabel: '空闲 · 半价',
      peakTier: '高峰',
      offPeakTier: '空闲',
      toPeak: '后转高峰',
      toOffPeak: '后转空闲',
      nowBeijing: '北京时间',
      panelTitle: 'DeepSeek 计费时段',
      todayPeak: '工作日 09:00–12:00、14:00–18:00 为高峰',
      holidayAllDay: '法定节假日 · 全天空闲',
      weekendAllDay: '周末 · 全天空闲',
      model: '模型',
      tier: '档位',
      cacheHit: '缓存命中',
      cacheMiss: '缓存未命中',
      output: '输出',
      unitPerMillion: '元 / 百万 tokens',
      unitPerMillionUsd: '$ / 百万 tokens',
      updated: '更新于',
      source: '来源',
      officialDoc: '官方文档',
      stale: '离线快照',
      refresh: '刷新',
      refreshing: '刷新中…',
      retry: '重试',
      errorPrefix: '数据不可用：',
      section: 'DeepSeek 价格',
      settingsIntro: '查看当前计费时段与各模型单价，价格来自 DeepSeek 官方文档。',
      currentPeriod: '当前时段',
      nextSwitch: '下一次切换',
      scheduleTitle: '时段规则',
      scheduleBody: '北京时间周一至周五 09:00–12:00、14:00–18:00 为高峰；周末与法定节假日全天空闲。空闲价为高峰价的一半。',
      localHint: '按北京时间（UTC+8）计算，与你的本机时区无关。',
      priceTitle: '模型价格',
      priceHint: '每百万 tokens；高峰价为空闲价的两倍。',
      dataTitle: '数据',
      holidayTitle: '法定节假日',
      holidaysSynced: '已同步',
      holidaysSnapshot: '内置快照',
      holidaysUnpublished: '尚未发布',
      holidaysFailed: '获取失败',
      holidaysStale: '沿用上次',
      holidaysPending: '检查中',
      holidaysCached: '本地缓存',
      footnote: '价格为官方文档快照，实际扣费以 DeepSeek 账单为准。',
      searchFetch: '网页搜索 / 抓取',
      perThousand: '每 1000 次成功请求',
      noTransition: '暂无',
      unitHour: '小时',
      unitMin: '分钟',
      weekday1: '周一',
      weekday2: '周二',
      weekday3: '周三',
      weekday4: '周四',
      weekday5: '周五',
      weekday6: '周六',
      weekday7: '周日',
      autoRefresh: '自动刷新',
      manualOnly: '仅手动',
      minutes: '分钟',
      close: '关闭',
      costTitle: '花费估算',
      costMappingSection: '模型映射',
      costHint: '按每轮结束时刻的高峰/空闲单价估算；只对已完成且官方用量完整的轮次显示。',
      costMappingHint: '每行填一个 provider/model（或只填模型名），选它该用哪套价目，靠上的行优先；没匹配到的按模型名里的 flash / pro 自动判断。',
      costAddRow: '添加映射',
      costClear: '清除本地设置',
      costRemove: '删除',
      costAuto: '自动',
      costIgnore: '不计价',
      costDetectedNone: '未识别',
      costLocalOnly: '这些映射只在显示每轮花费时用来区分 flash / pro 的价目；不开启花费估算就不用管。设置只保存在本浏览器。',
      numberSection: '数字格式',
      numberIntro: '只改每轮预估花费的写法，不影响价格本身。',
      numberSeparator: '分隔符',
      numberGroup: '分组',
      numberGroupHint: '整数与小数部分都按这个位数分组；不分隔时无效。',
      numberGroup3: '每 3 位',
      numberGroup4: '每 4 位',
      numberDecimals: '小数位',
      numberDecimalsHint: '四舍五入到指定位数，末尾零保留。',
      numberTiny: '小额显示',
      numberTinyHint: '四舍五入后为 0 但确实有花费时。',
      numberPreview: '预览',
      sepSpace: '空格',
      sepComma: '英文逗号',
      sepBar: '竖线',
      sepDash: '竖虚线',
      sepNone: '不分隔',
      uninstallTitle: '卸载说明',
      uninstallIntro: '卸载会删掉插件文件和节假日缓存，不会动 DSH 或其它插件。下面几项不属于插件本体，不清理也没有副作用；介意残留时按每一条下面的操作处理。',
      uninstallLocal: '浏览器里的显示偏好',
      uninstallLocalAction: '设置 → DeepSeek 价格 → 花费估算 →「清除本地设置」，会一并删掉 dsh-deepseek-pricing.cost（花费开关、模型映射、数字格式）与 dsh-deepseek-pricing.currency（¥/$）。',
      uninstallRow: '配置覆盖',
      uninstallRowAction: '只在界面里改过「查询工具 / 节假日 / 刷新间隔」时出现：删掉 profile 的 cordis.patch.yml 里 - id: deepseek-pricing 那一段。',
      uninstallPnpm: 'pnpm 发布龄规则',
      uninstallPnpmAction: '只在安装刚发布的版本时出现：删掉 profile 的 pnpm-workspace.yaml 里 minimumReleaseAgeExclude: dsh-deepseek-pricing@x.y.z 一行。',
      uninstallCache: '节假日缓存',
      uninstallCacheAction: '在包目录 .cache/holidays.json 里，随卸载一起删除，无需处理。',
      costEstimate: '预估花费',
      costUnavailable: '无法估算',
      costReasonRoute: '缺少模型/路由信息',
      costReasonCacheRead: '缺少缓存读取用量',
      costReasonUnknownModel: '无法识别模型',
      costReasonMixedModel: '混合模型，无法精确计价',
      costReasonPrices: '价格数据不可用',
      costReasonTime: '时间信息缺失',
      costModel: '模型',
      costUncached: '未缓存输入',
      costCacheRead: '缓存读取',
      costOutput: '输出',
      costUnit: '每百万 tokens',
      costSnapshot: '价格快照',
      costStale: '离线',
      costPeak: '高峰（全价）',
      costOffPeak: '空闲（半价）',
      featTitle: '功能开关',
      featIntro: '这里只控制插件内部的功能。',
      featCost: '每轮花费估算',
      featCostHint: '在每轮结束的时间行上方右对齐显示预估花费，数据缺失时显示 ~。只保存在本浏览器。',
      featTool: 'AI 查询工具 deepseek_pricing',
      featToolHint: '开启后模型可以主动查询当前时段与单价。写入插件配置，保存后本插件会重新加载。',
      featHoliday: '同步法定节假日',
      featHolidayHint: '关闭后只用内置快照判断「节假日全天空闲」。写入插件配置，保存后本插件会重新加载。',
      featRefresh: '价格自动刷新',
      featRefreshHint: 'Host 按间隔抓取官方文档；选「仅手动」时只有点刷新才抓取。写入插件配置，保存后本插件会重新加载。',
      featSaving: '已提交，插件正在重新加载…',
      featSaved: '已保存。',
      featFailed: '保存失败：',
      featReloadTag: '需重载',
      featLocalTag: '即时',
      featHostUnavailable: '当前 DSH 版本不支持自动写入，请手动编辑 cordis.patch.yml。',
      detailTitle: '功能开关',
      detailIntro: '完整设置在「设置 → DeepSeek 价格」；这里放最常用的两个。',
      detailUnsupported: '自动写入不可用，开关只在本页临时生效。',
    }

    const EN = {
      loading: 'Loading…',
      unavailable: 'Schedule unavailable',
      peakLabel: 'Peak · Full price',
      offPeakLabel: 'Off-peak · Half price',
      peakTier: 'Peak',
      offPeakTier: 'Off-peak',
      toPeak: ' until peak',
      toOffPeak: ' until off-peak',
      nowBeijing: 'Beijing time',
      panelTitle: 'DeepSeek billing window',
      todayPeak: 'Weekdays 09:00–12:00 and 14:00–18:00 are peak',
      holidayAllDay: 'Public holiday · off-peak all day',
      weekendAllDay: 'Weekend · off-peak all day',
      model: 'Model',
      tier: 'Tier',
      cacheHit: 'Cache hit',
      cacheMiss: 'Cache miss',
      output: 'Output',
      unitPerMillion: 'CNY / 1M tokens',
      unitPerMillionUsd: 'USD / 1M tokens',
      updated: 'Updated',
      source: 'Source',
      officialDoc: 'Official docs',
      stale: 'Offline snapshot',
      refresh: 'Refresh',
      refreshing: 'Refreshing…',
      retry: 'Retry',
      errorPrefix: 'Data unavailable: ',
      section: 'DeepSeek Pricing',
      settingsIntro: 'See the current billing window and per-model prices from the official DeepSeek docs.',
      currentPeriod: 'Current period',
      nextSwitch: 'Next switch',
      scheduleTitle: 'Schedule',
      scheduleBody: 'Peak hours are Beijing time Monday–Friday 09:00–12:00 and 14:00–18:00; weekends and public holidays are off-peak all day. Off-peak is half of peak.',
      localHint: 'Computed in Beijing time (UTC+8), independent of your machine time zone.',
      priceTitle: 'Model prices',
      priceHint: 'Per 1M tokens; peak is twice the off-peak price.',
      dataTitle: 'Data',
      holidayTitle: 'Public holidays',
      holidaysSynced: 'Synced',
      holidaysSnapshot: 'Snapshot',
      holidaysUnpublished: 'Not published',
      holidaysFailed: 'Failed',
      holidaysStale: 'Kept last sync',
      holidaysPending: 'Checking',
      holidaysCached: 'Local cache',
      footnote: 'Prices are a snapshot of the official docs; billing always follows DeepSeek.',
      searchFetch: 'Search / Fetch',
      perThousand: 'per 1,000 successful requests',
      noTransition: 'n/a',
      unitHour: 'h',
      unitMin: 'm',
      weekday1: 'Mon',
      weekday2: 'Tue',
      weekday3: 'Wed',
      weekday4: 'Thu',
      weekday5: 'Fri',
      weekday6: 'Sat',
      weekday7: 'Sun',
      autoRefresh: 'Auto refresh',
      manualOnly: 'Manual only',
      minutes: 'min',
      close: 'Close',
      costTitle: 'Cost estimate',
      costMappingSection: 'Model mappings',
      costHint: 'Estimated with the peak/off-peak price at the turn end; shown only for completed turns with complete usage.',
      costMappingHint: 'One provider/model per row (or just the model name) and which price list it uses; the first matching row wins. Unmatched routes fall back to flash / pro in the model name.',
      costAddRow: 'Add mapping',
      costClear: 'Clear local settings',
      costRemove: 'Remove',
      costAuto: 'Auto',
      costIgnore: 'Ignore',
      costDetectedNone: 'Unrecognized',
      costLocalOnly: 'These mappings only pick the flash / pro price list for the per-turn cost estimate; ignore them when the estimate is off. Saved in this browser only.',
      numberSection: 'Number format',
      numberIntro: 'Only changes how the per-turn estimate is written, never the price itself.',
      numberSeparator: 'Separator',
      numberGroup: 'Grouping',
      numberGroupHint: 'Applies to the integer and fraction part alike; ignored when not separating.',
      numberGroup3: 'Every 3 digits',
      numberGroup4: 'Every 4 digits',
      numberDecimals: 'Decimals',
      numberDecimalsHint: 'Rounded to this many places; trailing zeros are kept.',
      numberTiny: 'Tiny amounts',
      numberTinyHint: 'When rounding would show 0 but the turn did cost something.',
      numberPreview: 'Preview',
      sepSpace: 'Space',
      sepComma: 'Comma',
      sepBar: 'Pipe',
      sepDash: 'Vertical dashed',
      sepNone: 'None',
      uninstallTitle: 'Before you uninstall',
      uninstallIntro: 'Uninstalling removes the plugin files and the holiday cache; it never touches DSH or other plugins. The items below are not part of the plugin, so leaving them is harmless — clean them only if you dislike leftovers.',
      uninstallLocal: 'Browser display preferences',
      uninstallLocalAction: 'Settings → DeepSeek Pricing → Cost estimate → “Clear local settings” also drops dsh-deepseek-pricing.cost (cost toggle, model mappings, number format) and dsh-deepseek-pricing.currency (¥/$).',
      uninstallRow: 'Config override',
      uninstallRowAction: 'Only exists after changing “query tool / holidays / refresh interval”: delete the - id: deepseek-pricing block from the profile’s cordis.patch.yml.',
      uninstallPnpm: 'pnpm release-age rule',
      uninstallPnpmAction: 'Only appears when installing a just-published version: delete the minimumReleaseAgeExclude: dsh-deepseek-pricing@x.y.z line from the profile’s pnpm-workspace.yaml.',
      uninstallCache: 'Holiday cache',
      uninstallCacheAction: 'Lives in the package at .cache/holidays.json and goes away with the package — nothing to do.',
      costEstimate: 'Estimated cost',
      costUnavailable: 'Not available',
      costReasonRoute: 'model/route missing',
      costReasonCacheRead: 'cache-read usage missing',
      costReasonUnknownModel: 'unrecognized model',
      costReasonMixedModel: 'mixed models',
      costReasonPrices: 'price data unavailable',
      costReasonTime: 'time missing',
      costModel: 'Model',
      costUncached: 'Uncached input',
      costCacheRead: 'Cache read',
      costOutput: 'Output',
      costUnit: 'per 1M tokens',
      costSnapshot: 'Price snapshot',
      costStale: 'offline',
      costPeak: 'Peak (full price)',
      costOffPeak: 'Off-peak (half price)',
      featTitle: 'Feature switches',
      featIntro: 'These switches only control this plugin’s own features.',
      featCost: 'Per-turn cost estimate',
      featCostHint: 'Shows an estimate above the turn’s time row, or ~ when data is missing. Saved in this browser only.',
      featTool: 'AI query tool (deepseek_pricing)',
      featToolHint: 'Lets the model check the current window and prices. Written to the plugin config; the plugin reloads after saving.',
      featHoliday: 'Sync public holidays',
      featHolidayHint: 'Off keeps the built-in snapshot only. Written to the plugin config; the plugin reloads after saving.',
      featRefresh: 'Automatic price refresh',
      featRefreshHint: 'How often the Host re-reads the official docs; “Manual only” fetches on demand. Written to the plugin config.',
      featSaving: 'Submitted — the plugin is reloading…',
      featSaved: 'Saved.',
      featFailed: 'Save failed: ',
      featReloadTag: 'reloads',
      featLocalTag: 'instant',
      featHostUnavailable: 'This DSH build cannot write config; edit cordis.patch.yml manually.',
      detailTitle: 'Feature switches',
      detailIntro: 'Full settings are under Settings → DeepSeek Pricing; the two most used switches are here.',
      detailUnsupported: 'Config writing is unavailable, so the switch is temporary on this page.',
    }

    const CSS = `
.dp-root { display: inline-flex; align-items: center; }
.dp-chip { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 8px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l1); background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; line-height: 1; cursor: pointer; white-space: nowrap; }
.dp-chip:hover { background: var(--dsw-alias-bg-layer-2); }
.dp-chip.is-open { background: var(--dsw-alias-bg-layer-2); }
.dp-chip:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dp-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-idle-primary); flex: none; }
.dp-chip.is-peak .dp-dot { background: var(--dsw-alias-state-warn-primary); }
.dp-chip.is-off .dp-dot { background: var(--dsw-alias-state-success-primary); }
.dp-chip-sub { color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.dp-popover { position: fixed; box-sizing: border-box; width: 320px; max-height: min(72vh, 520px); overflow: auto; background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; box-shadow: 0 12px 32px color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent); padding: 12px; font-size: 12px; line-height: 1.5; }
.dp-popover:focus { outline: none; }
.dp-pop-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.dp-pop-status { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; }
.dp-pop-status.is-peak .dp-dot { background: var(--dsw-alias-state-warn-primary); }
.dp-pop-status.is-off .dp-dot { background: var(--dsw-alias-state-success-primary); }
.dp-muted { color: var(--dsw-alias-label-secondary); }
.dp-small { font-size: 11px; }
.dp-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.dp-table th, .dp-table td { text-align: right; padding: 4px 5px; border-bottom: 1px solid var(--dsw-alias-border-l1); font-weight: 400; white-space: nowrap; }
.dp-table th { color: var(--dsw-alias-label-secondary); font-weight: 500; font-size: 11px; }
.dp-table th:first-child, .dp-table td:first-child { text-align: left; }
.dp-table td.dp-model-cell { vertical-align: top; padding-top: 6px; }
.dp-table tr.is-current td { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, transparent); }
.dp-table tr:last-child td { border-bottom: 0; }
.dp-strong { font-weight: 600; }
.dp-pop-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l1); }
.dp-btn { font: inherit; font-size: 12px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; padding: 3px 10px; cursor: pointer; }
.dp-btn:hover { background: var(--dsw-alias-bg-layer-1); }
.dp-btn:disabled { opacity: .55; cursor: default; }
.dp-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dp-link { color: var(--dsw-alias-brand-primary); text-decoration: none; }
.dp-link:hover { text-decoration: underline; }
.dp-btn-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dp-section { display: flex; flex-direction: column; gap: 16px; padding: 4px 2px 32px; max-width: 780px; }
.dp-h2 { margin: 0; font-size: 16px; font-weight: 600; }
.dp-intro { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 13px; }
.dp-card { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 12px 14px; background: var(--dsw-alias-bg-layer-1); }
.dp-card-title { font-size: 13px; font-weight: 600; margin: 0 0 8px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dp-hero { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 18px; }
.dp-hero-status { display: inline-flex; align-items: center; gap: 8px; font-size: 18px; font-weight: 600; }
.dp-hero.is-peak .dp-dot { background: var(--dsw-alias-state-warn-primary); }
.dp-hero.is-off .dp-dot { background: var(--dsw-alias-state-success-primary); }
.dp-hero .dp-dot { width: 9px; height: 9px; }
.dp-banner { border: 1px solid var(--dsw-alias-state-warn-primary); border-radius: 8px; padding: 8px 10px; color: var(--dsw-alias-label-primary); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent); font-size: 12px; display: flex; gap: 8px; align-items: center; justify-content: space-between; }
.dp-banner.is-error { border-color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); }
.dp-seg { display: inline-flex; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; overflow: hidden; }
.dp-seg button { font: inherit; font-size: 12px; padding: 3px 10px; border: 0; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dp-seg button.is-on { background: color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent); color: var(--dsw-alias-label-primary); font-weight: 600; }
.dp-seg button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.dp-seg button:disabled { opacity: .45; cursor: default; }
.dp-preview { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 10px; padding: 6px 8px; border-radius: 6px; background: var(--dsw-alias-bg-layer-2); font-size: 12px; font-variant-numeric: tabular-nums; }
.dp-subblock + .dp-subblock { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--dsw-alias-border-l1); }
.dp-subtitle { font-size: 12.5px; font-weight: 600; margin: 0 0 4px; }
.dp-notes { margin: 4px 0 0; padding-left: 18px; font-size: 12px; line-height: 1.55; }
.dp-notes li + li { margin-top: 6px; }
.dp-notes li .dp-opt-title { display: block; }
.dp-notes-action { display: block; margin-top: 1px; color: var(--dsw-alias-label-secondary); font-size: 11px; }
.dp-kv { display: grid; grid-template-columns: 112px 1fr; gap: 6px 12px; font-size: 12px; margin: 0; }
.dp-kv dt { color: var(--dsw-alias-label-secondary); }
.dp-kv dd { margin: 0; word-break: break-word; }
.dp-footnote { color: var(--dsw-alias-label-secondary); font-size: 11px; margin: 0; }
.dp-warn-list { margin: 0; padding-left: 18px; color: var(--dsw-alias-state-warn-primary); font-size: 12px; }
.dp-warn-list li + li { margin-top: 2px; }
.dp-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.dp-year { display: inline-flex; gap: 6px; align-items: center; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; padding: 2px 8px; font-size: 11px; }
.dp-year .dp-year-status { color: var(--dsw-alias-label-secondary); }
.dp-year.is-fresh .dp-year-status { color: var(--dsw-alias-state-success-primary); }
.dp-year.is-warn .dp-year-status { color: var(--dsw-alias-state-warn-primary); }
.dp-model-name { font-size: 11px; font-weight: 400; }
.dp-schedule-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.dp-schedule-bar { display: inline-block; height: 8px; border-radius: 4px; background: var(--dsw-alias-state-warn-primary); opacity: .75; }
.dp-schedule-bar.is-off { background: var(--dsw-alias-state-success-primary); opacity: .45; }
.dp-loading { color: var(--dsw-alias-label-secondary); font-size: 12px; padding: 6px 0; }
.dp-cost { display: flex; justify-content: flex-end; padding: 2px 2px 0; }
.dp-cost-chip { color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.4; font-variant-numeric: tabular-nums; cursor: default; }
.dp-cost-chip:hover { color: var(--dsw-alias-label-primary); }
.dp-map-row { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(96px, auto) auto; gap: 8px; align-items: center; margin-top: 6px; }
.dp-input { font: inherit; font-size: 12px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; padding: 3px 8px; min-width: 0; }
.dp-input:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dp-opt { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto; gap: 2px 8px; align-items: start; padding: 7px 0; border-top: 1px solid var(--dsw-alias-border-l1); cursor: pointer; }
.dp-opt:first-of-type { border-top: 0; }
.dp-opt input { margin: 2px 0 0; cursor: pointer; }
.dp-opt-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dp-opt-title { font-size: 12px; }
.dp-opt-hint { color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.45; }
.dp-opt-tag { color: var(--dsw-alias-label-secondary); font-size: 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; padding: 1px 6px; white-space: nowrap; }
.dp-opt.is-busy { opacity: .6; }
.dp-inline { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 0; border-top: 1px solid var(--dsw-alias-border-l1); }
.dp-inline-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dp-status { font-size: 11px; color: var(--dsw-alias-label-secondary); margin: 6px 0 0; }
.dp-status.is-error { color: var(--dsw-alias-state-error-primary); }
.dp-status.is-busy { color: var(--dsw-alias-state-warn-primary); }
.dp-detail { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 12px 14px; background: var(--dsw-alias-bg-layer-1); margin: 4px 0 8px; }
`

    /* --------------------------------------------------------------------- */
    /* small shared state: currency preference                               */
    /* --------------------------------------------------------------------- */

    const currencyListeners = new Set()

    function readStoredCurrency() {
      try {
        const value = localStorage.getItem(LS_CURRENCY)
        return value === 'USD' || value === 'CNY' ? value : null
      } catch {
        return null
      }
    }

    function storeCurrency(value, notify) {
      try {
        localStorage.setItem(LS_CURRENCY, value)
      } catch {
        /* storage unavailable */
      }
      if (notify) {
        for (const listener of Array.from(currencyListeners)) {
          try {
            listener(value)
          } catch {
            /* ignore listener failure */
          }
        }
      }
    }

    function useCurrency() {
      const [currency, setCurrencyState] = useState(readStoredCurrency)
      useEffect(() => {
        const listener = (next) => setCurrencyState(next)
        currencyListeners.add(listener)
        return () => currencyListeners.delete(listener)
      }, [])
      const setCurrency = useCallback((next) => {
        storeCurrency(next, true)
        setCurrencyState(next)
      }, [])
      return [currency, setCurrency]
    }

    /* --------------------------------------------------------------------- */
    /* data + time helpers                                                   */
    /* --------------------------------------------------------------------- */

    function describeError(error) {
      if (!error) return 'unknown error'
      return error instanceof Error ? error.message : String(error)
    }

    function usePricing(currency) {
      const [state, setState] = useState({
        loading: true,
        data: null,
        error: null,
        skew: 0,
        attempt: 0,
      })
      const seq = useRef(0)

      const load = useCallback(
        async (options = {}) => {
          const ticket = ++seq.current
          setState((prev) => ({ ...prev, loading: true, error: null }))
          try {
            const query = currency ? `?currency=${encodeURIComponent(currency)}` : ''
            const url = (options.force ? API_REFRESH : API_STATE) + query
            const response = await fetch(url, {
              method: options.force ? 'POST' : 'GET',
              cache: 'no-store',
            })
            const payload = await response.json().catch(() => null)
            if (!response.ok || !payload || payload.ok !== true) {
              throw new Error((payload && payload.error) || `HTTP ${response.status}`)
            }
            if (ticket === seq.current) {
              setState({
                loading: false,
                data: payload,
                error: null,
                skew: payload.nowMs - Date.now(),
                attempt: 0,
              })
            }
          } catch (error) {
            if (ticket === seq.current) {
              setState((prev) => ({
                ...prev,
                loading: false,
                error: describeError(error),
                attempt: prev.attempt + 1,
              }))
            }
          }
        },
        [currency],
      )

      useEffect(() => {
        load()
      }, [load])

      // On a cold DSH start the page can be served before every plugin row has
      // activated, so the very first request may legitimately be a 404. Back
      // off and retry instead of pinning the chip to "unavailable" until the
      // next scheduled reload. This also heals the one-second window where
      // writing a Host switch reloads this plugin's own row and the route
      // briefly disappears: retry even when older data is still on screen.
      useEffect(() => {
        if (!state.error) return undefined
        const attempt = Math.min(state.attempt, 6)
        const delay = Math.min(30000, 1000 * 2 ** Math.max(0, attempt - 1))
        const timer = setTimeout(() => load(), delay)
        return () => clearTimeout(timer)
      }, [state.attempt, state.error, load])

      // Coming back to the tab is a cheap moment to heal an early failure.
      useEffect(() => {
        const onVisible = () => {
          if (document.visibilityState === 'visible' && !state.data) load()
        }
        document.addEventListener('visibilitychange', onVisible)
        return () => document.removeEventListener('visibilitychange', onVisible)
      }, [load, state.data])

      useEffect(() => {
        const id = setInterval(() => load(), RELOAD_INTERVAL_MS)
        return () => clearInterval(id)
      }, [load])

      // The Host refreshes holidays behind the state read. While a year is still
      // being checked, or was kept from an older sync, look again shortly
      // instead of waiting for the 30-minute poll.
      const holidayFollowUps = useRef(0)
      useEffect(() => {
        const years = state.data && state.data.holidays && state.data.holidays.years
        const waiting =
          Array.isArray(years) &&
          years.some(
            (entry) =>
              entry.status === 'pending' ||
              entry.status === 'stale' ||
              entry.status === 'snapshot' ||
              entry.status === 'unavailable',
          )
        if (!waiting) {
          holidayFollowUps.current = 0
          return undefined
        }
        if (holidayFollowUps.current >= 3) return undefined
        holidayFollowUps.current += 1
        const soon = setTimeout(() => load(), 5000)
        const later = setTimeout(() => load(), 20000)
        // The Host retries a failed fetch after a minute; look once after that.
        const retried = setTimeout(() => load(), 75000)
        return () => {
          clearTimeout(soon)
          clearTimeout(later)
          clearTimeout(retried)
        }
      }, [state.data, load])

      return { ...state, reload: load }
    }

    function useTick() {
      const [tick, setTick] = useState(() => Date.now())
      useEffect(() => {
        const id = setInterval(() => setTick(Date.now()), 1000)
        return () => clearInterval(id)
      }, [])
      return tick
    }

    const clockFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    const dateFormatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })

    function beijingClock(ms) {
      try {
        const parts = clockFormatter.formatToParts(new Date(ms))
        const hour = (parts.find((part) => part.type === 'hour') || {}).value || '00'
        const minute = (parts.find((part) => part.type === 'minute') || {}).value || '00'
        return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
      } catch {
        return '--:--'
      }
    }

    function beijingDateKey(ms) {
      try {
        const parts = dateFormatter.formatToParts(new Date(ms))
        const year = (parts.find((part) => part.type === 'year') || {}).value || ''
        const month = (parts.find((part) => part.type === 'month') || {}).value || ''
        const day = (parts.find((part) => part.type === 'day') || {}).value || ''
        return `${year}-${month}-${day}`
      } catch {
        return ''
      }
    }

    function pad2(value) {
      return String(value).padStart(2, '0')
    }

    function shortDuration(ms) {
      if (!Number.isFinite(ms) || ms <= 0) return '<1m'
      const minutes = Math.floor(ms / 60000)
      const hours = Math.floor(minutes / 60)
      const rest = minutes % 60
      if (hours > 0) return rest > 0 ? `${hours}h${pad2(rest)}m` : `${hours}h`
      if (minutes > 0) return `${minutes}m`
      return '<1m'
    }

    function durationText(ms, t) {
      if (!Number.isFinite(ms) || ms <= 0) return `0${t('unitMin')}`
      const minutes = Math.max(1, Math.floor(ms / 60000))
      const hours = Math.floor(minutes / 60)
      const rest = minutes % 60
      if (hours <= 0) return `${minutes}${t('unitMin')}`
      return rest > 0
        ? `${hours}${t('unitHour')} ${rest}${t('unitMin')}`
        : `${hours}${t('unitHour')}`
    }

    function formatNumber(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      return String(Number(value.toFixed(4)))
    }

    function money(currency, value) {
      return `${currency === 'USD' ? '$' : '¥'}${formatNumber(value)}`
    }

    function isHttpUrl(value) {
      return typeof value === 'string' && /^https?:\/\//i.test(value)
    }

    function weekdayLabel(t, isoWeekday) {
      return t(`weekday${isoWeekday}`)
    }

    function beijingStamp(ms) {
      if (!Number.isFinite(ms)) return '—'
      return `${beijingDateKey(ms)} ${beijingClock(ms)}`
    }

    /* --------------------------------------------------------------------- */
    /* cost estimate                                                         */
    /* --------------------------------------------------------------------- */

    const LS_COST = 'dsh-deepseek-pricing.cost'

    // Kept here (not with the formatters) because COST_DEFAULT needs them at
    // module evaluation time; the formatter functions themselves live below.
    const SEPARATOR_CHARS = { space: ' ', comma: ',', bar: '|', dash: '┊', none: '' }
    const SEPARATOR_IDS = ['space', 'comma', 'bar', 'dash', 'none']
    const GROUP_SIZES = [3, 4]
    const TINY_MODES = ['ellipsis', 'less']
    const FORMAT_DEFAULT = { groupSize: 3, separator: 'space', decimals: 3, tiny: 'ellipsis' }

    const COST_DEFAULT = { enabled: false, mappings: [], format: FORMAT_DEFAULT }
    const costListeners = new Set()

    function sanitizeCostPrefs(raw) {
      const value = raw && typeof raw === 'object' ? raw : {}
      const mappings = Array.isArray(value.mappings)
        ? value.mappings
            .filter((row) => row && typeof row.route === 'string')
            .map((row) => ({
              route: row.route.trim(),
              model:
                row.model === 'flash' || row.model === 'pro' || row.model === 'ignore'
                  ? row.model
                  : '',
            }))
        : []
      return { enabled: value.enabled === true, mappings, format: sanitizeFormat(value.format) }
    }

    function readCostPrefs() {
      try {
        const raw = localStorage.getItem(LS_COST)
        return raw ? sanitizeCostPrefs(JSON.parse(raw)) : COST_DEFAULT
      } catch {
        return COST_DEFAULT
      }
    }

    function writeCostPrefs(next) {
      const value = sanitizeCostPrefs(next)
      try {
        localStorage.setItem(LS_COST, JSON.stringify(value))
      } catch {
        /* storage unavailable */
      }
      for (const listener of Array.from(costListeners)) {
        try {
          listener(value)
        } catch {
          /* ignore listener failure */
        }
      }
      return value
    }

    function useCostPrefs() {
      const [prefs, setPrefs] = useState(readCostPrefs)
      useEffect(() => {
        const listener = (next) => setPrefs(next)
        costListeners.add(listener)
        return () => costListeners.delete(listener)
      }, [])
      const update = useCallback((next) => {
        const value = writeCostPrefs(typeof next === 'function' ? next(readCostPrefs()) : next)
        setPrefs(value)
      }, [])
      return [prefs, update]
    }

    /** Remove this plugin's browser preferences; profile files are removed by the bundle uninstall. */
    function clearLocalSettings() {
      try {
        localStorage.removeItem(LS_COST)
        localStorage.removeItem(LS_CURRENCY)
      } catch {
        /* storage unavailable */
      }
      for (const listener of Array.from(costListeners)) {
        try {
          listener(COST_DEFAULT)
        } catch {
          /* ignore listener failure */
        }
      }
      for (const listener of Array.from(currencyListeners)) {
        try {
          listener(null)
        } catch {
          /* ignore listener failure */
        }
      }
    }

    // One shared price read for every mounted cost chip: the page may render
    // dozens of turns, and each one must not issue its own request.
    const sharedPriceCache = new Map()
    const sharedPriceListeners = new Set()

    function sharedPriceEntry(currency) {
      return sharedPriceCache.get(currency || 'default') || null
    }

    function sharedPriceLoad(currency) {
      const key = currency || 'default'
      const entry = sharedPriceCache.get(key)
      if (entry && entry.at && Date.now() - entry.at < RELOAD_INTERVAL_MS) {
        return Promise.resolve(entry)
      }
      if (entry && entry.promise) return entry.promise
      const promise = (async () => {
        let next
        try {
          const query = currency ? `?currency=${encodeURIComponent(currency)}` : ''
          const response = await fetch(API_STATE + query, { cache: 'no-store' })
          const payload = await response.json().catch(() => null)
          if (!response.ok || !payload || payload.ok !== true) {
            throw new Error((payload && payload.error) || `HTTP ${response.status}`)
          }
          next = { state: payload, at: Date.now(), error: null, promise: null }
        } catch (error) {
          next = {
            state: entry ? entry.state : null,
            at: Date.now(),
            error: describeError(error),
            promise: null,
          }
        }
        sharedPriceCache.set(key, next)
        for (const listener of Array.from(sharedPriceListeners)) {
          try {
            listener(key)
          } catch {
            /* ignore listener failure */
          }
        }
        return next
      })()
      sharedPriceCache.set(key, {
        state: entry ? entry.state : null,
        at: entry ? entry.at : 0,
        error: entry ? entry.error : null,
        promise,
      })
      return promise
    }

    function useSharedPrice(currency, enabled) {
      const key = currency || 'default'
      const [snap, setSnap] = useState(() => sharedPriceEntry(currency))
      useEffect(() => {
        const listener = (changed) => {
          if (changed === key) setSnap(sharedPriceEntry(currency))
        }
        sharedPriceListeners.add(listener)
        setSnap(sharedPriceEntry(currency))
        return () => sharedPriceListeners.delete(listener)
      }, [currency, key])
      useEffect(() => {
        if (!enabled) return
        const entry = sharedPriceEntry(currency)
        if (!entry || !entry.state || Date.now() - entry.at >= RELOAD_INTERVAL_MS) {
          sharedPriceLoad(currency).catch(() => {})
        }
      }, [currency, enabled])
      return snap
    }

    function findByEndSeq(turnEnds, seq) {
      if (!turnEnds || typeof turnEnds.forEach !== 'function') return null
      let found = null
      turnEnds.forEach((end, turn) => {
        if (found === null && end === seq) found = turn
      })
      return found
    }

    function detectPriceModel(text) {
      const value = String(text || '').toLowerCase()
      if (value.includes('flash')) return 'deepseek-flash'
      if (value.includes('pro')) return 'deepseek-v4-pro'
      return null
    }

    function routeLabel(route) {
      return `${route.provider}/${route.model}`
    }

    function routePriceModel(route, prefs) {
      const label = routeLabel(route)
      for (const row of prefs.mappings) {
        if (row.route !== label && row.route !== route.model) continue
        if (row.model === 'ignore') return 'ignore'
        if (row.model === 'flash') return 'deepseek-flash'
        if (row.model === 'pro') return 'deepseek-v4-pro'
        return detectPriceModel(route.model)
      }
      return detectPriceModel(route.model)
    }

    /** Peak/off-peak at one instant, using the same Beijing rule as the Host. */
    function classifyPeakAt(ms, holidayDates) {
      if (!Number.isFinite(ms)) return null
      const dateKey = beijingDateKey(ms)
      if (!dateKey) return null
      const [year, month, day] = dateKey.split('-').map(Number)
      const hour = Number(beijingClock(ms).slice(0, 2))
      const utcDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
      const isoWeekday = utcDay === 0 ? 7 : utcDay
      const holiday = holidayDates && holidayDates[dateKey]
      const peak =
        isoWeekday >= 1 &&
        isoWeekday <= 5 &&
        !holiday &&
        ((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18))
      return {
        peak,
        period: peak ? 'peak' : 'off-peak',
        holidayName: holiday && holiday.name ? holiday.name : '',
      }
    }

    /**
     * Price one completed Turn from its official usage. `units` is the exact
     * cost scaled by 1e12 (tokens × price-micro-units), so money formatting
     * stays integer-exact.
     */
    function computeTurnCost(tail, priceState, prefs) {
      if (!tail || !tail.tokenUsage) return null
      const usage = tail.tokenUsage
      const routes = Array.isArray(usage.routes)
        ? usage.routes.filter((route) => route && route.provider && route.model)
        : []
      if (routes.length === 0) return { unavailable: 'route', routes: [] }
      if (usage.cacheReadTokens === undefined) return { unavailable: 'cacheRead', routes }
      const models = routes.map((route) => routePriceModel(route, prefs))
      if (models.includes('ignore')) return null
      if (models.some((model) => !model)) return { unavailable: 'unknownModel', routes }
      const unique = Array.from(new Set(models))
      if (unique.length > 1) return { unavailable: 'mixedModel', routes }
      const state = priceState && priceState.ok === true ? priceState : null
      const model =
        state && Array.isArray(state.prices.models)
          ? state.prices.models.find((entry) => entry.id === unique[0])
          : null
      if (!model) return { unavailable: 'prices', routes }
      const period = classifyPeakAt(tail.time, state.holidays && state.holidays.dates)
      if (!period) return { unavailable: 'time', routes }
      const price = model[period.peak ? 'peak' : 'offPeak']
      if (!price) return { unavailable: 'prices', routes }
      const pMiss = Math.round(price.cacheMiss * 1e6)
      const pHit = Math.round(price.cacheHit * 1e6)
      const pOut = Math.round(price.output * 1e6)
      if (![pMiss, pHit, pOut].every((value) => Number.isFinite(value) && value > 0)) {
        return { unavailable: 'prices', routes }
      }
      const uncached = Math.max(0, Math.round(usage.uncachedInputTokens || 0))
      const cacheRead = Math.max(0, Math.round(usage.cacheReadTokens || 0))
      const output = Math.max(0, Math.round(usage.outputTokens || 0))
      const units = uncached * pMiss + cacheRead * pHit + output * pOut
      if (!Number.isSafeInteger(units)) return { unavailable: 'prices', routes }
      return {
        units,
        currency: state.prices.currency,
        modelId: unique[0],
        period: period.period,
        holidayName: period.holidayName,
        routes,
        price: {
          cacheMiss: price.cacheMiss,
          cacheHit: price.cacheHit,
          output: price.output,
        },
        buckets: { uncached, cacheRead, output },
        fetchedAtMs: state.prices.fetchedAtMs,
        stale: Boolean(state.prices.stale),
      }
    }

    /* --------------------------------------------------------------------- */
    /* number format (user selectable)                                       */
    /* --------------------------------------------------------------------- */

    function sanitizeFormat(raw) {
      const value = raw && typeof raw === 'object' ? raw : {}
      const decimals = Number(value.decimals)
      return {
        groupSize: GROUP_SIZES.includes(value.groupSize) ? value.groupSize : FORMAT_DEFAULT.groupSize,
        separator: SEPARATOR_IDS.includes(value.separator) ? value.separator : FORMAT_DEFAULT.separator,
        decimals:
          Number.isInteger(decimals) && decimals >= 1 && decimals <= 8
            ? decimals
            : FORMAT_DEFAULT.decimals,
        tiny: TINY_MODES.includes(value.tiny) ? value.tiny : FORMAT_DEFAULT.tiny,
      }
    }

    function separatorOf(format) {
      const id = format && format.separator
      return Object.prototype.hasOwnProperty.call(SEPARATOR_CHARS, id) ? SEPARATOR_CHARS[id] : ' '
    }

    /** Integer digits group from the decimal point outward (1 234 567). */
    function groupInteger(digits, size, separator) {
      const text = String(digits)
      const width = Number(size)
      if (!separator || !(width > 0) || text.length <= width) return text
      return text.replace(new RegExp(`\\B(?=(\\d{${width}})+(?!\\d))`, 'g'), () => separator)
    }

    /** Fraction digits group from the decimal point inward (0.5827 7672). */
    function groupFraction(digits, size, separator) {
      const text = String(digits)
      const width = Number(size)
      if (!separator || !(width > 0) || text.length <= width) return text
      return text.replace(new RegExp(`(\\d{${width}})(?=\\d)`, 'g'), (match) => match + separator)
    }

    function trimFraction(digits) {
      return String(digits).replace(/0+$/, '')
    }

    function zeroText(format) {
      return `0.${'0'.repeat(format.decimals)}`
    }

    /** Smallest positive amount representable at this precision: 0.001. */
    function lessText(format) {
      return `0.${'0'.repeat(format.decimals - 1)}1`
    }

    /**
     * `units` is cost × 1e12, an exact integer. Rounding to N decimals is an
     * integer division so the result never drifts through a float.
     */
    function splitDigits(units, decimals) {
      const divisor = Math.pow(10, 12 - decimals)
      const rounded = Math.round(units / divisor)
      const digits = String(rounded).padStart(decimals + 1, '0')
      return {
        rounded,
        whole: digits.slice(0, digits.length - decimals),
        fraction: digits.slice(digits.length - decimals),
      }
    }

    /**
     * The chip's number plus a marker the caller turns into `~` or `<`:
     *   { text: '1 234.568', marker: null }
     *   { text: '0.000', marker: 'ellipsis' }  →  ~¥0.000…
     *   { text: '0.001', marker: 'less' }      →  <¥0.001
     */
    function formatChipCost(units, format) {
      const fmt = format || FORMAT_DEFAULT
      if (!Number.isFinite(units) || units <= 0) {
        return { text: zeroText(fmt), marker: null }
      }
      const { rounded, whole, fraction } = splitDigits(units, fmt.decimals)
      if (rounded <= 0) {
        return fmt.tiny === 'less'
          ? { text: lessText(fmt), marker: 'less' }
          : { text: zeroText(fmt), marker: 'ellipsis' }
      }
      const separator = separatorOf(fmt)
      return {
        text: `${groupInteger(whole, fmt.groupSize, separator)}.${groupFraction(
          fraction,
          fmt.groupSize,
          separator,
        )}`,
        marker: null,
      }
    }

    /** Full precision for the tooltip; keeps the chosen grouping, drops trailing zeros. */
    function formatExactCost(units, format) {
      const fmt = format || FORMAT_DEFAULT
      if (!Number.isFinite(units) || units <= 0) return '0'
      const whole = Math.trunc(units / 1e12)
      const fraction = trimFraction(String(units % 1e12).padStart(12, '0'))
      const separator = separatorOf(fmt)
      const grouped = groupInteger(String(whole), fmt.groupSize, separator)
      return fraction ? `${grouped}.${groupFraction(fraction, fmt.groupSize, separator)}` : grouped
    }

    function exactTokens(value) {
      const tokens = Math.max(0, Math.round(value || 0))
      return String(tokens).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    }

    function costReasonText(reason, t) {
      const keys = {
        route: 'costReasonRoute',
        cacheRead: 'costReasonCacheRead',
        unknownModel: 'costReasonUnknownModel',
        mixedModel: 'costReasonMixedModel',
        prices: 'costReasonPrices',
        time: 'costReasonTime',
      }
      return t(keys[reason] || 'costUnavailable')
    }

    function costTooltip(result, t, format) {
      if (!result || result.unavailable) {
        return `${t('costEstimate')}\n${t('costUnavailable')}：${costReasonText(
          result && result.unavailable,
          t,
        )}`
      }
      const symbol = result.currency === 'USD' ? '$' : '¥'
      const period = result.period === 'peak' ? t('costPeak') : t('costOffPeak')
      const exact = (value) => formatExactCost(value, format)
      const lines = [
        `${t('costEstimate')} · ${period}`,
        `~${symbol}${exact(result.units)}`,
        `${t('costModel')} ${result.modelId}（${result.routes.map(routeLabel).join(', ')}）`,
      ]
      const line = (label, tokens, price, lineUnits) =>
        `${label} ${exactTokens(tokens)} × ${symbol}${formatNumber(price)}/${t('costUnit')} = ${symbol}${exact(
          lineUnits,
        )}`
      lines.push(line(t('costUncached'), result.buckets.uncached, result.price.cacheMiss, result.buckets.uncached * Math.round(result.price.cacheMiss * 1e6)))
      lines.push(line(t('costCacheRead'), result.buckets.cacheRead, result.price.cacheHit, result.buckets.cacheRead * Math.round(result.price.cacheHit * 1e6)))
      lines.push(line(t('costOutput'), result.buckets.output, result.price.output, result.buckets.output * Math.round(result.price.output * 1e6)))
      lines.push(
        `${t('costSnapshot')} ${beijingStamp(result.fetchedAtMs)}${result.stale ? ` · ${t('costStale')}` : ''}`,
      )
      return lines.join('\n')
    }

    /**
     * Compact cost line above a completed Turn's footer. It reads the Turn's
     * official usage from the Chat node data source, so nothing extra is
     * fetched or folded; the chip only mounts while its Turn is rendered.
     */
    function CostChip(props) {
      const { t, turn, seq, useChat } = props
      const [prefs] = useCostPrefs()
      const [currency] = useCurrency()
      const fromProp = turn && typeof turn.turn === 'number' ? turn.turn : null
      const fromSeq = useChat((chat) => findByEndSeq(chat.legacy && chat.legacy.turnEnds, seq))
      const turnNumber = fromProp !== null ? fromProp : fromSeq
      const tail = useChat((chat) => {
        if (turnNumber === null || turnNumber === undefined) return null
        if (!chat.nodes || typeof chat.nodes.turnDataSource !== 'function') return null
        const list = chat.nodes.turnDataSource(turnNumber, 'turn-tail').getSnapshot()
        return list.length > 0 ? list[0] : null
      })
      const enabled = Boolean(prefs.enabled && tail && tail.tokenUsage)
      const prices = useSharedPrice(enabled ? currency : null, enabled)
      if (!enabled) return null
      // No reading yet (first mount) shows nothing instead of a flashing "~".
      const priceState = prices && prices.state ? prices.state : null
      if (!priceState && !(prices && prices.error)) return null
      const result = computeTurnCost(tail, priceState, prefs)
      if (!result) return null
      const format = prefs.format
      const full = costTooltip(result, t, format)
      if (result.unavailable) {
        return h(
          'div',
          { className: 'dp-cost' },
          h('span', { className: 'dp-cost-chip', title: full, 'aria-label': full }, '~'),
        )
      }
      const symbol = result.currency === 'USD' ? '$' : '¥'
      const cost = formatChipCost(result.units, format)
      const text =
        cost.marker === 'less'
          ? `<${symbol}${cost.text}`
          : `~${symbol}${cost.text}${cost.marker === 'ellipsis' ? '…' : ''}`
      return h(
        'div',
        { className: 'dp-cost' },
        h('span', { className: 'dp-cost-chip', title: full, 'aria-label': full }, text),
      )
    }

    /* --------------------------------------------------------------------- */
    /* feature switches                                                      */
    /* --------------------------------------------------------------------- */

    const REFRESH_CHOICES = [0, 15, 30, 60, 120, 360, 720]

    /**
     * Mirror of the Host's writable subset. Kept as a pure function so the
     * browser validates before asking the Host to rewrite the profile patch,
     * and so the Node tests can pin the contract.
     */
    function sanitizeConfigPatch(raw) {
      const source = raw && typeof raw === 'object' ? raw : {}
      const patch = {}
      if (typeof source.tool === 'boolean') patch.tool = source.tool
      if (typeof source.holidayRefresh === 'boolean') patch.holidayRefresh = source.holidayRefresh
      if (source.refreshMinutes !== undefined && source.refreshMinutes !== null) {
        const number = Number(source.refreshMinutes)
        if (Number.isFinite(number)) {
          patch.refreshMinutes = Math.min(1440, Math.max(0, Math.round(number)))
        }
      }
      return patch
    }

    /**
     * The plugin detail page hands each section its page subject. Loader builds
     * differ in whether a bundle page carries `pkg.name`, a row page carries
     * `entry.id`, or both, so accept every shape we know and stay silent when
     * none matches: a section that renders nothing is harmless, a section that
     * throws would take the page down.
     */
    function isOwnPluginSubject(subject) {
      if (!subject || typeof subject !== 'object') return false
      const entry = subject.entry || subject.row || null
      const options = (entry && entry.options) || {}
      const ids = [subject.id, subject.patchId, entry && entry.id, options.id]
      if (ids.includes(ROW_ID)) return true
      const bundle = subject.bundle || null
      const pkg = subject.pkg || subject.package || null
      const names = [
        subject.name,
        subject.pkgName,
        pkg && pkg.name,
        bundle && bundle.name,
        entry && entry.name,
        options.name,
      ]
      return names.includes(PKG)
    }

    async function postHostConfig(patch) {
      const response = await fetch(API_CONFIG, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
        cache: 'no-store',
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload || payload.ok !== true) {
        throw new Error((payload && payload.error) || `HTTP ${response.status}`)
      }
      return payload
    }

    /**
     * A Host-side switch is not a checkbox: the Host rewrites the profile patch
     * and DSH reloads this plugin row, so the write is fire-and-read. The row
     * answers 202 immediately and the panel re-reads /state after the reload
     * instead of flipping local state that may never have been persisted.
     */
    function useHostSwitch(onSaved) {
      const [pending, setPending] = useState(false)
      const [error, setError] = useState(null)
      const timers = useRef([])
      const later = (fn, ms) => {
        timers.current.push(setTimeout(fn, ms))
      }
      useEffect(
        () => () => {
          for (const id of timers.current) clearTimeout(id)
          timers.current = []
        },
        [],
      )
      const save = useCallback(
        async (patch) => {
          const clean = sanitizeConfigPatch(patch)
          if (Object.keys(clean).length === 0) return
          setError(null)
          setPending(true)
          try {
            await postHostConfig(clean)
            later(() => {
              setPending(false)
              if (onSaved) onSaved()
            }, 1200)
            later(() => {
              if (onSaved) onSaved()
            }, 3000)
          } catch (failure) {
            setPending(false)
            setError(describeError(failure))
          }
        },
        [onSaved],
      )
      return { pending, error, save }
    }

    function OptionRow(props) {
      const { id, title, hint, checked, disabled, busy, tag, onChange } = props
      return h(
        'label',
        { className: `dp-opt${busy ? ' is-busy' : ''}`, htmlFor: id },
        h('input', {
          id,
          type: 'checkbox',
          checked: checked === true,
          disabled: disabled === true,
          onChange: (event) => onChange(event.target.checked),
        }),
        h(
          'span',
          { className: 'dp-opt-body' },
          h('span', { className: 'dp-opt-title' }, title),
          hint ? h('span', { className: 'dp-opt-hint' }, hint) : null,
        ),
        tag ? h('span', { className: 'dp-opt-tag' }, tag) : null,
      )
    }

    function RefreshRow(props) {
      const { t, value, disabled, onChange } = props
      const choices = REFRESH_CHOICES.includes(value)
        ? REFRESH_CHOICES
        : REFRESH_CHOICES.concat([value]).sort((a, b) => a - b)
      return h(
        'div',
        { className: 'dp-inline' },
        h(
          'span',
          { className: 'dp-inline-text' },
          h('span', { className: 'dp-opt-title' }, t('featRefresh')),
          h('span', { className: 'dp-opt-hint' }, t('featRefreshHint')),
        ),
        h(
          'select',
          {
            className: 'dp-input',
            value: String(value),
            disabled: disabled === true,
            'aria-label': t('featRefresh'),
            onChange: (event) => onChange(Number(event.target.value)),
          },
          choices.map((minutes) =>
            h(
              'option',
              { key: minutes, value: String(minutes) },
              minutes === 0 ? t('manualOnly') : `${minutes} ${t('minutes')}`,
            ),
          ),
        ),
      )
    }

    function FeatureBoard(props) {
      const { t, state } = props
      const [prefs, updatePrefs] = useCostPrefs()
      const config = (state && state.data && state.data.config) || null
      const { pending, error, save } = useHostSwitch(state.reload)
      const busy = !config || pending

      return h(
        'div',
        { className: 'dp-card' },
        h('h3', { className: 'dp-card-title' }, t('featTitle')),
        h('p', { className: 'dp-footnote', style: { margin: '0 0 4px' } }, t('featIntro')),
        h(OptionRow, {
          id: 'dp-opt-cost',
          title: t('featCost'),
          hint: t('featCostHint'),
          tag: t('featLocalTag'),
          checked: prefs.enabled,
          onChange: (checked) => updatePrefs({ ...prefs, enabled: checked }),
        }),
        h(OptionRow, {
          id: 'dp-opt-tool',
          title: t('featTool'),
          hint: t('featToolHint'),
          tag: t('featReloadTag'),
          checked: config && config.tool === true,
          disabled: busy,
          busy: pending,
          onChange: (checked) => save({ tool: checked }),
        }),
        h(OptionRow, {
          id: 'dp-opt-holiday',
          title: t('featHoliday'),
          hint: t('featHolidayHint'),
          tag: t('featReloadTag'),
          checked: config && config.holidayRefresh !== false,
          disabled: busy,
          busy: pending,
          onChange: (checked) => save({ holidayRefresh: checked }),
        }),
        h(RefreshRow, {
          t,
          value: config ? config.refreshMinutes : 0,
          disabled: busy,
          onChange: (minutes) => save({ refreshMinutes: minutes }),
        }),
        pending ? h('p', { className: 'dp-status is-busy' }, t('featSaving')) : null,
        error ? h('p', { className: 'dp-status is-error' }, `${t('featFailed')}${error}`) : null,
      )
    }

    function DetailCardBody(props) {
      const { t } = props
      const [currency] = useCurrency()
      const state = usePricing(currency)
      const [prefs, updatePrefs] = useCostPrefs()
      const config = state.data && state.data.config
      const { pending, error, save } = useHostSwitch(state.reload)
      const busy = !config || pending

      return h(
        'div',
        { className: 'dp-detail' },
        h('h3', { className: 'dp-card-title' }, t('detailTitle')),
        h('p', { className: 'dp-footnote', style: { margin: '0 0 4px' } }, t('detailIntro')),
        h(OptionRow, {
          id: 'dp-detail-cost',
          title: t('featCost'),
          hint: t('costHint'),
          tag: t('featLocalTag'),
          checked: prefs.enabled,
          onChange: (checked) => updatePrefs({ ...prefs, enabled: checked }),
        }),
        h(OptionRow, {
          id: 'dp-detail-tool',
          title: t('featTool'),
          hint: t('featToolHint'),
          tag: t('featReloadTag'),
          checked: config && config.tool === true,
          disabled: busy,
          busy: pending,
          onChange: (checked) => save({ tool: checked }),
        }),
        pending ? h('p', { className: 'dp-status is-busy' }, t('featSaving')) : null,
        error ? h('p', { className: 'dp-status is-error' }, `${t('featFailed')}${error}`) : null,
      )
    }

    /** Hooks stay in the body so an unowned page can return null before them. */
    function PluginDetailCard(props) {
      const { t, subject } = props
      if (!isOwnPluginSubject(subject)) return null
      return h(DetailCardBody, { t })
    }

    /**
     * Uninstall notes live on the plugin page (right where the uninstall control
     * is) rather than in the settings page, and they are phrased as optional:
     * every item below is harmless to leave behind, so nobody should feel that
     * uninstalling requires housekeeping first.
     */
    function UninstallNotes(props) {
      const { t, subject } = props
      if (!isOwnPluginSubject(subject)) return null
      const item = (key, label, action) =>
        h(
          'li',
          { key },
          h('span', { className: 'dp-opt-title' }, label),
          h('span', { className: 'dp-notes-action' }, action),
        )
      return h(
        'div',
        { className: 'dp-detail' },
        h('h3', { className: 'dp-card-title' }, t('uninstallTitle')),
        h('p', { className: 'dp-footnote', style: { margin: '0 0 6px' } }, t('uninstallIntro')),
        h(
          'ul',
          { className: 'dp-notes' },
          item('local', t('uninstallLocal'), t('uninstallLocalAction')),
          item('row', t('uninstallRow'), t('uninstallRowAction')),
          item('pnpm', t('uninstallPnpm'), t('uninstallPnpmAction')),
          item('cache', t('uninstallCache'), t('uninstallCacheAction')),
        ),
      )
    }

    function CostSettingsCard(props) {
      const { t } = props
      const [prefs, updatePrefs] = useCostPrefs()
      const mappings = prefs.mappings
      const rows = mappings.map((row, index) => {
        const detected = row.model === '' ? detectPriceModel(row.route) : null
        const detectedLabel =
          row.model === 'ignore'
            ? t('costIgnore')
            : row.model === 'flash'
              ? 'flash'
              : row.model === 'pro'
                ? 'pro'
                : detected || t('costDetectedNone')
        const updateRow = (patch) => {
          const next = mappings.slice()
          next[index] = { ...row, ...patch }
          updatePrefs({ ...prefs, mappings: next })
        }
        return h(
          'div',
          { key: index, className: 'dp-map-row' },
          h('input', {
            className: 'dp-input',
            value: row.route,
            placeholder: 'provider/model',
            'aria-label': t('costMappingHint'),
            onChange: (event) => updateRow({ route: event.target.value }),
          }),
          h('span', { className: 'dp-muted dp-small' }, detectedLabel),
          h(
            'select',
            {
              className: 'dp-input',
              value: row.model,
              'aria-label': t('costAuto'),
              onChange: (event) => updateRow({ model: event.target.value }),
            },
            h('option', { value: '' }, t('costAuto')),
            h('option', { value: 'flash' }, 'flash'),
            h('option', { value: 'pro' }, 'pro'),
            h('option', { value: 'ignore' }, t('costIgnore')),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dp-btn',
              onClick: () =>
                updatePrefs({ ...prefs, mappings: mappings.filter((_, i) => i !== index) }),
            },
            t('costRemove'),
          ),
        )
      })
      return h(
        'div',
        { className: 'dp-subblock' },
        h('h4', { className: 'dp-subtitle' }, t('costMappingSection')),
        h('p', { className: 'dp-footnote', style: { margin: '0 0 6px' } }, t('costMappingHint')),
        rows,
        h(
          'div',
          { className: 'dp-btn-row', style: { marginTop: 8 } },
          h(
            'button',
            {
              type: 'button',
              className: 'dp-btn',
              onClick: () =>
                updatePrefs({ ...prefs, mappings: [...mappings, { route: '', model: '' }] }),
            },
            t('costAddRow'),
          ),
        ),
      )
    }

    function NumberFormatCard(props) {
      const { t, currency } = props
      const [prefs, updatePrefs] = useCostPrefs()
      const format = prefs.format
      const setFormat = (patch) => updatePrefs({ ...prefs, format: { ...format, ...patch } })
      const symbol = currency === 'USD' ? '$' : '¥'
      const separator = separatorOf(format)
      const grouped = separator !== ''

      const sampleNormal = formatChipCost(1234567890000000, format)
      const sampleTiny = formatChipCost(400000, format)
      const normalText = `~${symbol}${sampleNormal.text}`
      const tinyText =
        sampleTiny.marker === 'less'
          ? `<${symbol}${sampleTiny.text}`
          : `~${symbol}${sampleTiny.text}…`

      const separatorOptions = SEPARATOR_IDS.map((id) =>
        h(
          'option',
          { key: id, value: id },
          `${t(`sep${id.charAt(0).toUpperCase()}${id.slice(1)}`)}（${groupInteger(
            '1234567',
            format.groupSize,
            SEPARATOR_CHARS[id],
          )}）`,
        ),
      )

      const decimalsOptions = []
      for (let value = 1; value <= 8; value += 1) {
        decimalsOptions.push(h('option', { key: value, value: String(value) }, `${value}`))
      }

      const tinyOptions = [
        h('option', { key: 'ellipsis', value: 'ellipsis' }, `~${symbol}${zeroText(format)}…`),
        h('option', { key: 'less', value: 'less' }, `<${symbol}${lessText(format)}`),
      ]

      const groupButtons = [
        [3, t('numberGroup3')],
        [4, t('numberGroup4')],
      ].map(([size, label]) =>
        h(
          'button',
          {
            key: size,
            type: 'button',
            className: format.groupSize === size ? 'is-on' : '',
            'aria-pressed': format.groupSize === size,
            disabled: !grouped,
            onClick: () => setFormat({ groupSize: size }),
          },
          label,
        ),
      )

      return h(
        'div',
        { className: 'dp-subblock' },
        h('h4', { className: 'dp-subtitle' }, t('numberSection')),
        h('p', { className: 'dp-footnote', style: { margin: '0 0 6px' } }, t('numberIntro')),
        h(
          'div',
          { className: 'dp-inline' },
          h(
            'span',
            { className: 'dp-inline-text' },
            h('span', { className: 'dp-opt-title' }, t('numberSeparator')),
          ),
          h(
            'select',
            {
              className: 'dp-input',
              value: format.separator,
              'aria-label': t('numberSeparator'),
              onChange: (event) => setFormat({ separator: event.target.value }),
            },
            separatorOptions,
          ),
        ),
        h(
          'div',
          { className: 'dp-inline' },
          h(
            'span',
            { className: 'dp-inline-text' },
            h('span', { className: 'dp-opt-title' }, t('numberGroup')),
            h('span', { className: 'dp-opt-hint' }, t('numberGroupHint')),
          ),
          h('span', { className: 'dp-seg', role: 'group', 'aria-label': t('numberGroup') }, groupButtons),
        ),
        h(
          'div',
          { className: 'dp-inline' },
          h(
            'span',
            { className: 'dp-inline-text' },
            h('span', { className: 'dp-opt-title' }, t('numberDecimals')),
            h('span', { className: 'dp-opt-hint' }, t('numberDecimalsHint')),
          ),
          h(
            'select',
            {
              className: 'dp-input',
              value: String(format.decimals),
              'aria-label': t('numberDecimals'),
              onChange: (event) => setFormat({ decimals: Number(event.target.value) }),
            },
            decimalsOptions,
          ),
        ),
        h(
          'div',
          { className: 'dp-inline' },
          h(
            'span',
            { className: 'dp-inline-text' },
            h('span', { className: 'dp-opt-title' }, t('numberTiny')),
            h('span', { className: 'dp-opt-hint' }, t('numberTinyHint')),
          ),
          h(
            'select',
            {
              className: 'dp-input',
              value: format.tiny,
              'aria-label': t('numberTiny'),
              onChange: (event) => setFormat({ tiny: event.target.value }),
            },
            tinyOptions,
          ),
        ),
        h(
          'div',
          { className: 'dp-preview' },
          h('span', { className: 'dp-muted' }, `${t('numberPreview')}：`),
          h('span', null, normalText),
          h('span', { className: 'dp-muted' }, '·'),
          h('span', null, tinyText),
        ),
      )
    }

    /**
     * One card, two sub-blocks: the mapping table and the number format share
     * a single home so the cost settings read as one feature, not two.
     */
    function CostEstimateCard(props) {
      const { t, currency } = props
      return h(
        'div',
        { className: 'dp-card' },
        h('h3', { className: 'dp-card-title' }, t('costTitle')),
        h(CostSettingsCard, { t }),
        h(NumberFormatCard, { t, currency }),
        h(
          'div',
          { className: 'dp-btn-row', style: { marginTop: 12 } },
          h(
            'button',
            { type: 'button', className: 'dp-btn', onClick: () => clearLocalSettings() },
            t('costClear'),
          ),
        ),
        h('p', { className: 'dp-footnote', style: { marginTop: 6 } }, t('costLocalOnly')),
      )
    }

    /* --------------------------------------------------------------------- */
    /* rendering pieces                                                      */
    /* --------------------------------------------------------------------- */

    function periodLabel(t, period) {
      return period === 'peak' ? t('peakLabel') : t('offPeakLabel')
    }

    function transitionText(data, now, t) {
      if (!data.nextTransition) return t('noTransition')
      const remaining = data.nextTransition.atMs - now
      const to = data.nextTransition.to === 'peak' ? t('toPeak') : t('toOffPeak')
      return `${t('nextSwitch')} ${beijingClock(data.nextTransition.atMs)} · ${durationText(remaining, t)}${to}`
    }

    function todayText(data, t) {
      if (data.today.holidayName) return `${data.today.holidayName} · ${t('holidayAllDay')}`
      if (!data.today.workday) return t('weekendAllDay')
      return t('todayPeak')
    }

    function priceTable(data, t, compact) {
      const rows = []
      for (const model of data.prices.models) {
        const tiers = [
          ['peak', t('peakTier')],
          ['offPeak', t('offPeakTier')],
        ]
        for (const [key, label] of tiers) {
          const price = model[key]
          const current = (data.period === 'peak') === (key === 'peak')
          rows.push(
            h(
              'tr',
              { key: `${model.id}:${key}`, className: current ? 'is-current' : '' },
              key === 'peak'
                ? h(
                    'td',
                    { rowSpan: 2, className: 'dp-model-cell' },
                    h('div', { className: current ? 'dp-strong' : '' }, model.id),
                    !compact && model.name && model.name !== model.id
                      ? h('div', { className: 'dp-muted dp-model-name' }, model.name)
                      : null,
                  )
                : null,
              h('td', { className: current ? 'dp-strong' : '' }, label),
              h('td', { className: current ? 'dp-strong' : '' }, money(data.prices.currency, price.cacheHit)),
              h('td', { className: current ? 'dp-strong' : '' }, money(data.prices.currency, price.cacheMiss)),
              h('td', { className: current ? 'dp-strong' : '' }, money(data.prices.currency, price.output)),
            ),
          )
        }
      }
      return h(
        'table',
        { className: 'dp-table' },
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            h('th', null, t('model')),
            h('th', null, t('tier')),
            h('th', null, t('cacheHit')),
            h('th', null, t('cacheMiss')),
            h('th', null, t('output')),
          ),
        ),
        h('tbody', null, rows),
      )
    }

    function warningsBlock(data, t) {
      if (!data.warnings || data.warnings.length === 0) return null
      return h(
        'ul',
        { className: 'dp-warn-list' },
        data.warnings.map((warning, index) => h('li', { key: index }, warning)),
      )
    }

    function sourceLink(source) {
      if (!isHttpUrl(source)) return h('span', { className: 'dp-muted' }, source || '—')
      return h(
        'a',
        { className: 'dp-link', href: source, target: '_blank', rel: 'noreferrer' },
        source,
      )
    }

    function errorBanner(error, loading, onRetry, t) {
      if (!error) return null
      return h(
        'div',
        { className: 'dp-banner is-error' },
        h('span', null, `${t('errorPrefix')}${error}`),
        h(
          'button',
          { type: 'button', className: 'dp-btn', onClick: () => onRetry(), disabled: loading },
          loading ? t('refreshing') : t('retry'),
        ),
      )
    }

    function loadingLine(t) {
      return h('div', { className: 'dp-loading' }, t('loading'))
    }

    /* --------------------------------------------------------------------- */
    /* composer chip + popover                                               */
    /* --------------------------------------------------------------------- */

    function PricingChip(props) {
      const { t } = props
      const [currency] = useCurrency()
      const state = usePricing(currency)
      const [open, setOpen] = useState(false)
      const [pos, setPos] = useState(null)
      const buttonRef = useRef(null)
      const panelRef = useRef(null)
      const offsetRef = useRef({ x: 0, y: 0 })
      const correctionsRef = useRef(0)
      const tick = useTick()
      const now = tick + (state.skew || 0)

      const data = state.data
      const period = data ? data.period : null
      const remaining = data && data.nextTransition ? data.nextTransition.atMs - now : null
      const hasRemaining = Number.isFinite(remaining) && remaining > 0

      const label = data
        ? periodLabel(t, period)
        : state.error
          ? t('unavailable')
          : t('loading')

      const tooltip = data
        ? `${t('nowBeijing')} ${beijingClock(now)} ${weekdayLabel(t, data.beijing.isoWeekday)} · ${periodLabel(
            t,
            period,
          )}${hasRemaining ? ` · ${durationText(remaining, t)}${period === 'peak' ? t('toOffPeak') : t('toPeak')}` : ''}`
        : label

      /** Viewport coordinates converted into the panel's containing block. */
      const place = useCallback(() => {
        const node = buttonRef.current
        if (!node) return
        const box = node.getBoundingClientRect()
        const width = 320
        const left = Math.max(8, Math.min(box.left, window.innerWidth - width - 8))
        const bottom = Math.max(8, window.innerHeight - box.top + 8)
        const next = { left: left - offsetRef.current.x, bottom: bottom + offsetRef.current.y }
        setPos((prev) =>
          prev &&
          Math.abs(prev.left - next.left) < 0.5 &&
          Math.abs(prev.bottom - next.bottom) < 0.5
            ? prev
            : next,
        )
      }, [])

      const openPanel = useCallback(() => {
        correctionsRef.current = 0
        place()
        setOpen(true)
      }, [place])

      useEffect(() => {
        if (!open) {
          setPos(null)
          offsetRef.current = { x: 0, y: 0 }
          return undefined
        }
        place()
        const onResize = () => place()
        window.addEventListener('resize', onResize)
        window.addEventListener('scroll', onResize, true)
        // The composer reflows when its neighbours mount, so follow the button
        // while the panel is open; place() bails out when nothing moved.
        const poll = setInterval(() => place(), 250)
        return () => {
          clearInterval(poll)
          window.removeEventListener('resize', onResize)
          window.removeEventListener('scroll', onResize, true)
        }
      }, [open, place])

      // `position: fixed` resolves against the nearest transformed/contained
      // ancestor, so the style computed from a viewport rect can land the panel
      // away from the button. Measure that containing block once per open and
      // fold the delta into the coordinates.
      useEffect(() => {
        if (!open || !pos) return
        const panel = panelRef.current
        if (!panel) return
        if (correctionsRef.current >= 3) return
        const rect = panel.getBoundingClientRect()
        const parentLeft = rect.left - pos.left
        const parentBottom = rect.bottom + pos.bottom
        const next = { x: parentLeft, y: parentBottom - window.innerHeight }
        if (
          Math.abs(next.x - offsetRef.current.x) > 0.5 ||
          Math.abs(next.y - offsetRef.current.y) > 0.5
        ) {
          offsetRef.current = next
          correctionsRef.current += 1
          place()
        }
      }, [open, pos, place])

      useEffect(() => {
        if (!open) return undefined
        const onPointerDown = (event) => {
          const target = event.target
          if (panelRef.current && panelRef.current.contains(target)) return
          if (buttonRef.current && buttonRef.current.contains(target)) return
          setOpen(false)
        }
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return
          setOpen(false)
          if (buttonRef.current) buttonRef.current.focus()
        }
        document.addEventListener('mousedown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown)
        return () => {
          document.removeEventListener('mousedown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown)
        }
      }, [open])

      useEffect(() => {
        if (open && panelRef.current) panelRef.current.focus()
      }, [open])

      // Re-fetch exactly once when the countdown crosses the announced switch.
      const handledTransition = useRef(null)
      useEffect(() => {
        if (!data || !data.nextTransition) return
        const atMs = data.nextTransition.atMs
        if (now >= atMs && handledTransition.current !== atMs) {
          handledTransition.current = atMs
          state.reload()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [now, data, state.reload])

      // Re-fetch when the Beijing date rolls over, so a still-open chip cannot
      // keep yesterday's holiday/window answer.
      const handledDate = useRef(null)
      useEffect(() => {
        if (!data) return
        const key = beijingDateKey(now)
        if (key && key !== data.beijing.dateKey && handledDate.current !== key) {
          handledDate.current = key
          state.reload()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [now, data, state.reload])

      const chipClass = [
        'dp-chip',
        period === 'peak' ? 'is-peak' : period === 'off-peak' ? 'is-off' : '',
        open ? 'is-open' : '',
      ]
        .filter(Boolean)
        .join(' ')

      const button = h(
        'button',
        {
          ref: buttonRef,
          type: 'button',
          className: chipClass,
          title: tooltip,
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          'aria-label': tooltip,
          onClick: () => (open ? setOpen(false) : openPanel()),
          onKeyDown: (event) => {
            if (event.key !== 'ArrowDown') return
            event.preventDefault()
            if (!open) openPanel()
          },
        },
        h('span', { className: 'dp-dot', 'aria-hidden': 'true' }),
        h('span', { className: 'dp-chip-label' }, label),
        hasRemaining ? h('span', { className: 'dp-chip-sub' }, shortDuration(remaining)) : null,
      )

      if (!open) return h('div', { className: 'dp-root' }, button)

      const panelStyle = {
        position: 'fixed',
        width: 320,
        zIndex: 60,
        left: pos ? pos.left : 8,
        bottom: pos ? pos.bottom : 8,
      }

      const price = data
        ? h(
            'div',
            null,
            h('div', { className: 'dp-pop-head' }, h('span', { className: 'dp-muted dp-small' }, t('priceTitle'))),
            priceTable(data, t, true),
          )
        : null

      const panel = h(
        'div',
        {
          ref: panelRef,
          className: 'dp-popover',
          role: 'dialog',
          'aria-modal': 'false',
          'aria-label': t('panelTitle'),
          tabIndex: -1,
          style: panelStyle,
        },
        data
          ? h(
              'div',
              null,
              h(
                'div',
                { className: 'dp-pop-head' },
                h(
                  'span',
                  { className: `dp-pop-status ${period === 'peak' ? 'is-peak' : 'is-off'}` },
                  h('span', { className: 'dp-dot', 'aria-hidden': 'true' }),
                  periodLabel(t, period),
                ),
                h('span', { className: 'dp-muted dp-small' }, `${t('nowBeijing')} ${beijingClock(now)}`),
              ),
              h('div', { className: 'dp-small' }, transitionText(data, now, t)),
              h('div', { className: 'dp-muted dp-small' }, todayText(data, t)),
              h('div', { style: { margin: '8px 0 6px' } }, price),
              data.prices.stale
                ? h('div', { className: 'dp-small dp-muted' }, `${t('stale')} · ${t('updated')} ${beijingClock(data.prices.fetchedAtMs)}`)
                : null,
              h(
                'div',
                { className: 'dp-pop-foot' },
                h(
                  'span',
                  { className: 'dp-muted dp-small' },
                  data.prices.fetchedAtMs
                    ? `${t('updated')} ${beijingClock(data.prices.fetchedAtMs)}`
                    : '—',
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dp-btn',
                    disabled: state.loading,
                    onClick: () => state.reload({ force: true }),
                  },
                  state.loading ? t('refreshing') : t('refresh'),
                ),
              ),
              warningsBlock(data, t),
            )
          : h(
              'div',
              null,
              h(
                'div',
                { className: 'dp-loading' },
                state.error ? `${t('errorPrefix')}${state.error}` : t('loading'),
              ),
              state.error
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'dp-btn',
                      disabled: state.loading,
                      onClick: () => state.reload(),
                    },
                    t('retry'),
                  )
                : null,
            ),
      )

      return h('div', { className: 'dp-root' }, button, panel)
    }

    /* --------------------------------------------------------------------- */
    /* settings page                                                         */
    /* --------------------------------------------------------------------- */

    function PricingSection(props) {
      const { t } = props
      const [currency, setCurrency] = useCurrency()
      const state = usePricing(currency)
      const tick = useTick()
      const now = tick + (state.skew || 0)
      const data = state.data
      const activeCurrency = currency || (data && data.prices.currency) || 'CNY'

      const hero = data
        ? h(
            'div',
            { className: `dp-hero ${data.period === 'peak' ? 'is-peak' : 'is-off'}` },
            h(
              'span',
              { className: 'dp-hero-status' },
              h('span', { className: 'dp-dot', 'aria-hidden': 'true' }),
              periodLabel(t, data.period),
            ),
            h(
              'span',
              { className: 'dp-muted' },
              `${t('nowBeijing')} ${beijingClock(now)} ${weekdayLabel(t, data.beijing.isoWeekday)}`,
            ),
            h('span', { className: 'dp-muted' }, transitionText(data, now, t)),
          )
        : null

      const scheduleCard = h(
        'div',
        { className: 'dp-card' },
        h('h3', { className: 'dp-card-title' }, t('scheduleTitle')),
        h('p', { className: 'dp-small', style: { margin: '0 0 8px' } }, t('scheduleBody')),
        h(
          'div',
          { className: 'dp-schedule-row' },
          h('span', { className: 'dp-muted dp-small', style: { width: 48 } }, t('weekday1')),
          h('span', { className: 'dp-schedule-bar', style: { width: 40, marginLeft: 0 } }),
          h('span', { className: 'dp-muted dp-small' }, '09:00–12:00'),
          h('span', { className: 'dp-schedule-bar', style: { width: 40, marginLeft: 8 } }),
          h('span', { className: 'dp-muted dp-small' }, '14:00–18:00'),
        ),
        h('p', { className: 'dp-footnote', style: { marginTop: 6 } }, t('localHint')),
      )

      const priceCard = h(
        'div',
        { className: 'dp-card' },
        h(
          'h3',
          { className: 'dp-card-title' },
          h('span', null, t('priceTitle')),
          h(
            'span',
            { className: 'dp-seg', role: 'group', 'aria-label': t('priceTitle') },
            h(
              'button',
              {
                type: 'button',
                className: activeCurrency === 'CNY' ? 'is-on' : '',
                'aria-pressed': activeCurrency === 'CNY',
                onClick: () => setCurrency('CNY'),
              },
              '¥ CNY',
            ),
            h(
              'button',
              {
                type: 'button',
                className: activeCurrency === 'USD' ? 'is-on' : '',
                'aria-pressed': activeCurrency === 'USD',
                onClick: () => setCurrency('USD'),
              },
              '$ USD',
            ),
          ),
        ),
        data
          ? h(
              'div',
              null,
              priceTable(data, t, false),
              h(
                'p',
                { className: 'dp-footnote', style: { marginTop: 6 } },
                `${t('priceHint')} · ${activeCurrency === 'USD' ? t('unitPerMillionUsd') : t('unitPerMillion')}`,
              ),
              data.prices.searchFetch != null
                ? h(
                    'p',
                    { className: 'dp-footnote', style: { marginTop: 4 } },
                    `${t('searchFetch')}：${money(data.prices.currency, data.prices.searchFetch)} / ${t('perThousand')}`,
                  )
                : null,
            )
          : loadingLine(t),
      )

      const holidayChips = data
        ? h(
            'div',
            { className: 'dp-chips' },
            data.holidays.years.map((entry) => {
              const statusText =
                entry.status === 'fresh'
                  ? t('holidaysSynced')
                  : entry.status === 'stale'
                    ? t('holidaysStale')
                    : entry.status === 'cached'
                      ? t('holidaysCached')
                      : entry.status === 'snapshot'
                        ? t('holidaysSnapshot')
                        : entry.status === 'pending'
                          ? t('holidaysPending')
                          : entry.status === 'unpublished'
                            ? t('holidaysUnpublished')
                            : t('holidaysFailed')
              const tone = entry.status === 'fresh' ? 'is-fresh' : 'is-warn'
              const details = [`${entry.year} ${statusText}`]
              if (entry.source) details.push(entry.source)
              if (entry.updatedAtMs) details.push(`${t('updated')} ${beijingClock(entry.updatedAtMs)}`)
              if (entry.error) details.push(entry.error)
              return h(
                'span',
                { key: entry.year, className: `dp-year ${tone}`, title: details.join(' · ') },
                h('span', null, `${entry.year}`),
                h('span', { className: 'dp-year-status' }, statusText),
              )
            }),
          )
        : null

      const dataCard = h(
        'div',
        { className: 'dp-card' },
        h('h3', { className: 'dp-card-title' }, t('dataTitle')),
        h(
          'dl',
          { className: 'dp-kv' },
          h('dt', null, t('updated')),
          h(
            'dd',
            null,
            data && data.prices.fetchedAtMs
              ? `${beijingClock(data.prices.fetchedAtMs)}${data.prices.stale ? ` · ${t('stale')}` : ''}`
              : '—',
          ),
          h('dt', null, t('source')),
          h('dd', null, data ? sourceLink(data.prices.source) : '—'),
          h(
            'dt',
            null,
            t('autoRefresh'),
          ),
          h(
            'dd',
            null,
            data && data.config.refreshMinutes > 0
              ? `${data.config.refreshMinutes} ${t('minutes')}`
              : t('manualOnly'),
          ),
          h('dt', null, t('holidayTitle')),
          h('dd', null, holidayChips),
        ),
        h(
          'div',
          { className: 'dp-btn-row', style: { marginTop: 10 } },
          h(
            'button',
            {
              type: 'button',
              className: 'dp-btn',
              disabled: state.loading,
              onClick: () => state.reload({ force: true }),
            },
            state.loading ? t('refreshing') : t('refresh'),
          ),
          data && data.prices.error
            ? h('span', { className: 'dp-muted dp-small' }, data.prices.error)
            : null,
        ),
        data ? warningsBlock(data, t) : null,
      )

      return h(
        'section',
        { className: 'dp-section', 'aria-label': t('section') },
        h('h2', { className: 'dp-h2' }, t('section')),
        h('p', { className: 'dp-intro' }, t('settingsIntro')),
        errorBanner(state.error, state.loading, () => state.reload({ force: true }), t),
        hero,
        scheduleCard,
        priceCard,
        h(FeatureBoard, { t, state }),
        h(CostEstimateCard, { t, currency: activeCurrency }),
        dataCard,
        h('p', { className: 'dp-footnote' }, t('footnote')),
      )
    }

    /* --------------------------------------------------------------------- */
    /* plugin entry                                                          */
    /* --------------------------------------------------------------------- */

    const inject = ['slots', 'locale']

    function apply(ctx) {
      ctx.effect(
        () => ctx.locale.register(NS, { zh: ZH, en: EN }),
        'deepseek-pricing: dictionaries',
      )
      const t = ctx.locale.bind(NS)

      ctx.effect(() => {
        const style = document.createElement('style')
        style.setAttribute('data-dsh-plugin', NS)
        style.textContent = CSS
        document.head.appendChild(style)
        return () => {
          if (style.parentNode) style.parentNode.removeChild(style)
        }
      }, 'deepseek-pricing: styles')

      ctx.effect(
        () =>
          ctx.slots.inject('conversation.input.left', () =>
            ctx.slots.register(
              {
                name: 'conversation.input.left',
                id: 'deepseek-pricing',
                order: 10,
                label: () => t('panelTitle'),
              },
              (props) => h(PricingChip, { ...props, t }),
            ),
          ),
        'deepseek-pricing: composer chip',
      )

      ctx.effect(
        () =>
          ctx.slots.inject('conversation.chat.turnTail', () =>
            ctx.slots.register(
              {
                name: 'conversation.chat.turnTail',
                id: 'deepseek-pricing-cost',
                order: 90,
              },
              (props) => h(CostChip, { ...props, t }),
            ),
          ),
        'deepseek-pricing: turn cost',
      )

      ctx.effect(
        () =>
          ctx.slots.inject('settings.section', () =>
            ctx.slots.register(
              {
                name: 'settings.section',
                id: 'deepseek-pricing',
                order: 55,
                label: () => t('section'),
                locale: NS,
              },
              (props) => h(PricingSection, { ...props, t }),
            ),
          ),
        'deepseek-pricing: settings section',
      )

      // The plugin's own page under Settings → Plugins: the same switches the
      // dedicated page owns, minus the ones that need room. The slot exists on
      // both a bundle page and a row page; the card renders null for every
      // subject that is not this plugin.
      ctx.effect(
        () =>
          ctx.slots.inject('plugins.detail.section', () =>
            ctx.slots.register(
              {
                name: 'plugins.detail.section',
                id: 'deepseek-pricing-switches',
                order: 80,
                locale: NS,
              },
              (props) => h(PluginDetailCard, { ...props, t }),
            ),
          ),
        'deepseek-pricing: plugin page switches',
      )

      ctx.effect(
        () =>
          ctx.slots.inject('plugins.detail.section', () =>
            ctx.slots.register(
              {
                name: 'plugins.detail.section',
                id: 'deepseek-pricing-uninstall',
                order: 90,
                locale: NS,
              },
              (props) => h(UninstallNotes, { ...props, t }),
            ),
          ),
        'deepseek-pricing: uninstall notes',
      )
    }

    return {
      inject,
      apply,
      // Pure cost helpers, used by the Node tests; the loader ignores extras.
      __test: {
        detectPriceModel,
        classifyPeakAt,
        computeTurnCost,
        formatChipCost,
        formatExactCost,
        groupInteger,
        groupFraction,
        sanitizeFormat,
        sanitizeCostPrefs,
        sanitizeConfigPatch,
        isOwnPluginSubject,
        FORMAT_DEFAULT,
        SEPARATOR_CHARS,
      },
    }
  },
})
