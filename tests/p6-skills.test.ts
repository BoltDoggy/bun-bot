/**
 * p6-skills.test.ts — P6-3 .agents/skills 生态对齐（吸收 research 分支 skills.ts 理念）
 *
 * 背景：research 分支对齐 Claude Code 生态的 `.agents/skills` 技能约定 —— 每个技能
 *       SKILL.md 带 YAML frontmatter（name / description）自描述，扫描后注入技能清单
 *       （不注入全文，按需读取，省 token）。主线 P6-3 落地同一理念，并与仓库内置
 *       `skills/`（README 索引）双目录兼容；技能目录可 .bunbot.json 的 skillsDir 配置。
 *
 * 验证：
 *   1. parseFrontmatter 解析 YAML frontmatter（name / description；无 frontmatter / 非法 YAML 降级）
 *   2. agentSkillsIndex 扫描 .agents/skills/：目录型 <技能>/SKILL.md + 单文件型 <技能>.md，
 *      name 缺省时用目录名/文件名兜底；无目录返回空串
 *   3. buildSystemPrompt [能力] 区块同时包含 skills/ 索引与 .agents/skills 生态技能（双目录兼容）
 *   4. skillsDir 配置可覆盖（.bunbot.json 指定自定义目录）
 *   5. 跳过技能支持目录里的普通 md（如 foo/docs/readme.md，避免误判为技能）
 *
 * 运行：bun test
 */
import { test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSystemPrompt, parseFrontmatter, agentSkillsIndex, skillsDirs } from "../src/context";
import { loadState, workspace } from "../src/memory";
import { loadConfig } from "../src/config";

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "bun-bot-p6-skills-"));
  process.env.BUN_BOT_WORKSPACE = tmp;
});
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.BUN_BOT_WORKSPACE;
});

// ---------- parseFrontmatter ----------

test("P6-3 parseFrontmatter 解析 YAML frontmatter（name / description）", () => {
  const md = [
    "---",
    "name: web-search",
    "description: 联网搜索（Bing + DDG）",
    "version: v2",
    "---",
    "",
    "# web-search",
  ].join("\n");
  const fm = parseFrontmatter(md);
  expect(fm.name).toBe("web-search");
  expect(fm.description).toBe("联网搜索（Bing + DDG）");
});

test("P6-3 parseFrontmatter：无 frontmatter / 非法 YAML 返回空对象（静默降级）", () => {
  expect(parseFrontmatter("# 没有 frontmatter\n正文")).toEqual({});
  expect(parseFrontmatter("---\nname: [broken\n---\n")).toEqual({});
  expect(parseFrontmatter("---\nname: 只有 name\n---\n").name).toBe("只有 name");
  expect(parseFrontmatter("---\nname: 只有 name\n---\n").description).toBeUndefined();
});

// ---------- agentSkillsIndex ----------

function makeEcoSkills(): void {
  // 目录型技能（frontmatter 自描述）
  mkdirSync(join(tmp, ".agents", "skills", "web-search"), { recursive: true });
  writeFileSync(
    join(tmp, ".agents", "skills", "web-search", "SKILL.md"),
    "---\nname: web-search\ndescription: 联网搜索（生态版）\n---\n\n# web-search\n",
  );
  // 目录型技能（无 frontmatter，name 用目录名兜底）
  mkdirSync(join(tmp, ".agents", "skills", "git-workflow"), { recursive: true });
  writeFileSync(join(tmp, ".agents", "skills", "git-workflow", "SKILL.md"), "# git-workflow\n");
  // 单文件型技能
  writeFileSync(
    join(tmp, ".agents", "skills", "release.md"),
    "---\ndescription: 发布流程\n---\n\n# release\n",
  );
  // 技能支持目录里的普通 md（不应被识别为技能）
  mkdirSync(join(tmp, ".agents", "skills", "web-search", "docs"), { recursive: true });
  writeFileSync(join(tmp, ".agents", "skills", "web-search", "docs", "readme.md"), "# 帮助文档\n");
}

test("P6-3 agentSkillsIndex 扫描 .agents/skills/：目录型 + 单文件型，frontmatter 自描述 + 兜底", () => {
  makeEcoSkills();
  const idx = agentSkillsIndex();
  // 目录型：frontmatter name
  expect(idx).toContain("web-search: 联网搜索（生态版）");
  expect(idx).toContain(".agents/skills/web-search/SKILL.md");
  // 目录型：无 frontmatter → 目录名兜底，无描述提示
  expect(idx).toContain("git-workflow: （无描述，请直接读取技能文件）");
  // 单文件型：无 name → 文件名兜底；有 description
  expect(idx).toContain("release: 发布流程");
  expect(idx).toContain(".agents/skills/release.md");
  // 支持目录里的普通 md 不误判
  expect(idx).not.toContain("readme");
});

