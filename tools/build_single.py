#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 index.html 打包成可离线双击打开的「单文件版」。

做什么：
  - 把 <link rel="stylesheet" href="styles/app.css"> 的内容内联成 <style>…</style>；
  - 把所有本地 <script src="…"> 的内容按原顺序内联成 <script>…</script>；
  - 把本地图标（apple-touch-icon / favicon / mask-icon）内联成 data URI；
  - manifest、preload/prefetch 等外链移除（file:// 下没有意义）；
  - 把 <img>/<video>/<audio>/<source> 的本地 src、poster 内联成 data URI；
  - 把 CSS 里 url(…) 引用的本地图片内联成 data URI；
  - 处理完后再做一次“残留相对引用”检查，有问题会给出清晰警告；
  - 输出 dist/技能鉴定刷题.html，双击即可用（不请求任何相对资源）。

做了什么保证：
  - 只依赖 Python 标准库（re / base64 / mimetypes / pathlib / argparse），无需 pip install；
  - 输入文件缺失、CSS/JS 缺失、输出目录不可写等都会给出明确中文错误与退出码；
  - 保持脚本执行顺序不变（questions.js → srs.js → store.js → app.js）。

用法：
  python tools/build_single.py                      # 默认读 ./index.html 输出 dist/技能鉴定刷题.html
  python tools/build_single.py --input index.html --out dist/技能鉴定刷题.html
  python tools/build_single.py --root .             # 指定项目根目录（相对路径都以它为基准）
  python tools/build_single.py --strict             # 有警告就失败（交付前建议加）
"""

from __future__ import annotations

import argparse
import base64
import mimetypes
import re
import sys
from pathlib import Path
from urllib.parse import unquote

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------

DEFAULT_OUT_NAME = "技能鉴定刷题.html"

# 单文件版标记：页面脚本可用 window.__SINGLE_FILE__ 判断自己是否在单文件模式
SINGLE_FILE_MARKER = (
    '<script>/* 单文件版标记（由 tools/build_single.py 注入） */'
    'window.__SINGLE_FILE__ = true;</script>'
)

MIME_FALLBACK = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
}

HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
LINK_TAG_RE = re.compile(r"<link\b[^>]*>", re.I)
SCRIPT_TAG_RE = re.compile(r"<script\b([^>]*)>(.*?)</script\s*>", re.I | re.S)
STYLE_TAG_RE = re.compile(r"<style\b([^>]*)>(.*?)</style\s*>", re.I | re.S)
ASSET_TAG_RE = re.compile(r"<(?:img|source|video|audio)\b[^>]*>", re.I)
ATTR_RE = re.compile(
    r"""([a-zA-Z_:][-a-zA-Z0-9_:.]*)"""
    r"""(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?"""
)
CSS_URL_RE = re.compile(
    r"""url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)""", re.I
)
# 处理后仍残留的相对引用（src/href/poster）
RELATIVE_REF_RE = re.compile(
    r"""\b(?:src|href|poster)\s*=\s*["'](?!#|data:|https?:|//|mailto:|tel:|javascript:|about:|blob:)([^"']*)["']""",
    re.I,
)


class BuildError(Exception):
    """构建失败，message 会直接展示给用户。"""


# ---------------------------------------------------------------------------
# 小工具
# ---------------------------------------------------------------------------


def is_remote(url: str) -> bool:
    """是否是不需要（也无法）内联的外部/内联引用。"""
    s = url.strip().lower()
    if not s:
        return True
    return s.startswith(
        (
            "http://",
            "https://",
            "//",
            "data:",
            "blob:",
            "about:",
            "mailto:",
            "tel:",
            "javascript:",
            "#",
        )
    )


def parse_attrs(attr_text: str) -> dict[str, str]:
    """把标签属性文本解析成 {小写属性名: 值}（无值属性值为空串）。"""
    result: dict[str, str] = {}
    for match in ATTR_RE.finditer(attr_text):
        name = match.group(1).lower()
        raw = match.group(2)
        if raw is None:
            value = ""
        elif raw[:1] in ("'", '"'):
            value = raw[1:-1]
        else:
            value = raw
        result.setdefault(name, value)
    return result


def strip_attrs(attr_text: str, names: list[str]) -> str:
    """从属性文本中删掉指定属性（用于去掉 script 的 src 等）。"""
    pattern = re.compile(
        r"""\s+(?:%s)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+)"""
        % "|".join(re.escape(n) for n in names),
        re.I,
    )
    return pattern.sub("", attr_text)


def set_tag_attr(tag: str, name: str, value: str) -> str:
    """把标签里某个属性的值替换掉；属性不存在则追加到标签末尾。"""
    pattern = re.compile(
        r"""(\b%s\s*=\s*)("[^"]*"|'[^']*'|[^\s"'=<>`]+)""" % re.escape(name),
        re.I,
    )
    if pattern.search(tag):
        return pattern.sub(lambda m: m.group(1) + '"' + value + '"', tag, count=1)
    return re.sub(r">\s*$", f' {name}="{value}">', tag, count=1)


