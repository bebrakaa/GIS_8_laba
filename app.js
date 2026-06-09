const CITY = {
  name: "Калуга",
  center: [54.5101087, 36.2598115],
  bounds: [
    [54.4585078, 35.9879869],
    [54.6143805, 36.4043066]
  ]
};

function isPointInCity(lat, lon) {
  return (
    lat >= CITY.bounds[0][0] &&
    lat <= CITY.bounds[1][0] &&
    lon >= CITY.bounds[0][1] &&
    lon <= CITY.bounds[1][1]
  );
}

const state = {
  selectionMode: "restaurant",
  restaurant: null,
  customer: null,
  currentIsochrone: null,
  health: null
};

let map;
let restaurantLayer;
let customerLayer;
let routeLayer;
let isochroneLayer;
let geohashLayer;
let restaurantMarker = null;
let customerMarker = null;

const examples = [
  {
    title: "Пример 1. Успешная доставка",
    description: "Из центра Калуги до точки клиента с запасом по времени.",
    restaurant: { lat: 54.5159952, lon: 36.2462193, label: "Ресторан: ул. Кирова, 1" },
    customer: { lat: 54.5101087, lon: 36.2598115, label: "Клиент: центр Калуги" },
    minutes: 20
  },
  {
    title: "Пример 2. Недостаточно времени",
    description: "Та же точка ресторана, но до клиента время слишком мало.",
    restaurant: { lat: 54.5159952, lon: 36.2462193, label: "Ресторан: ул. Кирова, 1" },
    customer: { lat: 54.5223368, lon: 36.2676989, label: "Клиент: ул. Ленина, 50" },
    minutes: 15
  },
  {
    title: "Пример 3. Длинная, но возможная доставка",
    description: "Маршрут до улицы Ленина при увеличенном лимите времени.",
    restaurant: { lat: 54.5159952, lon: 36.2462193, label: "Ресторан: ул. Кирова, 1" },
    customer: { lat: 54.5223368, lon: 36.2676989, label: "Клиент: ул. Ленина, 50" },
    minutes: 30
  },
  {
    title: "Пример 4. Только зона доступности",
    description: "Построение изохроны без адреса клиента.",
    restaurant: { lat: 54.5101087, lon: 36.2598115, label: "Ресторан: центр Калуги" },
    customer: null,
    minutes: 12
  },
  {
    title: "Пример 5. Нестандартная ситуация",
    description: "Клиент находится в той же точке, что и ресторан. Доставка возможна, но маршрут будет нулевой длины.",
    restaurant: { lat: 54.5159952, lon: 36.2462193, label: "Ресторан: ул. Кирова, 1" },
    customer: { lat: 54.5159952, lon: 36.2462193, label: "Клиент совпадает с рестораном" },
    minutes: 5
  }
];

const restaurantQuery = document.getElementById("restaurant-query");
const customerQuery = document.getElementById("customer-query");
const restaurantAddressPanel = document.getElementById("restaurant-address-panel");
const restaurantCoordsPanel = document.getElementById("restaurant-coords-panel");
const customerAddressPanel = document.getElementById("customer-address-panel");
const customerCoordsPanel = document.getElementById("customer-coords-panel");
const restaurantResults = document.getElementById("restaurant-results");
const customerResults = document.getElementById("customer-results");
const restaurantLatInput = document.getElementById("restaurant-lat");
const restaurantLonInput = document.getElementById("restaurant-lon");
const customerLatInput = document.getElementById("customer-lat");
const customerLonInput = document.getElementById("customer-lon");
const restaurantCurrent = document.getElementById("restaurant-current");
const customerCurrent = document.getElementById("customer-current");
const minutesInput = document.getElementById("delivery-minutes");
const summary = document.getElementById("summary");
const apiLog = document.getElementById("api-log");
const examplesContainer = document.getElementById("examples");
const exportButton = document.getElementById("export-geojson");
const badgeMap = document.getElementById("badge-map");
const badgeRouting = document.getElementById("badge-routing");
const mapElement = document.getElementById("map");
const copyRestaurantToCustomerButton = document.getElementById("copy-restaurant-to-customer");
const restaurantModeAddressButton = document.getElementById("restaurant-mode-address");
const restaurantModeCoordsButton = document.getElementById("restaurant-mode-coords");
const customerModeAddressButton = document.getElementById("customer-mode-address");
const customerModeCoordsButton = document.getElementById("customer-mode-coords");

