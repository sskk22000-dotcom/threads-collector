#!/usr/bin/env python3
"""extension/src/keywords.js 를 읽어 docs/KEYWORDS.md 를 다시 생성한다.

키워드를 고칠 때 문서가 따로 놀지 않게, 소스를 단일 진실로 둔다.
    python3 tools/gen_keyword_doc.py
"""
import re
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "extension" / "src" / "keywords.js"
OUT = ROOT / "docs" / "KEYWORDS.md"

src = SRC.read_text(encoding="utf-8")

head_re = re.compile(
    r"id:\s*'(?P<id>[^']+)',\s*"
    r"label:\s*'(?P<label>[^']+)',\s*"
    r"description:\s*'(?P<desc>[^']*)',\s*"
    r"status:\s*'(?P<status>[^']+)',\s*"
    r"keywords:\s*\[",
    re.S,
)
kw_re = re.compile(r"\{\s*value:\s*'(?P<value>[^']+)'(?P<rest>[^}]*)\}")
exc_re = re.compile(r"exclude:\s*\[(?P<items>[^\]]*)\]")
note_re = re.compile(r"note:\s*'(?P<note>[^']*)'")


def scan_array(text, open_idx):
    """open_idx 는 여는 '[' 바로 다음 위치. 짝이 맞는 ']' 까지의 내용을 돌려준다."""
    depth = 1
    i = open_idx
    while i < len(text) and depth:
        c = text[i]
        if c == "[":
            depth += 1
        elif c == "]":
            depth -= 1
        elif c == "'":
            i += 1
            while i < len(text) and text[i] != "'":
                i += 2 if text[i] == "\\" else 1
        i += 1
    return text[open_idx:i - 1]


class Group:
    def __init__(self, m, body):
        self.id = m.group("id")
        self.label = m.group("label")
        self.desc = m.group("desc")
        self.status = m.group("status")
        self.body = body


groups = [Group(m, scan_array(src, m.end())) for m in head_re.finditer(src)]

STATUS_LABEL = {"approved": "✅ 수집중 (컨펌 완료)", "pending": "⏸ 컨펌 대기"}

lines = [
    "# 키워드 사전",
    "",
    "`extension/src/keywords.js` 에서 자동 생성된 문서입니다. 직접 고치지 말고 소스를 고친 뒤",
    "`python3 tools/gen_keyword_doc.py` 를 다시 실행하세요.",
    "",
    "## 매칭 규칙",
    "",
    "1. 글 본문과 키워드를 모두 **정규화**합니다 — 소문자화, 공백·문장부호·이모지 제거.",
    "   그래서 `어디서사` 하나로 `어디서 사요`, `어디서 사요?`, `어디서  사 요` 를 전부 잡습니다.",
    "2. 정규화된 본문에 키워드가 **부분 문자열로 들어있으면** 매칭입니다.",
    "3. 단, 해당 키워드의 **제외어**가 본문에 있으면 그 키워드는 매칭에서 빠집니다.",
    "   예) `어디서사` 는 `어디서 사진 찍었어요` 를 잡지 않습니다.",
    "4. `status: pending` 인 그룹은 **팝업에서 승인하기 전까지 수집에 전혀 쓰이지 않습니다.**",
    "",
]

approved = [g for g in groups if g.status == "approved"]
pending = [g for g in groups if g.status != "approved"]

total = 0
for bucket, title in ((approved, "기본 승인 그룹"), (pending, "컨펌 대기 그룹")):
    lines += [f"## {title}", ""]
    if not bucket:
        lines += ["_없음_", ""]
    for g in bucket:
        kws = list(kw_re.finditer(g.body))
        total += len(kws)
        lines += [
            f"### {g.label} — `{g.id}`",
            "",
            f"{g.desc}",
            "",
            f"상태: **{STATUS_LABEL[g.status]}** · 키워드 {len(kws)}개",
            "",
            "| 키워드 | 제외어 | 메모 |",
            "|---|---|---|",
        ]
        for k in kws:
            rest = k.group("rest")
            exc = exc_re.search(rest)
            items = []
            if exc:
                items = [x.strip().strip("'") for x in exc.group("items").split(",") if x.strip()]
            note = note_re.search(rest)
            lines.append(
                f"| `{k.group('value')}` | "
                f"{', '.join('`%s`' % i for i in items) if items else '—'} | "
                f"{note.group('note') if note else '—'} |"
            )
        lines.append("")

lines += [
    "## 키워드 추가하는 3가지 방법",
    "",
    "| 방법 | 어디서 | 승인 필요? |",
    "|---|---|---|",
    "| 시드 그룹 켜기 | 팝업 `키워드` 탭 → `승인` | 예 (버튼 클릭이 곧 컨펌) |",
    "| 직접 입력 | 팝업 `키워드` 탭 하단 입력창 | 입력 = 승인 |",
    "| 자동 추천 후보 | 팝업 `추천` 탭 → `승인` | **예. 승인 전엔 수집에 안 쓰임** |",
    "",
    "직접 입력·추천 승인으로 들어온 키워드는 `내가 추가한 키워드` 그룹에 모입니다.",
    "",
    f"> 현재 시드 키워드 총 {total}개.",
    "",
]

OUT.write_text("\n".join(lines), encoding="utf-8")
print(f"wrote {OUT.relative_to(ROOT)} ({total} keywords)")
