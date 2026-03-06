"""
Shared product registry utilities for the studio marketing engine.

Git is the machine source of truth for anything the marketing engine runs.
Drive holds founder-facing planning and brief documents.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parent
LOCAL_PRODUCTS_FILE = PROJECT_ROOT / "data" / "products.json"
DRIVE_PRODUCTS_FILE = (
    Path.home()
    / "Google Drive"
    / "My Drive"
    / "JockeyVC Studio"
    / "Marketing OS"
    / "01_Portfolio_Registry"
    / "products.json"
)


class RegistryValidationError(ValueError):
    """Raised when the studio marketing registry is malformed."""


def _candidate_paths() -> list[Path]:
    paths: list[Path] = []
    env_override = os.getenv("STUDIO_PRODUCTS_FILE")
    if env_override:
        paths.append(Path(env_override).expanduser())
    paths.append(LOCAL_PRODUCTS_FILE)
    return paths


def _require_string(value: Any, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise RegistryValidationError(f"{field_name} must be a non-empty string")
    return value.strip()


def _string_list(value: Any, field_name: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise RegistryValidationError(f"{field_name} must be a list of strings")

    items: list[str] = []
    for item in value:
        if not isinstance(item, str) or not item.strip():
            raise RegistryValidationError(f"{field_name} contains an invalid string entry")
        items.append(item.strip())
    return items


def _dedupe_strings(items: list[str]) -> list[str]:
    seen: set[str] = set()
    unique: list[str] = []
    for item in items:
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique


def _legacy_surface(product: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": product["id"],
        "name": product.get("brand_name") or product.get("name"),
        "tagline": product.get("tagline", ""),
        "url": product.get("url", ""),
        "landing": product.get("landing", product.get("url", "")),
        "keywords": product.get("keywords", []),
        "subreddits": product.get("subreddits", []),
        "negative_keywords": product.get("negative_keywords", []),
        "reply_style": product.get("reply_style", "empathetic-technical"),
        "reply_template": product.get("reply_template", "{name} might help: {landing}"),
        "cta": product.get("cta", product.get("npm", "")),
        "npm": product.get("npm", ""),
        "surface_type": product.get("surface_type", "default"),
        "audience": product.get("audience", ""),
    }


def _validate_surface(product_id: str, surface: dict[str, Any], seen_ids: set[str]) -> None:
    surface_id = _require_string(surface.get("id"), f"product[{product_id}].surfaces[].id")
    if surface_id in seen_ids:
        raise RegistryValidationError(f"Duplicate surface id '{surface_id}' in product '{product_id}'")
    seen_ids.add(surface_id)

    _require_string(surface.get("name"), f"product[{product_id}].surfaces[{surface_id}].name")
    _require_string(surface.get("tagline"), f"product[{product_id}].surfaces[{surface_id}].tagline")
    _string_list(surface.get("keywords"), f"product[{product_id}].surfaces[{surface_id}].keywords")
    _string_list(surface.get("subreddits"), f"product[{product_id}].surfaces[{surface_id}].subreddits")
    _string_list(surface.get("aliases"), f"product[{product_id}].surfaces[{surface_id}].aliases")
    _string_list(
        surface.get("negative_keywords"),
        f"product[{product_id}].surfaces[{surface_id}].negative_keywords",
    )
    _require_string(
        surface.get("reply_style"),
        f"product[{product_id}].surfaces[{surface_id}].reply_style",
    )
    _require_string(
        surface.get("reply_template"),
        f"product[{product_id}].surfaces[{surface_id}].reply_template",
    )

    url = surface.get("landing") or surface.get("url")
    if not isinstance(url, str) or not url.strip():
        raise RegistryValidationError(
            f"product[{product_id}].surfaces[{surface_id}] must define landing or url"
        )


def validate_registry(data: dict[str, Any]) -> None:
    if not isinstance(data, dict):
        raise RegistryValidationError("Registry root must be an object")

    products = data.get("products")
    if not isinstance(products, list) or not products:
        raise RegistryValidationError("Registry must contain a non-empty 'products' list")

    seen_product_ids: set[str] = set()

    for product in products:
        if not isinstance(product, dict):
            raise RegistryValidationError("Each product entry must be an object")

        product_id = _require_string(product.get("id"), "products[].id")
        if product_id in seen_product_ids:
            raise RegistryValidationError(f"Duplicate product id '{product_id}'")
        seen_product_ids.add(product_id)

        _require_string(product.get("name"), f"products[{product_id}].name")
        _string_list(product.get("aliases"), f"products[{product_id}].aliases")

        raw_surfaces = product.get("surfaces")
        surfaces = raw_surfaces if isinstance(raw_surfaces, list) and raw_surfaces else [_legacy_surface(product)]

        seen_surface_ids: set[str] = set()
        for surface in surfaces:
            if not isinstance(surface, dict):
                raise RegistryValidationError(f"products[{product_id}].surfaces[] must be an object")
            _validate_surface(product_id, surface, seen_surface_ids)


def resolve_products_file() -> Path:
    for path in _candidate_paths():
        if path.exists():
            return path
    return LOCAL_PRODUCTS_FILE


def load_registry(path: Path | None = None) -> dict[str, Any]:
    registry_path = path or resolve_products_file()
    with registry_path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    validate_registry(data)
    return data


def _normalize_surface(product: dict[str, Any], surface: dict[str, Any]) -> dict[str, Any]:
    product_name = product["name"]
    brand_name = product.get("brand_name", product_name)
    surface_name = surface.get("name", brand_name)
    landing = surface.get("landing") or surface.get("url") or product.get("landing") or product.get("url", "")
    url = surface.get("url") or landing

    return {
        "id": surface["id"],
        "aliases": _dedupe_strings(_string_list(surface.get("aliases"), "surface.aliases")),
        "product_id": product["id"],
        "product_name": product_name,
        "brand_name": brand_name,
        "name": surface_name,
        "surface_type": surface.get("surface_type", "default"),
        "audience": surface.get("audience", ""),
        "core_thesis": product.get("core_thesis", ""),
        "tagline": surface.get("tagline", ""),
        "url": url,
        "landing": landing,
        "cta": surface.get("cta", surface.get("npm", "")),
        "npm": surface.get("npm", ""),
        "keywords": _dedupe_strings(_string_list(surface.get("keywords"), "surface.keywords")),
        "subreddits": _dedupe_strings(_string_list(surface.get("subreddits"), "surface.subreddits")),
        "negative_keywords": _dedupe_strings(
            _string_list(surface.get("negative_keywords"), "surface.negative_keywords")
        ),
        "reply_style": surface.get("reply_style", "empathetic-technical"),
        "reply_template": surface.get("reply_template", "{name} might help: {landing}"),
    }


def _normalize_product(product: dict[str, Any]) -> dict[str, Any]:
    raw_surfaces = product.get("surfaces")
    surfaces_raw = raw_surfaces if isinstance(raw_surfaces, list) and raw_surfaces else [_legacy_surface(product)]
    surfaces = [_normalize_surface(product, surface) for surface in surfaces_raw]

    default_surface = product.get("default_surface") or surfaces[0]["id"]

    return {
        "id": product["id"],
        "aliases": _dedupe_strings(_string_list(product.get("aliases"), "product.aliases")),
        "name": product["name"],
        "brand_name": product.get("brand_name", product["name"]),
        "core_thesis": product.get("core_thesis", ""),
        "default_surface": default_surface,
        "surfaces": surfaces,
    }


def load_products_catalog(path: Path | None = None) -> tuple[list[dict[str, Any]], Path]:
    registry_path = path or resolve_products_file()
    data = load_registry(registry_path)
    products = [_normalize_product(product) for product in data.get("products", [])]
    return products, registry_path


def load_products_list(path: Path | None = None) -> tuple[list[dict[str, Any]], Path]:
    return load_products_catalog(path)


def load_products_map(path: Path | None = None) -> tuple[dict[str, dict[str, Any]], Path]:
    products, registry_path = load_products_catalog(path)
    mapping: dict[str, dict[str, Any]] = {}
    for product in products:
        mapping[product["id"]] = product
        for alias in product.get("aliases", []):
            mapping[alias] = product
        for surface in product.get("surfaces", []):
            mapping.setdefault(surface["id"], product)
            for alias in surface.get("aliases", []):
                mapping.setdefault(alias, product)
    return mapping, registry_path


def load_surface_targets(path: Path | None = None) -> tuple[list[dict[str, Any]], Path]:
    products, registry_path = load_products_catalog(path)
    surfaces = [surface for product in products for surface in product.get("surfaces", [])]
    return surfaces, registry_path


def find_surface(
    product: dict[str, Any],
    surface_id: str | None = None,
    product_hint: str | None = None,
) -> dict[str, Any]:
    surfaces = product.get("surfaces", [])
    if not surfaces:
        raise RegistryValidationError(f"Product '{product.get('id')}' does not define any surfaces")

    lookup_values = [surface_id, product_hint]
    for lookup_value in lookup_values:
        if not lookup_value:
            continue
        for surface in surfaces:
            if lookup_value == surface["id"] or lookup_value in surface.get("aliases", []):
                return surface

    default_surface_id = product.get("default_surface")
    for surface in surfaces:
        if surface["id"] == default_surface_id:
            return surface

    return surfaces[0]


def export_drive_registry(destination: Path | None = None) -> Path:
    if not DRIVE_PRODUCTS_FILE.exists():
        raise FileNotFoundError(f"Drive registry not found: {DRIVE_PRODUCTS_FILE}")

    data = load_registry(DRIVE_PRODUCTS_FILE)
    output_path = destination or LOCAL_PRODUCTS_FILE
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2)
        handle.write("\n")
    return output_path
