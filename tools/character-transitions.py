#!/usr/bin/env python3
"""跨片段"进入帧"选择器（方案 三·问题 F）。

问题：循环片段以前共用 `loopPhaseOriginMs`（进程启动时刻），idle 2600 ms、move 1000 ms、
drag 1200 ms 用同一个绝对起点，进入新动作时落在哪一帧完全看运气。

这个脚本给每一对 (from, to) 选一个进入帧：
把 `to` 的每一帧分别与 `from` 的**全部**帧比较，取"对 from 任意帧都最不突兀"的那一帧
（minimax 于平均距离），而不是只对着 from 的末帧挑。距离超过阈值的组合再标一段短混合。

比较口径：三层（尾巴/后发/身体）按 pack 的锚点合成为预乘 RGBA，缩到 96×128，
只在两个画面至少一侧有内容的像素上取平均通道差。0 = 一模一样。

    python tools/character-transitions.py [--root <插件目录>] [--dry-run]

输出：<root>/assets/character/transitions.json
"""

import argparse
import json
import os
import sys

import numpy as np
from PIL import Image

CANVAS = (96, 128)  # 比较用的降采样尺寸
# 判"要不要混合"不用绝对像素差，而是拿**目标片段自己的相邻帧差**当尺子：
# 跨片段跳变如果还没有该片段正常走一帧变化大，就没必要混合。
GOOD_RATIO = 1.15   # 跨片段最坏距离 ≤ 正常步进的 1.15 倍：直接切
OKAY_RATIO = 1.6    # 1.15–1.6：60 ms 短混合
FADE_MS = 100       # 更差：100 ms 短混合（方案给的 80–120 ms 区间）

LAYERS = [  # zOrder 从低到高：尾巴、后发在身体之前
    ("tail", -30),
    ("hair_back", -20),
    ("body", 0),
]


def load_clip(root, clip, parts):
    """把一个片段的每帧合成为预乘 RGBA，返回 (frames, warnings)。"""
    atlas_path = os.path.join(root, clip["atlas"])
    if not os.path.exists(atlas_path):
        atlas_path = os.path.join(root, clip["name"] + "-body.png")
    frame_w, frame_h = clip["frameSize"]
    columns, rows = clip["grid"]
    count = clip["frameCount"]
    images = {}
    for part_name, _ in LAYERS:
        path = os.path.join(root, f"{clip['name']}-{part_name}.png")
        if not os.path.exists(path):
            if part_name == "body":
                raise SystemExit(f"missing body atlas for {clip['name']}: {path}")
            continue
        images[part_name] = Image.open(path).convert("RGBA")

    frames = []
    warnings = []
    for index in range(count):
        column = index % columns
        row = index // columns
        box = (column * frame_w, row * frame_h, (column + 1) * frame_w, (row + 1) * frame_h)
        canvas = np.zeros((frame_h, frame_w, 3), dtype=np.float32)
        alpha = np.zeros((frame_h, frame_w), dtype=np.float32)
        for part_name, _ in LAYERS:
            image = images.get(part_name)
            if image is None:
                continue
            tile = np.asarray(image.crop(box), dtype=np.float32) / 255.0
            src_a = tile[:, :, 3]
            src_rgb = tile[:, :, :3] * src_a[:, :, None]  # 预乘
            out_a = src_a + alpha * (1.0 - src_a)
            out_rgb = src_rgb + canvas * (1.0 - src_a[:, :, None])
            alpha, canvas = out_a, out_rgb
        if count and index >= len(frames) and alpha.max() <= 0.0:
            warnings.append(f"{clip['name']}#{index} is empty")
        premul = np.dstack([canvas, alpha])
        small = Image.fromarray((np.clip(premul, 0.0, 1.0) * 255.0).astype(np.uint8), mode="RGBA")
        small = small.resize(CANVAS, Image.LANCZOS)
        frames.append(np.asarray(small, dtype=np.float32) / 255.0)
    return frames, warnings


def distance(a, b):
    """预乘 RGBA 的平均通道差，只在两者之一有内容的像素上取平均。"""
    alpha = a[:, :, 3] + b[:, :, 3]
    mask = alpha > 0.02
    if not mask.any():
        return 0.0
    diff = np.abs(a - b)[mask]
    return float(diff.mean())


