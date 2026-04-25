#!/usr/bin/env python3
"""Parse PTU 1.05 trainer Features and Edges into JSON caches.

Source files use the same priority pattern as ``parse_abilities.py`` /
``parse_moves.py``: highest-priority file first, lower-priority files only
fill in entries the higher tiers don't already define.

Both Features and Edges share a similar block layout in the markdown::

    <Name>
    [optional bracket tags]                    # e.g. [Class] [Orders]
    Prerequisites: <prereq text...>
    [optional Frequency-Action line]           # features only, e.g. "1 AP – Free Action"
    [optional Trigger / Target / Condition]
    Effect: <effect text...>
    [optional Note: ...]

The classifier looks at the most recent section header in the file (e.g.
``Edges``, ``Features``, ``Skill Edges``, ``Crafting Edges``,
``General Features``, etc.) so the same structural parser handles both kinds.

Class Features inherit a ``className`` field from the most recent
``<ClassName>`` heading inside ``core/04-trainer-classes.md`` (we treat the
[Class] tag itself as the class anchor).
"""

import json
import os
import re

MARKDOWN_DIR = os.path.join(os.path.dirname(__file__), "..", "books", "markdown")
CACHE_DIR    = os.path.join(os.path.dirname(__file__), "data")

# Source files: (path, default_kind). ``default_kind`` is the bucket every
# entry from this file lands in unless an in-file section header overrides it.
# Highest-priority sources come first; later sources only fill in missing names.
SOURCE_FILES = [
    # errata-2 contains only re-issued features (Cheerleader rework + Medical
    # Techniques), so we lock its default kind to "feature" rather than "auto".
    (os.path.join(MARKDOWN_DIR, "errata-2.md"),                              "feature"),
    (os.path.join(MARKDOWN_DIR, "core", "04-trainer-classes.md"),            "feature"),
    # core/03 starts with skill chapters whose sub-entries are *edges* (Acrobat,
    # Kip Up…), then transitions into the Features chapter via a ``Features``
    # header which flips current_kind. We therefore default core/03 to "edge".
    (os.path.join(MARKDOWN_DIR, "core", "03-skills-edges-and-features.md"), "edge"),
]

# Lines that flip the ``current_kind`` when we see them as standalone headers.
KIND_HEADERS: dict[str, str] = {
    "Edges":                                  "edge",
    "Skill Edges":                            "edge",
    "Crafting Edges":                         "edge",
    "Pokémon Training Edges":                 "edge",
    "Combat Edges":                           "edge",
    "Other Edges":                            "edge",
    "Features":                               "feature",
    "General Features":                       "feature",
    "Pokémon Raising and Battling Features":  "feature",
    "Training Features":                      "feature",
    "Class Features":                         "feature",
}

# Lines we know are *not* entry names — used to skip false positives during
# the backtrack step.
NON_NAME_LINES: frozenset[str] = frozenset({
    "Skills", "How to Read Features", "How to Read Edges", "Feature Tags",
    "Description", "Effect", "Trigger", "Target", "Condition", "Note",
    "Roles", "Associated Skills", "Class", "Static",
})

# A line that consists of one or more bracketed tag groups, e.g.
#   [Class]            → ['Class']
#   [Class] [+HP]      → ['Class', '+HP']
#   [Training] [Orders] → ['Training', 'Orders']
TAG_RE         = re.compile(r"^(\[[A-Za-z+ \dxX/]+\]\s*)+$")
TAG_INNER_RE   = re.compile(r"\[([^\]]+)\]")
PREREQ_RE      = re.compile(r"^Prerequisites?:\s*(.*)$")
EFFECT_RE      = re.compile(r"^Effect:\s*(.*)$")
TRIGGER_RE     = re.compile(r"^Trigger:\s*(.*)$")
TARGET_RE      = re.compile(r"^Target:\s*(.*)$")
CONDITION_RE   = re.compile(r"^Condition:\s*(.*)$")
NOTE_RE        = re.compile(r"^(Note|Cast.s Note|Doxy):\s*(.*)$")
PAGE_RE        = re.compile(r"^##\s+(Page|Chapter)\b")
SECTION_HEAD_RE = re.compile(r"^##\s+(.+)$")