function initializeMap() {
  map = DG.map("map", {
    center: CITY.center,
    zoom: 13,
    zoomControl: true
  });

  map.attributionControl.setPrefix(false);

  map.createPane("isochronePane");
  map.getPane("isochronePane").style.zIndex = "410";

  map.createPane("geohashPane");
  map.getPane("geohashPane").style.zIndex = "420";

  map.createPane("routePane");
  map.getPane("routePane").style.zIndex = "430";

  map.createPane("markerPaneTop");
  map.getPane("markerPaneTop").style.zIndex = "440";

  map.whenReady(() => {
    map.invalidateSize();
    map.fitBounds(CITY.bounds, { padding: [20, 20] });
  });

  DG.rectangle(CITY.bounds, {
    color: "#7b2416",
    weight: 1.5,
    dashArray: "6 6",
    fillOpacity: 0.02
  }).addTo(map);

  restaurantLayer = DG.layerGroup().addTo(map);
  customerLayer = DG.layerGroup().addTo(map);
  routeLayer = DG.layerGroup().addTo(map);
  isochroneLayer = DG.layerGroup().addTo(map);
  geohashLayer = DG.layerGroup().addTo(map);

  map.on("click", handleMapClick);
  DG.control.scale({ imperial: false }).addTo(map);

  window.addEventListener("resize", scheduleMapResize);

  if (typeof ResizeObserver !== "undefined") {
    const resizeObserver = new ResizeObserver(() => {
      scheduleMapResize();
    });
    resizeObserver.observe(mapElement);
  }
}

document.getElementById("mode-restaurant").addEventListener("click", () => setSelectionMode("restaurant"));
document.getElementById("mode-customer").addEventListener("click", () => setSelectionMode("customer"));
restaurantModeAddressButton.addEventListener("click", () => setInputMode("restaurant", "address"));
restaurantModeCoordsButton.addEventListener("click", () => setInputMode("restaurant", "coords"));
customerModeAddressButton.addEventListener("click", () => setInputMode("customer", "address"));
customerModeCoordsButton.addEventListener("click", () => setInputMode("customer", "coords"));
document.getElementById("search-restaurant").addEventListener("click", () => searchPlace("restaurant"));
document.getElementById("search-customer").addEventListener("click", () => searchPlace("customer"));
document.getElementById("build-zone").addEventListener("click", analyze);
document.getElementById("clear-analysis").addEventListener("click", clearAnalysis);
document.getElementById("clear-geocoding").addEventListener("click", clearAll);
document.getElementById("set-restaurant-coords").addEventListener("click", () => setPointFromCoords("restaurant"));
document.getElementById("set-customer-coords").addEventListener("click", () => setPointFromCoords("customer"));
exportButton.addEventListener("click", exportGeoJson);
copyRestaurantToCustomerButton.addEventListener("click", copyRestaurantToCustomer);

restaurantQuery.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    searchPlace("restaurant");
  }
});

customerQuery.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    searchPlace("customer");
  }
});

async function handleMapClick(event) {
  if (!isPointInCity(event.latlng.lat, event.latlng.lng)) {
    addLog("Точка должна находиться в пределах Калуги.", "error");
    renderSummary("Для этой лабораторной нужно выбирать точки в пределах Калуги.");
    return;
  }

  const point = {
    lat: event.latlng.lat,
    lon: event.latlng.lng,
    label: state.selectionMode === "restaurant" ? "Ресторан (выбран на карте)" : "Клиент (выбран на карте)"
  };

  try {
    const reverse = await api(`/api/reverse?lat=${point.lat}&lon=${point.lon}`, {
      method: "GET"
    }, `Обратное геокодирование точки ${state.selectionMode}`);

    point.label = reverse.result.displayName || point.label;
  } catch (error) {
    addLog(`Обратное геокодирование не удалось: ${error.message}`, "error");
  }

  if (state.selectionMode === "restaurant") {
    state.restaurant = point;
  } else {
    state.customer = point;
  }

  renderPoints();
  renderSummary();
}

