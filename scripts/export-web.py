"""Export the local CC0 catalog as static, gzip-compressed Cloudflare Pages shards."""

import gzip
import json
import sqlite3
import sys
import unicodedata
from contextlib import ExitStack
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DATABASE = ROOT / "data" / "work" / "music-catalog.sqlite"
GROUP_DATABASE = ROOT / "data" / "work" / "group-catalog.sqlite"
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


def main(output=OUTPUT):
    if output.exists():
        raise FileExistsError(f"Export destination already exists: {output}")
    if not DATABASE.exists():
        raise FileNotFoundError(f"Import the canonical archive first: {DATABASE}")
    if not GROUP_DATABASE.exists():
        raise FileNotFoundError(f"Import the CC0 group relationships first: {GROUP_DATABASE}")
    (output / "artists").mkdir(parents=True)
    (output / "songs").mkdir()
    (output / "memberships").mkdir()
    connection = sqlite3.connect(f"file:{DATABASE}?mode=ro", uri=True)
    group_connection = sqlite3.connect(f"file:{GROUP_DATABASE}?mode=ro", uri=True)
    id_map = {}
    names = {}
    exact_names = {}
    artist_count = 0
    with ExitStack() as stack:
        writers = [gz_writer(stack, output / "artists" / f"{i:03d}.ndjson.gz") for i in range(512)]
        for artist_id, name, score in connection.execute("SELECT id, name, score FROM artists ORDER BY id"):
            number = artist_count
            artist_count += 1
            id_map[artist_id] = number
            names[number] = name
            if name in ("Eminem", "Ice Cube", "Limp Bizkit"):
                exact_names.setdefault(name, []).append((number, score))
            normalized = normalize(name)
            tokens = set(normalized.split())
            tokens.add(normalized.replace(" ", ""))
            for shard in {bucket(token, 512) for token in tokens if token}:
                writers[shard].write(encoded([number, name, score]))
    print(f"Wrote {artist_count:,} searchable artists", flush=True)

    membership_rows = 0
    with ExitStack() as stack:
        writers = [gz_writer(stack, output / "memberships" / f"{i:03d}.ndjson.gz") for i in range(256)]
        for member_mbid, group_mbid, begin, end in group_connection.execute(
            "SELECT DISTINCT member_mbid, group_mbid, begin_year, end_year FROM memberships"
        ):
            member = id_map.get(member_mbid)
            group = id_map.get(group_mbid)
            if member is None or group is None:
                continue
            writers[member % 256].write(encoded([member, group, names[group], begin, end]))
            membership_rows += 1
    print(f"Wrote {membership_rows:,} searchable membership periods", flush=True)

    song_rows = 0
    indexed_songs = 0
    with ExitStack() as stack:
        writers = [gz_writer(stack, output / "songs" / f"{i:03d}.ndjson.gz") for i in range(256)]
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
        group_only_songs = 0
        for recording_id, title, group_mbid, score in group_connection.execute(
            "SELECT id, title, group_mbid, score FROM group_recordings"
        ):
            group = id_map.get(group_mbid)
            if group is None:
                continue
            song = [recording_id, title, [group], score]
            writers[group % 256].write(encoded([group, song]))
            group_only_songs += 1
            song_rows += 1
            if group_only_songs % 500000 == 0:
                print(f"Exported {group_only_songs:,} group-only recordings", flush=True)
    connection.close()
    group_connection.close()

    for path in output.rglob("*.gz"):
        if path.stat().st_size > MAX_ASSET_BYTES:
            raise ValueError(f"Cloudflare Pages asset exceeds 24 MiB: {path}")
    for name in ("Eminem", "Ice Cube", "Limp Bizkit"):
        if name not in exact_names:
            raise ValueError(f"Expected popular artist missing from canonical data: {name}")
    start = max(exact_names["Eminem"], key=lambda item: item[1])[0]
    goal = max(exact_names["Ice Cube"], key=lambda item: item[1])[0]
    manifest = {
        "source": "MusicBrainz canonical data 2026-10-03 and core data 2026-09-30 (CC0)",
        "start": [start, "Eminem"],
        "goal": [goal, "Ice Cube"],
        "named_artists": artist_count,
        "multi_credit_recordings": indexed_songs,
        "group_only_recordings": group_only_songs,
        "membership_periods": membership_rows,
        "song_index_rows": song_rows,
        "artist_shards": 512,
        "song_shards": 256,
        "membership_shards": 256,
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2), flush=True)


if __name__ == "__main__":
    if len(sys.argv) > 2:
        raise SystemExit("Usage: python scripts/export-web.py [new-output-directory]")
    main(Path(sys.argv[1]).resolve() if len(sys.argv) == 2 else OUTPUT)
