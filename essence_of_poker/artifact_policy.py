"""Repository policy for generated data, runtime caches, and deploy artifacts."""

from __future__ import annotations

import fnmatch
import subprocess
from dataclasses import dataclass
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class ArtifactRule:
    pattern: str
    disposition: str
    reason: str


ARTIFACT_RULES: tuple[ArtifactRule, ...] = (
    ArtifactRule("data/**", "local-only", "raw corpora, compact SQLite databases, and sampled hand subsets are too large for git"),
    ArtifactRule("dist/**", "build-output", "dashboard builds are reproducible from source and should not be tracked"),
    ArtifactRule("node_modules/**", "dependency-cache", "JavaScript dependencies are installed from package metadata"),
    ArtifactRule("essence_of_poker/data/preflop_aggregate_cache.json", "tracked-generated", "canonical generated source for split aggregate class payloads"),
    ArtifactRule("essence_of_poker/data/*_cache.json", "local-generated", "monolithic generated caches are split or compressed before use"),
    ArtifactRule("essence_of_poker/data/empirical_baseline_tables.json", "local-generated", "large empirical table artifacts are generated from compact calibration data"),
    ArtifactRule("essence_of_poker/data/compact_softmax_range_model.json", "local-generated", "trained model artifacts need explicit versioning before tracking"),
    ArtifactRule("essence_of_poker/data/preflop_*_classes/*.json.gz", "tracked-generated", "per-class generated payloads are small enough to version intentionally"),
    ArtifactRule("essence_of_poker/data/*_manifest.json", "tracked-generated", "manifests describe generated payload contracts"),
)

FORBIDDEN_TRACKED_DISPOSITIONS = frozenset({"local-only", "build-output", "dependency-cache", "local-generated"})


def matching_rule(path: str) -> ArtifactRule | None:
    normalized = path.replace("\\", "/").lstrip("./")
    for rule in ARTIFACT_RULES:
        if fnmatch.fnmatch(normalized, rule.pattern):
            return rule
    return None


def tracked_policy_violations(paths: list[str] | None = None) -> list[dict[str, str]]:
    tracked = paths if paths is not None else git_tracked_files()
    violations = []
    for path in tracked:
        rule = matching_rule(path)
        if rule and rule.disposition in FORBIDDEN_TRACKED_DISPOSITIONS:
            violations.append({
                "path": path,
                "disposition": rule.disposition,
                "reason": rule.reason,
            })
    return violations


def git_tracked_files(root: Path = PROJECT_ROOT) -> list[str]:
    try:
        result = subprocess.run(
            ["git", "ls-files"],
            cwd=root,
            check=True,
            text=True,
            capture_output=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return []
    return [line for line in result.stdout.splitlines() if line]


def policy_summary() -> list[dict[str, str]]:
    return [
        {"pattern": rule.pattern, "disposition": rule.disposition, "reason": rule.reason}
        for rule in ARTIFACT_RULES
    ]
