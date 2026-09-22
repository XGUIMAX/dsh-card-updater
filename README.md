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
- **自己找原贴**：只填卡名也能工作。插件会用卡片自己的名字去社区索引站搜索，把找到的原贴链接自动填进来。**链接一旦配上就以链接为准**：作者改了贴子标题也不影响检测，因为贴子本身没变。
- **导入新版**：下载好的新卡文件选进来，自动备份旧卡、写入新内容、记录导入时间。
- **合并进 MVU 版**：把原版卡的新内容同步进 MVU 版，**永不覆盖** MVU 的状态栏脚本、变量定义与 `tavern_helper`。
- **备份与还原**：每次写入前自动备份，按卡片分组查看，随时回滚到任意一份。
- **检测插件更新**：面板右上角标着当前安装的版本号，每次打开面板都会自动查一次 GitHub。没新版显示「已是最新版」；有新版变成「发现新版 v1.3.0」，点一下直接打开更新页。版本号读的是插件自己的 `package.json`，`git pull` 之后会自己跟着变。

## 界面

侧栏底部与「插件市场 / 设置」同排的入口，宽侧栏显示图标加文字，收成窄轨道时显示为图标按钮。同一套面板也在「设置 → 卡片更新器」下。

每张卡的名称右侧有两列状态，分别对应**原卡**和 **MVU 版**：

- 绿色「原卡已调试 2026/9/18 22:17:33」表示 DSH Tavern 的卡片工作台已经为这张卡开过对话，时间是最近一次
- 黄色「原卡正在调试中」表示那个对话最近两分钟还在写东西，也就是调试还没结束。没有这一档的话，刚点完「前去调试」就会立刻显示成已经调完了
- 黄色「原卡调试有改动，尚未查看」表示这张卡最近那次工作台对话被写过，而从那之后没人打开过它。判据是 Tavern 对话索引里的「最后更新晚于最后打开」，两个时间都由工作台自己记录，所以这是一条事实而不是推测。多看几眼、把那个对话打开一次，它就回到绿色
- 黄色「原卡已变动，未调试」表示卡文件在调试之后被改写过。手动换文件、导入新版、更新原版都会触发，此时那条调试记录描述的是已经不存在的旧文件，所以按未调试处理，点一下可以针对现在这份重新调试
- 黄色「原卡未调试 · 点击前去调试」表示工作台从没看过这张卡，点一下就会打开卡片 Agent 的调试对话，效果和 Tavern 里的「交给卡片 Agent 调试」一样
- 某一栏对应的文件没配置时，那一栏不显示，所以只配了原卡的条目不会出现一条空的 MVU 栏

调试记录来自 Tavern 的卡片工作台对话（每张卡在 `data/chats` 下都有一个），插件只读不写。**打开调试需要这张卡有游玩对话**，没有的话按钮会灰掉并说明原因。

<img width="1159" height="420" alt="ScreenShot_2026-09-18_233248_236" src="https://github.com/user-attachments/assets/6069ab09-d5be-4845-9d45-12422da57105" />


## 搜索与排序
<img width="1160" height="260" alt="image" src="https://github.com/user-attachments/assets/83e892ef-ef0b-4c45-863f-4896551d4c87" />

卡片列表上方有一行工具：

- **搜索**：匹配卡名、版本关键词和两个路径，边改边生效
- **筛选**：全部 / 只有原卡（没配 MVU 版）/ 只有 MVU 版（没配原卡）
- **排序**：默认 / 按导入时间 / 按名称，右侧显示「当前显示 / 总数」

**默认排序**分三档：**有更新的**在最前，其次是**工作台没看过**的，最后才是其余，同一档内保持配置里的顺序。在这个下拉里选了别的排序，就完全按选的来，不再叠加默认那三档，因为挑好的顺序才是正在找的顺序。

一条卡都没检测过、也没配工作台的目录，看起来和以前完全一样。


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

**先装 DSH Tavern。** 这个插件是它的伴生工具：人物卡、卡片工作台对话与游玩数据都由 Tavern 提供，插件只负责比对远端更新、更新原版卡、把变更合并进 MVU 版。没装 Tavern 时打开面板会直接说明并给出安装地址，而不是显示一个空列表。

Tavern 地址：https://github.com/flizzywine/dsh-tavern

此外需要已经在用的 DSH，且有一个 profile（本说明中默认叫 `tavern`，Tavern 项目用的就是它）。插件是 DSH 插件，不是独立程序。

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

