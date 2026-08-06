/**
 * context.ts — 系统提示词组装（P0 + skills 索引 + P2-2 任务模式 + P2-3 预算告警 + P3 安全 + P4 通用化 + P6-2 指令拆分）
 *
 * 结构（§4）：[身份] [能力] [项目] [记忆] [规则]
 * 目标：agent 启动时能准确说出"我是谁、项目结构、上次干了什么、有什么 skills 可用"。
 * 项目级指令：AGENTS.md（通用项目契约）+ BUN_BOT.md（bun-bot 自研细节，P6-2）由
 *             loadProjectContext 加载进 [项目] 区块（最前），并在 [规则] 中声明其约束力
 *             （优先级高于 README / docs）。
 * P2-1 ACI 化：[能力] 区块的工具描述同步带极简 example usage（few-shot），
 *              与 src/tools.ts 的完整工具 description 呼应（双保险）。
 * P2-2 任务模式：--self 时注入 [任务模式] 区块（先 plan 后执行、逐项勾选），
 *              [记忆] 区块展示 activePlan 进度（中断/重启后可继续）。
 * P2-3 上下文预算：[记忆] 区块展示 contextWarnings（超限压缩告警历史），
 *              让 agent 重启后能感知"上次长任务触发了多少次压缩"。
 * P3 安全（质量与防护）：[规则] 声明测试闸门（收尾自动跑测试、失败自动回滚）、
 *              run_bash 写操作自动快照、危险命令拒绝、路径限制工作区内、审计日志。
 * P6-3 生态 skills 对齐：支持扫描 .agents/skills/（Claude Code 生态约定，SKILL.md 带 YAML
 *             frontmatter 自描述 name/description），与仓库内置 skills/ 双目录兼容；
 *             技能目录可 .bunbot.json 的 skillsDir 配置（默认双目录）。
 * P4 通用化（在其他项目使用 bun-bot）：[身份] 用 AGENT_IDENTITY 环境变量可配置
 *              （默认 bun-bot）；[项目] 关键文件按存在性动态生成，不再硬编码
 *              index.ts / src/ 等 bun-bot 自身文件结构 —— 任意项目（无 src/、无 index.ts）
 *              都能构建出准确的项目认知，不会出现误导性的文件路径。
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AgentState, ActivePlan } from "./memory";
import { workspace, STATE_FILE, MEMORY_FILE, AGENTS_FILE, BUN_BOT_FILE } from "./memory";
import { loadConfig } from "./config";

export interface ContextInput {
  state: AgentState;
  project: string;
  /** 任务模式（--self）：注入"先 plan 后执行"流程说明 */
  selfMode?: boolean;
}

/** [身份] 可配置（P4 通用化）：AGENT_IDENTITY 环境变量覆盖默认身份（默认 bun-bot） */
export function identity(): string {
  return loadConfig(workspace()).identity;
}

/**
 * 项目关键文件：按存在性动态生成（P4 通用化 —— 不硬编码 bun-bot 自身文件结构）。
 * 只列出工作区实际存在的常见项目文件；无 src/、无 index.ts 的项目同样能拿到准确认知。
 */
export function keyFilesSection(base = workspace()): string {
  const lines: string[] = [];
  const exists = (p: string) => existsSync(join(base, p));
  const add = (name: string, desc: string) => lines.push("- " + name + "  " + desc);
  if (exists(AGENTS_FILE)) add(AGENTS_FILE, "项目级指令（通用契约，存在时优先级最高，见 [规则]）");
  if (exists(BUN_BOT_FILE)) add(BUN_BOT_FILE, "项目级指令（bun-bot 实现细节，与 AGENTS.md 同级）");
  if (exists("README.md")) add("README.md", "项目说明（已加载进上方 [项目] 区块）");
  if (exists("package.json")) add("package.json", "依赖与脚本（bun/npm 脚本入口与测试命令线索）");
  if (exists("tsconfig.json")) add("tsconfig.json", "TypeScript 配置");
  if (exists("index.ts") || exists("index.js") || exists("main.ts") || exists("main.js")) {
    add("index.ts / main.*", "程序入口（CLI / 主循环）");
  }
  if (exists("src")) add("src/", "源码目录");
  if (exists("tests") || exists("test")) add("tests/", "测试目录（改完必须跑测试验证）");
  if (exists("skills")) add("skills/", "组合操作库（skills/<name>/SKILL.md + 自测）");
  if (exists(".agents")) add(".agents/", "生态目录（Claude Code 约定：skills 技能等，P6-3）");
  if (exists("docs")) add("docs/", "文档（计划/架构/索引）");
  if (exists(".bunbot.json")) add(".bunbot.json", "项目级配置（P4：环境变量 > 配置 > 默认值）");
  if (!lines.length) add("（未识别到常见项目文件，先用 list_dir 看目录结构）", "");
  return lines.join("\n");
}

