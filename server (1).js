const express = require("express");
const https = require("https");

const app = express();
const PORT = process.env.PORT || 3000;

function get(urlString, headers) {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(urlString);
      const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: "GET",
        headers: headers || {}
      };
      const req = https.request(options, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return get(res.headers.location, headers).then(resolve).catch(reject);
        }
        let data = "";
        res.setEncoding("utf8");
        res.on("data", chunk => data += chunk);
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      });
      req.on("error", reject);
      req.setTimeout(25000, () => { req.destroy(); reject(new Error("Timeout")); });
      req.end();
    } catch(e) {
      reject(e);
    }
  });
}

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "fotocasa-scraper", version: "7.0.0" });
});

app.get("/debug", async (req, res) => {
  try {
    const params = new URLSearchParams({
      culture: "es-ES",
      latitude: "39.4697",
      longitude: "-0.3774",
      maxItems: "5",
      numPage: "1",
      propertyTypeId: "2",
      radius: "15000",
      transactionTypeId: "1"
    });

    const apiUrl = `https://api.fotocasa.es/v2/search?${params.toString()}`;
    console.log("[Debug] URL:", apiUrl);

    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "es-ES,es;q=0.9",
      "Origin": "https://www.fotocasa.es",
      "Referer": "https://www.fotocasa.es/"
    };

    const response = await get(apiUrl, headers);
    console.log("[Debug] Status:", response.status);

    res.json({
      status: response.status,
      url: apiUrl,
      preview: response.body.substring(0, 3000)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/scrape", async (req, res) => {
  const maxPages = Math.min(parseInt(req.query.maxPages) || 3, 10);
  console.log(`[Scraper] Inicio | maxPages: ${maxPages}`);
  const allItems = [];

  try {
    for (let page = 1; page <= maxPages; page++) {
      const params = new URLSearchParams({
        culture: "es-ES",
        latitude: "39.4697",
        longitude: "-0.3774",
        maxItems: "40",
        numPage: String(page),
        order: "desc",
        period: "0",
        propertyTypeId: "2",
        radius: "15000",
        transactionTypeId: "1"
      });

      const apiUrl = `https://api.fotocasa.es/v2/search?${params.toString()}`;
      const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "es-ES,es;q=0.9",
        "Origin": "https://www.fotocasa.es",
        "Referer": "https://www.fotocasa.es/"
      };

      console.log(`[Scraper] Página ${page}`);
      let response;
      try { response = await get(apiUrl, headers); }
      catch (e) { console.log(`Error: ${e.message}`); break; }

      console.log(`[Scraper] Status: ${response.status}`);
      if (response.status !== 200) {
        console.log(`[Scraper] Body: ${response.body.substring(0, 200)}`);
        break;
      }

      let data;
      try { data = JSON.parse(response.body); }
      catch (e) { console.log("JSON error:", response.body.substring(0, 200)); break; }

      const listings =
        data?.realEstates ||
        data?.items ||
        data?.result?.realEstates ||
        data?.data?.realEstates ||
        [];

      console.log(`[Scraper] Página ${page}: ${listings.length} propiedades`);
      if (listings.length === 0) break;

      for (const item of listings) {
        allItems.push({
          id:              String(item.id || item.propertyCode || ""),
          title:           item.clientAlias || item.title || "",
          url:             item.detail?.["es-ES"]
                             ? `https://www.fotocasa.es${item.detail["es-ES"]}`
                             : item.url || "",
          price:           item.price?.amount || item.price || null,
          surface:         item.features?.surface || item.size || null,
          rooms:           item.features?.rooms   || item.rooms || null,
          bathrooms:       item.features?.bathrooms || item.bathrooms || null,
          floor:           item.floor || null,
          buildingType:    item.buildingType    || "",
          buildingSubtype: item.buildingSubtype || "",
          latitude:        item.coordinates?.latitude  || null,
          longitude:       item.coordinates?.longitude || null,
          country:         item.address?.country      || "ES",
          province:        item.address?.province     || "Valencia",
          city:            item.address?.city         || "",
          municipality:    item.address?.municipality || "",
          district:        item.address?.district     || "",
          neighborhood:    item.address?.neighborhood || "",
          zipCode:         item.address?.zipCode      || "",
          clientType:      item.clientType    || "",
          clientId:        item.clientId      || "",
          clientAlias:     item.clientAlias   || "",
          clientUrl:       item.clientUrl     || "",
          isAgency:        item.isAgency      ?? null,
          agentName:       item.agentName     || "",
          agentPhone:      item.agentPhone    || item.agentPhoneRaw || "",
          contactMethod:   item.contactMethod || "",
          date:            item.date?.timestamp || null,
          source:          "fotocasa"
        });
      }
      await new Promise(r => setTimeout(r, 1500));
    }

    const particulares = allItems.filter(i =>
      i.isAgency === false ||
      String(i.clientType || "").toLowerCase() === "owner"
    );
    const seen = new Set();
    const unique = particulares.filter(i => {
      if (!i.id || seen.has(i.id)) return false;
      seen.add(i.id);
      return true;
    });

    console.log(`[Scraper] Total: ${allItems.length} | Particulares: ${unique.length}`);
    res.json({ success: true, total: unique.length, raw: allItems.length, items: unique });

  } catch (err) {
    console.error("[Scraper] Error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/detail", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "url required" });
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "text/html",
    "Accept-Language": "es-ES,es;q=0.9"
  };
  try {
    const response = await get(decodeURIComponent(url), headers);
    const html = response.body;
    let email = "", phone = "", contactName = "";
    const emails = (html.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || [])
      .filter(e => !e.includes("fotocasa") && !e.includes("adevinta") && !e.includes("noreply"));
    if (emails.length) email = emails[0];
    const phoneMatch = html.match(/"phoneNumber"\s*:\s*"(\d{9,})"/);
    if (phoneMatch) phone = "+34" + phoneMatch[1];
    const nameMatch = html.match(/"contactName"\s*:\s*"([^"]+)"/);
    if (nameMatch) contactName = nameMatch[1];
    res.json({ success: true, email, phone, contactName });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => console.log(`✅ Puerto ${PORT}`));
