const express = require("express");
const https = require("https");
const cheerio = require("cheerio");

const app = express();
const PORT = process.env.PORT || 3000;

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9",
  "Referer": "https://www.fotocasa.es"
};

// Fetch nativo con https (sin dependencias externas)
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: HEADERS }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve({ status: res.statusCode, text: () => data }));
    });
    req.on("error", reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "fotocasa-scraper", version: "4.0.0" });
});

app.get("/scrape", async (req, res) => {
  const maxPages = parseInt(req.query.maxPages) || 2;
  const baseUrl = "https://www.fotocasa.es/es/comprar/viviendas/valencia-capital/todas-las-zonas/l?ord=desc";

  console.log(`[Scraper] Iniciando | maxPages: ${maxPages}`);
  const results = [];

  try {
    for (let page = 1; page <= maxPages; page++) {
      const url = page === 1 ? baseUrl : `${baseUrl}&page=${page}`;
      console.log(`[Scraper] Página ${page}`);

      const response = await fetchUrl(url);
      if (response.status !== 200) {
        console.log(`[Scraper] HTTP ${response.status}`);
        break;
      }

      const html = response.text();
      const $ = cheerio.load(html);
      let pageItems = [];

      // Buscar JSON incrustado
      $("script").each((i, el) => {
        const content = $(el).html() || "";
        if (content.includes('"clientType"') || content.includes('"realEstates"')) {
          try {
            const match = content.match(/\{.+\}/s);
            if (match) {
              const data = JSON.parse(match[0]);
              const listings = data?.realEstates || data?.listings || data?.results || [];
              if (Array.isArray(listings) && listings.length > 0) {
                pageItems = listings;
                console.log(`[Scraper] JSON: ${listings.length} items`);
              }
            }
          } catch (e) {}
        }
      });

      // Fallback HTML
      if (pageItems.length === 0) {
        $("article, [class*='Card']").each((i, el) => {
          try {
            const card = $(el);
            const href = card.find("a[href*='/inmueble/']").first().attr("href") || "";
            const idMatch = href.match(/\/inmueble\/(\d+)\//);
            if (!idMatch) return;
            const id = idMatch[1];
            const cardUrl = href.startsWith("http") ? href : `https://www.fotocasa.es${href}`;
            const price = parseInt(card.find("[class*='Price']").first().text().replace(/\D/g, "")) || null;
            const title = card.find("h2, h3").first().text().trim();
            const isParticular = card.text().toLowerCase().includes("particular");
            pageItems.push({ id, url: cardUrl, title, price, isAgency: !isParticular });
          } catch (e) {}
        });
        console.log(`[Scraper] HTML: ${pageItems.length} items`);
      }

      results.push(...pageItems.filter(i => i.id));
      if (page < maxPages) await wait(2000);
    }

    const seen = new Set();
    const unique = results.filter(i => {
      const id = String(i.id || "");
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    console.log(`[Scraper] Únicos: ${unique.length}`);
    res.json({ success: true, total: unique.length, items: unique });

  } catch (err) {
    console.error("[Scraper] Error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/detail", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "url required" });

  try {
    const response = await fetchUrl(url);
    const html = response.text();
    const $ = cheerio.load(html);

    let email = "", phone = "", contactName = "";

    $("script").each((i, el) => {
      const c = $(el).html() || "";
      if (!email) {
        const m = c.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g);
        if (m) {
          const f = m.filter(e => !e.includes("fotocasa") && !e.includes("noreply"));
          if (f.length) email = f[0];
        }
      }
      if (!phone) {
        const m = c.match(/"phoneNumber"\s*:\s*"(\d+)"/);
        if (m) phone = "+34" + m[1];
      }
      if (!contactName) {
        const m = c.match(/"contactName"\s*:\s*"([^"]+)"/);
        if (m) contactName = m[1];
      }
    });

    res.json({ success: true, email, phone, contactName });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => console.log(`✅ Puerto ${PORT}`));
