"""持久管理状态与原子发布；参考图使用内容寻址，不覆盖历史原图。"""

from __future__ import annotations

import copy
import hashlib
import json
import os
import threading
import time
import uuid
from pathlib import Path

from .models import BUILTIN_IDS, MAX_CATALOG, SkinError, controls

MANIFEST = "whale_skin_library.json"


def atomic(path, value):
    path = Path(path)
    if path.is_symlink() or path.parent.is_symlink():
        raise SkinError("存储路径异常。")
    temporary = path.with_name("." + path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        with temporary.open("x", encoding="utf-8", newline="\n") as stream:
            os.chmod(temporary, 0o600)
            json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


class Store:
    def __init__(self, root, assets, builtins):
        self.root, self.assets = Path(root), Path(assets)
        self.lock = threading.RLock()
        for folder in (self.root, self.assets, self.assets / "skin_library"):
            if folder.is_symlink():
                raise SkinError("存储目录不能是符号链接。")
            folder.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = self.root / "state.json"
        if self.path.is_symlink():
            raise SkinError("状态文件路径异常。")
        if self.path.exists():
            if self.path.stat().st_size > MAX_CATALOG * 3:
                raise SkinError("皮肤状态文件过大。")
            self.state = json.loads(self.path.read_text(encoding="utf-8"))
            if self.state.get("schema") != "whale-skin-state/v1":
                raise SkinError("皮肤状态文件协议无效。")
        else:
            self.state = {
                "schema": "whale-skin-state/v1",
                "revision": 0,
                "skins": {},
                "overrides": {},
                "sync": {
                    "last_attempt": None,
                    "last_success": None,
                    "last_error": None,
                    "etag": None,
                    "source": None,
                },
            }
            for row in builtins:
                self.state["skins"][row["id"]] = dict(row, builtin=True, present=True)
        self.publish()

    def _rows(self, state):
        rows = []
        for skin_id, record in state["skins"].items():
            row = copy.deepcopy(record)
            row.update(state["overrides"].get(skin_id, {}))
            row["enabled"] = bool(row.get("present", False) and row.get("enabled", True))
            row["daily_allowed"] = bool(row["builtin"] or record.get("daily", False))
            # 投稿者撤销轮换意向时，本地开关也不能重新加入日报。
            row["daily"] = bool(row.get("daily", True) and row["daily_allowed"])
            row["weight"] = float(row.get("weight", 1.0 if skin_id == "original" else 3.0))
            row["local_override"] = copy.deepcopy(state["overrides"].get(skin_id, {}))
            rows.append(row)
        return rows

    def snapshot(self):
        with self.lock:
            return {
                "revision": self.state["revision"],
                "skins": self._rows(self.state),
                "sync": copy.deepcopy(self.state["sync"]),
            }

    def _check_words(self, state):
        used = {}
        for row in self._rows(state):
            # 停用的关键词保留为提示；不允许指向另一套皮肤。
            for word in row["keywords"]:
                folded = word.casefold()
                if folded in used and used[folded] != row["id"]:
                    raise SkinError("关键词与其他皮肤冲突，请修改后保存。")
                used[folded] = row["id"]

    def _manifest(self, state):
        return {
            "schema": "whale-skin-library/v1",
            "revision": state["revision"],
            "updated_at": time.time(),
            "skins": [
                {
                    k: r[k]
                    for k in (
                        "id",
                        "name",
                        "reference_name",
                        "reference_sha256",
                        "appearance",
                        "render_style",
                        "keywords",
                        "enabled",
                        "daily",
                        "weight",
                        "builtin",
                    )
                }
                for r in self._rows(state)
            ],
        }

    def _commit(self, candidate):
        self._check_words(candidate)
        candidate["revision"] = self.state["revision"] + 1
        old = self.state
        atomic(self.path, candidate)
        try:
            atomic(self.assets / MANIFEST, self._manifest(candidate))
        except Exception:
            atomic(self.path, old)
            raise
        self.state = candidate

    def publish(self):
        with self.lock:
            self._check_words(self.state)
            atomic(self.path, self.state)
            atomic(self.assets / MANIFEST, self._manifest(self.state))

    def update(self, skin_id, patch, revision, *, reset=False):
        with self.lock:
            if skin_id not in self.state["skins"]:
                raise SkinError("皮肤不存在。", 404)
            if type(revision) is not int or revision != self.state["revision"]:
                raise SkinError("皮肤设置已变化，请刷新后再保存。", 409)
            checked = controls(patch)
            if checked.get("enabled") is True and not self.state["skins"][skin_id].get("present"):
                raise SkinError("这套皮肤已撤销收录，需要网站重新审核后才能启用。")
            if skin_id == "original" and (
                checked.get("enabled") is False or "keywords" in checked or "appearance" in checked
            ):
                raise SkinError("原装作为默认人设保留启用，关键词和外观不在此修改。")
            candidate = copy.deepcopy(self.state)
            if reset:
                candidate["overrides"].pop(skin_id, None)
            else:
                candidate["overrides"].setdefault(skin_id, {}).update(checked)
            self._commit(candidate)
            return self.snapshot()

    def sync_state(self, **fields):
        with self.lock:
            candidate = copy.deepcopy(self.state)
            candidate["sync"].update(fields)
            # 仅运行状态不改变目录版本，不触发页面设置冲突。
            atomic(self.path, candidate)
            self.state = candidate

    def install_image(self, data, sha, suffix):
        filename = f"skin_library/{sha}.{suffix}"
        path = self.assets / filename
        if path.is_symlink():
            raise SkinError("原图路径异常。")
        if path.exists():
            if hashlib.sha256(path.read_bytes()).hexdigest() != sha:
                raise SkinError("已有参考图内容异常，未覆盖。")
            return filename
        temp = path.with_suffix("." + uuid.uuid4().hex + ".tmp")
        try:
            with temp.open("xb") as stream:
                os.chmod(temp, 0o600)
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temp, path)
        finally:
            temp.unlink(missing_ok=True)
        return filename

    def image_path(self, row):
        path = self.assets / row["reference_name"]
        if (
            path.is_symlink()
            or path.parent.is_symlink()
            or not path.resolve().is_relative_to(self.assets.resolve())
        ):
            raise SkinError("原图路径异常。")
        if (
            not path.is_file()
            or hashlib.sha256(path.read_bytes()).hexdigest() != row["reference_sha256"]
        ):
            raise SkinError("原图不存在或校验失败。", 409)
        return path

    def apply_catalog(self, records, source, etag):
        with self.lock:
            candidate = copy.deepcopy(self.state)
            for row in candidate["skins"].values():
                if not row["builtin"]:
                    row["present"] = False
            for record in records:
                if record["id"] in BUILTIN_IDS:
                    continue
                candidate["skins"][record["id"]] = dict(
                    record, present=True, builtin=False, render_style="", enabled=True
                )
            candidate["sync"].update(
                last_success=time.time(),
                last_error=None,
                etag=etag,
                source=source,
                catalog_count=len(records),
            )
            self._commit(candidate)
            return self.snapshot()
