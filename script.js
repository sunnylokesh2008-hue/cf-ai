const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const NS = "http://www.w3.org/2000/svg";
const svg = $("#tacticalMap");
const viewport = $("#mapViewport");
const createSvg = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
};
const fmt = n => Number(n || 0).toLocaleString("en-IN");
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const now = () => new Date().toLocaleTimeString("en-GB", { hour12: false }).slice(0, 5);
const api = (url, body) => fetch(url, {
  method: body ? "POST" : "GET",
  headers: body ? { "Content-Type": "application/json" } : {},
  body: body ? JSON.stringify(body) : undefined
}).then(r => r.json());

const state = {
  mode: "operations",
  algorithm: "A*",
  selected: null,
  searchTimer: null,
  running: false,
  speed: 1,
  scenario: null,
  decision: null,
  constraints: [],
  forecast: {},
  algorithms: {},
  cache: {},
  route: { start: "HQ", goal: "V02", result: null, plan: null },
  map: { x: 0, y: 0, zoom: 0.72, tx: 0, ty: 0, tz: 0.72, dragging: false, sx: 0, sy: 0, ox: 0, oy: 0, lastX: 0, lastY: 0, animating: false },
  layers: {
    districts: true, terrain: true, rivers: true, highways: true, roads: true, bridges: true,
    villages: true, warehouses: true, relief: true, commands: true, hazards: true, routes: true,
    vehicles: true, search: true, satellite: false
  },
  ui: { layersOpen: false, routeOpen: false, mapStyle: "gis" }
};

const getNode = id => state.scenario.nodes.find(n => n.id === id);
const scenarioBody = extra => ({ scenario: state.scenario, ...extra });

async function boot() {
  const data = await api("/api/scenario");
  state.scenario = data.scenario;
  state.decision = data.decision;
  state.constraints = data.constraints;
  state.forecast = data.forecast;
  state.algorithms = data.algorithms;
  const initial = state.scenario.map?.initial_view || {};
  state.map.x = initial.x || 580;
  state.map.y = initial.y || 540;
  state.map.zoom = initial.zoom || 0.72;
  state.map.tx = state.map.x;
  state.map.ty = state.map.y;
  state.map.tz = state.map.zoom;
  state.route.goal = state.decision.selected_village.id;
  renderAll();
  buildLayerControl();
  buildRoutePlanner();
  applyMapTransform();
  renderRoute(state.decision.selected_route.path);
  $("#intelPanel").classList.add("hidden");
  setupInteractions();
}

async function refreshIntelligence() {
  const data = await api("/api/decision", scenarioBody());
  state.decision = data.decision;
  state.constraints = data.constraints;
  state.forecast = data.forecast;
  state.cache = {};
  renderAll();
}

async function pythonSearch(algorithm = state.algorithm, start = state.route.start, goal = state.route.goal) {
  const key = `${algorithm}:${start}:${goal}:${JSON.stringify(state.scenario.roads.map(r => [r.id, r.blocked]))}`;
  if (!state.cache[key]) state.cache[key] = await api("/api/search", scenarioBody({ algorithm, start, goal }));
  return state.cache[key];
}

function roadCurve(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const bend = Math.sin((a.x + b.y) * 0.011) * 38;
  const len = Math.max(1, Math.hypot(dx, dy));
  return `M${a.x} ${a.y}Q${mx + (-dy / len) * bend} ${my + (dx / len) * bend} ${b.x} ${b.y}`;
}

function svgRoad(group, a, b, cls, extra = {}) {
  const p = createSvg("path", { d: roadCurve(a, b), class: cls, ...extra });
  group.append(p);
  return p;
}

function renderTerrain() {
  $("#districtLayer").innerHTML = "";
  $("#terrainLayer").innerHTML = "";
  $("#riverLayer").innerHTML = "";
  $("#satelliteLayer").innerHTML = "";
  const map = state.scenario.map || {};
  renderSatellite(map);
  (map.districts || []).forEach(d => {
    const g = createSvg("g", { class: `district district-${d.kind}` });
    g.append(createSvg("path", { d: d.path }));
    const label = createSvg("text", { class: "district-label" });
    const nums = d.path.match(/-?\d+\.?\d*/g).map(Number);
    const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
    label.setAttribute("x", (Math.min(...xs) + Math.max(...xs)) / 2 - 105);
    label.setAttribute("y", (Math.min(...ys) + Math.max(...ys)) / 2);
    label.textContent = d.name.toUpperCase();
    g.append(label);
    $("#districtLayer").append(g);
  });
  for (let i = 0; i < 15; i++) {
    $("#terrainLayer").append(createSvg("path", {
      class: "contour",
      d: `M${-120 + i * 25} ${160 + i * 115}C${420 + i * 40} ${40 + i * 95} ${820 + i * 30} ${310 + i * 110} ${1320 + i * 48} ${190 + i * 88}S${2420 + i * 20} ${360 + i * 96} ${3350} ${210 + i * 102}`
    }));
  }
  (map.lakes || []).forEach(l => {
    const g = createSvg("g", { class: "lake" });
    g.append(createSvg("ellipse", { cx: l.x, cy: l.y, rx: l.rx, ry: l.ry }));
    const t = createSvg("text", { x: l.x - l.rx * .45, y: l.y + 4 });
    t.textContent = l.name.toUpperCase();
    g.append(t);
    $("#riverLayer").append(g);
  });
  (map.rivers || []).forEach(r => {
    const g = createSvg("g", { class: "river-system" });
    g.append(createSvg("path", { d: r.path, class: "river-shadow" }));
    g.append(createSvg("path", { d: r.path, class: "river" }));
    g.append(createSvg("path", { d: r.path, class: "river-line" }));
    $("#riverLayer").append(g);
  });
}

function renderSatellite(map) {
  const layer = $("#satelliteLayer");
  const features = [
    ["forest", "M2460 130L3150 260L3090 980L2600 890L2290 730L2670 460Z"],
    ["forest", "M1600 80L2430 90L2670 460L2290 730L1830 430Z"],
    ["agri", "M90 760L610 610L900 900L760 1500L280 1510L80 1150Z"],
    ["agri", "M1080 1510L1810 1580L2060 2190L870 2210L1080 1800Z"],
    ["urban", "M760 700L1510 680L1670 1080L1280 1330L760 1240L610 900Z"],
    ["industrial", "M300 1510L790 1470L1080 1800L850 2180L190 2040Z"],
    ["coastal", "M2060 1620L3020 1560L3150 2220L2060 2220Z"],
    ["basin", "M1510 690L2260 780L2390 1430L1760 1580L1280 1340L1670 1080Z"]
  ];
  features.forEach(([kind, d]) => layer.append(createSvg("path", { class: `satellite-feature sat-${kind}`, d })));
  for (let i = 0; i < 90; i++) {
    const x = 120 + (i * 197) % 3000;
    const y = 130 + (i * 311) % 2050;
    layer.append(createSvg("circle", { class: "sat-texture", cx: x, cy: y, r: 18 + (i % 9) * 6 }));
  }
}