function setSelectionMode(mode) {
  state.selectionMode = mode;
  document.getElementById("mode-restaurant").classList.toggle("is-active", mode === "restaurant");
  document.getElementById("mode-customer").classList.toggle("is-active", mode === "customer");
}

function setInputMode(kind, mode) {
  const isRestaurant = kind === "restaurant";
  const addressPanel = isRestaurant ? restaurantAddressPanel : customerAddressPanel;
  const coordsPanel = isRestaurant ? restaurantCoordsPanel : customerCoordsPanel;
  const addressButton = isRestaurant ? restaurantModeAddressButton : customerModeAddressButton;
  const coordsButton = isRestaurant ? restaurantModeCoordsButton : customerModeCoordsButton;
  const byAddress = mode === "address";

  addressPanel.classList.toggle("hidden-panel", !byAddress);
  coordsPanel.classList.toggle("hidden-panel", byAddress);
  addressButton.classList.toggle("is-active", byAddress);
  coordsButton.classList.toggle("is-active", !byAddress);
}

function addLog(text, level = "info") {
  const item = document.createElement("div");
  item.className = "log-item";
  item.textContent = `${new Date().toLocaleTimeString("ru-RU")} · ${text}`;

  if (level === "error") {
    item.style.borderColor = "rgba(166, 50, 50, 0.25)";
    item.style.background = "rgba(255, 235, 235, 0.8)";
  }

  apiLog.prepend(item);
}

function copyRestaurantToCustomer() {
  if (!state.restaurant) {
    addLog("Сначала нужно задать точку ресторана, чтобы скопировать её клиенту.", "error");
    renderSummary("Сначала задайте ресторан, затем можно сделать клиента в той же точке.");
    return;
  }

  state.customer = {
    lat: state.restaurant.lat,
    lon: state.restaurant.lon,
    label: `${state.restaurant.label} (клиент в той же точке)`
  };

  renderPoints();
  renderSummary("Клиент установлен в ту же точку, что и ресторан.");
  addLog("Клиент установлен в точку ресторана.");
}

function syncCoordinateInputs() {
  if (state.restaurant) {
    restaurantLatInput.value = String(state.restaurant.lat);
    restaurantLonInput.value = String(state.restaurant.lon);
  } else {
    restaurantLatInput.value = "";
    restaurantLonInput.value = "";
  }

  if (state.customer) {
    customerLatInput.value = String(state.customer.lat);
    customerLonInput.value = String(state.customer.lon);
  } else {
    customerLatInput.value = "";
    customerLonInput.value = "";
  }

  renderPointCards();
}

function renderPointCards() {
  if (state.restaurant) {
    restaurantCurrent.classList.remove("empty-status");
    restaurantCurrent.innerHTML = `
      <strong>Текущая точка ресторана</strong>
      <p>${escapeHtml(state.restaurant.label)}</p>
      <p>Координаты: ${formatPoint(state.restaurant.lat, state.restaurant.lon)}</p>
    `;
  } else {
    restaurantCurrent.classList.add("empty-status");
    restaurantCurrent.textContent = "Точка ресторана ещё не выбрана.";
  }

  if (state.customer) {
    customerCurrent.classList.remove("empty-status");
    customerCurrent.innerHTML = `
      <strong>Текущая точка клиента</strong>
      <p>${escapeHtml(state.customer.label)}</p>
      <p>Координаты: ${formatPoint(state.customer.lat, state.customer.lon)}</p>
    `;
  } else {
    customerCurrent.classList.add("empty-status");
    customerCurrent.textContent = "Точка клиента ещё не выбрана.";
  }
}

