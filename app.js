"use strict";
// NOAA-20 ATMS-TR results page. Everything comes from data/index.json and the files it
// lists (map PNGs and gzipped int16 profile tiles), written by website/build_site.py.

const $ = (id) => document.getElementById(id);
const S = { day: null, pass: "ascending", var: "t", view: "value", lev: 500, lat: null, lon: null };
const REF_OF = { ifs: "IFS", era5: "ERA5" };
const REF_STYLE = {   // dash pattern per reference on the skew-T
  IFS: { dash: "7 4", width: 1.7, sw: "dash", label: "IFS" },
  ERA5: { dash: "1.5 3.5", width: 2.2, sw: "dot", label: "ERA5" },
};
const PRESETS = { ccny: { lat: 40.82, lon: -73.95 } };
let INDEX = null;
const tileCache = new Map();

// ---------------------------------------------------------------- state & URL
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  for (const k of ["day", "pass", "var", "view"]) if (h.get(k)) S[k] = h.get(k);
  if (h.get("lev")) S.lev = +h.get("lev");
  if (h.get("lat") && h.get("lon")) { S.lat = +h.get("lat"); S.lon = +h.get("lon"); }
}
function writeHash() {
  const h = new URLSearchParams({ day: S.day, pass: S.pass, var: S.var, view: S.view, lev: S.lev });
  if (S.lat !== null) { h.set("lat", S.lat.toFixed(2)); h.set("lon", S.lon.toFixed(2)); }
  history.replaceState(null, "", "#" + h.toString());
}
const dayEntry = () => INDEX.days.find((d) => d.day === S.day);
const passEntry = () => dayEntry().passes[S.pass];
const mapKey = (lev, view = S.view, v = S.var) => `${v}_${view}_${lev}`;
const viewLevels = (view) => INDEX.map_levels.filter((l) => passEntry().maps[mapKey(l, view)]);

// ---------------------------------------------------------------- controls
function setupSeg(id, key) {
  for (const b of $(id).querySelectorAll("button")) {
    b.addEventListener("click", () => { if (!b.disabled) { S[key] = b.dataset.v; render(); } });
  }
}
function syncSeg(id, key, enabled) {
  for (const b of $(id).querySelectorAll("button")) {
    b.classList.toggle("on", b.dataset.v === S[key]);
    b.disabled = enabled ? !enabled(b.dataset.v) : false;
  }
}

function fixState() {
  if (!dayEntry()) S.day = INDEX.days[0].day;
  const passes = dayEntry().passes;
  if (!passes[S.pass]) S.pass = Object.keys(passes)[0];
  if (!viewLevels(S.view).length) S.view = "value";
  const ok = viewLevels(S.view);
  if (!ok.includes(S.lev)) S.lev = ok.includes(500) ? 500 : ok[0];
  return ok;
}

function render() {
  const levs = fixState();
  $("day").value = S.day;
  syncSeg("pass", "pass", (v) => !!dayEntry().passes[v]);
  syncSeg("var", "var");
  syncSeg("view", "view", (v) => viewLevels(v).length > 0);
  $("lev").innerHTML = levs.map((l) => `<option value="${l}">${l} hPa</option>`).join("");
  $("lev").value = S.lev;

  const m = passEntry().maps[mapKey(S.lev)];
  $("map").src = m.img;
  const fieldName = S.var === "t" ? "Temperature" : "Water vapour";
  const unit = S.var === "t" ? "K" : "g/kg";
  const ref = REF_OF[S.view];
  $("map-title").textContent = `${fieldName}${ref ? `, retrieval − ${ref}` : ""}, `
    + `${S.lev} hPa · ${S.day} · ${S.pass} passes`;
  const stops = INDEX.colormaps[ref ? "diff" : "value"];
  $("cbar-ramp").style.background = `linear-gradient(to right, ${stops.join(", ")})`;
  const fmt = (x) => fmtVal(x, m.vmax - m.vmin);
  $("cbar-lo").textContent = fmt(m.vmin);
  $("cbar-mid").textContent = fmt((m.vmin + m.vmax) / 2);
  $("cbar-hi").textContent = fmt(m.vmax);
  $("cbar-title").textContent = ref
    ? `Retrieval − ${ref} (${unit}); red = retrieval warmer / moister`
    : `${fieldName} (${unit})`;
  const missing = ["ifs", "era5"].filter((v) => !viewLevels(v).length).map((v) => REF_OF[v]);
  $("view-hint").textContent = "Click anywhere on the map for a skew-T of the latest retrieval in "
    + `that 1° box. ${ref ? "Dark grey = no match" : "Grey = no data"}.`
    + (missing.length ? ` ${missing.join(" and ")} not matched for this day yet`
      + (missing.includes("ERA5") ? " (ERA5 comes out ~5 days later)." : ".") : "");

  const st = dayEntry().stats || {};
  const figs = INDEX.refs.filter((r) => st[r]);
  $("stats-panel").hidden = !figs.length;
  $("stats").innerHTML = figs.map((r) => `<figure class="stat-fig"><h3>Retrieval − ${r}</h3>`
    + `<img src="${st[r]}" alt="Bias and RMSE of the retrieval against ${r} by level"></figure>`).join("");
  writeHash();
  if (S.lat !== null) showProfile(); else drawMarker();
}