重启 DSH 后入口消失。配置与备份留在 `~/.dsh/profile-data/tavern/data/tools/card-updater`，要一并清掉就手动删该目录。

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

**令牌有效期约 7 天。** 它是后端签发的 JWT，过期后所有贴子检索都会返回 401。插件会直接读令牌里的过期时间，所以打开面板就能看到「令牌已于 xx 过期」，不用等检索失败才发现；旁边那颗「重新获取令牌」按钮会打开索引站的登录页。

**刷新令牌的办法**：**先退出登录**，再用 Discord 重新登录一次。

令牌是后端在 OAuth 回调时以网址 `#token=` 片段的形式带回来的，页面加载时写入 localStorage，除此之外前端没有任何地方写这个键。而登录态靠 cookie 维持，只要它还活着，站点就不会重走授权，也就不会有新的片段，读到的永远是上一次那个值。退出登录正是为了把它打回需要重新授权的状态。

1. 在索引站退出登录
2. 用 Discord 重新登录，等它跳回站点
3. 按 F12 执行 `localStorage.getItem("auth_token")`，把新值粘回面板

旧的不用手动清，登录成功后会被整段覆盖。`localStorage.removeItem('auth_token')` 只在你想亲眼确认「确实写入了新值」时才需要。

**面板会在令牌剩余不足 24 小时时转成黄色提醒**，因为刷新它要折腾一趟登出登录，不适合等检索开始失败了才发现。

> **连不上时先看这里。** 插件运行在 Node 进程里，**不读取系统代理设置**，而浏览器会读。所以「浏览器能打开 Discord、插件报连不上」是常见组合。把代理切换到 **TUN 模式** 让流量在网卡层被接管即可。插件会区分「连不上」和「链接写错了」，只在真正是网络问题时才提示这一条。
>
> 「连不上」和「令牌过期」是两回事：前者提示代理，后者提示去重新登录。浏览器里看着还是登录状态不代表令牌有效，索引站的登录态主要靠 cookie，`auth_token` 是另一条独立的凭据。

## 日常使用

```
检测 → 有新版 → 下载新卡 → 导入新版 → 合并到 MVU
```

**检测**：卡片上的「检测」只查这一张，「检测全部」查所有启用的卡。**检测出更新的卡会自动排到列表最前面**，其余保持原顺序，不用在长列表里自己找哪张有动静。

**版本是怎么比的**。基线是**卡片自己的 `character_version`**，因为它说的是这台机器手上实际有什么；贴子上的数字会随作者改个标题就漂移。贴子那一侧的信号按可靠程度排：

| 来源 | 说明 | 怎么用 |
| --- | --- | --- |
| **索引站记录的版本** | 站点为这个贴子维护的版本字段 | 有值就直接当版本用，不做任何猜测 |
| **索引站记录的更新消息时间** | 作者发布更新那条消息的时间 | 独立信号，它变了就是作者发了新东西 |
| **贴子里的版本标注** | 「版本 5.3」「version 1.2」「beta0.5.5」，以及带 `v` 前缀的写法如 `v4.3.3` | 当版本用 |
| **标题里的日期** | 「9.21更新」这类 | **只当发布时间**，不参与版本比较 |

**日期不是版本。** 它说的是作者什么时候发的，不是卡里有什么。把 `9.21` 拿去和卡内的 `5.2` 比大小，赢了是巧合，输了是冤枉，而且作者只改日期、卡没动的时候也会被判成有新版。所以日期现在只以「贴子更新于 9.21」的形式显示，不进版本比较。

真正可靠的更新信号是**索引站记录的更新消息时间**：它变了，说明作者确实发了新东西。

**贴子改名会单独提示。** 作者把「创世回廊」改成「龙娘回廊」这类事会发生，贴子还是那张贴子、卡还是那张卡。判据是**贴子标题里还有没有这张卡的关键词**，没有就写出「作者改过贴子名，链接仍是同一个（现在叫 ✨龙娘回廊！9.21更新…）」。**链接才是身份，标题只是盖在上面的标签**，所以这句话说的是标题变了，不是链接不对。

用关键词判断而不是「标题和上次不一样」，是因为后者对**已经改过的名字**永远不会触发：第一次检测读到的就已经是新名字，此后每次读到的也是它，两次比较永远相等。