async function setPointFromCoords(kind) {
  const latInput = kind === "restaurant" ? restaurantLatInput : customerLatInput;
  const lonInput = kind === "restaurant" ? restaurantLonInput : customerLonInput;
  const lat = Number(latInput.value);
  const lon = Number(lonInput.value);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    addLog(`Для ${kind === "restaurant" ? "ресторана" : "клиента"} нужно ввести корректные координаты.`, "error");
    return;
  }

  if (!isPointInCity(lat, lon)) {
    addLog("Точка должна находиться в пределах Калуги.", "error");
    renderSummary("Координаты должны находиться в пределах Калуги.");
    return;
  }

  const point = {
    lat,
    lon,
    label: kind === "restaurant"
      ? `Ресторан: ${formatPoint(lat, lon)}`
      : `Клиент: ${formatPoint(lat, lon)}`
  };

  try {
    const reverse = await api(
      `/api/reverse?lat=${lat}&lon=${lon}`,
      { method: "GET" },
      `Обратное геокодирование по координатам ${kind}`
    );
    point.label = reverse.result.displayName || point.label;
  } catch (error) {
    addLog(`Не удалось определить ближайший адрес по координатам: ${error.message}`, "error");
  }

  if (kind === "restaurant") {
    state.restaurant = point;
  } else {
    state.customer = point;
  }

  renderPoints();
  renderSummary();
  addLog(`${kind === "restaurant" ? "Ресторан" : "Клиент"} установлен по координатам.`);
}

function scheduleMapResize() {
  requestAnimationFrame(() => {
    map.invalidateSize();
  });
}

async function loadHealth() {
  try {
    const data = await api("/api/health", { method: "GET" }, "Загрузка конфигурации провайдеров");
    state.health = data;
    badgeMap.textContent = `Карта: ${data.providers.map}`;
    badgeRouting.textContent = `Маршруты и изохроны: ${data.providers.routing} / ${data.providers.isochrone}`;
  } catch (error) {
    badgeMap.textContent = "Карта: OpenStreetMap tiles";
    badgeRouting.textContent = "Маршруты и изохроны: резервный режим";
  }
}

async function api(url, options, action) {
  const started = performance.now();
  const response = await fetch(url, options);
  let data;

  try {
    data = await response.json();
  } catch (error) {
    addLog(`${action}: сервер вернул некорректный ответ.`, "error");
    throw new Error("Сервер вернул некорректный JSON-ответ.");
  }

  const duration = Math.round(performance.now() - started);

  if (!response.ok || !data.ok) {
    const message = data.error || `Ошибка запроса: ${response.status}`;
    addLog(`${action}: ошибка за ${duration} мс. ${message}`, "error");
    throw new Error(message);
  }

  addLog(`${action}: успешно за ${duration} мс.`);
  return data;
}

async function searchPlace(kind) {
  const input = kind === "restaurant" ? restaurantQuery : customerQuery;
  const container = kind === "restaurant" ? restaurantResults : customerResults;
  const query = input.value.trim();

  if (!query) {
    container.innerHTML = "";
    addLog(`Поиск ${kind === "restaurant" ? "ресторана" : "клиента"} отменён: пустой запрос.`, "error");
    return;
  }

  container.innerHTML = '<div class="result-item">Идёт поиск...</div>';

  try {
    const data = await api(`/api/geocode?q=${encodeURIComponent(query)}`, { method: "GET" }, `Геокодинг: ${query}`);

    if (!data.results.length) {
      container.innerHTML = '<div class="result-item">Ничего не найдено в пределах Калуги.</div>';
      return;
    }

    container.innerHTML = "";
    data.results.forEach((result) => {
      const wrapper = document.createElement("div");
      wrapper.className = "result-item";

      const button = document.createElement("button");
      button.className = "secondary";
      button.innerHTML = `
        <span class="result-title">${escapeHtml(result.name)}</span>
        <span class="result-meta">${escapeHtml(result.displayName)}</span>
      `;

      button.addEventListener("click", () => {
        const point = {
          lat: result.lat,
          lon: result.lon,
          label: result.displayName
        };

        if (kind === "restaurant") {
          state.restaurant = point;
        } else {
          state.customer = point;
        }

        renderPoints();
        renderSummary();
      });

      wrapper.appendChild(button);
      container.appendChild(wrapper);
    });
  } catch (error) {
    container.innerHTML = `<div class="result-item">${escapeHtml(error.message)}</div>`;
  }
}

