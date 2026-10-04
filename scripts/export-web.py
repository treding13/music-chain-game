"""Export the local CC0 catalog as static, gzip-compressed Cloudflare Pages shards."""

import gzip
import json
import sqlite3
import unicodedata
from contextlib import ExitStack
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DATABASE = ROOT / "data" / "work" / "music-catalog.sqlite"
OUTPUT = ROOT / "data" / "catalog"
MAX_ASSET_BYTES = 24 * 1024 * 1024


def normalize(value):
    value = unicodedata.normalize("NFKD", value).lower()
    value = "".join(c for c in value if not unicodedata.category(c).startswith("M"))
    return " ".join("".join(c if c.isalnum() else " " for c in value).split())


def bucket(prefix, count):
    result = 0
    for char in prefix[:2]:
        result = (result * 31 + ord(char)) % count
    return result


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def gz_writer(stack, path):
    raw = stack.enter_context(path.open("wb"))
    return stack.enter_context(gzip.GzipFile(fileobj=raw, mode="wb", compresslevel=6, mtime=0))


def main():
    if OUTPUT.exists():
        raise FileExistsError(f"Export destination already exists: {OUTPUT}")
    if not DATABASE.exists():
        raise FileNotFoundError(f"Import the canonical archive first: {DATABASE}")
    (OUTPUT / "artists").mkdir(parents=True)
    (OUTPUT / "songs").mkdir()
    connection = sqlite3.connect(f"file:{DATABASE}?mode=ro", uri=True)
    id_map = {}
    exact_names = {}
    artist_count = 0
    with ExitStack() as stack:
        writers = [gz_writer(stack, OUTPUT / "artists" / f"{i:03d}.ndjson.gz") for i in range(512)]
        for artist_id, name, score in connection.execute("SELECT id, name, score FROM artists ORDER BY id"):
            number = artist_count
            artist_count += 1
            id_map[artist_id] = number
            if name in ("Eminem", "Ice Cube", "Limp Bizkit"):
                exact_names.setdefault(name, []).append((number, score))
            tokens = set(normalize(name).split())
            for shard in {bucket(token, 512) for token in tokens if token}:
                writers[shard].write(encoded([number, name, score]))
    print(f"Wrote {artist_count:,} searchable artists", flush=True)

    song_rows = 0
    indexed_songs = 0
    with ExitStack() as stack:
        writers = [gz_writer(stack, OUTPUT / "songs" / f"{i:03d}.ndjson.gz") for i in range(256)]
        for recording_id, title, ids, score in connection.execute(
            "SELECT id, title, artist_ids, score FROM recordings"
        ):
            credits = list(dict.fromkeys(id_map[artist_id] for artist_id in ids.split(",") if artist_id in id_map))
            if not credits:
                continue
            indexed_songs += 1
            song = [recording_id, title, credits, score]
            for number in credits:
                writers[number % 256].write(encoded([number, song]))
                song_rows += 1
            if indexed_songs % 500000 == 0:
                print(f"Exported {indexed_songs:,} recordings", flush=True)
    connection.close()

    for path in OUTPUT.rglob("*.gz"):
        if path.stat().st_size > MAX_ASSET_BYTES:
            raise ValueError(f"Cloudflare Pages asset exceeds 24 MiB: {path}")
    for name in ("Eminem", "Ice Cube", "Limp Bizkit"):
        if name not in exact_names:
            raise ValueError(f"Expected popular artist missing from canonical data: {name}")
    start = max(exact_names["Eminem"], key=lambda item: item[1])[0]
    goal = max(exact_names["Ice Cube"], key=lambda item: item[1])[0]
    manifest = {
        "source": "MusicBrainz canonical data 2026-10-03 (CC0)",
        "start": [start, "Eminem"],
        "goal": [goal, "Ice Cube"],
        "named_artists": artist_count,
        "multi_credit_recordings": indexed_songs,
        "song_index_rows": song_rows,
        "artist_shards": 512,
        "song_shards": 256,
    }
    (OUTPUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2), flush=True)


if __name__ == "__main__":
    main()
