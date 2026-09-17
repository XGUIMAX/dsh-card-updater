# dsh-card-updater

**DSH Tavern 的卡片更新器：盯住作者发布页，发现新版就提醒你。**

人物卡更新了没有、更新到哪个版本、新版要不要密码或权限才能拿，这些原本要自己隔三差五去社区翻一遍。这个插件把这件事变成点一次按钮：配好每张卡的发布链接，之后检测、比对、合并都交给它。

<p>
  <img alt="license" src="https://img.shields.io/badge/license-MIT-blue">
  <img alt="platform" src="https://img.shields.io/badge/platform-DSH%20Tavern-6f42c1">
  <img alt="deps" src="https://img.shields.io/badge/dependencies-none-brightgreen">
</p>

## 可以做什么

- **检测新版**：为每张卡配一个发布链接，插件抓取页面或社区贴，比对版本标记与内容签名，判断作者是否发布了新版。支持 `版本 1.2`、`beta0.5.5`、`【9.14更新 …】` 等多种写法。
- **认得出下载条件**：作者把下载藏在密码、权限、回复可见或赞助后面时，检测结果会一并标出来，不会让你以为点一下就能拿到。
- **自己找原贴**：只填卡名也能工作。插件会用卡片自己的名字去社区索引站搜索，把找到的原贴链接自动填进来。
- **导入新版**：下载好的新卡文件选进来，自动备份旧卡、写入新内容、记录导入时间。
- **合并进 MVU 版**：把原版卡的新内容同步进 MVU 版，**永不覆盖** MVU 的状态栏脚本、变量定义与 `tavern_helper`。
- **备份与还原**：每次写入前自动备份，按卡片分组查看，随时回滚到任意一份。

## 界面

侧栏底部与「插件市场 / 设置」同排的入口，宽侧栏显示图标加文字，收成窄轨道时显示为图标按钮。同一套面板也在「设置 → 卡片更新器」下。

<img width="1150" height="406" alt="jiemian" src="https://github.com/user-attachments/assets/154c1155-2297-44f5-b8d7-cef9ad6af9d4" />


## 合并策略

| 档位 | 行为 |
| --- | --- |
| **内容字段** | 只同步 `name` / `description` / `personality` / `scenario` / `first_mes` / `mes_example` / `system_prompt` / `post_history_instructions` / `creator_notes` / `alternate_greetings` / `tags` 等正文字段 |
| **内容字段 + 世界书** | 额外按条目合并 `character_book`：原版新增的写进去，内容一致的按原版更新，**本地改过的保留并报告冲突** |
| **内容字段 + 世界书 + 原版脚本** | 再补上「只在原版存在」的正则脚本；MVU 版已有的同名脚本原样保留 |

三个档位都**不会**触碰 MVU 的状态栏脚本、变量定义和 `tavern_helper`。

另有两个开关：合并结果是否写回原版卡、是否自动递增 `character_version`。

## 安装

### 前置条件

已经在用的 DSH，且有一个 Tavern profile（本说明中默认叫 `tavern`）。插件是 DSH 插件，不是独立程序。

### 安装步骤

1. 把本项目放到任意目录，例如 `~/.dsh/plugins/dsh-card-updater`。
2. 打开 DSH 终端（**设置 → 通用设置 → 打开 DSH 终端**），`cd` 到该目录，执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

装到别的 profile 时加参数：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Profile web
```

> 命令用 `powershell` 而不是 `pwsh`：Windows 自带的是 Windows PowerShell 5.1，很多机器上并没有安装 PowerShell 7。脚本两个版本都能跑。加 `-ExecutionPolicy Bypass` 是因为默认执行策略通常禁止直接运行 `.ps1`。

3. 脚本做三件事：把插件以 `link:` 形式写进 profile 的 `dependencies`、把 `dsh-card-updater` 追加到 `dsh.profile.bundles`、在 profile 目录执行 `pnpm install`。**改动前会把 profile 的 `package.json` 备份成 `package.json.pre-card-updater-<时间戳>`。**
4. **重启 DSH。** 侧栏底部出现「卡片更新器」即装好。

### 卸载

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1                 # 摘除插件，保留卡片数据
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -PurgeData      # 连数据目录一起删除
```

同样先备份 `package.json`，再从 `dependencies` 与 `dsh.profile.bundles` 移除条目并 `pnpm install`。重启 DSH 后入口消失。

需要手工回退时：把备份的 `package.json` 覆盖回去，在 profile 目录执行 `pnpm install`，重启 DSH。

## 首次配置

### 1. 填卡片

打开面板，「重新扫描卡片目录」会按**卡片自己声明的名字**把原版卡与 MVU 版配对。文件名怎么改都不影响。

配对结果会写在卡片副标题上，例如 `MVU 版：姬侠传v0.5.6 MVU版本.json`。三对都通过卡内名称匹配，测试的 8 张卡里 7 对全部命中。