def silhouette_iou(a, b):
    aa = a[:, :, 3]
    bb = b[:, :, 3]
    inter = float(np.minimum(aa, bb).sum())
    union = float(np.maximum(aa, bb).sum())
    return 0.0 if union <= 0 else inter / union


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=os.path.join(os.path.dirname(__file__), ".."))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    root = os.path.abspath(os.path.join(args.root, "assets", "character"))
    with open(os.path.join(root, "pack.json"), "r", encoding="utf-8") as handle:
        pack = json.load(handle)

    clips = []
    for name, clip in pack["clips"].items():
        clip = dict(clip)
        clip["name"] = name
        clips.append(clip)

    rendered = {}
    warnings = []
    for clip in clips:
        frames, notes = load_clip(root, clip, pack.get("parts", []))
        rendered[clip["name"]] = frames
        warnings.extend(notes)
    print(f"loaded {len(clips)} clips, {sum(len(v) for v in rendered.values())} frames")

    # 每个片段"正常走一帧"的平均变化量：用来判断跨片段跳变算不算大。
    step = {}
    for clip in clips:
        frames = rendered[clip["name"]]
        if len(frames) < 2:
            step[clip["name"]] = 0.0
            continue
        wraps = frames + [frames[0]] if clip.get("loop") else frames
        steps = [distance(wraps[i], wraps[i + 1]) for i in range(len(wraps) - 1)]
        step[clip["name"]] = float(np.median(steps))
    print("intra-clip step:", ", ".join(f"{k}={v:.4f}" for k, v in step.items()))
    steps = sorted(v for v in step.values() if v > 1e-6)
    global_step = float(np.median(steps)) if steps else 0.1
    print(f"global step reference: {global_step:.4f} (used when the target clip has almost no motion)")

    pairs = []
    for source in clips:
        for target in clips:
            a_frames = rendered[source["name"]]
            b_frames = rendered[target["name"]]
            # 对 to 的每一帧，先算"from 停在任何一帧时最坏有多差"，再选最坏情况最小的那一帧
            # （minimax）。只看平均会让个别中断点吃亏，而中断点恰恰不可控。
            distances = [[distance(a_frame, b_frame) for a_frame in a_frames] for b_frame in b_frames]
            worst_by_entry = [max(column) for column in distances]
            mean_by_entry = [sum(column) / len(column) for column in distances]
            if not target.get("loop", False):
                best = 0  # 一次性片段必须从第 0 帧开始播，表里也不许写别的
            else:
                best = min(range(len(b_frames)), key=lambda j: (worst_by_entry[j], mean_by_entry[j]))
            worst = worst_by_entry[best]
            iou = float(np.mean([silhouette_iou(a_frame, b_frames[best]) for a_frame in a_frames]))
            reference = max(step[target["name"]], global_step)  # 单帧片段（hold）没有自身步进，用全局参考
            ratio = (worst / reference) if reference > 0 else 0.0
            if source["name"] == target["name"]:
                fade = 0  # 同一个片段：进入相位由表决定就够了，不叠混合
            elif ratio <= GOOD_RATIO:
                fade = 0
            elif ratio <= OKAY_RATIO:
                fade = 60
            else:
                fade = FADE_MS
            pairs.append(
                {
                    "from": source["name"],
                    "to": target["name"],
                    "entryFrame": best,
                    "meanDistance": round(mean_by_entry[best], 5),
                    "worstDistance": round(worst, 5),
                    "frameZeroWorst": round(worst_by_entry[0], 5),
                    "stepDistance": round(reference, 5),
                    "ratio": round(ratio, 3),
                    "silhouetteIou": round(iou, 4),
                    "fadeMs": fade,
                }
            )
            print(
                f"  {source['name']:>12} -> {target['name']:<12} entry={best:>2} "
                f"worst={worst:.4f} step={reference:.4f} ratio={ratio:.2f} "
                f"(frame0 worst={pairs[-1]['frameZeroWorst']:.4f}) iou={iou:.3f} fade={fade}ms"
            )

    payload = {
        "schema": "dsh.character.transitions/v1",
        "assetVersion": pack.get("assetVersion", ""),
        "source": "tools/character-transitions.py",
        "metric": "mean absolute premultiplied RGBA difference on the content mask, 0..1",
        "canvas": list(CANVAS),
        "thresholds": {"goodRatio": GOOD_RATIO, "okayRatio": OKAY_RATIO, "fadeMs": FADE_MS},
        "generatedFrom": {
            "clipCount": len(clips),
            "frameCount": sum(len(v) for v in rendered.values()),
        },
        "pairs": pairs,
    }
    saved = sum(1 for p in pairs if p["entryFrame"] != 0)
    fades = sum(1 for p in pairs if p["fadeMs"] > 0)
    print(f"\n{saved}/{len(pairs)} pairs need a nonzero entry frame; {fades} pairs need a fade")
    if warnings:
        print("warnings:", *warnings, sep="\n  ")
    if args.dry_run:
        print("dry run: nothing written")
        return 0
    out = os.path.join(root, "transitions.json")
    with open(out, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
