async function getSource({ url, proxy }) {
  return new Promise(async (resolve, reject) => {
    if (!url) return reject("Missing url parameter");
    let isResolved = false;
    
    const context = await global.browser.createBrowserContext().catch(() => null);
    if (!context) return reject("Failed to create browser context");

    const page = await context.newPage();

    try {
      await page.setRequestInterception(true);
      page.on("request", (request) => {
        try {
          request.continue();
        } catch (err) {
          console.warn("Request interception error:", err);
        }
      });

      page.on("response", async (res) => {
        try {
          if ([200, 302].includes(res.status()) && [url, url + "/"].includes(res.url())) {
            await page.waitForNavigation({ waitUntil: "load", timeout: 5000 }).catch(() => {});
            const html = await page.content();
            isResolved = true;
            await page.close();
            resolve({ source: html });
          }
        } catch (e) {
          console.error("Error processing response:", e);
        }
      });
      await page.goto(url, { waitUntil: "domcontentloaded" });
    } catch (e) {
      console.error("Error in getSource:", e.message);
      if (!isResolved) {
        await page.close();
        reject(e.message);
      }
    }
  });
}

module.exports = getSource;