test("P6-3 无 .agents/skills 目录时 agentSkillsIndex 返回空串", () => {
  const empty = join(tmp, "no-eco");
  mkdirSync(empty, { recursive: true });
  const oldWs = process.env.BUN_BOT_WORKSPACE;
  process.env.BUN_BOT_WORKSPACE = empty;
  try {
    expect(agentSkillsIndex()).toBe("");
  } finally {
    process.env.BUN_BOT_WORKSPACE = oldWs!;
  }
});

// ---------- buildSystemPrompt 双目录兼容 ----------

test("P6-3 buildSystemPrompt [能力] 区块同时包含 skills/ 索引与 .agents/skills 生态技能（双目录兼容）", () => {
  // 仓库内置 skills/README.md 索引
  mkdirSync(join(tmp, "skills"), { recursive: true });
  writeFileSync(join(tmp, "skills", "README.md"), [
    "# skills",
    "",
    "## 索引",
    "",
    "| skill | 一句话 | 版本 | 自测 |",
    "| --- | --- | --- | --- |",
    "| web-search | 联网搜索（Bing + DDG） | v2 | bun run skills/web-search/self-test.ts |",
  ].join("\n"));
  makeEcoSkills();

  const prompt = buildSystemPrompt({ state: loadState(), project: "proj" });
  // 内置索引
  expect(prompt).toContain("可用 skills");
  expect(prompt).toContain("skills/<name>/SKILL.md");
  expect(prompt).toContain("web-search: 联网搜索（Bing + DDG）");
  // 生态技能
  expect(prompt).toContain("web-search: 联网搜索（生态版）");
  expect(prompt).toContain(".agents/skills/");
});

// ---------- skillsDir 配置 ----------

test("P6-3 skillsDir 配置可覆盖（.bunbot.json 指定自定义目录）", () => {
  const proj = join(tmp, "custom-skills");
  mkdirSync(join(proj, "my-skills", "hello"), { recursive: true });
  writeFileSync(join(proj, "my-skills", "hello", "SKILL.md"), "---\nname: hello\ndescription: 打招呼\n---\n");
  writeFileSync(join(proj, ".bunbot.json"), JSON.stringify({ skillsDir: "my-skills" }));

  const oldWs = process.env.BUN_BOT_WORKSPACE;
  process.env.BUN_BOT_WORKSPACE = proj;
  try {
    // 配置为字符串 → 归一为数组
    const cfg = loadConfig(proj);
    expect(Array.isArray(cfg.skillsDir)).toBe(true);
    expect(cfg.skillsDir).toEqual(["my-skills"]);
    // skillsDirs() 读配置
    expect(skillsDirs()).toEqual(["my-skills"]);
    // 索引只扫自定义目录
    const idx = agentSkillsIndex();
    expect(idx).toContain("hello: 打招呼");
    expect(idx).not.toContain("web-search");
  } finally {
    process.env.BUN_BOT_WORKSPACE = oldWs!;
  }
});

test("P6-3 skillsDir 默认双目录（.agents/skills + skills），非法配置兜底默认值", () => {
  expect(workspace()).toBe(tmp);
  // 默认（无配置）：双目录
  const proj = join(tmp, "default-dirs");
  mkdirSync(proj, { recursive: true });
  const oldWs = process.env.BUN_BOT_WORKSPACE;
  process.env.BUN_BOT_WORKSPACE = proj;
  try {
    expect(loadConfig(proj).skillsDir).toEqual([".agents/skills", "skills"]);
    // 非法配置（空数组 / 非数组）→ 兜底默认
    writeFileSync(join(proj, ".bunbot.json"), JSON.stringify({ skillsDir: [] }));
    expect(loadConfig(proj).skillsDir).toEqual([".agents/skills", "skills"]);
    writeFileSync(join(proj, ".bunbot.json"), JSON.stringify({ skillsDir: 42 }));
    expect(loadConfig(proj).skillsDir).toEqual([".agents/skills", "skills"]);
  } finally {
    process.env.BUN_BOT_WORKSPACE = oldWs!;
  }
  expect(existsSync(join(tmp, "AGENTS.md"))).toBe(false); // 清理断言占位
});
