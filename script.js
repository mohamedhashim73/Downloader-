const urlInput       = document.getElementById('url-input');
const fetchBtn       = document.getElementById('fetch-btn');
const shimmerSingle  = document.getElementById('shimmer-single');
const shimmerPlaylist = document.getElementById('shimmer-playlist');
const playlistSection = document.getElementById('playlist-section');
const singleSection  = document.getElementById('single-section');
const playlistItems  = document.getElementById('playlist-items');
const selectAllCheckbox = document.getElementById('select-all');
const selectedCount  = document.getElementById('selected-count');
const totalCount     = document.getElementById('total-count');
const downloadSelectedBtn = document.getElementById('download-selected-btn');
const deselectBtn         = document.getElementById('deselect-btn');
const rangeToggleBtn      = document.getElementById('range-toggle-btn');
const rangePanel          = document.getElementById('range-panel');
const rangeFrom           = document.getElementById('range-from');
const rangeTo             = document.getElementById('range-to');
const rangeApplyBtn       = document.getElementById('range-apply-btn');
const rangeError          = document.getElementById('range-error');
const downloadSingleBtn   = document.getElementById('download-single-btn');
const downloadsEl    = document.getElementById('downloads');
const downloadsEmpty = document.getElementById('downloads-empty');
const dlCountBadge   = document.getElementById('dl-count');
const clearHistoryBtn = document.getElementById('clear-history-btn');
const singleName     = document.getElementById('single-name');
const singleThumb    = document.getElementById('single-thumb');

const API = 'http://localhost:3000';

let currentPlaylist  = [];
let currentSingleUrl = '';
let dlCount = 0;
let plFormat = 'video';  // playlist format: 'video' or 'audio'
let sqFormat = 'video';  // single format: 'video' or 'audio'

// ── Helpers ──────────────────────────────────────────────

function getSelectedQuality() {
    if (plFormat === 'audio') {
        const el = document.querySelector('input[name="quality-audio"]:checked');
        return el ? el.value : '192k';
    } else {
        const el = document.querySelector('input[name="quality"]:checked');
        return el ? el.value : '720';
    }
}

function getSelectedSingleQuality() {
    if (sqFormat === 'audio') {
        const el = document.querySelector('input[name="single-quality-audio"]:checked');
        return el ? el.value : '192k';
    } else {
        const el = document.querySelector('input[name="single-quality"]:checked');
        return el ? el.value : '720';
    }
}

function hideShimmers() {
    shimmerSingle.classList.add('hidden');
    shimmerPlaylist.classList.add('hidden');
}

function showShimmer(isPlaylist) {
    playlistSection.classList.add('hidden');
    singleSection.classList.add('hidden');
    if (isPlaylist) {
        shimmerSingle.classList.add('hidden');
        shimmerPlaylist.classList.remove('hidden');
    } else {
        shimmerPlaylist.classList.add('hidden');
        shimmerSingle.classList.remove('hidden');
    }
}

function updateDlCount(delta) {
    dlCount = Math.max(0, dlCount + delta);
    dlCountBadge.textContent = dlCount;
    if (dlCount > 0) {
        downloadsEmpty.classList.add('hidden');
    } else {
        // only show empty if no cards remain at all
        if (!downloadsEl.querySelector('.download-item')) {
            downloadsEmpty.classList.remove('hidden');
        }
    }
}

// ── Tab switching ────────────────────────────────────────

function switchFormat(tabsId, format) {
    // Update state
    if (tabsId === 'pl-format-tabs') plFormat = format;
    if (tabsId === 'sq-format-tabs') sqFormat = format;

    // Update UI
    const tabs = document.getElementById(tabsId);
    tabs.querySelectorAll('.fmt-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.fmt === format);
    });

    // Show/hide quality rows
    const prefix = tabsId === 'pl-format-tabs' ? 'pl-' : 'sq-';
    document.getElementById(prefix + 'video-row').classList.toggle('hidden', format !== 'video');
    document.getElementById(prefix + 'audio-row').classList.toggle('hidden', format !== 'audio');
}

// ── Playlist / Single display ─────────────────────────────

