"""FastAPI application entrypoint for Leasium."""

import os
from collections.abc import Mapping

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from stewart.core.settings import get_settings

from apps.api.routers import (
    activity_feed,
    ai,
    arrears,
    branded_templates,
    charge_rules,
    comms,
    contractors,
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
    owners,
    properties,
    register_imports,
    security,
    system,
    tenancy_units,
    tenant_onboarding,
    tenant_portal,
    tenants,
    work_assignment_notifications,
    xero,
)
from apps.api.schemas.system import ApiHealthRead

settings = get_settings()

app = FastAPI(title=settings.app_name, version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_cors_origins(),
    allow_origin_regex=settings.cors_allowed_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
app.include_router(documents.router, prefix="/api/v1")
app.include_router(document_intakes.router, prefix="/api/v1")
app.include_router(register_imports.router, prefix="/api/v1")
app.include_router(enrichment.router, prefix="/api/v1")
app.include_router(xero.router, prefix="/api/v1")
app.include_router(insights.router, prefix="/api/v1")
app.include_router(system.router, prefix="/api/v1")
app.include_router(branded_templates.router, prefix="/api/v1")
app.include_router(ai.router, prefix="/api/v1")
app.include_router(activity_feed.router, prefix="/api/v1")
app.include_router(comms.router, prefix="/api/v1")
app.include_router(contractors.router, prefix="/api/v1")
app.include_router(owners.router, prefix="/api/v1")
