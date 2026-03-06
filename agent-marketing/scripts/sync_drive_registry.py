#!/usr/bin/env python3
"""
Sync the canonical Drive product registry into the repo runtime artifact.
"""
from __future__ import annotations

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.append(str(PROJECT_ROOT))

from registry import DRIVE_PRODUCTS_FILE, LOCAL_PRODUCTS_FILE, export_drive_registry  # noqa: E402


def main() -> int:
    try:
        output_path = export_drive_registry()
    except FileNotFoundError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # pragma: no cover - defensive CLI path
        print(f"ERROR: Failed to sync registry: {exc}", file=sys.stderr)
        return 1

    print(f"Synced Drive registry:\n  source: {DRIVE_PRODUCTS_FILE}\n  output: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