# Recognised PTU frequency / action tokens that may appear between Prereq and
# Effect (or as the only metadata between them, e.g. just ``Static``).
FREQ_ACTION_RE = re.compile(
    r"^("
    r"Static"
    r"|At-Will"
    r"|Daily(\s+x\d+)?"
    r"|Scene(\s+x\d+)?"
    r"|EOT|EoT"
    r"|1/Round"
    r"|One Time Use(\s+x\s*\d+)?"
    r"|Drain\s+\d+\s+AP"
    r"|Bind\s+\d+\s+AP"
    r"|X\s+AP"          # parameterised cost (e.g. Cheers' "X AP – Swift Action")
    r"|\d+\s+AP"
    r"|Special"
    r")"
    r"(\s*[\u2013\u2014\-]\s*.+)?"
    r"$"
)

# Some sections are introduced by inline phrases rather than full headers
# (e.g. ``Training Features:``). Track these too.
INLINE_KIND_HINTS = (
    ("Training Features",                      "feature"),
    ("[Stratagem] Features",                   "feature"),
    ("Pokémon Raising and Battling Features",  "feature"),
)


# ---------------------------------------------------------------------------
# Block extraction
# ---------------------------------------------------------------------------

def _is_plausible_name(line: str) -> bool:
    """Heuristic: short, starts with a capital, no colon-prefix."""
    if not line:
        return False
    if line in NON_NAME_LINES or line in KIND_HEADERS:
        return False
    if len(line) > 60:
        return False
    if ":" in line:
        return False
    if PAGE_RE.match(line) or SECTION_HEAD_RE.match(line):
        return False
    if not re.match(r"^[A-Z\u00C0-\u017F]", line):
        return False
    return True


def parse_entries(text: str, default_kind: str) -> list[dict]:
    """Walk ``text`` and yield one dict per recognised entry block."""
    lines = text.split("\n")
    entries: list[dict] = []
    current_kind = default_kind if default_kind != "auto" else "feature"
    current_class: str | None = None

    i = 0
    while i < len(lines):
        raw = lines[i]
        stripped = raw.strip()

        # Section markers always flip current_kind — they're explicit signals
        # in the source. ``default_kind`` only sets the initial bucket before
        # any header has been seen.
        if stripped in KIND_HEADERS:
            current_kind = KIND_HEADERS[stripped]

        # Inline kind hints (sometimes a paragraph introduces a sub-section).
        for hint, kind in INLINE_KIND_HINTS:
            if hint in stripped:
                current_kind = kind

        m = PREREQ_RE.match(stripped)
        if not m:
            i += 1
            continue

        # Backtrack to find the entry name (skip blanks + tag lines).
        name_idx = i - 1
        tags: list[str] = []
        while name_idx >= 0:
            l = lines[name_idx].strip()
            if not l:
                name_idx -= 1
                continue
            if TAG_RE.match(l):
                # A single line may carry multiple tags, e.g. ``[Class] [+HP]``.
                for inner in TAG_INNER_RE.findall(l):
                    tags.insert(0, inner.strip())
                name_idx -= 1
                continue
            break

        if name_idx < 0:
            i += 1
            continue

        name_candidate = lines[name_idx].strip()
        # Repair common pdf-extraction artifact: a trailing footnote arrow on
        # the previous line (e.g. ``--->``).
        if name_candidate.startswith("--"):
            i += 1
            continue

        if not _is_plausible_name(name_candidate):
            i += 1
            continue

        name = re.sub(r"\s+", " ", name_candidate)

        # Update class context if this entry is itself a Class Feature.
        if "Class" in tags:
            current_class = name

        # ----- Collect Prereqs (multi-line continuation) -----
        prereqs = m.group(1).strip()
        j = i + 1
        while j < len(lines):
            ls = lines[j].strip()
            if not ls or PAGE_RE.match(lines[j]) or SECTION_HEAD_RE.match(lines[j]):
                break
            if (FREQ_ACTION_RE.match(ls) or EFFECT_RE.match(ls) or TRIGGER_RE.match(ls)
                    or TARGET_RE.match(ls) or CONDITION_RE.match(ls)
                    or PREREQ_RE.match(ls) or NOTE_RE.match(ls)):
                break
            prereqs += " " + ls
            j += 1

        # ----- Collect freq/trigger/target/condition lines -----
        frequency: str | None = None
        trigger: str | None = None
        target: str | None = None
        condition: str | None = None
        while j < len(lines):
            ls = lines[j].strip()
            if not ls:
                j += 1
                continue
            if EFFECT_RE.match(ls) or PREREQ_RE.match(ls):
                break
            if PAGE_RE.match(lines[j]) or SECTION_HEAD_RE.match(lines[j]):
                break
            if FREQ_ACTION_RE.match(ls):
                frequency = (frequency + " " + ls) if frequency else ls
            elif TRIGGER_RE.match(ls):
                trigger = TRIGGER_RE.match(ls).group(1).strip()
            elif TARGET_RE.match(ls):
                target = TARGET_RE.match(ls).group(1).strip()
            elif CONDITION_RE.match(ls):
                condition = CONDITION_RE.match(ls).group(1).strip()
            else:
                # Continuation of last opened field.
                if condition is not None:
                    condition += " " + ls
                elif target is not None:
                    target += " " + ls
                elif trigger is not None:
                    trigger += " " + ls
                elif frequency is not None:
                    frequency += " " + ls
                else:
                    prereqs += " " + ls
            j += 1

        # ----- Collect Effect (multi-line until next entry / page / Note) ---
        effect_parts: list[str] = []
        if j < len(lines):
            mm = EFFECT_RE.match(lines[j].strip())
            if mm:
                effect_parts.append(mm.group(1).strip())
                j += 1
                while j < len(lines):
                    ls = lines[j].strip()
                    if not ls:
                        j += 1
                        continue
                    if PAGE_RE.match(lines[j]) or SECTION_HEAD_RE.match(lines[j]):
                        break
                    if PREREQ_RE.match(ls) or NOTE_RE.match(ls):
                        break
                    # Look ahead: if the next non-blank line is Prereq, this
                    # line is the next entry's name — stop before it.
                    look = j + 1
                    while look < len(lines) and not lines[look].strip():
                        look += 1
                    if look < len(lines):
                        peek = lines[look].strip()
                        if PREREQ_RE.match(peek):
                            break
                        if TAG_RE.match(peek):
                            look2 = look + 1
                            while look2 < len(lines) and (
                                not lines[look2].strip() or TAG_RE.match(lines[look2].strip())
                            ):
                                look2 += 1
                            if look2 < len(lines) and PREREQ_RE.match(lines[look2].strip()):
                                break
                    effect_parts.append(ls)
                    j += 1

        effect  = re.sub(r"\s+", " ", " ".join(effect_parts)).strip()
        prereqs = re.sub(r"\s+", " ", prereqs).strip()

        kind = current_kind

        entry: dict = {
            "name": name,
            "kind": kind,
            "tags": tags,
            "prerequisites": prereqs or None,
            "frequency": frequency,
            "trigger": trigger,
            "target": target,
            "condition": condition,
            "effect": effect or None,
        }
        if current_class:
            entry["className"] = current_class
        entries.append(entry)
        i = j

    return entries