function renderRoads() {
  $("#roadsLayer").innerHTML = "";
  $("#highwayLayer").innerHTML = "";
  $("#bridgeLayer").innerHTML = "";
  state.scenario.roads.forEach(r => {
    const a = getNode(r.a), b = getNode(r.b);
    if (!a || !b) return;
    const layer = ["national", "state", "highway"].includes(r.road_type) ? $("#highwayLayer") : $("#roadsLayer");
    const g = createSvg("g", { "data-road": r.id, class: `road ${r.road_type || "district"}` });
    svgRoad(g, a, b, "road-shadow");
    svgRoad(g, a, b, "road-base");
    svgRoad(g, a, b, ["national", "state", "highway"].includes(r.road_type) ? "road-lane highway-lane" : "road-lane");
    svgRoad(g, a, b, "road-hit");
    if (r.blocked) svgRoad(g, a, b, "road-blocked");
    g.addEventListener("click", e => { e.stopPropagation(); selectRoad(r); });
    layer.append(g);
    if (r.bridge_status && r.bridge_status !== "intact") {
      const bridge = createSvg("g", { class: `bridge ${r.bridge_status}` });
      const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
      bridge.append(createSvg("rect", { x: x - 18, y: y - 7, width: 36, height: 14, rx: 2 }));
      const t = createSvg("text", { x: x - 21, y: y - 13 });
      t.textContent = r.bridge_status.toUpperCase();
      bridge.append(t);
      $("#bridgeLayer").append(bridge);
    }
  });
}

function renderZones() {
  $("#hazardLayer").innerHTML = "";
  (state.scenario.zones || []).forEach(z => {
    const g = createSvg("g", { class: `dynamic-zone ${z.type}-dynamic` });
    g.append(createSvg("ellipse", { cx: z.x, cy: z.y, rx: z.rx, ry: z.ry }));
    const label = createSvg("text", { x: z.x - z.rx * 0.52, y: z.y + z.ry * 0.15 });
    label.textContent = `${z.id} / ${z.name.toUpperCase()} / SEV ${z.severity}`;
    g.append(label);
    $("#hazardLayer").append(g);
  });
}

function renderNodes() {
  $("#nodesLayer").innerHTML = "";
  state.scenario.nodes.forEach(n => {
    const g = createSvg("g", {
      class: `node ${n.type} ${state.selected?.id === n.id ? "selected" : ""}`,
      transform: `translate(${n.x} ${n.y})`,
      "data-node": n.id
    });
    const size = n.type === "command" ? 25 : n.type === "warehouse" ? 22 : n.type === "relief" ? 18 : n.type === "checkpoint" ? 12 : 12;
    if (n.type === "village") {
      for (let i = 0; i < 6; i++) g.append(createSvg("rect", { class: "hut", x: -17 + (i % 3) * 10, y: -22 + Math.floor(i / 3) * 10, width: 7, height: 7, rx: 1 }));
    }
    g.append(createSvg("circle", { class: "ring", r: size + 8 }), createSvg("circle", { class: "core", r: size / 2 }));
    if (n.type === "warehouse") g.append(createSvg("path", { class: "hub-icon", d: "M-10 8V-6L0-13L10-6V8ZM-5 8V0H5V8" }));
    if (n.type === "command") g.append(createSvg("path", { class: "command-icon", d: "M-13 10L0-15L13 10ZM-4 3H4V10H-4Z" }));
    if (n.type === "relief") g.append(createSvg("rect", { class: "relief-cross", x: -3, y: -11, width: 6, height: 22 }), createSvg("rect", { class: "relief-cross", x: -11, y: -3, width: 22, height: 6 }));
    const label = createSvg("text", { x: size + 18, y: -2, class: "label" });
    label.textContent = n.name;
    const sub = createSvg("text", { x: size + 18, y: 14, class: "sub" });
    sub.textContent = n.type === "village" ? `${n.district || "District"} / ${fmt(n.population)}` : (n.category || n.type).toUpperCase();
    g.append(label, sub);
    g.addEventListener("click", e => { e.stopPropagation(); selectNode(n); });
    $("#nodesLayer").append(g);
  });
}

function renderRoute(path = []) {
  $("#routeLayer").innerHTML = "";
  path.slice(1).forEach((id, i) => {
    const a = getNode(path[i]), b = getNode(id);
    if (a && b) {
      svgRoad($("#routeLayer"), a, b, "route-halo");
      svgRoad($("#routeLayer"), a, b, "road-active");
    }
  });
}

function renderVehicles() {
  $("#vehiclesLayer").innerHTML = "";
  state.scenario.vehicles.forEach(v => {
    const n = getNode(v.at);
    if (!n) return;
    const g = createSvg("g", { class: `vehicle ${v.status === "FAILED" ? "failed" : ""}`, transform: `translate(${n.x - 8} ${n.y + 32})` });
    g.append(createSvg("path", { class: "vehicle-body", d: "M-14 9L-9-11L8-15L16 0L7 13Z" }));
    const t = createSvg("text", { x: -14, y: 4 });
    t.textContent = v.id;
    g.append(t);
    $("#vehiclesLayer").append(g);
  });
}

function renderAlerts() {
  $("#alertCount").textContent = String(state.scenario.alerts.length).padStart(2, "0");
  $("#alertList").innerHTML = state.scenario.alerts.slice(0, 4).map(([level, title, text]) =>
    `<div class="alert ${level === "critical" ? "" : "medium"}"><i></i><div><b>${title}</b><small>${text}</small></div></div>`
  ).join("");
}

function renderTimeline() {
  $("#timelineTrack").innerHTML = state.scenario.timeline.slice(-8).reverse().map(([time, type, text]) =>
    `<div class="event ${type === "ALERT" ? "alert-event" : ""}"><small>${time} / ${type}</small><b>${text}</b></div>`
  ).join("");
}

function metrics() {
  const villages = state.scenario.nodes.filter(n => n.type === "village");
  $("#metricPopulation").textContent = fmt(villages.reduce((s, n) => s + n.population, 0));
  $("#metricServed").textContent = `${String(state.scenario.served).padStart(2, "0")} / ${String(villages.length).padStart(2, "0")}`;
  $("#metricDelivered").textContent = `${state.scenario.delivered}%`;
  const violated = state.constraints.filter(c => !c.satisfied).length;
  $("#metricEfficiency").textContent = (91.4 - violated * 3.2 - (state.scenario.alerts.length - 3) * 1.5).toFixed(1);
}

