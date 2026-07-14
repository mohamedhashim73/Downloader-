const express = require('express');
const cors = require('cors');
const https = require('https');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

// Track completed downloads: token -> { filePath, filename }
const readyFiles = new Map();

// Track active yt-dlp processes: token -> { proc, tmpPath }
const activeDownloads = new Map();

// ── Cookie management ──────────────────────────────────────────────────────
// Export Chrome cookies once at startup and refresh every 30 min.
// Using a file avoids hitting the locked SQLite DB on every download request.
const COOKIE_FILE = '/tmp/yt-dlp-cookies.txt';
let cookieFileReady = false;

function refreshCookies() {
    return new Promise((resolve) => {
        const proc = execFile('yt-dlp', [
            '--cookies-from-browser', 'chrome',
            '--cookies', COOKIE_FILE,
            '--skip-download',
            '--no-playlist',
            'https://www.youtube.com/',
        ], { timeout: 30000 }, (err) => {
            if (err) {
                console.warn('[cookies] Refresh failed:', err.message.slice(0, 80));
                // Still mark ready if the file already exists from a prior run
                if (fs.existsSync(COOKIE_FILE)) {
                    cookieFileReady = true;
                    console.log('[cookies] Using existing cookie file.');
                }
            } else {
                cookieFileReady = true;
                console.log('[cookies] Cookie file refreshed:', COOKIE_FILE);
            }
            resolve();
        });
    });
}

// Refresh on startup, then every 30 minutes
refreshCookies();
setInterval(refreshCookies, 30 * 60 * 1000);

function getCookieArgs() {
    if (cookieFileReady && fs.existsSync(COOKIE_FILE)) {
        return ['--cookies', COOKIE_FILE];
    }
    // Fallback to live browser read if file not ready yet
    return ['--cookies-from-browser', 'chrome'];
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cookie': 'CONSENT=PENDING+987; SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg',
};

function httpGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: HEADERS }, res => {
            let buf = '';
            res.on('data', d => buf += d);
            res.on('end', () => resolve(buf));
        }).on('error', reject);
    });
}

function httpPost(url, body) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const u = new URL(url);
        const req = https.request({
            hostname: u.hostname,
            path: u.pathname + u.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
                ...HEADERS,
                'Origin': 'https://www.youtube.com',
                'Referer': 'https://www.youtube.com/',
            }
        }, res => {
            let buf = '';
            res.on('data', d => buf += d);
            res.on('end', () => { try { resolve(JSON.parse(buf)); } catch(e) { resolve(null); } });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

function extractJson(html, marker) {
    const start = html.indexOf(marker);
    if (start === -1) return null;
    const jsonStart = start + marker.length;
    let depth = 0;
    for (let i = jsonStart; i < html.length; i++) {
        if (html[i] === '{') depth++;
        if (html[i] === '}') depth--;
        if (depth === 0) return JSON.parse(html.substring(jsonStart, i + 1));
    }
    return null;
}

function walkForLockups(obj, results) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
        for (const item of obj) walkForLockups(item, results);
        return;
    }
    if (obj.lockupViewModel && obj.lockupViewModel.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') {
        const lv = obj.lockupViewModel;
        const id = lv.contentId;
        const title = lv.metadata?.lockupMetadataViewModel?.title?.content || 'Untitled';
        const thumbSources = lv.contentImage?.thumbnailViewModel?.image?.sources;
        const thumbnail = thumbSources?.[0]?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
        results.push({ id, name: title, thumbnail, duration: '' });
        return;
    }
    if (obj.playlistVideoRenderer) {
        const pv = obj.playlistVideoRenderer;
        const id = pv.id;
        const title = pv.title?.runs?.[0]?.text || 'Untitled';
        const duration = pv.lengthText?.simpleText || '';
        const thumb = pv.thumbnail?.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
        results.push({ id, name: title, thumbnail: thumb, duration });
        return;
    }
    for (const key of Object.keys(obj)) {
        walkForLockups(obj[key], results);
    }
}

function findContinuationToken(obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (Array.isArray(obj)) {
        for (const item of obj) {
            const found = findContinuationToken(item);
            if (found) return found;
        }
        return null;
    }
    if (obj.continuationItemRenderer) {
        return obj.continuationItemRenderer.continuationEndpoint?.continuationCommand?.token || null;
    }
    for (const key of Object.keys(obj)) {
        const found = findContinuationToken(obj[key]);
        if (found) return found;
    }
    return null;
}

