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
- **检测插件更新**：面板右上角标着当前安装的版本号，每次打开面板都会自动查一次 GitHub。没新版显示「已是最新版」；有新版变成「发现新版 v1.3.0」，点一下直接打开更新页。版本号读的是插件自己的 `package.json`，`git pull` 之后会自己跟着变。

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

已经在用的 DSH，且有一个 profile（本说明中默认叫 `tavern`，Tavern 项目用的就是它）。插件是 DSH 插件，不是独立程序。

### 用 dsh 命令安装

`dsh plugin` 是 DSH 自带的插件管理命令：把参数转给 profile 目录下的 pnpm，装完之后再按**已安装状态**核对 `dsh.profile.bundles` —— 声明了 `dsh.bundle` 的依赖自动进入层栈，被移除的自动离开。所以不必手工改 profile 的 `package.json`。

在本项目目录里执行：

```bash
cd ~/.dsh/plugins/dsh-card-updater
dsh plugin --profile tavern add .
```

装到别的 profile 就换名字：

```bash
dsh plugin --profile web add .
```

也可以直接从 GitHub 装，不必先 clone：

```bash
dsh plugin --profile tavern add github:XGUIMAX/dsh-card-updater
```

两种装法只差插件从哪来。本地目录装的是 `link:`，改源码立刻生效，适合跟随仓库改；GitHub 装的是仓库快照，靠 `dsh plugin update` 更新。

装完**重启 DSH**，侧栏底部出现「卡片更新器」即装好。

> 在 DSH Desktop 的命令行工具里，默认 profile 就是 `tavern`，写 `dsh plugin add .` 就够了，`--profile` 可以省略。

### 在 dsh-tavern（CLI 独立版）里安装

dsh-tavern 用的是自己的目录，和标准 DSH 的 `~/.dsh` 不同：独立安装时默认根目录是 `~/.dsh-tavern`，它的私有 CLI 运行时也装在里面。所以这条命令有两处和上面不一样 —— `DSH_HOME` 要指过去，执行的也得是运行时里那个 `dsh`，而不是 PATH 上的标准版。

macOS / Linux（按默认目录安装）：

```bash
DSH_HOME=~/.dsh-tavern ~/.dsh-tavern/runtime/bin/dsh plugin --profile tavern add github:XGUIMAX/dsh-card-updater
```

Windows（按默认目录安装）：

```powershell
$env:DSH_HOME = "$env:USERPROFILE\.dsh-tavern"; & "$env:USERPROFILE\.dsh-tavern\runtime\dsh.cmd" plugin --profile tavern add github:XGUIMAX/dsh-card-updater
```

运行时入口的位置按平台不同：macOS / Linux 上是 `runtime/bin/dsh`，Windows 上是 `runtime\dsh.cmd`，因为 npm 在 Windows 上把命令直接放在 prefix 根目录，不进 `bin`。

安装时如果选的是「2 当前目录」（直接回车就是它）或「3 其他目录」，把上面出现的两处 `~/.dsh-tavern` 一起换成你的实际安装根目录即可。

要卸载就把 `add github:XGUIMAX/dsh-card-updater` 换成 `remove dsh-card-updater`。这里跑的仍然是同一套 `dsh plugin`，所以 `dsh.profile.bundles` 一样会自动维护。

> `dsh plugin` 会调 `pnpm`。dsh-tavern 自带的那个在 `~/.dsh-tavern/tools/bin`（Windows 是 `~/.dsh-tavern\tools`），没在 PATH 里的话先加进去，或者用你系统里已有的 pnpm。

### 卸载

```bash
dsh plugin --profile tavern remove dsh-card-updater
```

重启 DSH 后入口消失。配置、备份与头像缓存留在 `~/.dsh/profile-data/tavern/data/tools/card-updater`，要一并清掉就手动删该目录。

### 更新

本地目录装的：在项目目录里 `git pull`，重启 DSH。

GitHub 装的：

```bash
dsh plugin --profile tavern update dsh-card-updater
```

面板右上角标着当前版本号，每次打开还会自动查一次 GitHub，有新版就变成可点的「发现新版」。

### 备选：随附脚本

如果 `dsh` 命令不在 `PATH` 里，或者你希望在改 profile 清单之前先留一份备份，可以用仓库里带的脚本。它们做的是同一件事：写 `dependencies`、把插件追加进 `dsh.profile.bundles`、在 profile 目录执行 `pnpm install`，并在动手前把 profile 的 `package.json` 备份成 `package.json.pre-card-updater-<时间戳>`。

