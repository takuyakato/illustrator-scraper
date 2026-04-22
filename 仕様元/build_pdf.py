#!/usr/bin/env python3
"""
build_pdf.py
illustrator_db_redesign 配下のMDファイルを高品質PDFに変換する。

使い方:
    python build_pdf.py

出力:
    /home/claude/illustrator_db_redesign/dist/*.pdf
"""

import os
import re
from pathlib import Path
import markdown
from weasyprint import HTML, CSS
from weasyprint.text.fonts import FontConfiguration


# ============================================================
# 設定: 各ドキュメントのメタデータと配色
# ============================================================

DOCS = [
    {
        "source": "CLAUDE.md",
        "output": "illustrator-scraper_CLAUDE_v1_1.pdf",
        "title": "illustrator-scraper",
        "subtitle": "プロジェクト引き継ぎ書",
        "tag": "Claude Code 引き継ぎ",
        "version": "Version 1.1",
        "meta_lines": [
            "作成日: 2026年4月21日",
            "プロジェクト: illustrator-scraper",
            "配置先: ~/roadie/projects/illustrator-scraper/",
            "発行: 株式会社Roadie",
        ],
        # ミント/フォレスト系（エンジニアリング文書）
        "primary": "#0f4c3a",
        "accent": "#1d8a6a",
        "cover_bg_start": "#0a3a2c",
        "cover_bg_end": "#0f4c3a",
    },
    {
        "source": "spreadsheet_gas_design.md",
        "output": "spreadsheet_gas_design_v1_1.pdf",
        "title": "スカウト用スプレッドシート\n& GAS 設計書",
        "subtitle": "実装設計書",
        "tag": "Implementation Design",
        "version": "Version 1.1",
        "meta_lines": [
            "作成日: 2026年4月21日",
            "対象: Googleスプレッドシート + Apps Script",
            "発行: 株式会社Roadie",
        ],
        # 濃紺/ネイビー系（設計ドキュメント）
        "primary": "#1e3a8a",
        "accent": "#3b82f6",
        "cover_bg_start": "#162662",
        "cover_bg_end": "#1e3a8a",
    },
]


# ============================================================
# Markdown → HTML 変換
# ============================================================

MD_EXTENSIONS = [
    "extra",          # tables, fenced_code, etc.
    "codehilite",     # syntax highlighting
    "sane_lists",
    "toc",
]

MD_EXTENSION_CONFIGS = {
    "codehilite": {
        "css_class": "codehilite",
        "guess_lang": False,
    },
    "toc": {
        "permalink": False,
    },
}


def convert_markdown_to_html(md_text: str) -> str:
    """Markdown本文をHTMLに変換"""
    md = markdown.Markdown(
        extensions=MD_EXTENSIONS,
        extension_configs=MD_EXTENSION_CONFIGS,
    )
    html = md.convert(md_text)
    # 改行からトリムされがちな最初のメタ情報をまとめて後処理
    return html


def remove_duplicate_title(md_text: str) -> str:
    """本文の最初のH1を削除（表紙で別途表示するため）"""
    lines = md_text.splitlines()
    out = []
    h1_removed = False
    for line in lines:
        if not h1_removed and line.startswith("# ") and not line.startswith("## "):
            h1_removed = True
            continue
        out.append(line)
    return "\n".join(out)


# ============================================================
# HTML組み立て
# ============================================================

COVER_HTML_TMPL = """
<section class="cover">
  <div class="cover-orbs"></div>
  <div class="cover-inner">
    <div class="cover-tag">{tag}</div>
    <h1 class="cover-title">{title_html}</h1>
    <div class="cover-version">{version}</div>
    <div class="cover-meta">
      {meta_html}
    </div>
  </div>
</section>
"""


def build_cover_html(doc: dict) -> str:
    title_html = doc["title"].replace("\n", "<br/>")
    meta_html = "\n".join(f'<div class="cover-meta-line">{m}</div>' for m in doc["meta_lines"])
    subtitle = doc.get("subtitle", "")
    # 中間タグ表示（Claude Code 引き継ぎ等）
    if subtitle and subtitle != doc["tag"]:
        # subtitleを別要素で出してもよい（今回は tag に含まれる想定）
        pass
    return COVER_HTML_TMPL.format(
        tag=doc["tag"],
        title_html=title_html,
        version=doc["version"],
        meta_html=meta_html,
    )


PAGE_HTML_TMPL = """<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8"/>
  <title>{doc_title}</title>
</head>
<body>
  {cover}
  <main class="body">
    {body}
  </main>
</body>
</html>
"""


def build_full_html(doc: dict, body_html: str) -> str:
    cover = build_cover_html(doc)
    return PAGE_HTML_TMPL.format(
        doc_title=doc["title"].replace("\n", " "),
        cover=cover,
        body=body_html,
    )


