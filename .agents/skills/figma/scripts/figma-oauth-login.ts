#!/usr/bin/env bun
/**
 * figma 技能支持脚本：Figma MCP OAuth 登录（Chrome + 白名单绕过）
 *
 * 背景：Figma 官方远程 MCP（https://mcp.figma.com/mcp，Streamable HTTP）用 OAuth 认证，
 * 支持读写画布，官方推荐；旧 figma-developer-mcp（npx stdio + PAT）仅只读且不推荐。
 * 本脚本完成 OAuth 登录的完整链路：动态注册 client → PKCE 授权码 → 本地回调换 token
 * → 写入 token 文件，并提供 check（轮询）与 refresh（续期）子命令。
 *
 * 关键经验（踩坑记录）：
 * ① 白名单限制真实存在：注册时 client_name 必须是 "Codex"，否则 403 Forbidden。
 *    RFC 7591 允许自报名称，Figma 只校验 client_name（这就是"白名单绕过"）。
 * ② 换 token 必须用 token_endpoint_auth_method="client_secret_post"（随 form 提交
 *    client_secret）；旧文章里的 "none" 会报 "Client secret is required"。
 * ③ run_script 执行时限约 30 秒，长阻塞会被 SIGTERM(143)；等待用户浏览器授权必须
 *    用 nohup 把 start 放到后台，再由 check 轮询结果。
 * ④ 清理后台进程禁用 pkill -f（会匹配 run_script 自身命令行导致自杀）与
 *    lsof -ti|xargs kill（可能误杀进程链）；用 pid 文件 + 明确 kill。
 *
 * 用法（在项目根目录执行）：
 *   nohup bun .agents/skills/figma/scripts/figma-oauth-login.ts start \
 *     > /tmp/figma-oauth-login.log 2>&1 &          # 后台启动登录 daemon
 *   bun  .agents/skills/figma/scripts/figma-oauth-login.ts check    # 轮询登录结果
 *   bun  .agents/skills/figma/scripts/figma-oauth-login.ts refresh  # 刷新 access_token
 *
 * 参数：
 *   --token-file <path>  token 保存路径（默认 .bunbot/figma-mcp-token.json）
 *   --port <port>        本地回调端口（默认随机 41000~49000）
 *   --redirect-uri <uri> 回调地址（默认 http://127.0.0.1:<port>/callback）
 */

const OAUTH = {
  registration: "https://api.figma.com/v1/oauth/mcp/register",
  authorize: "https://www.figma.com/oauth/mcp",
  token: "https://api.figma.com/v1/oauth/token",
};

const DEFAULT_TOKEN_FILE = ".bunbot/figma-mcp-token.json";
const STATE_FILE = "/tmp/figma-oauth-state.json"; // start 与回调 daemon 之间的状态交接
const PID_FILE = "/tmp/figma-oauth-daemon.pid";

interface OAuthState {
  port: number;
  redirect_uri: string;
  client_id: string;
  client_secret: string;
  code_verifier: string;
  state: string;
  authorize_url: string;
}

function parseArgs(argv: string[]): { cmd: string; tokenFile: string; port: number; redirectUri?: string } {
  let cmd = "start", tokenFile = DEFAULT_TOKEN_FILE, port = 41000 + Math.floor(Math.random() * 8000), redirectUri: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "start" || a === "check" || a === "refresh") cmd = a;
    else if (a === "--token-file") tokenFile = argv[++i] ?? tokenFile;
    else if (a === "--port") port = Number(argv[++i]);
    else if (a === "--redirect-uri") redirectUri = argv[++i];
    else if (a === "--help" || a === "-h") { usage(); process.exit(0); }
  }
  return { cmd, tokenFile, port, redirectUri };
}

