"""FastAPI application entrypoint for Leasium."""

import logging
import os
from collections.abc import Awaitable, Callable, Mapping
from time import perf_counter
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import Response
from stewart.core.settings import get_settings

from apps.api.routers import (
    activity_feed,
    ai,
    arrears,
    basiq,
    branded_templates,
    charge_rules,
    comms,
    compliance,
    contractors,
    dashboard,
    document_intakes,
    documents,
    enrichment,
    entities,
    insights,
    lease_intakes,
    leases,
    maintenance,
    obligations,
    organisations,
    owner_entities,
    owner_portal,
    owners,
    properties,
    register_imports,
    security,
    system,
    tenancy_units,
    tenant_onboarding,
    tenant_portal,
    tenants,
    vendor_portal,
    work_assignment_notifications,
    xero,
)
from apps.api.schemas.system import ApiHealthRead

settings = get_settings()
logger = logging.getLogger("leasium.api")

if settings.sentry_dsn:
    try:
        import sentry_sdk

        sentry_sdk.init(
            dsn=settings.sentry_dsn,
            environment=settings.sentry_environment or settings.app_env,
            traces_sample_rate=0.1,
        )
    except Exception:  # never let observability break startup
        logging.getLogger(__name__).warning("Sentry init skipped", exc_info=True)

app = FastAPI(title=settings.app_name, version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_cors_origins(),
    allow_origin_regex=settings.cors_allowed_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_timing_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    """Attach request timing so slow live pages can be traced from logs."""

    request_id = request.headers.get("x-request-id") or uuid4().hex
    start = perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        duration_ms = (perf_counter() - start) * 1000
        logger.exception(
            "request failed method=%s path=%s duration_ms=%.1f request_id=%s",
            request.method,
            request.url.path,
            duration_ms,
            request_id,
        )
        raise

    duration_ms = (perf_counter() - start) * 1000
    response.headers["x-request-id"] = request_id
    response.headers["server-timing"] = f"app;dur={duration_ms:.1f}"
    logger.info(
        "request completed method=%s path=%s status=%s duration_ms=%.1f request_id=%s",
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
        request_id,
    )
    return response


@app.get("/health", response_model=ApiHealthRead)
def health() -> ApiHealthRead:
    """Healthcheck for local Docker and uptime checks."""

    return ApiHealthRead(
        status="ok",
        app=settings.app_name,
        release=_release_metadata(),
    )


def _release_metadata(environ: Mapping[str, str] | None = None) -> dict[str, str]:
    """Return non-secret deploy provenance for live verification."""

    env = environ or os.environ
    if render_commit := env.get("RENDER_GIT_COMMIT", "").strip():
        return {"commit": render_commit, "source": "render"}
    for name in ("GIT_COMMIT", "COMMIT_SHA", "SOURCE_VERSION", "VERCEL_GIT_COMMIT_SHA"):
        if commit := env.get(name, "").strip():
            return {"commit": commit, "source": name.lower()}
    return {"commit": "unknown", "source": "local"}


app.include_router(organisations.router, prefix="/api/v1")
app.include_router(entities.router, prefix="/api/v1")
app.include_router(properties.router, prefix="/api/v1")
app.include_router(properties.alias_router, prefix="/api/v1")
app.include_router(security.me_router, prefix="/api/v1")
app.include_router(security.router, prefix="/api/v1")
app.include_router(tenancy_units.router, prefix="/api/v1")
app.include_router(tenants.router, prefix="/api/v1")
app.include_router(leases.router, prefix="/api/v1")
app.include_router(obligations.router, prefix="/api/v1")
app.include_router(maintenance.router, prefix="/api/v1")
app.include_router(arrears.router, prefix="/api/v1")
app.include_router(work_assignment_notifications.router, prefix="/api/v1")
app.include_router(lease_intakes.router, prefix="/api/v1")
app.include_router(tenant_onboarding.router, prefix="/api/v1")
app.include_router(tenant_portal.router, prefix="/api/v1")
app.include_router(charge_rules.router, prefix="/api/v1")
app.include_router(compliance.router, prefix="/api/v1")
app.include_router(dashboard.router, prefix="/api/v1")
app.include_router(documents.router, prefix="/api/v1")
app.include_router(document_intakes.router, prefix="/api/v1")
app.include_router(register_imports.router, prefix="/api/v1")
app.include_router(enrichment.router, prefix="/api/v1")
app.include_router(xero.router, prefix="/api/v1")
app.include_router(basiq.router, prefix="/api/v1")
app.include_router(insights.router, prefix="/api/v1")
app.include_router(system.router, prefix="/api/v1")
app.include_router(branded_templates.router, prefix="/api/v1")
app.include_router(ai.router, prefix="/api/v1")
app.include_router(activity_feed.router, prefix="/api/v1")
app.include_router(comms.router, prefix="/api/v1")
app.include_router(contractors.router, prefix="/api/v1")
app.include_router(owners.router, prefix="/api/v1")
app.include_router(owner_entities.router, prefix="/api/v1")
app.include_router(owner_portal.router, prefix="/api/v1")
app.include_router(vendor_portal.router, prefix="/api/v1")
