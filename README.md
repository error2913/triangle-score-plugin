# triangle-score-plugin

海豹（SealDice）单文件 JS 插件：从比赛网站拉赛程 → 群内选对局 → @ 选手开局 →
引用结算截图上传成绩（人工审核）→ 结束轮询用纯文本展示接下来的比赛。对接「三角占领 · 赛时控制器」
的成绩上传协议。

## 功能

- `.ts start`（群管理）：从比赛网站（competition_web）拉取当前进行中比赛的赛程，
  列出候选对局（对局 ID + 双方单位名 + 成员 QQ）；
- 群管理发送 `.ts start <对局ID>` 选择该场 → bot @ 全部选手并**直接开局**
  （`POST /api/init` 自动记录秘钥，不对外展示），发棋盘截图；
- 选手**引用（回复）结算截图** + 触发词（默认「上传成绩」）→ image-recognizer 识别 →
  bot 发【成绩待确认】消息 → **群管理**引用回复 确认 / 修改 / 拒绝 → 确认后才上传；
- 比赛最后一分钟起每 30 秒轮询控制器的 `/api/tick`（该接口会触发控制器的超时判定），
  检测到 `game_over` 后再拉 `/api/state` 取胜负并自动用纯文本展示接下来的比赛
  （最多 4 场 + 余量提示）；`.ts stop` 同样展示；
- 选手身份不再手动绑定：从赛程名单匹配 `QQ → 昵称 → 阵营`
  （掠夺者=participant_a，守护者=participant_b），QQ 由选手在网站个人资料里自己填。

## 依赖（插件加载依赖链）

- `image-recognizer`（作者 `错误`，≥ 1.0.0）——本插件通过 `@depends` 声明；
- image-recognizer 自身依赖 `ob11网络连接依赖`（拉取被引用消息图片）与
  `AI骰娘4`（图片模型识别，需开启「图片模型」并配置如 `glm-4v-plus`）；
- 比赛网站（competition_web，需含赛程只读接口，见下文「后端运行人需要做什么」）；
- 赛时控制器服务（`competition_web/demo`，需已实现 `/api/v1/results` 协议与
  `/api/init`、`/api/end`、`/api/state`）；
- aiplugin4-backends 的 `web-read` 后端（默认 `http://127.0.0.1:46799`，MCP
  `/mcp` + `screenshot_url` 工具），用于截取控制器网页。

## 安装

1. 上传 `triangle-score-plugin.js` 到海豹 WebUI → 扩展功能 → JS 扩展，点击「重载 JS」；
2. 确保 image-recognizer 已加载（`image-recognizer.js` 或 `image-recognizer-cy2.js`，二选一）；
3. 在插件设置中填入：
   - `siteUrl`：比赛网站地址（机器人可访问，如 `http://<网站服务器>:8000`）；
   - `competitionId`：比赛 ID，留空自动使用「当前进行中」的比赛；
   - `controllerUrl`：赛时控制器地址（如 `http://<控制器服务器>:8001`）；
   - `screenshotUrl`：web-read 后端地址（默认 `http://127.0.0.1:46799`），
     配置了 token 时再填 `screenshotToken`；
   - `debugLog`：调试日志开关（默认 `1`）。截图/轮询详情会打印到海豹日志，
     排查「截图失败」「比赛不结束」时保持开启，稳定后可以改 `0`；
   - 秘钥**不需要配置**：`.ts start` 开局时自动获取并存储。

## 使用

```text
.ts help      查看帮助
.ts status    查看配置 / 当前对局状态
.ts start [对局ID]  拉取赛程 → 展示候选；带 ID 直接选择开局（仅群管理以上）
.ts stop      结束比赛并展示接下来的比赛（仅群管理以上）
.ts board     查看控制器当前比分/占领情况
.ts tasks     查看本局 21 个任务格的歌曲列表
.ts shot      截取控制器网页当前画面
```

### 开局流程

1. 群管理发送 `.ts start`，bot 拉取赛程并列出候选对局：
   `对局ID 1 ｜ 第1轮：掠夺者 阿晴（QQ:1001） vs 守护者 小澜（QQ:1002）`；
2. 群管理发送 `.ts start 1` 选择该场（ID 见上一步候选列表）；
3. bot @ 全体选手并**直接开局**（`POST /api/init` 自动记录秘钥、发送棋盘截图）；
4. 比赛进行中，群管理可 `引用结算截图 + 上传成绩`；
5. 比赛最后一分钟起每 30 秒轮询控制器 `/api/tick`（轮询本身会触发控制器的
   超时判定），检测到结束后再取 `/api/state` 胜负并自动用纯文本展示接下来的比赛
   （如「第2轮 局7：掠夺者「X」 vs 守护者「Y」」，最多 4 场）；`.ts stop` 同样展示。

