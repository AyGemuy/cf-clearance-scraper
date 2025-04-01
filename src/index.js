const express = require("express");
const app = express();
const port = process.env.PORT || 7860;
const bodyParser = require("body-parser");
const authToken = process.env.authToken || null;
const cors = require("cors");
const reqValidate = require("./module/reqValidate");

global.browserLength = 0;
global.browserLimit = Number(process.env.browserLimit) || 20;
global.timeOut = Number(process.env.timeOut) || 60000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());

if (process.env.NODE_ENV !== "development") {
  let server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });

  if (server) {
    try {
      server.timeout = global.timeOut;
    } catch (e) {
      console.error("Failed to set server timeout:", e);
    }
  }
}

if (process.env.SKIP_LAUNCH !== "true") require("./module/createBrowser");

const getSource = require("./endpoints/getSource");
const solveTurnstileMin = require("./endpoints/solveTurnstile.min");
const solveTurnstileMax = require("./endpoints/solveTurnstile.max");
const wafSession = require("./endpoints/wafSession");

async function handleRequest(fn, data) {
  try {
    return { ...(await fn(data)), code: 200 };
  } catch (err) {
    return { code: 500, message: String(err) };
  }
}

app.post("/cf-clearance-scraper", async (req, res) => {
  try {
    const data = req.body;
    const check = reqValidate(data);

    if (check !== true) {
      return res.status(400).json({ code: 400, message: "Bad Request", schema: check });
    }

    if (authToken && data.authToken !== authToken) {
      return res.status(401).json({ code: 401, message: "Unauthorized" });
    }

    if (global.browserLength >= global.browserLimit) {
      return res.status(429).json({ code: 429, message: "Too Many Requests" });
    }

    if (process.env.SKIP_LAUNCH !== "true" && !global.browser) {
      return res.status(500).json({
        code: 500,
        message: "The scanner is not ready yet. Please try again a little later.",
      });
    }

    global.browserLength++;

    let result = { code: 500 };
    try {
      switch (data.mode) {
        case "source":
          result = await handleRequest(getSource, data);
          break;
        case "turnstile-min":
          result = await handleRequest(solveTurnstileMin, data);
          break;
        case "turnstile-max":
          result = await handleRequest(solveTurnstileMax, data);
          break;
        case "waf-session":
          result = await handleRequest(wafSession, data);
          break;
        default:
          result = { code: 400, message: "Invalid mode" };
      }
    } finally {
      global.browserLength--;
    }

    res.status(result.code ?? 500).json(result);
  } catch (e) {
    console.error("Error in /cf-clearance-scraper:", e);
    res.status(500).json({ code: 500, message: "Internal Server Error" });
  }
});

app.use((req, res) => {
  res.status(404).json({ code: 404, message: "Not Found" });
});

if (process.env.NODE_ENV === "development") module.exports = app;
