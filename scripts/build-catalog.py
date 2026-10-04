"""Build a local, CC0-only music catalog from MusicBrainz canonical data.

The source archive is deliberately kept out of the deployed site and Git.
Run with the bundled Python runtime (or any Python 3.10+ installation):

    python scripts/build-catalog.py import

This imports every singly credited artist name and every multiply credited
recording from the canonical CSV. A later export step produces web shards.
"""

import csv
import io
import json
import sqlite3
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
ARCHIVE_NAME = "musicbrainz-canonical-dump-20261003-080003"
ARCHIVE = ROOT / "data" / "source" / f"{ARCHIVE_NAME}.tar.zst"
MEMBER = f"{ARCHIVE_NAME}/canonical/canonical_musicbrainz_data.csv"
DATABASE = ROOT / "data" / "work" / "music-catalog.sqlite"


def source_rows():
    process = subprocess.Popen(
        ["tar", "-xOf", str(ARCHIVE), MEMBER],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    assert process.stdout is not None
    stream = io.TextIOWrapper(process.stdout, encoding="utf-8", newline="")
    reader = csv.reader(stream)
    header = next(reader)
    expected = [
        "id", "artist_credit_id", "artist_mbids", "artist_credit_name",
        "release_mbid", "release_name", "recording_mbid", "recording_name",
        "combined_lookup", "score",
    ]
    if header != expected:
        process.kill()
        raise ValueError(f"Unexpected canonical CSV columns: {header}")
    try:
        yield from reader
    finally:
        stream.close()
        if process.wait() != 0:
            raise RuntimeError("Could not fully read the canonical archive")


def import_data():
    if not ARCHIVE.exists():
        raise FileNotFoundError(f"Download the CC0 archive first: {ARCHIVE}")
    DATABASE.parent.mkdir(parents=True, exist_ok=True)
    if DATABASE.exists():
        raise FileExistsError(f"Import output already exists: {DATABASE}")

    connection = sqlite3.connect(DATABASE)
    connection.executescript("""
        PRAGMA journal_mode=OFF;
        PRAGMA synchronous=OFF;
        CREATE TABLE artists (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            score INTEGER NOT NULL
        );
        CREATE TABLE recordings (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            artist_ids TEXT NOT NULL,
            score INTEGER NOT NULL
        );
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    """)
    named_artists = {}
    recording_batch = []
    total = 0
    multi = 0
    try:
        for row in source_rows():
            total += 1
            if len(row) != 10:
                continue
            ids = row[2]
            try:
                score = int(row[9])
            except ValueError:
                score = 0
            if len(ids) == 36:
                old = named_artists.get(ids)
                if old is None or score > old[1]:
                    named_artists[ids] = (row[3], score)
            elif len(ids) > 36 and row[6] and row[7]:
                multi += 1
                recording_batch.append((row[6], row[7], ids, score))
                if len(recording_batch) >= 20000:
                    connection.executemany(
                        """INSERT INTO recordings VALUES (?, ?, ?, ?)
                        ON CONFLICT(id) DO UPDATE SET
                            title=excluded.title,
                            artist_ids=excluded.artist_ids,
                            score=excluded.score
                        WHERE excluded.score > recordings.score""",
                        recording_batch,
                    )
                    recording_batch.clear()
            if total % 1000000 == 0:
                print(f"Read {total:,} rows; {len(named_artists):,} named artists; {multi:,} multi-credit rows", flush=True)
        if recording_batch:
            connection.executemany(
                """INSERT INTO recordings VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    title=excluded.title,
                    artist_ids=excluded.artist_ids,
                    score=excluded.score
                WHERE excluded.score > recordings.score""",
                recording_batch,
            )
        connection.executemany(
            "INSERT INTO artists VALUES (?, ?, ?)",
            ((artist_id, name, score) for artist_id, (name, score) in named_artists.items()),
        )
        summary = {
            "source": ARCHIVE_NAME,
            "source_rows": total,
            "multi_credit_rows": multi,
            "named_artists": len(named_artists),
            "unique_multi_credit_recordings": connection.execute("SELECT COUNT(*) FROM recordings").fetchone()[0],
        }
        connection.execute("INSERT INTO meta VALUES (?, ?)", ("summary", json.dumps(summary)))
        connection.commit()
        print(json.dumps(summary, indent=2), flush=True)
    finally:
        connection.close()


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] != "import":
        raise SystemExit("Usage: python scripts/build-catalog.py import")
    import_data()