function showPlaylist(data) {
    currentPlaylist = data.videos;
    playlistItems.innerHTML = '';
    totalCount.textContent  = data.count;
    selectedCount.textContent = '0';
    selectAllCheckbox.checked = false;

    // Reset range panel
    rangePanel.classList.add('hidden');
    rangeToggleBtn.classList.remove('active');
    rangeFrom.value = '';
    rangeTo.value   = '';
    rangeFrom.classList.remove('input-error');
    rangeTo.classList.remove('input-error');
    rangeError.classList.add('hidden');

    data.videos.forEach((video, index) => {
        const div = document.createElement('div');
        div.className = 'playlist-item';
        div.innerHTML = `
            <input type="checkbox" class="item-checkbox" id="item-${index}">
            <span class="custom-check"></span>
            ${video.thumbnail
                ? `<img class="item-thumb-img" src="${video.thumbnail}" alt="" loading="lazy">`
                : `<div class="item-thumb"><i class="fas fa-play"></i></div>`
            }
            <div class="item-info">
                <div class="item-name">${video.name}</div>
                <div class="item-duration">${video.duration || ''}</div>
            </div>
        `;
        div.addEventListener('click', () => {
            const cb = div.querySelector('.item-checkbox');
            cb.checked = !cb.checked;
            div.classList.toggle('is-checked', cb.checked);
            updateSelectedCount();
        });
        playlistItems.appendChild(div);
    });

    playlistSection.classList.remove('hidden');
    singleSection.classList.add('hidden');
}

function showSingle(data) {
    currentSingleUrl = urlInput.value.trim();
    singleName.textContent = data.name;

    if (data.thumbnail) {
        singleThumb.innerHTML = `<img src="${data.thumbnail}" alt="">`;
    } else {
        singleThumb.innerHTML = `<i class="fas fa-play-circle"></i>`;
    }

    singleSection.classList.remove('hidden');
    playlistSection.classList.add('hidden');
}

function updateSelectedCount() {
    const checked = document.querySelectorAll('.item-checkbox:checked').length;
    selectedCount.textContent = checked;
    const total = document.querySelectorAll('.item-checkbox').length;
    selectAllCheckbox.checked = checked === total && total > 0;
    const hasSelection = checked > 0;
    downloadSelectedBtn.disabled = !hasSelection;
    deselectBtn.disabled = !hasSelection;
}

// ── Download UI ───────────────────────────────────────────

function createDownloadItem(name, isAudio) {
    updateDlCount(+1);

    const item = document.createElement('div');
    item.className = 'download-item';
    item.innerHTML = `
        <div class="dl-header">
            <div class="dl-icon">
                <i class="fas ${isAudio ? 'fa-music' : 'fa-film'}"></i>
            </div>
            <div class="dl-info">
                <div class="dl-name" title="${name}">${name}</div>
                <div class="dl-meta">Starting…</div>
            </div>
            <div class="dl-actions">
                <button class="dl-pause" title="Pause"><i class="fas fa-pause"></i></button>
                <button class="dl-cancel" title="Cancel"><i class="fas fa-xmark"></i></button>
            </div>
        </div>
        <div class="dl-progress-wrap">
            <div class="progress-bar"><div class="progress"></div></div>
            <span class="dl-percent">0%</span>
        </div>
    `;
    downloadsEl.prepend(item);
    return item;
}

function setItemProgress(item, percent, meta, state) {
    const bar     = item.querySelector('.progress');
    const pct     = item.querySelector('.dl-percent');
    const metaEl  = item.querySelector('.dl-meta');
    const iconEl  = item.querySelector('.dl-icon');

    bar.style.width = Math.min(percent, 100) + '%';
    pct.textContent  = Math.round(Math.min(percent, 100)) + '%';
    metaEl.textContent = meta;

    // Reset states
    bar.className = 'progress';
    metaEl.className = 'dl-meta';
    iconEl.className = 'dl-icon';

    if (state === 'done') {
        bar.classList.add('done');
        metaEl.classList.add('success');
        iconEl.classList.add('done');
        iconEl.innerHTML = '<i class="fas fa-check"></i>';
        pct.textContent = '100%';
    } else if (state === 'error') {
        bar.classList.add('error');
        metaEl.classList.add('error');
        iconEl.classList.add('error');
        iconEl.innerHTML = '<i class="fas fa-xmark"></i>';
        pct.textContent = '';
    } else if (state === 'cancelled') {
        bar.classList.add('cancelled');
        metaEl.classList.add('error');
        pct.textContent = '';
    }
}

