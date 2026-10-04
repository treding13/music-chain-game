# Music Chain Game — sample

A static six-degrees music game prototype. The browser uses curated song credits in `data/music-graph.json`, so there is no runtime music API or database cost.

## Data

The sample graph is deliberately small and is not a download of the full MusicBrainz database. To expand the game, import the needed fields from a MusicBrainz core-data snapshot, review lead and featured credits, and store the resulting graph with the app. Artwork requires separate rights review.

## Run locally

Serve this folder with a local static web server. No build step is required. Opening `index.html` directly with a `file://` URL may block the JSON fetch.

## Deploy

Cloudflare Pages is connected to this repository's `main` branch. Pushes to `main` deploy automatically at [music-chain-game.pages.dev](https://music-chain-game.pages.dev/). The project uses no build command and `.` as the output directory.