### 上传成绩（人工审核流程）

1. 选手**引用（回复）一张结算截图**，消息文本填「上传成绩」（触发词可在插件设置中修改）；
2. bot 识别后**不会直接上传**，而是发出一条【成绩待确认 · 编号 xxxx】消息；
3. **群管理**（管理员 / 群主 / 骰主）引用该确认消息回复：
   - `确认` —— 按识别到的成绩上传；
   - `修改 <字段> <值>` —— 修改后再上传，可改 `score / tp / miss / bad / good / mm / fc`，
     例：`修改 score 991420`、`修改 miss 0 bad 0 good 1`、`修改 tp 95.5`；
   - `拒绝` —— 作废该成绩；
4. 上传成功后 bot 返回结果文字 + 控制器网页截图；截图失败回退纯文本。

待审成绩 15 分钟未处理自动作废；同群同一选手同一阵营同时只允许一条待审成绩（不同选手可各自上传，
互不阻塞）。上传被拒绝或网络失败时**待审成绩会保留**（确认/修改分支不会先删后传），
群管理可重新引用确认或继续修改。

> 限制：当前版本同一时刻只支持**一个群**跑一局（对局 / 秘钥均为全局单实例），
> `.ts start` 会拒绝在已有对局的群之外再开一局；审核待审成绩时会校验其群归属，
> 其他群不能代审；`.ts stop` 也只会清空对局所在群的秘钥与状态。

> 开局保护：双方选手都未在网站个人资料填写 QQ 时拒绝开局；仅一侧缺失时给出警告但允许继续
> （缺失一侧无法上传成绩，需选手先补填）。比赛最后一分钟起的自动轮询若连续失败 3 次，
> bot 会在对局群提示控制器可能失联；控制器恢复后轮询自动继续并清零失败计数。

## 插件内部机制（重载安全）

- 插件启动一个 0.5 秒常驻循环（`setInterval`，全局标记防重复），每次 tick
  从存储读取对局状态 / 轮询时间戳，因此插件热重载后轮询自动恢复，
  不依赖会被重载清掉的单次定时器；对局状态与秘钥本身持久化在 `ext.storage`；
- **热重载不打断进行中的比赛**：对局身份、秘钥、`lastPollAt` 轮询进度、待审成绩全部存在
  `ext.storage` 里，重载后 `tickLoop` 立即从存储恢复，正在进行的对局照常轮询、上传、
  审核和结束；插件加载时会在海豹日志打印恢复信息
  （`检测到进行中对局…已进入轮询窗口，恢复轮询`），可据此确认重载后比赛已接续；
- 待审成绩 15 分钟未审自动作废。

## 协议对接说明

- 赛程接口（网站侧，公开只读）：
  `GET {siteUrl}/api/schedule/current` 或 `GET {siteUrl}/api/competitions/{id}/schedule`，
  返回 `{competition, matches[]}`，每局含 `participant_a/b {type, name, qqs}`；
- 上传端点：`POST {controllerUrl}/api/v1/results`
- 请求头：`X-Match-Token`（比赛令牌）、`X-Team-Token`（按选手阵营选择）
- 请求体：`{ api_version, client_msg_id, team, player:{id,name}, song:{name,level,type}, result:{score,tp,mm,full_combo,miss,bad,good} }`
- 响应 `outcome`：`occupied`（占领成功）/ `l1_holder`（L1 挑战成功）/
  `l1_challenged_lost`（L1 未超过）/ `already_occupied`（已被占领）等

## 后端运行人需要做什么

1. **导入歌曲库**：控制器启动后执行
   `POST {controllerUrl}/api/songs`，请求体为 JSON
   `{"songs": [{"name": "歌名", "type": "Glitch|Chaos|Hard", "level": "难度"}]}`
   （也可以在控制器网页里导入），否则 `.ts start` 开局时会提示先导入歌曲库；
2. **比赛网站**（competition_web）需更新到含赛程只读接口的版本：
   `git pull` 后重启网站服务（8000 端口），验证
   `GET {siteUrl}/api/schedule/current`（或指定比赛
   `GET {siteUrl}/api/competitions/{id}/schedule`）可访问；比赛需处于 `ongoing`
   状态且选手已批准报名、对局已排定（进入 ongoing 时引擎自动生成）；
3. **选手填 QQ**：参赛选手在网站「个人资料」填写 QQ（机器人靠它 @ 与匹配身份）；
4. **秘钥不需要人工获取**：插件 `.ts start` 开局时会调 `/api/init` 自动拿并保存。

协议完整定义见「三角占领 · 赛时控制器」项目内的成绩上传协议文档。
