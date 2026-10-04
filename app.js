const state = { current: 'eminem', selected: null, moves: 0, chain: ['eminem'], used: new Set() };
let graph;
const $ = (id) => document.getElementById(id);

fetch('data/music-graph.json').then(r => r.json()).then(data => { graph = data; render(); });

function initials(name) { return name.split(/\s+/).map(x => x[0]).slice(0, 2).join(''); }
function neighbors(id) {
  return graph.edges.filter(edge => edge.artists.includes(id) && !state.used.has(edge.id)).map(edge => ({ edge, artist: edge.artists.find(a => a !== id) })).filter(x => x.artist);
}
function render() {
  const current = graph.artists[state.current];
  $('current-artist').textContent = current.name;
  $('artist-search').placeholder = `Search artists connected to ${current.name}`;
  $('moves').textContent = state.moves;
  $('chain').innerHTML = state.chain.map((item, i) => { const id = typeof item === 'string' ? item : item.id; const artist = graph.artists[id]; const edge = i ? graph.edges.find(e => e.id === item.edge) : null; return `<li class="${i === 0 ? 'first' : ''}"><span>${initials(artist.name)}</span><div><strong>${artist.name}</strong><small>${i ? `${edge.title} · ${edge.year}` : 'Starting artist'}</small></div></li>`; }).join('');
  $('suggestions').innerHTML = ''; $('artist-search').value = ''; state.selected = null; $('make-move').disabled = true;
  $('selected-credit').className = 'credit-preview empty'; $('selected-credit').textContent = 'Select an artist to see the song that connects you.';
}
function showSuggestions() {
  const query = $('artist-search').value.toLowerCase().trim();
  const matches = neighbors(state.current).filter(({ artist }) => graph.artists[artist].name.toLowerCase().includes(query)).slice(0, 7);
  $('suggestions').innerHTML = matches.map(({ artist, edge }) => `<button class="suggestion" data-artist="${artist}" data-edge="${edge.id}" role="option">${graph.artists[artist].name}</button>`).join('');
  document.querySelectorAll('.suggestion').forEach(button => button.onclick = () => choose(button.dataset.artist, button.dataset.edge));
}
function choose(artist, edgeId) {
  const edge = graph.edges.find(e => e.id === edgeId); state.selected = { artist, edgeId };
  $('artist-search').value = graph.artists[artist].name; $('suggestions').innerHTML = '';
  $('selected-credit').className = 'credit-preview'; $('selected-credit').innerHTML = `<b>${edge.title}</b> <span>(${edge.year})</span> connects ${graph.artists[state.current].name} and ${graph.artists[artist].name}.`;
  $('make-move').disabled = false;
}
function makeMove() {
  if (!state.selected) return;
  const { artist, edgeId } = state.selected;
  state.used.add(edgeId); state.moves++; state.chain.push({ ...graph.artists[artist], id: artist, edge: edgeId }); state.current = artist;
  if (artist === graph.goal) { render(); $('win-copy').textContent = `You connected ${graph.artists[graph.start].name} to ${graph.artists[graph.goal].name} in ${state.moves} moves.`; $('win-dialog').hidden = false; return; }
  render(); $('message').textContent = `Nice. Now find a song that connects ${graph.artists[artist].name} to someone new.`;
}
function reset() { state.current = graph.start; state.selected = null; state.moves = 0; state.chain = [graph.start]; state.used = new Set(); $('message').textContent = ''; $('win-dialog').hidden = true; render(); }
$('artist-search').addEventListener('input', showSuggestions); $('artist-search').addEventListener('focus', showSuggestions); $('make-move').onclick = makeMove; $('reset').onclick = reset; $('play-again').onclick = reset;