# ============================================================
# CSS
# ============================================================

def build_css(doc: dict) -> str:
    primary = doc["primary"]
    accent = doc["accent"]
    cover_start = doc["cover_bg_start"]
    cover_end = doc["cover_bg_end"]
    footer_title = doc["title"].replace("\n", " ")

    return f"""
@page {{
  size: A4;
  margin: 22mm 18mm 20mm 18mm;
  @bottom-center {{
    content: counter(page) " / " counter(pages);
    font-family: 'Noto Sans CJK JP', sans-serif;
    font-size: 9pt;
    color: #888;
  }}
  @top-right {{
    content: "{footer_title}  v1.1";
    font-family: 'Noto Sans CJK JP', sans-serif;
    font-size: 8.5pt;
    color: #aaa;
  }}
}}

@page cover {{
  margin: 0;
  @bottom-center {{ content: none; }}
  @top-right {{ content: none; }}
}}

html, body {{
  font-family: 'Noto Sans CJK JP', 'Hiragino Kaku Gothic ProN', sans-serif;
  font-size: 10.5pt;
  line-height: 1.75;
  color: #1f2937;
}}

/* ===== 表紙 ===== */
section.cover {{
  page: cover;
  page-break-after: always;
  width: 210mm;
  height: 297mm;
  margin: 0;
  padding: 0;
  background: linear-gradient(135deg, {cover_start} 0%, {cover_end} 100%);
  color: #ffffff;
  position: relative;
  overflow: hidden;
}}

section.cover .cover-orbs::before,
section.cover .cover-orbs::after {{
  content: "";
  position: absolute;
  border-radius: 50%;
  background: rgba(255,255,255,0.08);
}}
section.cover .cover-orbs::before {{
  width: 240mm;
  height: 240mm;
  top: -80mm;
  right: -120mm;
}}
section.cover .cover-orbs::after {{
  width: 160mm;
  height: 160mm;
  bottom: -60mm;
  left: -60mm;
  background: rgba(255,255,255,0.05);
}}

section.cover .cover-inner {{
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  padding: 40mm 25mm;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
}}

.cover-tag {{
  font-size: 11pt;
  letter-spacing: 0.25em;
  color: rgba(255,255,255,0.85);
  padding: 4mm 0;
  border-top: 0.5pt solid rgba(255,255,255,0.4);
  border-bottom: 0.5pt solid rgba(255,255,255,0.4);
  margin-bottom: 25mm;
  min-width: 80mm;
}}

.cover-title {{
  font-size: 30pt;
  font-weight: 700;
  line-height: 1.35;
  margin: 0 0 20mm 0;
  padding: 0 0 10mm 0;
  border-bottom: 0.5pt solid rgba(255,255,255,0.5);
  max-width: 140mm;
  color: #ffffff !important;
  text-shadow: 0 1pt 4pt rgba(0,0,0,0.25);
}}

h1.cover-title {{
  color: #ffffff !important;
}}

.cover-version {{
  font-size: 13pt;
  color: rgba(255,255,255,0.9);
  margin-bottom: 40mm;
  letter-spacing: 0.05em;
}}

.cover-meta {{
  font-size: 10pt;
  color: rgba(255,255,255,0.85);
  line-height: 2;
  padding-top: 10mm;
  border-top: 0.25pt solid rgba(255,255,255,0.3);
  min-width: 80mm;
}}
.cover-meta-line {{ display: block; }}

/* ===== 本文 ===== */
main.body {{
  counter-reset: section;
}}

h1, h2, h3, h4 {{
  font-family: 'Noto Sans CJK JP', sans-serif;
  color: {primary};
  line-height: 1.4;
  page-break-after: avoid;
}}

h1 {{
  font-size: 22pt;
  font-weight: 700;
  margin: 0 0 8mm 0;
  padding: 0 0 3mm 0;
  border-bottom: 2pt solid {primary};
}}

h2 {{
  font-size: 16pt;
  font-weight: 700;
  margin: 10mm 0 5mm 0;
  padding-left: 4mm;
  border-left: 4pt solid {primary};
}}

h3 {{
  font-size: 13pt;
  font-weight: 600;
  color: {accent};
  margin: 8mm 0 3mm 0;
}}

h4 {{
  font-size: 11pt;
  font-weight: 600;
  color: #374151;
  margin: 6mm 0 2mm 0;
}}

p {{
  margin: 0 0 3mm 0;
  text-align: justify;
}}

blockquote {{
  border-left: 3pt solid {accent};
  background: #f1f5f9;
  margin: 4mm 0;
  padding: 3mm 5mm;
  color: #334155;
  font-size: 10pt;
}}

blockquote p {{ margin: 0; }}

hr {{
  border: none;
  border-top: 0.5pt solid #d1d5db;
  margin: 6mm 0;
}}

/* ===== リスト ===== */
ul, ol {{
  margin: 2mm 0 4mm 0;
  padding-left: 7mm;
}}
li {{
  margin: 1mm 0;
  line-height: 1.7;
}}
li > ul, li > ol {{ margin: 1mm 0; }}

/* ===== テーブル ===== */
table {{
  width: 100%;
  border-collapse: collapse;
  margin: 4mm 0 6mm 0;
  font-size: 9.5pt;
  page-break-inside: avoid;
}}

th {{
  background: {primary};
  color: #ffffff;
  font-weight: 600;
  text-align: left;
  padding: 2.5mm 3mm;
  border: 0.5pt solid {primary};
}}

td {{
  padding: 2mm 3mm;
  border: 0.5pt solid #d1d5db;
  vertical-align: top;
}}

tbody tr:nth-child(even) td {{
  background: #f9fafb;
}}

/* ===== コードブロック ===== */
pre {{
  background: #0f172a;
  color: #e2e8f0;
  padding: 4mm 5mm;
  border-radius: 1.5mm;
  font-family: 'DejaVu Sans Mono', 'Menlo', monospace;
  font-size: 8.5pt;
  line-height: 1.55;
  margin: 3mm 0 5mm 0;
  overflow-x: hidden;
  white-space: pre-wrap;
  word-break: break-all;
  page-break-inside: avoid;
}}
pre code {{ background: transparent; color: inherit; padding: 0; }}

code {{
  background: #eef2ff;
  color: #1e3a8a;
  padding: 0.3mm 1.5mm;
  border-radius: 1mm;
  font-family: 'DejaVu Sans Mono', 'Menlo', monospace;
  font-size: 9pt;
}}

/* codehilite 色調整（ダーク背景なので明るめ） */
.codehilite .c, .codehilite .c1, .codehilite .cm {{ color: #64748b; font-style: italic; }}  /* comment */
.codehilite .k, .codehilite .kd, .codehilite .kn {{ color: #c084fc; }}  /* keyword */
.codehilite .s, .codehilite .s1, .codehilite .s2 {{ color: #86efac; }}  /* string */
.codehilite .mi, .codehilite .mf {{ color: #fde68a; }}                   /* number */
.codehilite .nb, .codehilite .bp {{ color: #93c5fd; }}                   /* builtin */
.codehilite .nf {{ color: #60a5fa; }}                                     /* function */
.codehilite .o {{ color: #f9a8d4; }}                                      /* operator */

/* ===== リンク ===== */
a {{
  color: {accent};
  text-decoration: none;
  border-bottom: 0.3pt solid {accent};
}}

/* ===== 強調 ===== */
strong {{
  color: {primary};
  font-weight: 700;
}}

em {{
  font-style: normal;
  color: {accent};
}}

/* ===== 警告ボックス（blockquote内で絵文字から始まる場合の飾り） ===== */
blockquote:has(> p:first-child) {{
  position: relative;
}}

/* ===== ページ区切り抑制 ===== */
h2, h3, h4 {{ page-break-after: avoid; }}
table, pre, blockquote {{ page-break-inside: avoid; }}
"""


