// One line per test in test-results/summary.txt, so a run can be judged from
// `cat tests/e2e/test-results/summary.txt` without scrolling the list output:
//   PASS|FAIL|SKIP  file:line  title  first error line  artifact dir
// harness/up.ts appends the server log path on failure and prints FAIL lines.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import type { FullConfig, Reporter, TestCase, TestResult } from "@playwright/test/reporter";

const stripAnsi = (s: string): string => s.replace(/\u001b\[[0-9;]*m/g, "");

class SummaryReporter implements Reporter {
  private rows: string[] = [];
  private counts = { PASS: 0, FAIL: 0, SKIP: 0 };
  private root = process.cwd();

  onBegin(config: FullConfig): void {
    this.root = config.rootDir;
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const outcome = test.outcome();
    const tag = result.status === "skipped" ? "SKIP" : outcome === "unexpected" ? "FAIL" : "PASS";
    this.counts[tag] += 1;
    const file = `${relative(this.root, test.location.file)}:${test.location.line}`;
    const title = test.titlePath().slice(3).join(" > ");
    let detail = "";
    if (tag === "FAIL") {
      const message = stripAnsi(result.error?.message ?? "").trim();
      const first = message.split("\n").find((l) => l.trim()) ?? "";
      const artifact = result.attachments.find((a) => a.path)?.path;
      detail = `  ${first.slice(0, 160)}${artifact ? `  ${relative(this.root, dirname(artifact))}` : ""}`;
    }
    this.rows.push(`${tag}  ${file}  ${title}${detail}`);
  }

  onEnd(): void {
    const { PASS, FAIL, SKIP } = this.counts;
    const rows = [...this.rows].sort();
    rows.push(`TOTAL  ${PASS} passed, ${FAIL} failed, ${SKIP} skipped`);
    mkdirSync(`${this.root}/test-results`, { recursive: true });
    writeFileSync(`${this.root}/test-results/summary.txt`, `${rows.join("\n")}\n`);
  }
}

export default SummaryReporter;
