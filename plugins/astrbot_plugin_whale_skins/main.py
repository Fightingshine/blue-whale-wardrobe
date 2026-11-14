"""AstrBot 管理页与持久后台同步；不调用模型，不主动向 QQ 发消息。"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import io
import json
import time
from pathlib import Path
from urllib.parse import urlsplit

from astrbot.api import AstrBotConfig, logger
from astrbot.api.event import AstrMessageEvent, filter
from astrbot.api.star import Context, Star, StarTools, register
from astrbot.api.web import error_response, file_response, request

from .models import SkinError
from .store import Store
from .sync import SyncService

PLUGIN = "astrbot_plugin_whale_skins"
VERSION = "0.1.0"
PREFIX = "/" + PLUGIN + "/page"


@register(PLUGIN, "Fightingshine", "大肥鱼皮肤管理与已审核网站皮肤同步", VERSION)
class WhaleSkinsPlugin(Star):
    def __init__(self, context: Context, config: AstrBotConfig):
        super().__init__(context)
        self.config = config
        assets = Path(StarTools.get_data_dir("astrbot_plugin_kuaiai_image")) / "assets"
        builtins = json.loads((Path(__file__).parent / "builtins.json").read_text(encoding="utf-8"))
        self.store = Store(StarTools.get_data_dir(PLUGIN), assets, builtins)
        self.service = SyncService(
            self.store, str(config.get("site_url", "https://blue-chubby-whale.cyou/"))
        )
        self.task = self.manual_task = None
        self.closing = False
        for route, handler, method in [
            ("/status", self.api_status, "GET"),
            ("/sync", self.api_sync, "POST"),
            ("/skins/<skin_id>", self.api_update, "POST"),
            ("/skins/<skin_id>/reset", self.api_reset, "POST"),
            ("/skins/<skin_id>/preview", self.api_preview, "GET"),
            ("/skins/<skin_id>/reference", self.api_reference, "GET"),
        ]:
            context.register_web_api(PREFIX + route, handler, [method], "皮肤库管理员页面")

    def interval(self):
        value = self.config.get("sync_interval_seconds", 300)
        if type(value) is not int or not 60 <= value <= 86400:
            raise SkinError("同步间隔需要设置为 60 至 86400 秒。")
        return value

    async def initialize(self):
        self.interval()
        self.task = asyncio.create_task(self._loop(), name="whale-skins-sync")
        logger.info("[whale_skins] 皮肤库就绪；自动同步不调用模型、不发送群消息。")

    async def terminate(self):
        self.closing = True
        for task in (self.task, self.manual_task):
            if task and not task.done():
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task

    async def _sync(self):
        try:
            await self.service.run()
        except SkinError as exc:
            logger.warning("[whale_skins] " + str(exc))

    async def _loop(self):
        while not self.closing:
            if self.config.get("enabled", True):
                attempt = self.store.snapshot()["sync"].get("last_attempt") or 0
                if time.time() - attempt >= self.interval() and not self.service.lock.locked():
                    await self._sync()
            await asyncio.sleep(10)

    def _guard(self):
        if self.closing:
            raise SkinError("皮肤库正在停止，请稍后刷新。", 409)
        if not request.username:
            raise SkinError("请先登录 AstrBot 管理面板。", 403)
        origin = request.headers.get("origin", "")
        if request.method.upper() == "POST" and origin:
            parsed = urlsplit(origin)
            if parsed.scheme not in (
                "http",
                "https",
            ) or parsed.netloc != request.headers.get("host", ""):
                raise SkinError("跨站操作已拒绝。", 403)

    async def _body(self):
        raw = await request.body()
        if len(raw) > 16000:
            raise SkinError("设置内容过大。")
        try:
            result = json.loads(raw)
        except (ValueError, TypeError) as exc:
            raise SkinError("设置需要有效 JSON。") from exc
        if not isinstance(result, dict):
            raise SkinError("设置格式无效。")
        return result

    def status(self):
        data = self.store.snapshot()
        data.update(
            version=VERSION,
            running=self.service.lock.locked()
            or bool(self.manual_task and not self.manual_task.done()),
            auto_sync=bool(self.config.get("enabled", True)),
            interval_seconds=self.interval(),
            site_url=self.service.site,
            model_calls=0,
            automatic_qq_messages=0,
            image_plugin_required="astrbot_plugin_kuaiai_image >= 0.7.0",
        )
        for row in data["skins"]:
            try:
                self.store.image_path(row)
                row["reference_ok"] = True
            except SkinError:
                row["reference_ok"] = False
        return data

    async def api_status(self):
        try:
            self._guard()
            return {"status": "ok", "data": await asyncio.to_thread(self.status)}
        except SkinError as exc:
            return error_response(str(exc), status_code=exc.status)

    async def api_sync(self):
        try:
            self._guard()
            if self.service.lock.locked() or self.manual_task and not self.manual_task.done():
                raise SkinError("已有同步任务在运行。", 409)
            self.manual_task = asyncio.create_task(self._sync(), name="whale-skins-manual-sync")
            return {
                "status": "ok",
                "message": "正在检查已审核皮肤，请稍后刷新。",
                "data": {"running": True},
            }
        except SkinError as exc:
            return error_response(str(exc), status_code=exc.status)

    async def api_update(self, skin_id):
        return await self._update(skin_id)

    async def api_reset(self, skin_id):
        return await self._update(skin_id, reset=True)

    async def _update(self, skin_id, reset=False):
        try:
            self._guard()
            body = await self._body()
            if set(body) - {"revision", "patch"}:
                raise SkinError("设置字段无效。")
            result = self.store.update(
                skin_id, body.get("patch", {}), body.get("revision"), reset=reset
            )
            return {
                "status": "ok",
                "message": "皮肤设置已保存，下次画图时生效。",
                "data": result,
            }
        except SkinError as exc:
            return error_response(str(exc), status_code=exc.status)

    async def api_reference(self, skin_id):
        try:
            self._guard()
            rows = {r["id"]: r for r in self.store.snapshot()["skins"]}
            if skin_id not in rows:
                raise SkinError("皮肤不存在。", 404)
            path = await asyncio.to_thread(self.store.image_path, rows[skin_id])
            return file_response(
                path,
                headers={
                    "Cache-Control": "no-store",
                    "X-Content-Type-Options": "nosniff",
                },
            )
        except SkinError as exc:
            return error_response(str(exc), status_code=exc.status)

    async def api_preview(self, skin_id):
        try:
            self._guard()

            def thumbnail():
                from PIL import Image

                rows = {r["id"]: r for r in self.store.snapshot()["skins"]}
                if skin_id not in rows:
                    raise SkinError("皮肤不存在。", 404)
                path = self.store.image_path(rows[skin_id])
                with Image.open(path) as image:
                    image.thumbnail((1000, 600))
                    out = io.BytesIO()
                    image.convert("RGB").save(out, format="WEBP", quality=85)
                return "data:image/webp;base64," + base64.b64encode(out.getvalue()).decode("ascii")

            return {
                "status": "ok",
                "data": {"data_url": await asyncio.to_thread(thumbnail)},
            }
        except SkinError as exc:
            return error_response(str(exc), status_code=exc.status)

    @filter.command("皮肤库", alias={"大肥鱼皮肤"})
    async def list_skins(self, event: AstrMessageEvent):
        event.stop_event()
        rows = [r for r in self.store.snapshot()["skins"] if r["enabled"]]
        yield event.plain_result(
            "小蓝鲸的衣橱里有：\n"
            + "\n".join(f"· {r['name']}（{'、'.join(r['keywords'])}）" for r in rows)
            + "\n画图时带上对应关键词就可以啦～"
        )

    @filter.command("同步皮肤")
    async def sync_command(self, event: AstrMessageEvent):
        event.stop_event()
        if not event.is_admin():
            yield event.plain_result("这个操作需要机器人管理员来完成。")
            return
        if self.service.lock.locked() or self.manual_task and not self.manual_task.done():
            yield event.plain_result("衣橱正在整理，稍后再来看吧～")
            return
        self.manual_task = asyncio.create_task(self._sync(), name="whale-skins-command-sync")
        yield event.plain_result("去看看有没有审核通过的新衣服，整理好后就能用了～")

    @filter.command("停用皮肤")
    async def disable_command(self, event: AstrMessageEvent, skin_id: str = ""):
        async for reply in self._switch_command(event, skin_id, False):
            yield reply

    @filter.command("启用皮肤")
    async def enable_command(self, event: AstrMessageEvent, skin_id: str = ""):
        async for reply in self._switch_command(event, skin_id, True):
            yield reply

    async def _switch_command(self, event, skin_id, enabled):
        event.stop_event()
        if not event.is_admin():
            yield event.plain_result("这个操作需要机器人管理员来完成。")
            return
        try:
            data = self.store.snapshot()
            matches = [
                r
                for r in data["skins"]
                if skin_id and skin_id in [r["id"], r["name"], *r["keywords"]]
            ]
            if len(matches) != 1:
                raise SkinError("请填写一套皮肤的编号、名称或关键词，例如 /停用皮肤 短发。")
            self.store.update(matches[0]["id"], {"enabled": enabled}, data["revision"])
            yield event.plain_result(matches[0]["name"] + ("已启用。" if enabled else "已停用。"))
        except SkinError as exc:
            yield event.plain_result(str(exc))
