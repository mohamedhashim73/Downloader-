const puppeteer = require('puppeteer-core');

(async () => {
    const b = await puppeteer.launch({
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });
    const page = await b.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');

    const apiData = [];
    page.on('response', async (res) => {
        const u = res.url();
        if (u.includes('/youtubei/') && (u.includes('/browse') || u.includes('/next'))) {
            try { const j = await res.json(); apiData.push(j); } catch(e) {}
        }
    });

    await page.goto('https://www.youtube.com/playlist?list=PL-osiE80TeTsWmV9i9c58adDC7SK5dcB5', { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 5000));

    const debug = await page.evaluate(() => {
        const d = window.ytInitialData;
        if (!d) return { err: 'no data' };
        const str = JSON.stringify(d);
        return {
            len: str.length,
            hasContentId: str.includes('contentId'),
            hasLockup: str.includes('lockupViewModel'),
            hasPV: str.includes('playlistVideoRenderer'),
            body: document.body.innerText.substring(0, 500),
        };
    });

    console.log('Debug:', JSON.stringify(debug, null, 2));
    console.log('API responses:', apiData.length);
    for (const a of apiData) {
        const s = JSON.stringify(a);
        console.log('  len:', s.length, 'lockup:', s.includes('lockupViewModel'), 'PV:', s.includes('playlistVideoRenderer'));
    }

    await b.close();
})();
