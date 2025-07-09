//const puppeteer = require("puppeteer-core");
const { connect } = require("puppeteer-real-browser")

async function createBrowser(retry = 0) {
  try {
    if (global.finished || global.browser) return;

    console.log("Launching browser...");
    
    /*const browser = await puppeteer.launch({
      headless: false,
      args: ["--no-sandbox", "--disable-gpu"],
    });*/


    const { browser } = await connect({
      headless: 'auto',
    args: ['--no-first-run'],
    fingerprint: true,
    turnstile: true,
      connectOption: { defaultViewport: null },
      disableXvfb: true,
    })

    global.browser = browser;

    browser.on("disconnected", async () => {
      if (global.finished) return;
      console.log("Browser disconnected. Restarting...");
      global.browser = null;
      await createBrowser();
    });

    console.log("Browser launched successfully.");

  } catch (e) {
    console.error("Error launching browser:", e.stack);
    
    if (global.finished || retry >= 5) return; // Maksimal 5 kali retry
    console.log(`Retrying (${retry + 1}/5)...`);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await createBrowser(retry + 1);
  }
}

createBrowser();