function renderAll() {
  renderTerrain();
  renderRoads();
  renderZones();
  renderNodes();
  renderVehicles();
  renderAlerts();
  renderTimeline();
  metrics();
  applyLayerVisibility();
  const d = state.decision;
  $("#priorityVillage").textContent = d.selected_village.name;
  $("#priorityReason").textContent = `Python AI score ${d.ranked_villages[0].score} / ${d.selected_route.algorithm} route`;
  $(".confidence i").style.width = `${clamp(d.ranked_villages[0].score, 0, 100)}%`;
  $(".confidence b").textContent = `${Math.round(clamp(d.ranked_villages[0].score, 0, 100))}%`;
  if (state.route.result) renderRoute(state.route.result.path);
  else if (state.mode === "operations") renderRoute(d.selected_route.path);
}

function buildLayerControl() {
  const labels = {
    districts: "Districts", terrain: "Terrain", rivers: "Rivers", highways: "Highways", roads: "Roads",
    bridges: "Bridges", villages: "Villages", warehouses: "Warehouses", relief: "Relief Camps",
    commands: "Command Centers", hazards: "Hazards", vehicles: "Vehicles", routes: "Routes",
    search: "Search Trace", satellite: "Satellite Layer"
  };
  $("#layerControl").innerHTML = `<div class="drawer-head"><b>MAP LAYERS</b><button id="closeLayers">CLOSE</button></div>
    <div class="map-style-switch"><button class="style-btn active" data-map-style="gis">GIS MODE</button><button class="style-btn" data-map-style="satellite">SATELLITE</button></div>
    <div class="layer-grid">${Object.keys(labels).map(k => `<button class="layer-toggle ${state.layers[k] ? "active" : ""}" data-layer-toggle="${k}">${labels[k]}</button>`).join("")}</div>`;
  $("#closeLayers").onclick = () => toggleDrawer("layers", false);
  $$("[data-layer-toggle]").forEach(btn => btn.onclick = () => {
    const key = btn.dataset.layerToggle;
    state.layers[key] = !state.layers[key];
    btn.classList.toggle("active", state.layers[key]);
    if (key === "satellite") state.ui.mapStyle = state.layers.satellite ? "satellite" : "gis";
    applyLayerVisibility();
  });
  $$("[data-map-style]").forEach(btn => btn.onclick = () => setMapStyle(btn.dataset.mapStyle));
}

