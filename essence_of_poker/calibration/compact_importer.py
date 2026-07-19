"""Compact corpus import for PHH-scale datasets."""

from __future__ import annotations

import hashlib
import tomllib
from collections import Counter
from collections.abc import Callable
from pathlib import Path
from zipfile import ZipFile

from essence_of_poker.calibration.features import extract_training_examples
from essence_of_poker.calibration.phh_importer import parse_mapping
from essence_of_poker.calibration.compact_repository import CompactCalibrationStore
from essence_of_poker.calibration.model import deterministic_fold


def import_compact_zip(
    zip_path: str | Path,
    db_path: str | Path,
    *,
    flush_every_files: int = 100,
    progress: Callable[[dict[str, int]], None] | None = None,
) -> dict[str, int]:
    path = Path(zip_path)
    source_key = f"zenodo-phh:{path.name}"
    store = CompactCalibrationStore(db_path)
    store.initialize()
    totals = {"files": 0, "hands": 0, "actions": 0}
    pending_files: list[dict[str, object]] = []
    pending_counts: Counter[tuple[object, ...]] = Counter()
    run_key = f"{source_key}:{path.stat().st_mtime_ns}"
    store.upsert_source(
        source_key,
        source_type="zip",
        path=str(path),
        sha256=sha256_file(path),
        bytes_=path.stat().st_size,
        metadata={"import_mode": "compact_feature_counts"},
    )
    store.start_run(run_key, source_key)
    try:
        with ZipFile(path) as archive:
            for info in archive.infolist():
                if info.is_dir() or not info.filename.lower().endswith((".phh", ".phhs", ".toml")):
                    continue
                file_hands, file_actions = import_zip_member(info.filename, archive.read(info), pending_counts)
                pending_files.append(file_manifest(info.filename, info.file_size, file_hands, file_actions))
                totals["files"] += 1
                totals["hands"] += file_hands
                totals["actions"] += file_actions
                if len(pending_files) >= flush_every_files:
                    store.flush(source_key, pending_files, dict(pending_counts))
                    pending_files.clear()
                    pending_counts.clear()
                    if progress:
                        progress(dict(totals))
            if pending_files or pending_counts:
                store.flush(source_key, pending_files, dict(pending_counts))
                if progress:
                    progress(dict(totals))
        store.finish_run(run_key, totals)
        return totals
    except Exception as exc:
        store.finish_run(run_key, totals, status="failed", error=str(exc))
        raise
    finally:
        store.close()


def import_zip_member(filename: str, payload: bytes, counts: Counter[tuple[object, ...]]) -> tuple[int, int]:
    parsed = tomllib.loads(payload.decode("utf-8"))
    hand_items = parsed.items() if parsed and all(isinstance(value, dict) for value in parsed.values()) else [(None, parsed)]
    hand_count = 0
    action_count = 0
    for table_key, hand_data in hand_items:
        hand = parse_mapping(hand_data, source_path=Path(filename), line_number=int(table_key) if str(table_key).isdigit() else None)
        hand_key = f"{hand.source}:{hand.source_hand_id}"
        examples = extract_training_examples(hand_key, hand)
        fold = deterministic_fold(hand_key, 5)
        for example in examples:
            counts[compact_key(example, hand, fold)] += 1
        hand_count += 1
        action_count += len(examples)
    return hand_count, action_count


def compact_key(example, hand, fold: int) -> tuple[object, ...]:
    features = example.features
    return (
        fold,
        example.street,
        example.position,
        int(features.get("players", hand.max_players or 0)),
        str(hand.site or "unknown"),
        stake_bucket(hand.stake_bb),
        year_bucket(int(features.get("played_year", 0))),
        skill_bucket(float(features.get("skill_proxy", 0.0))),
        1 if float(features.get("prior_aggressive_actions_street", 0.0)) > 0 else 0,
        prior_aggression_bucket(float(features.get("prior_aggressive_actions_street", 0.0))),
        amount_bucket(float(features.get("amount_to_pot", 0.0))),
        str(features.get("hand_class", "unknown")),
        example.action_type,
    )


def file_manifest(filename: str, bytes_: int, hand_count: int, action_count: int) -> dict[str, object]:
    parts = filename.split("/")
    dataset = parts[1] if len(parts) > 1 else "unknown"
    return {
        "file_path": filename,
        "bytes": bytes_,
        "dataset": dataset,
        "site": site_from_path(filename),
        "stake_bucket": stake_from_path(filename),
        "year": year_from_path(filename),
        "hand_count": hand_count,
        "action_count": action_count,
    }


def site_from_path(filename: str) -> str | None:
    if "/handhq/" not in filename:
        return None
    prefix = filename.split("/")[-1].split()[0].upper()
    return {"ABS": "Absolute Poker", "FTP": "Full Tilt Poker", "IPN": "iPoker", "ONG": "Ongame", "PS": "PokerStars", "PTY": "PartyPoker"}.get(prefix, prefix)


def stake_from_path(filename: str) -> str | None:
    for part in filename.split("/"):
        if part.endswith("NLH_OBFU"):
            return part.split("_")[-2] if "_" in part else part
    return None


def year_from_path(filename: str) -> int | None:
    for part in filename.split("/"):
        if len(part) >= 4 and part[:4].isdigit():
            return int(part[:4])
        if "-2009-" in part or part.startswith(("ABS-2009", "FTP-2009", "IPN-2009", "ONG-2009", "PS-2009", "PTY-2009")):
            return 2009
    return None


def stake_bucket(stake_bb: float | None) -> str:
    value = stake_bb or 0.0
    if value <= 1:
        return "micro"
    if value <= 4:
        return "small"
    if value <= 10:
        return "mid"
    return "high"


def year_bucket(year: int) -> str:
    if year <= 0:
        return "unknown"
    if year <= 2010:
        return "2009-2010"
    if year <= 2018:
        return "2011-2018"
    return "2019+"


def skill_bucket(value: float) -> str:
    if value < 0.25:
        return "low"
    if value < 0.55:
        return "medium"
    return "high"


def prior_aggression_bucket(value: float) -> str:
    if value <= 0:
        return "none"
    if value == 1:
        return "one"
    return "multi"


def amount_bucket(value: float) -> str:
    if value <= 0:
        return "none"
    if value < 0.35:
        return "small"
    if value < 0.8:
        return "medium"
    if value < 1.5:
        return "large"
    return "overbet"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