# ============================================================
# ビルド処理
# ============================================================

def build_pdf(doc: dict, base_dir: Path, out_dir: Path) -> Path:
    source_path = base_dir / doc["source"]
    output_path = out_dir / doc["output"]

    print(f"→ {doc['source']} を処理中...")

    # Markdown読み込み
    md_text = source_path.read_text(encoding="utf-8")
    md_text = remove_duplicate_title(md_text)

    # HTML生成
    body_html = convert_markdown_to_html(md_text)
    full_html = build_full_html(doc, body_html)

    # CSS生成
    css_text = build_css(doc)

    # PDF生成
    font_config = FontConfiguration()
    HTML(string=full_html, base_url=str(base_dir)).write_pdf(
        target=str(output_path),
        stylesheets=[CSS(string=css_text, font_config=font_config)],
        font_config=font_config,
    )

    size_kb = output_path.stat().st_size // 1024
    print(f"  ✓ {output_path.name}  ({size_kb} KB)")
    return output_path


def main():
    base_dir = Path("/home/claude/illustrator_db_redesign")
    out_dir = base_dir / "dist"
    out_dir.mkdir(exist_ok=True)

    print(f"作業ディレクトリ: {base_dir}")
    print(f"出力ディレクトリ: {out_dir}")
    print()

    outputs = []
    for doc in DOCS:
        outputs.append(build_pdf(doc, base_dir, out_dir))

    print()
    print("✅ すべてのPDF生成が完了しました:")
    for p in outputs:
        print(f"   - {p}")


if __name__ == "__main__":
    main()
