#!/usr/bin/env python3
"""
Validate the studio marketing runtime registry and print a compact summary.
"""
from __future__ import annotations

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.append(str(PROJECT_ROOT))

from registry import load_products_catalog, load_surface_targets  # noqa: E402


def main() -> int:
    try:
        products, registry_path = load_products_catalog()
        surfaces, _ = load_surface_targets(registry_path)
    except Exception as exc:
        print(f"ERROR: registry validation failed: {exc}", file=sys.stderr)
        return 1

    print(f"Registry OK: {registry_path}")
    print(f"Products: {len(products)}")
    print(f"Surfaces: {len(surfaces)}")
    print("Canonical products:")
    for product in products:
        print(f"  - {product['id']}: {len(product.get('surfaces', []))} surface(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