function startDownload(videoUrl, name, quality, isAudio) {
    const item      = createDownloadItem(name, isAudio);
    const cancelBtn = item.querySelector('.dl-cancel');
    const pauseBtn  = item.querySelector('.dl-pause');

    const params = new URLSearchParams({ url: videoUrl, quality, audio: isAudio, title: name });
    const evtSource = new EventSource(`${API}/api/progress?${params}`);

    let downloadToken = null;
    let cancelled     = false;
    let finished      = false;
    let paused        = false;

    function finish() {
        finished = true;
        item.dataset.finished = 'true';
        pauseBtn.disabled = true;
        updateDlCount(-1);
    }

    function togglePause() {
        if (!downloadToken || finished || cancelled) return;
        paused = !paused;
        if (paused) {
            pauseBtn.innerHTML = '<i class="fas fa-play"></i>';
            pauseBtn.title = 'Resume';
            pauseBtn.classList.add('is-paused');
            item.querySelector('.dl-meta').textContent = 'Paused';
            fetch(`${API}/api/pause`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: downloadToken }),
            }).catch(() => {});
        } else {
            pauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
            pauseBtn.title = 'Pause';
            pauseBtn.classList.remove('is-paused');
            item.querySelector('.dl-meta').textContent = 'Resuming…';
            fetch(`${API}/api/resume`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: downloadToken }),
            }).catch(() => {});
        }
    }

    function cancel() {
        if (cancelled || finished) return;
        cancelled = true;
        // If paused, resume first so the process can be killed cleanly
        if (paused) {
            fetch(`${API}/api/resume`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: downloadToken }),
            }).catch(() => {});
        }
        evtSource.close();
        cancelBtn.disabled = true;
        pauseBtn.disabled  = true;
        setItemProgress(item, 0, 'Cancelled', 'cancelled');
        finish();

        if (downloadToken) {
            fetch(`${API}/api/cancel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: downloadToken }),
            }).catch(() => {});
        }
    }

    pauseBtn.addEventListener('click',  (e) => { e.stopPropagation(); togglePause(); });
    cancelBtn.addEventListener('click', (e) => { e.stopPropagation(); cancel(); });

    evtSource.onmessage = (e) => {
        if (cancelled) return;
        const data = JSON.parse(e.data);

        if (data.started && data.token) {
            downloadToken = data.token;
            return;
        }

        if (data.error) {
            evtSource.close();
            cancelBtn.disabled = true;
            pauseBtn.disabled  = true;
            setItemProgress(item, 0, data.error.replace(/^ERROR:?\s*/i, '').slice(0, 80), 'error');
            finish();
            return;
        }

        if (data.done && data.token) {
            evtSource.close();
            cancelBtn.disabled = true;
            pauseBtn.disabled  = true;
            setItemProgress(item, 100, 'Saving…', null);

            const a = document.createElement('a');
            a.href     = `${API}/api/download?token=${encodeURIComponent(data.token)}`;
            a.download = data.filename || 'video.mp4';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            setTimeout(() => {
                setItemProgress(item, 100, 'Complete', 'done');
                finish();
            }, 800);
            return;
        }

        if (data.percent !== undefined) {
            if (paused) return; // don't overwrite "Paused" label
            const meta = data.speed
                ? `${data.speed}  ·  ETA ${data.eta}`
                : 'Downloading…';
            setItemProgress(item, data.percent, meta, null);
        }
    };

    evtSource.onerror = () => {
        if (cancelled || finished) return;
        evtSource.close();
        cancelBtn.disabled = true;
        pauseBtn.disabled  = true;
        setItemProgress(item, 0, 'Connection lost', 'error');
        finish();
    };
}

// ── Fetch content ─────────────────────────────────────────

async function fetchContent() {
    const url = urlInput.value.trim();
    if (!url) return;

    const isPlaylist = url.includes('list=');

    playlistSection.classList.add('hidden');
    singleSection.classList.add('hidden');
    showShimmer(isPlaylist);
    fetchBtn.disabled = true;

    try {
        const res  = await fetch(`${API}/api/fetch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch');

        if (data.type === 'playlist') {
            showPlaylist(data);
        } else {
            showSingle(data);
        }
    } catch (err) {
        alert('Error: ' + err.message);
    } finally {
        hideShimmers();
        fetchBtn.disabled = false;
    }
}

// ── Range selection ───────────────────────────────────────

