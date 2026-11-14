from __future__ import annotations

import asyncio
import hashlib
import importlib.util
import io
import json
import random
import sys
import tempfile
import types
import unittest
from pathlib import Path
from typing import ClassVar
from unittest.mock import AsyncMock, patch

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT.parent))
from astrbot_plugin_whale_skins.models import (
    SkinError,
    controls,
    site_url,
    validate_catalog,
    verify_image,
)
from astrbot_plugin_whale_skins.store import MANIFEST, Store
from astrbot_plugin_whale_skins.sync import PublicResolver, SyncService


def picture(color="blue"):
    out = io.BytesIO()
    Image.new("RGB", (600, 320), color).save(out, "PNG")
    return out.getvalue()


def submission(data=None, **changes):
    data = data or picture()
    row = {
        "id": "issue-3",
        "name": "短发大肥鱼",
        "status": "approved",
        "keywords": ["短发"],
        "description": "蓝色短发波波头，保留鲸尾",
        "requestedDailyRotation": True,
        "reference": {
            "path": "skins/issue-3/reference.png",
            "sha256": hashlib.sha256(data).hexdigest(),
            "width": 600,
            "height": 320,
            "bytes": len(data),
        },
    }
    row.update(changes)
    return row


def catalog(*rows):
    return {"schema": "whale-skin-catalog/v1", "skins": list(rows)}


class StoreFixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.assets = self.root / "assets"
        self.assets.mkdir()
        self.builtins = json.loads((ROOT / "builtins.json").read_text(encoding="utf-8"))
        for row in self.builtins:
            data = picture()
            (self.assets / row["reference_name"]).write_bytes(data)
            row["reference_sha256"] = hashlib.sha256(data).hexdigest()
        self.store = Store(self.root / "state", self.assets, self.builtins)

    def tearDown(self):
        self.temp.cleanup()

    def apply(self, **changes):
        data = picture("cyan")
        raw = submission(data, **changes)
        filename = self.store.install_image(data, raw["reference"]["sha256"], "png")
        rec = validate_catalog(catalog(raw))[0]
        row = {k: rec[k] for k in ("id", "name", "keywords", "appearance", "attribution", "daily")}
        row.update(reference_name=filename, reference_sha256=rec["reference"]["sha256"])
        self.store.apply_catalog([row], "https://example.org/", "v1")
        return row

    def row(self, skin_id="issue-3"):
        return next(r for r in self.store.snapshot()["skins"] if r["id"] == skin_id)


class ValidationTests(unittest.TestCase):
    def test_valid_catalog_and_picture(self):
        row = validate_catalog(catalog(submission()))[0]
        self.assertTrue(row["daily"])
        self.assertEqual(verify_image(picture(), row["reference"]), picture())

    def test_non_approved_is_not_installed(self):
        self.assertEqual(validate_catalog(catalog(submission(status="pending"))), [])

    def test_path_traversal_and_external_urls_rejected(self):
        for path in (
            "../a.png",
            "/etc/passwd",
            "https://localhost/a.png",
            "skins/issue-3/../../a.png",
            "skins/other/reference.png",
            "skins/issue-3/reference.svg",
            "skins/issue-3/%2e%2e.png",
        ):
            with self.subTest(path=path), self.assertRaises(SkinError):
                raw = submission()
                raw["reference"]["path"] = path
                validate_catalog(catalog(raw))

    def test_duplicate_ids_and_keywords_rejected(self):
        for rows in (
            [submission(), submission()],
            [submission(), submission(id="issue-4")],
        ):
            with self.assertRaises(SkinError):
                validate_catalog(catalog(*rows))

    def test_invalid_dimensions_hash_size_rejected(self):
        for key, value in [
            ("width", 500),
            ("height", 700),
            ("bytes", 11 * 1024 * 1024),
            ("sha256", "../bad"),
            ("width", True),
        ]:
            with self.subTest(key=key), self.assertRaises(SkinError):
                raw = submission()
                raw["reference"][key] = value
                validate_catalog(catalog(raw))

    def test_tampered_picture_rejected(self):
        with self.assertRaises(SkinError):
            verify_image(picture("red"), submission()["reference"])

    def test_forged_dimensions_rejected(self):
        ref = submission()["reference"]
        ref["height"] = 301
        with self.assertRaises(SkinError):
            verify_image(picture(), ref)

    def test_non_image_with_matching_hash_rejected(self):
        data = b"not an image"
        ref = submission(data)["reference"]
        with self.assertRaises(SkinError):
            verify_image(data, ref)

    def test_animation_rejected(self):
        out = io.BytesIO()
        Image.new("RGB", (600, 320)).save(
            out,
            "GIF",
            save_all=True,
            append_images=[Image.new("RGB", (600, 320), "red")],
            duration=100,
            loop=0,
        )
        data = out.getvalue()
        with self.assertRaises(SkinError):
            verify_image(data, submission(data)["reference"])

    def test_controls_reject_unknown_nan_and_wrong_types(self):
        for row in (
            {"weight": float("nan")},
            {"weight": 0},
            {"weight": True},
            {"enabled": "false"},
            {"keywords": []},
            {"path": "/etc/passwd"},
            {"keywords": ["a", "a"]},
        ):
            with self.subTest(row=row), self.assertRaises(SkinError):
                controls(row)

    def test_only_https_sites_without_credentials(self):
        self.assertEqual(site_url("https://example.org/project"), "https://example.org/project/")
        for value in [
            "http://example.org",
            "https://u:p@example.org",
            "https://example.org:22",
            "https://example.org/?a=b",
            "https://example.org/../a",
            "https://example.org/%2e%2e",
        ]:
            with self.subTest(value=value), self.assertRaises(SkinError):
                site_url(value)


