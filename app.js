'use strict';

const DB_NAME = 'yusuf-music-db';
const DB_VERSION = 1;
const TRACK_STORE = 'tracks';
const PLAYLIST_STORE = 'playlists';

const audio = document.getElementById('audioElement');
const pageContent = document.getElementById('pageContent');
const toastElement = document.getElementById('toast');
const audioFileInput = document.getElementById('audioFileInput');
const playlistDialog = document.getElementById('playlistDialog');
const addToPlaylistDialog = document.getElementById('addToPlaylistDialog');

let db;
let tracks = [];
let playlists = [];
let currentView = 'home';
let currentPlaylistId = null;
let currentTrackId = null;
let queue = [];
let queueIndex = -1;
let shuffleEnabled = false;
let repeatMode = 'off'; // off | all | one
let pendingPlaylistTrackId = null;
let deferredInstallPrompt = null;
let toastTimer;
const objectUrls = new Map();

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function makeId() {
  return (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}

function showToast(message) {
  toastElement.textContent = message;
  toastElement.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastElement.classList.remove('show'), 2600);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(TRACK_STORE)) database.createObjectStore(TRACK_STORE, { keyPath: 'id' });
      if (!database.objectStoreNames.contains(PLAYLIST_STORE)) database.createObjectStore(PLAYLIST_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Database tidak dapat dibuka.'));
  });
}

function storeRequest(storeName, mode, operation) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let request;
    try { request = operation(store); }
    catch (error) { reject(error); return; }
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Operasi penyimpanan gagal.'));
  });
}

const getAllTracks = () => storeRequest(TRACK_STORE, 'readonly', (store) => store.getAll());
const getAllPlaylists = () => storeRequest(PLAYLIST_STORE, 'readonly', (store) => store.getAll());
const saveTrack = (track) => storeRequest(TRACK_STORE, 'readwrite', (store) => store.put(track));
const savePlaylist = (playlist) => storeRequest(PLAYLIST_STORE, 'readwrite', (store) => store.put(playlist));
const deleteTrackFromDB = (id) => storeRequest(TRACK_STORE, 'readwrite', (store) => store.delete(id));
const deletePlaylistFromDB = (id) => storeRequest(PLAYLIST_STORE, 'readwrite', (store) => store.delete(id));

function makeObjectUrl(key, blob) {
  if (!blob) return '';
  if (objectUrls.has(key)) return objectUrls.get(key);
  const url = URL.createObjectURL(blob);
  objectUrls.set(key, url);
  return url;
}

function revokeObjectUrl(key) {
  const url = objectUrls.get(key);
  if (url) URL.revokeObjectURL(url);
  objectUrls.delete(key);
}

function parseFileName(filename) {
  const base = filename.replace(/\.[^/.]+$/, '').replace(/_/g, ' ').trim();
  const parts = base.split(' - ');
  if (parts.length >= 2) return { artist: parts[0].trim() || 'Unknown artist', title: parts.slice(1).join(' - ').trim() || base };
  return { artist: 'Unknown artist', title: base || 'Untitled track' };
}

function readDuration(file) {
  return new Promise((resolve) => {
    const temporaryAudio = document.createElement('audio');
    const url = URL.createObjectURL(file);
    const finish = (duration = 0) => {
      URL.revokeObjectURL(url);
      temporaryAudio.removeAttribute('src');
      resolve(Number.isFinite(duration) ? duration : 0);
    };
    temporaryAudio.preload = 'metadata';
    temporaryAudio.onloadedmetadata = () => finish(temporaryAudio.duration);
    temporaryAudio.onerror = () => finish(0);
    temporaryAudio.src = url;
    setTimeout(() => finish(0), 12000);
  });
}

async function requestPersistentStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      const persisted = await navigator.storage.persist();
      if (!persisted) console.info('Browser tidak memberikan persistent storage. Buat salinan file musik aslimu.');
    }
  } catch (error) {
    console.warn('Persistent storage tidak tersedia:', error);
  }
}