function planProgress(p: ActivePlan): string {
  const done = p.items.filter((it) => it.done).length;
  return done + "/" + p.items.length + " 完成" + (p.status === "done" ? " ✅" : " ⏳");
}

function memorySection(state: AgentState): string {
  const b: string[] = [];
  if (state.lastTask) {
    b.push("- 上次任务: " + state.lastTask);
    if (state.lastSummary) b.push("  - 结论: " + state.lastSummary);
    if (state.lastRunAt) b.push("  - 结束于: " + state.lastRunAt);
  } else {
    b.push("- 暂无历史任务（首次运行）");
  }
  // P2-2：当前任务计划进度（中断/重启后的续跑锚点）
  if (state.activePlan) {
    b.push("- 当前任务计划: " + state.activePlan.title + "（" + planProgress(state.activePlan) + "）");
    for (const it of state.activePlan.items) {
      b.push("  - [" + (it.done ? "x" : " ") + "] " + it.text + (it.detail ? " — " + it.detail : ""));
    }
  }
  if (state.decisions.length) {
    b.push("- 决策记录:");
    for (const d of state.decisions) b.push("  - [" + d.when + "] " + d.what + (d.why ? "（" + d.why + "）" : ""));
  }
  if (state.pitfalls.length) {
    b.push("- 踩坑:");
    for (const p of state.pitfalls) b.push("  - " + p);
  }
  if (state.todo.length) {
    b.push("- TODO:");
    for (const t of state.todo) b.push("  - " + t);
  }
  // P2-3：上下文预算告警（上次长任务触发过多少次压缩）
  if (state.contextWarnings.length) {
    b.push("- 上下文预算告警:");
    for (const w of state.contextWarnings) b.push("  - " + w);
  }
  return b.join("\n");
}


/**
 * 配置的技能目录（P6-3 生态对齐）：默认双目录兼容 ——
 *   .agents/skills   Claude Code 生态约定（SKILL.md + YAML frontmatter 自描述）
 *   skills           仓库内置组合操作库（skills/README.md 索引表）
 * 可用 .bunbot.json 的 skillsDir 覆盖（字符串或数组）。
 */
export function skillsDirs(): string[] {
  const cfg = loadConfig(workspace()).skillsDir;
  return Array.isArray(cfg) && cfg.length ? cfg : [".agents/skills", "skills"];
}

/** 解析 SKILL.md 开头的 YAML frontmatter（--- 包裹），提取 name / description（P6-3） */
export function parseFrontmatter(md: string): { name?: string; description?: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  if (!m) return {};
  try {
    const data = Bun.YAML.parse(m[1]) as Record<string, unknown>;
    return {
      // frontmatter 里允许省略 name/description，此时由调用方用目录名/文件名兜底
      name: typeof data.name === "string" ? data.name : undefined,
      description: typeof data.description === "string" ? data.description : undefined,
    };
  } catch {
    // frontmatter 不是合法 YAML 时静默降级，不影响其它技能加载
    return {};
  }
}

/** 扫描单个生态技能目录（.agents/skills 形态），返回技能清单（P6-3） */
function scanEcosystemSkills(
  base: string,
  dir: string,
): { name: string; description: string; path: string }[] {
  const out: { name: string; description: string; path: string }[] = [];
  const walk = (rel: string) => {
    let entries: string[];
    try {
      entries = readdirSync(join(base, rel));
    } catch {
      return;
    }
    for (const e of entries) {
      const childRel = rel ? rel + "/" + e : e;
      const child = join(base, childRel);
      let isDir = false;
      try {
        isDir = statSync(child).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        walk(childRel);
      } else if (e.endsWith(".md")) {
        // 只认目录型 <技能>/SKILL.md 与顶层单文件 <技能>.md，
        // 跳过技能支持目录里的普通 md（如 foo/docs/readme.md），避免误判为技能
        const isDirSkill = e === "SKILL.md";
        const isFileSkill = !childRel.includes("/");
        if (!isDirSkill && !isFileSkill) continue;
        let md = "";
        try {
          md = readFileSync(child, "utf8");
        } catch {
          continue;
        }
        const { name, description } = parseFrontmatter(md);
        const skillName = name ?? (isDirSkill ? rel : childRel.slice(0, -".md".length));
        out.push({
          name: skillName,
          description: description ?? "（无描述，请直接读取技能文件）",
          path: dir + "/" + childRel,
        });
      }
    }
  };
  walk("");
  return out;
}