**读不到正文，这是已知的边界。** 社区索引站只收录贴子的标题、摘要和几个时间字段，不收录正文；Discord 那边不登录读不到内容。所以作者把版本写在正文里（「9月21日更新5.3」）时，插件看不到它，只能用索引站记录的更新消息时间判断「作者发了新东西」，无法说出具体版本号。如果你希望某个贴子的版本号被准确读到，那取决于作者是否填写了索引站的版本字段。

卡片上这三个动作，区别只在「原版卡的新内容从哪来」和「要不要顺手合并」：

| 动作 | 做什么 | 需要联网 |
| --- | --- | --- |
| **导入新版** | 把你**已经下载好**的卡文件复制成原版卡 | 不 |
| **合并到 MVU** | 把**当前原版卡**的内容同步进 MVU 版 | 不 |
| **更新并合并** | 先从来源链接下载新卡覆盖原版卡，再合并进 MVU | 是 |

日常路径：

```
检测 → 有新版 → 自己下载 → 导入新版 → 合并到 MVU
```

**「更新并合并」里的"更新"是从来源链接自动下载。** 社区贴子的下载普遍挂在密码、权限或 Discord 社区身份后面，插件拿不到，所以这一步经常失败；能手动下载时走上面那条路更可靠。

**导入新版**会先解析确认那确实是一张人物卡，通过后才备份并覆盖原版卡，选错文件不会破坏现有卡。

**合并到 MVU** 只读本地文件、不联网，所以它同步的是「原版卡此刻的内容」。原版卡还没弄成新版的话，合并过去的就是旧的。

（1.23.0 之前另有一个只下载不合并的「更新原版」按钮。因为社区贴子的卡基本都下载不了，它已被移除，下载能力保留在「更新并合并」里。所有写入动作都会先备份。）

**有卡正在调试时会挡住写卡的操作。** 手动备份、还原、导入新版、更新原版、合并到 MVU、更新并合并都会先检查一遍，命中就弹「有角色卡正在调试中，请等待调试结束再操作」。理由是卡片 Agent 自己持有一份卡并在收工时写回，这时候从面板改同一个文件，两边只会互相覆盖。检测、搜索、筛选这些不碰文件的照常可用。

单张卡的操作结果会显示在**那张卡自己的按钮行左侧**，一眼能看出是哪张卡的事；「检测全部」「重新扫描卡片目录」这类属于整个面板的操作，结果显示在面板顶部。

上面四个写入动作成功后，提示里会附一句「为确保卡功能与内容完善，建议调试一遍」。改的是卡的内容，而状态栏脚本、变量定义和依赖旧措辞的正则未必跟着走，这些要实际跑一轮才看得出来。

**还原**：面板里的「还原」列出所有备份，**按卡片分组**，展开能看到每一份的时间和大小，可回滚到任意一份。

**重新载入**：工具栏最右那颗按钮会丢弃未保存的改动并重新读取后台状态。平时用不到，每个操作完成后界面都会自己刷新，它只是留给「显示的结论看起来不对」这种情况。

## 数据

| 路径 | 内容 |
| --- | --- |
| `profile-data/<profile>/data/tools/card-updater/config.json` | 卡片配对、链接、基线签名、策略开关、索引站令牌 |
| `profile-data/<profile>/data/tools/card-updater/state.json` | 最近一次检测报告 |
| `profile-data/<profile>/data/tools/card-updater/backups/` | 每次写入前的自动备份 |
| `profile-data/<profile>/data/tools/card-updater/` | 配置、检测报告与备份 |

卡片目录固定为 `profile-data/<profile>/data/resources/cards`。

备份保留策略：每张卡文件保留最近 **5** 份，每个标签保留最新 1 份，总量上限 **400** 份。

## 权限

插件要读卡片文件、要联网、要在点击时打开系统文件管理器。每一类权限的用途、触发时机、涉及的目标和失败时的行为都列在 [PERMISSIONS.md](PERMISSIONS.md) 里，包括 DSH / Node 兼容范围声明，以及在一次性 profile 上做安装、启动、卸载的实测步骤。

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

**作者改了贴子标题，检测就报「无法定位这张卡」**：1.19.0 之前会这样。插件拿「版本关键词」去贴子里找位置，找不到就判定失败；但 **thread_id 不会变，标题会变**，作者一改名就全盘失效。现在关键词只在真的能找到时用来缩小范围，找不到就退回到整个贴子：Discord 贴子整个都属于这一张卡，不存在认错的问题。仍然依赖关键词定位的只有普通网页，因为那种页面上可能并排放着好几张卡。