async function analyze() {
  if (!state.restaurant) {
    addLog("Сначала нужно задать точку ресторана.", "error");
    renderSummary("Сначала задайте ресторан через геокодинг или клик по карте.");
    return;
  }

  try {
    const data = await api("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        restaurant: state.restaurant,
        customer: state.customer,
        minutes: Number(minutesInput.value)
      })
    }, "Комплексный анализ доставки");

    state.currentIsochrone = data.isochrone.geojson;
    renderAnalysis(data);
  } catch (error) {
    renderSummary(error.message);
  }
}

function renderPoints() {
  restaurantLayer.clearLayers();
  customerLayer.clearLayers();
  restaurantMarker = null;
  customerMarker = null;

  if (state.restaurant) {
    const popupHtml = `<strong>Ресторан</strong><br>${escapeHtml(state.restaurant.label || `${state.restaurant.lat}, ${state.restaurant.lon}`)}<br>Координаты: ${formatPoint(state.restaurant.lat, state.restaurant.lon)}`;
    restaurantMarker = DG.marker([state.restaurant.lat, state.restaurant.lon], {
      draggable: true,
      riseOnHover: true,
      icon: DG.divIcon({
        className: "custom-marker restaurant-marker",
        html: "<span>R</span>",
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      })
    })
      .bindPopup(popupHtml)
      .addTo(restaurantLayer);

    restaurantMarker.on("dragend", async (event) => {
      await updatePointFromDrag("restaurant", event.target.getLatLng());
    });
  }

  if (state.customer) {
    const popupHtml = `<strong>Клиент</strong><br>${escapeHtml(state.customer.label || `${state.customer.lat}, ${state.customer.lon}`)}<br>Координаты: ${formatPoint(state.customer.lat, state.customer.lon)}`;
    customerMarker = DG.marker([state.customer.lat, state.customer.lon], {
      draggable: true,
      riseOnHover: true,
      icon: DG.divIcon({
        className: "custom-marker customer-marker",
        html: "<span>C</span>",
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      })
    })
      .bindPopup(popupHtml)
      .addTo(customerLayer);

    customerMarker.on("dragend", async (event) => {
      await updatePointFromDrag("customer", event.target.getLatLng());
    });
  }

  syncCoordinateInputs();
}

async function updatePointFromDrag(kind, latLng) {
  const lat = latLng.lat;
  const lon = latLng.lng;

  if (!isPointInCity(lat, lon)) {
    addLog("Точка должна находиться в пределах Калуги.", "error");
    renderPoints();
    renderSummary("Для этой лабораторной нужно выбирать точки в пределах Калуги.");
    return;
  }

  const point = {
    lat,
    lon,
    label: kind === "restaurant"
      ? "Ресторан (перемещён на карте)"
      : "Клиент (перемещён на карте)"
  };

  try {
    const reverse = await api(`/api/reverse?lat=${lat}&lon=${lon}`, { method: "GET" }, `Обратное геокодирование после перетаскивания ${kind}`);
    point.label = reverse.result.displayName || point.label;
  } catch (error) {
    addLog(`Не удалось уточнить адрес после перетаскивания: ${error.message}`, "error");
  }

  if (kind === "restaurant") {
    state.restaurant = point;
  } else {
    state.customer = point;
  }

  renderPoints();
  renderSummary();
  addLog(`${kind === "restaurant" ? "Ресторан" : "Клиент"} перемещён на карте.`);
}

