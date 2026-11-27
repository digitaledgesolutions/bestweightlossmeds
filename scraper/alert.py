#!/usr/bin/env python3
"""Open or update one GitHub issue when the daily check goes wrong; close it when it recovers.
Needs GH_TOKEN and GITHUB_REPOSITORY (set automatically in Actions)."""
import json, os, subprocess, sys
from pathlib import Path

TITLE = "Daily price check needs attention"
MIN_HIT = 0.9
report_path = Path(__file__).resolve().parent.parent / "data" / "run-report.json"
job_failed = os.environ.get("JOB_STATUS", "success") != "success"

def gh(*args):
    return subprocess.run(["gh", *args], capture_output=True, text=True)

existing = gh("issue", "list", "--state", "open", "--search", f'"{TITLE}" in:title', "--json", "number", "--jq", ".[0].number").stdout.strip()

report = json.loads(report_path.read_text()) if report_path.exists() else None
bad = job_failed or report is None or report.get("hitRate", 0) < MIN_HIT
if not bad:
    if existing:
        gh("issue", "close", existing, "--comment", f"Recovered: {report['ok']}/{report['total']} sources OK.")
    sys.exit(0)

lines = [f"Run: {os.environ.get('RUN_URL', '')}", ""]
if job_failed:
    lines.append("**The workflow failed.** Prices on the site may be going stale.\n")
if report:
    lines.append(f"**{report['ok']}/{report['total']}** sources OK ({report['hitRate']:.0%}). Threshold is {MIN_HIT:.0%}.\n")
    if report.get("failures"):
        lines.append("| Provider | Medicine | Problem | Page |\n|---|---|---|---|")
        for f in report["failures"]:
            lines.append(f"| {f['provider']} | {f['drug']} | {f['status']} {f.get('error') or ''} | [link]({f['url']}) |")
    if report.get("held"):
        lines.append("\nHeld for a second sighting (big or low-confidence change):")
        for h in report["held"]:
            lines.append(f"- {h['provider']} {h['drug']}: {h.get('prices')}")
body = "\n".join(lines)
if existing:
    gh("issue", "comment", existing, "--body", body)
else:
    gh("issue", "create", "--title", TITLE, "--body", body)