def read_text(path: Path, what: str) -> str:
    """读取 UTF-8 文本（兼容带 BOM / GBK 编码），失败时给出清晰错误。"""
    try:
        raw = path.read_bytes()
    except FileNotFoundError:
        raise BuildError(f"找不到{what}：{path}")
    except OSError as exc:
        raise BuildError(f"读取{what}失败：{path}\n  {exc}")
    for encoding in ("utf-8-sig", "gb18030"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise BuildError(
        f"{what}不是有效的 UTF-8 / GBK 文本：{path}\n  请确认文件没有损坏。"
    )


def mime_of(path: Path) -> str:
    mime, _ = mimetypes.guess_type(path.name)
    return mime or MIME_FALLBACK.get(path.suffix.lower(), "application/octet-stream")


def to_data_uri(path: Path) -> str:
    try:
        payload = base64.b64encode(path.read_bytes()).decode("ascii")
    except OSError as exc:
        raise BuildError(f"读取资源失败：{path}\n  {exc}")
    return f"data:{mime_of(path)};base64,{payload}"


def resolve_local(ref: str, base_dir: Path) -> Path | None:
    """把 HTML/CSS 里的本地引用解析成绝对路径；绝对 URL 路径返回 None。"""
    clean = unquote(ref.strip().split("#", 1)[0].split("?", 1)[0]).strip()
    if not clean:
        return None
    if clean.startswith(("/", "\\")) or re.match(r"^[a-zA-Z]:", clean):
        # 以 / 开头的绝对路径（或 Windows 盘符）无法可靠地映射到单文件
        return None
    return (base_dir / clean).resolve()


def guard_script_text(js: str, source: str) -> str:
    """防止 JS 里的 </script> 提前结束标签；记录可能的离线隐患。"""
    if "</script" in js.lower():
        js = re.sub(r"</script", r"<\\/script", js, flags=re.I)
    return js


def guard_style_text(css: str) -> str:
    return re.sub(r"</style", r"<\\/style", css, flags=re.I)


# ---------------------------------------------------------------------------
# CSS 处理：把 url(本地文件) 内联成 data URI
# ---------------------------------------------------------------------------


def inline_css_urls(
    css: str,
    base_dir: Path,
    warnings: list[str],
    inlined_images: list[tuple[str, Path]],
    where: str,
) -> str:
    def repl(match: re.Match[str]) -> str:
        raw = match.group(1) or match.group(2) or match.group(3) or ""
        ref = raw.strip()
        if is_remote(ref):
            return match.group(0)
        path = resolve_local(ref, base_dir)
        if path is None:
            warnings.append(
                f"{where}: url({ref}) 是绝对路径，无法内联，单文件版会请求失败"
            )
            return match.group(0)
        if not path.exists():
            warnings.append(f"{where}: 找不到 url() 引用的文件 {ref}，已保留原样")
            return match.group(0)
        inlined_images.append((ref, path))
        return f'url("{to_data_uri(path)}")'

    return CSS_URL_RE.sub(repl, css)


# ---------------------------------------------------------------------------
# HTML 处理
# ---------------------------------------------------------------------------


def inline_link_tag(
    tag: str,
    root: Path,
    warnings: list[str],
    inlined_css: list[tuple[str, Path]],
    inlined_images: list[tuple[str, Path]],
    removed: list[str],
) -> str:
    attrs = parse_attrs(tag[5:-1])
    rels = set(attrs.get("rel", "").lower().split())
    href = attrs.get("href", "").strip()

    # 1) 样式表 -> <style>
    if "stylesheet" in rels and href:
        if is_remote(href):
            warnings.append(
                f"外部样式表无法内联，单文件版离线时会丢失样式：{href}"
            )
            return tag
        path = resolve_local(href, root)
        if path is None:
            warnings.append(f"样式表 {href} 是绝对路径，无法内联（请改成相对路径）")
            return tag
        if not path.exists():
            raise BuildError(
                f"index.html 引用了样式表 {href}，但文件不存在：\n  {path}\n"
                f"  请检查 index.html 里的 href，或先创建该文件。"
            )
        css = read_text(path, f"样式表 {href}")
        css = inline_css_urls(css, path.parent, warnings, inlined_images, href)
        css = guard_style_text(css)
        inlined_css.append((href, path))
        media = attrs.get("media", "").strip()
        media_attr = f' media="{media}"' if media else ""
        return f'<style data-inlined-from="{href}"{media_attr}>\n{css}\n</style>'

    # 2) manifest：单文件版不需要，直接移除
    if "manifest" in rels:
        removed.append(f"<link rel=manifest href={href or '?'}>（单文件版不需要 manifest）")
        return ""

    # 3) 图标类：内联成 data URI；找不到就移除
    icon_rels = {
        "icon",
        "shortcut",
        "apple-touch-icon",
        "apple-touch-icon-precomposed",
        "mask-icon",
    }
    if rels & icon_rels and href:
        if is_remote(href):
            removed.append(f"<link rel={attrs.get('rel')} href={href}>（外部图标，单文件版移除）")
            return ""
        path = resolve_local(href, root)
        if path is None or not path.exists():
            warnings.append(f"图标文件不存在，已从单文件版移除：{href}")
            return ""
        inlined_images.append((href, path))
        new_tag = set_tag_attr(tag, "href", to_data_uri(path))
        removed.append(f"<link rel={attrs.get('rel')} href={href}>（已内联为 data URI）")
        return new_tag

    # 4) 预加载 / 预连接：本地资源在单文件版里不存在，移除
    if rels & {"preload", "prefetch", "modulepreload", "prerender", "preconnect", "dns-prefetch"}:
        if href and not is_remote(href):
            removed.append(f"<link rel={attrs.get('rel')} href={href}>（单文件版移除）")
            return ""
        return tag

    return tag


def inline_script_tag(
    match: re.Match[str],
    root: Path,
    warnings: list[str],
    inlined_js: list[tuple[str, Path]],
    removed: list[str],
) -> str:
    attr_text = match.group(1)
    body = match.group(2)
    attrs = parse_attrs(attr_text)
    src = attrs.get("src", "").strip()

    # 没有 src 的内联脚本：原样保留
    if not src:
        return match.group(0)

    if is_remote(src):
        warnings.append(f"外部脚本无法内联，单文件版离线时会丢失功能：{src}")
        return match.group(0)

    path = resolve_local(src, root)
    if path is None:
        warnings.append(f"脚本 {src} 是绝对路径，无法内联（请改成相对路径）")
        return match.group(0)
    if not path.exists():
        raise BuildError(
            f"index.html 引用了脚本 {src}，但文件不存在：\n  {path}\n"
            f"  请检查 index.html 里的 <script src>，或先创建该文件。"
        )

    js = read_text(path, f"脚本 {src}")
    if re.search(r"""(?:^|[\s;{}])(?:import|export)\s""", js) or "import(" in js:
        warnings.append(
            f"{src} 看起来包含 ES Module 的 import/export，单文件版内联后可能无法工作"
        )
    if re.search(r"""fetch\(\s*["']\.{0,2}/""", js):
        warnings.append(
            f"{src} 里有 fetch() 相对路径调用，单文件版（file://）会失败"
        )
    js = guard_script_text(js, src)
    inlined_js.append((src, path))

    kept_attrs = strip_attrs(
        attr_text, ["src", "integrity", "crossorigin", "referrerpolicy"]
    )
    # 去掉行尾可能残留的多余空格
    kept_attrs = kept_attrs.rstrip()
    return f"<script{kept_attrs}>\n{js}\n</script>"


def inline_asset_tag(
    tag: str,
    root: Path,
    warnings: list[str],
    inlined_images: list[tuple[str, Path]],
    removed: list[str],
) -> str:
    """处理 <img src> / <video poster> / <source src> 等本地资源。"""
    # srcset 里的相对路径无法稳妥内联，直接去掉该属性并提醒
    if re.search(r"\bsrcset\s*=", tag, re.I):
        attrs = parse_attrs(tag[1:-1])
        srcset = attrs.get("srcset", "")
        if srcset and not is_remote(srcset):
            removed.append(f"srcset={srcset}（单文件版不支持下内联，已移除）")
            tag = re.sub(
                r"""\s+srcset\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+)""",
                "",
                tag,
                count=1,
                flags=re.I,
            )

    def replace_attr(name: str) -> None:
        nonlocal tag
        pattern = re.compile(
            r"""(\b%s\s*=\s*)("[^"]*"|'[^']*'|[^\s"'=<>`]+)""" % re.escape(name),
            re.I,
        )
        match = pattern.search(tag)
        if not match:
            return
        raw = match.group(2)
        ref = raw[1:-1] if raw[:1] in ("'", '"') else raw
        ref = ref.strip()
        if not ref or is_remote(ref):
            return
        path = resolve_local(ref, root)
        if path is None or not path.exists():
            warnings.append(f"图片/媒体资源不存在：{ref}（单文件版会显示为空）")
            return
        inlined_images.append((ref, path))
        tag = tag[: match.start()] + match.group(1) + '"' + to_data_uri(path) + '"' + tag[match.end():]

    replace_attr("src")
    replace_attr("poster")
    return tag


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------


def build(
    root: Path,
    input_path: Path,
    output_path: Path,
    strict: bool = False,
) -> dict[str, object]:
    warnings: list[str] = []
    inlined_css: list[tuple[str, Path]] = []
    inlined_js: list[tuple[str, Path]] = []
    inlined_images: list[tuple[str, Path]] = []
    removed: list[str] = []
    stripped_comments = 0

    if not root.is_dir():
        raise BuildError(f"项目根目录不存在：{root}")
    if not input_path.exists():
        raise BuildError(
            f"找不到入口文件：{input_path}\n\n"
            f"可能的原因：\n"
            f"  1. 不在项目根目录运行（请先 cd 到项目目录）；\n"
            f"  2. index.html 还没生成（由 Lead 负责编写）。\n\n"
            f"建议命令：\n"
            f'  cd "项目目录" && python tools/build_single.py'
        )
    if not input_path.is_file():
        raise BuildError(f"入口路径不是文件：{input_path}")

    html = read_text(input_path, "入口 HTML")

    # 1) 去掉 HTML 注释（避免把注释里的 <link>/<script> 也内联进来）
    def strip_comment(match: re.Match[str]) -> str:
        nonlocal stripped_comments
        stripped_comments += 1
        return ""

    html = HTML_COMMENT_RE.sub(strip_comment, html)

    # 2) 已有 <style> 块：内联其中 url() 引用的本地图片
    def style_repl(match: re.Match[str]) -> str:
        css = inline_css_urls(
            match.group(2), root, warnings, inlined_images, "index.html 的 <style>"
        )
        return f"<style{match.group(1)}>{css}</style>"

    html = STYLE_TAG_RE.sub(style_repl, html)

    # 3) <link>：样式表内联、图标 data URI、manifest/preload 移除
    html = LINK_TAG_RE.sub(
        lambda m: inline_link_tag(m.group(0), root, warnings, inlined_css, inlined_images, removed),
        html,
    )

    # 4) <script>：本地脚本按原顺序内联
    html = SCRIPT_TAG_RE.sub(
        lambda m: inline_script_tag(m, root, warnings, inlined_js, removed),
        html,
    )

    # 5) <img>/<video>/<audio>/<source> 的本地资源
    html = ASSET_TAG_RE.sub(
        lambda m: inline_asset_tag(m.group(0), root, warnings, inlined_images, removed),
        html,
    )

    # 6) 注入单文件标记（放在 <head> 之后、其它脚本之前）
    if "__SINGLE_FILE__" not in html:
        html, count = re.subn(
            r"(<head\b[^>]*>)", r"\1\n  " + SINGLE_FILE_MARKER, html, count=1, flags=re.I
        )
        if count == 0:
            html = SINGLE_FILE_MARKER + "\n" + html

    # 7) 最后再检查一遍：有没有残留的相对资源引用（单文件版不应有）
    #    只扫描 HTML 标记部分：已内联的 <script>/<style> 内容里可能有注释/文档中的
    #    示例写法（如 * 浏览器：<script src="src/srs.js">），那不会产生真实请求。
    scan_html = SCRIPT_TAG_RE.sub("", html)
    scan_html = STYLE_TAG_RE.sub("", scan_html)
    leftovers = [
        ref
        for ref in RELATIVE_REF_RE.findall(scan_html)
        if ref.strip() and not ref.strip().startswith(("#", "data:"))
    ]
    if leftovers:
        unique = sorted(set(leftovers))
        warnings.append(
            "单文件里仍有相对资源引用（file:// 下会请求失败）：" + "、".join(unique)
        )

    if strict and warnings:
        raise BuildError(
            "构建有警告，--strict 模式下不会输出文件：\n  - " + "\n  - ".join(warnings)
        )

    # 8) 写出
    output_bytes = html.encode("utf-8")
    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise BuildError(
            f"无法创建输出目录：{output_path.parent}\n  {exc}\n"
            f"请检查磁盘空间/权限，或用 --out 指定其它位置。"
        )
    if output_path.is_dir():
        raise BuildError(f"输出路径是一个目录，无法写入文件：{output_path}")
    try:
        output_path.write_bytes(output_bytes)
    except OSError as exc:
        raise BuildError(f"写入输出文件失败：{output_path}\n  {exc}")

    return {
        "html": html,
        "output_path": output_path,
        "output_bytes": output_bytes,
        "warnings": warnings,
        "inlined_css": inlined_css,
        "inlined_js": inlined_js,
        "inlined_images": inlined_images,
        "removed": removed,
        "stripped_comments": stripped_comments,
        "input_path": input_path,
    }


def format_report(result: dict[str, object]) -> str:
    lines: list[str] = []
    lines.append("=" * 68)
    lines.append("单文件版构建结果")
    lines.append("=" * 68)
    lines.append(f"入口文件 : {result['input_path']}")
    out_path = result["output_path"]
    out_size = len(result["output_bytes"])  # type: ignore[arg-type]
    lines.append(f"输出文件 : {out_path}")
    lines.append(f"输出大小 : {out_size:,} 字节（约 {out_size / 1024:.1f} KB）")
    lines.append("")

    css_list: list[tuple[str, Path]] = result["inlined_css"]  # type: ignore[assignment]
    js_list: list[tuple[str, Path]] = result["inlined_js"]  # type: ignore[assignment]
    img_list: list[tuple[str, Path]] = result["inlined_images"]  # type: ignore[assignment]
    removed: list[str] = result["removed"]  # type: ignore[assignment]
    warnings: list[str] = result["warnings"]  # type: ignore[assignment]

    lines.append(f"内联 CSS（{len(css_list)} 个）：")
    for ref, path in css_list:
        lines.append(f"  + {ref:<28} {path.stat().st_size:>9,} B")
    lines.append(f"内联 JS（{len(js_list)} 个，按原顺序）：")
    for i, (ref, path) in enumerate(js_list, 1):
        lines.append(f"  {i}. {ref:<28} {path.stat().st_size:>9,} B")
    if img_list:
        lines.append(f"内联图片/资源（{len(img_list)} 个，已转 data URI）：")
        for ref, path in img_list:
            lines.append(f"  + {ref:<28} {path.stat().st_size:>9,} B")
    if removed:
        lines.append(f"移除/转换的外链（{len(removed)} 个）：")
        for item in removed:
            lines.append(f"  - {item}")
    if result["stripped_comments"]:
        lines.append(f"移除 HTML 注释：{result['stripped_comments']} 处")
    lines.append("")

    if warnings:
        lines.append(f"⚠ 警告（{len(warnings)} 条）：")
        for warning in warnings:
            lines.append(f"  ! {warning}")
    else:
        lines.append("✅ 没有任何相对资源引用，可以直接双击打开。")

    lines.append("")
    lines.append("使用方式：双击 dist 里的 HTML 文件即可；发到手机上优先用静态托管/PWA。")
    lines.append("=" * 68)
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    # Windows PowerShell 下让中文输出不乱码
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        sys.stderr.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:  # pragma: no cover - 老版本 Python/特殊终端
        pass

    project_root = Path(__file__).resolve().parent.parent

    parser = argparse.ArgumentParser(
        description="把 index.html 打包成可 file:// 直接打开的单文件版（内联 CSS/JS/题库/图标）"
    )
    parser.add_argument(
        "--root",
        default=str(project_root),
        help="项目根目录（index.html 与 styles/、src/、icons/ 所在目录），默认脚本上级目录",
    )
    parser.add_argument(
        "--input",
        default=None,
        help="入口 HTML，默认 <root>/index.html",
    )
    parser.add_argument(
        "--out",
        default=None,
        help=f"输出文件，默认 <root>/dist/{DEFAULT_OUT_NAME}",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="有任何警告就失败并且不写文件（交付前检查用）",
    )
    args = parser.parse_args(argv)

    root = Path(args.root).expanduser().resolve()
    input_path = (
        Path(args.input).expanduser().resolve()
        if args.input
        else root / "index.html"
    )
    output_path = (
        Path(args.out).expanduser().resolve()
        if args.out
        else root / "dist" / DEFAULT_OUT_NAME
    )

    try:
        result = build(root, input_path, output_path, strict=args.strict)
    except BuildError as exc:
        sys.stderr.write("\n[构建失败] " + str(exc) + "\n")
        return 1
    except KeyboardInterrupt:
        sys.stderr.write("\n[已取消]\n")
        return 130

    print(format_report(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
