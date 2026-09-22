// dsh-card-updater browser half: the settings section and the sidebar-foot entry.
window.__ModuleLoader__.load({
  id: 'dsh-card-updater',
  factory: (require) => {
    const react = require('react')
    const h = react.createElement
    const { useState, useEffect, useCallback, Fragment } = react

    const NS = 'settings.dsh-card-updater'
    let translate = (key) => key
    const t = (key) => {
      try {
        return translate(key)
      } catch {
        return key
      }
    }

    const zh = {
      nav: '卡片更新器',
      'entry.title': '卡片更新器',
      'panel.title': '卡片更新器',
      'panel.desc': '通过链接比对远端人物卡，更新原版卡，并把变更同步进 MVU 版卡。',
      'tab.cards': '卡片',
      'tab.settings': '合并设置',
      'strategy.now': '当前策略：{name}',
      'btn.checkUpdate': '检测更新',
      'btn.checkAll': '检测全部',
      'btn.check': '检测',
      'btn.merge': '合并到 MVU',
      'btn.updateMerge': '更新并合并',
      'btn.updateAll': '更新全部原版',
      'btn.save': '保存',
      'btn.rescan': '重新扫描卡片目录',
      'btn.add': '新增条目',
      'btn.remove': '删除',
      'btn.backups': '备份与还原',
      'btn.pickFile': '选择',
      'btn.manualBackup': '手动备份',
      'btn.restorePanel': '还原',
      'backup.auto': '备份在每次写入前自动生成，超过 40 份自动清理',
      'ok.manualBackup': '已手动备份全部卡片',
      'btn.close': '关闭',
      'btn.reload': '重新载入',
      'btn.reload.hint': '重新读取后台状态；未保存的改动会被丢弃',
      'btn.rollback': '恢复到此备份',
      'btn.autoCheck': '自动检测',
      'strategy.title': '合并策略',
      'strategy.desc': '只同步原版卡的内容字段；MVU 版的状态栏、变量脚本与正则始终保留。',
      'strategy.minimal': '内容字段',
      'strategy.minimal.d': '名称、描述、人格、场景、开场白、示例对话等正文字段。',
      'strategy.standard': '内容字段 + 世界书',
      'strategy.standard.d': '再按条目合并内嵌世界书：原版新增条目写入，内容一致按原版更新，本地改过的条目保留并报告。',
      'strategy.full': '内容字段 + 世界书 + 原版脚本',
      'strategy.full.d': '再把只在原版存在的正则脚本补进 MVU 版；同名脚本原样保留。',
      'strategy.detail': '详细',
      'strategy.more': '收起',
      'strategy.minimal.long': '范围：name / description / personality / scenario / first_mes / mes_example / system_prompt / post_history_instructions / creator_notes / creator / tags / alternate_greetings 共 12 个正文字段。\n动作：逐字段比对原版卡与 MVU 版，不同就采用原版的值；世界书（character_book）与正则脚本（regex_scripts）一律不动。\n适用：作者只改了人设设定、场景描述或新增开场白（alternate_greetings）。\n结果：合并记录会逐项列出被改写的字段名，例如「name、first_mes、alternate_greetings」。',
      'strategy.standard.long': '范围：第一档全部字段，外加内嵌世界书 character_book。\n动作：按条目合并而非整本替换 —— ①原版有、MVU 版没有的条目直接写入；②两边都有且内容与关键词一致则跳过；③MVU 版该条目内容为空则用原版补上；④两边都有但内容不同则保留 MVU 版，并计入「保留 N」报告。\n适用：日常跟随作者更新世界观词条，同时不改动你本地调整过的条目。\n结果：合并记录显示「character_book(+新增 / ~更新 / 保留N)」，被保留的条目名会列在备份弹窗与条目提示里。',
      'strategy.full.long': '范围：第一、二档的全部内容，外加正则脚本 regex_scripts。\n动作：按 scriptName 去重 —— 只把「仅存在于原版」的脚本追加到 MVU 版；MVU 版已有的同名脚本原样保留，不会被覆盖。\n风险：原版脚本常含旧式状态栏或变量渲染规则，与 MVU 版的状态栏脚本可能相互干扰，导致状态栏显示异常。\n适用：作者发布了你确实需要、且 MVU 版没有的新正则功能时临时选用，合并完成后建议切回「内容字段 + 世界书」。\n结果：合并记录显示「regex_scripts(+N)」，可与 MVU 版原有脚本数量核对。',
      'strategy.advice': '选择建议：日常跟随作者更新用「内容字段 + 世界书」；只改了人设文案、不想动世界书时用「内容字段」；作者新增了你需要的正则功能时临时切到第三档，合并后切回第二档。',
      'flag.syncPlain': '合并结果写回原版卡',
      'flag.syncPlain.d': '让原版卡也带上 MVU 状态栏，新档可直接用原版卡开。',
      'flag.autoBump': '自动递增 character_version',
      'flag.autoBump.d': '例如 V4.3.3 → V4.3.4；已是 MVU 版本号则追加 -mvu-N。',
      'label.file': '原版卡',
      'label.mvu': 'MVU 版',
      'label.url': '来源链接',
      'label.primary': '主要链接',
      'label.match': '版本关键词',
      'index.title': '索引站授权',
      'index.desc': '社区索引站的作品贴子需要登录才能读取。填一次令牌，插件就能检索你关注的贴子有无新版。',
      'index.placeholder': '粘贴 auth_token',
      'index.verify': '验证',
      'index.checking': '验证中…',
      'index.ok': '令牌有效，可以检索贴子',
      'index.bad': '令牌无效或已过期',
      'index.validUntil': '令牌有效，可以检索贴子（{at} 过期）',
      'index.expired': '令牌已于 {at} 过期；去索引站重新登录可拿新的',
      'index.expiring': '令牌将于 {at} 过期，建议现在退出登录重新取一次',
      'index.renew': '重新获取令牌',
      'index.howto':
        '获取方式：在索引站页面按 F12 打开控制台，执行 localStorage.getItem("auth_token")，把返回值（不含引号）粘贴到这里。令牌只保存在本机配置里，仅用于请求 forum.shimmerday.top。索引站的令牌有效期约 7 天，过期后重新登录一次再取就行。',
      'primary.changed': '贴子有变化',
      'primary.feed': '动态提到',
      'primary.discordNeedToken': '这是 Discord 贴子链接，请在「合并设置」里填入索引站令牌',
      'primary.title': '来源检索',
      'primary.newer': '作者已发布新版',
      'primary.newerUnstated': '作者发布了新更新，贴子没写版本号',
      'primary.postedAt': '贴子更新于 {at}',
      'primary.renamed': '作者改过贴子名，链接仍是同一个（现在叫 {to}）',
      'primary.current': '未发现比本地更新的版本',
      'primary.gated': '有下载条件',
      'primary.error': '检索失败',
      'primary.notset': '未配置主要链接',
      'btn.open': '打开',
      'btn.gotoThread': '跳转到原贴',
      'btn.gotoSearch': '点击访问搜索站',
      'primary.tunHint':
        '若浏览器能打开 Discord 而这里不通，请把代理切换到 TUN 模式（插件运行在 Node 进程里，不读取系统代理设置）',
      'index.netHint':
        '检索提示：若报「无法访问该网址」，先确认能否正常打开 Discord。浏览器可以访问而这里不行，通常是代理未开 TUN 模式。',
      'primary.discovered': '已自动匹配原贴',
      'primary.emptyHint': '链接没填上？点击访问搜索站手动填入',
      'gate.password': '密码',
      'gate.role': '权限',
      'gate.reply': '回复可见',
      'gate.paid': '付费 / 赞助',
      'gate.discord': 'Discord 社区',
      'label.baseline': '基线',
      'btn.importNew': '导入新版',
      'note.noMvu': '未找到同名 MVU 版，可手动填写',
      'note.confirmPair': '按名称前缀推测配对，请确认',
      'note.soloMvu': '独立 MVU 卡（未配对原版，本工具只读不写）',
      'label.imported': '已导入新版卡',
      'label.updated': '更新',
      'label.merged': '合并',
      'state.dirty': '有更新',
      'state.clean': '已最新',
      'state.unknown': '未检测',
      'state.unlinked': '未配置链接',
      'state.error': '检测异常',
      'state.baseline': '待注册基线',
      'state.busy': '执行中…',
      'state.off': '已停用',
      'empty': '暂无条目；点「重新扫描卡片目录」按文件名自动配对。',
      'log.title': '最近操作',
      'backup.title': '备份',
      'backup.none': '暂无备份',
      'ok.saved': '配置已保存',
      'ok.check': '检测完成',
      'ok.removed': '已删除条目',
      'ok.imported': '已导入新版卡',
      'ok.debugHint': '为确保卡功能与内容完善，建议调试一遍',
      'debug.plain': '原卡',
      'debug.mvu': 'MVU 版',
      'debug.done': '{who}已调试',
      'debug.todo': '{who}未调试 · 点击前去调试',
      'debug.noPlay': '这张卡还没有游玩对话，先开一局才能调试',
      'debug.opened': '已打开卡片 Agent 调试对话',
      'debug.failed': '打开调试失败',
      'debug.noReply': '卡片工作台没有响应，请确认 Tavern 的对话界面已打开',
      'debug.busy': '{who}正在调试中',
      'debug.changed': '{who}调试有改动，尚未查看',
      'debug.stale': '{who}已变动，未调试',
      'debug.locked': '有角色卡正在调试中，请等待调试结束再操作',
      'tools.search': '搜索卡名、关键词或路径…',
      'tools.all': '全部',
      'tools.plainOnly': '只有原卡',
      'tools.mvuOnly': '只有 MVU 版',
      'tools.sortAuto': '默认：有更新优先',
      'tools.sortImported': '按导入时间',
      'tools.sortName': '按名称',
      'tools.empty': '没有符合筛选条件的卡片',
      'tools.count': '{shown} / {total}',
      'tavern.missing.title': '需要先安装 DSH Tavern',
      'tavern.missing.desc':
        '本插件是基于 DSH Tavern 的功能插件，请先安装 DSH Tavern。人物卡、卡片工作台与游玩数据都由它提供，这个插件只负责比对远端更新、更新原版卡并合并进 MVU 版。',
      'tavern.missing.open': '打开 DSH Tavern 仓库',
      'ok.merge': '合并完成',
      'ok.updateMerge': '更新并合并完成',
      'ok.restore': '已从备份恢复',
      'hint.interval': '自动检测间隔（分钟，0 = 关闭）：由后台执行，无需保持面板打开',
      'err.bridge': '无法连接后台：卡片更新器插件可能未加载完成，稍后重试。',
      'pick.title': '选择卡片文件',
      'pick.up': '上一层',
      'pick.explorer': '打开资源管理器',
      'pick.use': '用这个路径',
      'pick.dir': '目录',
      'pick.file': '文件',
      'pick.empty': '该目录下没有 JSON 文件',
      'pick.choose': '选择此文件',
      'err.list': '读取目录失败',
      'restore.title': '还原到某个备份',
      'restore.count': '共 {n} 份备份 · 合计 {size} · 每个文件保留最近 5 份',
      'restore.keep': '自动保留',
      'restore.prune': '按上限清理',
      'restore.group': '{n} 个备份 · {size}',
      'restore.empty': '暂无备份',
      'restore.prune.done': '已清理 {n} 份超出上限的备份',
      'restore.deleted': '已删除 {name}',
      'restore.restored': '已恢复 {name}',
      'ok.done': '已完成',
      'restore.dir': '目录',
      'tag.manual': '手动备份',
      'tag.mvu': 'MVU 版',
      'tag.plain': '原版卡',
      'tag.plain-before-merge': '合并前的原版卡',
      'tag.before-restore': '还原前快照',
      'tag.before-rollback': '回滚前快照',
      // The panel's own update check: it watches the plugin repository, not a
      // card, so it keeps its own little vocabulary.
      'upd.checking': '检测中…',
      'upd.latest': '已是最新版',
      'upd.available': '发现新版 {v}',
      'upd.failed': '检测失败',
      'upd.nodata': '暂无发布版本',
      'upd.tip.idle': '检测 GitHub 上是否发布了新版本',
      'upd.tip.latest': '当前 {current}，已是最新版',
      'upd.tip.available': '当前 {current}，GitHub 上最新 {latest}；点击前往更新',
      'upd.tip.failed': '检测失败：{error}',
      'upd.tip.nodata': '仓库还没有发布版本标签，无法比对；点击前往 GitHub',
      'upd.version': '当前安装版本 {v}',
    }
    const en = {
      nav: 'Card Updater',
      'entry.title': 'Card Updater',
      'panel.title': 'Card Updater',
      'panel.desc': 'Diff remote cards by link, refresh the original, and sync changes into the MVU card.',
      'tab.cards': 'Cards',
      'tab.settings': 'Settings',
      'strategy.now': 'Strategy: {name}',
      'btn.checkUpdate': 'Check update',
      'btn.checkAll': 'Check all',
      'btn.check': 'Check',
      'btn.merge': 'Merge into MVU',
      'btn.updateMerge': 'Update & merge',
      'btn.updateAll': 'Update originals',
      'btn.save': 'Save',
      'btn.rescan': 'Rescan card dir',
      'btn.add': 'Add entry',
      'btn.remove': 'Remove',
      'btn.backups': 'Backups',
      'btn.pickFile': 'Pick',
      'btn.manualBackup': 'Backup now',
      'btn.restorePanel': 'Restore',
      'backup.auto': 'A snapshot is taken before every write; older ones beyond 40 are pruned',
      'ok.manualBackup': 'All cards backed up manually',
      'btn.close': 'Close',
      'btn.reload': 'Reload',
      'btn.reload.hint': 'Re-read the host state; unsaved edits are dropped',
      'btn.rollback': 'Restore this backup',
      'btn.autoCheck': 'Auto check',
      'strategy.title': 'Merge strategy',
      'strategy.desc': 'Only content fields are synced; the MVU status bar, scripts and regex stay untouched.',
      'strategy.minimal': 'Content fields',
      'strategy.minimal.d': 'name / description / personality / scenario / first_mes / mes_example and friends.',
      'strategy.standard': 'Fields + world book',
      'strategy.standard.d': 'Also merge the embedded character_book by entry.',
      'strategy.full': 'Fields + book + original regex',
      'strategy.full.d': 'Also copy regex scripts that exist only in the original.',
      'strategy.detail': 'Details',
      'strategy.more': 'Less',
      'strategy.minimal.long': 'Scope: the 12 body fields — name / description / personality / scenario / first_mes / mes_example / system_prompt / post_history_instructions / creator_notes / creator / tags / alternate_greetings.\nAction: compare each field; differing ones take the original value. The world book and regex scripts are never touched.\nUse when: the author only edited prose, scenario or added greetings.\nResult: the merge log lists every rewritten field name.',
      'strategy.standard.long': 'Scope: everything above plus the embedded world book (character_book).\nAction: merge by entry, not by replacing the book — ① entries only in the original are added; ② entries identical on both sides are skipped; ③ entries empty on the MVU side take the original; ④ entries that differ keep the MVU version and are reported.\nUse when: following the author normal updates without losing local edits.\nResult: the merge log shows character_book(+added / ~updated / kept N).',
      'strategy.full.long': 'Scope: everything above plus regex_scripts.\nAction: de-duplicate by scriptName — only scripts that exist solely in the original are appended; same-named scripts in the MVU card win.\nRisk: original scripts often carry legacy status-bar or variable rendering rules that can fight the MVU status bar.\nUse when: the author shipped a new regex feature you actually need; switch back to the middle option afterwards.\nResult: the merge log shows regex_scripts(+N).',
      'strategy.advice': 'Suggestion: keep "Fields + world book" for everyday updates; use "Content fields" when you do not want the world book touched; switch to the third option only for a needed new regex feature, then return to the middle one.',
      'flag.syncPlain': 'Write merge result back to the original',
      'flag.syncPlain.d': 'Keeps the original card MVU-capable for new save files.',
      'flag.autoBump': 'Auto bump character_version',
      'flag.autoBump.d': 'e.g. V4.3.3 -> V4.3.4; MVU strings gain -mvu-N.',
      'label.file': 'Original',
      'label.mvu': 'MVU',
      'label.url': 'Source link',
      'label.primary': 'Release link',
      'label.match': 'Version marker',
      'index.title': 'Index authorisation',
      'index.desc':
        'Thread releases on the community index need a signed-in reader. Paste the token once and the watch can look for new versions on the threads you follow.',
      'index.placeholder': 'paste auth_token',
      'index.verify': 'Verify',
      'index.checking': 'verifying…',
      'index.ok': 'Token works, threads are readable',
      'index.bad': 'Token invalid or expired',
      'index.validUntil': 'Token works; expires {at}',
      'index.expired': 'Token expired on {at}; sign in again for a fresh one',
      'index.expiring': 'Token expires {at}; sign out and back in now to renew it',
      'index.renew': 'Get a new token',
      'index.howto':
        'On the index site press F12, run localStorage.getItem("auth_token") in the console, and paste the value here without quotes. It is stored locally and sent only to forum.shimmerday.top. These tokens last about seven days; sign in again to get a fresh one.',
      'primary.changed': 'Thread changed',
      'primary.feed': 'Feed mentions',
      'primary.discordNeedToken': 'Discord thread link: add an index token under Settings',
      'primary.title': 'Release watch',
      'primary.newer': 'New version published',
      'primary.newerUnstated': 'Author posted an update; the thread states no version',
      'primary.postedAt': 'Thread updated {at}',
      'primary.renamed': 'The author renamed this thread; the link is unchanged (now: {to})',
      'primary.current': 'Nothing newer than the local card',
      'primary.gated': 'Download conditions',
      'primary.error': 'watch failed',
      'primary.notset': 'no release link',
      'btn.open': 'Open',
      'btn.gotoThread': 'Open thread',
      'btn.gotoSearch': 'Search the index',
      'primary.tunHint':
        'If Discord opens in your browser but not here, switch your proxy to TUN mode (the plugin runs in a Node process and ignores the system proxy)',
      'index.netHint':
        'If a check reports a connection failure, confirm Discord opens normally. When the browser can reach it but this cannot, the proxy is usually not in TUN mode.',
      'primary.discovered': 'Thread matched automatically',
      'primary.emptyHint': 'No link yet? Find it on the index',
      'gate.password': 'password',
      'gate.role': 'role',
      'gate.reply': 'reply to view',
      'gate.paid': 'paid / sponsored',
      'gate.discord': 'Discord community',
      'label.baseline': 'Baseline',
      'btn.importNew': 'Import new',
      'note.noMvu': 'No same-named MVU copy, fill it in by hand',
      'note.confirmPair': 'Paired by name prefix, please confirm',
      'note.soloMvu': 'Standalone MVU card (no original paired; read-only here)',
      'label.imported': 'New version imported',
      'label.updated': 'Updated',
      'label.merged': 'Merged',
      'state.dirty': 'update found',
      'state.clean': 'up to date',
      'state.unknown': 'not checked',
      'state.unlinked': 'no link',
      'state.error': 'check failed',
      'state.baseline': 'baseline pending',
      'state.busy': 'working…',
      'state.off': 'disabled',
      'empty': 'No entries — rescan the card directory to auto-pair.',
      'log.title': 'Recent actions',
      'backup.title': 'Backups',
      'backup.none': 'no backup yet',
      'ok.saved': 'Saved',
      'ok.check': 'Check finished',
      'ok.removed': 'Entry removed',
      'ok.imported': 'New version imported',
      'ok.debugHint': 'Worth a debug pass to confirm the card still works end to end',
      'debug.plain': 'Original',
      'debug.mvu': 'MVU',
      'debug.done': '{who} debugged',
      'debug.todo': '{who} not debugged - click to debug',
      'debug.noPlay': 'No play conversation for this card yet; open one first',
      'debug.opened': 'Opened the card agent debug conversation',
      'debug.failed': 'Could not open the debug conversation',
      'debug.noReply': 'The card workspace did not answer; check that Tavern is open',
      'debug.busy': '{who} being debugged',
      'debug.changed': '{who} changed by debug, not reviewed yet',
      'debug.stale': '{who} changed since it was debugged',
      'debug.locked': 'A card is being debugged right now; wait for it to finish',
      'tools.search': 'Search name, marker or path…',
      'tools.all': 'All',
      'tools.plainOnly': 'Original only',
      'tools.mvuOnly': 'MVU only',
      'tools.sortAuto': 'Default: news first',
      'tools.sortImported': 'By import time',
      'tools.sortName': 'By name',
      'tools.empty': 'No card matches the filter',
      'tools.count': '{shown} / {total}',
      'tavern.missing.title': 'DSH Tavern is required',
      'tavern.missing.desc':
        'This plugin is a companion to DSH Tavern, which has to be installed first. Tavern owns the cards, the card workspace and the play data; this plugin only diffs remote updates, refreshes the original card and merges into the MVU copy.',
      'tavern.missing.open': 'Open the DSH Tavern repository',
      'ok.merge': 'Merge finished',
      'ok.updateMerge': 'Update + merge finished',
      'ok.restore': 'Restored from backup',
      'hint.interval': 'Auto check interval (minutes, 0 = off) — runs in the background',
      'err.bridge': 'Cannot reach the host half yet; retry in a moment.',
      'pick.title': 'Pick a card file',
      'pick.up': 'Up',
      'pick.explorer': 'Open in Explorer',
      'pick.use': 'Use this path',
      'pick.dir': 'dir',
      'pick.file': 'file',
      'pick.empty': 'No JSON file in this directory',
      'pick.choose': 'Choose',
      'err.list': 'Directory read failed',
      'restore.title': 'Restore a backup',
      'restore.count': '{n} snapshots · {size} total · newest 5 kept per file',
      'restore.keep': 'auto kept',
      'restore.prune': 'Prune now',
      'restore.group': '{n} backups · {size}',
      'restore.empty': 'No backup yet',
      'restore.prune.done': 'Pruned {n} snapshot(s) beyond the limit',
      'restore.deleted': 'Deleted {name}',
      'restore.restored': 'Restored {name}',
      'ok.done': 'Done',
      'restore.dir': 'Dir',
      'tag.manual': 'Manual',
      'tag.mvu': 'MVU card',
      'tag.plain': 'Original',
      'tag.plain-before-merge': 'Original before merge',
      'tag.before-restore': 'Before restore',
      'tag.before-rollback': 'Before rollback',
      'upd.checking': 'Checking…',
      'upd.latest': 'Up to date',
      'upd.available': 'Update {v}',
      'upd.failed': 'Check failed',
      'upd.nodata': 'No release yet',
      'upd.tip.idle': 'Check GitHub for a newer release',
      'upd.tip.latest': '{current} is the latest release',
      'upd.tip.available': 'Installed {current}, latest {latest} on GitHub; click to open',
      'upd.tip.failed': 'Check failed: {error}',
      'upd.tip.nodata': 'The repository publishes no version yet; click to open GitHub',
      'upd.version': 'Installed version {v}',
    }

    const CSS = [
      '.dcu-root{color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.55}',
      '.dcu-wrap{display:flex;flex-direction:column;gap:12px;padding:8px 2px 28px}',
      // Header holds the identity on the left and the two top-level actions on
      // the right, so they stop trailing after the description text.
      '.dcu-header{display:flex;align-items:flex-start;gap:12px}',
      '.dcu-header-actions{display:flex;align-items:center;gap:8px;flex:none}',
      '.dcu-path{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));word-break:break-all;margin-top:2px}',
      // One bar for the view switcher and the controls that go with it.
      '.dcu-bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:7px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}',
      '.dcu-tabs{display:flex;gap:3px;flex:none;padding:2px;border-radius:8px;background:var(--dsw-alias-bg-layer-1)}',
      '.dcu-tab{height:26px;padding:0 12px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer;transition:background .15s ease,color .15s ease}',
      '.dcu-tab:hover{color:var(--dsw-alias-label-primary)}',
      '.dcu-tab.on{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.08)}',
      '.dcu-bar-sep{width:1px;height:18px;flex:none;background:var(--dsw-alias-border-l2);margin:0 2px}',
      '.dcu-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.dcu-col{display:flex;flex-direction:column;gap:4px;min-width:0}',
      '.dcu-grow{flex:1 1 auto;min-width:0}',
      '.dcu-btn{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12px;cursor:pointer;transition:border-color .15s ease}',
      '.dcu-btn:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary)}',
      '.dcu-btn:disabled{opacity:.45;cursor:not-allowed}',
      '.dcu-btn.primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);font-weight:600}',
      '.dcu-btn.ghost{background:transparent}',
      // State-tinted buttons, used by the panel's own update check so its verdict
      // is readable from across the panel.
      '.dcu-btn.ok{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}',
      '.dcu-btn.bad{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
      '.dcu-btn.tiny{height:24px;padding:0 9px;font-size:11px;border-radius:6px}',
      '.dcu-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:12px;display:flex;flex-direction:column;gap:10px}',
      '.dcu-card.flat{background:var(--dsw-alias-bg-layer-2)}',
      '.dcu-title{font-size:14px;font-weight:700}',
      '.dcu-sub{font-size:11px;color:var(--dsw-alias-label-secondary);word-break:break-all}',
      '.dcu-chip{display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.dcu-chip.ok{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}',
      '.dcu-chip.warn{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}',
      '.dcu-chip.bad{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
      // Version tag next to the update button. Monospace keeps the digits the
      // same width as the version the button itself prints.
      '.dcu-ver{font-family:ui-monospace,Consolas,monospace;letter-spacing:.02em;color:var(--dsw-alias-label-primary)}',
      '.dcu-input{height:28px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12px;padding:0 10px;width:100%;box-sizing:border-box;min-width:0}',
      '.dcu-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}',
      '.dcu-avatar{flex:0 0 auto;width:48px;height:48px;border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}',
      '.dcu-avatar img{width:100%;height:100%;object-fit:cover;display:block}',
      '.dcu-item{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:14px;display:flex;flex-direction:column;gap:10px}',
      '.dcu-item.on{border-color:var(--dsw-alias-state-warn-primary)}',
      // The card reads top to bottom: identity, then what it is wired to, then
      // what a check found, then what can be done about it. Actions used to share
      // the title line, where five buttons could not fit and broke onto a second
      // row at a different place on every card.
      '.dcu-head{display:flex;align-items:flex-start;gap:10px}',
      '.dcu-fields{display:flex;flex-direction:column;gap:7px}',
      '.dcu-actions{display:flex;align-items:center;gap:6px;justify-content:flex-end;flex-wrap:wrap;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1)}',
      // A per-card result sits at the left of that card's own action row. The
      // buttons keep their right-aligned place and the sentence reads as being
      // about this card; `flex:1` is what pushes it over there.
      '.dcu-note{flex:1 1 auto;min-width:0;margin-right:6px;font-size:11px;line-height:1.5;text-align:left;word-break:break-word}',
      '.dcu-note.ok{color:var(--dsw-alias-state-success-primary)}',
      '.dcu-note.bad{color:var(--dsw-alias-state-error-primary)}',
      // The debug advice rides under the result rather than beside it, so a long
      // merge summary does not push it off the row.
      '.dcu-note-hint{display:block;margin-top:2px;opacity:.85}',
      // One column per card slot, saying what the card agent has looked at. Capped
      // in width so two long rows cannot squeeze the name out of the header.
      '.dcu-debug{display:flex;align-items:center;gap:5px;flex:none;flex-wrap:wrap;justify-content:flex-end;max-width:54%}',
      '.dcu-dbg{font-size:10px}',
      '.dcu-dbg-open{cursor:pointer}',
      '.dcu-dbg-open:disabled{opacity:.55;cursor:not-allowed}',
      // One row for the card list's own controls, kept apart from the view bar so
      // the panel-level actions and the list-level ones do not read as one set.
      '.dcu-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}',
      '.dcu-select{height:28px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12px;padding:0 8px;cursor:pointer}',
      '.dcu-select:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}',
      // Label column sized to the longest label and right-aligned, so every input
      // in the card starts at the same x.
      '.dcu-slot{display:grid;grid-template-columns:auto minmax(0,1fr);gap:10px;align-items:center}',
      '.dcu-slot>label{font-size:11px;color:var(--dsw-alias-label-secondary);min-width:62px;text-align:right;white-space:nowrap}',
      // The release-watch strip sits below the action buttons, so a version found
      // on the release page reads as a remark on the check rather than another
      // control competing with the buttons above it.
      '.dcu-hint{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:2px;padding:8px 10px;border-radius:10px;border:1px dashed var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}',
      '.dcu-hint-name{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);letter-spacing:.02em}',
      '.dcu-overlay{position:fixed;inset:0;z-index:90;display:flex;align-items:stretch;justify-content:center;background:rgba(0,0,0,.42)}',
      '.dcu-sheet{margin:6vh 4vw;width:min(1040px,100%);max-height:88vh;border-radius:14px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-shadow:0 24px 60px rgba(0,0,0,.45);display:flex;flex-direction:column;overflow:hidden;pointer-events:auto}',
      '.dcu-sheet-head{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}',
      '.dcu-sheet-body{padding:12px 16px 20px;overflow:auto}',
      // Backups are grouped per card file. Flat rows meant the same card repeated
      // down the page and hid how many copies of each one actually exist.
      '.dcu-bk{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;margin-bottom:6px;overflow:hidden}',
      '.dcu-bk-head{display:flex;align-items:center;gap:8px;padding:9px 11px;cursor:pointer;background:var(--dsw-alias-bg-layer-2)}',
      '.dcu-bk-head:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dcu-bk-caret{width:12px;flex:none;font-size:10px;color:var(--dsw-alias-label-secondary)}',
      '.dcu-bk-name{font-size:13px;font-weight:600;word-break:break-all}',
      '.dcu-bk-body{padding:2px 11px 8px}',
      '.dcu-bk-item{display:flex;align-items:center;gap:8px;padding:6px 0;border-top:1px solid var(--dsw-alias-border-l1)}',
      '.dcu-log{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;max-height:160px;overflow:auto;border:1px dashed var(--dsw-alias-border-l1);border-radius:8px;padding:8px}',
      // Sidebar-foot entry. A shipped-shaped row while the sidebar is wide and
      // a 36px icon button in the rail. Geometry is the shell's: this file only
      // supplies the button, and it never measures or moves neighbouring rows.
      // The wide-state box copies the shipped rows' math (width calc(100% + 4px)
      // with margin 4px -2px), so this row is the same width as its neighbours
      // instead of sitting 2px narrower on either side.
      '.dcu-entry{display:flex;align-items:center;gap:8px;width:calc(100% + 4px);height:42px;box-sizing:border-box;margin:4px -2px;padding:0 10px 0 8px;border:0;border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;text-align:left;flex:none}',
      '.dcu-entry:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dcu-entry:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
      '.dcu-entry[data-wide="false"]{width:36px;height:36px;margin:0;padding:0;gap:0;justify-content:center;border-radius:50%;flex:0 0 auto}',
      '.dcu-entry-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      // Rail geometry is keyed on the `wide` prop alone, which the sidebar shell
      // passes down and therefore owns. An earlier revision also keyed it on
      // `[data-sidebar-collapsed]` as a fallback, but that attribute belongs to
      // another plugin's panel state, so opening that panel while the sidebar was
      // expanded squashed this button into the round rail shape for no reason.
    ].join('\n')

    const BASE = '/dsh-card-updater'

    /** The community index, where a card's thread can be found by hand. */
    const INDEX_SITE = 'https://odysseia-forum-webpage.pages.dev'

    /** The index site's Discord sign-in, which is where a fresh token comes from. */
    const INDEX_LOGIN = INDEX_SITE + '/login'

    /** Where this plugin lives; the update button sends the browser here. */
    const REPO_URL = 'https://github.com/XGUIMAX/dsh-card-updater'

    /**
     * Last self-update verdict, kept in module scope so the panel can show an
     * answer on its first frame, before the check it fires on open has returned.
     */
    let updateMemo = { status: 'idle' }

    async function apiGet(path) {
      const url = path ? `${BASE}/list?path=${encodeURIComponent(path)}` : `${BASE}/state`
      const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    }

    /** Directory browser: lists `dir` (defaults to the card directory). */
    async function listDir(dir) {
      const url = `${BASE}/list${dir ? `?path=${encodeURIComponent(dir)}` : ''}`
      const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data && data.ok === false) throw new Error(data.error || 'list failed')
      return data
    }

    async function apiPost(body, timeoutMs = 300000) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await fetch(`${BASE}/action`, {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body || {}),
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return await res.json()
      } finally {
        clearTimeout(timer)
      }
    }

    function normalizeSrc(src) {
      if (!src) return null
      if (typeof src === 'string') return src || null
      if (src.kind === 'file') return src.path || null
      return src.url || null
    }

    function setSrc(slot, text) {
      const v = String(text || '').trim()
      slot.src = v
        ? /^https?:/i.test(v)
          ? { kind: 'url', url: v }
          : { kind: 'file', path: v }
        : { kind: 'url', url: '' }
    }

    function patchEntry(cfg, id, key, value) {
      const next = JSON.parse(JSON.stringify(cfg || { cards: [] }))
      const entry = (next.cards || []).find((c) => c.id === id)
      if (!entry) return next
      if (key === 'plain.path') entry.plain.path = value
      else if (key === 'mvu.path') entry.mvu.path = value
      else if (key === 'plain.srcText') setSrc(entry.plain, value)
      else if (key === 'mvu.srcText') setSrc(entry.mvu, value)
      else if (key === 'primary.url') {
        entry.primary = entry.primary || {}
        entry.primary.url = value
      } else if (key === 'primary.match') {
        entry.primary = entry.primary || {}
        entry.primary.match = value
      } else if (key === 'label') entry.label = value
      return next
    }

    /**
     * The term to search the index with. The server records the wording it
     * resolved for this card, which is the only version that can see inside the
     * card file, so it is used when present. The local fallbacks below only run
     * before the first check, and follow the same order: the configured marker,
     * then the MVU file name, then the label.
     * @param {object} entry - the config entry.
     * @returns {string} the search term.
     */
    function indexQuery(entry) {
      const resolved = String((entry.primary && entry.primary.query) || '').trim()
      if (resolved) return resolved
      const marker = String((entry.primary && entry.primary.match) || '').trim()
      if (marker) return marker
      const stem = String((entry.label || '')).replace(/\.json$/i, '')
      return (
        stem
          .replace(/\s*MVU\s*版本?\s*/gi, ' ')
          .replace(/[\s_-]*[vV]?\d+(?:[._]\d+)*[a-zA-Z_]*[\s_-]*$/, '')
          .replace(/^[\s《【\[（(]+/, '')
          .replace(/[\s》】\]）)]+$/, '')
          .trim() || stem
      )
    }

    /**
     * The line under a card's title. Whether an MVU copy is paired is read from
     * the paths themselves, never from a stored note: a note is written when the
     * directory is scanned and goes stale the moment a path is filled in by hand,
     * which is how a card with its MVU file already attached went on saying it
     * had none. The only thing worth keeping from the scan is the leftover
     * uncertainty, that a pair was guessed from a name prefix.
     * @param {object} entry - the config entry.
     * @returns {string} the subtitle text.
     */
    function subtitleOf(entry) {
      const plainPath = String((entry.plain && entry.plain.path) || '').trim()
      const mvuPath = String((entry.mvu && entry.mvu.path) || '').trim()
      const bits = []
      if (plainPath && mvuPath) {
        bits.push(`${t('label.mvu')}：${mvuPath.split(/[\\/]/).pop()}`)
        if (entry.pairVia === 'prefix') bits.push(t('note.confirmPair'))
      } else if (plainPath) {
        bits.push(t('note.noMvu'))
      } else if (mvuPath) {
        bits.push(t('note.soloMvu'))
      }
      if (entry.updatedAt) bits.push(`${t('label.updated')} ${new Date(entry.updatedAt).toLocaleString()}`)
      if (entry.mergedAt) bits.push(`${t('label.merged')} ${new Date(entry.mergedAt).toLocaleString()}`)
      return bits.join(' · ')
    }

    function statusOf(entry, report) {
      if (entry.enabled === false) return { kind: 'idle', text: t('state.off') }
      const hasPlain = !!normalizeSrc(entry.plain && entry.plain.src)
      const hasPrimary = !!String((entry.primary && entry.primary.url) || '').trim()
      if (!hasPlain && !hasPrimary) return { kind: 'idle', text: t('state.unlinked') }
      const hit = report && report.results ? report.results.find((r) => r.id === entry.id) : null
      if (!hit) return { kind: 'idle', text: entry.lastCheckSummary || t('state.unknown') }
      const plainBad = !!(hit.plain && hit.plain.ok === false && !hit.plain.skipped)
      const primaryBad = !!(hit.primary && hit.primary.ok === false && !hit.primary.skipped)
      // A release page that cannot be scraped (a community post behind a login,
      // say) is worth reporting but not worth flagging as a broken card, so it
      // only turns the chip red when the card link failed too.
      if (plainBad && (!hit.primary || primaryBad)) return { kind: 'bad', text: t('state.error') }
      if (hit.primary && hit.primary.ok && hit.primary.newer) return { kind: 'warn', text: t('state.dirty') }
      if (hit.plain && hit.plain.changed) return { kind: 'warn', text: t('state.dirty') }
      if (hit.plain && hit.plain.first) return { kind: 'info', text: t('state.baseline') }
      if (hit.primary && hit.primary.first) return { kind: 'info', text: t('state.baseline') }
      return { kind: 'ok', text: t('state.clean') }
    }

    function chipClass(kind) {
      return (
        'dcu-chip' + (kind === 'ok' ? ' ok' : kind === 'warn' || kind === 'info' ? ' warn' : kind === 'bad' ? ' bad' : '')
      )
    }

    /** A version as it should read in prose: exactly one leading v. */
    function withV(value) {
      const text = String(value == null ? '' : value).trim()
      if (!text) return ''
      return /^v/i.test(text) ? text : 'v' + text
    }

    /**
     * Hand a URL to the browser. The panel is an ordinary page, so `window.open`
     * goes first; a popup blocker that turns it down falls back to a synthetic
     * anchor, which is not filtered the same way.
     * @param {string} url - the target.
     */
    function openExternal(url) {
      const target = String(url || '').trim()
      if (!target) return
      try {
        const win = window.open(target, '_blank', 'noopener,noreferrer')
        if (win) {
          win.opener = null
          return
        }
      } catch {
        /* blocked: the anchor route below is not treated as a popup */
      }
      try {
        const a = document.createElement('a')
        a.href = target
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
        document.body.appendChild(a)
        a.click()
        a.remove()
      } catch {
        /* nothing else left to try */
      }
    }

    /** The label on the panel's own update button, which doubles as its verdict. */
    function updateLabel(upd) {
      if (upd.status === 'busy') return t('upd.checking')
      if (upd.status === 'available') return t('upd.available').replace('{v}', withV(upd.latest))
      if (upd.status === 'latest') return t('upd.latest')
      if (upd.status === 'failed') return t('upd.failed')
      if (upd.status === 'nodata') return t('upd.nodata')
      return t('btn.checkUpdate')
    }

    /**
     * Copy the host half's own fields from `fresh` into a draft, leaving every
     * field the user can type in exactly as they left it.
     *
     * The host writes check verdicts, merge records, baselines and file
     * signatures into the same entry the user edits, so a draft taken before a
     * check would otherwise undo that check on the next save.
     * @param {object} draft - the config being edited.
     * @param {object} fresh - the host half's current config.
     * @returns {object} a merged copy.
     */
    function mergeHostState(draft, fresh) {
      if (!draft || !fresh) return draft
      const latest = new Map((fresh.cards || []).map((c) => [c.id, c]))
      const next = JSON.parse(JSON.stringify(draft))
      next.cards = (next.cards || []).map((entry) => {
        const host = latest.get(entry.id)
        if (!host) return entry
        // The release link and the search term are typed by the user; every other
        // field on `primary` is the host's own reading of that link.
        const mine = entry.primary || {}
        entry.primary = { ...(host.primary || {}), url: mine.url, match: mine.match }
        if (host.plain) entry.plain = { ...(entry.plain || {}), sig: host.plain.sig }
        if (host.mvu) entry.mvu = { ...(entry.mvu || {}), sig: host.mvu.sig }
        for (const key of ['updatedAt', 'mergedAt', 'lastCheckSummary', 'pairVia']) {
          if (host[key] === undefined) delete entry[key]
          else entry[key] = host[key]
        }
        return entry
      })
      return next
    }

    /**
     * Turn a verifyIndex answer into the line shown under the token field. An
     * expired token is named and dated, because "invalid or expired" leaves the
     * user guessing whether to retype this one or go and fetch a new one.
     * @param {object} res - the host half's answer.
     * @returns {{kind: string, text: string, renew: boolean}} badge state.
     */
    /** How close to expiry a token has to be before it is worth flagging. */
    const TOKEN_WARN_MS = 24 * 60 * 60 * 1000

    function describeVerify(res) {
      const ok = !!(res && res.ok && res.loggedIn)
      const expires = res && res.expiresAt ? new Date(res.expiresAt) : null
      const at = expires ? expires.toLocaleString() : ''
      if (ok) {
        // A token about to lapse is worth saying out loud, because renewing it
        // means signing out of the index site and back in. That is a poor thing
        // to discover only once every card check has started failing.
        if (expires && expires.getTime() - Date.now() < TOKEN_WARN_MS) {
          return { kind: 'warn', text: t('index.expiring').replace('{at}', at), renew: true }
        }
        return {
          kind: 'ok',
          text: at ? t('index.validUntil').replace('{at}', at) : t('index.ok'),
          renew: false,
        }
      }
      if (res && res.expired) {
        return { kind: 'bad', text: t('index.expired').replace('{at}', at), renew: true }
      }
      return { kind: 'bad', text: (res && res.error) || t('index.bad'), renew: !!(res && res.loginUrl) }
    }

    /**
     * What the Tavern card workspace knows about one card.
     *
     * The host scan is keyed by file name, because that is all a conversation
     * snapshot records, and the two slots of an entry routinely point into
     * different folders.
     * @param {object} data - the host half's state.
     * @param {string} cardPath - an absolute path from the config.
     * @returns {{debugAt: string|null, sessionId: string|null}|null} null when the
     *   workspace holds no conversation for that card.
     */
    function workspaceOf(data, cardPath) {
      const name = String(cardPath || '').split(/[\\/]/).pop()
      const all = data && data.workspace && data.workspace.cards
      if (!name || !all) return null
      return all[name] || null
    }

    /**
     * Whether either slot of an entry is a card the workspace has never opened a
     * conversation for. A card nobody has looked at is the one most likely to be
     * broken, so it ranks above the ones already checked.
     * @param {object} entry - the config entry.
     * @param {object} data - the host half's state.
     * @returns {boolean}
     */
    function needsDebug(entry, data) {
      for (const slot of ['plain', 'mvu']) {
        const p = String((entry[slot] && entry[slot].path) || '').trim()
        if (!p) continue
        const ws = workspaceOf(data, p)
        if (!ws) return true
        // A record older than the file describes a card that is no longer there,
        // which is the same situation as never having looked at it.
        const written = Number((data && data.fileTimes && data.fileTimes[`${entry.id}:${slot}`]) || 0)
        if (ws.debugAt && written > Date.parse(ws.debugAt)) return true
      }
      return false
    }

    /**
     * Ask Tavern's card workspace to open its debug entry for a play
     * conversation. The workspace answers this event by creating the debugging
     * conversation; the promise is what separates "opened" from "nothing was
     * listening", which otherwise look exactly alike from here.
     * @param {string} sourceSessionId - the play conversation to debug from.
     * @returns {Promise<void>}
     */
    function openCardDebug(sourceSessionId) {
      return new Promise((resolve, reject) => {
        let settled = false
        const timer = window.setTimeout(() => {
          if (settled) return
          settled = true
          reject(new Error(t('debug.noReply')))
        }, 15000)
        const finish = (fn, value) => {
          if (settled) return
          settled = true
          window.clearTimeout(timer)
          fn(value)
        }
        window.dispatchEvent(
          new CustomEvent('dsh-tavern-debug-play-chat', {
            detail: {
              sourceSessionId,
              // Tavern's own entry passes the turn it was opened at. From here the
              // newest turn is not known, and the debug conversation can be moved
              // to any turn once it exists.
              turn: 0,
              resolve: (value) => finish(resolve, value),
              reject: (error) => finish(reject, error),
            },
          }),
        )
      })
    }

    /** The hover text: version numbers and the reason a check failed live here. */
    function updateTip(upd) {
      if (upd.status === 'available') {
        return t('upd.tip.available').replace('{current}', withV(upd.current)).replace('{latest}', withV(upd.latest))
      }
      if (upd.status === 'latest') return t('upd.tip.latest').replace('{current}', withV(upd.current))
      if (upd.status === 'nodata') return t('upd.tip.nodata')
      if (upd.status === 'failed') {
        const base = t('upd.tip.failed').replace('{error}', upd.error || '')
        return upd.network ? base + ' · ' + t('primary.tunHint') : base
      }
      return t('upd.tip.idle')
    }

    /**
     * What the release page said on the last check, shown under the card's
     * buttons. A newer version is the whole point of the watch, so it is stated
     * outright, and it is paired with the conditions the page attaches to the
     * download: knowing a release exists is worth little without knowing what it
     * costs to get, and both answers come out of the same fetch.
     * @param {object} entry - the config entry.
     * @returns {object|null} the hint element, or null when there is nothing to say.
     */
    function primaryHint(entry) {
      const state = entry.primary || {}
      if (!String(state.url || '').trim()) return null
      const bits = []
      if (state.error) {
        bits.push({ kind: 'bad', text: t('primary.error') + '：' + state.error })
        // A connection that never reached the host is almost always the proxy,
        // not the link: this runs in a Node process that ignores the system proxy
        // setting, so a browser can open Discord while this cannot.
        if (state.networkError) bits.push({ kind: 'info', text: t('primary.tunHint') })
      } else if (state.newer) {
        // A number the index tracks is a version and can be printed as one. A
        // number scraped from a heading is usually the posting date, and printing
        // that as "V9.21" told the reader the card had a version it does not have.
        const isVersion = state.versionKind !== 'date'
        bits.push({
          kind: 'warn',
          text: isVersion
            ? t('primary.newer') + (state.version ? ` V${state.version}` : '')
            : t('primary.newerUnstated'),
        })
      } else if (state.changed) {
        // Some authors ship a new file under an unchanged headline, so a page or
        // thread that moved without a recognisable version marker is still news.
        bits.push({ kind: 'warn', text: t('primary.changed') })
      } else if (state.sig) {
        bits.push({
          kind: 'ok',
          text:
            t('primary.current') +
            (state.version
              ? state.versionKind === 'date'
                ? `（${t('primary.postedAt').replace('{at}', state.version)}）`
                : `（页面 V${state.version}）`
              : ''),
        })
      }
      if (state.gates && state.gates.length) {
        bits.push({
          kind: 'info',
          text: t('primary.gated') + '：' + state.gates.map((g) => t('gate.' + g)).join(' · '),
        })
      }
      if (state.renamedFrom && state.title) {
        // The link is what identifies the card, and it has not changed — only the
        // heading on top of it. Said that way round, because a message about the
        // title alone reads like a warning that the link might be wrong.
        const brief = (s) => (String(s).length > 32 ? String(s).slice(0, 32) + '…' : String(s))
        bits.push({
          kind: 'info',
          text: t('primary.renamed').replace('{to}', brief(state.title)),
        })
      }
      if (state.discoveredAt) {
        bits.push({ kind: 'info', text: t('primary.discovered') })
      }
      if (state.feedCount > 0) {
        bits.push({
          kind: 'info',
          text: t('primary.feed') + '：' + (state.feedTitle || `${state.feedCount} 条`),
        })
      }
      if (!bits.length) return null
      return h(
        'div',
        { className: 'dcu-hint' },
        h('span', { className: 'dcu-hint-name' }, t('primary.title')),
        ...bits.map((b, i) => h('span', { key: i, className: chipClass(b.kind) }, b.text)),
        state.checkedAt ? h('span', { className: 'dcu-sub' }, new Date(state.checkedAt).toLocaleString()) : null,
      )
    }

    /**
     * Actions that rewrite a card file. A successful one earns a debug pass: the
     * card will still load, but its status bar, variable scripts or a regex that
     * depended on the old wording can be off, and that only surfaces once the card
     * is actually played.
     */
    const WRITES_CARD = new Set(['apply', 'merge', 'updateAndMerge', 'importPlain'])

    function summarize(res) {
      const r = res && res.result
      if (!r) return ''
      const bits = []
      if (r.changed && r.changed.length) bits.push(r.changed.slice(0, 8).join('、') + (r.changed.length > 8 ? ' …' : ''))
      if (r.book) bits.push(`书 +${r.book.added}/~${r.book.updated}/保留${r.book.conflicts}`)
      if (r.regexAdded) bits.push(`正则 +${r.regexAdded}`)
      if (r.target) bits.push(String(r.target).split('\\').pop())
      return bits.length ? ' → ' + bits.join(' · ') : ''
    }

    /** Compact label for the active merge strategy, for the tab-row badge. */
    function strategyShort(cfg) {
      const key = (cfg && cfg.mergeStrategy) || 'standard'
      if (key === 'minimal') return t('strategy.minimal')
      if (key === 'full') return t('strategy.full')
      return t('strategy.standard')
    }

    function useStyles() {
      useEffect(() => {
        const tag = document.createElement('style')
        tag.setAttribute('data-dsh-card-updater', '1')
        tag.textContent = CSS
        document.head.appendChild(tag)
        return () => {
          try {
            tag.remove()
          } catch {
            /* ignore */
          }
        }
      }, [])
    }

    function useUpdater() {
      const [data, setData] = useState(null)
      const [busy, setBusy] = useState(false)
      const [message, setMessage] = useState(null)
      const [log, setLog] = useState([])
      const [lastError, setLastError] = useState(null)

      const push = useCallback((text, kind) => {
        setLog((prev) => [{ t: new Date().toLocaleTimeString(), text, kind: kind || 'info' }, ...prev].slice(0, 40))
      }, [])

      const load = useCallback(async () => {
        try {
          const res = await apiGet()
          setData(res)
          setLastError(null)
          return res
        } catch (e) {
          const text = String(e && e.message ? e.message : e)
          setLastError(text)
          setMessage({ kind: 'bad', text: t('err.bridge') + ' (' + text + ')' })
          return null
        }
      }, [])

      useEffect(() => {
        load()
      }, [load])

      const run = useCallback(
        async (action, args, okText, cardId) => {
          setBusy(true)
          setMessage(null)
          // A message pinned to a card is rendered on that card's own action row,
          // so a result about one card does not have to be read at the top of the
          // panel and matched back to whatever it was about. Anything without a
          // card id stays in the header, where the whole-panel actions report.
          const at = cardId || null
          try {
            const res = await apiPost({ action, ...(args || {}) })
            if (res && res.ok === false) {
              // A gated source answers with a sentence meant to be read as advice;
              // prefixing it with the action name would bury it under a label the
              // user already knows.
              const text = res.gated ? res.error : `${okText || action}：${res.error || 'failed'}`
              setMessage({ kind: 'bad', text, cardId: at })
              push(`${okText || action} 失败：${res.error || 'failed'}`, 'bad')
            } else {
              if (okText) {
                setMessage({
                  kind: 'ok',
                  text: okText + summarize(res),
                  cardId: at,
                  hint: WRITES_CARD.has(action) ? t('ok.debugHint') : '',
                })
              }
              push((okText || action) + summarize(res), 'ok')
            }
            await load()
            return res
          } catch (e) {
            const text = String(e && e.message ? e.message : e)
            setMessage({ kind: 'bad', text, cardId: at })
            push(`${action} 失败：${text}`, 'bad')
            return { ok: false, error: text }
          } finally {
            setBusy(false)
          }
        },
        [load, push],
      )

      return { data, busy, message, log, lastError, push, load, run }
    }

    /* --------------------------------------------------------- components */

    function EntryCard({ entry, u, patch, onPick, onCheck, onImportNew, onMerge, onUpdateMerge, onRemove, onDebug }) {
      const st = statusOf(entry, u.data ? u.data.lastReport : null)
      // This card's own last result, if the last thing that ran was about it.
      const note = u.message && u.message.cardId === entry.id ? u.message : null
      /**
       * One workspace column, for a slot that actually holds a file. A slot whose
       * record is missing or out of date is the interesting one, since nothing has
       * looked at what is on disk now.
       * @param {string} path - the slot's card path, empty when unset.
       * @param {string} who - the slot's name, for the label.
       * @param {string} slot - `plain` or `mvu`, for the modification time.
       * @returns {object|null} the chip, or null when the slot is empty.
       */
      const debugSlot = (path, who, slot) => {
        if (!path) return null
        const ws = workspaceOf(u.data, path)
        // A conversation that wrote seconds ago is being worked on right now, so
        // saying "debugged" here would report the check as finished mid-run.
        if (ws && ws.busy) {
          return h('span', { className: 'dcu-chip warn dcu-dbg' }, t('debug.busy').replace('{who}', who))
        }
        // The file has been written since the record was made — another card
        // picked, a release imported, the original updated — so the record covers
        // a card that is no longer on disk.
        const written = Number((u.data && u.data.fileTimes && u.data.fileTimes[`${entry.id}:${slot}`]) || 0)
        const stale = !!(ws && ws.debugAt && written > Date.parse(ws.debugAt))
        if (!stale && ws && ws.changed) {
          return h('span', { className: 'dcu-chip warn dcu-dbg' }, t('debug.changed').replace('{who}', who))
        }
        if (!stale && ws && ws.debugAt) {
          const said = t('debug.done').replace('{who}', who)
          return h(
            'span',
            { className: 'dcu-chip ok dcu-dbg', title: said },
            `${said} ${new Date(ws.debugAt).toLocaleString()}`,
          )
        }
        // Nothing has looked at this card, or what did was looking at a file that
        // has since been replaced. Both want the same button.
        const todo = (stale ? t('debug.stale') : t('debug.todo')).replace('{who}', who)
        // Opening the workspace's debug entry needs a play conversation to open it
        // from; without one the chip still reports, it just cannot act.
        const canOpen = !!(ws && ws.sessionId)
        return h(
          'button',
          {
            type: 'button',
            className: 'dcu-chip warn dcu-dbg dcu-dbg-open',
            disabled: !canOpen,
            title: canOpen ? todo : t('debug.noPlay'),
            onClick: () => onDebug(ws && ws.sessionId),
          },
          todo,
        )
      }
      const linked = !!normalizeSrc(entry.plain && entry.plain.src)
      const hasMvu = !!(entry.mvu && entry.mvu.path)
      const primaryUrl = String((entry.primary && entry.primary.url) || '').trim()
      // What the check needs is a place to look, which is the release link. The
      // source link only ever fed the automatic download, so a card without one
      // is still perfectly checkable.
      const watchable = !!primaryUrl || linked
      return h(
        'div',
        { className: 'dcu-item' + (st.kind === 'warn' ? ' on' : '') },
        // Identity. The status chip belongs here and nothing else does: whether
        // the card is current is part of what it is, while the buttons below are
        // what can be done to it.
        h(
          'div',
          { className: 'dcu-head' },
          h(
            'div',
            { className: 'dcu-avatar' },
            h('img', {
              // The path alone would be cached for a day, so re-importing a card
              // would keep showing the old portrait. The stamp comes from the
              // card's own state, which changes whenever the file does.
              src: `${BASE}/avatar?path=${encodeURIComponent((entry.plain && entry.plain.path) || '')}&v=${encodeURIComponent(
                (entry.plain && entry.plain.sig) || entry.updatedAt || '',
              )}`,
              alt: '',
              loading: 'lazy',
              onError: (ev) => {
                ev.target.style.display = 'none'
              },
            }),
          ),
          h(
            'div',
            { className: 'dcu-col dcu-grow' },
            h('input', {
              className: 'dcu-input',
              style: { fontWeight: 600, border: 'none', background: 'transparent', padding: '0 2px', height: 22 },
              value: entry.label || entry.id,
              onChange: (ev) => patch(entry.id, 'label', ev.target.value),
            }),
            h('div', { className: 'dcu-sub' }, subtitleOf(entry)),
          ),
          // The workspace columns sit between the name and the update state: what
          // has been looked at, then whether it is current. A slot with no file
          // renders nothing, so a card paired with only one of the two shows one
          // column rather than a column saying it is missing.
          h(
            'div',
            { className: 'dcu-debug' },
            debugSlot(String((entry.plain && entry.plain.path) || '').trim(), t('debug.plain'), 'plain'),
            debugSlot(String((entry.mvu && entry.mvu.path) || '').trim(), t('debug.mvu'), 'mvu'),
          ),
          h('span', { className: chipClass(st.kind) }, st.text),
        ),
        // Wiring: what the card reads from and what it writes to.
        h(
          'div',
          { className: 'dcu-fields' },
        h(
          'div',
          { className: 'dcu-slot' },
          h('label', null, t('label.file')),
          h(
            'div',
            { className: 'dcu-row', style: { flexWrap: 'nowrap', gap: 6 } },
            h('input', {
              className: 'dcu-input',
              value: (entry.plain && entry.plain.path) || '',
              onChange: (ev) => patch(entry.id, 'plain.path', ev.target.value),
            }),
            h(
              'button',
              {
                type: 'button',
                className: 'dcu-btn tiny',
                style: { flex: 'none' },
                disabled: u.busy,
                onClick: () => onPick('plain.path'),
              },
              t('btn.pickFile'),
            ),
          ),
        ),
        h(
          'div',
          { className: 'dcu-slot' },
          h('label', null, t('label.primary')),
          h(
            'div',
            { className: 'dcu-row', style: { flexWrap: 'nowrap', gap: 6 } },
            h('input', {
              className: 'dcu-input',
              placeholder: 'https://…（发布页 / 社区贴，用于检索新版）',
              value: (entry.primary && entry.primary.url) || '',
              onChange: (ev) => patch(entry.id, 'primary.url', ev.target.value),
            }),
            primaryUrl
              ? h(
                  'a',
                  {
                    className: 'dcu-btn tiny',
                    style: { flex: 'none', textDecoration: 'none' },
                    href: primaryUrl,
                    target: '_blank',
                    rel: 'noreferrer noopener',
                  },
                  t('btn.open'),
                )
              : null,
          ),
        ),
        primaryUrl
          ? h(
              'div',
              { className: 'dcu-slot' },
              h('label', null, t('label.match')),
              h('input', {
                className: 'dcu-input',
                placeholder: '页面上定位这张卡的文字，例如卡名；留空则整页检索',
                value: (entry.primary && entry.primary.match) || '',
                onChange: (ev) => patch(entry.id, 'primary.match', ev.target.value),
              }),
            )
          : null,
        // A card with no release link cannot be watched, and the automatic
        // lookup does not always hit (a title may spell the card differently).
        // This is the way out of that dead end: the same search the lookup runs,
        // opened on the site so the thread can be picked by eye and pasted in.
        !primaryUrl
          ? h(
              'div',
              { className: 'dcu-slot' },
              h('div', null),
              h(
                'div',
                { className: 'dcu-row', style: { gap: 8, flexWrap: 'wrap' } },
                h('span', { className: 'dcu-sub' }, t('primary.emptyHint')),
                h(
                  'a',
                  {
                    className: 'dcu-btn tiny',
                    style: { textDecoration: 'none', flex: 'none' },
                    href: `${INDEX_SITE}/search?q=${encodeURIComponent(indexQuery(entry))}&sort=relevance`,
                    target: '_blank',
                    rel: 'noreferrer noopener',
                  },
                  t('btn.gotoSearch'),
                ),
              ),
            )
          : null,
        h(
          'div',
          { className: 'dcu-slot' },
          h('label', null, t('label.mvu')),
          h(
            'div',
            { className: 'dcu-row', style: { flexWrap: 'nowrap', gap: 6 } },
            h('input', {
              className: 'dcu-input',
              placeholder: '（可留空）',
              value: (entry.mvu && entry.mvu.path) || '',
              onChange: (ev) => patch(entry.id, 'mvu.path', ev.target.value),
            }),
            h(
              'button',
              {
                type: 'button',
                className: 'dcu-btn tiny',
                style: { flex: 'none' },
                disabled: u.busy,
                onClick: () => onPick('mvu.path'),
              },
              t('btn.pickFile'),
            ),
          ),
        ),
        ),
        primaryHint(entry),
        entry.lastError ? h('div', { className: 'dcu-sub' }, '⚠ ' + entry.lastError) : null,
        entry.lastMergeChanged && entry.lastMergeChanged.length
          ? h('div', { className: 'dcu-sub' }, `${t('label.merged')}: ${entry.lastMergeChanged.join('、')}`)
          : null,
        // What can be done to the card, gathered in one row and pushed right, so
        // the buttons land in the same place on every card instead of wrapping
        // wherever the title happens to end.
        h(
          'div',
          { className: 'dcu-actions' },
          // What happened to one card belongs on that card's own row, next to the
          // buttons that caused it, rather than at the top of the panel where it
          // has to be matched back to the card it was about.
          note
            ? h(
                'div',
                { className: 'dcu-note ' + (note.kind === 'bad' ? 'bad' : 'ok') },
                (note.kind === 'bad' ? '⚠ ' : '✓ ') + note.text,
                note.hint ? h('span', { className: 'dcu-note-hint' }, note.hint) : null,
              )
            : null,
          h(
            'div',
            { className: 'dcu-sub dcu-grow' },
            // The hash baseline is deliberately not shown: it is an internal
            // comparison key with nothing a reader can act on. What is worth a
            // line here is the import, because that is the human step.
            entry.importedAt
              ? `✅ ${t('label.imported')} ${new Date(entry.importedAt).toLocaleString()}` +
                (entry.importedFrom ? ` · ${String(entry.importedFrom).split('\\').pop()}` : '')
              : '',
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dcu-btn tiny',
              disabled: u.busy || !watchable,
              onClick: () => onCheck([entry.id]),
            },
            t('btn.check'),
          ),
          primaryUrl
            ? h(
                'a',
                {
                  className: 'dcu-btn tiny',
                  style: { textDecoration: 'none' },
                  href: primaryUrl,
                  target: '_blank',
                  rel: 'noreferrer noopener',
                },
                t('btn.gotoThread'),
              )
            : null,
          h(
            'button',
            {
              type: 'button',
              className: 'dcu-btn tiny',
              disabled: u.busy || !(entry.plain && entry.plain.path),
              onClick: () => onImportNew(entry.id),
            },
            t('btn.importNew'),
          ),
          hasMvu
            ? h(
                'button',
                { type: 'button', className: 'dcu-btn tiny', disabled: u.busy, onClick: () => onMerge(entry.id) },
                t('btn.merge'),
              )
            : null,
          h(
            'button',
            {
              type: 'button',
              className: 'dcu-btn tiny primary',
              disabled: u.busy || !linked || !hasMvu,
              onClick: () => onUpdateMerge(entry.id),
            },
            t('btn.updateMerge'),
          ),
          h(
            'button',
            { type: 'button', className: 'dcu-btn tiny ghost', disabled: u.busy, onClick: () => onRemove(entry.id) },
            t('btn.remove'),
          ),
        ),
      )
    }

    function browseEntryPath(cards, id, key) {
      const entry = (cards || []).find((c) => c.id === id)
      if (!entry) return null
      const value = key === 'plain.path' ? entry.plain && entry.plain.path : entry.mvu && entry.mvu.path
      if (!value) return null
      // Start the browser in the folder that already holds this slot's file.
      return String(value).replace(/[\\/][^\\/]*$/, '')
    }

    function formatSize(bytes) {
      const n = Number(bytes || 0)
      if (n < 1024) return `${n} B`
      if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
      return `${(n / 1024 / 1024).toFixed(1)} MB`
    }

    /**
     * Normalize one backup record. The host returns structured entries, but a
     * host half started before that change answers with bare file names — accept
     * both so a page refresh never loses the list to a stale host.
     * @param {string|object} raw - the entry as received.
     * @returns {{name: string, tag: string, file: string, size: number, at: string|null}}
     */
    function normalizeBackup(raw) {
      if (raw && typeof raw === 'object') {
        return {
          name: String(raw.name || ''),
          tag: String(raw.tag || ''),
          file: String(raw.file || raw.name || ''),
          size: Number(raw.size || 0),
          at: raw.at || (Number.isFinite(raw.ms) && raw.ms > 0 ? new Date(raw.ms).toISOString() : null),
        }
      }
      const name = String(raw || '')
      const parts = name.split('__')
      const ms = Number.parseInt(parts[0], 10)
      return {
        name,
        tag: parts[1] || '',
        file: parts.slice(2).join('__') || name,
        size: 0,
        at: Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null,
      }
    }

    function backupLabel(tag) {
      const key = `tag.${String(tag || '').toLowerCase()}`
      const text = t(key)
      return text === key ? String(tag || 'backup') : text
    }

    /**
     * Restore panel: its own surface (not an inline card) so the list is
     * readable — every snapshot carries its wall-clock time, kind and size, and
     * each row restores or deletes exactly that one file.
     */
    function RestoreModal({ onClose }) {
      const [data, setData] = useState(null)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const [notice, setNotice] = useState(null)
      const [opened, setOpened] = useState(() => new Set())
      const u = useUpdater()

      const toggleGroup = useCallback((file) => {
        setOpened((prev) => {
          const next = new Set(prev)
          if (next.has(file)) next.delete(file)
          else next.add(file)
          return next
        })
      }, [])

      const load = useCallback(async () => {
        setBusy(true)
        setError(null)
        try {
          const res = await apiPost({ action: 'backupList' })
          if (res && res.ok === false) throw new Error(res.error || 'failed')
          setData(res)
        } catch (e) {
          setError(String(e && e.message ? e.message : e))
        } finally {
          setBusy(false)
        }
      }, [])

      useEffect(() => {
        load()
      }, [load])

      useEffect(() => {
        const onKey = (ev) => {
          if (ev.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [onClose])

      const act = useCallback(
        async (action, args) => {
          setBusy(true)
          setNotice(null)
          try {
            const res = await apiPost({ action, ...(args || {}) })
            if (res && res.ok === false) throw new Error(res.error || 'failed')
            if (action === 'prune') {
              const removed = res && res.result && Array.isArray(res.result.removed) ? res.result.removed.length : 0
              setNotice(t('restore.prune.done').replace('{n}', String(removed)))
            } else if (action === 'deleteBackup') {
              setNotice(t('restore.deleted').replace('{name}', String(args && args.name)))
            } else if (action === 'restoreBackup') {
              setNotice(t('restore.restored').replace('{name}', String(args && args.name)))
            } else {
              setNotice(t('ok.done'))
            }
            await load()
            await u.load()
          } catch (e) {
            setError(String(e && e.message ? e.message : e))
          } finally {
            setBusy(false)
          }
        },
        [load, u],
      )

      const items = data && Array.isArray(data.items) ? data.items.map(normalizeBackup) : []

      // One group per card file. The list arrives sorted newest first, so a
      // group's own order is already right and its first entry is its latest.
      // Showing seventy-five rows flat meant the same card appeared over and
      // over, and the shape of what is actually stored was impossible to read.
      const groups = []
      const byFile = new Map()
      for (const item of items) {
        const key = item.file || item.name
        const found = byFile.get(key)
        if (found) {
          found.list.push(item)
        } else {
          const group = { file: key, list: [item], bytes: 0 }
          byFile.set(key, group)
          groups.push(group)
        }
      }
      for (const group of groups) {
        group.bytes = group.list.reduce((sum, it) => sum + (Number(it.size) || 0), 0)
      }

      return h(
        'div',
        {
          className: 'dcu-overlay',
          style: { zIndex: 130 },
          onClick: (ev) => {
            if (ev.target === ev.currentTarget) onClose()
          },
        },
        h(
          'div',
          { className: 'dcu-sheet', style: { maxWidth: 860, maxHeight: '80vh' } },
          h(
            'div',
            { className: 'dcu-sheet-head' },
            h('div', { className: 'dcu-title dcu-grow' }, t('restore.title')),
            h('button', { type: 'button', className: 'dcu-btn tiny', disabled: busy, onClick: load }, t('btn.reload')),
            h(
              'button',
              { type: 'button', className: 'dcu-btn tiny ghost', disabled: busy, onClick: () => act('prune') },
              t('restore.prune'),
            ),
            h('button', { type: 'button', className: 'dcu-btn tiny ghost', onClick: onClose }, t('btn.close')),
          ),
          h(
            'div',
            { className: 'dcu-sheet-body' },
            data
              ? h(
                  'div',
                  { className: 'dcu-sub' },
                  t('restore.count')
                    .replace('{n}', String(data.count || items.length))
                    .replace('{size}', formatSize(data.bytes)),
                )
              : null,
            data && data.dir ? h('div', { className: 'dcu-sub' }, `${t('restore.dir')}: ${data.dir}`) : null,
            notice ? h('div', { className: 'dcu-sub' }, '✓ ' + notice) : null,
            error ? h('div', { className: 'dcu-sub' }, '⚠ ' + error) : null,
            busy ? h('div', { className: 'dcu-sub' }, t('state.busy')) : null,
            !items.length && !busy ? h('div', { className: 'dcu-sub' }, t('restore.empty')) : null,
            groups.map((group) => {
              const isOpen = opened.has(group.file)
              return h(
                'div',
                { className: 'dcu-bk', key: group.file },
                h(
                  'div',
                  {
                    className: 'dcu-bk-head',
                    role: 'button',
                    tabIndex: 0,
                    onClick: () => toggleGroup(group.file),
                    onKeyDown: (ev) => {
                      if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault()
                        toggleGroup(group.file)
                      }
                    },
                  },
                  h('span', { className: 'dcu-bk-caret' }, isOpen ? '▾' : '▸'),
                  h('span', { className: 'dcu-bk-name dcu-grow' }, group.file),
                  h(
                    'span',
                    { className: 'dcu-sub' },
                    t('restore.group')
                      .replace('{n}', String(group.list.length))
                      .replace('{size}', formatSize(group.bytes)),
                  ),
                ),
                isOpen
                  ? h(
                      'div',
                      { className: 'dcu-bk-body' },
                      group.list.map((item) =>
                        h(
                          'div',
                          { className: 'dcu-bk-item', key: item.name },
                          h('span', { className: 'dcu-chip' }, backupLabel(item.tag)),
                          h(
                            'div',
                            { className: 'dcu-col dcu-grow' },
                            h(
                              'div',
                              { className: 'dcu-sub' },
                              `${item.at ? new Date(item.at).toLocaleString() : '—'} · ${formatSize(item.size)}`,
                            ),
                          ),
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'dcu-btn tiny primary',
                              disabled: busy,
                              onClick: () => act('restoreBackup', { name: item.name }),
                            },
                            t('btn.rollback'),
                          ),
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'dcu-btn tiny ghost',
                              disabled: busy,
                              onClick: () => act('deleteBackup', { name: item.name }),
                            },
                            t('btn.remove'),
                          ),
                        ),
                      ),
                    )
                  : null,
              )
            }),
          ),
        ),
      )
    }

    /**
     * Directory browser: the seat for picking a card file by hand when the
     * automatic pairing finds nothing. Reaches the host through the same
     * `/list` route, so it works in the browser too (no native dialog).
     */
    function BrowseModal({ initialPath, onPick, onClose }) {
      const [dir, setDir] = useState(null)
      const [entries, setEntries] = useState([])
      const [error, setError] = useState(null)
      const [loading, setLoading] = useState(true)
      const [opening, setOpening] = useState(false)

      const go = useCallback(async (target) => {
        setLoading(true)
        setError(null)
        try {
          const data = await listDir(target)
          setDir(data.dir || target || '')
          setEntries(Array.isArray(data.entries) ? data.entries : [])
          if (data.error) setError(data.error)
        } catch (e) {
          setError(String(e && e.message ? e.message : e))
          setEntries([])
        } finally {
          setLoading(false)
        }
      }, [])

      useEffect(() => {
        go(initialPath)
      }, [go, initialPath])

      useEffect(() => {
        const onKey = (ev) => {
          if (ev.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [onClose])

      const current = dir || ''
      const parent = current.replace(/[\\/][^\\/]*$/, '')

      /**
       * Hand the current folder to the system file manager. The in-panel browser
       * is fine for picking a file that is already here, but downloading, unzip
       * and rename happen outside it, so a way back out to Explorer belongs next
       * to the navigation rather than behind a separate trip.
       */
      const openInExplorer = useCallback(async (target) => {
        if (!target) return
        setOpening(true)
        try {
          await apiPost({ action: 'openFolder', path: target })
          setError('')
        } catch (e) {
          setError(String(e && e.message ? e.message : e))
        } finally {
          setOpening(false)
        }
      }, [])

      return h(
        'div',
        {
          className: 'dcu-overlay',
          style: { zIndex: 120 },
          onClick: (ev) => {
            if (ev.target === ev.currentTarget) onClose()
          },
        },
        h(
          'div',
          { className: 'dcu-sheet', style: { maxWidth: 720, maxHeight: '78vh' } },
          h(
            'div',
            { className: 'dcu-sheet-head' },
            h('div', { className: 'dcu-title dcu-grow' }, t('pick.title')),
            h(
              'button',
              { type: 'button', className: 'dcu-btn tiny', disabled: !parent, onClick: () => go(parent) },
              t('pick.up'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dcu-btn tiny',
                disabled: !current || opening,
                onClick: () => openInExplorer(current),
              },
              t('pick.explorer'),
            ),
            h(
              'button',
              { type: 'button', className: 'dcu-btn tiny ghost', onClick: () => go(null) },
              t('btn.reload'),
            ),
            h('button', { type: 'button', className: 'dcu-btn tiny ghost', onClick: onClose }, t('btn.close')),
          ),
          h(
            'div',
            { className: 'dcu-sheet-body' },
            h('div', { className: 'dcu-sub' }, current),
            error
              ? h(
                  'div',
                  { className: 'dcu-card flat' },
                  h('div', { className: 'dcu-sub' }, '⚠ ' + t('err.list') + '：' + error),
                )
              : null,
            loading
              ? h('div', { className: 'dcu-sub' }, t('state.busy'))
              : entries.length
                ? entries.map((item, idx) =>
                    h(
                      'div',
                      { className: 'dcu-row', key: item.path || idx, style: { padding: '2px 0' } },
                      h(
                        'span',
                        { className: 'dcu-chip' },
                        item.type === 'directory' ? t('pick.dir') : t('pick.file'),
                      ),
                      h(
                        'span',
                        {
                          className: 'dcu-sub dcu-grow',
                          style: { cursor: item.type === 'directory' ? 'pointer' : 'default' },
                          onClick: () => {
                            if (item.type === 'directory') go(item.path)
                          },
                        },
                        item.name,
                      ),
                      item.type === 'directory'
                        ? h(
                            'button',
                            { type: 'button', className: 'dcu-btn tiny ghost', onClick: () => go(item.path) },
                            t('pick.dir'),
                          )
                        : h(
                            'button',
                            {
                              type: 'button',
                              className: 'dcu-btn tiny primary',
                              onClick: () => {
                                onPick(item.path)
                                onClose()
                              },
                            },
                            t('pick.choose'),
                          ),
                    ),
                  )
                : h('div', { className: 'dcu-sub' }, t('pick.empty')),
          ),
        ),
      )
    }

    function SettingsTab({ cfg, setCfg }) {
      const [open, setOpen] = useState(null)
      const [verify, setVerify] = useState(null)
      const [checking, setChecking] = useState(false)

      /**
       * Ask the index backend whether the pasted session is still good, before
       * it is relied on. A silent bad token would surface much later as every
       * thread link failing at once, which reads like a broken plugin rather
       * than an expired session. The config is written first: a token that
       * checks out but is never saved vanishes the moment the panel closes,
       * which is exactly what makes this feel like it must be redone every time.
       */
      const verifyToken = useCallback(
        async (token) => {
          setChecking(true)
          try {
            await apiPost({ action: 'save', config: { ...cfg, indexToken: token } })
            setVerify(describeVerify(await apiPost({ action: 'verifyIndex', token })))
          } catch (e) {
            setVerify({ kind: 'bad', text: String(e && e.message ? e.message : e), renew: false })
          } finally {
            setChecking(false)
          }
        },
        [cfg],
      )

      // Re-check the stored token when the panel opens, so the badge shows the
      // live state instead of whatever the previous visit happened to leave.
      // This is also how an expired token announces itself, with nothing to press.
      useEffect(() => {
        const stored = String((cfg && cfg.indexToken) || '').trim()
        if (!stored) return undefined
        let alive = true
        apiPost({ action: 'verifyIndex', token: stored })
          .then((res) => {
            if (alive) setVerify(describeVerify(res))
          })
          .catch(() => {})
        return () => {
          alive = false
        }
        // Runs once per mount on purpose: the value is read from config, and a
        // dependency on it would re-verify on every keystroke in the field.
      }, [])
      const pick = (key, label, desc, long) => {
        const on = (cfg.mergeStrategy || 'standard') === key
        const expanded = open === key
        return h(
          'div',
          {
            key,
            className: 'dcu-card',
            style: {
              textAlign: 'left',
              background: 'var(--dsw-alias-bg-layer-2)',
              borderColor: on ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l1)',
            },
          },
          h(
            'div',
            { className: 'dcu-row' },
            h(
              'button',
              {
                type: 'button',
                className: 'dcu-btn ghost',
                style: {
                  flex: '1 1 auto',
                  height: 'auto',
                  padding: '2px 0',
                  border: '0 none',
                  background: 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  textAlign: 'left',
                  cursor: 'pointer',
                },
                onClick: () => setCfg({ ...cfg, mergeStrategy: key }),
              },
              h('span', { className: 'dcu-chip' + (on ? ' ok' : '') }, on ? '●' : '○'),
              h('span', { className: 'dcu-title' }, label),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dcu-btn tiny ghost',
                style: { flex: 'none' },
                onClick: () => setOpen(expanded ? null : key),
              },
              expanded ? `${t('strategy.more')} ▲` : `${t('strategy.detail')} ▼`,
            ),
          ),
          h('div', { className: 'dcu-sub' }, desc),
          expanded ? h('div', { className: 'dcu-sub', style: { whiteSpace: 'pre-wrap' } }, long) : null,
        )
      }
      const flag = (key, label, desc, def) => {
        const val = cfg[key] !== undefined ? !!cfg[key] : !!def
        return h(
          'label',
          { className: 'dcu-row', style: { gap: 8, cursor: 'pointer' } },
          h('input', {
            type: 'checkbox',
            checked: val,
            onChange: (ev) => setCfg({ ...cfg, [key]: ev.target.checked }),
          }),
          h('div', { className: 'dcu-col' }, h('div', null, label), h('div', { className: 'dcu-sub' }, desc)),
        )
      }
      return h(
        'div',
        { className: 'dcu-card' },
        h('div', { className: 'dcu-title' }, t('strategy.title')),
        h('div', { className: 'dcu-sub' }, t('strategy.desc')),
        pick('minimal', t('strategy.minimal'), t('strategy.minimal.d'), t('strategy.minimal.long')),
        pick('standard', t('strategy.standard'), t('strategy.standard.d'), t('strategy.standard.long')),
        pick('full', t('strategy.full'), t('strategy.full.d'), t('strategy.full.long')),
        h(
          'div',
          {
            className: 'dcu-card flat',
            style: { borderColor: 'var(--dsw-alias-brand-primary)' },
          },
          h('div', { className: 'dcu-sub' }, t('strategy.advice')),
        ),
        h(
          'div',
          { className: 'dcu-card flat' },
          flag('syncPlain', t('flag.syncPlain'), t('flag.syncPlain.d'), false),
          flag('autoBumpVersion', t('flag.autoBump'), t('flag.autoBump.d'), true),
        ),
        h(
          'div',
          { className: 'dcu-card flat' },
          h('div', { className: 'dcu-title', style: { fontSize: 13 } }, t('index.title')),
          h('div', { className: 'dcu-sub' }, t('index.desc')),
          h(
            'div',
            { className: 'dcu-row', style: { gap: 6, flexWrap: 'nowrap' } },
            h('input', {
              className: 'dcu-input',
              type: 'password',
              placeholder: t('index.placeholder'),
              value: cfg.indexToken || '',
              onChange: (ev) => setCfg({ ...cfg, indexToken: ev.target.value }),
            }),
            h(
              'button',
              {
                type: 'button',
                className: 'dcu-btn tiny',
                style: { flex: 'none' },
                onClick: () => verifyToken(cfg.indexToken || ''),
              },
              t('index.verify'),
            ),
          ),
          h('div', { className: 'dcu-sub' }, t('index.howto')),
          h('div', { className: 'dcu-sub' }, t('index.netHint')),
          verify
            ? h(
                'div',
                { className: 'dcu-row' },
                h('span', { className: chipClass(verify.kind) }, verify.text),
                // The site is the only place a new token can be had, so the badge
                // that reports a dead one also offers the way to replace it.
                verify.renew
                  ? h(
                      'button',
                      { type: 'button', className: 'dcu-btn tiny ghost', onClick: () => openExternal(INDEX_LOGIN) },
                      t('index.renew'),
                    )
                  : null,
              )
            : null,
          checking ? h('div', { className: 'dcu-sub' }, t('index.checking')) : null,
        ),
        h(
          'div',
          { className: 'dcu-row' },
          h('label', { className: 'dcu-sub' }, t('hint.interval')),
          h('input', {
            className: 'dcu-input',
            style: { maxWidth: 120 },
            type: 'number',
            min: 0,
            value: cfg.autoCheckMinutes === undefined ? 0 : cfg.autoCheckMinutes,
            onChange: (ev) =>
              setCfg({ ...cfg, autoCheckMinutes: Math.max(0, Number.parseInt(ev.target.value, 10) || 0) }),
          }),
        ),
      )
    }

    function Panel({ onClose }) {
      useStyles()
      const u = useUpdater()
      const [draft, setDraft] = useState(null)
      const [tab, setTab] = useState('cards')
      const [restore, setRestore] = useState(false)
      const [browse, setBrowse] = useState(null)
      const [query, setQuery] = useState('')
      const [filter, setFilter] = useState('all')
      const [sort, setSort] = useState('auto')
      const [notice, setNotice] = useState('')

      /**
       * Whether the card agent is working on any card right now.
       *
       * Writing to a card while the agent holds it would race: the agent keeps its
       * own copy and writes it back when it is done, so an edit made here would
       * either be overwritten or overwrite the agent's work. Nothing that touches a
       * card file is allowed to start while this is true.
       */
      const anyDebugging = Object.values((u.data && u.data.workspace && u.data.workspace.cards) || {}).some(
        (row) => row && row.busy,
      )

      /** Refuse a card-writing action while the agent is busy, with a reason. */
      const blockedByDebug = useCallback(() => {
        if (!anyDebugging) return false
        setNotice(t('debug.locked'))
        return true
      }, [anyDebugging])
      const [upd, setUpdate] = useState(updateMemo)
      const setUpd = useCallback((next) => {
        updateMemo = next
        setUpdate(next)
      }, [])

      /**
       * Ask the host half which version GitHub is publishing. Automatic runs ride
       * the host's two-minute cache; the button forces a fresh answer, so a click
       * is never answered out of the cache.
       */
      const checkUpdate = useCallback(
        async (force) => {
          setUpd({ status: 'busy' })
          try {
            const res = await apiPost({ action: 'checkUpdate', force: !!force }, 30000)
            if (!res || res.ok === false) {
              setUpd({
                status: 'failed',
                error: (res && res.error) || 'failed',
                network: !!(res && res.networkError),
              })
              return
            }
            if (res.hasUpdate) {
              setUpd({ status: 'available', latest: res.latest, current: res.current, url: res.url })
            } else if (res.noRelease) {
              setUpd({ status: 'nodata', current: res.current, url: res.url })
            } else {
              setUpd({ status: 'latest', current: res.current })
            }
          } catch (e) {
            setUpd({ status: 'failed', error: String(e && e.message ? e.message : e) })
          }
        },
        [setUpd],
      )

      // Every open asks again, so the verdict on screen was asked for in this
      // visit rather than inherited from an old one. The two-minute cache in the
      // host half absorbs repeated opens without spending the GitHub quota.
      useEffect(() => {
        checkUpdate(false)
      }, [checkUpdate])

      const onUpdateClick = useCallback(() => {
        // A verdict that names a newer version, or a repository with nothing to
        // compare against, both end in the same place: the page where the update
        // actually lives.
        if (upd.status === 'available' || upd.status === 'nodata') {
          openExternal(upd.url || REPO_URL)
          return
        }
        // A press is an explicit request for a fresh answer, so it skips the cache
        // the automatic runs are happy to take.
        checkUpdate(true)
      }, [upd, checkUpdate])

      // The installed version, read from the host half rather than from the last
      // check, so the label is there the moment the panel opens and moves by
      // itself once a `git pull` plus a restart lands a new number.
      const installed = String((u.data && u.data.version) || upd.current || '').trim()
      const versionLabel = installed ? withV(installed) : ''

      // `cfg` is the draft while the user has edits in flight, and the host's
      // config the rest of the time. Nothing is copied into a draft on arrival:
      // doing that pinned the panel to a snapshot, and since the host half writes
      // check results, merge records and baselines into that same config, the
      // snapshot went stale the moment anything ran. The old verdict then stayed
      // on screen until the panel was closed and reopened.
      const cfg = draft || (u.data ? u.data.config : null)
      const dirty = !!(draft && u.data && JSON.stringify(draft) !== JSON.stringify(u.data.config))
      const report = u.data ? u.data.lastReport : null
      // Cards carrying news lead the list: a check that found an update should not
      // leave it buried under everything that stayed put. Array.sort is stable, so
      // cards of equal standing keep the order they were already in, and an
      // untouched panel looks exactly as the config lists it.
      // Ranking. The default puts cards carrying news first and cards the workspace
      // has never opened next. Choosing a sort in the toolbar replaces both: an
      // order the user picked is the one they are looking for, and re-imposing the
      // automatic ranking on top of it would fight the choice they just made.
      const cardRank = (entry) => {
        if (statusOf(entry, report).kind === 'warn') return 0
        return needsDebug(entry, u.data) ? 1 : 2
      }
      const allCards = (cfg && cfg.cards) || []
      const needle = query.trim().toLowerCase()
      const cards = allCards
        .filter((entry) => {
          if (needle) {
            const hay = [entry.label, entry.primary && entry.primary.match, entry.plain && entry.plain.path, entry.mvu && entry.mvu.path]
              .filter(Boolean)
              .join(' ')
              .toLowerCase()
            if (!hay.includes(needle)) return false
          }
          // These two are about which files are wired up, not about which cards
          // exist: "only original" means no MVU copy is paired with it.
          if (filter === 'plain') return !String((entry.mvu && entry.mvu.path) || '').trim()
          if (filter === 'mvu') return !String((entry.plain && entry.plain.path) || '').trim()
          return true
        })
        .sort((a, b) => {
          if (sort === 'imported') {
            const ka = String(a.importedAt || a.updatedAt || '')
            const kb = String(b.importedAt || b.updatedAt || '')
            return kb.localeCompare(ka)
          }
          if (sort === 'name') return String(a.label || a.id).localeCompare(String(b.label || b.id), 'zh')
          return cardRank(a) - cardRank(b)
        })

      const patch = useCallback(
        (id, key, value) =>
          setDraft((prev) => patchEntry(prev || (u.data ? u.data.config : { cards: [] }), id, key, value)),
        [u.data],
      )

      const save = useCallback(async () => {
        // The host writes into the same config this draft was copied from, so its
        // fields are re-taken from the latest state before writing back. Without
        // that, saving an unrelated edit would quietly undo the last check.
        const base = u.data && u.data.config
        const payload = base ? mergeHostState(draft, base) : draft
        const res = await u.run('save', { config: payload }, t('ok.saved'))
        // Drop the draft only when the write actually landed. Clearing it on a
        // failed save would throw away the very edits that failed to store, with
        // nothing on screen left to retry from.
        if (res && res.ok !== false) setDraft(null)
      }, [draft, u])

      const doCheck = useCallback(
        // A single-card check reports on its own row; "check all" reports at the
        // top of the panel, where it belongs to no card in particular.
        (ids) =>
          u.run(
            'check',
            { ids: ids || null },
            t('ok.check'),
            Array.isArray(ids) && ids.length === 1 ? ids[0] : null,
          ),
        [u],
      )
      // Every card-writing action goes through the same guard: the card agent holds
      // the card it is working on, so an edit from here would race with it.
      const guarded = useCallback(
        (id, action, okText) => {
          if (blockedByDebug()) return undefined
          return u.run(action, { cardId: id }, okText, id)
        },
        [blockedByDebug, u],
      )
      const doMerge = useCallback((id) => guarded(id, 'merge', t('ok.merge')), [guarded])
      const doUpdateMerge = useCallback((id) => guarded(id, 'updateAndMerge', t('ok.updateMerge')), [guarded])

      /**
       * Open the workspace's debug conversation for a card, through the play
       * conversation that card belongs to. Reported in the log rather than on a
       * card row: what it opens is a conversation elsewhere, not a change here.
       */
      const openDebug = useCallback(
        async (sessionId) => {
          if (!sessionId) return
          try {
            await openCardDebug(sessionId)
            u.push(t('debug.opened'), 'ok')
          } catch (e) {
            u.push(`${t('debug.failed')}：${e && e.message ? e.message : e}`, 'bad')
          }
        },
        [u],
      )

      const rescan = useCallback(async () => {
        // `suggest` writes the rescan to disk itself, so there is nothing worth
        // keeping in a draft: reloading leaves the view reading the host's config
        // directly, which is also what lets a later check show up immediately.
        const res = await apiPost({ action: 'suggest' })
        if (res && res.ok && res.config) {
          setDraft(null)
          await u.load()
          u.push(t('btn.rescan'), 'ok')
        } else if (res && res.error) {
          u.push(res.error, 'bad')
        }
      }, [u])

      const pickFile = useCallback(
        (entryId, key) => {
          setBrowse({ id: entryId, key })
        },
        [],
      )

      const applyPick = useCallback(
        (path) => {
          const req = browse
          if (!req) return
          setBrowse(null)
          // Import and plain path-picking share one browser; the difference is
          // what happens to the chosen file afterwards.
          if (req.mode === 'import') {
            if (blockedByDebug()) return
            u.run('importPlain', { cardId: req.id, from: path }, t('ok.imported'), req.id)
            return
          }
          patch(req.id, req.key, path)
          // Derive a usable source: a local path becomes a copy source.
          patch(req.id, req.key === 'plain.path' ? 'plain.srcText' : 'mvu.srcText', path)
        },
        [blockedByDebug, browse, patch, u],
      )

      const doManualBackup = useCallback(
        async function () {
          if (blockedByDebug()) return
          await u.run('manualBackup', {}, t('ok.manualBackup'))
        },
        [blockedByDebug, u],
      )

      /** Open the file browser in import mode for one card's original. */
      const pickImport = useCallback((entryId) => {
        setBrowse({ id: entryId, key: 'import', mode: 'import' })
      }, [])

      const addEntry = useCallback(() => {
        setDraft((prev) => {
          // Start from the host's config when there is no draft yet: an empty
          // base would be a config that has lost every existing card.
          const base = prev || (u.data && u.data.config) || { cards: [] }
          const next = JSON.parse(JSON.stringify(base))
          next.cards = [
            ...(next.cards || []),
            {
              id: `card-${Date.now()}`,
              label: '新条目',
              enabled: true,
              syncPlain: false,
              plain: { path: '', src: { kind: 'url', url: '' }, sig: null },
              mvu: { path: '', src: { kind: 'url', url: '' }, sig: null },
              primary: { url: '', match: '', gates: [], feedSeen: [] },
            },
          ]
          return next
        })
      }, [u.data])

      /**
       * Re-read the host's state and drop any local draft.
       *
       * Every host action already reloads when it finishes, so this is the way
       * out for the two cases that leaves: something outside the panel wrote to
       * the config, or a view still looks like it is showing old news.
       */
      const reload = useCallback(async () => {
        setDraft(null)
        await u.load()
        u.push(t('btn.reload'), 'ok')
      }, [u])

      /**
       * Deleting a card is the one edit that reads as immediate: leaving it in
       * the draft made it vanish from the list while the entry was still in the
       * config, so it reappeared on the next load and looked like a failed
       * delete. It is written through straight away.
       */
      const removeEntry = useCallback(
        async (id) => {
          const base = draft || (u.data ? u.data.config : { cards: [] })
          const next = JSON.parse(JSON.stringify(base))
          next.cards = (next.cards || []).filter((c) => c.id !== id)
          setDraft(next)
          await u.run('save', { config: next }, t('ok.removed'))
        },
        [draft, u],
      )

      // Without Tavern there is nothing here to manage: every card, every debug
      // record and every merge target comes from it. Saying so beats an empty
      // list, which reads like a broken plugin rather than a missing companion.
      const tavern = u.data && u.data.tavern
      if (tavern && !tavern.installed) {
        return h(
          'div',
          { className: 'dcu-root' },
          h(
            'div',
            { className: 'dcu-wrap' },
            h(
              'div',
              { className: 'dcu-card' },
              h('div', { className: 'dcu-title', style: { fontSize: 13 } }, t('tavern.missing.title')),
              h('div', { className: 'dcu-sub' }, t('tavern.missing.desc')),
              h(
                'div',
                { className: 'dcu-row' },
                h(
                  'button',
                  { type: 'button', className: 'dcu-btn tiny', onClick: () => openExternal(tavern.url) },
                  t('tavern.missing.open'),
                ),
              ),
            ),
          ),
        )
      }

      return h(
        'div',
        { className: 'dcu-root' },
        h(
          'div',
          { className: 'dcu-wrap' },
          // Header: what this panel is, and the two things you would actually do
          // at the top level. Everything else is secondary and lives in the bar
          // below, instead of trailing after the title in one long run.
          h(
            'div',
            { className: 'dcu-header' },
            h(
              'div',
              { className: 'dcu-col dcu-grow' },
              h('div', { className: 'dcu-title' }, t('panel.title')),
              h('div', { className: 'dcu-sub' }, t('panel.desc')),
              h('div', { className: 'dcu-path' }, (u.data && u.data.cardDir) || '—'),
            ),
            h(
              'div',
              { className: 'dcu-header-actions' },
              // The plugin's own version block leads the header: the number this
              // copy is running and whether it is current, neither of which is
              // about the cards below. A separator keeps the two kinds of action
              // from reading as one row of buttons.
              versionLabel
                ? h(
                    'span',
                    { className: 'dcu-chip dcu-ver', title: t('upd.version').replace('{v}', versionLabel) },
                    versionLabel,
                  )
                : null,
              h(
                'button',
                {
                  type: 'button',
                  className:
                    'dcu-btn' +
                    (upd.status === 'available'
                      ? ' primary'
                      : upd.status === 'latest'
                        ? ' ok'
                        : upd.status === 'failed'
                          ? ' bad'
                          : ''),
                  disabled: upd.status === 'busy',
                  title: updateTip(upd),
                  onClick: onUpdateClick,
                },
                updateLabel(upd),
              ),
              h('div', { className: 'dcu-bar-sep' }),
              h(
                'button',
                { type: 'button', className: 'dcu-btn primary', disabled: u.busy, onClick: () => doCheck(null) },
                u.busy ? t('state.busy') : t('btn.checkAll'),
              ),
              h(
                'button',
                { type: 'button', className: 'dcu-btn', disabled: u.busy || !dirty, onClick: save },
                t('btn.save'),
              ),
              onClose
                ? h('button', { type: 'button', className: 'dcu-btn ghost', onClick: onClose }, t('btn.close'))
                : null,
            ),
          ),
          notice
            ? h(
                'div',
                { className: 'dcu-card flat', style: { borderColor: 'var(--dsw-alias-state-warn-primary)' } },
                h(
                  'div',
                  { className: 'dcu-row' },
                  h('div', { className: 'dcu-sub dcu-grow' }, '⚠ ' + notice),
                  h('button', { type: 'button', className: 'dcu-btn tiny ghost', onClick: () => setNotice('') }, t('btn.close')),
                ),
              )
            : null,
          u.message && !u.message.cardId
            ? h(
                'div',
                { className: 'dcu-card flat' },
                h('div', { className: 'dcu-sub' }, (u.message.kind === 'bad' ? '⚠ ' : '✓ ') + u.message.text),
                u.message.hint ? h('div', { className: 'dcu-sub' }, u.message.hint) : null,
              )
            : null,
          // One bar groups the views with the controls that act on the current
          // view, on a shared background so the two are told apart by grouping
          // rather than by having to read every label.
          h(
            'div',
            { className: 'dcu-bar' },
            h(
              'div',
              { className: 'dcu-tabs' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dcu-tab' + (tab === 'cards' ? ' on' : ''),
                  onClick: () => setTab('cards'),
                },
                t('tab.cards'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dcu-tab' + (tab === 'settings' ? ' on' : ''),
                  onClick: () => setTab('settings'),
                },
                t('tab.settings'),
              ),
            ),
            h('div', { className: 'dcu-bar-sep' }),
            h(
              'button',
              {
                type: 'button',
                className: 'dcu-chip' + (tab === 'settings' ? '' : ' warn'),
                style: { cursor: 'pointer', background: 'transparent', font: 'inherit', flex: 'none' },
                title: t('strategy.title'),
                onClick: () => setTab('settings'),
              },
              t('strategy.now').replace('{name}', strategyShort(cfg)),
            ),
            h('div', { className: 'dcu-grow' }),
            h(
              'button',
              { type: 'button', className: 'dcu-btn tiny ghost', disabled: u.busy, onClick: doManualBackup },
              t('btn.manualBackup'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dcu-btn tiny ghost',
                disabled: u.busy,
                onClick: () => {
                  if (!blockedByDebug()) setRestore(true)
                },
              },
              t('btn.restorePanel'),
            ),
            h('div', { className: 'dcu-bar-sep' }),
            h(
              'button',
              { type: 'button', className: 'dcu-btn tiny ghost', disabled: u.busy, onClick: rescan },
              t('btn.rescan'),
            ),
            h('button', { type: 'button', className: 'dcu-btn tiny ghost', disabled: u.busy, onClick: addEntry }, t('btn.add')),
            h(
              'button',
              {
                type: 'button',
                className: 'dcu-btn tiny ghost',
                disabled: u.busy,
                title: t('btn.reload.hint'),
                onClick: reload,
              },
              t('btn.reload'),
            ),
          ),
          // Search and filtering sit below the view bar: they act on the card list
          // rather than on the panel, and only a long collection needs them.
          tab === 'cards'
            ? h(
                'div',
                { className: 'dcu-tools' },
                h('input', {
                  className: 'dcu-input',
                  style: { maxWidth: 280 },
                  type: 'search',
                  placeholder: t('tools.search'),
                  value: query,
                  onChange: (ev) => setQuery(ev.target.value),
                }),
                h('div', { className: 'dcu-bar-sep' }),
                h(
                  'select',
                  { className: 'dcu-select', value: filter, onChange: (ev) => setFilter(ev.target.value) },
                  h('option', { value: 'all' }, t('tools.all')),
                  h('option', { value: 'plain' }, t('tools.plainOnly')),
                  h('option', { value: 'mvu' }, t('tools.mvuOnly')),
                ),
                h(
                  'select',
                  { className: 'dcu-select', value: sort, onChange: (ev) => setSort(ev.target.value) },
                  h('option', { value: 'auto' }, t('tools.sortAuto')),
                  h('option', { value: 'imported' }, t('tools.sortImported')),
                  h('option', { value: 'name' }, t('tools.sortName')),
                ),
                h('div', { className: 'dcu-grow' }),
                h(
                  'span',
                  { className: 'dcu-sub' },
                  t('tools.count').replace('{shown}', cards.length).replace('{total}', allCards.length),
                ),
              )
            : null,
          tab === 'settings' ? h(SettingsTab, { cfg, setCfg: setDraft }) : null,
          tab === 'cards' && !cards.length
            ? h(
                'div',
                { className: 'dcu-card' },
                h('div', { className: 'dcu-sub' }, allCards.length ? t('tools.empty') : t('empty')),
              )
            : null,
          tab === 'cards'
            ? cards.map((entry) =>
                h(EntryCard, {
                  key: entry.id,
                  entry,
                  u,
                  patch,
                  onPick: (key) => pickFile(entry.id, key),
                  onCheck: doCheck,
                  onImportNew: pickImport,
                  onMerge: doMerge,
                  onUpdateMerge: doUpdateMerge,
                  onDebug: openDebug,
                  onRemove: removeEntry,
                }),
              )
            : null,
          u.log.length
            ? h(
                'div',
                { className: 'dcu-card flat' },
                h('div', { className: 'dcu-sub' }, t('log.title')),
                h('div', { className: 'dcu-log' }, u.log.map((l) => `${l.t}  ${l.text}`).join('\n')),
              )
            : null,
          browse
            ? h(BrowseModal, {
                initialPath:
                  (browse.key === 'plain.path'
                    ? browseEntryPath(cards, browse.id, 'plain.path')
                    : browseEntryPath(cards, browse.id, 'mvu.path')) ||
                  (u.data && u.data.cardDir) ||
                  null,
                onPick: applyPick,
                onClose: () => setBrowse(null),
              })
            : null,
          restore ? h(RestoreModal, { onClose: () => setRestore(false) }) : null,
        ),
      )
    }

    /** Refresh glyph for the sidebar-foot entry. */
    function UpdateGlyph({ size = 16 }) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', {
          d: 'M13.4 8a5.4 5.4 0 1 1-1.59-3.82',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
        }),
        h('path', {
          d: 'M13.6 2.6v3.1h-3.1',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    /**
     * Sidebar-foot entry for the card updater.
     *
     * Registered straight into `sidebar.footer.action`, so the sidebar shell
     * owns every bit of the geometry: it passes `wide`, centres the seat, and
     * sizes the column. The entry only has to be a row when `wide` and an icon
     * when not. No cloned shipped rows, no DOM measurement, no inline geometry
     * — an earlier revision did all three and dragged the whole foot out of
     * alignment, which is exactly what this shape avoids.
     *
     * The panel opens as an overlay from here; the same panel is also reachable
     * through Settings → Card Updater.
     */
    function SideEntry(props) {
      // While the panel is shut this entry is the only thing this half renders,
      // so it has to bring the stylesheet with it. Without this call the button
      // falls back to browser defaults: a border, a grey fill, centred text and
      // no full width — which is exactly how a first pass mis-rendered.
      useStyles()

      const isWide = !props || props.wide !== false
      const [open, setOpen] = useState(false)

      useEffect(() => {
        if (!open) return undefined
        const onKey = (ev) => {
          if (ev.key === 'Escape') setOpen(false)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [open])

      const label = t('entry.title')

      // A fragment keeps the entry to a single child, so the seat's flex
      // container sees exactly one cell and the shell stays in charge of flow.
      return h(
        Fragment,
        null,
        h(
          'button',
          {
            type: 'button',
            className: 'dcu-entry',
            'data-wide': isWide ? 'true' : 'false',
            'aria-label': label,
            'aria-haspopup': 'dialog',
            'aria-expanded': open,
            title: isWide ? undefined : label,
            onClick: () => setOpen(true),
          },
          h(UpdateGlyph, { size: isWide ? 16 : 18 }),
          isWide ? h('span', { className: 'dcu-entry-label' }, label) : null,
        ),
        open
          ? h(
              'div',
              {
                className: 'dcu-overlay',
                onClick: (ev) => {
                  if (ev.target === ev.currentTarget) setOpen(false)
                },
              },
              h(
                'div',
                { className: 'dcu-sheet' },
                h(
                  'div',
                  { className: 'dcu-sheet-head' },
                  h('div', { className: 'dcu-title dcu-grow' }, t('panel.title')),
                  h(
                    'button',
                    { type: 'button', className: 'dcu-btn tiny ghost', onClick: () => setOpen(false) },
                    t('btn.close'),
                  ),
                ),
                h('div', { className: 'dcu-sheet-body' }, h(Panel, null)),
              ),
            )
          : null,
      )
    }

    function SettingsSection() {
      return h(Panel, null)
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-card-updater: dictionary')
      const bound = ctx.locale.bind(NS)
      translate = (key) => {
        try {
          return bound(key)
        } catch {
          return key
        }
      }

      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'card-updater',
            order: 45,
            label: () => t('nav'),
            locale: NS,
          },
          SettingsSection,
        ),
      )

      // The sidebar-foot seat. `inject` hands the row the translator so its
      // label resolves even while the dictionary re-binds, mirroring how the
      // shipped rows are wired.
      ctx.slots.inject('sidebar.footer.action', () =>
        ctx.slots.register(
          {
            name: 'sidebar.footer.action',
            id: 'card-updater',
            order: 12,
            label: () => t('entry.title'),
            locale: NS,
            inject: () => ({ t }),
          },
          SideEntry,
        ),
      )
    }

    return { name: 'dsh-card-updater', inject: ['slots', 'locale'], apply }
  },
})
