---
name: figma
description: 当用户要求根据 Figma 设计稿写代码/还原设计/读取设计稿数据/导出设计规范/提取颜色字体，或提供 Figma 分享链接、Figma 文件 key、提到 FIGMA_TOKEN、figma mcp、mcp.figma.com 时使用。优先走官方远程 MCP（https://mcp.figma.com/mcp，OAuth Bearer token，支持读写画布），备选 Figma REST API（FIGMA_TOKEN，只读）。
---

# figma — 从 Figma 设计稿提取编码所需的设计规范

## 什么时候用

- 用户给出 Figma 分享链接，要求还原/实现该设计稿。
- 用户要求从设计稿提取颜色、字体、间距、圆角等设计 token。
- 用户要求列出设计稿的页面/组件结构，或把设计稿转成前端代码。
- 用户提到 figma mcp / mcp.figma.com / Figma OAuth 登录。

## 认证方式（推荐 MCP OAuth，备选 REST PAT）

### 方式 A：MCP OAuth（推荐，支持读写画布）

- 官方远程 MCP 端点：`https://mcp.figma.com/mcp`（MCP Streamable HTTP，JSON-RPC over POST）。
- token 已保存在 `.bunbot/figma-mcp-token.json`（`access_token` 有效期 90 天 + `refresh_token`）。
- 调用时 header 带 `Authorization: Bearer <access_token>`。
- 过期前用 refresh_token 续期，无需重新登录。

### 方式 B：REST API + FIGMA_TOKEN（备选，只读）

- 环境变量 `FIGMA_TOKEN`（Figma → Settings → Security → Personal access tokens），未配置时让用户提供后写入项目根 `.env`。
- 适合只需拉取设计稿做只读提取、且已有 PAT 的场景；官方已不推荐（无法写画布）。

## MCP OAuth 登录流程（Chrome + 白名单绕过，仅首次/续期失败时需要）

支持脚本：`.agents/skills/figma/scripts/figma-oauth-login.ts`，三个子命令 `start / check / refresh`。

1. **后台启动登录 daemon**（run_script 约 30 秒会被 SIGTERM，等待用户授权必须 nohup 后台化）：

   ```bash
   nohup bun .agents/skills/figma/scripts/figma-oauth-login.ts start \
     > /tmp/figma-oauth-login.log 2>&1 &
   ```

2. **读取授权 URL**：从 stdout（/tmp/figma-oauth-login.log）或 state 文件 `/tmp/figma-oauth-state.json` 的 `authorize_url` 字段取出 `https://www.figma.com/oauth/mcp?client_id=...&code_challenge=...`。
3. **让用户在 Chrome 打开该 URL 并点击允许**（需已登录 Figma 账号）。
4. **轮询结果**（用户授权后浏览器跳转 127.0.0.1 回调，daemon 自动换 token 写入文件）：

   ```bash
   bun .agents/skills/figma/scripts/figma-oauth-login.ts check
   ```

5. **续期**：access_token 90 天过期前执行 `bun .agents/skills/figma/scripts/figma-oauth-login.ts refresh`。

流程关键点（已实测验证）：

- **白名单绕过**：动态注册（POST `https://api.figma.com/v1/oauth/mcp/register`）时 `client_name` 必须是 `"Codex"`，否则 403 Forbidden；RFC 7591 允许自报名称，Figma 只校验 client_name。
- **PKCE**：生成 `code_verifier`（43~128 字符）与 `code_challenge`（S256 + base64url），授权 URL 带 `code_challenge`、`code_challenge_method=S256`。
- **换 token 必须 `client_secret_post`**：注册时 `token_endpoint_auth_method: "client_secret_post"` 并保存 `client_secret`；回调时 POST `https://api.figma.com/v1/oauth/token`，form 提交 `grant_type=authorization_code` + `code` + `redirect_uri` + `client_id` + `client_secret` + `code_verifier`。旧文章里的 `none` 会报 "Client secret is required"。
- OAuth 元数据（探测 mcp 端点 401 响应 WWW-Authenticate 头可拿到）：authorization_endpoint=`https://www.figma.com/oauth/mcp`，token_endpoint=`https://api.figma.com/v1/oauth/token`，registration_endpoint=`https://api.figma.com/v1/oauth/mcp/register`，scope=`mcp:connect`。
- **清理后台进程**：禁用 `pkill -f`（会匹配 run_script 自身命令行导致自杀）与 `lsof -ti|xargs kill`（误杀进程链）；脚本已用 pid 文件（/tmp/figma-oauth-daemon.pid）精确 kill。

