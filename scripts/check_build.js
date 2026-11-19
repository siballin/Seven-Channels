// Temporary: loads every route of the built site and reports page errors.
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`${page.url().split("#")[1]}: ${error.message}`));
  const routes = ["guide", "sports", "betting", "kpop", "movies", "anime", "games", "games/releases", "politics", "politics/members", "politics/elections/governor/2018", "politics/elections/midterms",
    "bowling", "bowling/scorer", "bowling/stats", "bowling/leagues", "music", "creator", "creator/clips", "live", "live/journal", "wrapped/2026"];
  await page.goto("http://localhost:8765/index.html#guide");
  await page.waitForTimeout(3000);
  for (const route of routes) {
    await page.evaluate((hash) => { location.hash = hash; }, route);
    await page.waitForTimeout(2500);
    const text = (await page.innerText("main")).replace(/\s+/g, " ");
    console.log(route.padEnd(36), text.length, text.slice(0, 90));
  }
  await page.evaluate(() => document.getElementById("site-search-open").click());
  await page.keyboard.type("aespa");
  await page.waitForTimeout(1500);
  console.log("search:", (await page.innerText(".site-search-status")));
  console.log("errors:", errors);
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