**提示「页面上没有找到「某某」」**：现在只会在普通网页上出现，说明关键词和页面内容对不上。把「版本关键词」清空，让它改从卡片自己的名字提取（1.18.1 起尾部标点会自动去掉），或者改成页面里实际出现的写法。

**「检测更新」显示暂无发布版本**：仓库还没打过任何版本标签，插件无法比对。见下面的「发版」。

**安全软件报 `TrojanDownloader/JS.Agent.is`**：误报，两个原因叠在一起。插件本职要下载卡文件并写入磁盘，这本身就有"下载者"的形状；而 1.17.0 之前，它在 Windows 上还会调用 PowerShell 生成头像缩略图，那次调用带了 `-ExecutionPolicy Bypass` 和运行时拼接的命令串，正是终端防护判定"脚本启动器"的特征。1.18.0 已经把那段调用删掉了，头像直接交给浏览器缩放，现在整个宿主端只剩一处外部命令调用（打开系统文件管理器）。

报毒时把插件目录加入信任区即可。它需要写人物卡文件，这是它的功能本身，不是异常。

**点「更新原版」或「更新并合并」提示来源无法直接更新**：这张卡的来源挂着密码、权限或赞助，插件拿不到文件。点「跳转到原贴」去按作者的方式下载新卡，回来点「导入新版」，再点「合并到 MVU」。检测结果里标着「有下载条件：密码 · 权限 · 回复可见」的卡都属于这种情况。

**提示令牌已过期**：索引站的令牌有效期约 7 天，过期后检索贴子会返回 401。刷新方式见上面「索引站授权」一节：**先退出登录**，再用 Discord 重新登录一次，然后重新取。注意浏览器里看着还登录着是正常的，登录态靠 cookie，令牌是另一条凭据，两者不会互相刷新。

**macOS / Linux 上和 Windows 有什么不一样**：只剩一处。打开目录交给系统自己的文件管理器，macOS 用 `open`，Linux 用 `xdg-open`，Windows 用 `explorer.exe`。插件不执行任何其他外部程序。

## 开发

纯 JavaScript，无构建步骤、无第三方依赖。

```
lib/index.js   宿主端：抓取、比对、合并、备份、HTTP 路由
client.js      浏览器端：面板、设置区、侧栏入口
```

宿主端注册四个路由，浏览器端通过它们通信：

- `GET  /dsh-card-updater/state` — 配置与最近报告
- `GET  /dsh-card-updater/list` — 目录浏览
- `GET  /dsh-card-updater/avatar` — 卡片头像
- `POST /dsh-card-updater/action` — 所有操作，取值为 `check` / `importPlain` / `merge` / `updateAndMerge` / `save` / `suggest` / `backupList` / `restoreBackup` / `deleteBackup` / `manualBackup` / `prune` / `verifyIndex` / `openFolder` / `checkUpdate` / `selfcheck` 等

改了 `lib/index.js` 需要重启 DSH；只改 `client.js` 刷新页面即可。

### 平台

宿主端只用 Node 内置模块，没有第三方依赖，路径一律走 `node:path`。DSH 主目录取 `DSH_HOME`，没设时用 `~/.dsh`，三个平台解析到同一个位置。需要跟随平台的地方各有分支：

- 打开文件夹：`explorer.exe` / `open` / `xdg-open`
- 安装卸载：标准方式是 `dsh plugin --profile <name> add / remove`，跨平台通用；另外随附 PowerShell 与 POSIX 脚本各一套作为备选

### 不要给 package.json 加 BOM

DSH 读这个清单来判断一个包是不是 bundle，**一个 UTF-8 BOM 就会让清单变成非法 JSON**，插件直接加载失败，报的是：

```
dsh-plugin-desktop: cannot read profile package manifest for dsh-card-updater: Unexpected token '', ...
```

这是踩过一次的坑：Windows PowerShell 5.1 的 `Set-Content -Encoding UTF8` 会主动写 BOM，用它改版本号就会中招。改这个文件请用不带 BOM 的方式，比如仓库里用的编辑工具，或者：

```powershell
node -e "const f=require('fs'),p='package.json';f.writeFileSync(p,f.readFileSync(p,'utf8').replace(/^\uFEFF/,''),'utf8')"
```

修完可以用这句确认前三个字节不是 `EF BB BF`：

```powershell
node -e "const b=require('fs').readFileSync('package.json');console.log(b.subarray(0,3).toString('hex'))"
```

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
