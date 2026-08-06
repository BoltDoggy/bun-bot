/**
 * p4-filetree.test.ts — P4 通用化：大项目上下文加载（第 9 项）
 *
 * 验证：
 *   1. buildFileTree 内置忽略大目录：node_modules / vendor / target / __pycache__ 不出现在树里
 *   2. .gitignore 感知：gitignoreDirs 提取目录规则（vendor/、裸名目录），忽略文件规则（.env / *.log）
 *   3. 行数预算化截断：maxLines 超限时提示"文件树过大 / 按需 list_dir"
 *   4. 普通小目录文件树正常（无截断提示）
 *
 * 运行：bun test
 */
import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFileTree, gitignoreDirs } from "../src/memory";

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "bun-bot-p4-tree-"));
});
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

test("P4 文件树内置忽略大目录：node_modules / vendor / target / __pycache__ 不出现", () => {
  const base = join(tmp, "big-proj");
  mkdirSync(join(base, "src"), { recursive: true });
  mkdirSync(join(base, "node_modules"), { recursive: true });
  mkdirSync(join(base, "vendor"), { recursive: true });
  mkdirSync(join(base, "target"), { recursive: true });
  mkdirSync(join(base, "__pycache__"), { recursive: true });
  writeFileSync(join(base, "src", "main.ts"), "x");
  const tree = buildFileTree(4, base);
  expect(tree).toContain("src/");
  expect(tree).toContain("main.ts");
  expect(tree).not.toContain("node_modules");
  expect(tree).not.toContain("vendor");
  expect(tree).not.toContain("target");
  expect(tree).not.toContain("__pycache__");
});

test("P4 文件树感知 .gitignore：gitignoreDirs 提取目录规则并忽略，文件规则不当目录", () => {
  const base = join(tmp, "gi-proj");
  mkdirSync(join(base, "dist"), { recursive: true });
  mkdirSync(join(base, "custom-generated"), { recursive: true });
  writeFileSync(join(base, ".gitignore"), "# deps\ndist/\ncustom-generated\n.env\n*.log\n");
  const dirs = gitignoreDirs(base);
  expect(dirs.has("dist")).toBe(true);          // 以 / 结尾
  expect(dirs.has("custom-generated")).toBe(true); // 裸目录名
  expect(dirs.has(".env")).toBe(false);         // 含 . 的文件规则不当目录
  expect(dirs.has("*.log")).toBe(false);        // 通配规则不当目录
  const tree = buildFileTree(4, base);
  expect(tree).not.toContain("dist");
  expect(tree).not.toContain("custom-generated");
});

test("P4 文件树预算截断：maxLines 超限时提示按需 list_dir", () => {
  const base = join(tmp, "huge-proj");
  mkdirSync(base, { recursive: true });
  for (let i = 0; i < 20; i++) writeFileSync(join(base, "file-" + i + ".txt"), "x");
  const tree = buildFileTree(4, base, { maxLines: 10 });
  expect(tree).toContain("文件树过大");
  expect(tree).toContain("list_dir");
  expect(tree.split("\n").length).toBeLessThanOrEqual(12); // 10 行 + 截断提示
});

test("P4 普通小目录文件树正常（无截断提示）", () => {
  const base = join(tmp, "small-proj");
  mkdirSync(join(base, "src"), { recursive: true });
  writeFileSync(join(base, "README.md"), "# small\n");
  writeFileSync(join(base, "src", "index.ts"), "console.log(1)\n");
  const tree = buildFileTree(4, base);
  expect(tree).toContain("README.md");
  expect(tree).toContain("src/");
  expect(tree).toContain("index.ts");
  expect(tree).not.toContain("文件树过大");
});
