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
const membershipCache = new Map();
let catalog;

function normalize(value) {
  return value.normalize('NFKD').toLocaleLowerCase()
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim().replace(/\s+/g, ' ');
}

function normalizeSong(value) {
  return normalize(value).replace(/\btha\b/g, 'the');
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

async function loadMemberships(id) {
  if (!membershipCache.has(id)) {
    membershipCache.set(id, loadShard('memberships', id % catalog.membership_shards)
      .then(rows => {
        const groups = new Map();
        for (const [member, group, name, begin, end] of rows) {
          if (member !== id) continue;
          if (!groups.has(group)) groups.set(group, []);
          groups.get(group).push({ name, begin, end });
        }
        return groups;
      }).catch(error => {
        membershipCache.delete(id);
        throw error;
      }));
  }
  return membershipCache.get(id);
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
    caption.textContent = step.song
      ? `${step.song.title}${step.song.viaGroup ? ` · via ${step.song.viaGroup}` : ''}`
      : 'Starting artist';
    details.append(title, caption);
    if (index < state.chain.length - 1) {
      const rewind = document.createElement('button');
      rewind.type = 'button';
      rewind.className = 'rewind-link';
      rewind.textContent = 'Rewind here';
      rewind.setAttribute('aria-label', `Rewind to ${step.artist.name} and remove ${state.chain.length - index - 1} later ${state.chain.length - index - 1 === 1 ? 'link' : 'links'}`);
      rewind.addEventListener('click', () => rewindTo(index));
      details.append(rewind);
    }
    item.append(badge, details);
    list.append(item);
  }
  $('undo-move').disabled = state.chain.length < 2;
}