/**
 * 扫描配置的生态技能目录（默认 .agents/skills/），frontmatter 自描述，返回索引文本（P6-3）。
 * 与 skillsIndex()（skills/README.md 索引）双目录兼容：两者都在 [能力] 区块展示。
 */
export function agentSkillsIndex(): string {
  const rows: string[] = [];
  for (const dir of skillsDirs()) {
    if (dir === "skills") continue; // skills/ 走 README 索引（skillsIndex 处理）
    const base = join(workspace(), dir);
    if (!existsSync(base)) continue;
    for (const s of scanEcosystemSkills(base, dir)) {
      rows.push("  - " + s.name + ": " + s.description + "（技能文件: " + s.path + "）");
    }
  }
  return rows.join("\n");
}

/**
 * 从 skills/README.md 提取索引表格（`## 索引` 下的行），转成紧凑列表。
 * 没有 skills/README.md 或没有索引表格时返回空串（老项目系统提示词保持不变）。
 */
export function skillsIndex(): string {
  try {
    const p = join(workspace(), "skills", "README.md");
    if (!existsSync(p)) return "";
    const lines = readFileSync(p, "utf8").split("\n");
    const rows: string[] = [];
    let inIndex = false;
    for (const line of lines) {
      if (line.startsWith("## ")) {
        inIndex = line.startsWith("## 索引");
        continue;
      }
      if (!inIndex || !line.trim().startsWith("|")) continue;
      const cells = line.split("|").map((c) => c.trim()).filter((c) => c !== "");
      if (cells.length < 2 || cells[0] === "skill" || cells[0] === "---") continue;
      rows.push("  - " + cells[0] + ": " + cells[1] + "（自测: " + (cells[3] ?? "见 SKILL.md") + "）");
    }
    return rows.join("\n");
  } catch {
    return "";
  }
}

/** 任务模式说明（P2-2）：--self 时注入，让 agent 先 plan 后执行、逐项勾选 */
function taskModeSection(state: AgentState): string {
  const b: string[] = [];
  b.push("[任务模式] 本次以任务模式运行（--self）：长任务自主迭代，进度持久化可续跑。");
  b.push("1. 首轮先用 update_plan 创建计划：把任务拆成可独立验证的分步 items（每步小到能单独跑脚本/测试确认）。");
  b.push("2. 逐项执行：每完成一步，用 update_plan 全量提交最新计划并勾选该项（done: true，detail 写验证结果）。");
  b.push("3. 全部完成：update_plan 全部 done 后，给出最终总结。");
  if (state.activePlan && state.activePlan.status === "active") {
    b.push("检测到上次未完成的计划「" + state.activePlan.title + "」（见 [记忆]），优先继续它而非重建：从第一个未勾选项继续。");
  }
  return b.join("\n");
}

