const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const ACTIVE_PROVIDER_MODE = "single";

class ValidationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "ValidationError";
    this.statusCode = statusCode;
  }
}

const KALUGA = {
  name: "Калуга",
  center: { lat: 54.5101087, lon: 36.2598115 },
  bbox: {
    minLat: 54.4585078,
    maxLat: 54.6143805,
    minLon: 35.9879869,
    maxLon: 36.4043066
  }
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon"
};

const PROVIDERS = {
  map: "2GIS RasterJS API",
  geocoding: "Nominatim",
  routing: "Valhalla",
  isochrone: "Valhalla",
  geohash: "Local Geohash API"
};

function sendJson(res, statusCode, data) {
  const payload = JSON.stringify(data, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(payload);
}

function sendError(res, statusCode, message, extra = {}) {
  sendJson(res, statusCode, {
    ok: false,
    error: message,
    ...extra
  });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    throw new ValidationError("Тело запроса должно быть корректным JSON.");
  }
}

function ensureNumber(value, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ValidationError(`Поле "${field}" должно быть числом.`);
  }
  return parsed;
}

function validateMinutes(value) {
  const minutes = ensureNumber(value, "minutes");
  if (minutes <= 0 || minutes > 180) {
    throw new ValidationError("Время доставки должно быть в диапазоне от 1 до 180 минут.");
  }
  return minutes;
}

function validatePoint(point, label) {
  if (!point || typeof point !== "object") {
    throw new ValidationError(`Не передана точка "${label}".`);
  }

  const lat = ensureNumber(point.lat, `${label}.lat`);
  const lon = ensureNumber(point.lon, `${label}.lon`);

  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new ValidationError(`Координаты "${label}" выходят за допустимый диапазон.`);
  }

  return {
    lat,
    lon,
    label: typeof point.label === "string" ? point.label : ""
  };
}

function isPointInKaluga(point) {
  return (
    point.lat >= KALUGA.bbox.minLat &&
    point.lat <= KALUGA.bbox.maxLat &&
    point.lon >= KALUGA.bbox.minLon &&
    point.lon <= KALUGA.bbox.maxLon
  );
}

function validatePointInKaluga(point, label) {
  const normalized = validatePoint(point, label);
  if (!isPointInKaluga(normalized)) {
    throw new ValidationError(`Точка "${label}" должна находиться в пределах Калуги.`);
  }
  return normalized;
}

function geohashEncode(lat, lon, precision = 7) {
  const alphabet = "0123456789bcdefghjkmnpqrstuvwxyz";
  let idx = 0;
  let bit = 0;
  let evenBit = true;
  let geohash = "";

  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;

  while (geohash.length < precision) {
    if (evenBit) {
      const lonMid = (lonMin + lonMax) / 2;
      if (lon >= lonMid) {
        idx = idx * 2 + 1;
        lonMin = lonMid;
      } else {
        idx = idx * 2;
        lonMax = lonMid;
      }
    } else {
      const latMid = (latMin + latMax) / 2;
      if (lat >= latMid) {
        idx = idx * 2 + 1;
        latMin = latMid;
      } else {
        idx = idx * 2;
        latMax = latMid;
      }
    }

    evenBit = !evenBit;

    if (++bit === 5) {
      geohash += alphabet[idx];
      bit = 0;
      idx = 0;
    }
  }

  return {
    geohash,
    bbox: {
      minLat: latMin,
      maxLat: latMax,
      minLon: lonMin,
      maxLon: lonMax
    },
    center: {
      lat: (latMin + latMax) / 2,
      lon: (lonMin + lonMax) / 2
    }
  };
}

