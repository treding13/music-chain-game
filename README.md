# Music Chain Game — sample

A static proof-of-concept for a six-degrees music game. It has no runtime third-party music API dependency: the browser uses the curated data in `data/music-graph.json`.

## Data plan

`scripts/import-musicbrainz.mjs` is a deliberately small MusicBrainz importer. It is for building a local graph, not for player traffic. It writes artist and recording credits into the same graph format, waits at least 1.1 seconds between requests, and requires a real contact URL in its User-Agent before use.

The sample graph contains hand-reviewed credits so that the prototype stays compact and the game answer is explainable. Before a commercial launch, import a selected MusicBrainz core-data snapshot into the app database and review artwork licenses separately. Do not depend on the public MusicBrainz web service at runtime.

## Run locally

Open `index.html` in a modern browser. No build step is required.

## Deploy

Upload this folder to Cloudflare Pages as a static site. There is no build command and the output directory is the project root.
