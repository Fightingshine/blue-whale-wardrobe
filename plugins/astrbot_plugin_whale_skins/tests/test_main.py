"""管理员鉴权、设置接口与后台生命周期的隔离验证。"""

import asyncio
import json
import logging
import sys
import types
import unittest
from unittest.mock import patch

from test_library import StoreFixture

MODULES = {
    name: types.ModuleType(name)
    for name in (
        "astrbot",
        "astrbot.api",
        "astrbot.api.event",
        "astrbot.api.star",
        "astrbot.api.web",
    )
}
MODULES["astrbot.api"].AstrBotConfig = dict
MODULES["astrbot.api"].logger = logging.getLogger("skin-test")
MODULES["astrbot.api.event"].AstrMessageEvent = object
MODULES["astrbot.api.event"].filter = types.SimpleNamespace(command=lambda *a, **k: lambda f: f)


class Star:
    def __init__(self, context):
        self.context = context


MODULES["astrbot.api.star"].Star = Star
MODULES["astrbot.api.star"].Context = object
MODULES["astrbot.api.star"].StarTools = types.SimpleNamespace(get_data_dir=lambda name: None)
MODULES["astrbot.api.star"].register = lambda *a, **k: lambda f: f
REQUEST = types.SimpleNamespace(username="admin", method="GET", headers={}, body=None)
MODULES["astrbot.api.web"].request = REQUEST
MODULES["astrbot.api.web"].error_response = lambda message, status_code=400: {
    "status": "error",
    "message": message,
    "http_status": status_code,
}
MODULES["astrbot.api.web"].file_response = lambda path, **k: {"file": str(path)}
sys.modules.update(MODULES)
from astrbot_plugin_whale_skins.main import WhaleSkinsPlugin


class MainTests(StoreFixture, unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.routes = []
        context = types.SimpleNamespace(register_web_api=lambda *args: self.routes.append(args))

        def root(name):
            return (
                self.assets.parent
                if name == "astrbot_plugin_kuaiai_image"
                else self.root / "plugin-data"
            )

        with patch("astrbot_plugin_whale_skins.main.StarTools.get_data_dir", side_effect=root):
            self.plugin = WhaleSkinsPlugin(
                context, {"enabled": False, "sync_interval_seconds": 300}
            )
        # 使用一致的临时原图种子代替真实历史素材。
        self.plugin.store = self.store
        self.plugin.service.store = self.store
        REQUEST.username = "admin"
        REQUEST.headers = {}
        REQUEST.method = "GET"

    async def asyncTearDown(self):
        await self.plugin.terminate()

    async def body(self, value):
        async def read():
            return json.dumps(value).encode()

        REQUEST.body = read
        REQUEST.method = "POST"

    async def test_anonymous_status_and_mutations_rejected(self):
        REQUEST.username = None
        for handler, args in [
            (self.plugin.api_status, ()),
            (self.plugin.api_sync, ()),
            (self.plugin.api_update, ("winter",)),
            (self.plugin.api_reference, ("winter",)),
        ]:
            response = await handler(*args)
            self.assertEqual(response["http_status"], 403)

    async def test_cross_origin_post_rejected(self):
        REQUEST.method = "POST"
        REQUEST.headers = {"origin": "https://evil.example", "host": "astrbot.local"}
        self.assertEqual((await self.plugin.api_sync())["http_status"], 403)

    async def test_status_does_not_start_sync_or_model(self):
        result = await self.plugin.api_status()
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["data"]["model_calls"], 0)
        self.assertIsNone(self.store.snapshot()["sync"]["last_attempt"])

    async def test_update_applies_and_stale_revision_is_rejected(self):
        rev = self.store.snapshot()["revision"]
        await self.body({"revision": rev, "patch": {"weight": 7}})
        self.assertEqual((await self.plugin.api_update("winter"))["status"], "ok")
        self.assertEqual((await self.plugin.api_update("winter"))["http_status"], 409)

    async def test_invalid_body_and_unknown_fields(self):
        await self.body({"revision": 0, "inject": True})
        self.assertEqual((await self.plugin.api_update("winter"))["status"], "error")

    async def test_reference_path_cannot_escape_library(self):
        self.assertEqual((await self.plugin.api_reference("../state"))["http_status"], 404)

    async def test_preview_is_small_image_data_uri(self):
        result = await self.plugin.api_preview("winter")
        self.assertTrue(result["data"]["data_url"].startswith("data:image/webp;base64,"))

    async def test_shutdown_cancels_only_owned_background_task(self):
        await self.plugin.initialize()
        task = self.plugin.task
        await self.plugin.terminate()
        self.assertTrue(task.cancelled())

    async def test_manual_sync_is_single_and_returns_immediately(self):
        gate = asyncio.Event()

        async def wait():
            await gate.wait()

        with patch.object(self.plugin, "_sync", side_effect=wait):
            result = await self.plugin.api_sync()
            self.assertTrue(result["data"]["running"])
            self.assertEqual((await self.plugin.api_sync())["http_status"], 409)
            gate.set()
            await self.plugin.manual_task

    async def test_reload_does_not_reset_last_attempt(self):
        self.store.sync_state(last_attempt=123)
        self.assertEqual(self.plugin.store.snapshot()["sync"]["last_attempt"], 123)


if __name__ == "__main__":
    unittest.main()