function renderTurn() {
  $('current-artist').textContent = state.current.name;
  $('moves').textContent = state.moves;
  const complete = state.current.id === catalog.goal[0];
  $('artist-search').disabled = complete;
  $('artist-search').placeholder = complete ? 'Chain complete — rewind to try another route' : 'Search artists by name';
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
    const compactQuery = query.replace(/ /g, '');
    const matches = rows.filter(([id, name]) => {
      const normalized = normalize(name);
      return id !== state.current.id
        && (normalized.includes(query) || normalized.replace(/ /g, '').includes(compactQuery));
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
  const request = ++state.artistRequest;
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
    const memberships = await loadMemberships(selected);
    const creditedIds = new Set([selected, ...memberships.keys()]);
    const shardNumbers = new Set([...creditedIds].map(id => id % catalog.song_shards));
    const shardRows = await Promise.all([...shardNumbers].map(number => loadShard('songs', number)));
    if (request !== state.artistRequest || state.artist?.id !== selected) return;
    const byTitle = new Map();
    for (const rows of shardRows) {
      for (const [id, [recordingId, title, credits, score]] of rows) {
        if (!creditedIds.has(id)) continue;
        const key = normalizeSong(title);
        if (!key) continue;
        let song = byTitle.get(key);
        if (!song) {
          song = { id: recordingId, title, variants: new Map(), score };
          byTitle.set(key, song);
        }
        if (score > song.score) {
          song.id = recordingId;
          song.title = title;
          song.score = score;
        }
        if (!song.variants.has(recordingId)) song.variants.set(recordingId, new Set(credits));
      }
    }
    state.songs = [...byTitle.values()];
    state.songsLoaded = true;
    setMessage(state.songs.length ? '' : 'This artist has no songs in the shared-credit catalog yet.');
    if ($('song-search').value.trim()) searchSongs();
  } catch (error) {
    if (request === state.artistRequest && state.artist?.id === selected) setMessage(error.message, true);
  }
}

function searchSongs() {
  state.song = null;
  $('make-move').disabled = true;
  $('song-suggestions').replaceChildren();
  if (!state.artist) return;
  const query = normalizeSong($('song-search').value);
  if (!query) { setMessage(''); return; }
  if (!state.songsLoaded) { setMessage('Loading songs…'); return; }
  if (!state.songs.length) { setMessage('This artist has no songs in the shared-credit catalog yet.'); return; }
  const results = state.songs.filter(song => normalizeSong(song.title).includes(query))
    .sort((a, b) => Number(normalizeSong(b.title) === query) - Number(normalizeSong(a.title) === query)
      || Number(normalizeSong(b.title).startsWith(query)) - Number(normalizeSong(a.title).startsWith(query))
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

function periodsOverlap(first, second) {
  return Math.max(first.begin ?? -Infinity, second.begin ?? -Infinity)
    <= Math.min(first.end ?? Infinity, second.end ?? Infinity);
}

function connectionForCredits(credits, currentId, nextId, currentGroups, nextGroups) {
  if (credits.has(currentId) && credits.has(nextId)) return { viaGroup: null };
  for (const groupId of credits) {
    const currentPeriods = currentGroups.get(groupId);
    const nextPeriods = nextGroups.get(groupId);
    if (currentPeriods && nextPeriods &&
        currentPeriods.some(first => nextPeriods.some(second => periodsOverlap(first, second)))) {
      return { viaGroup: currentPeriods[0].name };
    }
    if (currentPeriods && (credits.has(nextId) || groupId === nextId)) {
      return { viaGroup: currentPeriods[0].name };
    }
    if (nextPeriods && (credits.has(currentId) || groupId === currentId)) {
      return { viaGroup: nextPeriods[0].name };
    }
  }
  return null;
}

async function makeMove() {
  if (!state.artist || !state.song) return;
  const current = state.current;
  const next = state.artist;
  const selectedSong = state.song;
  $('make-move').disabled = true;
  setMessage('Checking connection…');
  let connection = null;
  try {
    const [currentGroups, nextGroups] = await Promise.all([
      loadMemberships(current.id), loadMemberships(next.id),
    ]);
    if (state.current !== current || state.artist !== next || state.song !== selectedSong) return;
    for (const credits of selectedSong.variants.values()) {
      connection = connectionForCredits(credits, current.id, next.id, currentGroups, nextGroups);
      if (connection) break;
    }
  } catch (error) {
    if (state.current === current && state.artist === next && state.song === selectedSong) {
      $('make-move').disabled = false;
      setMessage(error.message, true);
    }
    return;
  }
  if (!connection) {
    $('make-move').disabled = false;
    setMessage(`No indexed recording of “${selectedSong.title}” connects ${current.name} and ${next.name} through credits or documented group membership.`, true);
    return;
  }
  const song = { title: selectedSong.title, viaGroup: connection.viaGroup };
  state.moves++;
  state.chain.push({ artist: next, song });
  state.current = next;
  renderTurn();
  if (next.id === catalog.goal[0]) {
    setMessage('');
    showWin();
  } else {
    setMessage(`Correct! ${song.title} connects ${current.name} and ${next.name}${song.viaGroup ? ` through ${song.viaGroup} membership` : ''}.`);
  }
}

function rewindTo(index) {
  if (!catalog || index < 0 || index >= state.chain.length - 1) return;
  const removed = state.chain.length - index - 1;
  state.chain = state.chain.slice(0, index + 1);
  state.moves = state.chain.length - 1;
  state.current = state.chain.at(-1).artist;
  $('win-dialog').hidden = true;
  renderTurn();
  setMessage(`Removed ${removed} ${removed === 1 ? 'link' : 'links'}. Continue from ${state.current.name}.`);
  $('artist-search').focus();
}

function startOver() {
  if (state.chain.length > 1) {
    $('reset-dialog').hidden = false;
    $('cancel-reset').focus();
  } else {
    reset();
  }
}

function reset() {
  if (!catalog) return;
  state.current = { id: catalog.start[0], name: catalog.start[1] };
  state.moves = 0;
  state.chain = [{ artist: state.current, song: null }];
  $('win-dialog').hidden = true;
  $('reset-dialog').hidden = true;
  $('share-status').textContent = '';
  renderTurn();
  setMessage('');
}

function shareText() {
  const route = state.chain.map(step => step.artist.name).join(' → ');
  const intro = `Music Chain 🎵\n${catalog.start[1]} → ${catalog.goal[1]} in ${state.moves} ${state.moves === 1 ? 'move' : 'moves'}`;
  if (!$('include-songs').checked) {
    return `${intro}\n${route}\nCan you find another route?\n${location.origin}/`;
  }
  const steps = state.chain.slice(1).map(step =>
    `↳ ${step.song.title}${step.song.viaGroup ? ` (via ${step.song.viaGroup})` : ''} → ${step.artist.name}`);
  return `${intro}\n${state.chain[0].artist.name}\n${steps.join('\n')}\n${location.origin}/`;
}

function renderSharePreview() {
  $('share-preview').textContent = shareText();
  $('share-status').textContent = '';
}

function showWin() {
  $('win-copy').textContent = `You connected ${catalog.start[1]} to ${catalog.goal[1]} in ${state.moves} ${state.moves === 1 ? 'move' : 'moves'}.`;
  const list = $('win-chain');
  list.replaceChildren();
  for (const [index, step] of state.chain.entries()) {
    const item = document.createElement('li');
    const name = document.createElement('strong');
    name.textContent = step.artist.name;
    item.append(name);
    if (index > 0) {
      const song = document.createElement('small');
      song.textContent = `${step.song.title}${step.song.viaGroup ? ` · via ${step.song.viaGroup}` : ''}`;
      item.append(song);
    }
    list.append(item);
  }
  $('include-songs').checked = false;
  $('native-share').hidden = typeof navigator.share !== 'function';
  renderSharePreview();
  $('win-dialog').hidden = false;
  $('copy-result').focus();
}

async function copyResult() {
  const value = shareText();
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(value);
    $('share-status').textContent = 'Result copied to clipboard.';
  } catch {
    $('share-status').textContent = 'Could not copy automatically. Select the preview text to copy it.';
  }
}

async function nativeShare() {
  try {
    await navigator.share({ title: 'Music Chain result', text: shareText() });
    $('share-status').textContent = 'Shared!';
  } catch (error) {
    if (error.name !== 'AbortError') $('share-status').textContent = 'Sharing was unavailable. Try Copy result.';
  }
}

$('artist-search').addEventListener('input', searchArtists);
$('song-search').addEventListener('input', searchSongs);
$('make-move').addEventListener('click', makeMove);
$('reset').addEventListener('click', startOver);
$('confirm-reset').addEventListener('click', reset);
$('cancel-reset').addEventListener('click', () => { $('reset-dialog').hidden = true; $('reset').focus(); });
$('undo-move').addEventListener('click', () => rewindTo(state.chain.length - 2));
$('play-again').addEventListener('click', reset);
$('edit-chain').addEventListener('click', () => { $('win-dialog').hidden = true; $('undo-move').focus(); });
$('include-songs').addEventListener('change', renderSharePreview);
$('copy-result').addEventListener('click', copyResult);
$('native-share').addEventListener('click', nativeShare);

fetch('data/catalog/manifest.json').then(response => {
  if (!response.ok) throw new Error('The music catalog could not be loaded.');
  return response.json();
}).then(data => {
  catalog = data;
  $('start-name').textContent = data.start[1];
  $('goal-name').textContent = data.goal[1];
  $('catalog-count').textContent = `${new Intl.NumberFormat().format(data.named_artists)} artists · ${new Intl.NumberFormat().format(data.multi_credit_recordings + data.group_only_recordings)} indexed recordings`;
  reset();
}).catch(error => setMessage(error.message, true));
