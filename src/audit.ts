/**
 * audit.ts — 审计日志（P3-4：每次工具调用的入参/出参摘要落盘）
 *
 * 落盘 `AUDIT.log.jsonl`（工作区根，gitignore —— 每轮会话都会产生新行，
 * 不纳入版本控制）。每次 executeTool 后由主循环追加一条记录：
 *   时间 / 轮次 / 工具名 / 入参摘要 / 出参摘要 / exitCode
 * 出参摘要截断（默认 500 字符），完整结果仍回传模型 —— 审计只留可追溯的线索，
 * 不复制全量工具输出。
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
  /** 入参摘要（截断） */
  args: string;
  /** 出参摘要（截断） */
  result: string;
  exitCode?: number;
}

/** 追加一条审计记录（JSONL：每行一个 JSON 对象） */
export function appendAudit(entry: AuditEntry): void {
  try {
    appendFileSync(auditPath(), JSON.stringify(entry) + "\n", "utf8");
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
