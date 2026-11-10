"""The HTTP routes of the service (contract: `schemas/service/matcher-service.openapi.yaml`).

Every `/v1` route needs the shared secret (`Authorization: Bearer ...`). `/healthz` and `/readyz`
need nothing, so a cluster's probes can reach them. Errors are RFC 9457 problem details with a
stable `code`, never a framework's own body.
"""

import hmac
import json
import logging
import re
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from http import HTTPStatus
from typing import Any

from fastapi import APIRouter, Depends, FastAPI, Header, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from gears_matcher.service.errors import ProblemError, bad_request, not_found, too_large
from gears_matcher.service.manager import RunManager
from gears_matcher.service.request import Limits, body_digest, check_key

log = logging.getLogger("gears_matcher.service")
PROBLEM = "application/problem+json"
RUN_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
DRAIN_CAP = 64_000_000  # the most of a refused body that is read and thrown away


def _problem(error: ProblemError) -> JSONResponse:
    return JSONResponse(
        error.body(), status_code=error.status.value, headers=error.headers, media_type=PROBLEM
    )


async def _read_body(request: Request, limit: int) -> bytes:
    """The body, or `413`. An oversized body is read and discarded first (up to `DRAIN_CAP`), so
    the caller, still sending, receives the answer and not a dropped connection."""
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > DRAIN_CAP:
            break
        if total <= limit:
            chunks.append(chunk)
        else:
            chunks.clear()
    if total > limit:
        raise too_large(f"the request is over the limit of {limit} bytes")
    return b"".join(chunks)


def create_app(manager: RunManager, secret: str, info: dict[str, Any], limits: Limits) -> FastAPI:
    """The app for one manager. `info` is what `GET /v1/info` says apart from the limits."""

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        again = manager.recover()
        if again:
            log.info("started %d unfinished run(s) again", again)
        yield
        manager.shutdown()

    app = FastAPI(
        title="gears-matcher service",
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.include_router(_v1_router(manager, secret, info, limits))
    _add_health(app, manager)
    _add_error_handlers(app)
    return app


def _v1_router(manager: RunManager, secret: str, info: dict[str, Any], limits: Limits) -> APIRouter:
    def require_secret(authorization: str | None = Header(default=None)) -> None:
        expected = f"Bearer {secret}".encode()
        if authorization is None or not hmac.compare_digest(authorization.encode(), expected):
            raise ProblemError(HTTPStatus.UNAUTHORIZED, "unauthorized", "missing or wrong secret")

    v1 = APIRouter(prefix="/v1", dependencies=[Depends(require_secret)])

    @v1.get("/info")
    def get_info() -> dict[str, Any]:
        return {**info, "limits": limits.as_json()}

    @v1.post("/runs")
    async def submit(
        request: Request,
        idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ) -> JSONResponse:
        raw = await _read_body(request, limits.max_request_bytes)
        key = check_key(idempotency_key)
        try:
            body = json.loads(raw)
        except ValueError as exc:
            raise bad_request("the body is not JSON") from exc
        view = await run_in_threadpool(manager.submit, key, body_digest(body), body)
        return JSONResponse(view, status_code=202, headers={"Location": f"/v1/runs/{view['id']}"})

    @v1.get("/runs/{run_id}")
    def get_run(run_id: str) -> dict[str, Any]:
        return manager.get(_run_id(run_id))

    @v1.get("/runs/{run_id}/report")
    def get_report(run_id: str) -> Response:
        return Response(manager.report(_run_id(run_id)), media_type="application/json")

    @v1.post("/runs/{run_id}/cancel")
    def cancel_run(run_id: str) -> JSONResponse:
        view, in_progress = manager.cancel(_run_id(run_id))
        return JSONResponse(view, status_code=202 if in_progress else 200)

    return v1


def _add_health(app: FastAPI, manager: RunManager) -> None:
    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/readyz")
    def readyz() -> JSONResponse:
        try:
            manager.ready()
        except Exception:
            log.exception("not ready")
            return JSONResponse({"status": "unavailable"}, status_code=503)
        return JSONResponse({"status": "ready"})


def _add_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ProblemError)
    async def problem_handler(_request: Request, exc: ProblemError) -> JSONResponse:
        return _problem(exc)

    @app.exception_handler(StarletteHTTPException)
    async def http_handler(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        if exc.status_code == HTTPStatus.NOT_FOUND:
            return _problem(not_found("no such route"))
        status = HTTPStatus(exc.status_code)
        return _problem(ProblemError(status, "bad_request", status.phrase.lower()))

    @app.exception_handler(Exception)
    async def unexpected_handler(_request: Request, exc: Exception) -> JSONResponse:
        log.error("unhandled error", exc_info=exc)
        error = ProblemError(HTTPStatus.INTERNAL_SERVER_ERROR, "internal", "an unexpected error")
        return _problem(error)


def _run_id(value: str) -> str:
    if not RUN_ID.match(value):
        raise not_found()
    return value