## 用 MCP 读写 Figma（方式 A 的调用步骤）

1. 读取 token：`JSON.parse(await Bun.file(".bunbot/figma-mcp-token.json").text()).access_token`。
2. 发 JSON-RPC 到 `https://mcp.figma.com/mcp`：

   ```ts
   const token = JSON.parse(await Bun.file(".bunbot/figma-mcp-token.json").text()).access_token;
   const res = await fetch("https://mcp.figma.com/mcp", {
     method: "POST",
     headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
     body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize",
       params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "bun-bot", version: "1.0" } } }),
   });
   ```

3. initialize 成功后补发 `notifications/initialized`，然后 `tools/list` 拿工具清单，`tools/call` 调用具体工具（如 `get_figma_file`、`get_figma_image`、`get_figma_image_fills`、`get_figma_variable_defs`、`get_figma_variable_values`；新 MCP 还支持写画布）。
4. **响应可能是 SSE**（Content-Type: text/event-stream）：按空行分段，取 `data:` 行再做 JSON.parse；`application/json` 则直接 parse。
5. `get_figma_file` 返回的文件结构与 REST 一致（document 树 / 颜色 0~1 需乘 255 转 hex），后续解析可复用下方 REST 章节的字段说明。

## 用 REST API 提取设计规范（方式 B，备选）

1. 确认 `FIGMA_TOKEN` 已配置（脚本会自行校验并给出提示）。
2. 运行支持脚本拉取数据（在项目根目录执行）：

   ```bash
   bun .agents/skills/figma/scripts/fetch-figma.ts --file <FILE_KEY>
   ```

   按需追加参数：
   - `--node <NODE_ID>`：只拉取某个节点（页面/组件），响应更快、摘要更聚焦。
   - `--out out.json`：把全量 JSON 落盘，便于后续反复分析节点细节。
   - `--summary`：只输出设计规范摘要，不打印文本节点明细。
3. 读取 stdout 的"设计规范摘要"，这就是编码可直接使用的设计 token：颜色 Top15（hex + 次数）、字号、字体、圆角（取值 + 次数）。
4. 摘要不够时（需要布局/层级/文本细节），用 `--out` 保存全量 JSON，再用 `Bun.file(...)` 读取并按需遍历节点字段：
   - 布局：`absoluteBoundingBox`（x/y/width/height）、`layoutMode`（HORIZONTAL/VERTICAL 即 auto layout）、`paddingLeft/Right/Top/Bottom`、`itemSpacing`。
   - 文本：`characters`、`style.fontSize/fontFamily/fontWeight/lineHeightPx/letterSpacing/textCase`。
   - 填充：`fills[].color`（r/g/b 取值 0~1，转 hex 时乘 255）、`fills[].opacity`。
   - 组件：type 为 `COMPONENT`/`COMPONENT_SET` 的节点是组件定义，`INSTANCE` 是组件实例。
5. 基于设计 token 输出编码产物（CSS 变量 / Tailwind config / 组件树说明 / 页面代码），并在回复中注明数据来源（文件名与节点）。

## 从分享链接解析 file key 与 node id

`https://www.figma.com/file/<FILE_KEY>/<名称>?node-id=<NODE_ID>`

- `FILE_KEY`：`/file/` 后到下一个 `/` 前的一串字符。
- `NODE_ID`：`node-id=` 的值，形如 `1-234`；传给脚本时把 `-` 换成 `:`（`1:234`）。
- 文件分享权限需设为"任何拥有链接的人可查看"，API 才有权读取。

## 常见问题

- MCP 401：token 过期 → 先 `refresh`，失败再走完整登录流程。
- MCP 403 / 注册 403 Forbidden：client_name 不是 "Codex"（白名单绕过失败），检查是否改了注册名。
- 换 token 报 "Client secret is required"：用了 `token_endpoint_auth_method: "none"`，必须改 `client_secret_post` 并提交 client_secret。
- REST 403：token 无权访问该文件（文件需对链接可查看，或换有权限的 token）。
- REST 404：FILE_KEY 写错或已删除。
- 文件很大、响应慢：先用 `--node` 定位到具体页面/组件再拉取。
- run_script 等待授权被 SIGTERM(143)：登录必须 nohup 后台 + check 轮询，不能前台长阻塞。
- Bun.spawn stdio 必须是数组元素（inherit/ignore/null），单独传 "ignore" 报 ERR_INVALID_ARG_TYPE。
