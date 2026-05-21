"""FastAPI application entrypoint for Leasium."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from stewart.core.settings import get_settings

from apps.api.routers import (
    arrears,
    charge_rules,
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
    properties,
    register_imports,
    security,
    tenancy_units,
    tenant_onboarding,
    tenant_portal,
    tenants,
    work_assignment_notifications,
    xero,
)

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


@app.get("/health")
def health() -> dict[str, str]:
    """Healthcheck for local Docker and uptime checks."""

    return {"status": "ok", "app": settings.app_name}


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
