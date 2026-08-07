#!/usr/bin/env bun
/**
 * figma 技能支持脚本：通过 Figma REST API 拉取设计稿节点数据，并汇总成编码可直接使用的设计规范。
 *
 * 用法（在技能目录 .agents/skills/figma/ 下执行）：
 *   bun scripts/fetch-figma.ts --file <FILE_KEY> [--node <NODE_ID>] [--out out.json] [--summary]
 *
 * 参数：
 *   --file, -f  必填。Figma 文件 key（从分享链接解析：figma.com/file/<KEY>/<name>?node-id=<NODE>）
 *   --node, -n  可选。只拉取指定节点及其子树（链接里的 node-id 需把 - 换成 :，如 1:234）
 *   --out,  -o  可选。全量原始 JSON 写入路径（默认只打印摘要）
 *   --summary   可选。只打印设计规范摘要，不打印节点树（默认打印摘要 + 顶层节点结构）
 *
 * 前置：环境变量 FIGMA_TOKEN（Figma 个人设置 → Security → Personal access tokens）
 */

interface Args { file?: string; node?: string; out?: string; summary?: boolean }

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file" || a === "-f") args.file = argv[++i];
    else if (a === "--node" || a === "-n") args.node = argv[++i];
    else if (a === "--out" || a === "-o") args.out = argv[++i];
    else if (a === "--summary" || a === "-s") args.summary = true;
    else if (a === "--help" || a === "-h") { console.log(usage()); process.exit(0); }
  }
  return args;
}

function usage(): string {
  return [
    "用法: bun scripts/fetch-figma.ts --file <FILE_KEY> [--node <NODE_ID>] [--out out.json] [--summary]",
    "",
    "  --file, -f  必填。Figma 文件 key",
    "  --node, -n  可选。节点 id（把链接里的 - 换成 :）",
    "  --out,  -o  可选。全量 JSON 输出路径",
    "  --summary   可选。只输出设计规范摘要",
  ].join("\n");
}

const FIGMA_API = Bun.env.FIGMA_API_BASE ?? "https://api.figma.com/v1";

interface FigmaNode {
  id: string;
  name: string;
  type: string;
  children?: FigmaNode[];
  characters?: string;
  style?: Record<string, unknown>;
  fills?: Array<{ type: string; color?: { r: number; g: number; b: number; a?: number }; opacity?: number }>;
  backgroundColor?: { r: number; g: number; b: number; a?: number };
  fillStyleId?: string;
  cornerRadius?: number;
  layoutMode?: string;
  itemSpacing?: number;
  paddingLeft?: number; paddingRight?: number; paddingTop?: number; paddingBottom?: number;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  [k: string]: unknown;
}

function hex(c: { r: number; g: number; b: number }, a?: number): string {
  const to = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, "0");
  const alpha = a !== undefined && a < 1 ? to(a) : "";
  return "#" + to(c.r) + to(c.g) + to(c.b) + alpha;
}

function collect(node: FigmaNode, acc: {
  colors: Map<string, number>;
  fontSizes: Map<number, number>;
  fontFamilies: Map<string, number>;
  textCases: Map<string, number>;
  cornerRadii: Map<number, number>;
  textCount: number;
  frameCount: number;
  componentCount: number;
  imageCount: number;
  texts: Array<{ id: string; name: string; characters: string; style: Record<string, unknown> }>;
}) {
  const add = (m: Map<string | number, number>, k: string | number) => m.set(k, (m.get(k) ?? 0) + 1);

  if (node.type === "TEXT") {
    acc.textCount++;
    const s = node.style ?? {};
    if (typeof s.fontSize === "number") add(acc.fontSizes, s.fontSize);
    if (typeof s.fontFamily === "string") add(acc.fontFamilies, s.fontFamily);
    if (typeof s.textCase === "string") add(acc.textCases, s.textCase);
    if (node.characters) acc.texts.push({ id: node.id, name: node.name, characters: node.characters.slice(0, 80), style: s });
  }
  if (node.type === "FRAME" || node.type === "SECTION") acc.frameCount++;
  if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") acc.componentCount++;
  if (node.type === "RECTANGLE" || node.type === "ELLIPSE" || node.type === "VECTOR" || node.type === "LINE") acc.imageCount++;

  for (const f of node.fills ?? []) {
    if (f.type === "SOLID" && f.color) add(acc.colors, hex(f.color, f.opacity ?? f.color.a));
  }
  if (node.backgroundColor?.r !== undefined && node.backgroundColor?.g !== undefined && node.backgroundColor?.b !== undefined) {
    add(acc.colors, hex(node.backgroundColor, node.backgroundColor.a));
  }
  if (typeof node.cornerRadius === "number" && node.cornerRadius > 0) add(acc.cornerRadii, node.cornerRadius);

  for (const c of node.children ?? []) collect(c, acc);
}