function renderAnalysis(data) {
  renderPoints();

  isochroneLayer.clearLayers();
  routeLayer.clearLayers();
  geohashLayer.clearLayers();

  DG.geoJSON(data.isochrone.geojson, {
    pane: "isochronePane",
    style: () => ({
      color: "#9e261b",
      weight: 3,
      fillColor: "#dc6a54",
      fillOpacity: 0.32
    })
  }).addTo(isochroneLayer);

  const box = data.geohash.bbox;
  DG.rectangle(
    [
      [box.minLat, box.minLon],
      [box.maxLat, box.maxLon]
    ],
    {
      color: "#8f6a1f",
      weight: 2,
      fillOpacity: 0.06,
      dashArray: "4 4",
      pane: "geohashPane"
    }
  )
    .bindPopup(`Геохеш: ${data.geohash.geohash}`)
    .addTo(geohashLayer);

  if (data.route?.geometry?.coordinates?.length) {
    const routeLatLngs = data.route.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
    DG.polyline(routeLatLngs, {
      color: "#ffffff",
      weight: 8,
      opacity: 0.95,
      pane: "routePane"
    }).addTo(routeLayer);

    DG.polyline(routeLatLngs, {
      color: "#0f766e",
      weight: 5,
      opacity: 0.98,
      pane: "routePane"
    }).addTo(routeLayer);
  }

  const group = DG.featureGroup([
    ...restaurantLayer.getLayers(),
    ...customerLayer.getLayers(),
    ...routeLayer.getLayers(),
    ...isochroneLayer.getLayers(),
    ...geohashLayer.getLayers()
  ]);

  if (group.getLayers().length) {
    map.fitBounds(group.getBounds(), { padding: [30, 30] });
  }

  const cards = [];

  cards.push(summaryCard(
    "Геохеш территории",
    `
      <p>Код: <strong>${data.geohash.geohash}</strong></p>
      <p>Точность: ${data.geohashPrecision} символов</p>
      <p>Центр ячейки: ${formatPoint(data.geohash.center.lat, data.geohash.center.lon)}</p>
    `
  ));

  cards.push(summaryCard(
    "Изохрона пешей доставки",
    `
      <p>Ресторан: ${escapeHtml(data.restaurant.label || "без подписи")}</p>
      <p>Лимит времени: <strong>${data.minutes} мин.</strong></p>
      <p>На карте показана зона, достижимая пешим курьером из ресторана за указанное время.</p>
    `
  ));

  if (data.route) {
    const verdictClass = data.delivery.possible ? "status-success" : "status-fail";
    const verdictText = data.delivery.possible ? "Доставка возможна" : "Доставка невозможна";

    cards.push(summaryCard(
      "Маршрут до клиента",
      `
        <p>Клиент: ${escapeHtml(data.customer.label || "без подписи")}</p>
        <p>Длина маршрута: <strong>${data.route.summary.lengthKm} км</strong></p>
        <p>Время в пути: <strong>${data.route.summary.timeMinutes} мин.</strong></p>
        <p class="${verdictClass}">${verdictText}</p>
        <p>Запас/дефицит времени: ${data.delivery.differenceMinutes} мин.</p>
      `
    ));
  } else {
    cards.push(summaryCard(
      "Проверка маршрута",
      "<p>Клиент не задан, поэтому приложение построило только зону доступности без точечного маршрута.</p>"
    ));
  }

  cards.push(summaryCard(
    "Использованные API",
    `
      <p>1. Геокодинг: ${escapeHtml(state.health?.providers?.geocoding || "не определён")}</p>
      <p>2. Карта: ${escapeHtml(state.health?.providers?.map || "не определена")}</p>
      <p>3. Геохеш: ${escapeHtml(state.health?.providers?.geohash || "не определён")}</p>
      <p>4. Маршрут: ${escapeHtml(state.health?.providers?.routing || "не определён")}</p>
      <p>5. Изохрона: ${escapeHtml(state.health?.providers?.isochrone || "не определена")}</p>
    `
  ));

  summary.classList.remove("empty");
  summary.innerHTML = cards.join("");
}