function applyLayerVisibility() {
  const direct = ["districts", "terrain", "rivers", "highways", "roads", "bridges", "hazards", "routes", "vehicles", "search", "satellite"];
  direct.forEach(key => {
    const visible = state.layers[key];
    $$(`[data-layer="${key}"]`).forEach(el => el.style.display = visible ? "" : "none");
  });
  $("#nodesLayer").style.display = (state.layers.villages || state.layers.warehouses || state.layers.relief || state.layers.commands) ? "" : "none";
  $$("#nodesLayer .village").forEach(el => el.style.display = state.layers.villages ? "" : "none");
  $$("#nodesLayer .warehouse").forEach(el => el.style.display = state.layers.warehouses ? "" : "none");
  $$("#nodesLayer .relief,.checkpoint").forEach(el => el.style.display = state.layers.relief ? "" : "none");
  $$("#nodesLayer .command").forEach(el => el.style.display = state.layers.commands ? "" : "none");
  document.body.classList.toggle("satellite-mode", state.ui.mapStyle === "satellite");
  $$(".style-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.mapStyle === state.ui.mapStyle));
}

function setMapStyle(style) {
  state.ui.mapStyle = style;
  state.layers.satellite = style === "satellite";
  if (style === "satellite") {
    state.layers.terrain = false;
    state.layers.districts = true;
  } else {
    state.layers.terrain = true;
  }
  buildLayerControl();
  applyLayerVisibility();
}

function toggleDrawer(which, force) {
  const key = which === "layers" ? "layersOpen" : "routeOpen";
  state.ui[key] = typeof force === "boolean" ? force : !state.ui[key];
  $("#layerControl").classList.toggle("open", state.ui.layersOpen);
  $("#routePlanner").classList.toggle("open", state.ui.routeOpen);
  $("#layersTab").classList.toggle("active", state.ui.layersOpen);
  $("#routeTab").classList.toggle("active", state.ui.routeOpen);
}

function buildRoutePlanner() {
  const starts = state.scenario.nodes.filter(n => ["warehouse", "command", "relief"].includes(n.type));
  const goals = state.scenario.nodes.filter(n => n.type === "village" || n.type === "relief");
  $("#routeStart").innerHTML = starts.map(n => `<option value="${n.id}">${n.name}</option>`).join("");
  $("#routeGoal").innerHTML = goals.map(n => `<option value="${n.id}">${n.name}</option>`).join("");
  $("#routeAlgorithm").innerHTML = Object.keys(state.algorithms).map(a => `<option value="${a}">${a}</option>`).join("");
  $("#routeStart").value = state.route.start;
  $("#routeGoal").value = state.route.goal;
  $("#routeAlgorithm").value = state.algorithm;
  $("#routeStart").onchange = e => state.route.start = e.target.value;
  $("#routeGoal").onchange = e => state.route.goal = e.target.value;
  $("#routeAlgorithm").onchange = e => { state.algorithm = e.target.value; };
  $("#routeRun").onclick = runRoutePlanner;
  $("#routeCompare").onclick = showComparison;
  $("#routeTab").onclick = () => toggleDrawer("route");
  $("#layersTab").onclick = () => toggleDrawer("layers");
  $("#closeRoute").onclick = () => toggleDrawer("route", false);
}

async function runRoutePlanner() {
  state.route.start = $("#routeStart").value;
  state.route.goal = $("#routeGoal").value;
  state.algorithm = $("#routeAlgorithm").value;
  state.route.plan = await api("/api/route-plan", scenarioBody({
    algorithm: state.algorithm,
    start: state.route.start,
    goal: state.route.goal
  }));
  state.route.result = state.route.plan.route;
  renderRoute(state.route.result.path);
  focusOnPath(state.route.result.path);
  addEvent("PLAN", `${state.algorithm} route ${state.route.start} -> ${state.route.goal} calculated by Python`);
  openPanel("ROUTE PLANNER", "PYTHON ROUTE RESULT", routeResultPanel(state.route.result, state.route.plan));
}

function routeResultPanel(result, plan = null) {
  const summary = plan?.summary || summarizeRoute(result.path);
  const rec = plan?.vehicle_recommendation?.selected;
  const backup = plan?.vehicle_recommendation?.ranked?.find(v => v.id !== rec?.id);
  const supply = plan?.supply_chain;
  const cost = summary.travel_cost ?? summary.travelCost;
  const risk = summary.risk_score ?? summary.riskScore;
  const flood = summary.flood_impact ?? summary.floodImpact;
  const bridge = summary.bridge_status ?? summary.bridgeStatus;
  const explanation = plan?.explanation?.join(" ") || (result.success ? "Python selected this route because the algorithm found a passable chain through current road, flood and bridge constraints." : "No feasible route avoids current restrictions.");
  const vehicleReason = rec?.reasons?.join(" ") || "Vehicle selection is calculated by the decision engine from route risk, capacity, range, road damage, bridge status, and flood impact.";
  return `<div class="intel-block"><div class="intel-row"><span>ALGORITHM</span><b>${result.algorithm}</b></div><div class="intel-row"><span>PATH</span><b>${result.path.join(" -> ") || "NO ROUTE"}</b></div><div class="intel-row"><span>DISTANCE</span><b>${summary.distance} KM</b></div><div class="intel-row"><span>TRAVEL TIME</span><b>${summary.time} MIN</b></div><div class="intel-row"><span>TRAVEL COST</span><b>${cost}</b></div><div class="intel-row"><span>RISK SCORE</span><b class="${risk > 70 ? "warn" : ""}">${risk}</b></div><div class="intel-row"><span>FLOOD IMPACT</span><b>${flood}</b></div><div class="intel-row"><span>BRIDGE STATUS</span><b>${bridge}</b></div><div class="intel-row"><span>BLOCKED ROADS</span><b>${summary.blocked}</b></div><div class="intel-row"><span>PYTHON EXPANSIONS</span><b>${result.expanded}</b></div><div class="intel-row"><span>MEMORY / TIME</span><b>${result.memory} / ${result.execution_time_ms} MS</b></div></div><div class="intel-block"><div class="intel-row"><span>BEST VEHICLE</span><b>${rec ? `${rec.type} / ${rec.id}` : `${state.decision.selected_vehicle.type} / ${state.decision.selected_vehicle.id}`}</b></div><div class="intel-row"><span>CONFIDENCE</span><b>${rec ? `${Math.round(clamp(rec.score, 0, 100))}%` : "AUTO"}</b></div><div class="intel-row"><span>BACKUP VEHICLE</span><b>${backup ? `${backup.type} / ${backup.id}` : "STANDBY FLEET"}</b></div><p class="tiny">Reason: ${vehicleReason}</p></div><div class="intel-block"><p class="tiny">Route Intelligence: ${explanation}</p>${supply ? `<div class="intel-row"><span>SUPPLY SOURCE</span><b>${supply.warehouse.name}</b></div><div class="intel-row"><span>COMMAND CENTER</span><b>${supply.command_center.name}</b></div><p class="tiny">${supply.reasoning.join(" ")}</p>` : ""}<button class="action-btn" onclick="animateSearch()">STEP THROUGH SEARCH</button><button class="action-btn" onclick="showComparison()">COMPARE ALL</button></div>`;
}

function summarizeRoute(path) {
  const roads = [];
  path.slice(1).forEach((id, i) => {
    const a = path[i], b = id;
    const road = state.scenario.roads.find(r => (r.a === a && r.b === b) || (r.a === b && r.b === a));
    if (road) roads.push(road);
  });
  const distance = roads.reduce((s, r) => s + (r.distance || r.cost * 3), 0);
  const travelCost = roads.reduce((s, r) => s + (r.travel_cost || r.cost), 0);
  const riskScore = Math.min(100, Math.round(roads.reduce((s, r) => s + ({ low: 8, moderate: 18, high: 32, critical: 48 }[r.risk] || 14), 0) / Math.max(1, roads.length)));
  const floodImpact = roads.some(r => r.flood_status === "flooded") ? "FLOODED SEGMENTS" : roads.some(r => r.flood_status === "wet") ? "WET CORRIDOR" : "CLEAR";
  const bridgeStatus = roads.some(r => r.bridge_status === "collapsed") ? "COLLAPSED" : roads.some(r => r.bridge_status === "weak") ? "WEAK BRIDGE" : "INTACT";
  return { distance, travelCost, time: Math.max(0, Math.round(distance * 2.1 + riskScore * .35)), riskScore, floodImpact, bridgeStatus, blocked: roads.filter(r => r.blocked).length };
}

function focusOnPath(path) {
  const pts = path.map(getNode).filter(Boolean);
  if (!pts.length) return;
  const minX = Math.min(...pts.map(p => p.x)), maxX = Math.max(...pts.map(p => p.x));
  const minY = Math.min(...pts.map(p => p.y)), maxY = Math.max(...pts.map(p => p.y));
  centerMap((minX + maxX) / 2, (minY + maxY) / 2, clamp(Math.min(innerWidth / Math.max(720, maxX - minX), innerHeight / Math.max(600, maxY - minY)) * .58, .52, 1.22));
}

function overviewPanel() {
  const d = state.decision, violated = state.constraints.filter(c => !c.satisfied).length, cycle = d.agent_cycle;
  return `<div class="intel-block"><p class="tiny">CO1 PYTHON INTELLIGENT AGENT / Observe -> Analyze -> Decide -> Act</p></div>
  <div class="intel-block"><div class="intel-row"><span>PRIORITY TARGET</span><b>${d.selected_village.name}</b></div><div class="intel-row"><span>DISTRICT</span><b>${d.selected_village.district}</b></div><div class="intel-row"><span>WAREHOUSE SOURCE</span><b>${d.selected_warehouse.name}</b></div><div class="intel-row"><span>RECOMMENDED ASSET</span><b>${d.selected_vehicle.id} / ${d.selected_vehicle.type}</b></div><div class="intel-row"><span>PYTHON A* ROUTE</span><b>${d.selected_route.path.join(" -> ")}</b></div></div>
  <div class="intel-block"><div class="intel-row"><span>CONSTRAINT STATUS</span><b class="${violated ? "warn" : "ok"}">${violated ? `${violated} VIOLATED` : "ALL SATISFIED"}</b></div><div class="bar"><i style="width:${100 - violated * 15}%"></i></div><p class="tiny">${d.reasoning.join(" ")}</p></div>
  <div class="intel-block"><div class="intel-row"><span>PROBLEM FORMULATION</span><b>STATE SPACE GRAPH</b></div><p class="tiny">${cycle.observe} Goal state is a feasible delivery route from selected source to target while satisfying resource and road constraints.</p></div>
  <div class="intel-block"><button class="action-btn" onclick="animateSearch()">VISUALIZE PYTHON A*</button><button class="action-btn" onclick="openMode('search')">ROUTE PLANNER</button></div>`;
}

function nodePanel(n) {
  return `<div class="intel-block"><div class="intel-row"><span>TYPE</span><b>${(n.category || n.type).toUpperCase()}</b></div><div class="intel-row"><span>DISTRICT</span><b>${n.district || "-"}</b></div>${n.type === "village" ? `<div class="intel-row"><span>POPULATION</span><b>${fmt(n.population)}</b></div><div class="intel-row"><span>STATUS</span><b>${String(n.status || "unknown").toUpperCase()}</b></div><div class="intel-row"><span>FOOD / WATER / MED</span><b>${n.food_need || 0} / ${n.water_need || 0} / ${n.medicine_need || 0}</b></div><div class="intel-row"><span>ACCESSIBILITY</span><b>${n.accessibility}</b></div><div class="intel-row"><span>PRIORITY / RISK</span><b>${n.priority} / ${n.risk}</b></div><div class="bar"><i style="width:${n.risk}%"></i></div>` : `<div class="intel-row"><span>FOOD</span><b>${fmt(n.food || 0)}</b></div><div class="intel-row"><span>WATER</span><b>${fmt(n.water || 0)}</b></div><div class="intel-row"><span>MEDICINE</span><b>${fmt(n.medicine || 0)}</b></div><div class="intel-row"><span>FUEL</span><b>${fmt(n.fuel || 0)}</b></div><div class="intel-row"><span>KITS / SHELTERS</span><b>${fmt(n.medical_kits || 0)} / ${fmt(n.shelter_units || 0)}</b></div>`}</div>
  <div class="intel-block"><button class="action-btn" onclick="setRouteEndpoint('${n.id}')">SET AS ROUTE POINT</button>${n.type === "village" ? `<button class="action-btn" onclick="adjustPopulation('${n.id}')">+ POPULATION</button><button class="action-btn danger" onclick="removeNode('${n.id}')">REMOVE</button>` : ""}</div>`;
}

function roadPanel(r) {
  return `<div class="intel-block"><div class="intel-row"><span>CORRIDOR</span><b>${r.a} -> ${r.b}</b></div><div class="intel-row"><span>ROAD CLASS</span><b>${r.road_class || r.road_type || "District Road"}</b></div><div class="intel-row"><span>DISTANCE</span><b>${r.distance || r.cost * 3} KM</b></div><div class="intel-row"><span>TRAVEL COST</span><b>${r.travel_cost || r.cost}</b></div><div class="intel-row"><span>RISK</span><b>${String(r.risk || "low").toUpperCase()}</b></div><div class="intel-row"><span>CONDITION</span><b>${String(r.condition || "open").toUpperCase()}</b></div><div class="intel-row"><span>FLOOD / BRIDGE</span><b>${String(r.flood_status || "clear").toUpperCase()} / ${String(r.bridge_status || "intact").toUpperCase()}</b></div><div class="intel-row"><span>STATUS</span><b class="${r.blocked ? "warn" : "ok"}">${r.blocked ? String(r.blockage_type || "BLOCKED").toUpperCase() : "PASSABLE"}</b></div></div><div class="intel-block"><button class="action-btn ${r.blocked ? "" : "danger"}" onclick="toggleRoad('${r.id}')">${r.blocked ? "UNBLOCK ROAD" : "BLOCK ROAD"}</button></div>`;
}

async function searchPanel() {
  const result = await pythonSearch(state.algorithm, state.route.start, state.route.goal);
  const info = state.algorithms[state.algorithm];
  openPanel("CO2 / PYTHON SEARCH", "ROUTE PLANNER LAB", `<div class="intel-block"><p class="tiny">Use the floating route planner to select any source, destination, and algorithm. Python returns path, frontier, queue, stack, open/closed lists, depth, cost, memory, and timing.</p></div>${routeResultPanel(result, state.route.plan)}<div class="intel-block"><p class="tiny">${info.definition}<br>${info.principle}</p></div>`);
}

function constraintsPanel() {
  return `<div class="intel-block"><p class="tiny">CO4 CSP CENTER / Capacity, fuel, warehouse, flood, bridge, road and time constraints shape routing decisions.</p></div>${state.constraints.map(c => `<div class="intel-block"><div class="intel-row"><span>${c.name}</span><b class="${c.satisfied ? "ok" : "warn"}">${c.satisfied ? "SATISFIED" : "VIOLATED"}</b></div><div class="intel-row"><span>SEVERITY</span><b>${c.severity}</b></div><p class="tiny">${c.reason}<br>${c.impact}</p></div>`).join("")}`;
}

function scenarioPanel() {
  const villages = state.scenario.nodes.filter(n => n.type === "village").length;
  const districts = new Set(state.scenario.nodes.map(n => n.district).filter(Boolean)).size;
  return `<div class="intel-block"><p class="tiny">GIS STATE MODEL / ${state.scenario.map.state_name} contains districts, rivers, roads, bridges, warehouses, command centers, hazards, and ${villages} villages.</p></div><div class="intel-block"><div class="intel-row"><span>DISTRICTS</span><b>${districts}</b></div><div class="intel-row"><span>VILLAGES</span><b>${villages}</b></div><div class="intel-row"><span>ROADS</span><b>${state.scenario.roads.length}</b></div><div class="intel-row"><span>HAZARD ZONES</span><b>${(state.scenario.zones || []).length}</b></div></div><div class="intel-block"><button class="action-btn" onclick="addVillage()">+ VILLAGE</button><button class="action-btn" onclick="addWarehouse()">+ WAREHOUSE</button><button class="action-btn" onclick="addRoad()">+ ROAD</button><button class="action-btn" onclick="addHazard()">+ HAZARD ZONE</button></div>`;
}

function analysisPanel() {
  const d = state.decision;
  const forecastRows = Object.entries(state.forecast).map(([k, v]) => `<div class="intel-row"><span>${k.toUpperCase()}</span><b class="${v.risk === "CRITICAL" ? "warn" : ""}">${v.risk} / ${v.coverage}%</b></div>`).join("");
  const top = d.ranked_villages[0];
  const calc = Object.entries(top.breakdown).map(([k, v]) => `<div class="intel-row"><span>${k.toUpperCase()}</span><b>${v}</b></div>`).join("");
  return `<div class="intel-block"><p class="tiny">CO4 DECISION INTELLIGENCE / Disruptions recompute Python route, constraints, ranking, and forecasts.</p></div><div class="intel-block"><button class="whatif-btn" onclick="whatIf('road')">ROAD CLOSURE</button><button class="whatif-btn" onclick="whatIf('bridge')">BRIDGE COLLAPSE</button><button class="whatif-btn" onclick="whatIf('fuel')">FUEL SHORTAGE</button><button class="whatif-btn" onclick="whatIf('vehicle')">VEHICLE FAILURE</button><button class="whatif-btn" onclick="whatIf('flood')">FLOOD EXPANSION</button><button class="whatif-btn" onclick="whatIf('population')">POPULATION INCREASE</button><button class="whatif-btn" onclick="whatIf('warehouse')">WAREHOUSE LOSS</button></div><div class="intel-block"><div class="intel-row"><span>SELECTED VILLAGE</span><b>${d.selected_village.name}</b></div>${d.ranked_villages.slice(0, 8).map(v => `<div class="intel-row"><span>${v.name}</span><b>${v.score} SCORE</b></div>`).join("")}</div><div class="intel-block"><p class="tiny">FINAL SCORE CALCULATION FOR ${top.name}</p>${calc}</div><div class="intel-block"><p class="tiny">FORECASTING</p>${forecastRows}</div>`;
}

function openPanel(kicker, title, html) {
  $("#intelPanel").classList.remove("hidden");
  $("#panelKicker").textContent = kicker;
  $("#panelTitle").textContent = title;
  $("#panelContent").innerHTML = html;
}

function openMode(mode) {
  state.mode = mode;
  $$(".rail-btn").forEach(b => b.classList.toggle("active", b.dataset.mode === mode));
  if (mode === "operations") openPanel("INTELLIGENCE FEED", "MISSION OVERVIEW", overviewPanel());
  if (mode === "search") searchPanel();
  if (mode === "constraints") openPanel("CO3 / CSP MONITOR", "CONSTRAINT CENTER", constraintsPanel());
  if (mode === "scenario") openPanel("GIS SCENARIO", "STATE MAP MODEL", scenarioPanel());
  if (mode === "analysis") openPanel("CO4 / DECISION MAKING", "WHAT-IF ANALYSIS", analysisPanel());
  if (mode === "operations" && !state.route.result) renderRoute(state.decision.selected_route.path);
}

function selectNode(n) {
  state.selected = n;
  renderNodes();
  centerMap(n.x, n.y, Math.max(state.map.zoom, 1.1));
  openPanel("GIS ENTITY", n.name, nodePanel(n));
}

function selectRoad(r) {
  state.selected = r;
  openPanel("ROAD INTELLIGENCE", r.id, roadPanel(r));
}

function setRouteEndpoint(id) {
  const n = getNode(id);
  if (["warehouse", "command", "relief"].includes(n.type)) {
    state.route.start = id;
    $("#routeStart").value = id;
  } else {
    state.route.goal = id;
    $("#routeGoal").value = id;
  }
}

async function toggleRoad(id) {
  const road = state.scenario.roads.find(r => r.id === id);
  road.blocked = !road.blocked;
  addEvent("REPLAN", `${road.id} ${road.blocked ? "closure detected" : "corridor reopened"}`);
  if (road.blocked) addAlert("critical", "ROAD BLOCKED", `${road.id} corridor closure requires Python replanning`);
  await refreshIntelligence();
  openMode("constraints");
}

async function setAlgorithm(algorithm) {
  state.algorithm = algorithm;
  $("#routeAlgorithm").value = algorithm;
  await runRoutePlanner();
}

async function showComparison() {
  const start = $("#routeStart").value || state.route.start;
  const goal = $("#routeGoal").value || state.route.goal;
  const data = await api("/api/compare", scenarioBody({ start, goal }));
  const rows = data.rows.map(r => `<div><b>${r.algorithm}</b><div class="meter"><i style="width:${r.quality}%"></i></div></div><span>${r.cost * 3}km / ${r.expanded} exp / ${r.memory} mem / ${r.time}ms</span>`).join("");
  openPanel("CO2 / PYTHON BENCHMARK", "ALGORITHM COMPARISON LAB", `<div class="intel-block"><p class="tiny">Same route: ${start} -> ${goal}. Python benchmark shows cost, path length, execution time, memory, expanded nodes, completeness and quality.</p><div class="comparison">${rows}</div></div>`);
}

async function animateSearch() {
  clearInterval(state.searchTimer);
  const result = state.route.result || await pythonSearch(state.algorithm, state.route.start, state.route.goal);
  $("#searchLayer").innerHTML = "";
  renderRoute([]);
  let i = 0;
  state.searchTimer = setInterval(() => {
    if (i >= result.steps.length) {
      clearInterval(state.searchTimer);
      renderRoute(result.path);
      addEvent("AI PLAN", `${result.algorithm} selected ${result.path.join(" -> ")} in Python`);
      return;
    }
    $("#searchLayer").innerHTML = "";
    const step = result.steps[i++], current = getNode(step.current);
    if (!current) return;
    $("#searchLayer").append(createSvg("circle", { cx: current.x, cy: current.y, r: 32, class: "search-current" }));
    step.visited.forEach(id => {
      const n = getNode(id);
      if (n) $("#searchLayer").append(createSvg("circle", { cx: n.x, cy: n.y, r: 20, class: "search-ring" }));
    });
    step.candidates.forEach(id => {
      const n = getNode(id);
      if (n) svgRoad($("#searchLayer"), current, n, "candidate");
    });
    $("#panelContent").insertAdjacentHTML("afterbegin", `<div class="intel-block"><div class="intel-row"><span>EXPANDING</span><b>${step.current}</b></div><div class="intel-row"><span>FRONTIER</span><b>${step.frontier.join(", ") || "EMPTY"}</b></div><div class="intel-row"><span>OPEN / CLOSED</span><b>${(step.open_list || []).join(", ") || "-"} / ${(step.closed_list || []).length}</b></div><div class="intel-row"><span>QUEUE</span><b>${step.queue.join(", ") || "-"}</b></div><div class="intel-row"><span>STACK</span><b>${step.stack.join(", ") || "-"}</b></div><div class="intel-row"><span>g / h / f</span><b>${step.g} / ${step.h} / ${step.f}</b></div><p class="tiny">${step.explanation}</p></div>`);
  }, 620 / state.speed);
}

async function whatIf(type) {
  if (type === "road") {
    const road = state.scenario.roads.find(r => !r.blocked && r.risk === "high");
    if (road) road.blocked = true;
    addAlert("critical", "ROAD CLOSURE", `${road?.id || "EAST"} closed by field report`);
  }
  if (type === "bridge") {
    const road = state.scenario.roads.find(r => r.bridge_status === "weak");
    if (road) { road.blocked = true; road.bridge_status = "collapsed"; }
    addAlert("critical", "BRIDGE COLLAPSE", `${road?.id || "bridge"} unavailable`);
  }
  if (type === "fuel") {
    state.scenario.vehicles.forEach(v => v.fuel = clamp(v.fuel - 25, 0, 100));
    state.scenario.resources.fuel = Math.max(0, state.scenario.resources.fuel - 900);
    addAlert("medium", "FUEL SHORTAGE", "Fuel reserves reduced by disruption");
  }
  if (type === "vehicle") {
    state.scenario.vehicles[0].status = "FAILED";
    addAlert("critical", "VEHICLE FAILURE", "TR-14 removed from available fleet");
  }
  if (type === "flood") {
    state.scenario.nodes.filter(n => n.type === "village").forEach(n => { n.risk = clamp(n.risk + 7, 0, 100); n.demand = clamp(n.demand + 4, 0, 100); });
    addAlert("critical", "FLOOD EXPANSION", "Hazard envelope expanded across basin villages");
  }
  if (type === "population") adjustPopulation(state.route.goal || state.decision.selected_village.id, false);
  if (type === "warehouse") {
    state.scenario.resources.water = Math.round(state.scenario.resources.water * 0.58);
    state.scenario.resources.medicine = Math.round(state.scenario.resources.medicine * 0.62);
    addAlert("critical", "WAREHOUSE LOSS", "Stock damage recorded at forward hub");
  }
  addEvent("REPLAN", `${type.toUpperCase()} what-if applied`);
  await refreshIntelligence();
  openMode("analysis");
}

async function adjustPopulation(id, refresh = true) {
  const n = getNode(id);
  if (!n) return;
  n.population += 650;
  n.demand = clamp(n.demand + 5, 0, 100);
  n.priority = clamp(n.priority + 3, 0, 100);
  addEvent("ALERT", `${n.name} population estimate increased`);
  if (refresh) {
    await refreshIntelligence();
    selectNode(n);
  }
}

async function removeNode(id) {
  if (["HQ", "CC", "NW"].includes(id)) return;
  state.scenario.nodes = state.scenario.nodes.filter(n => n.id !== id);
  state.scenario.roads = state.scenario.roads.filter(r => r.a !== id && r.b !== id);
  addEvent("REPLAN", `${id} removed from scenario`);
  await refreshIntelligence();
  buildRoutePlanner();
  openMode("scenario");
}

async function addVillage() {
  const i = state.scenario.nodes.length + 1, id = `NV${i}`;
  const node = { id, name: `NEW SETTLEMENT ${i}`, type: "village", x: 1220 + Math.random() * 850, y: 1220 + Math.random() * 620, population: 1200, demand: 55, priority: 60, risk: 48, stock: 0, district: "River Basin District", accessibility: 52 };
  state.scenario.nodes.push(node);
  state.scenario.roads.push({ id: `R-${state.scenario.roads.length + 1}`, a: "FOB", b: id, cost: 6, distance: 18, blocked: false, road_type: "district", condition: "open", risk: "moderate", flood_status: "wet", bridge_status: "intact" });
  addEvent("SCENARIO", `${node.name} added to theatre`);
  await refreshIntelligence();
  buildRoutePlanner();
  openMode("scenario");
}

async function addWarehouse() {
  const i = state.scenario.nodes.length + 1, id = `WH${i}`;
  const node = { id, name: `LOGISTICS NODE ${i}`, type: "warehouse", category: "District Warehouse", x: 780 + Math.random() * 450, y: 1350 + Math.random() * 260, population: 0, demand: 0, priority: 0, risk: 20, stock: 4300, district: "Industrial District", food: 5000, water: 9000, medicine: 1400, fuel: 2200 };
  state.scenario.nodes.push(node);
  state.scenario.roads.push({ id: `R-${state.scenario.roads.length + 1}`, a: "FW", b: id, cost: 5, distance: 15, blocked: false, road_type: "highway", condition: "open", risk: "low", flood_status: "clear", bridge_status: "intact" });
  addEvent("SCENARIO", `${node.name} added`);
  await refreshIntelligence();
  buildRoutePlanner();
  openMode("scenario");
}

async function addRoad() {
  const blocked = state.scenario.roads.find(r => r.blocked);
  if (blocked) {
    blocked.blocked = false;
    blocked.condition = "open";
    addEvent("SCENARIO", `${blocked.id} restored as emergency corridor`);
  } else addEvent("SCENARIO", "Select a road on-map to manage its state");
  await refreshIntelligence();
  openMode("scenario");
}

async function addHazard() {
  state.scenario.zones.push({ id: `HZ-${state.scenario.zones.length + 1}`, type: "flood", name: "New Flood Advisory", x: 1500, y: 1350, rx: 260, ry: 130, severity: 61, affects: [] });
  addAlert("medium", "HAZARD ZONE", "New hazard contour added to operational forecast");
  await refreshIntelligence();
  openMode("scenario");
}

function addEvent(type, text) {
  state.scenario.timeline.push([now(), type, text]);
  renderTimeline();
}

function addAlert(level, title, text) {
  state.scenario.alerts.unshift([level, title, text]);
  renderAlerts();
  metrics();
}

async function runSimulation() {
  if (state.running) return;
  state.running = true;
  $("#runSim").innerHTML = "<i></i> RESPONSE ACTIVE";
  const route = state.route.result || state.decision.selected_route;
  const vehicleDecision = state.decision.selected_vehicle;
  const vehicle = state.scenario.vehicles.find(v => v.id === vehicleDecision.id) || state.scenario.vehicles[0];
  renderRoute(route.path);
  addEvent("DISPATCH", `${vehicle.id} dispatched on ${route.path.join(" -> ")}`);
  for (const id of route.path) {
    await new Promise(resolve => setTimeout(resolve, 650 / state.speed));
    vehicle.at = id;
    renderVehicles();
    addEvent("TRANSIT", `${vehicle.id} reached ${id}`);
  }
  state.scenario.delivered = clamp(state.scenario.delivered + 14, 0, 100);
  state.scenario.served = clamp(state.scenario.served + 1, 0, state.scenario.nodes.filter(n => n.type === "village").length);
  state.scenario.resources.water = Math.max(0, state.scenario.resources.water - state.decision.selected_village.demand * 10);
  addEvent("DELIVERY", `${vehicle.id} completed route delivery`);
  await refreshIntelligence();
  state.running = false;
  $("#runSim").innerHTML = "<i></i> RUN RESPONSE";
  openMode("operations");
}

function academicMode() {
  const modal = $("#academicTemplate").content.cloneNode(true);
  document.body.append(modal);
  $(".modal-close").onclick = () => $(".academic-modal").remove();
  $("#academicDetail").innerHTML = Object.entries(state.algorithms).map(([key, info]) =>
    `<b>${key} // ${info.name}</b><br>Definition: ${info.definition}<br>Working Principle: ${info.principle}<br>Advantages: ${info.advantages}<br>Disadvantages: ${info.disadvantages}<br>Time: ${info.time} // Space: ${info.space}<br><br>`
  ).join("");
}

function setupInteractions() {
  $$(".rail-btn").forEach(btn => btn.onclick = () => openMode(btn.dataset.mode));
  $("#panelClose").onclick = () => $("#intelPanel").classList.add("hidden");
  $("#runSim").onclick = runSimulation;
  $("#academicBtn").onclick = academicMode;
  $("#soundBtn").onclick = () => $("#soundBtn").textContent = $("#soundBtn").textContent === "SND" ? "MUT" : "SND";
  $("#analysisToggle").onclick = () => {
    const active = document.body.classList.toggle("analysis-mode");
    $("#analysisToggle").setAttribute("aria-pressed", String(active));
  };
  $("#speedBtn").onclick = () => {
    state.speed = state.speed === 1 ? 2 : state.speed === 2 ? 4 : 1;
    $("#speedBtn").textContent = `${state.speed}x`;
  };
  $$("[data-tool]").forEach(b => b.onclick = () => {
    if (b.dataset.tool === "zoomIn") zoomAt(innerWidth / 2, innerHeight / 2, 1.075);
    if (b.dataset.tool === "zoomOut") zoomAt(innerWidth / 2, innerHeight / 2, 0.935);
    if (b.dataset.tool === "center") centerMap(state.decision.selected_village.x, state.decision.selected_village.y, 0.92);
    if (b.dataset.tool === "fit") centerMap(1640, 1125, 0.5);
  });
  svg.addEventListener("dblclick", e => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, 1.12);
  });
  svg.addEventListener("pointerdown", e => {
    if (e.target.closest(".node,.road")) return;
    e.preventDefault();
    state.map.dragging = true;
    state.map.sx = e.clientX;
    state.map.sy = e.clientY;
    state.map.ox = state.map.tx;
    state.map.oy = state.map.ty;
    state.map.lastX = e.clientX;
    state.map.lastY = e.clientY;
    svg.setPointerCapture(e.pointerId);
    svg.classList.add("dragging");
  });
  svg.addEventListener("pointermove", e => {
    e.preventDefault();
    const pt = screenToMap(e.clientX, e.clientY);
    $("#coordinates").textContent = `LAT ${(19.85 + pt.y / 12000).toFixed(4)} N // LNG ${(84.95 + pt.x / 12000).toFixed(4)} E // Z ${state.map.zoom.toFixed(2)}x`;
    if (!state.map.dragging) return;
    state.map.tx = state.map.ox - (e.clientX - state.map.sx) / state.map.tz;
    state.map.ty = state.map.oy - (e.clientY - state.map.sy) / state.map.tz;
    state.map.lastX = e.clientX;
    state.map.lastY = e.clientY;
    clampMapTarget();
    state.map.x = state.map.tx;
    state.map.y = state.map.ty;
    state.map.zoom = state.map.tz;
    applyMapTransform();
  }, { passive: false });
  svg.addEventListener("pointerup", e => {
    state.map.dragging = false;
    svg.classList.remove("dragging");
    try { svg.releasePointerCapture(e.pointerId); } catch {}
  });
  svg.addEventListener("pointercancel", () => {
    state.map.dragging = false;
    svg.classList.remove("dragging");
  });
  svg.addEventListener("wheel", e => {
    e.preventDefault();
    const factor = clamp(Math.exp(-e.deltaY * 0.00105), 0.925, 1.08);
    zoomAt(e.clientX, e.clientY, factor);
  }, { passive: false });
  window.addEventListener("resize", () => {
    state.map.tz = clamp(state.map.tz, minMapZoom(), 1.55);
    state.map.zoom = clamp(state.map.zoom, minMapZoom(), 1.55);
    clampMapTarget();
    scheduleMapRender();
  });
}

