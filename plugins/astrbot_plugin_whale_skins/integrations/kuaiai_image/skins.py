"""固定人设皮肤及关键词选择；不请求模型，不修改用户提供的参考图。"""

from __future__ import annotations

import datetime
import json
import math
import random
import re
from dataclasses import dataclass
from pathlib import Path

from .core import ImageError
from .library_registry import LibraryCatalog


@dataclass(frozen=True)
class CharacterSkin:
    id: str
    label: str
    reference_name: str
    appearance: str
    render_style: str = ""


ORIGINAL = CharacterSkin(
    "original",
    "原装",
    "whale_reference.png",
    (
        "外观以参考图为准：深靛蓝长发，仅发梢渐浅蓝并自然弯曲，保留刘海、弯呆毛、蓝眼；"
        "白蕾丝发箍、带金扣的蓝蝴蝶结、深蓝外缘白色内纹的侧鳍；"
        "深蓝金纹长袖女仆裙、鲸鱼刺绣白围裙、蓝色鲸鱼尾巴。"
        "保持原图发型、发色、饰品形状、服装纹样与Q版比例，不自行浅蓝化、加密集卷发或更换款式。"
    ),
)
WINTER = CharacterSkin(
    "winter",
    "冬装",
    "whale_winter_reference.jpg",
    (
        "冬装外观以参考图为准：深靛蓝长发、发梢浅蓝、蓝眼、Q版比例；"
        "蓝鲸造型连帽外套，帽檐袖口衣摆均有白绒边，蓝白格纹围巾、毛球系带、手套、蓝短靴；"
        "保留鲸鱼胸针、衣服鲸纹与蓝鲸尾巴。本次固定冬装，不混入原装女仆裙或毛衣皮肤。"
    ),
)
SWEATER = CharacterSkin(
    "sweater",
    "毛衣",
    "whale_sweater_reference.png",
    (
        "毛衣外观以参考图为准：深靛蓝长发、发梢浅蓝、蓝眼、弯呆毛与侧鳍、Q版比例；"
        "米白麻花针织帽、胸前蓝鲸图案的米白高领毛衣、深蓝格纹短裙、米白腿套、深蓝鞋；"
        "保留鲸鱼斜挎小包、蝴蝶结、蓝鲸尾巴。本次固定毛衣装，不混入女仆裙或冬装绒边外套。"
    ),
)
PIXEL = CharacterSkin(
    "pixel",
    "像素风大肥鱼",
    "whale_pixel_reference.png",
    (
        "像素风大肥鱼外观以参考图为准：深靛蓝长发与浅蓝发梢、弯呆毛、蓝眼、白蕾丝头箍、金扣蓝蝴蝶结、蓝白侧鳍；"
        "深蓝金纹长袖女仆裙、鲸鱼白围裙、蓝鲸尾巴和Q版比例。"
    ),
    (
        "沿用参考图的细腻像素插画：方形色块、阶梯轮廓、蓝紫分层光影、星点眼睛高光和粉色腮红，"
        "不改成平滑动漫线稿或粗糙游戏小人。"
    ),
)
SKINS = LibraryCatalog(
    {skin.id: skin for skin in (ORIGINAL, WINTER, SWEATER, PIXEL)}, CharacterSkin
)


def configure_skin_library(assets):
    SKINS.configure(assets)


def skin_library_status():
    return SKINS.status()


def is_skin_enabled(skin_id):
    return SKINS.settings(skin_id).get("enabled", True)


def validate_skin_reference(skin, assets):
    if not is_skin_enabled(skin.id):
        raise ImageError("这套皮肤已停用或撤销收录，没有提交生图请求。")
    try:
        return SKINS.verify(skin, assets)
    except ValueError as exc:
        raise ImageError("皮肤参考图暂不可用（缺失或校验失败），没有提交生图请求。") from exc


KEYWORDS = {
    "original": re.compile(r"原装(?:皮肤)?|原皮|原版皮肤|默认皮肤|女仆装"),
    "winter": re.compile(r"冬装|冬日装|冬季装"),
    "sweater": re.compile(r"毛衣|针织装"),
    "pixel": re.compile(r"像素风|像素画|像素皮肤"),
}
NEGATED = re.compile(
    r"(?:不要|不用|不穿|不选|别用|别穿|不需要|排除|不是|不画|去掉)(?:穿|用|选)?[的\s]*$"
)


def get_skin(skin_id="original") -> CharacterSkin:
    if not isinstance(skin_id, str) or skin_id not in SKINS:
        raise ImageError("皮肤记录无效，请联系管理员；没有提交生图请求。")
    return SKINS[skin_id]


def select_manual_skin(user_text: str) -> CharacterSkin:
    selected, excluded = set(), set()
    source = user_text or ""
    candidates = []
    for skin_id in SKINS:
        words = SKINS.settings(skin_id).get("keywords")
        pattern = (
            re.compile("|".join(re.escape(w) for w in sorted(words, key=len, reverse=True)), re.I)
            if words
            else KEYWORDS.get(skin_id)
        )
        if pattern is not None:
            for match in pattern.finditer(source):
                candidates.append((match.start(), match.end(), skin_id))
    occupied = []
    for start, end, skin_id in sorted(candidates, key=lambda x: (-(x[1] - x[0]), x[0])):
        if any(start < b and end > a for a, b in occupied):
            continue
        occupied.append((start, end))
        if NEGATED.search(source[max(0, start - 10) : start]):
            excluded.add(skin_id)
        else:
            selected.add(skin_id)
    selected -= excluded
    if len(selected) > 1:
        raise ImageError("这次指定了多套皮肤，请只选一套；没有提交请求。")
    if selected:
        skin_id = next(iter(selected))
        if not is_skin_enabled(skin_id):
            raise ImageError("这套皮肤已停用或撤销收录，请选择其他皮肤；没有提交请求。")
        return get_skin(skin_id)
    if "original" in excluded:
        raise ImageError("请明确选择其他皮肤；没有提交请求。")
    return get_skin("original")


