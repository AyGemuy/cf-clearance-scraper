// Mengimpor modul yang diperlukan
const { connect } = require("puppeteer-real-browser");

/**
 * Fungsi untuk membuat dan mengelola instance browser Puppeteer.
 * Fungsi ini menangani peluncuran browser, penanganan koneksi terputus,
 * dan mekanisme percobaan ulang.
 *
 * @param {number} retry - Jumlah percobaan ulang saat meluncurkan browser.
 */
async function createBrowser(retry = 0) {
    try {
        // Mencegah peluncuran browser jika proses sudah selesai atau browser sudah ada
        if (global.finished || global.browser) {
            return;
        }

        console.log("Launching browser...");

        // Tunggu sebentar untuk memastikan Xvfb sudah siap
        await new Promise(resolve => setTimeout(resolve, 2000));

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
            '--remote-debugging-port=9222',
            '--remote-debugging-address=0.0.0.0'
        ];

        // Menambahkan argumen dari environment variable jika ada
        if (process.env.PUPPETEER_ARGS) {
            const envArgs = process.env.PUPPETEER_ARGS.split(' ').filter(arg => arg.trim());
            browserArgs.push(...envArgs);
        }

        // Menggunakan puppeteer-real-browser untuk koneksi ke browser
        const { browser } = await connect({
            headless: 'new', // Penting: Memaksa mode headless baru untuk lingkungan Docker
            // Mengambil jalur executable dari variabel lingkungan yang diatur di Dockerfile
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
            // Menggunakan argumen yang sudah dioptimalkan
            args: browserArgs,
            connectOption: { 
                defaultViewport: null,
                // Menambahkan timeout yang lebih lama untuk koneksi
                timeout: 30000
            },
            // Mengaktifkan disableXvfb untuk menghindari konflik dengan Xvfb yang sudah berjalan
            disableXvfb: true,
            // Menambahkan argumen untuk menghindari deteksi otomatis
            ignoreDefaultArgs: ["--enable-automation"],
            // Menambahkan opsi untuk debugging jika diperlukan
            dumpio: process.env.NODE_ENV === 'development'
        }).catch(e => {
            // Menangkap kesalahan koneksi browser dan mencatatnya
            console.error("Error launching browser:", e.message);
            console.error("Full error:", e);
            return { browser: null }; // Mengembalikan null browser untuk penanganan kesalahan lebih lanjut
        });

        // Memeriksa apakah koneksi browser berhasil
        if (!browser) {
            console.error("Failed to connect to browser");
            // Jika percobaan ulang melebihi batas, hentikan
            if (retry >= 5) {
                console.log("Max retries reached. Stopping browser launch attempts.");
                return;
            }
            // Mencoba lagi setelah jeda yang lebih lama
            console.log(`Retrying (${retry + 1}/5)...`);
            await new Promise((resolve) => setTimeout(resolve, 5000));
            await createBrowser(retry + 1);
            return;
        }

        // Test koneksi browser dengan membuat halaman sederhana
        try {
            const testPage = await browser.newPage();
            await testPage.goto('about:blank');
            await testPage.close();
            console.log("Browser connection test successful.");
        } catch (testError) {
            console.error("Browser connection test failed:", testError.message);
            throw testError;
        }

        // Menyimpan instance browser global
        global.browser = browser;

        // Menangani peristiwa pemutusan koneksi browser
        browser.on("disconnected", async () => {
            // Mencegah restart jika proses sudah selesai
            if (global.finished) {
                return;
            }
            console.log("Browser disconnected. Restarting...");
            global.browser = null; // Menyetel browser ke null agar instance baru dibuat
            // Tunggu sebentar sebelum restart
            await new Promise(resolve => setTimeout(resolve, 2000));
            await createBrowser(); // Mencoba meluncurkan ulang browser
        });

        // Menangani error pada browser
        browser.on("error", (error) => {
            console.error("Browser error:", error.message);
        });

        console.log("Browser launched successfully.");

    } catch (e) {
        // Menangkap kesalahan umum selama pembuatan browser
        console.error("Error launching browser:", e.stack);

        // Jika proses sudah selesai atau percobaan ulang melebihi batas, hentikan
        if (global.finished || retry >= 5) {
            console.log("Max retries reached. Stopping browser launch attempts.");
            return;
        }
        // Mencoba lagi setelah jeda yang lebih lama
        console.log(`Retrying (${retry + 1}/5)...`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
        await createBrowser(retry + 1);
    }
}

// Fungsi untuk memeriksa apakah Xvfb sudah siap
async function waitForXvfb() {
    const { spawn } = require('child_process');
    
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Timeout waiting for Xvfb'));
        }, 30000);

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
    global.finished = true; // Menandai bahwa proses akan selesai

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

// Menangani sinyal SIGINT (misalnya, Ctrl+C) untuk membersihkan browser
process.on('SIGINT', async () => {
    console.log('Received SIGINT, cleaning up...');
    await cleanup();
    process.exit(0); // Keluar dari proses
});

// Menangani sinyal SIGTERM untuk pembersihan yang graceful
process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, cleaning up...');
    await cleanup();
    process.exit(0);
});

// Menangani uncaught exception
process.on('uncaughtException', async (error) => {
    console.error('Uncaught Exception:', error);
    await cleanup();
    process.exit(1);
});

// Menangani unhandled promise rejection
process.on('unhandledRejection', async (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    await cleanup();
    process.exit(1);
});

// Meluncurkan browser secara otomatis saat skrip dimulai, kecuali diabaikan oleh variabel lingkungan
if (process.env.SKIP_LAUNCH !== 'true') {
    // Tunggu Xvfb siap sebelum meluncurkan browser
    waitForXvfb()
        .then(() => createBrowser())
        .catch((error) => {
            console.error('Failed to wait for Xvfb:', error.message);
            // Tetap coba launch browser meskipun Xvfb check gagal
            createBrowser();
        });
}

// Export fungsi untuk digunakan di modul lain
module.exports = { createBrowser, cleanup };