class StoreTests(StoreFixture):
    def test_bootstrap_preserves_originals(self):
        self.assertEqual(len(self.store.snapshot()["skins"]), 4)
        self.assertTrue((self.assets / MANIFEST).is_file())
        for r in self.builtins:
            self.assertEqual(
                hashlib.sha256((self.assets / r["reference_name"]).read_bytes()).hexdigest(),
                r["reference_sha256"],
            )

    def test_new_skin_installed_and_enabled(self):
        self.apply()
        row = self.row()
        self.assertTrue(row["enabled"] and row["daily"])
        self.assertTrue(self.store.image_path(row).is_file())

    def test_local_disabled_survives_sync_and_restart(self):
        self.apply()
        self.store.update("issue-3", {"enabled": False}, self.store.snapshot()["revision"])
        self.apply()
        self.assertFalse(self.row()["enabled"])
        restored = Store(self.root / "state", self.assets, self.builtins)
        self.assertFalse(
            next(r for r in restored.snapshot()["skins"] if r["id"] == "issue-3")["enabled"]
        )

    def test_removal_disables_but_retains_original_and_history_metadata(self):
        self.apply()
        path = self.store.image_path(self.row())
        self.store.apply_catalog([], "https://example.org/", "v2")
        self.assertFalse(self.row()["enabled"])
        self.assertFalse(self.row()["present"])
        self.assertTrue(path.exists())
        self.assertEqual(len(self.store.snapshot()["skins"]), 5)

    def test_daily_consent_is_enforced(self):
        self.apply(requestedDailyRotation=False)
        self.store.update("issue-3", {"daily": True}, self.store.snapshot()["revision"])
        self.assertFalse(self.row()["daily"])
        self.assertFalse(self.row()["daily_allowed"])

    def test_daily_toggle_can_be_reenabled_when_source_allows(self):
        self.apply()
        self.store.update("issue-3", {"daily": False}, self.store.snapshot()["revision"])
        self.assertFalse(self.row()["daily"])
        self.assertTrue(self.row()["daily_allowed"])
        self.store.update("issue-3", {"daily": True}, self.store.snapshot()["revision"])
        self.assertTrue(self.row()["daily"])

    def test_original_stays_default_and_immutable(self):
        for patch_data in (
            {"enabled": False},
            {"appearance": "短发"},
            {"keywords": ["短发"]},
        ):
            with self.assertRaises(SkinError):
                self.store.update("original", patch_data, self.store.snapshot()["revision"])

    def test_revision_prevents_lost_update(self):
        rev = self.store.snapshot()["revision"]
        self.store.update("winter", {"weight": 5}, rev)
        with self.assertRaises(SkinError) as ctx:
            self.store.update("sweater", {"weight": 9}, rev)
        self.assertEqual(ctx.exception.status, 409)

    def test_duplicate_keyword_does_not_change_published_state(self):
        self.apply()
        before = (self.assets / MANIFEST).read_bytes()
        with self.assertRaises(SkinError):
            self.store.update("issue-3", {"keywords": ["冬装"]}, self.store.snapshot()["revision"])
        self.assertEqual((self.assets / MANIFEST).read_bytes(), before)

    def test_reset_local_overrides(self):
        self.apply()
        self.store.update(
            "issue-3",
            {"weight": 9, "keywords": ["小短发"]},
            self.store.snapshot()["revision"],
        )
        self.store.update("issue-3", {}, self.store.snapshot()["revision"], reset=True)
        self.assertEqual(self.row()["keywords"], ["短发"])
        self.assertEqual(self.row()["weight"], 3)

    def test_reference_tampering_is_blocked(self):
        self.apply()
        path = self.store.image_path(self.row())
        path.write_bytes(b"damaged")
        with self.assertRaises(SkinError):
            self.store.image_path(self.row())

    def test_publication_failure_restores_state(self):
        old = self.store.path.read_bytes()
        from astrbot_plugin_whale_skins import store as module

        real = module.atomic

        def failure(path, value):
            if Path(path).name == MANIFEST:
                raise OSError("模拟写入失败")
            return real(path, value)

        with (
            patch.object(module, "atomic", side_effect=failure),
            self.assertRaises(OSError),
        ):
            self.store.update("winter", {"weight": 8}, self.store.snapshot()["revision"])
        self.assertEqual(self.store.path.read_bytes(), old)


