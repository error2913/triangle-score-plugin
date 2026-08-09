# triangle-score-plugin

海豹（SealDice）单文件 JS 插件：对接「三角占领 · 赛时控制器」的成绩上传协议。

## 功能

- 群内引用（回复）一张音游结算截图，消息文本填触发词（默认「上传成绩」）；
- 调用 image-recognizer 暴露的跨插件 API（`globalThis.imageRecognizerAPI`）识别截图，
  得到曲名 / 难度 / 得分 / TP 等结构化数据；
- 按成绩上传协议 `POST /api/v1/results` 上传到赛时控制器，自动完成歌曲→格子映射、
  普通格占领与 L1 挑战；
- 上传成功后**截取控制器网页本身**（aiplugin4-backends web-read `/screenshot`，
  Puppeteer 无头截图）返回棋盘画面；截图失败时回退纯文本结果；
- 记录选手身份：`QQ → 阵营 + 昵称` 持久化绑定，上传时自动带上选手 ID。

## 依赖（插件加载依赖链）

- `image-recognizer`（作者 `错误`，≥ 1.0.0）——本插件通过 `@depends` 声明；
- image-recognizer 自身依赖 `ob11网络连接依赖`（拉取被引用消息图片）与
  `AI骰娘4`（图片模型识别，需开启「图片模型」并配置如 `glm-4v-plus`）；
- 赛时控制器服务（`competition_web/demo`，需已实现 `/api/v1/results` 协议）；
- aiplugin4-backends 的 `web-read` 后端（默认 `http://127.0.0.1:46799`），
  用于对控制器网页截图（需该后端含 `/screenshot` 接口，见 aiplugin4-backends web-read）。

## 安装

1. 上传 `triangle-score-plugin.js` 到海豹 WebUI → 扩展功能 → JS 扩展，点击「重载 JS」；
2. 确保 image-recognizer 已加载（`image-recognizer.js` 或 `image-recognizer-cy2.js`，二选一）；
3. 启动赛时控制器，导入歌曲库并 `POST /api/init` 开局，从返回的 `tokens` 中取得：
   `match`（比赛令牌）、`defender` / `attacker`（阵营令牌）；
4. 在插件设置中填入：`controllerUrl`（机器人能访问到的控制器地址）；
   `screenshotUrl` 默认 `http://127.0.0.1:46799`（web-read 后端），如需 token 再填 `screenshotToken`。
   秘钥不需要配置：群内发送 `.ts start` 开局时自动获取并存储。

## 使用

```text
.ts help                           查看帮助
.ts status                         查看配置与依赖状态
.ts bind attacker 昵称             绑定本人为掠夺者（红方）
.ts bind defender 昵称             绑定本人为守护者（蓝方）
.ts unbind                         解除本人绑定
.ts me                             查看本人绑定
.ts list                           查看已绑定选手
.ts board                          查看控制器当前比分/占领情况
.ts shot                           截取控制器网页当前画面
```

上传成绩：**引用（回复）一张结算截图**，消息文本填「上传成绩」。
触发词可在插件设置的「触发文本模板」中修改（每行一个正则）。

## 协议对接说明

- 上传端点：`POST {controllerUrl}/api/v1/results`
- 请求头：`X-Match-Token`（比赛令牌）、`X-Team-Token`（按选手绑定阵营选择）
- 请求体：`{ api_version, client_msg_id, team, player:{id,name}, song:{name,level,type}, result:{score,tp,mm,full_combo,miss,bad,good} }`
- 响应 `outcome`：`occupied`（占领成功）/ `l1_holder`（L1 挑战成功）/
  `l1_challenged_lost`（L1 未超过）/ `already_occupied`（已被占领）等

协议完整定义见「三角占领 · 赛时控制器」项目内的成绩上传协议文档。