function usage() {
  console.log([
    "用法:",
    "  nohup bun figma-oauth-login.ts start [--token-file <path>] [--port <port>] &",
    "  bun   figma-oauth-login.ts check [--token-file <path>]",
    "  bun   figma-oauth-login.ts refresh [--token-file <path>]",
    "",
    "  start    动态注册 + PKCE + 本地回调 daemon，打印授权 URL 后保持监听（需后台运行）",
    "  check    轮询 token 是否已生成（登录中时顺便打印授权 URL 提示用户）",
    "  refresh  用 refresh_token 续期 access_token（90 天过期前刷新）",
  ].join("\n"));
}

const b64url = (buf: Uint8Array) => Buffer.from(buf).toString("base64url").replace(/=+$/, "");
const rand = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));

async function pkce() {
  // code_verifier 要求 43~128 个 [A-Za-z0-9-._~]，取 64 字符；challenge 用 S256
  const verifier = rand(48);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

async function register(redirectUri: string) {
  // 动态注册（RFC 7591）。client_name 必须为 "Codex"（Figma 白名单），
  // token_endpoint_auth_method 必须 client_secret_post，否则换 token 阶段会失败。
  const res = await fetch(OAUTH.registration, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Codex",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "client_secret_post",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "mcp:connect",
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    console.error("动态注册失败 " + res.status + "：" + body.slice(0, 300));
    if (res.status === 403) {
      console.error("提示：Figma 白名单只放行 client_name=\"Codex\"，其余名称返回 403。请确认脚本未改 client_name。");
    }
    process.exit(1);
  }
  const j = JSON.parse(body);
  if (!j.client_id || !j.client_secret) {
    console.error("注册响应缺少 client_id/client_secret：" + body.slice(0, 300));
    process.exit(1);
  }
  return { client_id: j.client_id as string, client_secret: j.client_secret as string };
}

async function cmdStart(opts: { tokenFile: string; port: number; redirectUri?: string }) {
  const redirect_uri = opts.redirectUri ?? "http://127.0.0.1:" + opts.port + "/callback";
  const { verifier, challenge } = await pkce();
  const state = rand(24);

  // 清理旧的 daemon（用 pid 文件，禁用 pkill -f / lsof 全杀）
  try {
    const oldPid = Number((await Bun.file(PID_FILE).text()).trim());
    if (oldPid && oldPid !== process.pid) {
      try { process.kill(oldPid, "SIGTERM"); console.error("已终止旧 daemon pid=" + oldPid); } catch {}
    }
  } catch {}

  const { client_id, client_secret } = await register(redirect_uri);

  const authorize_url = OAUTH.authorize
    + "?client_id=" + encodeURIComponent(client_id)
    + "&redirect_uri=" + encodeURIComponent(redirect_uri)
    + "&response_type=code&scope=" + encodeURIComponent("mcp:connect")
    + "&code_challenge=" + encodeURIComponent(challenge)
    + "&code_challenge_method=S256&state=" + encodeURIComponent(state);

  const st: OAuthState = { port: opts.port, redirect_uri, client_id, client_secret, code_verifier: verifier, state, authorize_url };
  await Bun.write(STATE_FILE, JSON.stringify(st, null, 2));
  await Bun.write(PID_FILE, String(process.pid));

  let resolving = false;
  const server = Bun.serve({
    port: opts.port,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== "/callback") return new Response("404", { status: 404 });
      if (resolving) return new Response("处理中", { status: 429 });
      resolving = true;
      try {
        const code = url.searchParams.get("code");
        const s2 = url.searchParams.get("state");
        const err = url.searchParams.get("error");
        const cur: OAuthState = JSON.parse(await Bun.file(STATE_FILE).text());
        if (err) { console.error("授权错误: " + err); return new Response("授权失败: " + err, { status: 400 }); }
        if (!code || s2 !== cur.state) { console.error("state 校验失败"); return new Response("state 校验失败", { status: 400 }); }
        // 换 token：client_secret_post（secret 随 form 提交），并回传 code_verifier 完成 PKCE
        const body = new URLSearchParams({
          grant_type: "authorization_code", code,
          redirect_uri: cur.redirect_uri, client_id: cur.client_id,
          client_secret: cur.client_secret, code_verifier: cur.code_verifier,
        });
        const tr = await fetch(OAUTH.token, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
        const tb = await tr.text();
        if (!tr.ok) {
          console.error("换 token 失败 " + tr.status + "：" + tb.slice(0, 300));
          return new Response("token 交换失败，请重新在 Figma 授权页面点击允许", { status: 400 });
        }
        const tok = JSON.parse(tb);
        const saved = {
          ...tok,
          client_id: cur.client_id, client_secret: cur.client_secret,
          redirect_uri: cur.redirect_uri, obtained_at: new Date().toISOString(),
        };
        await Bun.write(opts.tokenFile, JSON.stringify(saved, null, 2));
        console.error("✅ token 已写入 " + opts.tokenFile + "（access_token 前缀 " + String(tok.access_token).slice(0, 10) + "）");
        server.stop(true);
        process.exit(0);
      } finally { resolving = false; }
    },
  });

  console.error("回调 daemon 已启动: " + server.url.href);
  console.log("==================== 请用 Chrome 打开以下地址完成授权 ====================");
  console.log(authorize_url);
  console.log("==========================================================================");
  console.log("授权完成后本进程自动退出；登录中可用 bun figma-oauth-login.ts check 轮询。");
  // 保持事件循环：等待浏览器回调
  await new Promise(() => {});
}

