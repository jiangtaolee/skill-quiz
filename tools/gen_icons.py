#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成「技能鉴定刷题」PWA 图标。

设计：
  - 深蓝对角渐变底：#1B2A4A（左上） → #2E6BFF（右下）；
  - 中间是两张叠放的白色圆角卡片（"题卡"意象）；
  - 前卡上画一条上升的曲线 + 圆点（艾宾浩斯记忆曲线意象）；
  - 不包含任何文字，内容居中并四周留约 10% 安全边距（适配 iOS 圆角裁切 / maskable）。

输出（默认写到项目根的 icons/）：
    icon-1024.png        1024x1024
    icon-512.png          512x512
    icon-192.png          192x192
    apple-touch-icon.png  180x180
    favicon.png            32x32

特点：
  - 只用 Pillow（pip install Pillow），不依赖其它包；
  - 先按 4 倍尺寸（4096）绘制，再 LANCZOS 缩小，边缘平滑；
  - 完全确定性（无随机数），重复运行会得到逐字节相同的 PNG；
  - 可重复运行，直接覆盖同名文件。

用法：
    python tools/gen_icons.py                 # 写到 <项目根>/icons
    python tools/gen_icons.py --out icons     # 指定输出目录
    python tools/gen_icons.py --quiet         # 只打印结果路径
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFilter
except ImportError:  # pragma: no cover - 只在没装 Pillow 时触发
    sys.stderr.write(
        "\n[错误] 缺少 Pillow，无法生成图标。\n"
        "请先安装：python -m pip install Pillow\n"
    )
    raise SystemExit(2)

# ---------------------------------------------------------------- 基本参数

# 先按 4 倍尺寸绘制，再缩放，得到平滑的抗锯齿边缘
SUPERSAMPLE = 4
MASTER = 1024 * SUPERSAMPLE

# 输出文件名 -> 边长（像素）
SIZES: list[tuple[str, int]] = [
    ("icon-1024.png", 1024),
    ("icon-512.png", 512),
    ("icon-192.png", 192),
    ("apple-touch-icon.png", 180),
    ("favicon.png", 32),
]

# 渐变起止色：深海军蓝 -> 品牌蓝
GRAD_START = (0x1B, 0x2A, 0x4A)
GRAD_END = (0x2E, 0x6B, 0xFF)

# 图形用色
CARD_WHITE = (255, 255, 255, 255)
CARD_BACK_WHITE = (255, 255, 255, 72)
CURVE_BLUE = (0x2E, 0x6B, 0xFF, 255)
SHADOW_COLOR = (8, 16, 42, 120)

# 上升曲线的控制点（相对画布的比例坐标，0..1），经 Catmull-Rom 平滑后绘制
CURVE_POINTS = [
    (0.300, 0.715),
    (0.380, 0.662),
    (0.460, 0.602),
    (0.540, 0.542),
    (0.620, 0.468),
    (0.700, 0.390),
]


def _u(v: float) -> int:
    """把 0..1 的比例坐标换算成 4096 画布上的整数坐标。"""
    return int(round(v * MASTER))


def make_gradient(size: int) -> Image.Image:
    """生成左上->右下的对角线性渐变（RGB）。确定性、无随机。"""
    n = 128  # 小尺寸逐像素插值后放大，既平滑又快
    small = Image.new("RGB", (n, n))
    px = small.load()
    for y in range(n):
        for x in range(n):
            t = (x + y) / (2 * (n - 1))  # 左上 0 -> 右下 1
            px[x, y] = tuple(
                int(round(a + (b - a) * t)) for a, b in zip(GRAD_START, GRAD_END)
            )
    return small.resize((size, size), Image.BICUBIC)


def _catmull_rom(points: list[tuple[float, float]], samples: int = 24) -> list[tuple[float, float]]:
    """Catmull-Rom 样条插值，把折线控制点变成平滑曲线（结果为像素坐标）。"""
    pts = [points[0], *points, points[-1]]
    out: list[tuple[float, float]] = []
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        for j in range(samples):
            t = j / samples
            t2, t3 = t * t, t * t * t
            x = 0.5 * (
                2 * p1[0]
                + (-p0[0] + p2[0]) * t
                + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2
                + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3
            )
            y = 0.5 * (
                2 * p1[1]
                + (-p0[1] + p2[1]) * t
                + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2
                + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3
            )
            out.append((x, y))
    out.append(points[-1])
    return out


