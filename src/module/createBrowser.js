// Mengimpor modul yang diperlukan
const { connect } = require("puppeteer-real-browser");
const puppeteer = require("puppeteer");

/**
 * Fungsi untuk membuat dan mengelola instance browser Puppeteer.
 * Menggunakan fallback dari puppeteer-real-browser ke puppeteer biasa.
 *
 * @param {number} retry - Jumlah percobaan ulang saat meluncurkan browser.
 * @param {boolean} useStandardPuppeteer - Gunakan puppeteer standar sebagai fallback.
 */
async function createBrowser(retry = 0, useStandardPuppeteer = false) {
    try {
        // Mencegah peluncuran browser jika proses sudah selesai atau browser sudah ada
        if (global.finished || global.browser) {
            return;
        }

        console.log(`Launching browser${useStandardPuppeteer ? ' (using standard puppeteer)' : ''}...`);

        // Tunggu sebentar untuk memastikan Xvfb sudah siap
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Konfigurasi argumen browser yang dioptimalkan untuk Docker
        const browserArgs = [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-features=TranslateUI',
            '--disable-blink-features=AutomationControlled',
            '--disable-extensions',
            '--disable-plugins',
            '--disable-default-apps',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-gpu',
            '--display=:99',
            '--disable-software-rasterizer',
            '--disable-background-networking',
            '--disable-background-media-suspend',
            '--disable-client-side-phishing-detection',
            '--disable-sync',
            '--disable-translate',
            '--hide-scrollbars',
            '--metrics-recording-only',
            '--mute-audio',
            '--no-default-browser-check',
            '--no-pings',
            '--password-store=basic',
            '--use-mock-keychain',
            '--disable-component-extensions-with-background-pages',
            '--disable-default-apps',
            '--disable-extensions'
        ];

        // Menambahkan argumen dari environment variable jika ada
        if (process.env.PUPPETEER_ARGS) {
            const envArgs = process.env.PUPPETEER_ARGS.split(' ').filter(arg => arg.trim());
            browserArgs.push(...envArgs);
        }

        let browser;

        if (useStandardPuppeteer) {
            // Menggunakan puppeteer standar sebagai fallback
            browser = await puppeteer.launch({
                headless: 'new',
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
                args: browserArgs,
                ignoreDefaultArgs: ["--enable-automation"],
                defaultViewport: null,
                timeout: 60000,
                handleSIGINT: false,
                handleSIGTERM: false,
                handleSIGHUP: false,
                dumpio: process.env.NODE_ENV === 'development'
            });
        } else {
            // Menggunakan puppeteer-real-browser
            const result = await connect({
                headless: 'new',
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
                args: browserArgs,
                connectOption: { 
                    defaultViewport: null,
                    timeout: 60000
                },
                disableXvfb: true,
                ignoreDefaultArgs: ["--enable-automation"],
                dumpio: process.env.NODE_ENV === 'development',
                userDataDir: '/tmp/puppeteer_dev_profile',
                slowMo: process.env.NODE_ENV === 'development' ? 100 : 0
            }).catch(e => {
                console.error("Error launching browser with puppeteer-real-browser:", e.message);
                return { browser: null };
            });

            browser = result ? result.browser : null;
        }

        // Memeriksa apakah koneksi browser berhasil
        if (!browser) {
            console.error("Failed to connect to browser");
            
            // Jika menggunakan puppeteer-real-browser dan gagal, coba dengan puppeteer standar
            if (!useStandardPuppeteer && retry < 3) {
                console.log("Trying with standard puppeteer...");
                await new Promise((resolve) => setTimeout(resolve, 2000));
                return await createBrowser(retry + 1, true);
            }
            
            // Jika percobaan ulang melebihi batas, hentikan
            if (retry >= 5) {
                console.log("Max retries reached. Stopping browser launch attempts.");
                return;
            }
            
            // Mencoba lagi setelah jeda yang lebih lama
            console.log(`Retrying (${retry + 1}/5)...`);
            await new Promise((resolve) => setTimeout(resolve, 5000));
            await createBrowser(retry + 1, useStandardPuppeteer);
            return;
        }

        // Test koneksi browser dengan membuat halaman sederhana
        try {
            const testPage = await browser.newPage();
            await testPage.goto('about:blank', { waitUntil: 'networkidle0', timeout: 30000 });
            await testPage.close();
            console.log("Browser connection test successful.");
        } catch (testError) {
            console.error("Browser connection test failed:", testError.message);
            
            // Jika test gagal, coba dengan puppeteer standar
            if (!useStandardPuppeteer && retry < 3) {
                console.log("Browser test failed, trying with standard puppeteer...");
                await browser.close().catch(() => {});
                await new Promise((resolve) => setTimeout(resolve, 2000));
                return await createBrowser(retry + 1, true);
            }
            
            throw testError;
        }

        // Menyimpan instance browser global
        global.browser = browser;
        global.useStandardPuppeteer = useStandardPuppeteer;

        // Menangani peristiwa pemutusan koneksi browser
        browser.on("disconnected", async () => {
            // Mencegah restart jika proses sudah selesai
            if (global.finished) {
                return;
            }
            console.log("Browser disconnected. Restarting...");
            global.browser = null;
            // Tunggu sebentar sebelum restart
            await new Promise(resolve => setTimeout(resolve, 3000));
            await createBrowser(0, global.useStandardPuppeteer);
        });

        // Menangani error pada browser
        browser.on("error", (error) => {
            console.error("Browser error:", error.message);
        });

        console.log(`Browser launched successfully${useStandardPuppeteer ? ' (using standard puppeteer)' : ' (using puppeteer-real-browser)'}.`);

    } catch (e) {
        console.error("Error launching browser:", e.stack);

        // Jika menggunakan puppeteer-real-browser dan gagal, coba dengan puppeteer standar
        if (!useStandardPuppeteer && retry < 3) {
            console.log("Switching to standard puppeteer due to error...");
            await new Promise((resolve) => setTimeout(resolve, 2000));
            return await createBrowser(retry + 1, true);
        }

        // Jika proses sudah selesai atau percobaan ulang melebihi batas, hentikan
        if (global.finished || retry >= 5) {
            console.log("Max retries reached. Stopping browser launch attempts.");
            return;
        }
        
        // Mencoba lagi setelah jeda yang lebih lama
        console.log(`Retrying (${retry + 1}/5)...`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
        await createBrowser(retry + 1, useStandardPuppeteer);
    }
}

// Fungsi untuk memeriksa apakah Xvfb sudah siap
async function waitForXvfb() {
    const { spawn } = require('child_process');
    
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            console.log('Xvfb check timeout, continuing anyway...');
            resolve(); // Resolve instead of reject untuk continue
        }, 15000);

        const checkDisplay = () => {
            const xdpyinfo = spawn('xdpyinfo', ['-display', ':99']);
            
            xdpyinfo.on('close', (code) => {
                if (code === 0) {
                    clearTimeout(timeout);
                    console.log('Xvfb is ready');
                    resolve();
                } else {
                    setTimeout(checkDisplay, 1000);
                }
            });
            
            xdpyinfo.on('error', () => {
                setTimeout(checkDisplay, 1000);
            });
        };
        
        checkDisplay();
    });
}