BASE_WEIGHTS = {"original": 1.0, "winter": 3.0, "sweater": 3.0, "pixel": 3.0}
RECENCY_FACTORS = (0.0, 0.5, 0.8)
ROTATION_METHOD = "weighted_recency_no_repeat_v2"
HISTORY_NAME = re.compile(r"^(\d{4}-\d{2}-\d{2})(?:\.json|\.failed-\d+\.json)$")


def read_recent_skin_history(history_dir: Path | None = None) -> list[str]:
    """复用持久日报账本；只统计真实生成成功，不写生产历史或另建状态。"""
    if history_dir is None:
        return []
    root = Path(history_dir)
    if root.is_symlink():
        raise ImageError("皮肤使用历史路径异常，没有提交生图请求。")
    if not root.exists():
        return []
    events = {}
    try:
        if not root.is_dir():
            raise ValueError("history directory")
        for path in sorted(root.glob("*.json"), reverse=True)[:512]:
            match = HISTORY_NAME.fullmatch(path.name)
            if not match:
                continue
            day = datetime.date.fromisoformat(match[1])
            if path.is_symlink() or path.stat().st_size > 65536:
                raise ValueError("history file")
            record = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(record, dict):
                raise ValueError("history schema")
            if (
                record.get("image_generation_succeeded") is not True
                and record.get("status") != "sent"
            ):
                continue
            skin = get_skin(record.get("skin_id", "original"))
            identity = record.get("image_job_id") or "legacy:" + day.isoformat()
            if not isinstance(identity, str) or len(identity) > 128:
                raise ValueError("history identity")
            stamp = record.get(
                "image_generated_at", record.get("updated_at", record.get("created_at"))
            )
            if stamp is None:
                stamp = datetime.datetime.combine(
                    day, datetime.time(), tzinfo=datetime.timezone.utc
                ).timestamp()
            if type(stamp) not in (int, float) or not math.isfinite(stamp):
                raise ValueError("history timestamp")
            if identity in events and events[identity][1] != skin.id:
                raise ValueError("history conflict")
            events[identity] = (
                max(float(stamp), events.get(identity, (float("-inf"), ""))[0]),
                skin.id,
            )
    except (OSError, ValueError, TypeError) as error:
        raise ImageError("皮肤使用历史无法可靠读取，未退回等概率，也没有提交生图请求。") from error
    return [skin_id for _, skin_id in sorted(events.values(), reverse=True)[:8]]


def rotation_weights(available, recent: list[str]) -> list[float]:
    """最近1次成功的皮肤禁抽；最近2/3次分别乘0.5/0.8，再恢复。"""
    for skin_id in recent:
        get_skin(skin_id)
    weights = []
    for skin in available:
        age = next((i for i, value in enumerate(recent) if value == skin.id), None)
        factor = RECENCY_FACTORS[age] if age is not None and age < len(RECENCY_FACTORS) else 1.0
        weights.append(
            SKINS.settings(skin.id).get("weight", BASE_WEIGHTS.get(skin.id, 3.0)) * factor
        )
    return weights


def daily_skin_distribution(assets_dir: Path, history_dir: Path | None = None) -> dict:
    available = [
        skin
        for skin in SKINS.values()
        if is_skin_enabled(skin.id)
        and SKINS.settings(skin.id).get("daily", True)
        and (Path(assets_dir) / skin.reference_name).is_file()
    ]
    if not available:
        raise ImageError("没有可用的人设参考图，日报配图未提交。")
    recent = read_recent_skin_history(history_dir)
    weights = rotation_weights(available, recent)
    total = sum(weights)
    if total <= 0:
        raise ImageError(
            "可用参考图只剩上次成功使用的皮肤，为避免连续重复，本次未提交日报生图；请恢复其他皮肤参考图。"
        )
    return {
        "method": ROTATION_METHOD,
        "base_weights": {
            s.id: SKINS.settings(s.id).get("weight", BASE_WEIGHTS.get(s.id, 3.0)) for s in available
        },
        "weights": dict(zip((skin.id for skin in available), weights)),
        "probabilities": {skin.id: weight / total for skin, weight in zip(available, weights)},
        "recent_successful_skins": recent,
        "success_only": True,
        "recency_factors": list(RECENCY_FACTORS),
        "forced_rotation": False,
        "no_consecutive_repeat": True,
        "blocked_skin_id": recent[0] if recent else None,
    }


def choose_daily_skin(assets_dir: Path, history_dir: Path | None = None) -> CharacterSkin:
    state = daily_skin_distribution(assets_dir, history_dir)
    available = [SKINS[skin_id] for skin_id in state["weights"]]
    return random.choices(available, weights=list(state["weights"].values()), k=1)[0]


def skin_record(skin: CharacterSkin) -> dict:
    return {
        "skin_id": skin.id,
        "skin_label": skin.label,
        "skin_reference_name": skin.reference_name,
    }