### 2. 填主要链接

「主要链接」就是卡在社区的发布贴或发布页。Discord 贴子直接贴链接即可：

```
https://discord.com/channels/服务器ID/贴子ID
```

只填卡名也行：检测时会用卡片自己的 `name` 字段去索引站搜索，标题匹配上就自动填进来。

如果一张卡的更新记录在作者的作品集总页里（一页多卡），把定位这张卡的文字填进「版本关键词」，否则抓到的是整页最大的版本号。

### 3. 索引站授权

社区索引站的贴子需要登录才能读取。在索引站页面按 F12 打开控制台，执行：

```js
localStorage.getItem("auth_token")
```

把返回值（不含引号）粘到「合并设置 → 索引站授权」，点「验证」。

令牌只保存在本机 `config.json`，且只发送给 `forum.shimmerday.top` 一个域名。

> **连不上时先看这里。** 插件运行在 Node 进程里，**不读取系统代理设置**，而浏览器会读。所以「浏览器能打开 Discord、插件报连不上」是常见组合。把代理切换到 **TUN 模式** 让流量在网卡层被接管即可。插件会区分「连不上」和「链接写错了」，只在真正是网络问题时才提示这一条。

## 日常使用

```
检测 → 有新版 → 下载新卡 → 导入新版 → 合并到 MVU
```

**检测**：卡片上的「检测」只查这一张，「检测全部」查所有启用的卡。

**导入新版**：从社区拿到新卡文件后，点「导入新版」选中它。插件会先解析确认那确实是一张人物卡，通过后才备份并覆盖原版卡。选错文件不会破坏现有卡。

**合并到 MVU**：把原版卡的内容同步进 MVU 版。写入前自动备份。

**还原**：面板里的「还原」列出所有备份，**按卡片分组**，展开能看到每一份的时间和大小，可回滚到任意一份。

## 数据

| 路径 | 内容 |
| --- | --- |
| `profile-data/<profile>/data/tools/card-updater/config.json` | 卡片配对、链接、基线签名、策略开关、索引站令牌 |
| `profile-data/<profile>/data/tools/card-updater/state.json` | 最近一次检测报告 |
| `profile-data/<profile>/data/tools/card-updater/backups/` | 每次写入前的自动备份 |
| `profile-data/<profile>/data/tools/card-updater/avatar-cache/` | 卡片头像缩略图缓存 |

卡片目录固定为 `profile-data/<profile>/data/resources/cards`。

备份保留策略：每张卡文件保留最近 **5** 份，每个标签保留最新 1 份，总量上限 **400** 份。

## 对 DSH 的影响

这个插件只做三件事，都限制在自己的范围内：

**只改自己那份 profile 的 `package.json`**，且改前备份。不触碰 `@deepseek-ai/*` 下的宿主包，不触碰其它 profile。

**运行时只读宿主结构。** 侧栏入口通过 `sidebar.footer.action` 槽位注册，位置、几何、收起态表现全部由侧栏外壳决定。插件不做 DOM 注入、不克隆宿主元素、不写宿主元素的内联样式，因此停用后侧栏不会留下痕迹。

**写入只发生两处**：卡片目录（本职，写前自动备份）和插件自己的数据目录。

## 常见问题

**检测说「无法访问该网址」**：先确认浏览器能打开 Discord。能打开就检查代理是否开了 TUN 模式。

**提示「索引站令牌无效或已过期」**：在索引站重新登录，按上面的步骤取一次新令牌。

**找不到这张卡的 MVU 版**：卡片副标题会说明是「未找到同名 MVU 版」还是「按名称前缀推测配对，请确认」。前者手动选一次文件即可；后者是插件按名称前缀猜的，建议核对。

**合并报告里有冲突条目**：那些是世界书条目在原版和 MVU 版里内容不一致，插件选择保留本地改过的那份。要用原版内容的话需要单独处理。

**单卡没有 `character_version`**：插件不会凭空造版本号，合并后仍为空。在卡里填一个初值之后就会正常递增。

## 开发

纯 JavaScript，无构建步骤、无第三方依赖。

```
lib/index.js   宿主端：抓取、比对、合并、备份、HTTP 路由
client.js      浏览器端：面板、设置区、侧栏入口
```

宿主端注册四个路由，浏览器端通过它们通信：

- `GET  /dsh-card-updater/state` — 配置与最近报告
- `GET  /dsh-card-updater/list` — 目录浏览
- `GET  /dsh-card-updater/avatar` — 卡片头像缩略图
- `POST /dsh-card-updater/action` — 所有操作，取值为 `check` / `importPlain` / `merge` / `updateAndMerge` / `save` / `suggest` / `backupList` / `restoreBackup` / `deleteBackup` / `manualBackup` / `prune` / `verifyIndex` / `openFolder` / `selfcheck` 等

改了 `lib/index.js` 需要重启 DSH；只改 `client.js` 刷新页面即可。

## 许可

MIT
