const express = require("express");
const fetch = require("node-fetch");
const cheerio = require("cheerio");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9",
  "Referer": "https://www.fotocasa.es"
};

function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Health check
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "fotocasa-scraper-lite", version: "3.0.0" });
});

// Scraping sin autenticación
app.get("/scrape", async (req, res) => {
  const maxPages = parseInt(req.query.maxPages) || 3;
  const baseUrl = "https://www.fotocasa.es/es/comprar/viviendas/valencia-capital/todas-las-zonas/l?ord=desc";

  console.log(`[Scraper] Iniciando | maxPages: ${maxPages}`);
  const results = [];

  try {
    for (let page = 1; page <= maxPages; page++) {
      const url = page === 1 ? baseUrl : `${baseUrl}&page=${page}`;
      console.log(`[Scraper] Página ${page}: ${url}`);

      const response = await fetch(url, { headers: HEADERS });

      if (!response.ok) {
        console.log(`[Scraper] Error HTTP ${response.status}`);
        break;
      }

      const html = await response.text();
      const $ = cheerio.load(html);
      let pageItems = [];

      $("script").each((i, el) => {
        const content = $(el).html() || "";
        if (content.includes('"clientType"') || content.includes('"realEstates"')) {
          try {
            const jsonMatch = content.match(/\{.+\}/s);
            if (jsonMatch) {
              const data = JSON.parse(jsonMatch[0]);
              const listings = data?.realEstates || data?.listings || data?.results || [];
              if (Array.isArray(listings) && listings.length > 0) {
                pageItems = listings;
              }
            }
          } catch (e) {}
        }
      });

      if (pageItems.length === 0) {
        $("article, [class*='Card']").each((i, el) => {
          try {
            const card = $(el);
            const link = card.find("a[href*='/inmueble/']").first();
            const href = link.attr("href") || "";
            const idMatch = href.match(/\/inmueble\/(\d+)\//);
            if (!idMatch) return;
            const id = idMatch[1];
            const url = href.startsWith("http") ? href : `https://www.fotocasa.es${href}`;
            const priceText = card.find("[class*='Price']").first().text().trim();
            const price = parseInt(priceText.replace(/\D/g, "")) || null;
            const title = card.find("h2, h3, [class*='Title']").first().text().trim();
            const cardText = card.text().toLowerCase();
            const isParticular = cardText.includes("particular") || cardText.includes("propietario");
            pageItems.push({ id, url, title, price, isAgency: !isParticular });
          } catch (e) {}
        });
      }

      results.push(...pageItems.filter(i => i.id));

      if (page < maxPages) await wait(3000 + Math.random() * 2000);
    }

    const particulares = results.filter(i => i.isAgency === false || i.clientType === "owner");
    const seen = new Set();
    const unique = particulares.filter(i => {
      const id = String(i.id || "");
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    console.log(`[Scraper] Total: ${results.length} | Particulares: ${unique.length}`);
    res.json({ success: true, total: unique.length, items: unique });

  } catch (error) {
    console.error("[Scraper] Error:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Detalle anuncio
app.get("/detail", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "url param required" });

  try {
    const response = await fetch(url, { headers: HEADERS });
    const html = await response.text();
    const $ = cheerio.load(html);

    let email = "";
    let phone = "";
    let contactName = "";

    $("script").each((i, el) => {
      const content = $(el).html() || "";
      const emailMatch = content.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g);
      if (emailMatch) {
        const filtered = emailMatch.filter(e =>
          !e.includes("fotocasa") && !e.includes("adevinta") && !e.includes("noreply")
        );
        if (filtered.length > 0 && !email) email = filtered[0];
      }
      const phoneMatch = content.match(/"phoneNumber"\s*:\s*"(\d+)"/);
      if (phoneMatch && !phone) phone = "+34" + phoneMatch[1];
      const nameMatch = content.match(/"contactName"\s*:\s*"([^"]+)"/);
      if (nameMatch && !contactName) contactName = nameMatch[1];
    });

    res.json({ success: true, email, phone, contactName });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`[Scraper] ✅ Activo en puerto ${PORT}`);
});