function topSummary(colors: Map<string, number>, limit = 15): string[] {
  return [...colors.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([k, v]) => k + "  ×" + v);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = Bun.env.FIGMA_TOKEN;

  if (!token) {
    console.error("缺少 FIGMA_TOKEN 环境变量（Figma → Settings → Security → Personal access tokens）");
    console.error("可写入项目根 .env：FIGMA_TOKEN=figd_xxx");
    process.exit(1);
  }
  if (!args.file) {
    console.error("缺少 --file <FILE_KEY>。从 Figma 分享链接解析：https://www.figma.com/file/<KEY>/<name>?node-id=<NODE>");
    process.exit(1);
  }

  const headers = { Authorization: "Bearer " + token };
  let url: string;
  if (args.node) {
    url = FIGMA_API + "/files/" + args.file + "/nodes?ids=" + encodeURIComponent(args.node);
  } else {
    url = FIGMA_API + "/files/" + args.file;
  }

  console.error("GET " + url);
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("Figma API 请求失败（" + res.status + "）：" + body.slice(0, 300));
    console.error("检查：FILE_KEY 是否正确、FIGMA_TOKEN 是否有权限访问该文件");
    process.exit(1);
  }
  const data = await res.json();

  // 节点：整文件取 document；按节点拉取时取 nodes 里第一个节点的 document
  let doc: FigmaNode | undefined = (data as any).document;
  const nodesMap = (data as any).nodes;
  if (!doc && nodesMap) {
    const first = Object.values(nodesMap)[0] as any;
    doc = first?.document;
  }
  if (!doc) {
    console.error("未能从响应中解析出文档节点");
    process.exit(1);
  }

  if (args.out) {
    await Bun.write(args.out, JSON.stringify(data, null, 2));
    console.error("全量数据已写入 " + args.out);
  }

  const acc = {
    colors: new Map<string, number>(), fontSizes: new Map<number, number>(),
    fontFamilies: new Map<string, number>(), textCases: new Map<string, number>(),
    cornerRadii: new Map<number, number>(), textCount: 0, frameCount: 0,
    componentCount: 0, imageCount: 0, texts: [] as Array<{ id: string; name: string; characters: string; style: Record<string, unknown> }>,
  };
  collect(doc, acc);

  console.log("文件: " + ((data as any).name ?? doc.name ?? args.file));
  console.log("节点数统计: 文本 " + acc.textCount + " / 画框 " + acc.frameCount + " / 组件 " + acc.componentCount + " / 图形 " + acc.imageCount);
  console.log("\n=== 设计规范摘要 ===");
  console.log("[颜色 Top15]  " + (topSummary(acc.colors).join(", ") || "无"));
  console.log("[字号]        " + ([...acc.fontSizes.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => k + "px×" + v).join(", ") || "无"));
  console.log("[字体]        " + ([...acc.fontFamilies.entries()].map(([k, v]) => k + "×" + v).join(", ") || "无"));
  console.log("[圆角]        " + ([...acc.cornerRadii.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => k + "px×" + v).join(", ") || "无"));

  if (!args.summary && acc.texts.length > 0) {
    console.log("\n=== 文本节点（前 20）===");
    for (const t of acc.texts.slice(0, 20)) {
      console.log("  [" + t.id + "] " + t.characters.replace(/\n/g, " ⏎ ") + "  (fontSize=" + (t.style.fontSize ?? "?") + ")");
    }
  }
}

main().catch((e) => { console.error("运行出错: " + e.message); process.exit(1); });