function findMetadataRecursive(obj, key) {
    if (!obj || typeof obj !== 'object') return null;
    if (Array.isArray(obj)) {
        for (const item of obj) {
            const found = findMetadataRecursive(item, key);
            if (found) return found;
        }
        return null;
    }
    if (obj[key] !== undefined) return obj[key];
    for (const k of Object.keys(obj)) {
        const found = findMetadataRecursive(obj[k], key);
        if (found) return found;
    }
    return null;
}

async function fetchPlaylistData(url) {
    const playlistId = url.match(/list=([^&]+)/)?.[1];
    if (!playlistId) throw new Error('Invalid playlist URL');

    const html = await httpGet(`https://www.youtube.com/playlist?list=${playlistId}`);

    const data = extractJson(html, 'var ytInitialData = ');
    if (!data) throw new Error('Could not parse page data');

    // Extract title
    const playlistMeta = findMetadataRecursive(data, 'playlistMetadataRenderer');
    const title = playlistMeta?.title || 'Playlist';

    // Extract visitor data and API key
    const visitorMatch = html.match(/"visitorData":"([^"]+)"/);
    const visitorData = visitorMatch ? visitorMatch[1] : '';
    const apiKeyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
    const apiKey = apiKeyMatch ? apiKeyMatch[1] : 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
    const clientVersionMatch = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/);
    const clientVersion = clientVersionMatch ? clientVersionMatch[1] : '2.20241001.00.00';

    // Extract videos from initial data
    let videos = [];
    walkForLockups(data, videos);

    // Find and fetch continuation for remaining videos
    let contToken = findContinuationToken(data);
    let maxPages = 50;
    const seenIds = new Set(videos.map(v => v.id));

    while (contToken && maxPages-- > 0) {
        const resp = await httpPost(
            `https://www.youtube.com/youtubei/v1/browse?key=${apiKey}`,
            {
                context: {
                    client: {
                        hl: 'en',
                        gl: 'US',
                        clientName: 'WEB',
                        clientVersion,
                        visitorData,
                    }
                },
                continuation: contToken,
            }
        );

        if (!resp || resp.error) break;

        const newVideos = [];
        walkForLockups(resp, newVideos);

        let foundNew = false;
        for (const v of newVideos) {
            if (!seenIds.has(v.id)) {
                seenIds.add(v.id);
                videos.push(v);
                foundNew = true;
            }
        }

        contToken = findContinuationToken(resp);
        if (!foundNew && !contToken) break;
    }

    // Add index
    videos = videos.map((v, i) => ({ ...v, index: i }));

    return { title, videos, totalCount: videos.length };
}

async function fetchSingleData(url) {
    const videoId = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1];
    if (!videoId) throw new Error('Invalid video URL');

    const html = await httpGet(`https://www.youtube.com/watch?v=${videoId}`);

    const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/);
    const name = titleMatch
        ? titleMatch[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
        : 'Untitled';

    const thumbMatch = html.match(/<meta property="og:image" content="([^"]+)"/);
    const thumbnail = thumbMatch ? thumbMatch[1] : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    const durMatch = html.match(/"lengthSeconds":"(\d+)"/);
    let duration = '';
    if (durMatch) {
        const secs = parseInt(durMatch[1]);
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        const s = secs % 60;
        duration = h > 0
            ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
            : `${m}:${s.toString().padStart(2, '0')}`;
    }

    return { id: videoId, name, duration, thumbnail };
}

app.post('/api/fetch', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'URL required' });

        const isPlaylist = url.includes('list=');

        if (isPlaylist) {
            const result = await fetchPlaylistData(url);
            return res.json({
                type: 'playlist',
                title: result.title,
                count: result.videos.length,
                videos: result.videos,
            });
        } else {
            const result = await fetchSingleData(url);
            return res.json({
                type: 'single',
                ...result,
            });
        }
    } catch (err) {
        console.error('Fetch error:', err.message);
        res.status(500).json({ error: err.message || 'Failed to fetch' });
    }
});