function screenToMap(clientX, clientY) {
  const rect = svg.getBoundingClientRect();
  return { x: state.map.x + (clientX - rect.left) / state.map.zoom, y: state.map.y + (clientY - rect.top) / state.map.zoom };
}

function minMapZoom() {
  const map = state.scenario?.map || { width: 3200, height: 2300 };
  const rect = svg.getBoundingClientRect();
  return clamp(Math.max(rect.width / map.width, rect.height / map.height) * 1.01, 0.48, 0.82);
}

function zoomAt(clientX, clientY, factor) {
  const before = screenToMap(clientX, clientY);
  state.map.tz = clamp(state.map.tz * factor, minMapZoom(), 1.55);
  const rect = svg.getBoundingClientRect();
  state.map.tx = before.x - (clientX - rect.left) / state.map.tz;
  state.map.ty = before.y - (clientY - rect.top) / state.map.tz;
  scheduleMapRender();
}

function centerMap(x, y, zoom = state.map.zoom) {
  state.map.tz = clamp(zoom, minMapZoom(), 1.55);
  const rect = svg.getBoundingClientRect();
  state.map.tx = x - rect.width / (2 * state.map.tz);
  state.map.ty = y - rect.height / (2 * state.map.tz);
  scheduleMapRender();
}

function clampMapTarget() {
  const map = state.scenario?.map || { width: 3200, height: 2300 };
  const rect = svg.getBoundingClientRect();
  const viewW = rect.width / state.map.tz;
  const viewH = rect.height / state.map.tz;
  state.map.tx = viewW >= map.width ? (map.width - viewW) / 2 : clamp(state.map.tx, 0, map.width - viewW);
  state.map.ty = viewH >= map.height ? (map.height - viewH) / 2 : clamp(state.map.ty, 0, map.height - viewH);
}