class FakeDownloader:
    payload = None
    data = None
    calls: ClassVar[list] = []
    error = False

    def __init__(self, site):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def fetch(self, path, limit, etag=None):
        self.calls.append(path)
        if self.error:
            raise OSError("网络不可用")
        return (self.payload, "v1") if path.endswith("catalog.json") else (self.data, None)


class SyncTests(StoreFixture, unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        FakeDownloader.payload = json.dumps(catalog(submission()), ensure_ascii=False).encode()
        FakeDownloader.data = picture()
        FakeDownloader.calls = []
        FakeDownloader.error = False
        self.service = SyncService(self.store, "https://example.org/", FakeDownloader)

    async def test_approved_skin_auto_installed_without_model_or_qq(self):
        await self.service.run()
        self.assertTrue(self.row()["enabled"])
        self.assertEqual(
            FakeDownloader.calls, ["skins/catalog.json", "skins/issue-3/reference.png"]
        )

    async def test_unchanged_image_is_not_downloaded_again(self):
        await self.service.run()
        FakeDownloader.calls = []
        await self.service.run()
        self.assertEqual(FakeDownloader.calls, ["skins/catalog.json"])

    async def test_bad_image_keeps_last_good_registry(self):
        self.apply()
        before = (self.assets / MANIFEST).read_bytes()
        FakeDownloader.data = b"bad"
        with self.assertRaises(SkinError):
            await self.service.run()
        self.assertEqual((self.assets / MANIFEST).read_bytes(), before)
        self.assertIsNotNone(self.store.snapshot()["sync"]["last_error"])

    async def test_network_failure_preserves_skin(self):
        self.apply()
        FakeDownloader.error = True
        with self.assertRaises(SkinError):
            await self.service.run()
        self.assertTrue(self.row()["enabled"])

    async def test_cancel_does_not_publish_partial_registry(self):
        before = (self.assets / MANIFEST).read_bytes()
        with patch.object(FakeDownloader, "fetch", side_effect=asyncio.CancelledError):
            with self.assertRaises(asyncio.CancelledError):
                await self.service.run()
        self.assertEqual((self.assets / MANIFEST).read_bytes(), before)

    async def test_empty_approved_list_disables_community_only(self):
        self.apply()
        FakeDownloader.payload = json.dumps(catalog()).encode()
        await self.service.run()
        self.assertFalse(self.row()["enabled"])
        self.assertTrue(all(r["enabled"] for r in self.store.snapshot()["skins"] if r["builtin"]))

    async def test_concurrent_sync_rejected(self):
        async with self.service.lock:
            with self.assertRaises(SkinError) as ctx:
                await self.service.run()
        self.assertEqual(ctx.exception.status, 409)

    async def test_private_dns_rejected(self):
        resolver = PublicResolver()
        with patch.object(
            resolver.resolver,
            "resolve",
            AsyncMock(return_value=[{"host": "127.0.0.1"}]),
        ):
            with self.assertRaises(SkinError):
                await resolver.resolve("example.org", 443)
        await resolver.close()

    async def test_bad_catalog_does_not_withdraw_existing_skin(self):
        self.apply()
        FakeDownloader.payload = b'{"schema":"wrong","skins":[]}'
        with self.assertRaises(SkinError):
            await self.service.run()
        self.assertTrue(self.row()["enabled"])

    async def test_304_verifies_local_data_and_recovers_next_time(self):
        await self.service.run()
        FakeDownloader.payload = None
        await self.service.run()
        self.assertIsNone(self.store.snapshot()["sync"]["last_error"])
        self.store.image_path(self.row()).unlink()
        with self.assertRaises(SkinError):
            await self.service.run()
        self.assertIsNone(self.store.snapshot()["sync"]["etag"])


class AdapterTests(StoreFixture):
    def setUp(self):
        super().setUp()
        source = ROOT / "integrations/kuaiai_image"
        name = "whale_image_adapter_test"
        package = types.ModuleType(name)
        package.__path__ = [str(source)]
        core = types.ModuleType(name + ".core")
        core.ImageError = type("ImageError", (ValueError,), {})
        sys.modules[name] = package
        sys.modules[name + ".core"] = core
        for child in ("library_registry", "skins"):
            spec = importlib.util.spec_from_file_location(
                name + "." + child, source / (child + ".py")
            )
            module = importlib.util.module_from_spec(spec)
            sys.modules[name + "." + child] = module
            spec.loader.exec_module(module)
        self.skins = sys.modules[name + ".skins"]
        self.skins.configure_skin_library(self.assets)

    def tearDown(self):
        self.skins.SKINS.root = None
        self.skins.SKINS.records = {}
        self.skins.SKINS.current = dict(self.skins.SKINS.builtins)
        super().tearDown()

    def test_new_skin_available_without_reload_and_defaults_original(self):
        self.assertEqual(self.skins.select_manual_skin("画张庆祝图").id, "original")
        self.apply()
        self.assertEqual(self.skins.select_manual_skin("短发大肥鱼庆祝选课").id, "issue-3")
        self.assertIn("波波头", self.skins.get_skin("issue-3").appearance)
        self.assertNotIn("深靛蓝长发", self.skins.get_skin("issue-3").appearance)
        self.assertEqual(
            self.skins.validate_skin_reference(self.skins.get_skin("issue-3"), self.assets),
            self.store.image_path(self.row()),
        )

    def test_local_disable_blocks_explicit_keyword_not_fallback(self):
        self.apply()
        self.store.update("issue-3", {"enabled": False}, self.store.snapshot()["revision"])
        with self.assertRaises(self.skins.ImageError):
            self.skins.select_manual_skin("帮我画短发大肥鱼")
        self.assertEqual(self.skins.get_skin("issue-3").id, "issue-3")

    def test_negative_keywords_and_multiskin_conflicts(self):
        self.apply()
        self.assertEqual(self.skins.select_manual_skin("不要短发，用冬装").id, "winter")
        with self.assertRaises(self.skins.ImageError):
            self.skins.select_manual_skin("短发和毛衣")

    def test_daily_consent_and_disabled_are_not_in_rotation(self):
        self.apply(requestedDailyRotation=False)
        dist = self.skins.daily_skin_distribution(self.assets)
        self.assertNotIn("issue-3", dist["probabilities"])
        self.apply()
        self.assertIn("issue-3", self.skins.daily_skin_distribution(self.assets)["probabilities"])

    def test_last_success_is_zero_and_retired_history_is_readable(self):
        self.apply()
        history = self.root / "history"
        history.mkdir()
        (history / "2026-11-14.json").write_text(
            json.dumps({"status": "sent", "skin_id": "issue-3", "updated_at": 9})
        )
        self.assertEqual(
            self.skins.daily_skin_distribution(self.assets, history)["probabilities"]["issue-3"],
            0,
        )
        self.store.apply_catalog([], "https://example.org/", "v2")
        self.assertEqual(self.skins.read_recent_skin_history(history), ["issue-3"])
        self.assertNotIn(
            "issue-3",
            self.skins.daily_skin_distribution(self.assets, history)["weights"],
        )

    def test_live_control_changes_are_read_without_reload(self):
        self.apply()
        self.store.update(
            "issue-3",
            {"keywords": ["新短发"], "weight": 8},
            self.store.snapshot()["revision"],
        )
        self.assertEqual(self.skins.select_manual_skin("新短发").id, "issue-3")
        self.assertEqual(
            self.skins.daily_skin_distribution(self.assets)["base_weights"]["issue-3"],
            8,
        )

    def test_damaged_manifest_keeps_complete_last_snapshot(self):
        self.apply()
        self.assertIn("issue-3", self.skins.SKINS)
        (self.assets / MANIFEST).write_text("{broken")
        self.assertEqual(self.skins.select_manual_skin("短发").id, "issue-3")
        self.assertTrue(self.skins.skin_library_status()["error"])

    def test_tampered_image_blocked_before_billing(self):
        self.apply()
        skin = self.skins.get_skin("issue-3")
        self.store.image_path(self.row()).write_bytes(b"bad")
        with self.assertRaises(self.skins.ImageError):
            self.skins.validate_skin_reference(skin, self.assets)

    def test_many_picks_have_no_consecutive_repeat(self):
        self.apply()
        available = list(self.skins.SKINS.values())
        recent = []
        last = None
        random.seed(44)
        for _ in range(1000):
            chosen = random.choices(
                available, weights=self.skins.rotation_weights(available, recent)
            )[0]
            self.assertNotEqual(chosen.id, last)
            last = chosen.id
            recent = [last, *recent][:8]


if __name__ == "__main__":
    unittest.main()
