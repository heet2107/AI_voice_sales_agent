#!/usr/bin/env python3
"""Static, secret-safe readiness checks for the voice sales CRM template."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class Check:
    level: str
    name: str
    detail: str


def nested(data: dict[str, Any], path: str) -> Any:
    current: Any = data
    for part in path.split("."):
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return current


def has_text(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def env_names(path: Path) -> set[str]:
    """Return variable names only. Values are deliberately never parsed or printed."""
    if not path.exists():
        return set()
    names: set[str] = set()
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        match = re.match(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=", line)
        if match:
            names.add(match.group(1))
    return names


def git_tracked(repo: Path) -> set[str]:
    try:
        result = subprocess.run(
            ["git", "-C", str(repo), "ls-files"],
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return set()
    return {line.strip() for line in result.stdout.splitlines() if line.strip()}


def check_profile(path: Path, is_example: bool) -> list[Check]:
    checks: list[Check] = []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        return [Check("FAIL", "business profile", f"Cannot parse {path}: {error}")]

    required_text = [
        "company.name",
        "company.websiteUrl",
        "company.description",
        "company.valueProposition",
        "agent.name",
        "agent.title",
        "outreach.defaultDiscoveryQuestion",
        "contact.publicPhone",
        "contact.scheduling.mode",
        "contact.scheduling.fallbackPhrase",
        "disclosure.recordingInstruction",
        "disclosure.truthfulAiResponse",
        "branding.appName",
    ]
    missing = [field for field in required_text if not has_text(nested(data, field))]
    if data.get("profileVersion") != 1:
        missing.append("profileVersion=1")
    if not isinstance(nested(data, "company.services"), list) or not nested(data, "company.services"):
        missing.append("company.services")
    if not isinstance(nested(data, "outreach.regions"), list) or not nested(data, "outreach.regions"):
        missing.append("outreach.regions")
    if not isinstance(nested(data, "outreach.segments"), list) or not nested(data, "outreach.segments"):
        missing.append("outreach.segments")
    for field in (
        "disclosure.recordingRequired",
        "guardrails.neverDiscussPricing",
        "guardrails.honorOptOut",
        "guardrails.noGuarantees",
    ):
        if nested(data, field) is not True:
            missing.append(f"{field}=true")
    prohibited = nested(data, "guardrails.prohibitedData")
    if not isinstance(prohibited, list) or not prohibited:
        missing.append("guardrails.prohibitedData")

    if missing:
        checks.append(Check("FAIL", "business profile schema", "Missing or unsafe: " + ", ".join(missing)))
    else:
        checks.append(Check("PASS", "business profile schema", f"Validated {path.relative_to(path.parents[2])}"))

    serialized = json.dumps(data).lower()
    placeholders = [token for token in ("example.com", "example company", "your city", "555-0100") if token in serialized]
    if is_example:
        checks.append(Check("FAIL", "client profile", "Only the example profile exists; run the client bootstrap."))
    elif placeholders:
        checks.append(Check("FAIL", "client profile", "Placeholder values remain: " + ", ".join(placeholders)))
    else:
        checks.append(Check("PASS", "client profile", "No known template placeholders detected."))
    return checks


def main() -> int:
    parser = argparse.ArgumentParser(description="Check repository readiness without reading secret values.")
    parser.add_argument(
        "--repo",
        type=Path,
        default=Path(__file__).resolve().parents[3],
        help="Repository root (defaults to the skill's containing repository).",
    )
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    args = parser.parse_args()
    repo = args.repo.expanduser().resolve()
    app = repo / "cloud-crm"
    checks: list[Check] = []

    required_files = [
        repo / "README.md",
        repo / "scripts" / "bootstrap-client.mjs",
        app / "package.json",
        app / ".env.example",
        app / "lib" / "clawcall.ts",
        app / "lib" / "campaign.ts",
    ]
    absent = [str(path.relative_to(repo)) for path in required_files if not path.exists()]
    checks.append(Check("FAIL" if absent else "PASS", "template files", "Missing: " + ", ".join(absent) if absent else "Required setup and application files are present."))

    profile = app / "config" / "business-profile.json"
    example = app / "config" / "business-profile.example.json"
    if profile.exists():
        checks.extend(check_profile(profile, False))
    elif example.exists():
        checks.extend(check_profile(example, True))
    else:
        checks.append(Check("FAIL", "business profile", "No client profile or example profile exists."))

    example_names = env_names(app / ".env.example")
    configured_names = env_names(app / ".env.local") | {key for key in __import__("os").environ.keys()}
    required_env = {
        "DATABASE_URL",
        "CLAWCALL_API_KEY",
        "CRON_SECRET",
        "AUTH_SECRET",
        "DASHBOARD_PASSCODE_HASH",
        "AI_MODEL",
        "CAMPAIGN_MODE",
    }
    absent_from_contract = sorted(required_env - example_names)
    checks.append(Check("FAIL" if absent_from_contract else "PASS", "environment contract", "Missing names: " + ", ".join(absent_from_contract) if absent_from_contract else "Required environment names are documented."))
    missing_configured = sorted(required_env - configured_names)
    checks.append(Check("WARN" if missing_configured else "PASS", "local environment", "Names not present: " + ", ".join(missing_configured) if missing_configured else "All required names are present; values were not read."))

    tracked = git_tracked(repo)
    forbidden_names = [
        name
        for name in tracked
        if name.endswith(".env.local")
        or "/.vercel/" in f"/{name}/"
        or name.endswith("key.json")
        or name.endswith(".pem")
    ]
    checks.append(Check("FAIL" if forbidden_names else "PASS", "secret file tracking", "Tracked sensitive paths: " + ", ".join(forbidden_names) if forbidden_names else "No known secret-bearing paths are tracked."))

    campaign_source = (app / "lib" / "campaign.ts").read_text(encoding="utf-8", errors="ignore") if (app / "lib" / "campaign.ts").exists() else ""
    has_env_gate = 'process.env.CAMPAIGN_MODE !== "live"' in campaign_source
    has_db_gate = 'setting("campaign_enabled", false)' in campaign_source
    checks.append(Check("PASS" if has_env_gate and has_db_gate else "FAIL", "campaign safety gates", "Environment and database pause gates are present." if has_env_gate and has_db_gate else "One or both deterministic pause gates are missing."))

    provider_source = (app / "lib" / "clawcall.ts").read_text(encoding="utf-8", errors="ignore") if (app / "lib" / "clawcall.ts").exists() else ""
    provider_ok = "CLAWCALL_API_KEY" in provider_source and "https://api.clawcall.dev" in provider_source
    checks.append(Check("PASS" if provider_ok else "FAIL", "runtime provider adapter", "HTTPS adapter and credential name are present." if provider_ok else "Expected runtime adapter contract was not found."))

    checks.append(Check("WARN", "live campaign state", "Not inspected: verify both runtime and database gates are paused before deployment. No secret values were read."))
    checks.append(Check("WARN", "operator capability", "Not inspected: verify the installed ClawCall skill/MCP separately with a read-only check."))

    if args.json:
        print(json.dumps([check.__dict__ for check in checks], indent=2))
    else:
        for check in checks:
            print(f"[{check.level}] {check.name}: {check.detail}")
        passed = sum(check.level == "PASS" for check in checks)
        warned = sum(check.level == "WARN" for check in checks)
        failed = sum(check.level == "FAIL" for check in checks)
        print(f"\nSummary: {passed} passed, {warned} warnings, {failed} failures")

    return 1 if any(check.level == "FAIL" for check in checks) else 0


if __name__ == "__main__":
    sys.exit(main())