function applyMapTransform() {
  const rect = svg.getBoundingClientRect();
  svg.setAttribute("viewBox", `${state.map.x} ${state.map.y} ${rect.width / state.map.zoom} ${rect.height / state.map.zoom}`);
  updateMapDetail();
}

function scheduleMapRender() {
  clampMapTarget();
  if (!state.map.animating) {
    state.map.animating = true;
    requestAnimationFrame(animateMap);
  }
}

function animateMap() {
  const ease = state.map.dragging ? 0.7 : 0.16;
  state.map.x += (state.map.tx - state.map.x) * ease;
  state.map.y += (state.map.ty - state.map.y) * ease;
  state.map.zoom += (state.map.tz - state.map.zoom) * 0.18;
  applyMapTransform();
  const moving = Math.abs(state.map.tx - state.map.x) + Math.abs(state.map.ty - state.map.y) + Math.abs(state.map.tz - state.map.zoom) > 0.004;
  if (moving) requestAnimationFrame(animateMap);
  else {
    state.map.x = state.map.tx;
    state.map.y = state.map.ty;
    state.map.zoom = state.map.tz;
    applyMapTransform();
    state.map.animating = false;
  }
}

function updateMapDetail() {
  const z = state.map.zoom;
  svg.classList.toggle("zoom-low", z < 0.62);
  svg.classList.toggle("zoom-mid", z >= 0.62 && z < 1.1);
  svg.classList.toggle("zoom-high", z >= 1.1);
  document.body.classList.toggle("map-zoom-low", z < 0.62);
  document.body.classList.toggle("map-zoom-high", z >= 1.1);
  $$("#nodesLayer .label").forEach(label => label.style.fontSize = `${clamp(15 / z, 10, 23)}px`);
  $$("#nodesLayer .sub").forEach(label => label.style.fontSize = `${clamp(10 / z, 7, 14)}px`);
  $$(".district-label").forEach(label => label.style.fontSize = `${clamp(26 / z, 18, 42)}px`);
}

setInterval(() => { $("#missionClock").textContent = new Date().toLocaleTimeString("en-GB", { hour12: false }); }, 1000);
boot();
