#!/usr/bin/env python3
"""Download local Pokémon sprite assets.

Selection rules:
- Gen 1-5: prefer animated Black/White GIF sprites from PokémonDB.
- If an animated Gen 1-5 asset does not exist on PokémonDB, fall back to the
  Black/White static PNG for that specific form.
- Gen 6+: prefer animated GIF sprites from Pokémon Showdown's /sprites/ani/.
- If a Gen 6+ form does not have a public animated GIF in Showdown, fall back
  to Showdown's /sprites/afd/ static PNG for that exact form.

Files are stored locally under public/sprites/.

Examples:
- public/sprites/black-white/anim/normal/abra.gif
- public/sprites/showdown/ani/palafin-hero.gif
- public/sprites/showdown/afd/ogerpon-cornerstone.png

A manifest is written to data/pokemonSpriteManifest.json.
"""

from __future__ import annotations

import json
import re
import shutil
import unicodedata
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Iterable

import requests

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
PUBLIC_ROOT = REPO_ROOT / "public"
SPRITE_ROOT = PUBLIC_ROOT / "sprites"
MANIFEST_PATH = REPO_ROOT / "data" / "pokemonSpriteManifest.json"
POKEDEX_PATH = REPO_ROOT / "ptu-data" / "data" / "pokedex.json"
MAX_WORKERS = 16
USER_AGENT = "rotom-table sprite downloader"
GEN_1_TO_5 = {"gen1", "gen2", "gen3", "gen4", "gen5"}
BW_EXACT_SPRITE_SLUGS: dict[str, str] = {}


def has_placement_data(entry: dict) -> bool:
    return all(entry.get(field) is not None for field in ("width", "height", "base", "clearance"))


def slugify_species(species: str) -> str:
    slug = unicodedata.normalize("NFKD", species)
    slug = slug.replace("’", "'").replace("♀", "-f").replace("♂", "-m")
    slug = slug.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    return slug.strip("-")


def load_current_entries() -> list[dict]:
    pokedex = json.loads(POKEDEX_PATH.read_text(encoding="utf-8"))
    return [entry for entry in pokedex if isinstance(entry, dict) and entry.get("species") and has_placement_data(entry)]


def load_existing_manifest() -> dict[str, dict]:
    if not MANIFEST_PATH.exists():
        return {}
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    return {
        entry["species"]: entry
        for entry in manifest
        if isinstance(entry, dict) and entry.get("species")
    }


def build_species_map_from_markdown() -> dict[str, dict[str, str | None]]:
    existing_manifest = load_existing_manifest()
    species_map: dict[str, dict[str, str | None]] = {}
    for entry in load_current_entries():
        species = entry["species"]
        manifest_entry = existing_manifest.get(species, {})
        species_map[species] = {
            "slug": str(manifest_entry.get("slug") or slugify_species(species)),
            "source_gen": manifest_entry.get("source_gen") or entry.get("source_gen"),
        }
    return species_map


def add_extra_species_from_pokemondb(species_map: dict[str, dict[str, str | None]]) -> None:
    return

SHOWDOWN_ANI_INDEX_URL = "https://play.pokemonshowdown.com/sprites/ani/?sort=name"
SHOWDOWN_AFD_INDEX_URL = "https://play.pokemonshowdown.com/sprites/afd/?sort=name"

BW_ANIM_EXACT_SPRITE_SLUGS = {
    "darmanitan-zen": "darmanitan-zen-mode",
}

