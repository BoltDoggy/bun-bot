/**
 * audit.ts — 审计日志（P3-4：每次工具调用的入参/出参摘要落盘）
 *
 * 落盘 `AUDIT.log.jsonl`（工作区根，gitignore —— 每轮会话都会产生新行，
 * 不纳入版本控制）。每次 executeTool 后由主循环追加一条记录：
 *   时间 / 轮次 / 工具名 / 入参摘要 / 出参摘要 / exitCode
 * appendAudit 内部做防御性截断（入参 400 / 出参 500 字符），
 * 无论调用方是否截断，审计文件都不会无限膨胀；完整结果仍回传模型，
 * 审计只留可追溯的线索，不复制全量工具输出。
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { workspace } from "./memory";

/** 审计日志文件名（gitignore） */
export const AUDIT_FILE = "AUDIT.log.jsonl";

export function auditPath(): string {
  return join(workspace(), AUDIT_FILE);
}

export interface AuditEntry {
  ts: string;
  round: number;
  tool: string;
  /** 入参摘要（内部截断到 400） */
  args: string;
  /** 出参摘要（内部截断到 500） */
  result: string;
  exitCode?: number;
}

/** 截断辅助（带原始长度说明，审计线索不丢） */
function clip(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + "…[截断，原 " + s.length + " 字符]";
}

/** 追加一条审计记录（JSONL：每行一个 JSON 对象；入参/出参防御性截断） */
export function appendAudit(entry: AuditEntry): void {
  try {
    appendFileSync(
      auditPath(),
      JSON.stringify({
        ...entry,
        args: clip(entry.args, 400),
        result: clip(entry.result, 500),
      }) + "\n",
      "utf8",
    );
  } catch (e) {
    console.error("[audit] 写入失败: " + e);
  }
}

/** 读取全部审计记录（从最新往回取 limit 条；文件不存在返回空数组） */
export function loadAudit(limit = 50): AuditEntry[] {
  try {
    if (!existsSync(auditPath())) return [];
    const lines = readFileSync(auditPath(), "utf8").split("\n").filter((l) => l.trim());
    const entries = lines
      .map((l) => {
        try {
          return JSON.parse(l) as AuditEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is AuditEntry => e !== null);
    return entries.slice(-limit).reverse();
  } catch {
    return [];
  }
}
