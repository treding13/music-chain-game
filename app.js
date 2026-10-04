const state = {
  current: null,
  artist: null,
  song: null,
  songs: [],
  moves: 0,
  chain: [],
  artistRequest: 0,
  songsLoaded: false,
};

const $ = id => document.getElementById(id);
const shardCache = new Map();
let catalog;

function normalize(value) {
  return value.normalize('NFKD').toLocaleLowerCase()
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim().replace(/\s+/g, ' ');
}

function bucket(prefix, count) {
  return Array.from(prefix).slice(0, 2)
    .reduce((value, char) => (value * 31 + char.codePointAt(0)) % count, 0);
}

async function loadShard(kind, number) {
  const path = `data/catalog/${kind}/${String(number).padStart(3, '0')}.ndjson.gz`;
  if (!shardCache.has(path)) {
    shardCache.set(path, fetch(path).then(async response => {
      if (!response.ok) throw new Error(`Could not load ${kind} catalog.`);
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('This browser cannot open the compressed music catalog. Please use a current browser.');
      }
      const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
      const text = await new Response(stream).text();
      return text.split('\n').filter(Boolean).map(line => JSON.parse(line));
    }).catch(error => {
      shardCache.delete(path);
      throw error;
    }));
  }
  return shardCache.get(path);
}

function initials(name) {
  return name.split(/\s+/).map(part => part[0]).slice(0, 2).join('');
}

function setMessage(text, isError = false) {
  $('message').textContent = text;
  $('message').classList.toggle('error', isError);
}

function clearSuggestions() {
  $('artist-suggestions').replaceChildren();
  $('song-suggestions').replaceChildren();
}

function renderChain() {
  const list = $('chain');
  list.replaceChildren();
  for (const [index, step] of state.chain.entries()) {
    const item = document.createElement('li');
    if (index === 0) item.className = 'first';
    const badge = document.createElement('span');
    badge.textContent = initials(step.artist.name);
    const details = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = step.artist.name;
    const caption = document.createElement('small');
    caption.textContent = step.song ? step.song.title : 'Starting artist';
    details.append(title, caption);
    item.append(badge, details);
    list.append(item);
  }
}

function renderTurn() {
  $('current-artist').textContent = state.current.name;
  $('moves').textContent = state.moves;
  $('artist-search').value = '';
  $('song-search').value = '';
  $('song-step').hidden = true;
  $('make-move').disabled = true;
  state.artist = null;
  state.song = null;
  state.songs = [];
  state.songsLoaded = false;
  state.artistRequest++;
  clearSuggestions();
  renderChain();
}

function showResults(containerId, results, onChoose) {
  const container = $(containerId);
  container.replaceChildren();
  for (const result of results) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'suggestion';
    button.setAttribute('role', 'option');
    button.textContent = result.label;
    button.addEventListener('click', () => onChoose(result));
    container.append(button);
  }
}

async function searchArtists() {
  const request = ++state.artistRequest;
  state.artist = null;
  state.song = null;
  state.songs = [];
  state.songsLoaded = false;
  $('song-step').hidden = true;
  $('song-search').value = '';
  $('make-move').disabled = true;
  clearSuggestions();
  setMessage('');
  const query = normalize($('artist-search').value);
  if (!catalog) return;
  if (query.length < 2) return;
  const firstToken = query.split(' ')[0];
  try {
    const rows = await loadShard('artists', bucket(firstToken, catalog.artist_shards));
    if (request !== state.artistRequest) return;
    const seenNames = new Set();
    const matches = rows.filter(([id, name]) => {
      const normalized = normalize(name);
      return id !== state.current.id && normalized.includes(query);
    }).sort((a, b) => {
      const an = normalize(a[1]);
      const bn = normalize(b[1]);
      return Number(bn === query) - Number(an === query)
        || Number(bn.startsWith(query)) - Number(an.startsWith(query))
        || b[2] - a[2] || a[1].localeCompare(b[1]);
    });
    const results = matches.filter(([, name]) => {
      const normalized = normalize(name);
      if (seenNames.has(normalized)) return false;
      seenNames.add(normalized);
      return true;
    }).slice(0, 12).map(([id, name]) => ({ id, label: name, name }));
    showResults('artist-suggestions', results, chooseArtist);
    if (!results.length) setMessage('No artist found for that search. Try another spelling.');
  } catch (error) {
    if (request === state.artistRequest) setMessage(error.message, true);
  }
}