// Fungsi untuk cleanup yang lebih robust
async function cleanup() {
    console.log('Cleaning up browser resources...');
    global.finished = true;

    if (global.browser) {
        try {
            // Menutup semua konteks browser yang terbuka
            if (global.browserContexts) {
                for (const context of global.browserContexts) {
                    await context.close().catch(() => {});
                }
            }
            
            // Menutup semua halaman yang terbuka
            const pages = await global.browser.pages();
            for (const page of pages) {
                await page.close().catch(() => {});
            }
            
            // Menutup instance browser utama
            await global.browser.close().catch(() => {});
        } catch (e) {
            console.error("Error during cleanup:", e.message);
        }
    }
}

// Menangani berbagai sinyal untuk cleanup
process.on('SIGINT', async () => {
    console.log('Received SIGINT, cleaning up...');
    await cleanup();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, cleaning up...');
    await cleanup();
    process.exit(0);
});

process.on('uncaughtException', async (error) => {
    console.error('Uncaught Exception:', error);
    await cleanup();
    process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    await cleanup();
    process.exit(1);
});

// Meluncurkan browser secara otomatis saat skrip dimulai
if (process.env.SKIP_LAUNCH !== 'true') {
    waitForXvfb()
        .then(() => {
            // Coba dengan puppeteer-real-browser dulu, fallback ke puppeteer standar
            createBrowser(0, false);
        })
        .catch((error) => {
            console.error('Failed to wait for Xvfb:', error.message);
            // Tetap coba launch browser meskipun Xvfb check gagal
            createBrowser(0, false);
        });
}

// Export fungsi untuk digunakan di modul lain
module.exports = { createBrowser, cleanup };