function applyRange() {
    const total = currentPlaylist.length;
    const from  = parseInt(rangeFrom.value, 10);
    const to    = parseInt(rangeTo.value, 10);

    // Reset error state
    rangeFrom.classList.remove('input-error');
    rangeTo.classList.remove('input-error');
    rangeError.classList.add('hidden');
    rangeError.textContent = '';

    // Validate
    if (isNaN(from) || isNaN(to)) {
        rangeError.textContent = 'Please enter both values.';
        rangeError.classList.remove('hidden');
        if (isNaN(from)) rangeFrom.classList.add('input-error');
        if (isNaN(to))   rangeTo.classList.add('input-error');
        return;
    }
    if (from < 1 || to < 1) {
        rangeError.textContent = 'Numbers must be 1 or greater.';
        rangeError.classList.remove('hidden');
        if (from < 1) rangeFrom.classList.add('input-error');
        if (to < 1)   rangeTo.classList.add('input-error');
        return;
    }
    if (from > to) {
        rangeError.textContent = '"From" must be less than or equal to "To".';
        rangeError.classList.remove('hidden');
        rangeFrom.classList.add('input-error');
        rangeTo.classList.add('input-error');
        return;
    }
    if (from > total || to > total) {
        rangeError.textContent = `Playlist only has ${total} items.`;
        rangeError.classList.remove('hidden');
        if (from > total) rangeFrom.classList.add('input-error');
        if (to > total)   rangeTo.classList.add('input-error');
        return;
    }

    // Apply — indexes are 0-based, inputs are 1-based
    document.querySelectorAll('.item-checkbox').forEach((cb, idx) => {
        const inRange = idx >= (from - 1) && idx <= (to - 1);
        cb.checked = inRange;
        cb.closest('.playlist-item').classList.toggle('is-checked', inRange);
    });

    updateSelectedCount();

    // Close panel after applying
    rangePanel.classList.add('hidden');
    rangeToggleBtn.classList.remove('active');

    // Scroll list to first selected item
    const firstSelected = playlistItems.querySelector('.playlist-item.is-checked');
    if (firstSelected) firstSelected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ── Event listeners ───────────────────────────────────────

// Format tabs
document.querySelectorAll('.fmt-tab').forEach(btn => {
    btn.addEventListener('click', () => {
        const tabsId = btn.closest('.format-tabs').id;
        const format = btn.dataset.fmt;
        switchFormat(tabsId, format);
    });
});

// Range toggle
rangeToggleBtn.addEventListener('click', () => {
    const open = rangePanel.classList.toggle('hidden');
    rangeToggleBtn.classList.toggle('active', !open);
    if (!open) {
        // opened — set smart defaults
        const total = currentPlaylist.length;
        if (!rangeFrom.value) rangeFrom.value = 1;
        if (!rangeTo.value)   rangeTo.value   = Math.min(10, total);
        rangeFrom.focus();
    } else {
        // closed — clear errors
        rangeFrom.classList.remove('input-error');
        rangeTo.classList.remove('input-error');
        rangeError.classList.add('hidden');
    }
});

// Apply range on button click or Enter key in inputs
rangeApplyBtn.addEventListener('click', applyRange);
rangeFrom.addEventListener('keydown', (e) => { if (e.key === 'Enter') rangeTo.focus(); });
rangeTo.addEventListener('keydown',   (e) => { if (e.key === 'Enter') applyRange(); });

fetchBtn.addEventListener('click', fetchContent);

urlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') fetchContent();
});

selectAllCheckbox.addEventListener('change', () => {
    document.querySelectorAll('.item-checkbox').forEach(cb => {
        cb.checked = selectAllCheckbox.checked;
        cb.closest('.playlist-item').classList.toggle('is-checked', cb.checked);
    });
    updateSelectedCount();
});

deselectBtn.addEventListener('click', () => {
    document.querySelectorAll('.item-checkbox').forEach(cb => {
        cb.checked = false;
        cb.closest('.playlist-item').classList.remove('is-checked');
    });
    selectAllCheckbox.checked = false;
    updateSelectedCount();
});

downloadSelectedBtn.addEventListener('click', () => {
    const checked = document.querySelectorAll('.item-checkbox:checked');
    if (!checked.length) return;

    const quality = getSelectedQuality();
    const isAudio = plFormat === 'audio';

    checked.forEach(cb => {
        const index    = parseInt(cb.id.replace('item-', ''));
        const video    = currentPlaylist[index];
        const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;
        startDownload(videoUrl, video.name, quality, isAudio);
    });

    // Clear selection after queueing all downloads
    document.querySelectorAll('.item-checkbox').forEach(cb => {
        cb.checked = false;
        cb.closest('.playlist-item').classList.remove('is-checked');
    });
    selectAllCheckbox.checked = false;
    updateSelectedCount();
});

downloadSingleBtn.addEventListener('click', () => {
    const quality = getSelectedSingleQuality();
    const isAudio = sqFormat === 'audio';
    startDownload(currentSingleUrl, singleName.textContent, quality, isAudio);
});

// Clear finished downloads (completed, cancelled, errored)
clearHistoryBtn.addEventListener('click', () => {
    const finished = downloadsEl.querySelectorAll('.download-item[data-finished="true"]');
    finished.forEach(item => {
        item.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
        item.style.opacity = '0';
        item.style.transform = 'translateX(12px)';
        setTimeout(() => item.remove(), 200);
    });

    // Show empty state if nothing left
    setTimeout(() => {
        if (!downloadsEl.querySelector('.download-item')) {
            downloadsEmpty.classList.remove('hidden');
        }
    }, 250);
});
