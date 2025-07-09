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

        // Menggunakan puppeteer-real-browser untuk koneksi ke browser
        // Konfigurasi disesuaikan dengan variabel lingkungan Dockerfile
        const { browser } = await connect({
            headless: 'new', // Penting: Memaksa mode headless baru untuk lingkungan Docker
            // Mengambil jalur executable dari variabel lingkungan yang diatur di Dockerfile
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
            // Meneruskan argumen tambahan yang didefinisikan di Dockerfile
            args: process.env.PUPPETEER_ARGS ? process.env.PUPPETEER_ARGS.split(' ') : [],
            // turnstile: true, // Dihapus karena dapat menyebabkan konflik dengan mode headless di Docker
            connectOption: { defaultViewport: null },
            // disableXvfb: true, // Dapat dihapus jika headless sudah diatur ke 'new'
            // Menambahkan argumen untuk menghindari deteksi otomatis
            ignoreDefaultArgs: ["--enable-automation"]
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
            // Mencoba lagi setelah jeda
            console.log(`Retrying (${retry + 1}/5)...`);
            await new Promise((resolve) => setTimeout(resolve, 3000));
            await createBrowser(retry + 1);
            return;
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
            await createBrowser(); // Mencoba meluncurkan ulang browser
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
        // Mencoba lagi setelah jeda
        console.log(`Retrying (${retry + 1}/5)...`);
        await new Promise((resolve) => setTimeout(resolve, 3000));
        await createBrowser(retry + 1);
    }
}

// Menangani sinyal SIGINT (misalnya, Ctrl+C) untuk membersihkan browser
process.on('SIGINT', async () => {
    console.log('Received SIGINT, cleaning up...');
    global.finished = true; // Menandai bahwa proses akan selesai

    if (global.browser) {
        try {
            // Menutup semua konteks browser yang terbuka
            if (global.browserContexts) {
                for (const context of global.browserContexts) {
                    await context.close().catch(() => {});
                }
            }
            // Menutup instance browser utama
            await global.browser.close().catch(() => {});
        } catch (e) {
            console.error("Error during cleanup:", e.message);
        }
    }

    process.exit(0); // Keluar dari proses
});

// Meluncurkan browser secara otomatis saat skrip dimulai, kecuali diabaikan oleh variabel lingkungan
if (process.env.SKIP_LAUNCH !== 'true') {
    createBrowser();
}