async function chooseArtist(artist) {
  state.artistRequest++;
  state.artist = { id: artist.id, name: artist.name };
  state.song = null;
  state.songs = [];
  state.songsLoaded = false;
  $('artist-search').value = artist.name;
  $('artist-suggestions').replaceChildren();
  $('song-step').hidden = false;
  $('song-search').value = '';
  $('song-search').placeholder = `Search songs by ${artist.name}`;
  $('make-move').disabled = true;
  setMessage('Loading songs…');
  $('song-search').focus();
  const selected = artist.id;
  try {
    const rows = await loadShard('songs', selected % catalog.song_shards);
    if (state.artist?.id !== selected) return;
    const byTitle = new Map();
    for (const [id, [recordingId, title, credits, score]] of rows) {
      if (id !== selected) continue;
      const key = normalize(title);
      if (!key) continue;
      let song = byTitle.get(key);
      if (!song) {
        song = { id: recordingId, title, credits: new Set(), score };
        byTitle.set(key, song);
      }
      if (score > song.score) {
        song.id = recordingId;
        song.title = title;
        song.score = score;
      }
      for (const credit of credits) song.credits.add(credit);
    }
    state.songs = [...byTitle.values()];
    state.songsLoaded = true;
    setMessage(state.songs.length ? '' : 'This artist has no songs in the shared-credit catalog yet.');
    if ($('song-search').value.trim()) searchSongs();
  } catch (error) {
    if (state.artist?.id === selected) setMessage(error.message, true);
  }
}

function searchSongs() {
  state.song = null;
  $('make-move').disabled = true;
  $('song-suggestions').replaceChildren();
  if (!state.artist) return;
  const query = normalize($('song-search').value);
  if (!query) { setMessage(''); return; }
  if (!state.songsLoaded) { setMessage('Loading songs…'); return; }
  if (!state.songs.length) { setMessage('This artist has no songs in the shared-credit catalog yet.'); return; }
  const results = state.songs.filter(song => normalize(song.title).includes(query))
    .sort((a, b) => Number(normalize(b.title) === query) - Number(normalize(a.title) === query)
      || Number(normalize(b.title).startsWith(query)) - Number(normalize(a.title).startsWith(query))
      || b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, 12).map(song => ({ id: song.id, label: song.title, song }));
  showResults('song-suggestions', results, chooseSong);
  setMessage(results.length ? '' : 'No song found for that artist and title.');
}

function chooseSong(result) {
  state.song = result.song;
  $('song-search').value = result.song.title;
  $('song-suggestions').replaceChildren();
  $('make-move').disabled = false;
  setMessage('');
}

function makeMove() {
  if (!state.artist || !state.song) return;
  const currentName = state.current.name;
  const nextName = state.artist.name;
  if (!state.song.credits.has(state.current.id)) {
    setMessage(`The indexed credits for “${state.song.title}” do not include both ${currentName} and ${nextName}. Try another song or artist.`, true);
    return;
  }
  const song = state.song;
  const next = state.artist;
  state.moves++;
  state.chain.push({ artist: next, song });
  state.current = next;
  renderTurn();
  if (next.id === catalog.goal[0]) {
    $('win-copy').textContent = `You connected ${catalog.start[1]} to ${catalog.goal[1]} in ${state.moves} moves.`;
    $('win-dialog').hidden = false;
  } else {
    setMessage(`Correct! ${song.title} connects ${currentName} and ${nextName}.`);
  }
}

function reset() {
  if (!catalog) return;
  state.current = { id: catalog.start[0], name: catalog.start[1] };
  state.moves = 0;
  state.chain = [{ artist: state.current, song: null }];
  $('win-dialog').hidden = true;
  renderTurn();
  setMessage('');
}

$('artist-search').addEventListener('input', searchArtists);
$('song-search').addEventListener('input', searchSongs);
$('make-move').addEventListener('click', makeMove);
$('reset').addEventListener('click', reset);
$('play-again').addEventListener('click', reset);

fetch('data/catalog/manifest.json').then(response => {
  if (!response.ok) throw new Error('The music catalog could not be loaded.');
  return response.json();
}).then(data => {
  catalog = data;
  $('start-name').textContent = data.start[1];
  $('goal-name').textContent = data.goal[1];
  $('catalog-count').textContent = `${new Intl.NumberFormat().format(data.named_artists)} artists · ${new Intl.NumberFormat().format(data.multi_credit_recordings)} shared-credit recordings`;
  reset();
}).catch(error => setMessage(error.message, true));
