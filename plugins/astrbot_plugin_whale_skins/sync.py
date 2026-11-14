"""限量串行下载、公开 DNS 和同源 HTTPS，失败保留完整旧快照。"""

from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import json
import socket
import time
from urllib.parse import urljoin, urlsplit

import aiohttp

from .models import (
    BUILTIN_IDS,
    MAX_CATALOG,
    MAX_IMAGE,
    SkinError,
    site_url,
    validate_catalog,
    verify_image,
)


class PublicResolver(aiohttp.abc.AbstractResolver):
    def __init__(self):
        self.resolver = aiohttp.resolver.DefaultResolver()

    async def resolve(self, host, port=0, family=socket.AF_INET):
        answers = await self.resolver.resolve(host, port, family)
        if not answers or any(not ipaddress.ip_address(a["host"]).is_global for a in answers):
            raise SkinError("拒绝连接内部网络地址。")
        return answers

    async def close(self):
        await self.resolver.close()


class Downloader:
    def __init__(self, site):
        self.site = site_url(site)
        self.session = None

    async def __aenter__(self):
        self.session = aiohttp.ClientSession(
            connector=aiohttp.TCPConnector(resolver=PublicResolver(), limit=1),
            timeout=aiohttp.ClientTimeout(total=90, connect=20, sock_read=40),
            trust_env=False,
            headers={"User-Agent": "WhaleSkinLibrary/0.1.0", "Accept": "*/*"},
        )
        return self

    async def __aexit__(self, *args):
        await self.session.close()

    async def fetch(self, path, limit, etag=None):
        url = urljoin(self.site, path)
        origin = urlsplit(self.site)
        headers = {"If-None-Match": etag} if etag else {}
        for _ in range(4):
            parsed = urlsplit(url)
            if (
                (parsed.scheme, parsed.netloc) != (origin.scheme, origin.netloc)
                or parsed.username
                or parsed.fragment
            ):
                raise SkinError("网站文件跳转到其他来源，已拒绝。")
            try:
                address = ipaddress.ip_address(parsed.hostname)
            except ValueError:
                address = None
            if address is not None and not address.is_global:
                raise SkinError("拒绝连接内部网络地址。")
            async with self.session.get(url, headers=headers, allow_redirects=False) as response:
                if response.status in (301, 302, 303, 307, 308):
                    url = urljoin(url, response.headers.get("Location", ""))
                    continue
                if response.status == 304 and etag:
                    return None, etag
                if response.status != 200:
                    raise SkinError(
                        f"网站暂时不可读取（HTTP {response.status}），保留现有皮肤。",
                        502,
                    )
                if response.content_length is not None and response.content_length > limit:
                    raise SkinError("网站文件过大，未同步。")
                data = bytearray()
                async for chunk in response.content.iter_chunked(65536):
                    data.extend(chunk)
                    if len(data) > limit:
                        raise SkinError("网站文件超出体积限制。")
                return bytes(data), response.headers.get("ETag")
        raise SkinError("网站重定向次数过多。")


class SyncService:
    def __init__(self, store, site, downloader=Downloader):
        self.store, self.site, self.downloader = store, site_url(site), downloader
        self.lock = asyncio.Lock()

    async def run(self):
        if self.lock.locked():
            raise SkinError("已有同步任务正在运行。", 409)
        async with self.lock:
            self.store.sync_state(last_attempt=time.time(), last_error=None)
            try:
                current = self.store.snapshot()
                old = {r["id"]: r for r in current["skins"]}
                previous = current["sync"]
                etag = previous.get("etag") if previous.get("source") == self.site else None
                async with self.downloader(self.site) as download:
                    payload, new_etag = await download.fetch(
                        "skins/catalog.json", MAX_CATALOG, etag
                    )
                    if payload is None:
                        # 304 仍检查原件完整性；下次完整同步可修复缺失的缓存。
                        for row in current["skins"]:
                            if row["enabled"]:
                                await asyncio.to_thread(self.store.image_path, row)
                        self.store.sync_state(last_success=time.time(), last_error=None)
                        return self.store.snapshot()
                    catalog = validate_catalog(json.loads(payload))
                    records = []
                    for row in catalog:
                        if row["id"] in BUILTIN_IDS:
                            # 四套历史素材由部署时种子定义锁定；网页不能覆盖它们。
                            if (
                                row["id"] in old
                                and row["reference"]["sha256"] != old[row["id"]]["reference_sha256"]
                            ):
                                raise SkinError("网站基础皮肤原图与本机不一致，未替换。")
                            continue
                        ref = row["reference"]
                        suffix = ref["path"].rsplit(".", 1)[1]
                        path = self.store.assets / f"skin_library/{ref['sha256']}.{suffix}"
                        if (
                            path.is_file()
                            and not path.is_symlink()
                            and hashlib.sha256(path.read_bytes()).hexdigest() == ref["sha256"]
                        ):
                            data = path.read_bytes()
                        else:
                            data, _ = await download.fetch(ref["path"], MAX_IMAGE)
                        await asyncio.to_thread(verify_image, data, ref)
                        filename = await asyncio.to_thread(
                            self.store.install_image, data, ref["sha256"], suffix
                        )
                        records.append(
                            {
                                "id": row["id"],
                                "name": row["name"],
                                "keywords": row["keywords"],
                                "appearance": row["appearance"],
                                "attribution": row["attribution"],
                                "daily": row["daily"],
                                "reference_name": filename,
                                "reference_sha256": ref["sha256"],
                            }
                        )
                    return self.store.apply_catalog(records, self.site, new_etag)
            except asyncio.CancelledError:
                self.store.sync_state(last_error="同步被停止；原有目录保持可用。", etag=None)
                raise
            except Exception as exc:
                message = (
                    str(exc)
                    if isinstance(exc, SkinError)
                    else "同步暂未完成，保留原有皮肤；稍后会再次检查。"
                )
                self.store.sync_state(last_error=message, etag=None)
                raise SkinError(message, 502) from exc