SHOWDOWN_EXACT_SPRITE_IDS = {
    # Gen 6/7 naming differences
    "hoopa-confined": "hoopa",
    "jangmo-o": "jangmoo",
    "hakamo-o": "hakamoo",
    "kommo-o": "kommoo",
    "lycanroc-midday": "lycanroc",
    "minior-core": "minior",
    "necrozma-dawn-wings": "necrozma-dawnwings",
    "necrozma-dusk-mane": "necrozma-duskmane",
    "tapu-koko": "tapukoko",
    "tapu-lele": "tapulele",
    "tapu-bulu": "tapubulu",
    "tapu-fini": "tapufini",
    "type-null": "typenull",
    "wishiwashi-solo": "wishiwashi",
    "wishiwashi-schooling": "wishiwashi-school",
    "zygarde-50": "zygarde",
    # Gen 8 differences
    "calyrex-ice-rider": "calyrex-ice",
    "calyrex-shadow-rider": "calyrex-shadow",
    "darmanitan-galar-standard-mode": "darmanitan-galar",
    "darmanitan-galar-zen-mode": "darmanitan-galarzen",
    "eiscue-ice-face": "eiscue",
    "eiscue-noice-face": "eiscue-noice",
    "indeedee-male": "indeedee",
    "indeedee-female": "indeedee-f",
    "mr-rime": "mrrime",
    "mr-mime-galar": "mrmime-galar",
    "urshifu-single-strike": "urshifu",
    "urshifu-rapid-strike": "urshifu-rapidstrike",
    "zacian-hero-of-many-battles": "zacian",
    "zacian-crowned-sword": "zacian-crowned",
    "zamazenta-hero-of-many-battles": "zamazenta",
    "zamazenta-crowned-shield": "zamazenta-crowned",
    # Gen 9 differences
    "brute-bonnet": "brutebonnet",
    "chi-yu": "chiyu",
    "chien-pao": "chienpao",
    "dudunsparce-two-segment": "dudunsparce",
    "dudunsparce-three-segment": "dudunsparce-threesegment",
    "flutter-mane": "fluttermane",
    "gimmighoul-chest": "gimmighoul",
    "gimmighoul-roaming": "gimmighoul-roaming",
    "gouging-fire": "gougingfire",
    "great-tusk": "greattusk",
    "iron-boulder": "ironboulder",
    "iron-bundle": "ironbundle",
    "iron-crown": "ironcrown",
    "iron-hands": "ironhands",
    "iron-jugulis": "ironjugulis",
    "iron-leaves": "ironleaves",
    "iron-moth": "ironmoth",
    "iron-thorns": "ironthorns",
    "iron-treads": "irontreads",
    "iron-valiant": "ironvaliant",
    "maushold-family-of-three": "maushold",
    "maushold-family-of-four": "maushold-four",
    "ogerpon-teal-mask": "ogerpon",
    "ogerpon-wellspring-mask": "ogerpon-wellspring",
    "ogerpon-hearthflame-mask": "ogerpon-hearthflame",
    "ogerpon-cornerstone-mask": "ogerpon-cornerstone",
    "oinkologne-male": "oinkologne",
    "oinkologne-female": "oinkologne-f",
    "palafin-zero": "palafin",
    "palafin-hero": "palafin-hero",
    "raging-bolt": "ragingbolt",
    "roaring-moon": "roaringmoon",
    "sandy-shocks": "sandyshocks",
    "scream-tail": "screamtail",
    "slither-wing": "slitherwing",
    "squawkabilly-green-plumage": "squawkabilly",
    "squawkabilly-blue-plumage": "squawkabilly-blue",
    "squawkabilly-yellow-plumage": "squawkabilly-yellow",
    "squawkabilly-white-plumage": "squawkabilly-white",
    "tauros-combat-breed": "tauros-paldeacombat",
    "tauros-blaze-breed": "tauros-paldeablaze",
    "tauros-aqua-breed": "tauros-paldeaaqua",
    "tatsugiri-curly": "tatsugiri",
    "terapagos-normal": "terapagos",
    "terapagos-terastal": "terapagos-terastal",
    "terapagos-stellar": "terapagos-stellar",
    "ting-lu": "tinglu",
    "walking-wake": "walkingwake",
    "wo-chien": "wochien",
    "wooper-paldean": "wooper-paldea",
    "ursaluna-bloodmoon": "ursaluna-bloodmoon",
    # Hisui naming differences
    "arcanine-hisuian": "arcanine-hisui",
    "avalugg-hisuian": "avalugg-hisui",
    "basculegion-male": "basculegion",
    "basculegion-female": "basculegion-f",
    "braviary-hisuian": "braviary-hisui",
    "decidueye-hisuian": "decidueye-hisui",
    "dialga-origin": "dialga",
    "electrode-hisuian": "electrode-hisui",
    "enamorus-incarnate": "enamorus",
    "enamorus-therian": "enamorus-therian",
    "goodra-hisuian": "goodra-hisui",
    "growlithe-hisuian": "growlithe-hisui",
    "lilligant-hisuian": "lilligant-hisui",
    "palkia-origin": "palkia",
    "qwilfish-hisuian": "qwilfish-hisui",
    "samurott-hisuian": "samurott-hisui",
    "sliggoo-hisuian": "sliggoo-hisui",
    "sneasel-hisuian": "sneasel-hisui",
    "typhlosion-hisuian": "typhlosion-hisui",
    "voltorb-hisuian": "voltorb-hisui",
    "zoroark-hisuian": "zoroark-hisui",
    "zorua-hisuian": "zorua-hisui",
    # Kept for completeness even though they're Gen 1-5
    "kyurem-reshiram-fusion": "kyurem-white",
    "kyurem-zekrom-fusion": "kyurem-black",
    "meloetta-step": "meloetta-pirouette",
    "rotom-normal": "rotom",
}