function wktToGeometry(wkt) {
  if (typeof wkt !== "string" || !wkt.trim()) {
    return null;
  }

  const normalized = wkt.trim();

  if (normalized.startsWith("LINESTRING")) {
    return {
      type: "LineString",
      coordinates: parseWktLineStringCoordinates(normalized)
    };
  }

  if (normalized.startsWith("MULTILINESTRING")) {
    return {
      type: "MultiLineString",
      coordinates: parseWktMultiLineStringCoordinates(normalized)
    };
  }

  if (normalized.startsWith("POLYGON")) {
    return {
      type: "Polygon",
      coordinates: parseWktPolygonCoordinates(normalized)
    };
  }

  if (normalized.startsWith("MULTIPOLYGON")) {
    return {
      type: "MultiPolygon",
      coordinates: parseWktMultiPolygonCoordinates(normalized)
    };
  }

  return null;
}

function splitTopLevelGroups(input) {
  const groups = [];
  let depth = 0;
  let start = -1;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (char === "(") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        groups.push(input.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return groups;
}

function trimOuterParens(input) {
  let result = input.trim();
  while (result.startsWith("(") && result.endsWith(")")) {
    result = result.slice(1, -1).trim();
  }
  return result;
}

function parseWktCoordinatePair(pair) {
  const [lon, lat] = pair.trim().split(/\s+/).map(Number);
  return [lon, lat];
}

function parseWktLineStringCoordinates(wkt) {
  const body = trimOuterParens(wkt.slice("LINESTRING".length));
  return body
    .split(",")
    .map((pair) => parseWktCoordinatePair(pair))
    .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
}

function parseWktMultiLineStringCoordinates(wkt) {
  const body = trimOuterParens(wkt.slice("MULTILINESTRING".length));
  return splitTopLevelGroups(body).map((group) =>
    trimOuterParens(group)
      .split(",")
      .map((pair) => parseWktCoordinatePair(pair))
      .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat))
  );
}

function parseWktPolygonCoordinates(wkt) {
  const body = trimOuterParens(wkt.slice("POLYGON".length));
  return splitTopLevelGroups(body).map((ring) =>
    trimOuterParens(ring)
      .split(",")
      .map((pair) => parseWktCoordinatePair(pair))
      .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat))
  );
}

function parseWktMultiPolygonCoordinates(wkt) {
  const body = trimOuterParens(wkt.slice("MULTIPOLYGON".length));
  return splitTopLevelGroups(body).map((polygon) =>
    splitTopLevelGroups(trimOuterParens(polygon)).map((ring) =>
      trimOuterParens(ring)
        .split(",")
        .map((pair) => parseWktCoordinatePair(pair))
        .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat))
    )
  );
}

function geometryToFeatureCollection(geometry, properties = {}) {
  return {
    type: "FeatureCollection",
    features: geometry
      ? [
          {
            type: "Feature",
            properties,
            geometry
          }
        ]
      : []
  };
}

function flattenRouteGeometry(geometry) {
  if (!geometry) {
    return [];
  }

  if (geometry.type === "LineString") {
    return geometry.coordinates;
  }

  if (geometry.type === "MultiLineString") {
    return geometry.coordinates.flat();
  }

  return [];
}

function validateGeohashPrecision(value) {
  const precision = Number(value ?? 7);
  if (!Number.isFinite(precision)) {
    throw new ValidationError("Точность geohash должна быть числом от 1 до 10.");
  }

  const rounded = Math.round(precision);
  if (rounded < 1 || rounded > 10) {
    throw new ValidationError("Точность geohash должна быть в диапазоне от 1 до 10.");
  }

  return rounded;
}

function decodeValhallaPolyline(polyline, precision = 6) {
  const coordinates = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  const factor = Math.pow(10, precision);

  while (index < polyline.length) {
    let result = 0;
    let shift = 0;
    let byte;

    do {
      byte = polyline.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLat = (result & 1) ? ~(result >> 1) : (result >> 1);
    lat += deltaLat;

    result = 0;
    shift = 0;

    do {
      byte = polyline.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLon = (result & 1) ? ~(result >> 1) : (result >> 1);
    lon += deltaLon;

    coordinates.push([lon / factor, lat / factor]);
  }

  return coordinates;
}

async function fetchJson(url, options = {}, provider = "remote API") {
  const response = await fetch(url, options);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${provider}: HTTP ${response.status}. ${text.slice(0, 300)}`);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${provider}: не удалось разобрать JSON-ответ.`);
  }
}