// Sanitize title for use in a filename
function safeFilename(title) {
    return title.replace(/[\/\\:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

// Phase 1: download to /tmp with real progress via SSE
// When done, stores the file path keyed by a token and sends { done: true, token }
app.get('/api/progress', (req, res) => {
    const { url, quality, audio, title } = req.query;
    if (!url) return res.status(400).json({ error: 'URL required' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const isAudio = audio === 'true';
    const q = quality || '720';
    const ext = isAudio ? 'mp3' : 'mp4';

    // Use a unique tmp path per request
    const token = Date.now() + '-' + Math.random().toString(36).slice(2);
    const tmpPath = `/tmp/ytdl-${token}.${ext}`;

    // Cookie args — use pre-exported file (avoids locked Chrome DB during downloads)
    const cookieArgs = getCookieArgs();

    let args;
    if (isAudio) {
        args = [
            '--no-playlist',
            '-f', 'bestaudio/best',
            '--extract-audio',
            '--audio-format', 'mp3',
            '--audio-quality', '0',
            ...cookieArgs,
            '--extractor-retries', '3',
            '--fragment-retries', '3',
            '--retry-sleep', '2',
            '--newline',
            '--progress',
            '-o', tmpPath,
            url,
        ];
    } else {
        const formatArg = `bestvideo[height<=${q}]+bestaudio/best[height<=${q}]/best`;
        args = [
            '--no-playlist',
            '-f', formatArg,
            '--merge-output-format', 'mp4',
            ...cookieArgs,
            '--extractor-retries', '3',
            '--fragment-retries', '3',
            '--retry-sleep', '2',
            '--newline',
            '--progress',
            '-o', tmpPath,
            url,
        ];
    }

    const proc = spawn('yt-dlp', args);

    // Register process so it can be cancelled via /api/cancel
    activeDownloads.set(token, { proc, tmpPath });

    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    // Send the token immediately so the client can cancel before download finishes
    send({ started: true, token });

    let destinationCount = 0;
    // Buffer lines that arrived before we knew if it's a two-part download
    let pendingLines = [];
    let knewTwoPart = false;

    proc.stdout.on('data', d => {
        const lines = d.toString().split('\n');
        for (const line of lines) {
            if (line.includes('[download] Destination:')) {
                destinationCount++;
                if (destinationCount >= 2 && !knewTwoPart) {
                    knewTwoPart = true;
                    // Re-emit any buffered first-pass lines correctly as 0–50%
                    for (const buffered of pendingLines) {
                        const bm = buffered.match(/(\d+\.?\d*)%.*?ETA\s+(\S+)/);
                        if (bm) {
                            const bSpeed = buffered.match(/at\s+(\S+\/s)/);
                            send({
                                percent: parseFloat(bm[1]) / 2,
                                speed: bSpeed ? bSpeed[1] : '',
                                eta: bm[2],
                            });
                        }
                    }
                    pendingLines = [];
                }
                continue;
            }

            const m = line.match(/(\d+\.?\d*)%.*?ETA\s+(\S+)/);
            if (!m) continue;

            const raw = parseFloat(m[1]);
            const speedM = line.match(/at\s+(\S+\/s)/);

            if (isAudio) {
                // Single-stream audio — straight 0–100%
                send({ percent: raw, speed: speedM ? speedM[1] : '', eta: m[2] });
            } else if (destinationCount <= 1 && !knewTwoPart) {
                // Don't know yet if two-part — buffer instead of emitting
                pendingLines.push(line);
            } else if (!knewTwoPart) {
                // Single-part video confirmed (only 1 destination, download finished)
                send({ percent: raw, speed: speedM ? speedM[1] : '', eta: m[2] });
            } else if (destinationCount === 1) {
                // First part of two-part (video): map to 0–50%
                send({ percent: raw / 2, speed: speedM ? speedM[1] : '', eta: m[2] });
            } else {
                // Second part of two-part (audio): map to 50–100%
                send({ percent: 50 + raw / 2, speed: speedM ? speedM[1] : '', eta: m[2] });
            }
        }
    });

    proc.stderr.on('data', d => {
        const txt = d.toString();
        console.error('[yt-dlp stderr]', txt.trim());
        if (txt.includes('ERROR')) {
            let msg = txt.trim();
            if (msg.includes('403')) {
                msg = 'Access denied (403). YouTube blocked this video. Try opening YouTube in Chrome and signing in, then retry.';
            } else {
                msg = msg.replace(/^.*ERROR[:\s]*/i, '').slice(0, 120);
            }
            send({ error: msg });
        }
    });

    proc.on('close', code => {
        activeDownloads.delete(token);

        // Flush any buffered single-part progress lines (never got a 2nd destination)
        if (!knewTwoPart && pendingLines.length > 0) {
            for (const buffered of pendingLines) {
                const bm = buffered.match(/(\d+\.?\d*)%.*?ETA\s+(\S+)/);
                if (bm) {
                    const bSpeed = buffered.match(/at\s+(\S+\/s)/);
                    send({ percent: parseFloat(bm[1]), speed: bSpeed ? bSpeed[1] : '', eta: bm[2] });
                }
            }
            pendingLines = [];
        }

        if (code === 0 && fs.existsSync(tmpPath)) {
            // Build the nice display filename: "Title [720p].mp4"
            const label = isAudio ? 'audio' : `${q}p`;
            const base = title ? safeFilename(title) : `video`;
            const filename = `${base} [${label}].${ext}`;

            // Store so /api/download can serve it
            readyFiles.set(token, { filePath: tmpPath, filename });

            // Auto-clean after 10 minutes
            setTimeout(() => {
                readyFiles.delete(token);
                fs.unlink(tmpPath, () => {});
            }, 10 * 60 * 1000);

            send({ done: true, token, filename });
        } else {
            send({ error: `yt-dlp exited with code ${code}` });
        }
        res.end();
    });

    proc.on('error', err => {
        activeDownloads.delete(token);
        send({ error: 'yt-dlp not found: ' + err.message });
        res.end();
    });

    req.on('close', () => {
        activeDownloads.delete(token);
        proc.kill();
    });
});

// Pause an active download
app.post('/api/pause', (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token required' });
    const active = activeDownloads.get(token);
    if (active && !active.paused) {
        try {
            active.proc.kill('SIGSTOP');
            active.paused = true;
        } catch (e) { /* ignore */ }
    }
    res.json({ ok: true });
});

// Resume a paused download
app.post('/api/resume', (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token required' });
    const active = activeDownloads.get(token);
    if (active && active.paused) {
        try {
            active.proc.kill('SIGCONT');
            active.paused = false;
        } catch (e) { /* ignore */ }
    }
    res.json({ ok: true });
});

// Cancel an active download
app.post('/api/cancel', (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token required' });

    const active = activeDownloads.get(token);
    if (active) {
        active.proc.kill();
        activeDownloads.delete(token);
        fs.unlink(active.tmpPath, () => {});
    }

    // Also clean up if it somehow made it to readyFiles
    const ready = readyFiles.get(token);
    if (ready) {
        readyFiles.delete(token);
        fs.unlink(ready.filePath, () => {});
    }

    res.json({ ok: true });
});

// Phase 2: serve the already-downloaded file from /tmp
app.get('/api/download', (req, res) => {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Token required' });

    const entry = readyFiles.get(token);
    if (!entry) return res.status(404).json({ error: 'File not found or expired' });

    const { filePath, filename } = entry;

    if (!fs.existsSync(filePath)) {
        readyFiles.delete(token);
        return res.status(404).json({ error: 'File missing from disk' });
    }

    const stat = fs.statSync(filePath);
    const ext = path.extname(filename).slice(1);
    const mime = ext === 'mp3' ? 'audio/mpeg' : 'video/mp4';
    const fileSize = stat.size;

    // RFC 5987 encoding handles Unicode (Arabic etc.) and special chars like [ ] in Chrome
    const encodedFilename = encodeURIComponent(filename).replace(/'/g, '%27');
    const asciiFilename = filename.replace(/[^\x20-\x7E]/g, '_');
    const contentDisposition = `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`;

    const rangeHeader = req.headers['range'];

    if (rangeHeader) {
        // Handle partial content / resume requests from Chrome
        const parts = rangeHeader.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = end - start + 1;

        res.writeHead(206, {
            'Content-Type': mime,
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkSize,
            'Content-Disposition': contentDisposition,
        });

        const stream = fs.createReadStream(filePath, { start, end });
        stream.pipe(res);
        stream.on('error', err => console.error('Stream error:', err.message));
    } else {
        res.writeHead(200, {
            'Content-Type': mime,
            'Content-Length': fileSize,
            'Accept-Ranges': 'bytes',
            'Content-Disposition': contentDisposition,
        });

        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
        stream.on('error', err => {
            console.error('Stream error:', err.message);
        });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
