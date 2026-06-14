const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.json({ status: "ok", version: "8.0.0" });
});

app.get("/test", (req, res) => {
  const https = require("https");
  const options = {
    hostname: "api.fotocasa.es",
    path: "/v2/search?culture=es-ES&latitude=39.4697&longitude=-0.3774&maxItems=3&numPage=1&propertyTypeId=2&radius=15000&transactionTypeId=1",
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "application/json",
      "Accept-Language": "es-ES,es;q=0.9",
      "Origin": "https://www.fotocasa.es",
      "Referer": "https://www.fotocasa.es/"
    }
  };

  const req2 = https.request(options, (response) => {
    let data = "";
    response.on("data", chunk => data += chunk);
    response.on("end", () => {
      res.json({
        status: response.statusCode,
        preview: data.substring(0, 1000)
      });
    });
  });
  req2.on("error", (e) => res.status(500).json({ error: e.message }));
  req2.setTimeout(15000, () => { req2.destroy(); res.status(500).json({ error: "timeout" }); });
  req2.end();
});

app.get("/scrape", (req, res) => {
  const https = require("https");
  const maxPages = Math.min(parseInt(req.query.maxPages) || 2, 5);
  const allItems = [];
  let page = 1;

  function scrapePage() {
    if (page > maxPages) {
      const seen = new Set();
      const unique = allItems.filter(i => {
        if (!i.id || seen.has(i.id)) return false;
        seen.add(i.id);
        return true;
      });
      const particulares = unique.filter(i =>
        i.isAgency === false || String(i.clientType || "").toLowerCase() === "owner"
      );
      return res.json({ success: true, total: particulares.length, raw: allItems.length, items: particulares });
    }

    const options = {
      hostname: "api.fotocasa.es",
      path: `/v2/search?culture=es-ES&latitude=39.4697&longitude=-0.3774&maxItems=40&numPage=${page}&propertyTypeId=2&radius=15000&transactionTypeId=1`,
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
        "Accept-Language": "es-ES,es;q=0.9",
        "Origin": "https://www.fotocasa.es",
        "Referer": "https://www.fotocasa.es/"
      }
    };

    const req2 = https.request(options, (response) => {
      let data = "";
      response.on("data", chunk => data += chunk);
      response.on("end", () => {
        try {
          const json = JSON.parse(data);
          const listings = json?.realEstates || json?.items || json?.result?.realEstates || [];
          for (const item of listings) {
            allItems.push({
              id:           String(item.id || ""),
              title:        item.clientAlias || item.title || "",
              url:          item.detail?.["es-ES"] ? `https://www.fotocasa.es${item.detail["es-ES"]}` : "",
              price:        item.price?.amount || null,
              surface:      item.features?.surface || null,
              rooms:        item.features?.rooms || null,
              bathrooms:    item.features?.bathrooms || null,
              latitude:     item.coordinates?.latitude || null,
              longitude:    item.coordinates?.longitude || null,
              city:         item.address?.city || "",
              province:     item.address?.province || "",
              zipCode:      item.address?.zipCode || "",
              clientType:   item.clientType || "",
              clientAlias:  item.clientAlias || "",
              clientUrl:    item.clientUrl || "",
              isAgency:     item.isAgency ?? null,
              agentPhone:   item.agentPhone || "",
              source:       "fotocasa"
            });
          }
        } catch(e) {}
        page++;
        setTimeout(scrapePage, 1500);
      });
    });
    req2.on("error", () => {
      page++;
      setTimeout(scrapePage, 1000);
    });
    req2.setTimeout(20000, () => { req2.destroy(); page++; setTimeout(scrapePage, 1000); });
    req2.end();
  }

  scrapePage();
});

app.listen(PORT, () => console.log("OK puerto " + PORT));
