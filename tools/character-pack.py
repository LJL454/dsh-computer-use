# 把 C 版角色帧打包成 helper 直接可用的资源包（方案 4.1 / 5.1 / 5.3）。
#
# 两种输入模式：
#
#   1. `--source <frames-dir>`：`manifest.json` + `frames/<state>/NNN.png` 的逐帧目录（v1 时代的做法）。
#   2. `--atlas-source <dir>`：本轮重绘稿的**图集**（eat_loop_16.png、idle_8.png …）。
#      图集切格后统一成同一格尺寸、按"该片段全部帧的并集"量出 contentBounds 与锚点，
#      再输出 `dsh.character.pack/v2`。吃饭 16 帧、其余保持原帧数，混合帧数就在这一份包里。
#
# v2 与 v1 的差别（加载器两版都认，但只写 v2）：
#   - 每片段自带 `frameSize` / `grid`，不再全局 4×2、每格 384×512 写死；
#   - 每片段带 `contentBounds`（可见主体包围范围）与 `anchorPx`（包围范围底边中点），
#     运行时按"人物可见高度 ÷ 包围高度"缩放，透明边距不再吃掉设置值；
#   - 带 `sha256` 与 `bytes`，加载器逐字节校验。
#
#   python tools/character-pack.py --atlas-source <重绘稿目录> [--out assets/character] [--check]
#
# 依赖 Pillow。

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

from PIL import Image

SCHEMA_V1 = "dsh.character.animation/v1"
SCHEMA_OUT = "dsh.character.pack/v2"
# 校验模式也接受 v3（分层 + perClip）：正式资源由美术整包交付，本脚本只负责"生成 v2"与"核对现状"。
SCHEMA_CHECKABLE = ("dsh.character.pack/v2", "dsh.character.pack/v3")
CANVAS = (384, 512)
COLUMNS = 4
ROWS = 2
MAX_FRAME_MS = 5000
MAX_CLIP_MS = 20000
ALPHA_FLOOR = 8            # 低于它的像素按全透明清理（不是抠图规则，只去低 alpha 噪声）
BOUNDS_THRESHOLD = 24      # 量包围范围用的 alpha 阈值
REQUIRED_CLIPS = ("eat_loop", "idle", "move", "press_in", "pressed_hold", "release", "drag")

