"""Build group membership and group-only recordings from CC0 MusicBrainz dumps.

Inputs:
  data/work/core/mbdump/{artist,link,l_artist_artist} from mbdump.tar.bz2
  data/source/musicbrainz-canonical-dump-20261003-080003.tar.zst

Output:
  data/work/group-catalog.sqlite

Only MusicBrainz's 'member of band' relationship (link type 103) is used.
The script refuses to overwrite an existing group database.
"""

import json
import sqlite3
from collections import defaultdict
from pathlib import Path

from importlib.machinery import SourceFileLoader


ROOT = Path(__file__).resolve().parent.parent
CORE = ROOT / "data" / "work" / "core" / "mbdump"
DATABASE = ROOT / "data" / "work" / "group-catalog.sqlite"
CATALOG = ROOT / "data" / "work" / "music-catalog.sqlite"
canonical = SourceFileLoader("build_catalog", str(ROOT / "scripts" / "build-catalog.py")).load_module()
MEMBER_OF_BAND_LINK_TYPE = "103"


def lines(name):
    with (CORE / name).open("r", encoding="utf-8", errors="replace", newline="") as source:
        for line in source:
            yield line.rstrip("\n").split("\t")


def year(value):
    return int(value) if value not in ("", "\\N") else None


def main():
    for name in ("artist", "link", "l_artist_artist"):
        if not (CORE / name).exists():
            raise FileNotFoundError(f"Extract mbdump/{name} from the CC0 core archive first")
    if DATABASE.exists():
        raise FileExistsError(f"Group database already exists: {DATABASE}")
    if not CATALOG.exists():
        raise FileNotFoundError(f"Main local catalog missing: {CATALOG}")

    member_links = {}
    for row in lines("link"):
        if len(row) >= 11 and row[1] == MEMBER_OF_BAND_LINK_TYPE:
            member_links[row[0]] = (year(row[2]), year(row[5]))
    print(f"Found {len(member_links):,} dated/undated band-member links", flush=True)

    numeric_edges = []
    wanted = set()
    for row in lines("l_artist_artist"):
        if len(row) < 4 or row[1] not in member_links:
            continue
        numeric_edges.append((row[2], row[3], *member_links[row[1]]))
        wanted.update((row[2], row[3]))
    print(f"Found {len(numeric_edges):,} artist-to-group relationships", flush=True)

    mbids = {}
    for row in lines("artist"):
        if len(row) >= 3 and row[0] in wanted:
            mbids[row[0]] = row[1]
    print(f"Resolved {len(mbids):,} relationship participants", flush=True)

    connection = sqlite3.connect(DATABASE)
    connection.executescript("""
        PRAGMA journal_mode=OFF;
        PRAGMA synchronous=OFF;
        CREATE TABLE memberships (
            member_mbid TEXT NOT NULL,
            group_mbid TEXT NOT NULL,
            begin_year INTEGER,
            end_year INTEGER,
            PRIMARY KEY (member_mbid, group_mbid, begin_year, end_year)
        );
        CREATE TABLE group_recordings (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            group_mbid TEXT NOT NULL,
            score INTEGER NOT NULL
        );
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    """)
    membership_rows = [
        (mbids[member], mbids[group], begin, end)
        for member, group, begin, end in numeric_edges
        if member in mbids and group in mbids and member != group
    ]
    connection.executemany("INSERT OR IGNORE INTO memberships VALUES (?, ?, ?, ?)", membership_rows)
    connection.execute("CREATE INDEX memberships_group_idx ON memberships(group_mbid)")

    main_connection = sqlite3.connect(CATALOG)
    known = {row[0] for row in main_connection.execute("SELECT id FROM artists")}
    main_connection.close()
    group_members = defaultdict(set)
    for member, group, *_ in membership_rows:
        if member in known and group in known:
            group_members[group].add(member)
    groups = {group for group, members in group_members.items() if len(members) >= 2}
    print(f"Scanning canonical recordings for {len(groups):,} searchable groups with 2+ members", flush=True)

    batch = []
    source_rows = 0
    for row in canonical.source_rows():
        source_rows += 1
        if source_rows % 5000000 == 0:
            print(f"Read {source_rows:,} canonical rows", flush=True)
        if len(row) != 10 or row[2] not in groups or not row[6] or not row[7]:
            continue
        try:
            score = int(row[9])
        except ValueError:
            score = 0
        batch.append((row[6], row[7], row[2], score))
        if len(batch) >= 20000:
            connection.executemany("INSERT OR IGNORE INTO group_recordings VALUES (?, ?, ?, ?)", batch)
            batch.clear()
    if batch:
        connection.executemany("INSERT OR IGNORE INTO group_recordings VALUES (?, ?, ?, ?)", batch)
    summary = {
        "membership_relationships": connection.execute("SELECT COUNT(*) FROM memberships").fetchone()[0],
        "searchable_groups_with_two_members": len(groups),
        "group_only_recordings": connection.execute("SELECT COUNT(*) FROM group_recordings").fetchone()[0],
    }
    connection.execute("INSERT INTO meta VALUES (?, ?)", ("summary", json.dumps(summary)))
    connection.commit()
    connection.close()
    print(json.dumps(summary, indent=2), flush=True)


if __name__ == "__main__":
    main()