SHOWDOWN_ANI_FILES: set[str] = set()
SHOWDOWN_AFD_FILES: set[str] = set()


def dedupe(items: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        if item not in seen:
            out.append(item)
            seen.add(item)
    return out


def fetch_showdown_file_set(index_url: str, extension: str) -> set[str]:
    response = requests.get(index_url, headers={"User-Agent": USER_AGENT}, timeout=60)
    response.raise_for_status()
    pattern = rf'href="(?:\./)?([^"/]+\.{re.escape(extension)})"'
    return set(re.findall(pattern, response.text))


def pokemon_db_sprite_slug_candidates(slug: str) -> list[str]:
    candidates: list[str] = []
    if slug in BW_ANIM_EXACT_SPRITE_SLUGS:
        candidates.append(BW_ANIM_EXACT_SPRITE_SLUGS[slug])
    if slug in BW_EXACT_SPRITE_SLUGS:
        candidates.append(BW_EXACT_SPRITE_SLUGS[slug])
    candidates.append(slug)
    return dedupe(candidates)


def showdown_sprite_id_candidates(slug: str) -> list[str]:
    candidates: list[str] = []

    if slug in SHOWDOWN_EXACT_SPRITE_IDS:
        candidates.append(SHOWDOWN_EXACT_SPRITE_IDS[slug])

    candidates.extend(
        [
            slug,
            slug.replace("-hisuian", "-hisui"),
            slug.replace("-paldean", "-paldea"),
            slug.replace("-female", "-f"),
            slug.replace("-male", ""),
            slug.replace("-dawn-wings", "-dawnwings")
            .replace("-dusk-mane", "-duskmane")
            .replace("-rapid-strike", "-rapidstrike")
            .replace("-single-strike", "")
            .replace("-three-segment", "-threesegment")
            .replace("-ice-face", "")
            .replace("-noice-face", "-noice"),
            slug.replace("-", ""),
            slug.replace("-midday", "")
            .replace("-solo", "")
            .replace("-normal", "")
            .replace("-origin", "")
            .replace("-incarnate", "")
            .strip("-"),
        ]
    )

    cleaned = [cand.strip("-") for cand in candidates if cand.strip("-")]
    return dedupe(cleaned)


def resolve_pokemon_db_asset(slug: str) -> tuple[str, str, str]:
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})

    last_error = None
    for cand in pokemon_db_sprite_slug_candidates(slug):
        gif_url = f"https://img.pokemondb.net/sprites/black-white/anim/normal/{cand}.gif"
        response = session.get(gif_url, timeout=30)
        if response.status_code == 200:
            return "animated-gif", gif_url, response.content.decode("latin1") if False else gif_url
        last_error = f"{response.status_code} for {gif_url}"

    for cand in pokemon_db_sprite_slug_candidates(slug):
        png_url = f"https://img.pokemondb.net/sprites/black-white/normal/{cand}.png"
        response = session.get(png_url, timeout=30)
        if response.status_code == 200:
            return "static-png-fallback", png_url, png_url
        last_error = f"{response.status_code} for {png_url}"

    raise RuntimeError(f"Could not resolve Gen 1-5 asset for {slug}: {last_error}")


def resolve_showdown_asset(slug: str) -> tuple[str, str, str]:
    for cand in showdown_sprite_id_candidates(slug):
        filename = f"{cand}.gif"
        if filename in SHOWDOWN_ANI_FILES:
            url = f"https://play.pokemonshowdown.com/sprites/ani/{filename}"
            local = f"showdown/ani/{filename}"
            return "showdown-animated-gif", url, local

    for cand in showdown_sprite_id_candidates(slug):
        filename = f"{cand}.png"
        if filename in SHOWDOWN_AFD_FILES:
            url = f"https://play.pokemonshowdown.com/sprites/afd/{filename}"
            local = f"showdown/afd/{filename}"
            return "showdown-static-png-fallback", url, local

    raise RuntimeError(f"Could not resolve Showdown asset for {slug}")