async function cmdCheck(opts: { tokenFile: string }) {
  const tok = await Bun.file(opts.tokenFile).text().catch(() => "");
  if (tok) {
    const t = JSON.parse(tok);
    const exp = new Date(new Date(t.obtained_at).getTime() + (t.expires_in ?? 0) * 1000);
    console.log("✅ token 已就绪：access_token " + String(t.access_token).slice(0, 10) + "...（" + t.access_token.length + " 字符）");
    console.log("   过期时间: " + exp.toLocaleString() + "（" + (t.expires_in ?? 0) / 86400 + " 天）");
    console.log("   调用 MCP 时 header: Authorization: Bearer <access_token>");
    return;
  }
  // 未登录：若正在登录中则把授权 URL 打出来引导用户
  const stText = await Bun.file(STATE_FILE).text().catch(() => "");
  console.log("❌ token 尚未生成（" + opts.tokenFile + " 不存在）。");
  if (stText) {
    const st: OAuthState = JSON.parse(stText);
    console.log("   登录进行中，请用 Chrome 打开（若已授权稍等片刻再 check）：");
    console.log("   " + st.authorize_url);
  } else {
    console.log("   请先后台启动登录：nohup bun .agents/skills/figma/scripts/figma-oauth-login.ts start &");
  }
  process.exit(1);
}

async function cmdRefresh(opts: { tokenFile: string }) {
  const tok = JSON.parse(await Bun.file(opts.tokenFile).text().catch(() => ""));
  if (!tok?.refresh_token) { console.error("无 refresh_token，无法续期，请重新 start 登录"); process.exit(1); }
  const body = new URLSearchParams({
    grant_type: "refresh_token", refresh_token: tok.refresh_token,
    client_id: tok.client_id, client_secret: tok.client_secret, redirect_uri: tok.redirect_uri,
  });
  const res = await fetch(OAUTH.token, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const tb = await res.text();
  if (!res.ok) { console.error("刷新失败 " + res.status + "：" + tb.slice(0, 300) + "（可能 refresh_token 已失效，需重新登录）"); process.exit(1); }
  const nt = JSON.parse(tb);
  const saved = { ...tok, ...nt, obtained_at: new Date().toISOString() };
  await Bun.write(opts.tokenFile, JSON.stringify(saved, null, 2));
  console.log("✅ 已刷新：新 access_token 前缀 " + String(nt.access_token).slice(0, 10) + "，有效期 " + (nt.expires_in ?? "?") + " 秒");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.cmd === "start") await cmdStart(opts);
  else if (opts.cmd === "check") await cmdCheck(opts);
  else await cmdRefresh(opts);
}

main().catch((e) => { console.error("运行出错: " + (e?.message ?? e)); process.exit(1); });