/** 组装完整系统提示词。目标预算 < 5%（1M 上下文下 < 5 万 token）。 */
export function buildSystemPrompt(ctx: ContextInput): string {
  const { state, project } = ctx;
  const b: string[] = [];
  b.push("[身份] " + identity());
  b.push("");
  b.push("我喜欢用实际运行代码来验证想法，而不是凭空猜测。能用代码验证的事情就写代码验证，脚本里用 console.log 输出需要观察的结果。任务完成后，用简洁的中文总结结论和关键过程。");
  b.push("");
  b.push("[能力] 我拥有以下工具（注册表模式，读自己 → 改自己 → 测自己）：");
  b.push("- run_script: 用 Bun 运行 JS/TS 脚本。默认 cwd 是临时目录（沙箱），可指定 cwd 到工作区操作项目文件；timeoutMs 可放开长任务；输出上限 64KB。示例：{\\\"code\\\":\\\"console.log(1+1)\\\"}、{\\\"code\\\":\\\"await Bun.write('x.txt','hi')\\\",\\\"cwd\\\":\\\".\\\"}");
  b.push("- read_file: 读取工作区文件（UTF-8），默认完整返回 64KB，大文件可 offset 续读。示例：{\\\"path\\\":\\\"src/tools.ts\\\"}、{\\\"path\\\":\\\"src/tools.ts\\\",\\\"offset\\\":65536}");
  b.push("- write_file: 写工作区文件，自动 git 快照 + diff 摘要。改自己代码就靠它。示例：{\\\"path\\\":\\\"src/hello.ts\\\",\\\"content\\\":\\\"console.log('hi')\\\"}");
  b.push("- list_dir: 列目录（-a 显示隐藏文件、depth 限制递归深度）。示例：{\\\"path\\\":\\\".\\\",\\\"all\\\":true,\\\"depth\\\":2}");
  b.push("- run_bash: 执行 shell 命令，cwd 默认工作区，可跑 git / bun test 等；写操作命令前自动 git 快照；危险命令会被拒绝。示例：{\\\"command\\\":\\\"bun test\\\"}、{\\\"command\\\":\\\"git status --short\\\"}");
  b.push("- update_plan: 更新任务计划（任务模式）。全量覆盖式：首轮创建（title + 分步 items），每完成一步提交完整计划并勾选 done，进度写回状态跨会话保存。示例：{\\\"title\\\":\\\"新增工具\\\",\\\"items\\\":[{\\\"text\\\":\\\"注册\\\",\\\"done\\\":false}]}");
  const sk = skillsIndex();
  const eco = agentSkillsIndex();
  if (sk || eco) {
    b.push("");
    b.push("可用 skills（组合操作：多步 + 有坑 + 会过时的操作，细节按需 read_file 加载对应 SKILL.md，路径见各条目）：");
    b.push("  - skills/<name>/SKILL.md（仓库内置，索引见 skills/README.md）；.agents/skills/ 为生态技能（frontmatter 自描述）");
    if (sk) b.push(sk);
    if (eco) b.push(eco);
  }
  b.push("");
  b.push("[项目] 当前工作区: " + workspace());
  b.push(project);
  b.push("");
  b.push("关键文件（按存在性列出，不存在的不在列表中）:");
  b.push(keyFilesSection());
  b.push("");
  b.push("[记忆] 上次任务的决策、踩坑、TODO、当前任务计划、上下文预算告警（来自 " + STATE_FILE + " / " + MEMORY_FILE + "）：");
  b.push(memorySection(state));
  b.push("");
  if (ctx.selfMode) {
    b.push(taskModeSection(state));
    b.push("");
  }
  b.push("[规则]");
  b.push("1. 修改工作区文件前必须 git 快照（write_file / run_bash 写操作已自动处理）；改完必须跑 tests/ 验证。");
  b.push("2. 工具输出默认完整读取，不要假设被截断；大文件用偏移续读。");
  b.push("3. 需要长任务时，给 run_script / run_bash 传更大的 timeoutMs（如 120000），别等超时。");
  b.push("4. 结论用简洁中文总结，说明做了什么、怎么验证的、结果如何。");
  b.push("5. 若工作区根目录存在 " + AGENTS_FILE + "（连同 " + BUN_BOT_FILE + "），它是用户与我的项目级契约，约束力高于 [项目] 区块中 README/docs 的描述；内容冲突时以 " + AGENTS_FILE + " / " + BUN_BOT_FILE + " 为准。");
  b.push("6. P3 安全：路径（cwd / path）默认限制在工作区内；run_bash 危险命令（rm -rf /、git push、fork bomb 等）会被权限系统直接拒绝 —— 被拒后改用安全写法或 write_file。");
  b.push("7. P3 测试闸门：本会话发生过自修改（write_file / 写操作 run_bash）时，收尾会自动跑 bun test；失败会自动回滚到会话开始前 —— 不用手动 revert，被回滚后重新检查改动。");
  b.push("8. P3 审计：每次工具调用都会记录入参/出参摘要到 " + "AUDIT.log.jsonl" + "（本地持久化，gitignore）。");
  return b.join("\n");
}
