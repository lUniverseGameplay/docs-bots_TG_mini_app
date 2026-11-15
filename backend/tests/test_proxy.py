"""HTTP contract tests: bounded gateway, no database/model access."""

import os
import unittest
from unittest.mock import patch
from uuid import uuid4
import httpx
from miniapp.app import app


class ProxyTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.seen = []

        async def handle(request):
            self.seen.append(request)
            if request.url.path.endswith("/images/" + str(self.image_id)):
                return httpx.Response(
                    200,
                    content=b"image-bytes",
                    headers={
                        "Content-Type": "image/png",
                        "Set-Cookie": "must-not-leak=yes",
                    },
                )
            if request.url.path == "/sources/" + str(self.image_id):
                return httpx.Response(
                    200, text="<h1>Source</h1>", headers={"Content-Type": "text/html"}
                )
            return httpx.Response(
                202 if request.method == "POST" else 200,
                json={"ok": True},
                headers={"Retry-After": "5"},
            )

        self.image_id = uuid4()
        self.upstream = httpx.AsyncClient(
            transport=httpx.MockTransport(handle), base_url="http://rag-api:8000"
        )
        app.state.upstream = self.upstream
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="https://mini.example.org"
        )
        self.addAsyncCleanup(self.client.aclose)
        self.addAsyncCleanup(self.upstream.aclose)
        self.headers = {
            "Authorization": "tma signed-data",
            "Origin": "https://mini.example.org",
        }
        env = patch.dict(
            os.environ, {"MINI_APP_PUBLIC_ORIGIN": "https://mini.example.org"}
        )
        env.start()
        self.addCleanup(env.stop)

    async def test_forwards_raw_auth_idempotency_and_json_without_extra_credentials(
        self,
    ):
        response = await self.client.post(
            "/api/v1/questions",
            headers={
                **self.headers,
                "Idempotency-Key": "a-stable-key",
                "X-Admin": "forged",
            },
            json={"text": "Question"},
        )
        self.assertEqual(response.status_code, 202)
        request = self.seen[0]
        self.assertEqual(request.url.host, "rag-api")
        self.assertEqual(request.headers["Authorization"], "tma signed-data")
        self.assertEqual(request.headers["Idempotency-Key"], "a-stable-key")
        self.assertNotIn("X-Admin", request.headers)
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual(response.headers["Retry-After"], "5")

    async def test_unknown_methods_routes_and_external_urls_are_not_forwarded(self):
        for method, path in [
            ("GET", "/api/v1/questions"),
            ("DELETE", "/api/v1/questions/1"),
            ("GET", "/api/v1/http://other.example/secrets"),
            ("POST", "/api/v1/admin/anything"),
        ]:
            response = await self.client.request(method, path, headers=self.headers)
            self.assertEqual(response.status_code, 404)
        self.assertEqual(self.seen, [])

    async def test_missing_auth_is_not_forwarded(self):
        self.assertEqual((await self.client.get("/api/v1/me")).status_code, 401)
        self.assertEqual(self.seen, [])

    async def test_uploads_are_disabled_and_bytes_do_not_reach_rag(self):
        response = await self.client.post(
            "/api/v1/uploads", headers=self.headers, content=b"photo" * 10000
        )
        self.assertEqual(response.status_code, 501)
        self.assertEqual(self.seen, [])

    async def test_local_mode_rejects_questions_without_reading_body_or_calling_rag(self):
        async def unread_body():
            raise AssertionError("Disabled local question body must not be consumed")
            yield b""

        with patch.dict(os.environ, {"MINI_APP_LOCAL_NO_MODELS": "true"}):
            response = await self.client.post(
                "/api/v1/questions", headers=self.headers, content=unread_body()
            )
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.json()["detail"], "local_rag_disabled")
            self.assertEqual(self.seen, [])
            response = await self.client.get("/api/v1/tickets", headers=self.headers)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(len(self.seen), 1)

    async def test_body_cap_content_type_and_origin(self):
        self.assertEqual(
            (
                await self.client.post(
                    "/api/v1/questions", headers=self.headers, content=b"x" * 32769
                )
            ).status_code,
            413,
        )
        self.assertEqual(
            (
                await self.client.post(
                    "/api/v1/questions", headers=self.headers, content="text"
                )
            ).status_code,
            415,
        )
        self.assertEqual(
            (
                await self.client.post(
                    "/api/v1/questions",
                    headers={**self.headers, "Origin": "https://attacker.example"},
                    json={"text": "Q"},
                )
            ).status_code,
            403,
        )
        self.assertEqual(self.seen, [])

    async def test_images_remain_binary_and_only_safe_headers_are_forwarded(self):
        response = await self.client.get(
            "/api/v1/images/" + str(self.image_id), headers=self.headers
        )
        self.assertEqual(response.content, b"image-bytes")
        self.assertEqual(response.headers["content-type"], "image/png")
        self.assertNotIn("set-cookie", response.headers)
        self.assertEqual(self.seen[0].url.query, b"")

    async def test_public_sources_and_health_keep_legacy_access(self):
        response = await self.client.get("/sources/" + str(self.image_id))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.text, "<h1>Source</h1>")
        self.assertNotIn("authorization", self.seen[0].headers)
        self.assertEqual((await self.client.get("/health/live")).status_code, 200)
        self.assertEqual((await self.client.get("/health/ready")).status_code, 200)

    async def test_upstream_errors_keep_status_and_network_errors_hide_details(self):
        async def denied(request):
            return httpx.Response(403, json={"detail": "access_denied"})

        async with httpx.AsyncClient(
            transport=httpx.MockTransport(denied), base_url="http://rag-api"
        ) as upstream:
            app.state.upstream = upstream
            response = await self.client.get("/api/v1/me", headers=self.headers)
            self.assertEqual(response.status_code, 403)

        async def broken(request):
            raise httpx.ConnectError("private connection details")

        async with httpx.AsyncClient(
            transport=httpx.MockTransport(broken), base_url="http://rag-api"
        ) as upstream:
            app.state.upstream = upstream
            response = await self.client.get("/api/v1/me", headers=self.headers)
            self.assertEqual(response.status_code, 503)
            self.assertNotIn("private", response.text)


if __name__ == "__main__":
    unittest.main()
