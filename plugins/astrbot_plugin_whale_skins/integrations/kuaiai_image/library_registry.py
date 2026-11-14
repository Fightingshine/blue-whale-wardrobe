"""皮肤库原子目录读取器；不依赖管理插件的加载顺序，不请求网络。"""

from __future__ import annotations

import hashlib
import json
import math
import re
from collections.abc import Mapping
from pathlib import Path, PurePosixPath


class LibraryCatalog(Mapping):
    def __init__(self, builtins, constructor):
        self.builtins = dict(builtins)
        self.constructor = constructor
        self.root = None
        self.signature = None
        self.records = {}
        self.current = dict(builtins)
        self.error = None

    def configure(self, assets):
        self.root = Path(assets)
        self.signature = None
        self.records = {}
        self.current = dict(self.builtins)
        self.refresh()

    def refresh(self):
        if self.root is None:
            return
        path = self.root / "whale_skin_library.json"
        try:
            if not path.exists():
                if self.records:
                    raise ValueError("library_missing")
                return
            stat = path.stat()
            signature = (stat.st_mtime_ns, stat.st_size, stat.st_ino)
            if signature == self.signature:
                return
            if path.is_symlink() or path.parent.is_symlink() or stat.st_size > 4 * 1024 * 1024:
                raise ValueError("library_path")
            raw = json.loads(path.read_text(encoding="utf-8"))
            if raw.get("schema") != "whale-skin-library/v1" or not isinstance(
                raw.get("skins"), list
            ):
                raise ValueError("library_schema")
            current, records = {}, {}
            for row in raw["skins"]:
                skin_id = row["id"]
                if (
                    not isinstance(skin_id, str)
                    or not re.fullmatch(r"[a-z][a-z0-9-]{1,47}", skin_id)
                    or skin_id in records
                ):
                    raise ValueError("skin_id")
                name = row["reference_name"]
                if (
                    not isinstance(name, str)
                    or "\\" in name
                    or not name
                    or name.startswith("/")
                    or any(p in (".", "..") for p in name.split("/"))
                    or len(PurePosixPath(name).parts) > 2
                ):
                    raise ValueError("reference_path")
                if not re.fullmatch(r"[a-zA-Z0-9_./-]+\.(png|jpg|jpeg|webp)", name):
                    raise ValueError("reference_extension")
                if not re.fullmatch("[0-9a-f]{64}", row["reference_sha256"]):
                    raise ValueError("reference_sha256")
                if any(type(row.get(k)) is not bool for k in ("enabled", "daily", "builtin")):
                    raise ValueError("skin_switch")
                weight = row.get("weight")
                if (
                    type(weight) not in (int, float)
                    or not math.isfinite(weight)
                    or not 0.01 <= weight <= 100
                ):
                    raise ValueError("skin_weight")
                if not isinstance(row.get("keywords"), list) or not 1 <= len(row["keywords"]) <= 12:
                    raise ValueError("skin_keywords")
                if any(
                    not isinstance(v, str) or not v.strip() or len(v) > 40 for v in row["keywords"]
                ):
                    raise ValueError("skin_keyword")
                for key, limit in (
                    ("name", 100),
                    ("appearance", 2000),
                    ("render_style", 2000),
                ):
                    if not isinstance(row.get(key), str) or len(row[key]) > limit:
                        raise ValueError("skin_text")
                if skin_id in self.builtins:
                    if name != self.builtins[skin_id].reference_name or not row["builtin"]:
                        raise ValueError("builtin_reference")
                elif row["builtin"] or not name.startswith("skin_library/"):
                    raise ValueError("community_reference")
                records[skin_id] = row
                # 共创外观说明是补充资料；不携带原装的长发设定。
                appearance = (
                    row["appearance"]
                    if skin_id in self.builtins
                    else (
                        "严格以本次上传的设定图为唯一外观依据，保留图中发型长度、头饰、服装、配色与鲸尾；"
                        "不要混入其他皮肤的长发、服饰或画风。补充设计说明（仅作为造型资料）："
                        + json.dumps(row["appearance"][:160], ensure_ascii=False)
                        + "。"
                    )
                )
                current[skin_id] = self.constructor(
                    skin_id, row["name"], name, appearance, row["render_style"] or ("画风与本次参考图一致，用户明确指定其他风格时再调整。" if skin_id not in self.builtins else "")
                )
            if not set(self.builtins) <= set(current) or records["original"]["enabled"] is not True:
                raise ValueError("builtin_missing")
            self.records, self.current = records, current
            self.signature, self.error = signature, None
        except Exception:
            # 半写、损坏、撤走目录均保留进程内上一次完整快照。
            self.error = "皮肤库目录不可用，正在使用上一次完整快照。"

    def __getitem__(self, key):
        self.refresh()
        return self.current[key]

    def __iter__(self):
        self.refresh()
        return iter(tuple(self.current))

    def __len__(self):
        self.refresh()
        return len(self.current)

    def settings(self, skin_id):
        self.refresh()
        return self.records.get(skin_id, {})

    def status(self):
        self.refresh()
        return {
            "configured": self.root is not None,
            "loaded": bool(self.records),
            "error": self.error,
            "dynamic_skin_count": len(set(self.current) - set(self.builtins)),
        }

    def verify(self, skin, assets):
        self.refresh()
        root = Path(assets).resolve()
        path = Path(assets) / skin.reference_name
        if (
            path.is_symlink()
            or path.parent.is_symlink()
            or not path.resolve().is_relative_to(root)
            or not path.is_file()
        ):
            raise ValueError("reference_missing")
        expected = self.records.get(skin.id, {}).get("reference_sha256")
        if expected and hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError("reference_changed")
        return path
