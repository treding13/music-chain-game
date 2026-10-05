"""Smoke-test the exported search shards and the starting puzzle."""

import gzip
import json
import sys
from pathlib import Path

from importlib.machinery import SourceFileLoader


ROOT = Path(__file__).resolve().parent.parent
CATALOG = Path(sys.argv[1]).resolve() if len(sys.argv) == 2 else ROOT / "data" / "catalog"
export = SourceFileLoader("export_web", str(ROOT / "scripts" / "export-web.py")).load_module()


def rows(kind, number):
    path = CATALOG / kind / f"{number:03d}.ndjson.gz"
    with gzip.open(path, "rt", encoding="utf-8") as source:
        return [json.loads(line) for line in source]


def artist(name, shard_count):
    query = export.normalize(name)
    shard = export.bucket(query.split()[0], shard_count)
    matches = [row for row in rows("artists", shard) if export.normalize(row[1]) == query]
    assert matches, f"Artist not searchable: {name}"
    return max(matches, key=lambda row: row[2])[0]


def song_credits(artist_id, title, shard_count):
    target = export.normalize(title)
    credits = set()
    for indexed_artist, song in rows("songs", artist_id % shard_count):
        if indexed_artist == artist_id and export.normalize(song[1]) == target:
            credits.update(song[2])
    assert credits, f"Song not searchable for artist {artist_id}: {title}"
    return credits


def main():
    manifest = json.loads((CATALOG / "manifest.json").read_text(encoding="utf-8"))
    artist_shards = manifest["artist_shards"]
    song_shards = manifest["song_shards"]
    eminem = artist("Eminem", artist_shards)
    dre = artist("Dr. Dre", artist_shards)
    ice_cube = artist("Ice Cube", artist_shards)
    limp_bizkit = artist("Limp Bizkit", artist_shards)
    nwa = artist("N.W.A.", artist_shards)
    assert eminem == manifest["start"][0]
    assert ice_cube == manifest["goal"][0]
    assert eminem in song_credits(dre, "Forgot About Dre", song_shards)
    assert dre in song_credits(ice_cube, "Natural Born Killaz", song_shards)
    assert eminem not in song_credits(limp_bizkit, "N 2 Gether Now", song_shards)
    compact_shard = export.bucket("nwa", artist_shards)
    assert any(row[0] == nwa for row in rows("artists", compact_shard)), "NWA abbreviation is not searchable"
    dre_memberships = [row for row in rows("memberships", dre % manifest["membership_shards"]) if row[0] == dre]
    ice_memberships = [row for row in rows("memberships", ice_cube % manifest["membership_shards"]) if row[0] == ice_cube]
    assert any(row[1] == nwa for row in dre_memberships), "Dr. Dre is missing from N.W.A."
    assert any(row[1] == nwa for row in ice_memberships), "Ice Cube is missing from N.W.A."
    assert nwa in song_credits(nwa, "Fuck tha Police", song_shards)
    print(f"Catalog check passed: {manifest['named_artists']:,} artists, Limp Bizkit, N.W.A. membership, and puzzle connections verified.")


if __name__ == "__main__":
    main()
