"""公开图鉴协议与受限图片验证，不执行投稿里的文本。"""

from __future__ import annotations

import hashlib
import io
import math
import re
from pathlib import PurePosixPath
from urllib.parse import urlsplit

from PIL import Image

MAX_IMAGE = 10 * 1024 * 1024
MAX_CATALOG = 4 * 1024 * 1024
MAX_PIXELS = 24_000_000
BUILTIN_IDS = frozenset({"original", "winter", "sweater", "pixel"})
ID = re.compile(r"^[a-z][a-z0-9-]{1,47}$")
SHA = re.compile(r"^[0-9a-f]{64}$")


class SkinError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def text(value, limit, *, required=True):
    if (
        not isinstance(value, str)
        or len(value) > limit
        or any(ord(c) < 32 and c not in "\n\t" for c in value)
    ):
        raise SkinError("皮肤资料格式无效或内容过长。")
    value = value.strip()
    if required and not value:
        raise SkinError("皮肤资料存在必填项为空。")
    return value


def keywords(value):
    if not isinstance(value, list) or not 1 <= len(value) <= 12:
        raise SkinError("关键词需要 1 至 12 个。")
    result = [text(v, 40) for v in value]
    if len(set(result)) != len(result):
        raise SkinError("关键词不能重复。")
    return result


def site_url(value):
    value = text(value, 500)
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.port not in (None, 443)
        or parsed.query
        or parsed.fragment
        or "%" in parsed.path
        or ".." in parsed.path.split("/")
        or "\\" in value
    ):
        raise SkinError("图鉴地址需要不带凭据和参数的 HTTPS 网址。")
    return value.rstrip("/") + "/"


def validate_catalog(raw):
    if (
        not isinstance(raw, dict)
        or raw.get("schema") != "whale-skin-catalog/v1"
        or not isinstance(raw.get("skins"), list)
    ):
        raise SkinError("网站皮肤目录协议不受支持，继续使用现有皮肤。")
    result, ids, used_words = [], set(), {}
    for value in raw["skins"]:
        if not isinstance(value, dict):
            raise SkinError("网站皮肤记录格式无效。")
        skin_id = value.get("id")
        if not isinstance(skin_id, str) or not ID.fullmatch(skin_id) or skin_id in ids:
            raise SkinError("网站皮肤编号重复或无效。")
        ids.add(skin_id)
        if value.get("status") != "approved":
            continue
        words = keywords(value.get("keywords"))
        for word in words:
            if word.casefold() in used_words:
                raise SkinError("网站存在重复的皮肤关键词，请先修改投稿。")
            used_words[word.casefold()] = skin_id
        ref = value.get("reference")
        if not isinstance(ref, dict):
            raise SkinError("网站皮肤缺少原图信息。")
        path = ref.get("path", "")
        if not isinstance(path, str) or not re.fullmatch(
            r"skins/[a-z][a-z0-9-]{1,47}/reference\.(png|jpg|jpeg|webp)", path
        ):
            raise SkinError("原图路径无效。")
        if PurePosixPath(path).parts[1] != skin_id or not SHA.fullmatch(str(ref.get("sha256", ""))):
            raise SkinError("原图路径或 SHA-256 无效。")
        w, h, size = ref.get("width"), ref.get("height"), ref.get("bytes")
        if (
            any(type(v) is not int for v in (w, h, size))
            or w < 600
            or h < 300
            or w <= h
            or w * h > MAX_PIXELS
            or not 0 < size <= MAX_IMAGE
        ):
            raise SkinError("原图需要 600×300 以上的横向三视图，且不超过 10 MiB / 2400 万像素。")
        rotation = value.get("requestedDailyRotation", False)
        if type(rotation) is not bool:
            raise SkinError("日报轮换字段无效。")
        result.append(
            {
                "id": skin_id,
                "name": text(value.get("name"), 100),
                "keywords": words,
                "appearance": text(
                    value.get("appearance") or value.get("description") or "",
                    2000,
                    required=False,
                ),
                "attribution": text(value.get("attribution") or "", 2000, required=False),
                "daily": rotation,
                "reference": dict(ref),
                "builtin": skin_id in BUILTIN_IDS,
            }
        )
    return result


def verify_image(data, reference):
    if len(data) != reference["bytes"] or len(data) > MAX_IMAGE:
        raise SkinError("图片体积与目录记录不一致。")
    if hashlib.sha256(data).hexdigest() != reference["sha256"]:
        raise SkinError("原图 SHA-256 校验失败，未启用。")
    try:
        with Image.open(io.BytesIO(data)) as im:
            if im.format not in {"PNG", "JPEG", "WEBP"} or getattr(im, "n_frames", 1) != 1:
                raise SkinError("仅支持单帧 PNG、JPG、WebP 图片。")
            if (
                list(im.size) != [reference["width"], reference["height"]]
                or im.width * im.height > MAX_PIXELS
            ):
                raise SkinError("图片尺寸与目录记录不一致。")
            im.verify()
        with Image.open(io.BytesIO(data)) as im:
            im.load()
    except SkinError:
        raise
    except Exception as exc:
        raise SkinError("图片解码失败，未启用。") from exc
    return data


def controls(value):
    if not isinstance(value, dict) or set(value) - {
        "enabled",
        "daily",
        "weight",
        "keywords",
        "appearance",
    }:
        raise SkinError("设置字段无效。")
    result = {}
    for key in ("enabled", "daily"):
        if key in value:
            if type(value[key]) is not bool:
                raise SkinError("启用和轮换开关需要布尔值。")
            result[key] = value[key]
    if "weight" in value:
        w = value["weight"]
        if type(w) not in (int, float) or not math.isfinite(w) or not 0.01 <= w <= 100:
            raise SkinError("轮换权重需要在 0.01 至 100 之间。")
        result["weight"] = float(w)
    if "keywords" in value:
        result["keywords"] = keywords(value["keywords"])
    if "appearance" in value:
        result["appearance"] = text(value["appearance"], 2000, required=False)
    return result