def download_one(species: str, slug: str, source_gen: str) -> dict:
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})

    if source_gen in GEN_1_TO_5:
        last_error = None
        for cand in pokemon_db_sprite_slug_candidates(slug):
            url = f"https://img.pokemondb.net/sprites/black-white/anim/normal/{cand}.gif"
            response = session.get(url, timeout=30)
            if response.status_code == 200:
                relative = Path(url.split("/sprites/", 1)[1])
                local_path = SPRITE_ROOT / relative
                local_path.parent.mkdir(parents=True, exist_ok=True)
                local_path.write_bytes(response.content)
                return {
                    "species": species,
                    "slug": slug,
                    "source_gen": source_gen,
                    "asset_kind": "animated-gif",
                    "remote_url": url,
                    "local_path": local_path.relative_to(PUBLIC_ROOT).as_posix(),
                    "bytes": len(response.content),
                }
            last_error = f"{response.status_code} for {url}"

        for cand in pokemon_db_sprite_slug_candidates(slug):
            url = f"https://img.pokemondb.net/sprites/black-white/normal/{cand}.png"
            response = session.get(url, timeout=30)
            if response.status_code == 200:
                relative = Path(url.split("/sprites/", 1)[1])
                local_path = SPRITE_ROOT / relative
                local_path.parent.mkdir(parents=True, exist_ok=True)
                local_path.write_bytes(response.content)
                return {
                    "species": species,
                    "slug": slug,
                    "source_gen": source_gen,
                    "asset_kind": "static-png-fallback",
                    "remote_url": url,
                    "local_path": local_path.relative_to(PUBLIC_ROOT).as_posix(),
                    "bytes": len(response.content),
                }
            last_error = f"{response.status_code} for {url}"

        raise RuntimeError(f"Could not download sprite for {species} ({slug}, {source_gen}): {last_error}")

    asset_kind, url, local_relative = resolve_showdown_asset(slug)
    response = session.get(url, timeout=30)
    response.raise_for_status()
    local_path = SPRITE_ROOT / local_relative
    local_path.parent.mkdir(parents=True, exist_ok=True)
    local_path.write_bytes(response.content)
    return {
        "species": species,
        "slug": slug,
        "source_gen": source_gen,
        "asset_kind": asset_kind,
        "remote_url": url,
        "local_path": local_path.relative_to(PUBLIC_ROOT).as_posix(),
        "bytes": len(response.content),
    }


def main() -> None:
    global SHOWDOWN_ANI_FILES, SHOWDOWN_AFD_FILES

    current_entries = load_current_entries()
    species_map = build_species_map_from_markdown()
    add_extra_species_from_pokemondb(species_map)

    current_species = {entry["species"] for entry in current_entries}
    mapped_species = set(species_map)
    if current_species != mapped_species:
        missing_in_map = sorted(current_species - mapped_species)
        extra_in_map = sorted(mapped_species - current_species)
        raise RuntimeError(
            "Species mapping mismatch. "
            f"Missing in map: {missing_in_map[:20]} | Extra in map: {extra_in_map[:20]}"
        )

    SHOWDOWN_ANI_FILES = fetch_showdown_file_set(SHOWDOWN_ANI_INDEX_URL, "gif")
    SHOWDOWN_AFD_FILES = fetch_showdown_file_set(SHOWDOWN_AFD_INDEX_URL, "png")

    if SPRITE_ROOT.exists():
        shutil.rmtree(SPRITE_ROOT)
    SPRITE_ROOT.mkdir(parents=True, exist_ok=True)

    jobs = []
    for entry in current_entries:
        species = entry["species"]
        meta = species_map[species]
        jobs.append((species, meta["slug"], meta["source_gen"]))

    manifest: list[dict] = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(download_one, species, slug, source_gen): species
            for species, slug, source_gen in jobs
        }

        completed = 0
        total = len(futures)
        for future in as_completed(futures):
            item = future.result()
            manifest.append(item)
            completed += 1
            if completed % 100 == 0 or completed == total:
                print(f"Downloaded {completed}/{total}")

    manifest.sort(key=lambda item: item["species"])
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    kinds = Counter(item["asset_kind"] for item in manifest)
    print(f"Wrote manifest: {MANIFEST_PATH}")
    print(f"Sprite root: {SPRITE_ROOT}")
    print(f"Asset kinds: {dict(kinds)}")


if __name__ == "__main__":
    main()