async function importAudioFiles(fileList) {
  const files = [...fileList].filter((file) => file.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg|flac)$/i.test(file.name));
  if (!files.length) {
    showToast('File audio tidak ditemukan. Pilih file musik yang didukung.');
    return;
  }

  let added = 0;
  showToast(`Sedang menambahkan ${files.length} file musik...`);
  for (const file of files) {
    try {
      const info = parseFileName(file.name);
      const duration = await readDuration(file);
      const track = {
        id: makeId(),
        title: info.title,
        artist: info.artist,
        album: 'Local collection',
        file,
        cover: null,
        duration,
        favorite: false,
        addedAt: Date.now()
      };
      await saveTrack(track);
      tracks.push(track);
      added += 1;
    } catch (error) {
      console.error('Gagal menyimpan file:', file.name, error);
    }
  }

  await requestPersistentStorage();
  renderApp();
  showToast(added ? `${added} lagu berhasil ditambahkan ke koleksi.` : 'Tidak ada lagu yang berhasil ditambahkan. Periksa ruang penyimpanan.');
  audioFileInput.value = '';
}

function getTrack(id) { return tracks.find((track) => track.id === id); }
function sortedTracks(list = tracks) { return [...list].sort((a, b) => b.addedAt - a.addedAt); }

function currentVisibleTracks() {
  let list = sortedTracks();
  if (currentView === 'favorites') list = list.filter((track) => track.favorite);
  if (currentView === 'playlist-detail' && currentPlaylistId) {
    const playlist = playlists.find((item) => item.id === currentPlaylistId);
    const ids = playlist ? playlist.trackIds : [];
    list = ids.map((id) => getTrack(id)).filter(Boolean);
  }
  if (currentView === 'home') list = list.slice(0, 8);
  const query = $('#searchInput').value.trim().toLowerCase();
  if (query) list = list.filter((track) => `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(query));
  return list;
}

function coverMarkup(track, className = 'track-cover') {
  if (track && track.cover) {
    const url = makeObjectUrl(`cover:${track.id}`, track.cover);
    return `<div class="${className}"><img src="${url}" alt="Sampul ${escapeHtml(track.title)}"></div>`;
  }
  return `<div class="${className}"><span>♫</span></div>`;
}

function renderTrackList(list, container, showHeader = true) {
  if (!list.length) {
    container.innerHTML = `<div class="empty-state"><strong>Belum ada lagu di sini</strong>Tambahkan musik atau ubah kata pencarianmu.</div>`;
    return;
  }

  const header = showHeader ? `<div class="list-header"><span>#</span><span>Judul lagu</span><span class="album-col">Album</span><span></span><span></span><span></span><span class="duration-col">Durasi</span></div>` : '';
  const rows = list.map((track, index) => {
    const isPlaying = currentTrackId === track.id && !audio.paused;
    return `<div class="track-row ${currentTrackId === track.id ? 'playing' : ''}" data-track-row="${track.id}">
      <button class="track-play" data-action="play" data-id="${track.id}" aria-label="Putar ${escapeHtml(track.title)}">${isPlaying ? 'Ⅱ' : '▶'}</button>
      <div class="track-main">${coverMarkup(track)}<div class="track-meta"><div class="track-title">${escapeHtml(track.title)}</div><div class="track-artist">${escapeHtml(track.artist)}</div></div></div>
      <div class="track-album">${escapeHtml(track.album || '—')}</div>
      <button class="row-action ${track.favorite ? 'liked' : ''}" data-action="favorite" data-id="${track.id}" title="${track.favorite ? 'Hapus dari favorit' : 'Tambah ke favorit'}" aria-label="Favorit">${track.favorite ? '♥' : '♡'}</button>
      <button class="row-action row-playlist" data-action="playlist" data-id="${track.id}" title="Tambah ke playlist" aria-label="Tambah ke playlist">＋</button>
      <button class="row-action" data-action="delete" data-id="${track.id}" title="Hapus lagu" aria-label="Hapus lagu">×</button>
      <span class="track-duration">${formatTime(track.duration)}</span>
    </div>`;
  }).join('');
  container.innerHTML = header + rows;
}

function renderHome() {
  const searchQuery = $('#searchInput').value.trim().toLowerCase();
  const homeTracks = searchQuery
    ? sortedTracks().filter((track) => `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(searchQuery))
    : sortedTracks().slice(0, 8);
  pageContent.innerHTML = `
    <section class="hero-panel">
      <div class="hero-glow"></div><div class="hero-copy">
        <div class="eyebrow"><span class="live-dot"></span> RUANG MUSIK PRIBADIMU</div>
        <h1>Semua lagu favorit,<br><em>dalam satu ruang.</em></h1>
        <p>Koleksi musikmu. Aturanmu. Dengarkan kapan saja.</p>
        <div class="hero-actions"><button class="button button-accent" data-action="import"><span>＋</span> Tambahkan musik</button><button class="button button-outline" data-action="navigate-library">Lihat koleksi <span>↗</span></button></div>
      </div>
      <div class="hero-art" aria-hidden="true"><div class="vinyl vinyl-back"></div><div class="vinyl vinyl-front"><div class="vinyl-center">YM</div></div><div class="equalizer"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></div>
      <div class="hero-index">01 <span>/ YOUR SOUND</span></div>
    </section>
    <section class="content-section"><div class="section-heading"><div><div class="eyebrow muted-eyebrow">MULAI DARI SINI</div><h2>Baru ditambahkan</h2></div><button class="text-button" data-action="navigate-library">Lihat semua <span>→</span></button></div><div class="track-list" id="homeTrackList"></div></section>
    ${tracks.length ? '' : `<section class="content-section"><div class="empty-feature"><div class="empty-disc"><span>♫</span></div><div><h3>Belum ada lagu di sini</h3><p>Tambahkan file musik dari perangkatmu untuk mulai membangun perpustakaan musik pribadi.</p></div><button class="button button-primary" data-action="import">Pilih file musik</button></div></section>`}
  `;
  if (homeTracks.length) renderTrackList(homeTracks, $('#homeTrackList'), true);
  else $('#homeTrackList').innerHTML = '';
}

function renderLibraryView() {
  const list = currentVisibleTracks();
  pageContent.innerHTML = `<div class="section-heading"><div><div class="eyebrow muted-eyebrow">YOUR COLLECTION</div><h2>Koleksi musik</h2><p class="page-subtitle">${tracks.length} lagu tersimpan di perangkat ini</p></div><div class="page-heading-actions"><button class="button button-primary" data-action="import">＋ Tambah lagu</button></div></div><div id="libraryTrackList" class="track-list"></div>`;
  renderTrackList(list, $('#libraryTrackList'), true);
}

function renderFavoritesView() {
  const list = currentVisibleTracks();
  pageContent.innerHTML = `<div class="section-heading"><div><div class="eyebrow muted-eyebrow">YOUR FAVORITES</div><h2>Lagu favorit</h2><p class="page-subtitle">Lagu yang kamu simpan dengan tanda hati.</p></div></div><div id="favoriteTrackList" class="track-list"></div>`;
  renderTrackList(list, $('#favoriteTrackList'), true);
}

function renderPlaylistsView() {
  const query = $('#searchInput').value.trim().toLowerCase();
  const list = playlists.filter((item) => item.name.toLowerCase().includes(query));
  pageContent.innerHTML = `<div class="section-heading"><div><div class="eyebrow muted-eyebrow">MADE BY YOU</div><h2>Playlist</h2><p class="page-subtitle">Atur lagu berdasarkan suasana atau aktivitas.</p></div><button class="button button-primary" data-action="create-playlist">＋ Buat playlist</button></div><div class="playlist-grid">${list.length ? list.map((playlist) => `<button class="playlist-card" data-action="open-playlist" data-id="${playlist.id}"><div class="playlist-art">♫</div><strong>${escapeHtml(playlist.name)}</strong><small>${playlist.trackIds.length} lagu</small></button>`).join('') : `<div class="empty-state"><strong>Belum ada playlist</strong>Buat playlist pertamamu untuk mengelompokkan lagu.</div>`}</div>`;
}

function renderPlaylistDetail() {
  const playlist = playlists.find((item) => item.id === currentPlaylistId);
  if (!playlist) { currentView = 'playlists'; currentPlaylistId = null; renderApp(); return; }
  const list = currentVisibleTracks();
  pageContent.innerHTML = `<div class="section-heading"><div><div class="eyebrow muted-eyebrow">YOUR PLAYLIST</div><h2>${escapeHtml(playlist.name)}</h2><p class="page-subtitle">${list.length} lagu dalam playlist ini</p></div><div class="page-heading-actions"><button class="button button-quiet" data-action="rename-playlist" data-id="${playlist.id}">Ubah nama</button><button class="button button-quiet" data-action="delete-playlist" data-id="${playlist.id}">Hapus playlist</button><button class="button button-primary" data-action="navigate-library">＋ Pilih dari koleksi</button></div></div><button class="text-button" data-action="navigate-playlists">← Kembali ke playlist</button><div id="playlistTrackList" class="track-list" style="margin-top:14px"></div>`;
  renderTrackList(list, $('#playlistTrackList'), true);
}

function updateNavigation() {
  $$('.nav-item, .mobile-nav-item').forEach((button) => {
    const view = button.dataset.view;
    button.classList.toggle('active', view === currentView || (currentView === 'playlist-detail' && view === 'playlists'));
  });
}

function renderSidebarPlaylists() {
  const container = $('#sidebarPlaylists');
  if (!playlists.length) {
    container.innerHTML = '<p class="muted small-text">Belum ada playlist</p>';
    return;
  }
  container.innerHTML = playlists.slice(0, 8).map((playlist) => `<button class="sidebar-playlist" data-action="open-playlist" data-id="${playlist.id}">♫ &nbsp; ${escapeHtml(playlist.name)}</button>`).join('');
}

function renderPlayer() {
  const track = getTrack(currentTrackId);
  const cover = $('#playerCover');
  if (!track) {
    cover.className = 'player-cover cover-placeholder';
    cover.innerHTML = '<span>♫</span>';
    $('#playerTitle').textContent = 'Pilih lagu untuk diputar';
    $('#playerArtist').textContent = 'Koleksi musikmu akan muncul di sini';
    $('#playerFavorite').disabled = true;
    $('#playerFavorite').textContent = '♡';
    $('#playPauseButton').textContent = '▶';
    $('#playPauseButton').setAttribute('aria-label', 'Putar');
    return;
  }
  if (track.cover) {
    cover.className = 'player-cover';
    cover.innerHTML = `<img src="${makeObjectUrl(`cover:${track.id}`, track.cover)}" alt="Sampul">`;
  } else {
    cover.className = 'player-cover cover-placeholder';
    cover.innerHTML = '<span>♫</span>';
  }
  $('#playerTitle').textContent = track.title;
  $('#playerArtist').textContent = track.artist;
  $('#playerFavorite').disabled = false;
  $('#playerFavorite').textContent = track.favorite ? '♥' : '♡';
  $('#playerFavorite').classList.toggle('liked', track.favorite);
  $('#playPauseButton').textContent = audio.paused ? '▶' : 'Ⅱ';
  $('#playPauseButton').setAttribute('aria-label', audio.paused ? 'Putar' : 'Jeda');
}

function renderApp() {
  updateNavigation();
  renderSidebarPlaylists();
  if (currentView === 'home') renderHome();
  else if (currentView === 'library') renderLibraryView();
  else if (currentView === 'favorites') renderFavoritesView();
  else if (currentView === 'playlists') renderPlaylistsView();
  else if (currentView === 'playlist-detail') renderPlaylistDetail();
  renderPlayer();
  $('#shuffleButton').classList.toggle('active', shuffleEnabled);
  $('#repeatButton').classList.toggle('active', repeatMode !== 'off');
  $('#repeatButton').title = `Ulangi: ${repeatMode === 'off' ? 'mati' : repeatMode === 'all' ? 'semua lagu' : 'satu lagu'}`;
}

function setView(view) {
  currentView = view;
  currentPlaylistId = null;
  renderApp();
}

function setMediaSession(track) {
  if (!('mediaSession' in navigator) || !track) return;
  try {
    let artwork = [];
    if (track.cover) artwork = [{ src: makeObjectUrl(`cover:${track.id}`, track.cover), sizes: '512x512', type: track.cover.type || 'image/jpeg' }];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album || 'Yusuf Music',
      artwork
    });
    navigator.mediaSession.setActionHandler('play', () => audio.play().catch(() => {}));
    navigator.mediaSession.setActionHandler('pause', () => audio.pause());
    navigator.mediaSession.setActionHandler('previoustrack', playPrevious);
    navigator.mediaSession.setActionHandler('nexttrack', playNext);
    navigator.mediaSession.setActionHandler('seekbackward', (details) => { audio.currentTime = Math.max(0, audio.currentTime - (details.seekOffset || 10)); });
    navigator.mediaSession.setActionHandler('seekforward', (details) => { audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + (details.seekOffset || 10)); });
    navigator.mediaSession.setActionHandler('seekto', (details) => { if (Number.isFinite(details.seekTime)) audio.currentTime = details.seekTime; });
  } catch (error) {
    console.info('Media Session tidak sepenuhnya didukung:', error);
  }
}

function updateMediaPlaybackState() {
  if ('mediaSession' in navigator) {
    try { navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing'; } catch (_) {}
  }
}

async function playTrack(trackId, selectedQueue = null) {
  const track = getTrack(trackId);
  if (!track) return;
  if (selectedQueue) {
    queue = selectedQueue.map((item) => typeof item === 'string' ? item : item.id);
    queueIndex = queue.indexOf(trackId);
  } else if (!queue.includes(trackId)) {
    queue = sortedTracks().map((item) => item.id);
    queueIndex = queue.indexOf(trackId);
  } else {
    queueIndex = queue.indexOf(trackId);
  }
  currentTrackId = trackId;
  const audioUrl = makeObjectUrl(`audio:${track.id}`, track.file);
  audio.src = audioUrl;
  audio.load();
  setMediaSession(track);
  renderApp();
  try {
    await audio.play();
    updateMediaPlaybackState();
    renderApp();
  } catch (error) {
    console.warn('Browser menolak autoplay:', error);
    showToast('Tekan tombol putar untuk memulai lagu.');
  }
}

async function togglePlayPause() {
  if (!currentTrackId) {
    const firstTrack = sortedTracks()[0];
    if (firstTrack) await playTrack(firstTrack.id, sortedTracks().map((item) => item.id));
    else showToast('Tambahkan lagu terlebih dahulu.');
    return;
  }
  if (audio.paused) {
    try { await audio.play(); } catch (error) { showToast('Lagu belum bisa diputar. Coba pilih lagu lagi.'); }
  } else audio.pause();
  updateMediaPlaybackState();
  renderApp();
}

async function playNext() {
  if (!queue.length) queue = sortedTracks().map((item) => item.id);
  if (!queue.length) return;
  let nextIndex;
  if (shuffleEnabled && queue.length > 1) {
    const choices = queue.map((_, index) => index).filter((index) => index !== queueIndex);
    nextIndex = choices[Math.floor(Math.random() * choices.length)];
  } else {
    nextIndex = queueIndex + 1;
    if (nextIndex >= queue.length) {
      if (repeatMode === 'all') nextIndex = 0;
      else { audio.pause(); audio.currentTime = 0; renderApp(); return; }
    }
  }
  queueIndex = nextIndex;
  await playTrack(queue[queueIndex], queue);
}

async function playPrevious() {
  if (!queue.length) return;
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  let previousIndex = queueIndex - 1;
  if (previousIndex < 0) previousIndex = repeatMode === 'all' ? queue.length - 1 : 0;
  queueIndex = previousIndex;
  await playTrack(queue[queueIndex], queue);
}

async function toggleFavorite(trackId) {
  const track = getTrack(trackId);
  if (!track) return;
  track.favorite = !track.favorite;
  await saveTrack(track);
  renderApp();
  showToast(track.favorite ? 'Ditambahkan ke favorit.' : 'Dihapus dari favorit.');
}

async function removeTrack(trackId) {
  const track = getTrack(trackId);
  if (!track) return;
  const confirmed = confirm(`Hapus “${track.title}” dari Yusuf Music? File asli di perangkat tidak akan dihapus.`);
  if (!confirmed) return;
  if (currentTrackId === trackId) {
    audio.pause(); audio.removeAttribute('src'); audio.load(); currentTrackId = null;
  }
  revokeObjectUrl(`audio:${trackId}`);
  revokeObjectUrl(`cover:${trackId}`);
  await deleteTrackFromDB(trackId);
  tracks = tracks.filter((item) => item.id !== trackId);
  playlists = playlists.map((playlist) => ({ ...playlist, trackIds: playlist.trackIds.filter((id) => id !== trackId) }));
  for (const playlist of playlists) await savePlaylist(playlist);
  queue = queue.filter((id) => id !== trackId);
  queueIndex = queue.indexOf(currentTrackId);
  renderApp();
  showToast('Lagu dihapus dari koleksi aplikasi.');
}

function openCreatePlaylist() {
  $('#playlistNameInput').value = '';
  playlistDialog.showModal();
  setTimeout(() => $('#playlistNameInput').focus(), 50);
}

async function createPlaylist(name) {
  const cleanName = name.trim();
  if (!cleanName) return;
  const playlist = { id: makeId(), name: cleanName, trackIds: [], createdAt: Date.now() };
  await savePlaylist(playlist);
  playlists.push(playlist);
  currentView = 'playlists';
  renderApp();
  showToast(`Playlist “${cleanName}” dibuat.`);
}

function openAddToPlaylist(trackId) {
  if (!playlists.length) {
    showToast('Buat playlist terlebih dahulu.');
    openCreatePlaylist();
    return;
  }
  const track = getTrack(trackId);
  pendingPlaylistTrackId = trackId;
  $('#addToPlaylistTrackName').textContent = track ? `Simpan “${track.title}” ke playlist pilihanmu.` : 'Pilih playlist tujuan.';
  $('#playlistSelect').innerHTML = playlists.map((playlist) => `<option value="${playlist.id}">${escapeHtml(playlist.name)}</option>`).join('');
  addToPlaylistDialog.showModal();
}

async function addTrackToPlaylist(trackId, playlistId) {
  const playlist = playlists.find((item) => item.id === playlistId);
  if (!playlist || !getTrack(trackId)) return;
  if (!playlist.trackIds.includes(trackId)) playlist.trackIds.push(trackId);
  await savePlaylist(playlist);
  renderApp();
  showToast(`Ditambahkan ke “${playlist.name}”.`);
}

async function renamePlaylist(playlistId) {
  const playlist = playlists.find((item) => item.id === playlistId);
  if (!playlist) return;
  const name = prompt('Nama playlist baru:', playlist.name);
  if (!name || !name.trim()) return;
  playlist.name = name.trim();
  await savePlaylist(playlist);
  renderApp();
  showToast('Nama playlist diperbarui.');
}

async function deletePlaylist(playlistId) {
  const playlist = playlists.find((item) => item.id === playlistId);
  if (!playlist) return;
  if (!confirm(`Hapus playlist “${playlist.name}”? Lagu di koleksi tidak akan ikut terhapus.`)) return;
  await deletePlaylistFromDB(playlistId);
  playlists = playlists.filter((item) => item.id !== playlistId);
  currentPlaylistId = null;
  currentView = 'playlists';
  renderApp();
  showToast('Playlist dihapus.');
}

function navigateToPlaylist(playlistId) {
  currentPlaylistId = playlistId;
  currentView = 'playlist-detail';
  renderApp();
}

function handleAction(action, id) {
  if (action === 'play') {
    let list = currentVisibleTracks();
    if (!list.length) list = sortedTracks();
    playTrack(id, list.map((item) => item.id));
  } else if (action === 'favorite') toggleFavorite(id);
  else if (action === 'playlist') openAddToPlaylist(id);
  else if (action === 'delete') removeTrack(id);
  else if (action === 'import') audioFileInput.click();
  else if (action === 'navigate-library') setView('library');
  else if (action === 'navigate-playlists') setView('playlists');
  else if (action === 'create-playlist') openCreatePlaylist();
  else if (action === 'open-playlist') navigateToPlaylist(id);
  else if (action === 'rename-playlist') renamePlaylist(id);
  else if (action === 'delete-playlist') deletePlaylist(id);
  else if (action === 'add-any-playlist') {
    if (tracks.length) openAddToPlaylist(tracks[0].id);
    else showToast('Tambahkan lagu terlebih dahulu.');
  }
}

function handleDelegatedClick(event) {
  const actionElement = event.target.closest('[data-action]');
  if (!actionElement) return;
  handleAction(actionElement.dataset.action, actionElement.dataset.id);
}

function bindEvents() {
  $('#importButton').addEventListener('click', () => audioFileInput.click());
  $('#heroImportButton').addEventListener('click', () => audioFileInput.click());
  $('#emptyImportButton').addEventListener('click', () => audioFileInput.click());
  $('#heroLibraryButton').addEventListener('click', () => setView('library'));
  $('#seeAllButton').addEventListener('click', () => setView('library'));
  $('#sidebarCreatePlaylist').addEventListener('click', openCreatePlaylist);
  audioFileInput.addEventListener('change', (event) => importAudioFiles(event.target.files));

  $$('.nav-item, .mobile-nav-item').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
  pageContent.addEventListener('click', handleDelegatedClick);
  $('#sidebarPlaylists').addEventListener('click', handleDelegatedClick);

  $('#playPauseButton').addEventListener('click', togglePlayPause);
  $('#nextButton').addEventListener('click', playNext);
  $('#previousButton').addEventListener('click', playPrevious);
  $('#shuffleButton').addEventListener('click', () => { shuffleEnabled = !shuffleEnabled; renderApp(); showToast(shuffleEnabled ? 'Mode acak aktif.' : 'Mode acak mati.'); });
  $('#repeatButton').addEventListener('click', () => {
    repeatMode = repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off';
    renderApp();
    showToast(`Ulangi: ${repeatMode === 'off' ? 'mati' : repeatMode === 'all' ? 'semua lagu' : 'satu lagu'}.`);
  });
  $('#playerFavorite').addEventListener('click', () => currentTrackId && toggleFavorite(currentTrackId));

  $('#progressBar').addEventListener('input', (event) => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) audio.currentTime = (Number(event.target.value) / 1000) * audio.duration;
  });
  $('#volumeBar').addEventListener('input', (event) => { audio.volume = Number(event.target.value); });
  audio.volume = 0.8;
  audio.addEventListener('timeupdate', () => {
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
    $('#progressBar').value = Math.round((audio.currentTime / audio.duration) * 1000);
    $('#currentTime').textContent = formatTime(audio.currentTime);
    $('#durationTime').textContent = formatTime(audio.duration);
    if ('mediaSession' in navigator && navigator.mediaSession.setPositionState) {
      try { navigator.mediaSession.setPositionState({ duration: audio.duration, playbackRate: audio.playbackRate, position: audio.currentTime }); } catch (_) {}
    }
  });
  audio.addEventListener('loadedmetadata', () => {
    $('#durationTime').textContent = formatTime(audio.duration);
    $('#currentTime').textContent = formatTime(audio.currentTime);
  });
  audio.addEventListener('play', () => { updateMediaPlaybackState(); renderPlayer(); });
  audio.addEventListener('pause', () => { updateMediaPlaybackState(); renderPlayer(); });
  audio.addEventListener('ended', async () => {
    if (repeatMode === 'one') { audio.currentTime = 0; audio.play().catch(() => {}); return; }
    await playNext();
  });

  $('#playlistForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = $('#playlistNameInput').value;
    if (!name.trim()) return;
    playlistDialog.close();
    await createPlaylist(name);
  });
  $('#addToPlaylistForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const playlistId = $('#playlistSelect').value;
    const trackId = pendingPlaylistTrackId;
    addToPlaylistDialog.close();
    if (trackId && playlistId) await addTrackToPlaylist(trackId, playlistId);
  });
  $('#searchInput').addEventListener('input', () => renderApp());

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    $('#installButton').classList.remove('hidden');
  });
  $('#installButton').addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    $('#installButton').classList.add('hidden');
  });
  window.addEventListener('appinstalled', () => showToast('Yusuf Music berhasil dipasang.'));
}

async function initialize() {
  try {
    db = await openDatabase();
    [tracks, playlists] = await Promise.all([getAllTracks(), getAllPlaylists()]);
  } catch (error) {
    console.error(error);
    showToast('Penyimpanan lokal tidak dapat dibuka. Coba gunakan Chrome terbaru.');
  }
  bindEvents();
  renderApp();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('./sw.js').catch((error) => console.warn('Service worker gagal didaftarkan:', error));
  }

  const savedTrackId = localStorage.getItem('yusufMusicLastTrack');
  if (savedTrackId && getTrack(savedTrackId)) {
    currentTrackId = savedTrackId;
    queue = sortedTracks().map((item) => item.id);
    queueIndex = queue.indexOf(savedTrackId);
    audio.src = makeObjectUrl(`audio:${savedTrackId}`, getTrack(savedTrackId).file);
    setMediaSession(getTrack(savedTrackId));
    renderPlayer();
  }
}

window.addEventListener('beforeunload', () => {
  if (currentTrackId) { try { localStorage.setItem('yusufMusicLastTrack', currentTrackId); } catch (_) {} }
});

initialize();
