# Music Chain Game

A six-degrees music game hosted as a static Cloudflare Pages site. Players choose
an artist, then a song title; a move succeeds when a MusicBrainz recording
credits both artists, or when a credited group connects documented members.
Players can undo the last move, rewind to any earlier artist (removing all later
links), or start over after confirmation. Completing a chain shows the route and
offers spoiler-free or detailed text sharing, with copy-to-clipboard as a
fallback when native sharing is unavailable.

The site uses a local snapshot, not the MusicBrainz web API. It currently indexes
1,499,932 named artists and 4,568,865 multi-artist recordings, plus group-only
recordings from groups with at least two searchable members. Search files are
compressed and split into small shards so the browser downloads only a relevant
artist-name or song slice. No Cloudflare database, Worker, or paid service is used.

## Data source and license

The sources are the [MusicBrainz canonical dataset](https://musicbrainz.org/doc/Canonical_MusicBrainz_data),
snapshot `musicbrainz-canonical-dump-20261003-080003`, and the [MusicBrainz core dump](https://musicbrainz.org/doc/MusicBrainz_Database/Download),
snapshot `20260930-002222`. Both are CC0 1.0. That permits commercial reuse, including a future site
with ads or affiliate links. Do not mix in MusicBrainz's noncommercial
supplementary dumps or rely on the free public API for commercial production.

Archive URL:

`https://data.metabrainz.org/pub/musicbrainz/canonical_data/musicbrainz-canonical-dump-20261003-080003/musicbrainz-canonical-dump-20261003-080003.tar.zst`

SHA-256:

`ee994ea04c1398ae75e47f2d16742399ff4a1f979fe2e1bdd457773a21ad6158`

Core archive URL:

`https://data.metabrainz.org/pub/musicbrainz/data/fullexport/20260930-002222/mbdump.tar.bz2`

Core SHA-256:

`4342c77212a8807e351e619b49162bc796e19419628bad3c9e791dbdd8e5f587`

The original 2.21 GB archive is stored in `data/source/` locally, outside Git.
The generated SQLite working database is in `data/work/`, also outside Git.
Only the CC0-derived, compressed `data/catalog/` files deploy.

## Rebuild the catalog

With Python 3.10+ and a `tar` command that supports zstd:

1. Download both archives above to `data/source/` and verify their SHA-256 values.
2. Run `python scripts/build-catalog.py import` for the canonical archive.
3. Extract only `mbdump/artist`, `mbdump/link`, and `mbdump/l_artist_artist` from
   the core archive into `data/work/core/`.
4. Run `python scripts/import-groups.py`.
5. Run `python scripts/export-web.py` to a new output directory and then
   `python scripts/check-catalog.py` for that directory.

Both scripts refuse to overwrite their existing outputs. For a new snapshot,
use new output paths or intentionally archive/remove the old generated outputs
before rebuilding. The build script imports every singly credited artist name
and every multiply credited recording in the canonical CSV. The export uses
named artists only for search and therefore omits a recording when none of its
credited artists has a standalone name in this snapshot.

## Coverage limits

Artist credits are not the same as detailed performance roles. The game uses
MusicBrainz's “member of band” relationship and its membership years to allow
group connections. It requires overlapping membership periods between two
members, but a group credit does **not** prove either member performed on a
specific recording. The game does not treat an uncredited guest as a
collaborator. An artist present only in combined credits without a
standalone name may not appear in search. Song years are not included in this
particular snapshot. Duplicate recording versions with the same title are
grouped for selection; a move is accepted if at least one such version supports
the connection. “Fuck the Police” search matches MusicBrainz's “Fuck tha Police”.

## Run and deploy

Serve the project directory with a local static web server, then open
`index.html`. Cloudflare Pages is connected to this repository's `main` branch
and deploys it to [music-chain-game.pages.dev](https://music-chain-game.pages.dev/).
The Pages project uses no build command and `.` as its output directory.