# 本轮重绘稿：文件名 → 片段、网格与时长（方案 4.5 / 5.1）。
# 吃饭 16 帧 3200 ms；其余保持原帧数与原有节奏；按住只有 1 帧主姿势。
ATLAS_SPEC = (
    {
        "clip": "eat_loop",
        "source": "eat_loop_16.png",
        "grid": (4, 4),
        "loop": True,
        "durations": [400, 240, 120, 120, 120, 120, 120, 160, 300, 180, 200, 200, 160, 160, 200, 400],
    },
    {
        "clip": "idle",
        "source": "idle_8.png",
        "grid": (4, 2),
        "loop": True,
        "durations": [650, 250, 100, 150, 100, 350, 350, 650],
    },
    {
        "clip": "move",
        "source": "move_8.png",
        "grid": (4, 2),
        "loop": True,
        "durations": [125] * 8,
    },
    {
        "clip": "press_in",
        "source": "press_in_8.png",
        "grid": (4, 2),
        "loop": False,
        "durations": [40] * 8,
    },
    {
        "clip": "pressed_hold",
        "source": "pressed_hold_1.png",
        "grid": (1, 1),
        "loop": True,
        "durations": [1000],
    },
    {
        "clip": "release",
        "source": "release_8.png",
        "grid": (4, 2),
        "loop": False,
        "durations": [45] * 8,
    },
    {
        "clip": "drag",
        "source": "drag_8.png",
        "grid": (4, 2),
        "loop": True,
        "durations": [180, 150, 150, 180, 160, 150, 150, 180],
    },
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fail(message: str) -> None:
    print(f"FAIL  {message}", file=sys.stderr)
    raise SystemExit(1)


def denoise(image: Image.Image) -> Image.Image:
    """把极低 alpha 的像素清零（残影/边缘噪声），不做颜色抠图，避免损伤原画。"""
    alpha = image.getchannel("A").point(lambda value: 0 if value < ALPHA_FLOOR else value)
    image.putalpha(alpha)
    return image


def feather_edges(image: Image.Image, width: int = 3) -> Image.Image:
    """在格子外缘做几像素的 alpha 渐隐。

    重绘稿的图集里，尾巴/发梢会一直画到格子边界之外（一个格子放不下整个动作），切格时那条边
    就是一刀切。直接显示会出现一条竖直的硬边，所以只在外缘做很短的渐隐 —— 不补画、不改形状，
    也不掩饰"素材仍需精修"这件事（本轮交付说明里如实写了）。
    """
    if width <= 0:
        return image
    pixels = image.load()
    w, h = image.size
    for y in range(h):
        for x in range(w):
            distance = min(x, y, w - 1 - x, h - 1 - y)
            if distance >= width:
                continue
            factor = (distance + 1) / (width + 1)
            r, g, b, a = pixels[x, y]
            if a == 0:
                continue
            pixels[x, y] = (r, g, b, int(a * factor))
    return image


def alpha_bbox(image: Image.Image):
    alpha = image.getchannel("A").point(lambda value: 255 if value >= BOUNDS_THRESHOLD else 0)
    return alpha.getbbox()


def cell_box(width: int, height: int, columns: int, rows: int, index: int):
    """按浮点边界切格，再四舍五入到整数：非整除图集（1086×1448 的 4×4）也不会错位。"""
    column = index % columns
    row = index // columns
    return (
        round(column * width / columns),
        round(row * height / rows),
        round((column + 1) * width / columns),
        round((row + 1) * height / rows),
    )


def build_clip_from_atlas(source_dir: Path, spec: dict) -> tuple[Image.Image, dict]:
    path = source_dir / spec["source"]
    if not path.is_file():
        fail(f"{spec['source']} not found under {source_dir}")
    atlas = Image.open(path)
    if atlas.mode != "RGBA":
        atlas = atlas.convert("RGBA")
    width, height = atlas.size
    columns, rows = spec["grid"]
    frame_count = columns * rows
    durations = list(spec["durations"])
    if len(durations) != frame_count:
        fail(f"{spec['clip']}: {len(durations)} durations for a {columns}×{rows} grid")
    total = sum(durations)
    if total <= 0 or total > MAX_CLIP_MS:
        fail(f"{spec['clip']}: the clip runs {total} ms, above the {MAX_CLIP_MS} ms cap")
    for value in durations:
        if value <= 0 or value > MAX_FRAME_MS:
            fail(f"{spec['clip']}: a frame duration is outside 1..{MAX_FRAME_MS} ms")

    cell_width = round(width / columns)
    cell_height = round(height / rows)
    frames = []
    for index in range(frame_count):
        box = cell_box(width, height, columns, rows, index)
        cell = atlas.crop(box)
        if cell.size != (cell_width, cell_height):
            cell = cell.resize((cell_width, cell_height), Image.LANCZOS)
        cell = denoise(cell)
        if alpha_bbox(cell) is None:
            fail(f"{spec['clip']}[{index}] is fully transparent after slicing")
        frames.append(feather_edges(cell,
                                    0 if (cell_width <= 8 or cell_height <= 8) else 3))

    # 该片段**全部帧的并集**：不逐帧自动居中，否则头发/尾巴会让整个人物跳动（方案 4.1）。
    left = cell_width
    top = cell_height
    right = 0
    bottom = 0
    touching = []
    for index, cell in enumerate(frames):
        box = alpha_bbox(cell)
        if box[0] <= 2 or box[1] <= 2 or box[2] >= cell_width - 2 or box[3] >= cell_height - 2:
            touching.append(index)
        left = min(left, box[0])
        top = min(top, box[1])
        right = max(right, box[2])
        bottom = max(bottom, box[3])
    if touching:
        # 画到格子外的帧没法靠切格补回来：这里只如实点名，等美术补画（方案 10.1 的精修项）。
        print(
            f"NOTE  {spec['clip']}: frames {touching} touch the cell border; "
            "the cut edge can only be feathered, not repaired (art redraw needed)",
            file=sys.stderr,
        )
    content = (left, top, right - left, bottom - top)
    if content[2] <= 4 or content[3] <= 4:
        fail(f"{spec['clip']}: the measured content is too small ({content})")
    aspect = content[2] / content[3]
    if not 0.15 <= aspect <= 2.5:
        fail(f"{spec['clip']}: implausible body aspect {aspect:.2f}")

    packed = Image.new("RGBA", (cell_width * columns, cell_height * rows), (0, 0, 0, 0))
    for index, cell in enumerate(frames):
        packed.paste(cell, ((index % columns) * cell_width, (index // columns) * cell_height))

    anchor = (content[0] + content[2] // 2, content[1] + content[3])
    meta = {
        "atlas": f"{spec['clip']}.png",
        "frameSize": [cell_width, cell_height],
        "grid": [columns, rows],
        "frameCount": frame_count,
        "loop": bool(spec["loop"]),
        "durationsMs": durations,
        "totalMs": total,
        "anchorPx": [anchor[0], anchor[1]],
        "contentBounds": [content[0], content[1], content[2], content[3]],
    }
    return packed, meta


def load_manifest(source: Path) -> dict:
    manifest_path = source / "manifest.json"
    if not manifest_path.is_file():
        fail(f"manifest.json not found under {source}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schema") != SCHEMA_V1:
        fail(f"unexpected schema {manifest.get('schema')!r}")
    canvas = manifest.get("canvas") or {}
    if (canvas.get("width"), canvas.get("height")) != CANVAS:
        fail(f"canvas is {canvas}, expected {CANVAS}")
    clips = manifest.get("clips") or {}
    missing = [name for name in REQUIRED_CLIPS if name not in clips]
    if missing:
        fail(f"missing clips: {', '.join(missing)}")
    return manifest


def build_clip_from_frames(source: Path, name: str, clip: dict) -> tuple[Image.Image, dict]:
    frames_meta = clip.get("frames") or []
    if not frames_meta:
        fail(f"{name} has no frames")
    if len(frames_meta) > COLUMNS * ROWS:
        fail(f"{name} has {len(frames_meta)} frames; this grid only holds {COLUMNS * ROWS}")
    images = []
    durations = []
    for index, frame in enumerate(frames_meta):
        relative = frame.get("file")
        if not relative:
            fail(f"{name}[{index}] has no file")
        path = (source / relative).resolve()
        if not path.is_file():
            fail(f"{name}[{index}] missing: {relative}")
        actual = sha256(path)
        if frame.get("sha256") and actual != frame["sha256"]:
            fail(f"{name}[{index}] hash mismatch")
        duration = int(frame.get("durationMs") or 0)
        if duration <= 0 or duration > MAX_FRAME_MS:
            fail(f"{name}[{index}] duration {duration} ms is outside 1..{MAX_FRAME_MS}")
        durations.append(duration)
        image = Image.open(path)
        if image.size != CANVAS:
            fail(f"{name}[{index}] is {image.size}, expected {CANVAS}")
        if image.mode != "RGBA":
            fail(f"{name}[{index}] is {image.mode}, expected RGBA")
        if image.getchannel("A").getbbox() is None:
            fail(f"{name}[{index}] is fully transparent")
        images.append(denoise(image))
    packed = Image.new("RGBA", (CANVAS[0] * COLUMNS, CANVAS[1] * ROWS), (0, 0, 0, 0))
    left = CANVAS[0]
    top = CANVAS[1]
    right = 0
    bottom = 0
    for index, image in enumerate(images):
        packed.paste(image, ((index % COLUMNS) * CANVAS[0], (index // COLUMNS) * CANVAS[1]))
        box = alpha_bbox(image)
        left = min(left, box[0])
        top = min(top, box[1])
        right = max(right, box[2])
        bottom = max(bottom, box[3])
    anchor = (left + (right - left) // 2, bottom)
    meta = {
        "atlas": f"{name}.png",
        "frameSize": [CANVAS[0], CANVAS[1]],
        "grid": [COLUMNS, ROWS],
        "frameCount": len(images),
        "loop": bool(clip.get("loop")),
        "durationsMs": durations,
        "totalMs": sum(durations),
        "anchorPx": [anchor[0], anchor[1]],
        "contentBounds": [left, top, right - left, bottom - top],
    }
    return packed, meta


def write_pack(out: Path, asset_version: str, clips: list[dict]) -> dict:
    out.mkdir(parents=True, exist_ok=True)
    document = {
        "schema": SCHEMA_OUT,
        "assetVersion": asset_version,
        "alpha": "straight-rgba",
        "renderMode": "composite",
        "notes": (
            "contentBounds/anchorPx 是该片段全部帧的并集与底边中点；"
            "运行时按人物可见高度 ÷ contentBounds 高度缩放，透明边距不参与尺寸。"
        ),
        "clips": {},
    }
    for clip in clips:
        atlas_path = out / clip["meta"]["atlas"]
        clip["image"].save(atlas_path, format="PNG", optimize=True)
        entry = dict(clip["meta"])
        entry["bytes"] = atlas_path.stat().st_size
        entry["sha256"] = sha256(atlas_path)
        document["clips"][clip["name"]] = entry
    (out / "pack.json").write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return document


def check_pack(out: Path, document: dict) -> None:
    problems = []
    for name, clip in document["clips"].items():
        path = out / clip["atlas"]
        if not path.is_file():
            problems.append(f"{name}: {clip['atlas']} missing")
            continue
        if sha256(path) != clip["sha256"]:
            problems.append(f"{name}: sha256 mismatch")
        image = Image.open(path)
        expected = (clip["frameSize"][0] * clip["grid"][0], clip["frameSize"][1] * clip["grid"][1])
        if image.size != expected:
            problems.append(f"{name}: atlas is {image.size}, expected {expected}")
        if sum(clip["durationsMs"]) != clip["totalMs"]:
            problems.append(f"{name}: durations do not add up")
        cb = clip["contentBounds"]
        if cb[0] < 0 or cb[1] < 0 or cb[0] + cb[2] > clip["frameSize"][0] or cb[1] + cb[3] > clip["frameSize"][1]:
            problems.append(f"{name}: contentBounds escapes the frame")
    if problems:
        for problem in problems:
            print(f"FAIL  {problem}", file=sys.stderr)
        raise SystemExit(1)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", help="frames directory that holds manifest.json (legacy mode)")
    parser.add_argument("--atlas-source", help="directory with the redrawn atlases (eat_loop_16.png …)")
    parser.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "assets" / "character"))
    parser.add_argument("--asset-version", default="c-frames-v2")
    parser.add_argument("--check", action="store_true", help="verify existing output instead of writing")
    args = parser.parse_args()

    out = Path(args.out).resolve()
    if args.check:
        pack_path = out / "pack.json"
        if not pack_path.is_file():
            fail(f"no pack.json under {out}")
        document = json.loads(pack_path.read_text(encoding="utf-8"))
        if document.get("schema") not in SCHEMA_CHECKABLE:
            fail(f"pack.json schema is {document.get('schema')!r}, expected one of {', '.join(SCHEMA_CHECKABLE)}")
        check_pack(out, document)
        print(f"OK  {len(document['clips'])} clips verified against {pack_path}")
        return

    prepared = []
    if args.atlas_source:
        source_dir = Path(args.atlas_source).resolve()
        for spec in ATLAS_SPEC:
            image, meta = build_clip_from_atlas(source_dir, spec)
            prepared.append({"name": spec["clip"], "image": image, "meta": meta})
    elif args.source:
        source = Path(args.source).resolve()
        manifest = load_manifest(source)
        asset_version = args.asset_version or manifest.get("assetVersion") or "unknown"
        args.asset_version = asset_version
        for name in REQUIRED_CLIPS:
            image, meta = build_clip_from_frames(source, name, manifest["clips"][name])
            prepared.append({"name": name, "image": image, "meta": meta})
    else:
        fail("either --source or --atlas-source is required")

    for item in prepared:
        meta = item["meta"]
        cb = meta["contentBounds"]
        aspect = cb[2] / cb[3]
        print(
            f"{item['name']:<13} {meta['frameCount']:>2} frames  {meta['frameSize'][0]}×{meta['frameSize'][1]}"
            f"  grid {meta['grid'][0]}×{meta['grid'][1]}  {meta['totalMs']:>5} ms"
            f"  content {cb[0]},{cb[1]} {cb[2]}×{cb[3]}  aspect {aspect:.2f}"
        )
    document = write_pack(out, args.asset_version, prepared)
    check_pack(out, document)
    print(f"OK  wrote {len(document['clips'])} clips to {out} (schema {SCHEMA_OUT}, v{args.asset_version})")


if __name__ == "__main__":
    main()