async function fetchJsonMaybeError(url, options = {}, provider = "remote API") {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch (error) {
    data = null;
  }

  if (!response.ok) {
    throw new Error(`${provider}: HTTP ${response.status}. ${text.slice(0, 300)}`);
  }

  return data;
}

async function geocode(query, limit = 5) {
  return geocodeWithNominatim(query, limit);
}

async function geocodeWithNominatim(query, limit = 5) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("countrycodes", "ru");
  url.searchParams.set(
    "viewbox",
    `${KALUGA.bbox.minLon},${KALUGA.bbox.maxLat},${KALUGA.bbox.maxLon},${KALUGA.bbox.minLat}`
  );
  url.searchParams.set("bounded", "1");
  url.searchParams.set("q", query);

  const data = await fetchJson(
    url.toString(),
    {
      headers: {
        "User-Agent": "kaluga-lab8/1.0 (educational project)"
      }
    },
    "Nominatim"
  );

  return data.map((item) => ({
    provider: "Nominatim",
    placeId: item.place_id,
    name: item.name || item.display_name,
    displayName: item.display_name,
    category: item.category,
    type: item.type,
    lat: Number(item.lat),
    lon: Number(item.lon),
    boundingbox: item.boundingbox ? item.boundingbox.map(Number) : null
  }));
}

async function reverseGeocode(lat, lon) {
  return reverseGeocodeWithNominatim(lat, lon);
}

async function reverseGeocodeWithNominatim(lat, lon) {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("zoom", "18");
  url.searchParams.set("addressdetails", "1");

  const item = await fetchJson(
    url.toString(),
    {
      headers: {
        "User-Agent": "kaluga-lab8/1.0 (educational project)"
      }
    },
    "Nominatim"
  );

  return {
    provider: "Nominatim",
    name: item.name || item.display_name,
    displayName: item.display_name,
    lat: Number(item.lat),
    lon: Number(item.lon)
  };
}


