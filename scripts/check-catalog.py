"""Smoke-test the exported search shards and the starting puzzle."""

import gzip
import json
from pathlib import Path

from importlib.machinery import SourceFileLoader


ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "data" / "catalog"
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
    assert eminem == manifest["start"][0]
    assert ice_cube == manifest["goal"][0]
    assert eminem in song_credits(dre, "Forgot About Dre", song_shards)
    assert dre in song_credits(ice_cube, "Natural Born Killaz", song_shards)
    assert eminem not in song_credits(limp_bizkit, "N 2 Gether Now", song_shards)
    print(f"Catalog check passed: {manifest['named_artists']:,} artists, including Limp Bizkit; puzzle path and rejection verified.")


if __name__ == "__main__":
    main()
