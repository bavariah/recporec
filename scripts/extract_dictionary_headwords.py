"""Extract dictionary headwords from the searchable Matica srpska PDF.

The ClearScan layer is noisy inside definitions, so this script does not accept
all OCR tokens. It identifies the bold headword font independently on each page,
then keeps only words from lines that begin at the dictionary-entry indent.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import csv
import json
from pathlib import Path
import re
import sys
import unicodedata

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "data" / "dictionary" / "source" / "dictionary.pdf"
DEFAULT_OUTPUT = ROOT / "data" / "dictionary" / "extracted" / "pdf-headwords.tsv"
DEFAULT_REPORT = ROOT / "output" / "dictionary" / "pdf-extraction-report.json"

SERBIAN_LETTERS = "абвгдђежзијклљмнњопрстћуфхцчџш"
SERBIAN_WORD = re.compile(rf"^[{SERBIAN_LETTERS}]+$")
CYRILLIC_HINT = re.compile(r"[а-шА-Ш]")
ENTRY_X_RANGES = ((49.0, 71.0), (294.0, 322.0))
MIN_WORD_LENGTH = 2
MAX_WORD_LENGTH = 8
GRAMMAR_MARKERS = {
    "а",
    "б",
    "в",
    "г",
    "ж",
    "м",
    "с",
    "свр",
    "несвр",
    "прил",
    "импф",
    "јек",
    "ек",
    "фиг",
    "се",
}


def at_entry_indent(x_value: float) -> bool:
    return any(start <= x_value <= end for start, end in ENTRY_X_RANGES)


def strip_stress_marks(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value)
    return "".join(char for char in decomposed if unicodedata.category(char) != "Mn")


def normalized_variants(raw_token: str, expected_initial: str | None = None) -> list[str]:
    token = raw_token.strip(".,;:!?*•~[]{}<>\"'’`´")
    if not token or token.endswith(("-", "\u00ad")):
        return []

    token = token.replace("\u00ad", "")
    variants = [token]
    optional = re.fullmatch(r"(.+?)\(([а-шА-Ш]+)\)", token)
    if optional:
        variants = [optional.group(1), optional.group(1) + optional.group(2)]
    else:
        token = re.sub(r"\([^)]*\)$", "", token)
        variants = [token]

    normalized: list[str] = []
    for variant in variants:
        value = strip_stress_marks(variant).lower().replace("m", "ш")
        value = value.strip(".,;:!?*•~[]{}()<>\"'’`´0123456789")
        if value in GRAMMAR_MARKERS:
            continue
        if not SERBIAN_WORD.fullmatch(value):
            continue
        if MIN_WORD_LENGTH <= len(value) <= MAX_WORD_LENGTH:
            if expected_initial and value[0] != expected_initial:
                value = expected_initial + value[1:]
            normalized.append(value)

    return normalized


def collect_page_runs(page) -> list[dict]:
    runs: list[dict] = []

    def visitor(text, _cm, tm, font_dict, font_size):
        clean_text = text.strip()
        if not clean_text or not font_dict:
            return
        runs.append(
            {
                "text": clean_text,
                "x": float(tm[4]),
                "y": float(tm[5]),
                "font": str(font_dict.get("/BaseFont", "")),
                "size": round(float(font_size), 2),
            }
        )

    page.extract_text(visitor_text=visitor)
    return runs


def identify_entry_font(runs: list[dict]) -> tuple[str, float] | None:
    if not runs:
        return None

    character_totals: Counter[tuple[str, float]] = Counter()
    start_hits: Counter[tuple[str, float]] = Counter()
    short_start_hits: Counter[tuple[str, float]] = Counter()

    for run in runs:
        key = (run["font"], run["size"])
        character_totals[key] += len(run["text"])
        if at_entry_indent(run["x"]) and CYRILLIC_HINT.search(run["text"]):
            start_hits[key] += 1
            if len(run["text"]) <= 25:
                short_start_hits[key] += 1

    if not character_totals:
        return None

    candidates = [
        (
            short_start_hits[key] / hits,
            short_start_hits[key],
            hits,
            key[1],
            key,
        )
        for key, hits in start_hits.items()
        if hits >= 3 and short_start_hits[key] >= 3
    ]
    if not candidates:
        return None

    substantial = [candidate for candidate in candidates if candidate[1] >= 10]
    ranked = substantial or candidates
    ranked.sort(reverse=True)
    return ranked[0][4]


def expected_page_initial(runs: list[dict]) -> str | None:
    header_text = " ".join(
        run["text"]
        for run in runs
        if run["y"] >= 780 and 100 <= run["x"] <= 470
    )
    normalized_header = (
        strip_stress_marks(header_text)
        .lower()
        .replace("m", "ш")
        .replace("3", "з")
    )
    bounds = re.split(r"\s+[-–—]\s+", normalized_header, maxsplit=1)
    initials: set[str] = set()
    for bound in bounds:
        first_letter = next(
            (char for char in bound if char in SERBIAN_LETTERS),
            None,
        )
        if first_letter:
            initials.add(first_letter)

    return next(iter(initials)) if len(initials) == 1 else None


def extract_page_headwords(page, page_number: int) -> tuple[list[dict], dict]:
    runs = collect_page_runs(page)
    entry_font = identify_entry_font(runs)
    if not entry_font:
        return [], {"page": page_number, "entryFont": None, "headwords": 0}

    entry_runs = [
        run for run in runs if (run["font"], run["size"]) == entry_font
    ]
    expected_initial = expected_page_initial(runs)

    records: list[dict] = []
    entry_starts = [
        run
        for run in entry_runs
        if at_entry_indent(run["x"]) and CYRILLIC_HINT.search(run["text"])
    ]
    seen_rows: set[tuple[float, str]] = set()

    for entry_start in entry_starts:
        column = "left" if entry_start["x"] < 290 else "right"
        row_key = (round(entry_start["y"], 1), column)
        if row_key in seen_rows:
            continue
        seen_rows.add(row_key)

        row_runs = sorted(
            (
                run
                for run in runs
                if abs(run["y"] - entry_start["y"]) <= 0.2
                and ((column == "left" and run["x"] < 290) or (column == "right" and run["x"] >= 290))
            ),
            key=lambda run: run["x"],
        )
        start_index = next(
            (
                index
                for index, run in enumerate(row_runs)
                if run is entry_start
            ),
            None,
        )
        if start_index is None:
            continue

        for run in row_runs[start_index:]:
            if (run["font"], run["size"]) != entry_font:
                separator = run["text"].strip(".,;:()[]{} ").lower()
                if separator in {"и", "или"}:
                    continue
                break

            for raw_token in run["text"].split():
                uncorrected = normalized_variants(raw_token)
                for word in normalized_variants(raw_token, expected_initial):
                    records.append(
                        {
                            "word": word,
                            "page": page_number,
                            "raw": raw_token,
                            "initialCorrected": bool(
                                expected_initial
                                and uncorrected
                                and uncorrected[0][0] != word[0]
                            ),
                        }
                    )

    return records, {
        "page": page_number,
        "entryFont": f"{entry_font[0]}@{entry_font[1]}",
        "expectedInitial": expected_initial,
        "headwords": len(records),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", nargs="?", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--start-page", type=int, default=17)
    parser.add_argument("--end-page", type=int)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    input_path = args.input.resolve()
    if not input_path.exists():
        raise SystemExit(
            f"PDF not found: {input_path}\n"
            "Place it at data/dictionary/source/dictionary.pdf or pass its path."
        )

    reader = PdfReader(str(input_path))
    start_index = max(0, args.start_page - 1)
    end_page = min(args.end_page or len(reader.pages), len(reader.pages))
    unique_records: dict[str, dict] = {}
    page_reports: list[dict] = []
    rejected_pages: list[int] = []

    for index in range(start_index, end_page):
        records, page_report = extract_page_headwords(reader.pages[index], index + 1)
        page_reports.append(page_report)
        if page_report["entryFont"] is None:
            rejected_pages.append(index + 1)
        for record in records:
            unique_records.setdefault(record["word"], record)

        processed = index - start_index + 1
        if processed % 100 == 0 or index + 1 == end_page:
            print(
                f"Pages {args.start_page}-{index + 1}: "
                f"{len(unique_records)} unique headwords",
                flush=True,
            )

    sorted_records = sorted(unique_records.values(), key=lambda item: item["word"])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=["word", "page", "raw", "initialCorrected"],
            delimiter="\t",
        )
        writer.writeheader()
        writer.writerows(sorted_records)

    by_length = Counter(len(record["word"]) for record in sorted_records)
    report = {
        "source": input_path.name,
        "pages": {
            "totalInPdf": len(reader.pages),
            "start": args.start_page,
            "end": end_page,
            "withoutDetectedEntryFont": len(rejected_pages),
            "withoutDetectedEntryFontPages": rejected_pages,
        },
        "uniqueHeadwords": len(sorted_records),
        "initialCorrections": sum(
            1 for record in sorted_records if record["initialCorrected"]
        ),
        "byLength": {str(length): by_length[length] for length in range(2, 9)},
        "samplePages": page_reports[:3] + page_reports[-3:],
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"Wrote {len(sorted_records)} headwords to {args.output}")
    print(f"Report: {args.report}")


if __name__ == "__main__":
    main()