function fmtVal(x, span) {
  const d = span >= 20 ? 0 : span >= 2 ? 1 : span >= 0.2 ? 2 : 3;
  const s = x.toFixed(d);
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s.replace("-", "−");
}

// ---------------------------------------------------------------- picking a point
function pick(lat, lon) {
  S.lat = Math.max(-89.999, Math.min(89.999, lat));
  S.lon = ((((lon + 180) % 360) + 360) % 360) - 180;
  if (S.lon >= 180) S.lon = 179.999;
  $("in-lat").value = S.lat.toFixed(2);
  $("in-lon").value = S.lon.toFixed(2);
  writeHash();
  showProfile();
}

function onMapClick(e) {
  const r = $("map").getBoundingClientRect();
  const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return;
  pick(90 - 180 * fy, -180 + 360 * fx);
}

function onPointSubmit(e) {
  e.preventDefault();
  const num = (s) => parseFloat(String(s).replace("−", "-"));
  const lat = num($("in-lat").value), lon = num($("in-lon").value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 360) {
    $("info").textContent = "Enter a latitude (−90 to 90) and longitude (−180 to 180), e.g. 40.82, −73.95.";
    return;
  }
  pick(lat, lon);
}

function drawMarker() {
  const mk = $("marker");
  if (S.lat === null) { mk.hidden = true; return; }
  const c = INDEX.cell_deg;
  const lon0 = Math.floor(S.lon / c) * c, lat0 = Math.floor(S.lat / c) * c;
  mk.hidden = false;
  mk.style.left = `${((lon0 + c / 2 + 180) / 360) * 100}%`;
  mk.style.top = `${((90 - lat0 - c / 2) / 180) * 100}%`;
  mk.style.width = `${(c / 360) * 100}%`;
  mk.style.height = `${(c / 180) * 100}%`;
}

