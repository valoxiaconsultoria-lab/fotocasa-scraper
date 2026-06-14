const express = require("express");
const https = require("https");
const http = require("http");

const app = express();
const PORT = process.env.PORT || 3000;

// ── Fetch nativo sin dependencias ──
function get(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9",
        "Referer": "https://www.fotocasa.es",
        "Cache-Control": "no-cache"
      }
    }, (res) => {
      // Seguir redirecciones
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return get(res.headers.location).then(resolve).catch(reject);
      }
      let data = "";
      res.setEncoding("utf8");
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.setTimeout(25000, () => {
      req.destroy();
      reject(new Error("Timeout"));
    });
  });
}

// ── Extraer datos del JSON incrustado en el HTML ──
function extractFromHtml(html) {
  const items = [];

  // Fotocasa mete los datos en window.__INITIAL_PROPS__ o similar
  const patterns = [
    /window\.__INITIAL_PROPS__\s*=\s*({.+?});/s,
    /window\.__REDUX_STATE__\s*=\s*({.+?});/s,
    /"realEstates"\s*:\s*(\[.+?\])/s,
    /"listings"\s*:\s*(\[.+?\])/s,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) continue;
    try {
      const data = JSON.parse(match[1]);
      const listings = Array.isArray(data)
        ? data
        : data?.realEstates || data?.listings || data?.results || [];
      if (listings.length > 0) {
        console.log(`[Scraper] JSON extraído: ${listings.length} items`);
        return listings;
      }
    } catch (e) {}
  }

  // Fallback: buscar IDs de inmuebles en los links
  const linkPattern = /href="(\/es\/[^"]*\/inmueble\/(\d+)\/[^"]*)"/g;
  const seen = new Set();
  let m;
  while ((m = linkPattern.exec(html)) !== null) {
    const id = m[2];
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({
      id,
      url: `https://www.fotocasa.es${m[1]}`,
      isAgency: null // desconocido sin más datos
    });
  }

  console.log(`[Scraper] Links extraídos: ${items.length} items`);
  return items;
}

// ── Health check ──
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "fotocasa-scraper", version: "5.0.0" });
});

// ── Scraping principal ──
app.get("/scrape", async (req, res) => {
  const maxPages = Math.min(parseInt(req.query.maxPages) || 2, 10);
  const baseUrl = "https://www.fotocasa.es/es/comprar/viviendas/valencia-capital/todas-las-zonas/l?ord=desc";

  console.log(`[Scraper] Inicio | maxPages: ${maxPages}`);
  const allItems = [];

  try {
    for (let page = 1; page <= maxPages; page++) {
      const url = page === 1 ? baseUrl : `${baseUrl}&page=${page}`;
      console.log(`[Scraper] Página ${page}`);

      let response;
      try {
        response = await get(url);
      } catch (e) {
        console.log(`[Scraper] Error página ${page}: ${e.message}`);
        break;
      }

      if (response.status !== 200) {
        console.log(`[Scraper] HTTP ${response.status} en página ${page}`);
        break;
      }

      const items = extractFromHtml(response.body);
      allItems.push(...items);

      if (page < maxPages) {
        await new Promise(r => setTimeout(r, 2500));
      }
    }

    // Eliminar duplicados
    const seen = new Set();
    const unique = allItems.filter(item => {
      const id = String(item.id || "");
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    // Filtrar particulares si tenemos ese dato
    const particulares = unique.filter(i =>
      i.isAgency === false ||
      i.isAgency === null || // incluir desconocidos para no perder datos
      String(i.clientType || "").toLowerCase() === "owner"
    );

    console.log(`[Scraper] Total únicos: ${unique.length} | Particulares: ${particulares.length}`);

    res.json({
      success: true,
      total: particulares.length,
      items: particulares
    });

  } catch (err) {
    console.error("[Scraper] Error fatal:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Detalle de anuncio ──
app.get("/detail", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "url required" });

  try {
    const response = await get(decodeURIComponent(url));
    const html = response.body;

    let email = "";
    let phone = "";
    let contactName = "";

    // Buscar email
    const emails = html.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || [];
    const filtered = emails.filter(e =>
      !e.includes("fotocasa") &&
      !e.includes("adevinta") &&
      !e.includes("noreply") &&
      !e.includes("sentry") &&
      !e.includes("example")
    );
    if (filtered.length) email = filtered[0];

    // Buscar teléfono
    const phoneMatch = html.match(/"phoneNumber"\s*:\s*"(\d{9,})"/) ||
                       html.match(/"phone"\s*:\s*"(\d{9,})"/);
    if (phoneMatch) phone = "+34" + phoneMatch[1];

    // Buscar nombre
    const nameMatch = html.match(/"contactName"\s*:\s*"([^"]+)"/) ||
                      html.match(/"clientAlias"\s*:\s*"([^"]+)"/);
    if (nameMatch) contactName = nameMatch[1];

    res.json({ success: true, email, phone, contactName });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Servidor activo en puerto ${PORT}`);
});