function renderSummary(message) {
  const parts = [];

  if (message) {
    parts.push(summaryCard("Сообщение", `<p>${escapeHtml(message)}</p>`));
  }

  if (state.restaurant) {
    parts.push(summaryCard("Текущий ресторан", `<p>${escapeHtml(state.restaurant.label)}</p><p>${formatPoint(state.restaurant.lat, state.restaurant.lon)}</p>`));
  }

  if (state.customer) {
    parts.push(summaryCard("Текущий клиент", `<p>${escapeHtml(state.customer.label)}</p><p>${formatPoint(state.customer.lat, state.customer.lon)}</p>`));
  }

  if (!parts.length) {
    summary.classList.add("empty");
    summary.textContent = "Выберите ресторан, при необходимости клиента, затем постройте зону доставки.";
    return;
  }

  summary.classList.remove("empty");
  summary.innerHTML = parts.join("");
}

function summaryCard(title, body) {
  return `<article class="summary-card"><strong>${title}</strong>${body}</article>`;
}

function clearAnalysis() {
  state.currentIsochrone = null;

  routeLayer.clearLayers();
  isochroneLayer.clearLayers();
  geohashLayer.clearLayers();

  renderSummary();

  const group = DG.featureGroup([
    ...restaurantLayer.getLayers(),
    ...customerLayer.getLayers()
  ]);

  if (group.getLayers().length) {
    map.fitBounds(group.getBounds(), { padding: [30, 30] });
  } else {
    map.fitBounds(CITY.bounds, { padding: [20, 20] });
  }

  scheduleMapResize();
  addLog("Результаты анализа очищены, точки ресторана и клиента сохранены.");
}

function clearAll() {
  state.restaurant = null;
  state.customer = null;
  state.currentIsochrone = null;

  restaurantLayer.clearLayers();
  customerLayer.clearLayers();
  routeLayer.clearLayers();
  isochroneLayer.clearLayers();
  geohashLayer.clearLayers();
  restaurantQuery.value = "";
  customerQuery.value = "";
  minutesInput.value = "20";
  restaurantResults.innerHTML = "";
  customerResults.innerHTML = "";
  syncCoordinateInputs();
  renderSummary();
  map.fitBounds(CITY.bounds, { padding: [20, 20] });
  scheduleMapResize();
  addLog("Все поля, точки и результаты анализа очищены.");
}

async function exportGeoJson() {
  if (!state.currentIsochrone) {
    addLog("Сначала постройте изохрону, чтобы экспортировать GeoJSON.", "error");
    return;
  }

  try {
    await navigator.clipboard.writeText(JSON.stringify(state.currentIsochrone, null, 2));
    addLog("GeoJSON изохроны скопирован в буфер обмена.");
  } catch (error) {
    addLog("Не удалось скопировать GeoJSON в буфер обмена. Проверьте разрешения браузера.", "error");
  }
}

function renderExamples() {
  examples.forEach((example) => {
    const wrapper = document.createElement("div");
    wrapper.className = "example-item";

    const title = document.createElement("strong");
    title.textContent = example.title;

    const text = document.createElement("p");
    text.textContent = example.description;

    const button = document.createElement("button");
    button.className = "secondary";
    button.textContent = "Загрузить сценарий";
    button.addEventListener("click", async () => {
      state.restaurant = example.restaurant ? { ...example.restaurant } : null;
      state.customer = example.customer ? { ...example.customer } : null;
      minutesInput.value = example.minutes;
      renderPoints();
      renderSummary();
      if (state.restaurant) {
        await analyze();
      }
    });

    wrapper.appendChild(title);
    wrapper.appendChild(text);
    wrapper.appendChild(button);
    examplesContainer.appendChild(wrapper);
  });
}

function formatPoint(lat, lon) {
  return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

renderExamples();
renderSummary();
renderPointCards();
addLog("Приложение и карта Калуги готовы к демонстрации.");
loadHealth();
setInputMode("restaurant", "address");
setInputMode("customer", "address");

if (typeof DG !== "undefined" && typeof DG.then === "function") {
  DG.then(() => {
    initializeMap();
  });
} else {
  addLog("Не удалось загрузить библиотеку карты 2GIS.", "error");
}