// ---------------------------------------------------------------- profiles
async function gunzip(buf) {
  const u = new Uint8Array(buf);
  if (u[0] !== 0x1f || u[1] !== 0x8b) return buf;     // a server already unpacked it
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

async function getTile(url) {
  if (!tileCache.has(url)) {
    tileCache.set(url, fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${url}: ${r.status}`);
      return r.arrayBuffer();
    }).then(gunzip).then((b) => new DataView(b)));
  }
  return tileCache.get(url);
}

async function readProfile(pass, lat, lon) {
  const c = INDEX.cell_deg, n = INDEX.tile_deg / c;
  const by = Math.floor((lat + 90) / c), bx = Math.floor((lon + 180) / c);
  const name = INDEX.tile_name.replace("{ty}", Math.floor(by / n)).replace("{tx}", Math.floor(bx / n));
  const dv = await getTile(pass.profiles + name);
  const rec = pass.record, off = ((by % n) * n + (bx % n)) * rec * 2;
  const v = (i) => dv.getInt16(off + 2 * i, true);
  const miss = INDEX.missing;
  if (v(0) === miss) return null;
  const T = (x) => (x === miss ? NaN : x / 100 + 150);
  const Q = (x) => (x === miss ? NaN : Math.pow(10, x / 1000));
  const L = pass.levels.length;
  const prof = { minutes: v(0), p: pass.levels, t: [], q: [], refs: {} };
  for (let k = 0; k < L; k++) { prof.t.push(T(v(1 + k))); prof.q.push(Q(v(1 + L + k))); }
  for (const [ref, info] of Object.entries(pass.refs || {})) {
    const M = info.levels.length, r = { p: info.levels, t: [], q: [] };
    for (let k = 0; k < M; k++) { r.t.push(T(v(info.offset + k))); r.q.push(Q(v(info.offset + M + k))); }
    if (r.t.some(Number.isFinite)) prof.refs[ref] = r;
  }
  return prof;
}

// Dewpoint (deg C) from specific humidity, as plotting/figures.py dewpoint_c.
function dewpoint(q, p) {
  q = Math.max(q, 1e-8);
  const e = (q * p) / (0.622 + 0.378 * q);
  const x = Math.log(e / 6.112);
  return (243.5 * x) / (17.67 - x);
}

const fmtLat = (x) => `${Math.abs(x).toFixed(2)}°${x >= 0 ? "N" : "S"}`;
const fmtLon = (x) => `${Math.abs(x).toFixed(2)}°${x >= 0 ? "E" : "W"}`;
const deg = (x, ns) => `${Math.abs(x)}°${x >= 0 ? ns[0] : ns[1]}`;

async function showProfile() {
  drawMarker();
  const pass = passEntry();
  let prof;
  try { prof = await readProfile(pass, S.lat, S.lon); }
  catch (err) { $("info").textContent = `Couldn't load profile data (${err.message}).`; return; }
  const c = INDEX.cell_deg, lat0 = Math.floor(S.lat / c) * c, lon0 = Math.floor(S.lon / c) * c;
  const where = `<b>${fmtLat(S.lat)}, ${fmtLon(S.lon)}</b> · box ${deg(lat0, "NS")}–${deg(lat0 + c, "NS")}, `
    + `${deg(lon0, "EW")}–${deg(lon0 + c, "EW")}`;
  if (!prof) {
    $("info").innerHTML = `${where}<br>No ${S.pass} retrieval in this box on ${S.day}. `
      + "Try the other pass or a nearby point.";
    $("skewt").innerHTML = ""; $("legend").hidden = true; $("readout").textContent = "";
    return;
  }
  const t = new Date(Date.parse(S.day + "T00:00:00Z") + prof.minutes * 60000);
  const hhmm = t.toISOString().slice(11, 16);
  const refs = Object.keys(prof.refs);
  $("info").innerHTML = `${where}<br>ATMS-TR retrieval at <b>${hhmm} UTC</b> (${S.pass} pass)`
    + (refs.length ? ` · ${refs.join(" and ")} at the same place and time` : " · no IFS/ERA5 match here yet");
  $("legend").innerHTML = `<span><i class="sw t"></i>Temperature</span><span><i class="sw td"></i>Dewpoint</span>`
    + `<span><i class="sw solid"></i>ATMS-TR</span>`
    + refs.map((r) => `<span><i class="sw ${REF_STYLE[r].sw}"></i>${REF_STYLE[r].label}</span>`).join("");
  $("legend").hidden = false;
  drawSkewT(prof);
}

// ---------------------------------------------------------------- skew-T (SVG)
const SK = { W: 560, H: 600, L: 46, R: 14, T: 10, B: 34, pBot: 1050, pTop: 100, tMin: -40, tMax: 50, skew: 75 };
SK.w = SK.W - SK.L - SK.R; SK.h = SK.H - SK.T - SK.B; SK.kx = SK.w / (SK.tMax - SK.tMin);
const yOf = (p) => SK.T + SK.h * (Math.log(p) - Math.log(SK.pTop)) / (Math.log(SK.pBot) - Math.log(SK.pTop));
const xOf = (tc, p) => SK.L + (tc - SK.tMin + SK.skew * (SK.T + SK.h - yOf(p)) / SK.h) * SK.kx;
const pOfY = (y) => Math.exp(Math.log(SK.pTop) + (y - SK.T) / SK.h * (Math.log(SK.pBot) - Math.log(SK.pTop)));

function path(pts, cls, extra = "") {
  let d = "", pen = false;
  for (const [x, y] of pts) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) { pen = false; continue; }
    d += `${pen ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    pen = true;
  }
  return d ? `<path d="${d}" class="${cls}" ${extra}/>` : "";
}

function range(a, b, s) { const r = []; for (let x = a; s > 0 ? x <= b + 1e-9 : x >= b - 1e-9; x += s) r.push(x); return r; }

let BACKGROUND = null;
function background() {
  if (BACKGROUND) return BACKGROUND;
  const g = [];
  const ps = range(SK.pBot, SK.pTop, -10);
  for (const tc of range(-130, 50, 10)) {
    g.push(`<line x1="${xOf(tc, SK.pBot)}" y1="${yOf(SK.pBot)}" x2="${xOf(tc, SK.pTop)}" y2="${yOf(SK.pTop)}" class="iso${tc === 0 ? " zero" : ""}"/>`);
  }
  for (const th of range(250, 470, 10)) {
    g.push(path(ps.map((p) => [xOf(th * Math.pow(p / 1000, 0.2857) - 273.15, p), yOf(p)]), "dry"));
  }
  const Rd = 287.04, cp = 1005.7, Lv = 2.501e6, eps = 0.622;
  const dTdp = (T, p) => {
    const es = 6.112 * Math.exp(17.67 * (T - 273.15) / (T - 29.65));
    const rs = eps * es / (p - es);
    return (Rd * T + Lv * rs) / (p * (cp + Lv * Lv * rs * eps / (Rd * T * T)));
  };
  for (const t0 of range(-8, 36, 4)) {
    let T = t0 + 273.15, p = SK.pBot;
    const pts = [[xOf(t0, p), yOf(p)]];
    while (p > 200) {
      const dp = -5, k1 = dTdp(T, p), k2 = dTdp(T + k1 * dp, p + dp);
      T += 0.5 * (k1 + k2) * dp; p += dp;
      pts.push([xOf(T - 273.15, p), yOf(p)]);
    }
    g.push(path(pts, "moist"));
  }
  for (const w of [0.4, 1, 2, 4, 7, 10, 16, 24]) {
    const pts = range(SK.pBot, 600, -25).map((p) => {
      const e = (w / 1000) * p / (eps + w / 1000), x = Math.log(e / 6.112);
      return [xOf(243.5 * x / (17.67 - x), p), yOf(p)];
    });
    g.push(path(pts, "mix"));
    const [lx, ly] = pts[pts.length - 1];
    g.push(`<text x="${lx}" y="${ly - 3}" class="mixlab" text-anchor="middle">${w}</text>`);
  }
  for (const p of [1000, 925, 850, 700, 500, 400, 300, 250, 200, 150, 100]) {
    g.push(`<line x1="${SK.L}" x2="${SK.L + SK.w}" y1="${yOf(p)}" y2="${yOf(p)}" class="isobar"/>`);
  }
  BACKGROUND = g.join("");
  return BACKGROUND;
}

function profilePaths(p, t, q, clsT, clsD, extra = "") {
  const order = p.map((_, i) => i).filter((i) => p[i] >= SK.pTop - 1e-3).sort((a, b) => p[b] - p[a]);
  return path(order.map((i) => [xOf(t[i] - 273.15, p[i]), yOf(p[i])]), clsT, extra)
    + path(order.map((i) => [xOf(dewpoint(q[i], p[i]), p[i]), yOf(p[i])]), clsD, extra);
}

function drawSkewT(prof) {
  const order = prof.p.map((_, i) => i).filter((i) => prof.p[i] >= SK.pTop - 1e-3);
  const refLines = Object.entries(prof.refs).map(([ref, r]) => {
    const st = REF_STYLE[ref];
    const extra = `stroke-dasharray="${st.dash}" stroke-width="${st.width}" stroke-linecap="round"`;
    return profilePaths(r.p, r.t, r.q, "rt", "rd", extra);
  }).join("");

  const ylab = [1000, 850, 700, 500, 400, 300, 250, 200, 150, 100]
    .map((p) => `<text x="${SK.L - 5}" y="${yOf(p) + 4}" text-anchor="end">${p}</text>`).join("");
  const xlab = range(SK.tMin, SK.tMax, 10)
    .map((t) => `<text x="${xOf(t, SK.pBot)}" y="${SK.T + SK.h + 15}" text-anchor="middle">${t}</text>`).join("");

  $("skewt").innerHTML = `
<svg viewBox="0 0 ${SK.W} ${SK.H}" role="img" aria-label="Skew-T log-p diagram of the retrieved profile">
  <style>
    .iso{stroke:var(--grid);stroke-width:1}.iso.zero{stroke:var(--muted);stroke-dasharray:3 3}
    .isobar{stroke:var(--grid);stroke-width:1}
    .dry{fill:none;stroke:var(--dry);stroke-width:.8;opacity:.45}
    .moist{fill:none;stroke:var(--moist);stroke-width:.8;opacity:.4;stroke-dasharray:5 3}
    .mix{fill:none;stroke:var(--mix);stroke-width:.8;opacity:.5;stroke-dasharray:1.5 3}
    .mixlab{font-size:9px!important;fill:var(--mix)!important;opacity:.8}
    .pt{fill:none;stroke:var(--t);stroke-width:2.4;stroke-linejoin:round}
    .pd{fill:none;stroke:var(--td);stroke-width:2.4;stroke-linejoin:round}
    .rt{fill:none;stroke:var(--t)}.rd{fill:none;stroke:var(--td)}
    .frame{fill:none;stroke:var(--line)}
    .hover{stroke:var(--ink);stroke-width:1;opacity:.5}
  </style>
  <defs><clipPath id="plot"><rect x="${SK.L}" y="${SK.T}" width="${SK.w}" height="${SK.h}"/></clipPath></defs>
  <g clip-path="url(#plot)">
    ${background()}
    ${refLines}
    ${profilePaths(prof.p, prof.t, prof.q, "pt", "pd")}
    <line id="hover" class="hover" x1="${SK.L}" x2="${SK.L + SK.w}" y1="-10" y2="-10"/>
  </g>
  <rect class="frame" x="${SK.L}" y="${SK.T}" width="${SK.w}" height="${SK.h}"/>
  ${ylab}${xlab}
  <text x="${SK.L + SK.w / 2}" y="${SK.H - 3}" text-anchor="middle">Temperature (°C)</text>
  <text transform="translate(11 ${SK.T + SK.h / 2}) rotate(-90)" text-anchor="middle">Pressure (hPa)</text>
  <rect id="hit" x="${SK.L}" y="${SK.T}" width="${SK.w}" height="${SK.h}" fill="transparent"/>
</svg>`;

  const svg = $("skewt").querySelector("svg");
  const hit = $("hit"), hl = $("hover");
  const fmtC = (c) => (Number.isFinite(c) ? `${c.toFixed(1).replace("-", "−")} °C` : "–");
  const readout = (e) => {
    const r = svg.getBoundingClientRect();
    const p = pOfY((e.clientY - r.top) / r.height * SK.H);
    let best = order[0];
    for (const i of order) if (Math.abs(Math.log(prof.p[i] / p)) < Math.abs(Math.log(prof.p[best] / p))) best = i;
    const pb = prof.p[best];
    hl.setAttribute("y1", yOf(pb)); hl.setAttribute("y2", yOf(pb));
    let s = `${+pb.toFixed(1)} hPa · ATMS-TR T ${fmtC(prof.t[best] - 273.15)}, Td ${fmtC(dewpoint(prof.q[best], pb))}`
      + `, q ${(prof.q[best] * 1000).toPrecision(3)} g/kg`;
    for (const [ref, rp] of Object.entries(prof.refs)) {
      const j = rp.p.findIndex((x) => Math.abs(x - pb) < 0.5);
      if (j >= 0 && Number.isFinite(rp.t[j])) {
        s += ` · ${ref} T ${fmtC(rp.t[j] - 273.15)}, Td ${fmtC(dewpoint(rp.q[j], pb))}`;
      }
    }
    $("readout").textContent = s;
  };
  hit.addEventListener("mousemove", readout);
  hit.addEventListener("click", readout);
  hit.addEventListener("mouseleave", () => { hl.setAttribute("y1", -10); hl.setAttribute("y2", -10); });
  $("readout").textContent = "Hover over (or tap) the diagram to read values at each level.";
}

// ---------------------------------------------------------------- start
async function init() {
  try {
    const r = await fetch("data/index.json", { cache: "no-cache" });
    if (!r.ok) throw new Error(r.status);
    INDEX = await r.json();
  } catch (err) {
    $("generated").textContent = location.protocol === "file:"
      ? "Open this page through a web server: python website/build_site.py --serve-only"
      : "No data yet: run python website/build_site.py after the plotter has made maps.";
    return;
  }
  if (!INDEX.days.length) { $("generated").textContent = "No days with maps yet."; return; }
  $("generated").textContent = `${INDEX.satellite} ATMS · updated `
    + `${INDEX.generated_utc.replace("T", " ").replace("+00:00", "")} UTC`;
  $("day").innerHTML = INDEX.days.map((d) =>
    `<option value="${d.day}">${d.day}${d.refs && d.refs.length ? " · " + d.refs.join(" · ") : ""}</option>`).join("");
  readHash();
  setupSeg("pass", "pass"); setupSeg("var", "var"); setupSeg("view", "view");
  $("day").addEventListener("change", (e) => { S.day = e.target.value; render(); });
  $("lev").addEventListener("change", (e) => { S.lev = +e.target.value; render(); });
  $("map-wrap").addEventListener("click", onMapClick);
  $("point").addEventListener("submit", onPointSubmit);
  $("ccny").addEventListener("click", () => pick(PRESETS.ccny.lat, PRESETS.ccny.lon));
  if (S.lat !== null) { $("in-lat").value = S.lat.toFixed(2); $("in-lon").value = S.lon.toFixed(2); }
  render();
}
init();