async function valhallaRequest(endpoint, body) {
  return fetchJson(
    `https://valhalla1.openstreetmap.de/${endpoint}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Client-Id": "kaluga-lab8-edu"
      },
      body: JSON.stringify(body)
    },
    "Valhalla"
  );
}

async function buildIsochrone(origin, minutes) {
  return buildIsochroneWithValhalla(origin, minutes);
}

async function buildIsochroneWithValhalla(origin, minutes) {
  const payload = {
    locations: [{ lat: origin.lat, lon: origin.lon }],
    costing: "pedestrian",
    contours: [{ time: minutes }],
    polygons: true,
    denoise: 0.1,
    generalize: 40
  };

  const data = await valhallaRequest("isochrone", payload);
  return {
    provider: "Valhalla",
    geojson: data
  };
}

async function buildRoute(from, to) {
  return buildRouteWithValhalla(from, to);
}

async function buildRouteWithValhalla(from, to) {
  const payload = {
    locations: [
      { lat: from.lat, lon: from.lon },
      { lat: to.lat, lon: to.lon }
    ],
    costing: "pedestrian",
    directions_options: {
      units: "kilometers",
      language: "ru-RU"
    }
  };

  const data = await valhallaRequest("route", payload);
  const trip = data.trip || {};
  const leg = trip.legs?.[0] || {};
  const summary = trip.summary || leg.summary || {};

  return {
    provider: "Valhalla",
    summary: {
      timeSeconds: Number(summary.time || 0),
      timeMinutes: Number(((summary.time || 0) / 60).toFixed(1)),
      lengthKm: Number((summary.length || 0).toFixed(2))
    },
    maneuvers: (leg.maneuvers || []).map((item) => ({
      instruction: item.instruction,
      lengthKm: Number((item.length || 0).toFixed(2)),
      timeMinutes: Number(((item.time || 0) / 60).toFixed(1))
    })),
    geometry: {
      type: "LineString",
      coordinates: leg.shape ? decodeValhallaPolyline(leg.shape, 6) : []
    }
  };
}


async function handleApi(req, res, url) {
  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        app: "kaluga-courier-isochrone-lab8",
        city: KALUGA,
        providerMode: ACTIVE_PROVIDER_MODE,
        providers: PROVIDERS
      });
    }

    if (req.method === "GET" && url.pathname === "/api/geocode") {
      const query = (url.searchParams.get("q") || "").trim();
      if (!query) {
        return sendError(res, 400, "Пустой текст запроса для геокодинга.");
      }

      const results = await geocode(query, 5);
      return sendJson(res, 200, {
        ok: true,
        provider: results[0]?.provider || PROVIDERS.geocoding,
        city: KALUGA,
        query,
        count: results.length,
        results
      });
    }

    if (req.method === "GET" && url.pathname === "/api/reverse") {
      const lat = ensureNumber(url.searchParams.get("lat"), "lat");
      const lon = ensureNumber(url.searchParams.get("lon"), "lon");
      const result = await reverseGeocode(lat, lon);
      return sendJson(res, 200, {
        ok: true,
        result
      });
    }

    if (req.method === "POST" && url.pathname === "/api/geohash") {
      const body = await readBody(req);
      const point = validatePointInKaluga(body.point, "point");
      const precision = validateGeohashPrecision(body.precision);
      return sendJson(res, 200, {
        ok: true,
        provider: "Local Geohash API",
        standard: "CTA-5009",
        precision,
        ...geohashEncode(point.lat, point.lon, precision)
      });
    }

    if (req.method === "POST" && url.pathname === "/api/isochrone") {
      const body = await readBody(req);
      const origin = validatePointInKaluga(body.origin, "origin");
      const minutes = validateMinutes(body.minutes);
      const isochrone = await buildIsochrone(origin, minutes);
      return sendJson(res, 200, {
        ok: true,
        minutes,
        ...isochrone
      });
    }

    if (req.method === "POST" && url.pathname === "/api/route") {
      const body = await readBody(req);
      const from = validatePointInKaluga(body.from, "from");
      const to = validatePointInKaluga(body.to, "to");
      const route = await buildRoute(from, to);
      return sendJson(res, 200, {
        ok: true,
        route
      });
    }

    if (req.method === "POST" && url.pathname === "/api/analyze") {
      const body = await readBody(req);
      const restaurant = validatePointInKaluga(body.restaurant, "restaurant");
      const minutes = validateMinutes(body.minutes);
      const customer = body.customer ? validatePointInKaluga(body.customer, "customer") : null;
      const geohashPrecision = validateGeohashPrecision(body.geohashPrecision);

      const [isochrone, route] = await Promise.all([
        buildIsochrone(restaurant, minutes),
        customer ? buildRoute(restaurant, customer) : Promise.resolve(null)
      ]);

      const geohash = geohashEncode(restaurant.lat, restaurant.lon, geohashPrecision);
      const delivery = route
        ? {
            possible: route.summary.timeMinutes <= minutes,
            differenceMinutes: Number((minutes - route.summary.timeMinutes).toFixed(1))
          }
        : null;

      return sendJson(res, 200, {
        ok: true,
        city: KALUGA,
        restaurant,
        customer,
        minutes,
        geohashPrecision,
        geohash: {
          provider: "Local Geohash API",
          standard: "CTA-5009",
          ...geohash
        },
        isochrone,
        route,
        delivery
      });
    }

    sendError(res, 404, "API endpoint не найден.");
  } catch (error) {
    const statusCode = error instanceof ValidationError ? error.statusCode : 500;
    sendError(res, statusCode, error.message);
  }
}

function serveStatic(req, res, url) {
  const safePath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(ROOT, safePath));

  if (!filePath.startsWith(ROOT)) {
    return sendError(res, 403, "Доступ запрещён.");
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === "ENOENT") {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Файл не найден.");
        return;
      }

      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Ошибка чтения файла.");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream"
    });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url);
    return;
  }

  serveStatic(req, res, url);
});

server.listen(PORT, () => {
  console.log(`Kaluga lab app is running on http://localhost:${PORT}`);
});
