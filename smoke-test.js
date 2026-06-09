const { spawn } = require("child_process");

const PORT = 3210;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const RESTAURANT = { lat: 54.5159952, lon: 36.2462193, label: "ул. Кирова, 1, Калуга" };
const CUSTOMER = { lat: 54.5223368, lon: 36.2676989, label: "ул. Ленина, 50, Калуга" };

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(timeoutMs = 10000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${BASE_URL}/api/health`);
      if (response.ok) {
        return;
      }
    } catch (error) {
      // The server is still starting.
    }

    await delay(250);
  }

  throw new Error("Сервер не запустился вовремя.");
}

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, options);
  const data = await response.json();

  if (!response.ok || !data.ok) {
    throw new Error(`Ошибка ${path}: ${data.error || response.status}`);
  }

  return data;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function run() {
  const server = spawn("node", ["server.js"], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: "ignore",
    windowsHide: true
  });

  try {
    await waitForServer();

    const health = await request("/api/health");
    assert(health.city.name === "Калуга", "Health endpoint вернул неверный город.");

    const geocode = await request(`/api/geocode?q=${encodeURIComponent("улица Кирова, 1, Калуга")}`);
    assert(geocode.results.length > 0, "Геокодинг не вернул результатов.");

    const reverse = await request(`/api/reverse?lat=${RESTAURANT.lat}&lon=${RESTAURANT.lon}`);
    assert(reverse.result.displayName, "Обратный геокодинг не вернул адрес.");

    const geohash = await request("/api/geohash", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ point: RESTAURANT, precision: 7 })
    });
    assert(geohash.geohash === "uc9y0u3", "Геохеш вычислен неожиданно.");

    const route = await request("/api/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: RESTAURANT, to: CUSTOMER })
    });
    assert(route.route.summary.timeMinutes > 0, "Маршрут не содержит время.");
    assert(route.route.geometry.coordinates.length > 2, "Маршрут не содержит геометрию.");

    const isochrone = await request("/api/isochrone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ origin: RESTAURANT, minutes: 20 })
    });
    assert(isochrone.geojson.features.length > 0, "Изохрона не содержит полигон.");

    const analysis = await request("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        restaurant: RESTAURANT,
        customer: CUSTOMER,
        minutes: 30
      })
    });
    assert(analysis.delivery.possible === true, "Анализ ошибочно считает доставку невозможной.");

    const badMinutesResponse = await fetch(`${BASE_URL}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        restaurant: RESTAURANT,
        minutes: 0
      })
    });
    const badMinutesData = await badMinutesResponse.json();
    assert(badMinutesResponse.status === 400, "Некорректное время должно вызывать ошибку валидации API.");
    assert(/диапазоне|range|1/.test(badMinutesData.error), "Ошибка при неверном времени выглядит неожиданно.");

    const badJsonResponse = await fetch(`${BASE_URL}/api/route`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{bad json"
    });
    const badJsonData = await badJsonResponse.json();
    assert(badJsonResponse.status === 400, "Некорректный JSON должен вызывать ошибку валидации API.");
    assert(/JSON/i.test(badJsonData.error), "Ошибка для некорректного JSON выглядит неожиданно.");

    const outsidePointResponse = await fetch(`${BASE_URL}/api/geohash`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        point: { lat: 55.7558, lon: 37.6173 },
        precision: 7
      })
    });
    const outsidePointData = await outsidePointResponse.json();
    assert(outsidePointResponse.status === 400, "Точка вне Калуги должна отклоняться API.");
    assert(/Калуги/.test(outsidePointData.error), "Ошибка для точки вне Калуги выглядит неожиданно.");

    console.log("Smoke test passed.");
    console.log(`Geocode results: ${geocode.results.length}`);
    console.log(`Route: ${route.route.summary.lengthKm} km, ${route.route.summary.timeMinutes} min`);
    console.log(`Isochrone features: ${isochrone.geojson.features.length}`);
    console.log(`Analysis geohash: ${analysis.geohash.geohash}`);
  } finally {
    server.kill();
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
