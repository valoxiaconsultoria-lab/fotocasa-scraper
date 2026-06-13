const express = require("express");
const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || "sk-beniroig-2025";

// ── Middleware autenticación ──
function auth(req, res, next) {
  const key = req.headers["x-api-key"] || req.query.api_key;
  if (key !== API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// ── Health check ──
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "fotocasa-scraper", version: "1.0.0" });
});

// ── Endpoint principal de scraping ──
app.get("/scrape", auth, async (req, res) => {
  const {
    url = "https://www.fotocasa.es/es/comprar/viviendas/valencia-capital/todas-las-zonas/l?ord=desc",
    maxPages = 5,
  } = req.query;

  console.log(`[Scraper] Iniciando scraping: ${url} | maxPages: ${maxPages}`);

  let browser;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const results = [];
    let currentUrl = url;

    for (let page = 1; page <= parseInt(maxPages); page++) {
      console.log(`[Scraper] Página ${page}: ${currentUrl}`);

      const tab = await browser.newPage();

      // Headers para parecer navegador real
      await tab.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );
      await tab.setExtraHTTPHeaders({
        "Accept-Language": "es-ES,es;q=0.9",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        Referer: "https://www.fotocasa.es",
      });

      // Bloquear imágenes y fonts para ir más rápido
      await tab.setRequestInterception(true);
      tab.on("request", (req) => {
        const type = req.resourceType();
        if (["image", "font", "media", "stylesheet"].includes(type)) {
          req.abort();
        } else {
          req.continue();
        }
      });

      await tab.goto(currentUrl, {
        waitUntil: "networkidle2",
        timeout: 30000,
      });

      // Esperar a que carguen los anuncios
      await tab.waitForSelector('[class*="re-CardPackPrimary"], [class*="re-Card"]', {
        timeout: 15000,
      }).catch(() => console.log("[Scraper] No se encontraron cards, puede ser captcha"));

      // Extraer datos de los anuncios
      const pageData = await tab.evaluate(() => {
        const listings = [];

        // Buscar todos los anuncios en la página
        const cards = document.querySelectorAll(
          '[class*="re-CardPackPrimary"], [class*="re-Card-bodyInfo"], article[class*="re-Card"]'
        );

        cards.forEach((card) => {
          try {
            // ID del anuncio
            const linkEl = card.querySelector("a[href*='/inmueble/']");
            const href = linkEl?.getAttribute("href") || "";
            const idMatch = href.match(/\/inmueble\/(\d+)\//);
            const id = idMatch ? idMatch[1] : "";
            if (!id) return;

            // URL completa
            const url = href.startsWith("http")
              ? href
              : `https://www.fotocasa.es${href}`;

            // Precio
            const priceEl = card.querySelector(
              '[class*="re-CardPrice"], [class*="re-Price"]'
            );
            const priceText = priceEl?.textContent?.replace(/\D/g, "") || "";
            const price = priceText ? parseInt(priceText) : null;

            // Superficie, habitaciones, baños
            const features = card.querySelectorAll(
              '[class*="re-CardFeatures-feature"], [class*="re-Feature"]'
            );
            let surface = null,
              rooms = null,
              bathrooms = null;
            features.forEach((f) => {
              const text = f.textContent.trim();
              if (text.includes("m²")) surface = parseInt(text);
              else if (text.includes("hab")) rooms = parseInt(text);
              else if (text.includes("baño")) bathrooms = parseInt(text);
            });

            // Título / dirección
            const titleEl = card.querySelector(
              '[class*="re-CardTitle"], [class*="re-Card-title"]'
            );
            const title = titleEl?.textContent?.trim() || "";

            // Tipo de vendedor — buscar si pone "Particular"
            const agentEl = card.querySelector(
              '[class*="re-CardAgent"], [class*="re-Agent"]'
            );
            const agentText = agentEl?.textContent?.toLowerCase() || "";
            const isParticular =
              agentText.includes("particular") ||
              agentText.includes("propietario") ||
              card.innerHTML.toLowerCase().includes("particular");

            listings.push({
              id,
              url,
              title,
              price,
              surface,
              rooms,
              bathrooms,
              isAgency: !isParticular,
              source: "fotocasa",
            });
          } catch (e) {
            // Skip anuncio con error
          }
        });

        // URL de siguiente página
        const nextEl = document.querySelector(
          'a[class*="sui-PaginationBasic-item--next"], a[rel="next"]'
        );
        const nextUrl = nextEl?.href || null;

        return { listings, nextUrl };
      });

      results.push(...pageData.listings);
      console.log(
        `[Scraper] Página ${page}: ${pageData.listings.length} anuncios encontrados`
      );

      await tab.close();

      // Si no hay siguiente página, parar
      if (!pageData.nextUrl) {
        console.log("[Scraper] No hay más páginas");
        break;
      }
      currentUrl = pageData.nextUrl;

      // Espera entre páginas para no ser bloqueado
      await new Promise((r) => setTimeout(r, 2000 + Math.random() * 2000));
    }

    // Filtrar solo particulares de Valencia
    const particulares = results.filter((item) => {
      if (item.isAgency) return false;
      return true; // Ya filtramos por Valencia en la URL
    });

    // Eliminar duplicados por id
    const seen = new Set();
    const unique = particulares.filter((item) => {
      if (!item.id || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });

    console.log(
      `[Scraper] Total: ${results.length} | Particulares: ${unique.length}`
    );

    res.json({
      success: true,
      total: unique.length,
      pages_scraped: parseInt(maxPages),
      items: unique,
    });
  } catch (error) {
    console.error("[Scraper] Error:", error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  } finally {
    if (browser) await browser.close();
  }
});

// ── Endpoint para scraping de detalle de un anuncio ──
app.get("/detail", auth, async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "url param required" });

  let browser;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const tab = await browser.newPage();
    await tab.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    await tab.setRequestInterception(true);
    tab.on("request", (req) => {
      if (["image", "font", "media"].includes(req.resourceType())) req.abort();
      else req.continue();
    });

    await tab.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

    const detail = await tab.evaluate(() => {
      // Intentar extraer email del JSON incrustado en la página
      let email = "";
      const scripts = document.querySelectorAll('script[type="application/json"]');
      scripts.forEach((s) => {
        const text = s.textContent;
        const emailMatch = text.match(
          /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/
        );
        if (emailMatch) {
          const e = emailMatch[0];
          if (
            !e.includes("fotocasa") &&
            !e.includes("adevinta") &&
            !e.includes("noreply")
          ) {
            email = e;
          }
        }
      });

      // Buscar teléfono
      const phoneEl = document.querySelector(
        '[class*="re-ContactPhone"], [class*="re-Contact-phone"]'
      );
      const phone = phoneEl?.textContent?.trim() || "";

      // Vendedor particular o agencia
      const agentEl = document.querySelector('[class*="re-Agent-name"]');
      const agentName = agentEl?.textContent?.trim() || "";

      // Dirección completa
      const addressEl = document.querySelector(
        '[class*="re-DetailHeader-address"]'
      );
      const address = addressEl?.textContent?.trim() || "";

      // Descripción
      const descEl = document.querySelector('[class*="re-DetailDescription"]');
      const description = descEl?.textContent?.trim().slice(0, 500) || "";

      return { email, phone, agentName, address, description };
    });

    await tab.close();
    res.json({ success: true, ...detail });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (browser) await browser.close();
  }
});

app.listen(PORT, () => {
  console.log(`[Scraper] Servidor activo en puerto ${PORT}`);
});