Windows：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Profile web
```

macOS / Linux：

```bash
./install.sh
./install.sh --profile web
```

卸载：

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1                 # 摘除插件，保留卡片数据
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -PurgeData      # 连数据目录一起删除
```

```bash
./uninstall.sh                # 摘除插件，保留卡片数据
./uninstall.sh --purge-data   # 连数据目录一起删除
```

> 命令用 `powershell` 而不是 `pwsh`：Windows 自带的是 Windows PowerShell 5.1，很多机器上并没有安装 PowerShell 7。脚本两个版本都能跑。加 `-ExecutionPolicy Bypass` 是因为默认执行策略通常禁止直接运行 `.ps1`。
>
> macOS / Linux 上如果提示权限不足，先执行 `chmod +x install.sh uninstall.sh`。
>
> 脚本与 `dsh plugin` 可以混用，改的是同一份 profile 清单，两边都幂等。

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

**令牌有效期约 7 天。** 它是后端签发的 JWT，过期后所有贴子检索都会返回 401。插件会直接读令牌里的过期时间，所以打开面板就能看到「令牌已于 xx 过期」，不用等检索失败才发现；旁边那颗「重新获取令牌」按钮会打开索引站的登录页。重新登录一次，再执行上面那句把新值粘进来即可。

> **连不上时先看这里。** 插件运行在 Node 进程里，**不读取系统代理设置**，而浏览器会读。所以「浏览器能打开 Discord、插件报连不上」是常见组合。把代理切换到 **TUN 模式** 让流量在网卡层被接管即可。插件会区分「连不上」和「链接写错了」，只在真正是网络问题时才提示这一条。
>
> 「连不上」和「令牌过期」是两回事：前者提示代理，后者提示去重新登录。浏览器里看着还是登录状态不代表令牌有效，索引站的登录态主要靠 cookie，`auth_token` 是另一条独立的凭据。

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

**「检测更新」显示检测失败**：先确认浏览器能打开 GitHub。能打开而这里不通，同样是代理没开 TUN 模式。

**「检测更新」显示暂无发布版本**：仓库还没打过任何版本标签，插件无法比对。见下面的「发版」。

**提示令牌已过期**：索引站的令牌有效期约 7 天，过期后检索贴子会返回 401。点面板上那颗「重新获取令牌」打开登录页，登录后重新执行 `localStorage.getItem("auth_token")`，把新值粘回来即可。注意浏览器里看着还登录着是正常的，登录态靠 cookie，令牌是另一条凭据。

**macOS / Linux 上和 Windows 有什么不一样**：功能完全一致，只有两处跟随平台。一是「打开目录」交给系统自己的文件管理器，macOS 用 `open`，Linux 用 `xdg-open`。二是卡片头像：Windows 上用 System.Drawing 把图缩到 96px 再发给浏览器，其他平台直接把原图发出去由浏览器缩放，第一次打开会多传一点数据，之后走浏览器缓存。

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
- `POST /dsh-card-updater/action` — 所有操作，取值为 `check` / `importPlain` / `merge` / `updateAndMerge` / `save` / `suggest` / `backupList` / `restoreBackup` / `deleteBackup` / `manualBackup` / `prune` / `verifyIndex` / `openFolder` / `checkUpdate` / `selfcheck` 等

改了 `lib/index.js` 需要重启 DSH；只改 `client.js` 刷新页面即可。

### 平台

宿主端只用 Node 内置模块，没有第三方依赖，路径一律走 `node:path`。DSH 主目录取 `DSH_HOME`，没设时用 `~/.dsh`，三个平台解析到同一个位置。需要跟随平台的地方各有分支：

- 打开文件夹：`explorer.exe` / `open` / `xdg-open`
- 头像缩放：Windows 走 System.Drawing，其余平台交给浏览器
- 安装卸载：标准方式是 `dsh plugin --profile <name> add / remove`，跨平台通用；另外随附 PowerShell 与 POSIX 脚本各一套作为备选

### 发版

「检测更新」比对的是本机 `package.json` 里的 `version` 与仓库的 release / tag，所以新版要能被检测到，必须打上对应的标签：

```powershell
git add -A
git commit -m "v1.2.0: 这次改了什么"
git tag v1.2.0
git push origin main --follow-tags
```

标签名用 `vX.Y.Z`，且与 `package.json` 的 `version` 保持一致。只推代码不打标签的话，插件会一直认为自己就是最新版。

## 许可

MIT