def draw_icon() -> Image.Image:
    """绘制 4096x4096 的 RGBA 母版图标。"""
    canvas = make_gradient(MASTER).convert("RGBA")

    # ---- 卡片投影（在 1/4 分辨率上模糊，速度快、结果仍然确定） ----
    shadow_size = MASTER // 4
    shadow_layer = Image.new("RGBA", (shadow_size, shadow_size), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow_layer)
    sd.rounded_rectangle(
        (
            (0.5 - 0.27) * shadow_size,
            (0.545 - 0.35) * shadow_size,
            (0.5 + 0.27) * shadow_size,
            (0.545 + 0.35) * shadow_size,
        ),
        radius=0.125 * shadow_size,
        fill=SHADOW_COLOR,
    )
    shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(radius=0.022 * shadow_size))
    shadow_layer = shadow_layer.resize((MASTER, MASTER), Image.BILINEAR)
    canvas = Image.alpha_composite(canvas, shadow_layer)

    # ---- 卡片前景层 ----
    layer = Image.new("RGBA", (MASTER, MASTER), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    def card(
        cx: float, cy: float, w: float, h: float, radius: float, fill: tuple[int, int, int, int]
    ) -> None:
        d.rounded_rectangle(
            ((cx - w / 2) * MASTER, (cy - h / 2) * MASTER,
             (cx + w / 2) * MASTER, (cy + h / 2) * MASTER),
            radius=radius * MASTER,
            fill=fill,
        )

    # 后面那张卡：露出一点，形成"一叠题卡"的层次
    card(0.545, 0.475, 0.500, 0.620, 0.105, CARD_BACK_WHITE)
    # 前面那张卡：纯白
    card(0.500, 0.525, 0.520, 0.660, 0.115, CARD_WHITE)

    # ---- 卡片上的上升曲线 + 端点节点 ----
    control = [(_u(x), _u(y)) for x, y in CURVE_POINTS]
    curve = _catmull_rom(control)
    d.line(curve, fill=CURVE_BLUE, width=_u(0.030), joint="curve")
    # 起点小圆点、终点大圆点（"从待复习到已掌握"的上升示意）
    start_r = _u(0.022)
    end_r = _u(0.033)
    sx, sy = control[0]
    ex, ey = control[-1]
    d.ellipse((sx - start_r, sy - start_r, sx + start_r, sy + start_r), fill=CURVE_BLUE)
    d.ellipse((ex - end_r, ey - end_r, ex + end_r, ey + end_r), fill=CURVE_BLUE)

    return Image.alpha_composite(canvas, layer)


def save_icons(master: Image.Image, out_dir: Path, quiet: bool = False) -> list[Path]:
    """把母版缩放到各个尺寸并保存，返回写出的文件路径列表。"""
    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for name, size in SIZES:
        img = master.resize((size, size), Image.LANCZOS).convert("RGB")
        path = out_dir / name
        # optimize=True 使文件更小；不带任何时间戳等元数据，保证可重复
        img.save(path, format="PNG", optimize=True)
        written.append(path)
        if not quiet:
            digest = hashlib.sha256(path.read_bytes()).hexdigest()[:12]
            print(f"  {name:<22} {size:>4}x{size:<4}  {path.stat().st_size:>7} B  sha256:{digest}")
    return written


def main(argv: list[str] | None = None) -> int:
    project_root = Path(__file__).resolve().parent.parent

    parser = argparse.ArgumentParser(
        description="生成「技能鉴定刷题」PWA 图标（深蓝渐变 + 白色题卡 + 上升曲线）"
    )
    parser.add_argument(
        "--out",
        default=str(project_root / "icons"),
        help="输出目录，默认 <项目根>/icons",
    )
    parser.add_argument("--quiet", action="store_true", help="只打印输出目录")
    args = parser.parse_args(argv)

    out_dir = Path(args.out).expanduser()
    if not out_dir.is_absolute():
        out_dir = (Path.cwd() / out_dir).resolve()

    if not args.quiet:
        print("生成图标：")
        print(f"  母版 {MASTER}x{MASTER}（{SUPERSAMPLE}x 超采样）")
        print(f"  输出目录 {out_dir}")

    try:
        master = draw_icon()
        written = save_icons(master, out_dir, quiet=args.quiet)
    except OSError as exc:
        sys.stderr.write(f"\n[错误] 写入图标失败：{exc}\n请检查输出目录是否可写。\n")
        return 1

    if not args.quiet:
        print(f"完成，共 {len(written)} 个文件：")
        for path in written:
            print(f"  {path}")
    else:
        print(out_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
