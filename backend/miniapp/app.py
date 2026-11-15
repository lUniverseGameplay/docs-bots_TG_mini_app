"""Same-origin Mini App gateway. RAG API verifies Telegram and business rights."""

import os
import re
from contextlib import asynccontextmanager
from urllib.parse import urlsplit
import httpx
from fastapi import FastAPI, HTTPException, Request, Response

_UUID = r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
_ROUTES = {
    "GET": [
        r"me",
        r"questions/[1-9][0-9]{0,18}",
        f"images/{_UUID}",
        r"support",
        f"support/{_UUID}",
        r"tickets",
        f"tickets/{_UUID}/messages",
        r"admin/tickets",
        f"admin/tickets/{_UUID}/messages",
        r"admin/users",
        r"admin/metrics",
    ],
    "POST": [
        r"questions",
        r"uploads",
        r"questions/[1-9][0-9]{0,18}/support",
        f"support/{_UUID}/(?:confirm|decline)",
        f"tickets/{_UUID}/messages",
        f"admin/tickets/{_UUID}/messages",
        f"admin/tickets/{_UUID}/close",
    ],
    "PUT": [r"admin/users/[A-Za-z0-9_]{1,32}"],
}


def _base_url():
    value = os.environ.get("RAG_API_BASE_URL", "http://rag-api:8000").rstrip("/")
    parsed = urlsplit(value)
    if (
        parsed.scheme not in ("http", "https")
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path not in ("", "/")
        or any(ord(c) < 33 for c in value)
    ):
        raise ValueError(
            "RAG_API_BASE_URL must be an HTTP(S) origin without credentials"
        )
    return value


@asynccontextmanager
async def _lifespan(app):
    async with httpx.AsyncClient(
        base_url=_base_url(),
        timeout=httpx.Timeout(30, connect=5),
        follow_redirects=False,
        trust_env=False,
    ) as client:
        app.state.upstream = client
        yield


app = FastAPI(lifespan=_lifespan, docs_url=None, redoc_url=None)


async def _forward(request, path, public=False):
    headers = {"Accept": request.headers.get("accept", "application/json")}
    if not public:
        auth = request.headers.get("authorization", "")
        if not auth.lower().startswith("tma ") or len(auth) > 16388:
            raise HTTPException(401, "telegram_auth_required")
        headers["Authorization"] = auth
        if (
            request.method == "POST"
            and path == "/api/v1/questions"
            and os.environ.get("MINI_APP_LOCAL_NO_MODELS", "").lower() in {"1", "true"}
        ):
            raise HTTPException(503, "local_rag_disabled")
    if len(request.url.query) > 2048:
        raise HTTPException(414, "query_too_long")
    data = bytearray()
    if request.method in ("POST", "PUT"):
        origin = request.headers.get("origin")
        allowed = os.environ.get("MINI_APP_PUBLIC_ORIGIN", "")
        if origin and (not allowed or origin != allowed):
            raise HTTPException(403, "invalid_origin")
        if (
            request.headers.get("content-length", "").isdigit()
            and int(request.headers["content-length"]) > 32768
        ):
            raise HTTPException(413, "body_too_large")
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) > 32768:
                raise HTTPException(413, "body_too_large")
        if (
            data
            and request.headers.get("content-type", "").split(";")[0].strip().lower()
            != "application/json"
        ):
            raise HTTPException(415, "json_required")
        headers["Content-Type"] = "application/json"
        if "idempotency-key" in request.headers:
            headers["Idempotency-Key"] = request.headers["idempotency-key"]
    try:
        async with request.app.state.upstream.stream(
            request.method,
            path,
            params=request.query_params.multi_items(),
            headers=headers,
            content=bytes(data),
        ) as upstream:
            output = bytearray()
            async for chunk in upstream.aiter_bytes():
                output.extend(chunk)
                if len(output) > 21 * 1024 * 1024:
                    raise HTTPException(502, "upstream_response_too_large")
            safe_headers = {
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
            }
            for key in ("content-type", "retry-after"):
                if key in upstream.headers:
                    safe_headers[key] = upstream.headers[key]
            return Response(
                bytes(output), status_code=upstream.status_code, headers=safe_headers
            )
    except (httpx.HTTPError, TimeoutError):
        raise HTTPException(
            503, "rag_api_unavailable", headers={"Retry-After": "5"}
        ) from None


@app.get("/health/live")
async def _live():
    return {"status": "ok"}


@app.get("/health/ready")
async def _ready(request: Request):
    return await _forward(request, "/health/ready", public=True)


@app.get("/sources/{document_id}")
async def _source(document_id: str, request: Request):
    if not re.fullmatch(_UUID, document_id):
        raise HTTPException(404)
    return await _forward(request, "/sources/" + document_id, public=True)


@app.api_route("/api/v1/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def _api(path: str, request: Request):
    if not any(
        re.fullmatch(pattern, path) for pattern in _ROUTES.get(request.method, [])
    ):
        raise HTTPException(404, "unknown_api_route")
    if path == "uploads":
        raise HTTPException(501, "image_uploads_disabled")
    return await _forward(request, "/api/v1/" + path)
