"""SerpAPI Google Images adapter for property image candidate search.

This is the search source for the property image helper experiment v2. It
queries Google Images via SerpAPI and returns candidate dicts in the shape
expected by ``_normalise_property_image_candidates`` in
``apps.api.routers.enrichment`` so the existing review-first preview/apply
pipeline (SSRF guard, bounded download, Pillow processing, StoredDocument
creation) can be reused without further changes.

No HTTP request is made unless ``settings.serpapi_api_key`` is set. The
caller is expected to translate ``PropertyImageSearchError`` into a 503
response (mirroring the OpenAI-backed enrichment 503 surface).
"""

from __future__ import annotations

from typing import Any

import httpx

from stewart.core.settings import Settings


class PropertyImageSearchError(RuntimeError):
    """Raised when SerpAPI image search cannot be performed."""


SERPAPI_ENDPOINT = "https://serpapi.com/search.json"
DEFAULT_TIMEOUT_SECONDS = 30.0
MAX_RESULTS = 10


def search_property_images(
    *,
    query: str,
    settings: Settings,
    requested_count: int = 4,
) -> tuple[dict[str, Any], str | None]:
    """Call SerpAPI Google Images and return candidates + the search id.

    Returns a tuple ``(provider_result, response_id)`` where ``provider_result``
    matches the shape consumed by ``_normalise_property_image_candidates``:

    .. code-block:: json

        {
            "candidates": [
                {
                    "title": "...",
                    "image_url": "https://...jpg",
                    "page_url": "https://...page",
                    "source": {
                        "source_hint": "domain.com",
                        "citation": "...",
                        "confidence": 0.95,
                        "url": "https://...page"
                    },
                    "confidence": 0.95,
                    "notes": null
                }
            ],
            "warnings": ["..."]
        }
    """
    if not settings.serpapi_api_key:
        raise PropertyImageSearchError(
            "SerpAPI key is not configured. Set SERPAPI_API_KEY to enable"
            " property image candidates."
        )

    cleaned_query = (query or "").strip()
    if not cleaned_query:
        raise PropertyImageSearchError(
            "Cannot search property images without an address or property name."
        )

    params: dict[str, Any] = {
        "engine": "google_images",
        "q": cleaned_query,
        "api_key": settings.serpapi_api_key,
        "google_domain": "google.com.au",
        "gl": "au",
        "hl": "en",
        "ijn": "0",
    }

    try:
        response = httpx.get(
            SERPAPI_ENDPOINT,
            params=params,
            timeout=DEFAULT_TIMEOUT_SECONDS,
        )
    except httpx.HTTPError as exc:  # pragma: no cover - network-failure path
        raise PropertyImageSearchError(
            f"SerpAPI request failed: {exc}"
        ) from exc

    if response.status_code != 200:
        raise PropertyImageSearchError(
            f"SerpAPI returned status {response.status_code}."
        )

    try:
        body = response.json()
    except ValueError as exc:  # pragma: no cover - non-JSON path
        raise PropertyImageSearchError(
            "SerpAPI response was not valid JSON."
        ) from exc
    if not isinstance(body, dict):
        raise PropertyImageSearchError(
            "SerpAPI response had an unexpected shape."
        )

    images_results = body.get("images_results")
    metadata = body.get("search_metadata") if isinstance(body.get("search_metadata"), dict) else {}
    response_id = metadata.get("id") if isinstance(metadata.get("id"), str) else None

    warnings: list[str] = []
    candidates: list[dict[str, Any]] = []

    if not isinstance(images_results, list):
        warnings.append(
            "SerpAPI returned no images_results for this query."
        )
        return {"candidates": [], "warnings": warnings}, response_id

    capped = min(max(requested_count, 1), MAX_RESULTS)
    seen_urls: set[str] = set()

    for idx, raw in enumerate(images_results):
        if len(candidates) >= capped:
            break
        if not isinstance(raw, dict):
            continue

        image_url = _https_url(raw.get("original"))
        if image_url is None:
            # SerpAPI sometimes lacks ``original`` for ad/news rows; fall back
            # to the Google CDN thumbnail which is a stable HTTPS image URL.
            image_url = _https_url(raw.get("thumbnail"))
        if image_url is None or image_url in seen_urls:
            continue
        seen_urls.add(image_url)

        title_raw = raw.get("title")
        title = (
            title_raw.strip()[:160]
            if isinstance(title_raw, str) and title_raw.strip()
            else f"Image candidate {idx + 1}"
        )

        page_url = _https_url(raw.get("link"))
        source_domain_raw = raw.get("source")
        source_hint = (
            source_domain_raw.strip()
            if isinstance(source_domain_raw, str) and source_domain_raw.strip()
            else "Google Images result"
        )
        confidence = round(max(0.40, 0.95 - idx * 0.08), 2)

        candidates.append(
            {
                "title": title,
                "image_url": image_url,
                "page_url": page_url,
                "source": {
                    "source_hint": source_hint,
                    "citation": title,
                    "confidence": confidence,
                    "url": page_url,
                },
                "confidence": confidence,
                "notes": None,
            }
        )

    if not candidates:
        warnings.append(
            "Google Images returned no usable photo candidates for this address."
        )

    return {"candidates": candidates, "warnings": warnings}, response_id


def _https_url(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped if stripped.lower().startswith("https://") else None