# ---------------------------------------------------------------------------
# Cache build
# ---------------------------------------------------------------------------

def build_caches(verbose: bool = False) -> tuple[dict, dict]:
    features: dict[str, dict] = {}
    edges: dict[str, dict]    = {}
    provenance: dict[tuple[str, str], str] = {}

    for path, default_kind in SOURCE_FILES:
        if not os.path.exists(path):
            print(f"  (skipping missing {path})")
            continue
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
        label = os.path.basename(path)
        added_f = added_e = shadowed = 0
        for entry in parse_entries(text, default_kind):
            name = entry["name"]
            kind = entry["kind"]
            target = features if kind == "feature" else edges
            key = (kind, name)
            if name not in target:
                # Drop ``kind`` from the value — it's encoded in which dict it lives in.
                stored = {k: v for k, v in entry.items() if k != "kind"}
                target[name] = stored
                provenance[key] = label
                if kind == "feature":
                    added_f += 1
                else:
                    added_e += 1
            else:
                shadowed += 1
                if verbose:
                    print(f"  [shadowed] {kind}:{name} kept {provenance[key]}, dropped {label}")
        print(f"  {label}: +{added_f} features, +{added_e} edges, {shadowed} shadowed")

    os.makedirs(CACHE_DIR, exist_ok=True)
    feat_path = os.path.join(CACHE_DIR, "features.json")
    edge_path = os.path.join(CACHE_DIR, "edges.json")
    with open(feat_path, "w", encoding="utf-8") as f:
        json.dump(features, f, indent=2, ensure_ascii=False)
    with open(edge_path, "w", encoding="utf-8") as f:
        json.dump(edges,    f, indent=2, ensure_ascii=False)
    print(f"Wrote {len(features)} features → {feat_path}")
    print(f"Wrote {len(edges)} edges    → {edge_path}")
    return features, edges


if __name__ == "__main__":
    import sys
    build_caches(verbose="--verbose" in sys.argv or "-v" in sys.argv)
