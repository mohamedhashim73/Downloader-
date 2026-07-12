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
const downloadSingleBtn   = document.getElementById('download-single-btn');
const downloadsEl    = document.getElementById('downloads');
const downloadsEmpty = document.getElementById('downloads-empty');
const dlCountBadge   = document.getElementById('dl-count');
const singleName     = document.getElementById('single-name');
const singleThumb    = document.getElementById('single-thumb');

const API = 'http://localhost:3000';

let currentPlaylist  = [];
let currentSingleUrl = '';
let dlCount = 0;

// ── Helpers ──────────────────────────────────────────────

function getSelectedQuality() {
    const el = document.querySelector('input[name="quality"]:checked');
    return el ? el.value : '720';
}

function getSelectedSingleQuality() {
    const el = document.querySelector('input[name="single-quality"]:checked');
    return el ? el.value : '720';
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
    dlCountBadge.textContent = dlCount;
    if (dlCount > 0) {
        downloadsEmpty.classList.add('hidden');
    } else {
        downloadsEmpty.classList.remove('hidden');
    }
}

// ── Playlist / Single display ─────────────────────────────

function showPlaylist(data) {
    currentPlaylist = data.videos;
    playlistItems.innerHTML = '';
    totalCount.textContent  = data.count;
    selectedCount.textContent = '0';
    selectAllCheckbox.checked = false;

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
            <button class="dl-cancel" title="Cancel"><i class="fas fa-xmark"></i></button>
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

    const params = new URLSearchParams({ url: videoUrl, quality, audio: isAudio, title: name });
    const evtSource = new EventSource(`${API}/api/progress?${params}`);

    let downloadToken = null;
    let cancelled     = false;
    let finished      = false;

    function finish() {
        finished = true;
        updateDlCount(-1);
    }

    function cancel() {
        if (cancelled || finished) return;
        cancelled = true;
        evtSource.close();
        cancelBtn.disabled = true;
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

    cancelBtn.addEventListener('click', (e) => { e.stopPropagation(); cancel(); });

    evtSource.onmessage = (e) => {
        if (cancelled) return;
        const data = JSON.parse(e.data);

        // Token received — cancel is now live
        if (data.started && data.token) {
            downloadToken = data.token;
            return;
        }

        if (data.error) {
            evtSource.close();
            cancelBtn.disabled = true;
            setItemProgress(item, 0, data.error.replace(/^ERROR:?\s*/i, '').slice(0, 80), 'error');
            finish();
            return;
        }

        if (data.done && data.token) {
            evtSource.close();
            cancelBtn.disabled = true;
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

// ── Event listeners ───────────────────────────────────────

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
    const isAudio = quality === 'audio';

    checked.forEach(cb => {
        const index    = parseInt(cb.id.replace('item-', ''));
        const video    = currentPlaylist[index];
        const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;
        startDownload(videoUrl, video.name, isAudio ? '0' : quality, isAudio);
    });
});

downloadSingleBtn.addEventListener('click', () => {
    const quality = getSelectedSingleQuality();
    const isAudio = quality === 'audio';
    startDownload(currentSingleUrl, singleName.textContent, isAudio ? '0' : quality, isAudio);
});
