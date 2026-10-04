const state = {
  current: 'eminem',
  artist: null,
  song: null,
  moves: 0,
  chain: [{ artist: 'eminem', song: null }],
};

let graph;
const $ = id => document.getElementById(id);

fetch('data/music-graph.json')
  .then(response => {
    if (!response.ok) throw new Error('The music catalog could not be loaded.');
    return response.json();
  })
  .then(data => { graph = data; reset(); })
  .catch(() => { $('message').textContent = 'The music catalog could not be loaded. Please refresh the page.'; });

function initials(name) {
  return name.split(/\s+/).map(part => part[0]).slice(0, 2).join('');
}

function clearSuggestions() {
  $('artist-suggestions').replaceChildren();
  $('song-suggestions').replaceChildren();
}

function setMessage(text, isError = false) {
  $('message').textContent = text;
  $('message').classList.toggle('error', isError);
}

function renderChain() {
  const list = $('chain');
  list.replaceChildren();
  state.chain.forEach((step, index) => {
    const artist = graph.artists[step.artist];
    const item = document.createElement('li');
    if (index === 0) item.className = 'first';
    const badge = document.createElement('span');
    badge.textContent = initials(artist.name);
    const details = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = artist.name;
    const caption = document.createElement('small');
    caption.textContent = index ? `${step.song.title} · ${step.song.year}` : 'Starting artist';
    details.append(title, caption);
    item.append(badge, details);
    list.append(item);
  });
}

function renderTurn() {
  const current = graph.artists[state.current];
  $('current-artist').textContent = current.name;
  $('moves').textContent = state.moves;
  $('artist-search').value = '';
  $('artist-search').placeholder = 'Search any artist in this sample';
  $('song-search').value = '';
  $('song-step').hidden = true;
  $('make-move').disabled = true;
  state.artist = null;
  state.song = null;
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
    button.addEventListener('click', () => onChoose(result.id));
    container.append(button);
  }
}

function searchArtists() {
  state.artist = null;
  state.song = null;
  $('song-step').hidden = true;
  $('song-search').value = '';
  $('song-suggestions').replaceChildren();
  $('make-move').disabled = true;
  setMessage('');
  const query = $('artist-search').value.trim().toLocaleLowerCase();
  if (!query) { $('artist-suggestions').replaceChildren(); return; }
  const results = Object.entries(graph.artists)
    .filter(([id, artist]) => id !== state.current && artist.name.toLocaleLowerCase().includes(query))
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .slice(0, 10)
    .map(([id, artist]) => ({ id, label: artist.name }));
  showResults('artist-suggestions', results, chooseArtist);
  if (!results.length) setMessage('No artist with that name is in this sample catalog.');
}

function chooseArtist(id) {
  state.artist = id;
  state.song = null;
  $('artist-search').value = graph.artists[id].name;
  $('artist-suggestions').replaceChildren();
  $('song-step').hidden = false;
  $('song-search').value = '';
  $('song-search').placeholder = `Search songs by ${graph.artists[id].name}`;
  $('make-move').disabled = true;
  setMessage('');
  $('song-search').focus();
}

function searchSongs() {
  state.song = null;
  $('make-move').disabled = true;
  setMessage('');
  const query = $('song-search').value.trim().toLocaleLowerCase();
  if (!query || !state.artist) { $('song-suggestions').replaceChildren(); return; }
  const results = graph.edges
    .filter(song => song.artists.includes(state.artist) && song.title.toLocaleLowerCase().includes(query))
    .sort((a, b) => a.title.localeCompare(b.title) || a.year - b.year)
    .slice(0, 12)
    .map(song => ({ id: song.id, label: `${song.title} (${song.year})` }));
  showResults('song-suggestions', results, chooseSong);
  if (!results.length) setMessage('No song with that title is in this artist’s sample catalog.');
}

function chooseSong(id) {
  state.song = graph.edges.find(song => song.id === id);
  $('song-search').value = `${state.song.title} (${state.song.year})`;
  $('song-suggestions').replaceChildren();
  $('make-move').disabled = false;
  setMessage('');
}

function makeMove() {
  if (!state.artist || !state.song) return;
  const currentName = graph.artists[state.current].name;
  const nextName = graph.artists[state.artist].name;
  if (!state.song.artists.includes(state.current) || !state.song.artists.includes(state.artist)) {
    setMessage(`The credits for “${state.song.title}” do not include both ${currentName} and ${nextName}. Try another song or artist.`, true);
    return;
  }
  const next = state.artist;
  const song = state.song;
  state.moves++;
  state.chain.push({ artist: next, song });
  state.current = next;
  renderTurn();
  if (next === graph.goal) {
    $('win-copy').textContent = `You connected ${graph.artists[graph.start].name} to ${graph.artists[graph.goal].name} in ${state.moves} moves.`;
    $('win-dialog').hidden = false;
  } else {
    setMessage(`Correct! ${song.title} connects ${currentName} and ${nextName}.`);
  }
}

function reset() {
  if (!graph) return;
  state.current = graph.start;
  state.moves = 0;
  state.chain = [{ artist: graph.start, song: null }];
  $('win-dialog').hidden = true;
  renderTurn();
  setMessage('');
}

$('artist-search').addEventListener('input', searchArtists);
$('song-search').addEventListener('input', searchSongs);
$('make-move').addEventListener('click', makeMove);
$('reset').addEventListener('click', reset);
$('play-again').addEventListener('click', reset);
