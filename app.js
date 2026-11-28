"use strict";
// NOAA-20 ATMS-TR results page. Everything comes from data/index.json and the files it
// lists (map PNGs and gzipped int16 profile tiles), written by website/build_site.py.

const $ = (id) => document.getElementById(id);
const S = { day: null, pass: "ascending", var: "t", view: "value", ref: "ifs", lev: 500, lat: null, lon: null,
  group: "lat", hide: [] };   // hide: references switched off on the skew-T
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
  for (const k of ["day", "pass", "var", "view", "ref"]) if (h.get(k)) S[k] = h.get(k);
  if (S.view === "ifs" || S.view === "era5") { S.ref = S.view; S.view = "diff"; }  // older links
  if (h.get("lev")) S.lev = +h.get("lev");
  if (["global", "lat", "surface"].includes(h.get("group"))) S.group = h.get("group");
  if (h.get("hide")) S.hide = h.get("hide").split(",").filter((r) => r in REF_STYLE);
  if (h.get("lat") && h.get("lon")) { S.lat = +h.get("lat"); S.lon = +h.get("lon"); }
}
function writeHash() {
  const h = new URLSearchParams({ day: S.day, pass: S.pass, var: S.var, view: S.view, ref: S.ref, lev: S.lev,
    group: S.group });
  if (S.lat !== null) { h.set("lat", S.lat.toFixed(2)); h.set("lon", S.lon.toFixed(2)); }
  if (S.hide.length) h.set("hide", S.hide.join(","));
  history.replaceState(null, "", "#" + h.toString());
}
const dayEntry = () => INDEX.days.find((d) => d.day === S.day);
const passEntry = () => dayEntry().passes[S.pass];
// file key of a view: value = retrieval; ifs/era5 = the reference; ifsdiff/era5diff = difference
const viewKey = (view = S.view, ref = S.ref) => (view === "value" ? "value" : view === "ref" ? ref : `${ref}diff`);
const mapKey = (lev, view = S.view, ref = S.ref, v = S.var) => `${v}_${viewKey(view, ref)}_${lev}`;
const viewLevels = (view, ref = S.ref) =>
  INDEX.map_levels.filter((l) => passEntry().maps[mapKey(l, view, ref)]);
const refAvailable = (ref) => viewLevels("diff", ref).length > 0 || viewLevels("ref", ref).length > 0;

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
  if (!refAvailable(S.ref)) S.ref = ["ifs", "era5"].find(refAvailable) || S.ref;
  if (!viewLevels(S.view).length) S.view = "value";
  const ok = viewLevels(S.view);
  if (!ok.includes(S.lev)) S.lev = ok.includes(500) ? 500 : ok[0];
  return ok;
}

// numbers in the stats line: K to 0.01 (below 10) or 0.1; g/kg to 0.001 (below 1), 0.01 or 0.1
function num(x, unit, signed = false) {
  if (!Number.isFinite(x)) return "–";
  const a = Math.abs(x);
  let s = unit === "K" ? x.toFixed(a < 10 ? 2 : 1) : x.toFixed(a >= 10 ? 1 : a >= 1 ? 2 : 3);
  if (signed && x > 0) s = "+" + s;
  return s.replace("-", "−");
}

function statsLine(m, unit, ref) {
  const st = m.stats;
  if (!st) return "";
  const parts = [`N ${st.n.toLocaleString("en-US")}`, `min ${num(st.min, unit)}`, `max ${num(st.max, unit)}`];
  if (S.view === "diff") {
    parts.push(`bias ${num(st.mean, unit, true)}`, `SD ${num(st.sd, unit)} ${unit}`);
  } else {
    parts.push(`mean ${num(st.mean, unit)} ${unit}`);
    const d = passEntry().maps[mapKey(S.lev, "diff", S.ref)];
    if (S.view === "value" && d && d.stats) {
      parts.push(`bias vs ${ref} ${num(d.stats.mean, unit, true)} ± ${num(d.stats.sd, unit)} ${unit}`);
    }
  }
  return parts.join(" · ");
}

function render() {
  const levs = fixState();
  $("day").value = S.day;
  syncSeg("pass", "pass", (v) => !!dayEntry().passes[v]);
  syncSeg("var", "var");
  syncSeg("view", "view", (v) => viewLevels(v).length > 0);
  syncSeg("ref", "ref", refAvailable);
  $("lev").innerHTML = levs.map((l) => `<option value="${l}">${l} hPa</option>`).join("");
  $("lev").value = S.lev;

  const m = passEntry().maps[mapKey(S.lev)];
  $("map").src = withV(m.img);
  const fieldName = S.var === "t" ? "Temperature" : "Water vapour";
  const unit = S.var === "t" ? "K" : "g/kg";
  const ref = REF_OF[S.ref];
  const what = S.view === "value" ? "ATMS-TR retrieval" : S.view === "ref" ? ref : `retrieval − ${ref}`;
  $("map-title").textContent = `${fieldName}, ${what}, ${S.lev} hPa · ${S.day} · ${S.pass} passes`;
  $("map-stats").textContent = statsLine(m, unit, ref);
  const stops = INDEX.colormaps[S.view === "diff" ? "diff" : "value"];
  $("cbar-ramp").style.background = `linear-gradient(to right, ${stops.join(", ")})`;
  const fmt = (x) => fmtVal(x, m.vmax - m.vmin);
  $("cbar-lo").textContent = fmt(m.vmin);
  $("cbar-mid").textContent = fmt((m.vmin + m.vmax) / 2);
  $("cbar-hi").textContent = fmt(m.vmax);
  const fixed = (INDEX.diff_limits || {})[S.var];
  $("cbar-title").textContent = S.view === "diff"
    ? `Retrieval − ${ref} (${unit}), ${fixed ? `fixed ±${fixed} ${unit}` : "scaled to this map"}; `
      + "red = retrieval warmer / moister"
    : S.view === "ref" ? `${ref} ${fieldName.toLowerCase()} (${unit}), same scale as the retrieval map`
      : `${fieldName} (${unit})`;
  const missing = ["ifs", "era5"].filter((r) => !refAvailable(r)).map((r) => REF_OF[r]);
  $("view-hint").textContent = "Click anywhere on the map for a skew-T of the latest retrieval in "
    + `that 1° box. ${S.view === "value" ? "Grey = no data" : "Dark grey = no match"}. Statistics `
    + "use every footprint of the day and pass (the map shows the newest one per 0.4° cell)."
    + (missing.length ? ` ${missing.join(" and ")} not matched for this day yet`
      + (missing.includes("ERA5") ? " (ERA5 comes out ~5 days later)." : ".") : "");

  writeHash();
  if (S.lat !== null) showProfile(); else drawMarker();
  renderScatter();
  renderProfiles();
}

// Shown where a panel needs IFS/ERA5 and the selected day doesn't have it (yet).
function noMatchText(ref) {
  const which = ref || "IFS or ERA5";
  const others = INDEX.days.filter((d) => d.day !== S.day && d.refs && d.refs.length).map((d) => d.day);
  return `No ${which} match for ${S.day} yet. IFS is matched within minutes of the data, `
    + "ERA5 about 5 days behind. "
    + (others.length ? `Days that have one are marked in the Day menu (e.g. ${others[0]}).`
      : "No day has been matched yet.");
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

// A data file's address carries its day's build stamp, so a rebuilt day is never read
// from a browser's (or GitHub's) cached copy of the previous build.
const withV = (url) => `${url}?v=${dayEntry().v || ""}`;

// bytes: the size the index says a tile has. A different size means a copy from another
// build (its records wouldn't line up): fetch it again past every cache, else give up.
async function getTile(url, bytes) {
  const load = (opts) => fetch(url, opts).then((r) => {
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.arrayBuffer();
  }).then(gunzip);
  if (!tileCache.has(url)) {
    tileCache.set(url, load().then((b) => (b.byteLength === bytes ? b : load({ cache: "reload" })))
      .then((b) => {
        if (b.byteLength !== bytes) {
          tileCache.delete(url);
          throw new Error("the site is being updated; try again in a few minutes");
        }
        return new DataView(b);
      }));
  }
  return tileCache.get(url);
}

async function readProfile(pass, lat, lon) {
  const c = INDEX.cell_deg, n = INDEX.tile_deg / c;
  const by = Math.floor((lat + 90) / c), bx = Math.floor((lon + 180) / c);
  const name = INDEX.tile_name.replace("{ty}", Math.floor(by / n)).replace("{tx}", Math.floor(bx / n));
  const dv = await getTile(withV(pass.profiles + name), n * n * pass.record * 2);
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
  const sfc = pass.surface;                      // surface pressure (IFS), hPa * 10
  const sp = sfc && sfc.source ? v(sfc.offset) / 10 : NaN;
  prof.sp = sp > 300 && sp < 1100 ? sp : null;
  prof.spSource = sfc ? sfc.source : null;
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
    $("skewt").innerHTML = ""; $("legend").hidden = true; $("readout").textContent = ""; $("cape").innerHTML = "";
    return;
  }
  const t = new Date(Date.parse(S.day + "T00:00:00Z") + prof.minutes * 60000);
  const hhmm = t.toISOString().slice(11, 16);
  const refs = Object.keys(prof.refs);
  $("info").innerHTML = `${where}<br>ATMS-TR retrieval at <b>${hhmm} UTC</b> (${S.pass} pass)`
    + (refs.length ? ` · ${refs.join(" and ")} at the same place and time` : " · no IFS/ERA5 match here yet");
  $("legend").innerHTML = `<span><i class="sw t"></i>Temperature</span><span><i class="sw td"></i>Dewpoint</span>`
    + `<span><i class="sw solid"></i>ATMS-TR</span>`
    + refs.map((r) => `<button type="button" class="lg-toggle" data-ref="${r}" aria-pressed="${!S.hide.includes(r)}" `
      + `title="Show or hide the ${REF_STYLE[r].label} lines"><i class="sw ${REF_STYLE[r].sw}"></i>${REF_STYLE[r].label}</button>`).join("")
    + (prof.sp !== null ? `<span><i class="sw sfc"></i>Surface (${prof.spSource})</span>` : "")
    + `<span><i class="sw parcel"></i>Surface parcel</span>`
    + `<span><i class="box cape"></i>CAPE</span><span><i class="box cin"></i>CIN</span>`;
  $("legend").hidden = false;
  $("legend").querySelectorAll(".lg-toggle").forEach((b) => b.addEventListener("click", () => {
    const r = b.dataset.ref;
    S.hide = S.hide.includes(r) ? S.hide.filter((x) => x !== r) : [...S.hide, r];
    b.setAttribute("aria-pressed", String(!S.hide.includes(r)));
    writeHash();
    drawSkewT(prof);
  }));
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

// CAPE/CIN of the surface-based and most-unstable parcels (static/parcel.js). With a
// surface pressure the parcel starts at the surface (or the lowest level, if that is
// above the surface); without one, at the lowest level (1000 hPa).
function parcels(p, t, q, sp) {
  const a = aboveSurface(p, t, q, sp);
  const sb = parcelAnalysis(a.p, a.t, a.q), mu = mostUnstable(a.p, a.t, a.q);
  return sb ? { sb, mu } : null;
}

function parcelLayers(sb) {
  if (!sb) return "";
  const P = (pts) => pts.map(([tc, pp]) => `${xOf(tc, pp).toFixed(1)},${yOf(pp).toFixed(1)}`).join(" ");
  const seg = (lo, hi) => sb.path.filter((x) => x.p <= lo + 1e-9 && x.p >= hi - 1e-9);
  let out = "";
  if (sb.pLFC !== null) {
    const capeSeg = seg(sb.pLFC, sb.pEL), cinSeg = seg(sb.p0, sb.pLFC);
    const poly = (s) => P(s.map((x) => [x.T - 273.15, x.p]).concat(s.slice().reverse().map((x) => [x.Te - 273.15, x.p])));
    if (cinSeg.length > 1) out += `<polygon points="${poly(cinSeg)}" class="cin"/>`;
    if (capeSeg.length > 1) out += `<polygon points="${poly(capeSeg)}" class="cape"/>`;
  }
  out += path(sb.path.map((x) => [xOf(x.T - 273.15, x.p), yOf(x.p)]), "parcel");
  return out;
}

function capeTable(prof) {
  const rows = [["ATMS-TR", prof.parcels]].concat(
    Object.entries(prof.refs).map(([ref, r]) => [ref, parcels(r.p, r.t, r.q, prof.sp)]));
  const n = (x) => (x === null || x === undefined || !Number.isFinite(x) ? "–" : Math.round(x).toLocaleString("en-US").replace("-", "−"));
  const hpa = (x) => (x === null || x === undefined || !Number.isFinite(x) ? "–" : String(Math.round(x)));
  const body = rows.filter(([, a]) => a).map(([name, a]) => `<tr><th>${name}</th>`
    + `<td>${n(a.sb.cape)}</td><td>${a.sb.cin === 0 ? "0" : n(a.sb.cin)}</td>`
    + `<td>${hpa(a.sb.pLCL)}</td><td>${hpa(a.sb.pLFC)}</td><td>${hpa(a.sb.pEL)}</td>`
    + `<td>${a.mu ? `${n(a.mu.cape)} <span class="dim">from ${hpa(a.mu.p0)}</span>` : "–"}</td></tr>`).join("");
  return `<table class="cape"><thead><tr><th></th><th>CAPE</th><th>CIN</th><th>LCL</th><th>LFC</th><th>EL</th><th>MU CAPE</th></tr></thead>`
    + `<tbody>${body}</tbody></table>`
    + `<p class="hint">CAPE and CIN in J/kg (virtual-temperature corrected); LCL, LFC and EL in hPa. `
    + (prof.sp !== null
      ? `The surface-based parcel starts at the surface: ${prof.spSource} surface pressure here is `
        + `${Math.round(prof.sp)} hPa (solid line)` + (prof.sp > 1000
          ? `, below the lowest retrieval level, so the parcel starts at 1000 hPa. `
          : `; the levels below it are left out. `)
      : `No IFS surface pressure for this footprint yet, so the surface-based parcel starts at 1000 hPa; `
        + `over high ground (where 1000 hPa is below the surface) these numbers aren't meaningful. `)
    + `MU = the most unstable parcel in the lowest 300 hPa above the surface.${prof.refs.IFS ? " IFS has only 12 levels up to 100 hPa, so its values are rougher." : ""}</p>`;
}

function drawSkewT(prof) {
  const order = prof.p.map((_, i) => i).filter((i) => prof.p[i] >= SK.pTop - 1e-3);
  prof.parcels = parcels(prof.p, prof.t, prof.q, prof.sp);
  // the ground: a solid line at the surface pressure, shaded below
  const ys = prof.sp !== null && prof.sp > SK.pTop && prof.sp < SK.pBot ? yOf(prof.sp) : null;
  const ground = ys === null ? "" : `<rect class="ground" x="${SK.L}" y="${ys}" width="${SK.w}" height="${SK.T + SK.h - ys}"/>`;
  const surface = ys === null ? "" : `<line class="sfc" x1="${SK.L}" x2="${SK.L + SK.w}" y1="${ys}" y2="${ys}"/>`
    + `<text class="sfclab" x="${SK.L + SK.w - 6}" y="${ys - 5}" text-anchor="end">Surface ${Math.round(prof.sp)} hPa (${prof.spSource})</text>`;
  const refLines = Object.entries(prof.refs).filter(([ref]) => !S.hide.includes(ref)).map(([ref, r]) => {
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
    .parcel{fill:none;stroke:var(--ink);stroke-width:1.4;stroke-dasharray:4 3;opacity:.85}
    .cape{fill:#e34948;fill-opacity:.18;stroke:none}.cin{fill:#2a78d6;fill-opacity:.18;stroke:none}
    .ground{fill:var(--muted);fill-opacity:.12}.sfc{stroke:var(--ink);stroke-width:2}
    .sfclab{font-size:11px;fill:var(--ink)!important;font-weight:600;paint-order:stroke;stroke:var(--panel);stroke-width:3px}
  </style>
  <defs><clipPath id="plot"><rect x="${SK.L}" y="${SK.T}" width="${SK.w}" height="${SK.h}"/></clipPath></defs>
  <g clip-path="url(#plot)">
    ${background()}
    ${ground}
    ${parcelLayers(prof.parcels && prof.parcels.sb)}
    ${refLines}
    ${profilePaths(prof.p, prof.t, prof.q, "pt", "pd")}
    ${surface}
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
    for (const [ref, rp] of Object.entries(prof.refs).filter(([r]) => !S.hide.includes(r))) {
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
  $("cape").innerHTML = capeTable(prof);
}

// ---------------------------------------------------------------- density scatter
// Retrieval (y) against the reference (x) over the same 0.4° cells, for the selected
// day, pass, level and reference. Counts per bin come precomputed (scatter.bin.gz).
// density: jet (few footprints = dark blue, through cyan and yellow, most = dark red)
const DENSITY = ["#000080", "#0000e8", "#0038ff", "#0094ff", "#0cf4eb", "#56ffa0", "#a0ff56",
  "#ebff0c", "#ffab00", "#ff5500", "#e80000", "#800000"];      // matplotlib's jet, 12 steps
const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
};
const scatterCache = new Map();
let scatterToken = 0;

function getScatter(url) {
  if (!scatterCache.has(url)) {
    scatterCache.set(url, fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${url}: ${r.status}`);
      return r.arrayBuffer();
    }).then(gunzip).then((b) => new DataView(b)));
  }
  return scatterCache.get(url);
}

function niceTicks(lo, hi, n = 5) {
  const raw = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw);
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

async function renderScatter() {
  const token = ++scatterToken;
  const sc = passEntry().scatter;
  const ref = REF_OF[S.ref];
  const panel = $("scatter-panel");
  panel.hidden = false;
  if (!sc || !["t", "q"].some((v) => sc.plots[`${v}_${S.ref}_${S.lev}`])) {
    $("scatter-title").textContent = `Retrieval vs ${ref} · ${S.lev} hPa · ${S.day} · ${S.pass} passes`;
    $("sc-t").innerHTML = `<p class="hint">${noMatchText(ref)}</p>`;
    $("sc-q").innerHTML = "";
    return;
  }
  panel.hidden = false;
  $("scatter-title").textContent = `Retrieval vs ${ref} · ${S.lev} hPa · ${S.day} · ${S.pass} passes`;
  let dv;
  try { dv = await getScatter(withV(sc.file)); } catch (e) { $("scatter-sub").textContent = `Couldn't load (${e.message}).`; return; }
  if (token !== scatterToken) return;     // the selection changed meanwhile
  for (const v of ["t", "q"]) drawScatter($(`sc-${v}`), dv, sc, v, ref);
}

function drawScatter(fig, dv, sc, v, ref) {
  const plot = sc.plots[`${v}_${S.ref}_${S.lev}`];
  const name = v === "t" ? "Temperature" : "Water vapour", unit = v === "t" ? "K" : "g/kg";
  if (!plot) { fig.innerHTML = `<h3>${name}</h3><p class="hint">No ${ref} match at this level yet.</p>`; return; }
  const NB = sc.bins, base = plot.i * NB * NB * 4;
  const counts = new Uint32Array(NB * NB);
  let max = 0;
  for (let k = 0; k < NB * NB; k++) { counts[k] = dv.getUint32(base + 4 * k, true); if (counts[k] > max) max = counts[k]; }
  const ramp = DENSITY;
  const colour = (c) => ramp[max <= 1 ? ramp.length - 1 : Math.round(Math.log(c) / Math.log(max) * (ramp.length - 1))];
  const cv = document.createElement("canvas");
  cv.width = NB; cv.height = NB;
  const cx = cv.getContext("2d");
  for (let j = 0; j < NB; j++) {          // row j = y bin j (bottom up)
    for (let i = 0; i < NB; i++) {
      const c = counts[j * NB + i];
      if (!c) continue;
      cx.fillStyle = colour(c);
      cx.fillRect(i, NB - 1 - j, 1, 1);
    }
  }
  const W = 340, L = 54, R = 10, T = 8, B = 42, P = W - L - R, H = T + P + B;
  const { lo, hi } = plot, k = P / (hi - lo);
  const X = (val) => L + (val - lo) * k, Y = (val) => T + P - (val - lo) * k;
  const fmt = (x) => fmtVal(x, hi - lo);
  const ticks = niceTicks(lo, hi);
  const grid = ticks.map((t) => `<line x1="${X(t)}" x2="${X(t)}" y1="${T}" y2="${T + P}" class="g"/>`
    + `<line x1="${L}" x2="${L + P}" y1="${Y(t)}" y2="${Y(t)}" class="g"/>`
    + `<text x="${X(t)}" y="${T + P + 15}" text-anchor="middle">${fmt(t)}</text>`
    + `<text x="${L - 5}" y="${Y(t) + 4}" text-anchor="end">${fmt(t)}</text>`).join("");
  const pct = plot.n ? (100 * plot.outside / plot.n) : 0;
  fig.innerHTML = `<h3>${name}</h3>
<p class="map-stats">N ${plot.n.toLocaleString("en-US")} · bias ${num(plot.bias, unit, true)} · RMSE ${num(plot.rmse, unit)}`
    + ` · SD ${num(plot.sd, unit)} ${unit} · r ${Number.isFinite(plot.r) ? plot.r.toFixed(3) : "–"}`
    + `${pct >= 0.1 ? ` · ${pct.toFixed(1)}% outside the plotted range` : ""}</p>
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${name}: retrieval against ${ref} at ${S.lev} hPa, density of footprints">
  <style>.g{stroke:#ffffff;stroke-width:1}.one{stroke:#3a3936;stroke-width:1.2;stroke-dasharray:5 4;opacity:.7}
  .fr{fill:none;stroke:#b7b6af}.hl{fill:none;stroke:#0b0b0b;stroke-width:1.5}
  text{font:11px system-ui,sans-serif;fill:#52514e;font-variant-numeric:tabular-nums}</style>
  <rect x="0" y="0" width="${W}" height="${H}" rx="4" fill="#ffffff"/>
  <rect x="${L}" y="${T}" width="${P}" height="${P}" fill="#ecebe6"/>
  ${grid}
  <image href="${cv.toDataURL()}" x="${L}" y="${T}" width="${P}" height="${P}" preserveAspectRatio="none" style="image-rendering:pixelated"/>
  <line x1="${L}" y1="${T + P}" x2="${L + P}" y2="${T}" class="one"/>
  <rect class="fr" x="${L}" y="${T}" width="${P}" height="${P}"/>
  <rect class="hl" x="-10" y="-10" width="${P / NB}" height="${P / NB}" visibility="hidden"/>
  <text x="${L + P / 2}" y="${H - 6}" text-anchor="middle">${ref} (${unit})</text>
  <text transform="translate(13 ${T + P / 2}) rotate(-90)" text-anchor="middle">ATMS-TR retrieval (${unit})</text>
  <rect class="hit" x="${L}" y="${T}" width="${P}" height="${P}" fill="transparent"/>
</svg>
<div class="sc-key"><span>1</span><i style="background:linear-gradient(to right, ${ramp.join(", ")})"></i><span>${max.toLocaleString("en-US")} footprints per bin (log scale)</span></div>
<p class="hint sc-read">Hover over the plot to read the number of footprints in a bin. Dashed line = 1:1.</p>`;
  const svg = fig.querySelector("svg"), hl = fig.querySelector(".hl"), read = fig.querySelector(".sc-read");
  const binW = (hi - lo) / NB;
  fig.querySelector(".hit").addEventListener("mousemove", (e) => {
    const r = svg.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width * W, py = (e.clientY - r.top) / r.height * H;
    const i = Math.min(NB - 1, Math.max(0, Math.floor((px - L) / P * NB)));
    const j = Math.min(NB - 1, Math.max(0, Math.floor((T + P - py) / P * NB)));
    hl.setAttribute("x", L + i * P / NB); hl.setAttribute("y", T + P - (j + 1) * P / NB);
    hl.setAttribute("visibility", "visible");
    const xr = `${num(lo + i * binW, unit)} to ${num(lo + (i + 1) * binW, unit)}`;
    const yr = `${num(lo + j * binW, unit)} to ${num(lo + (j + 1) * binW, unit)}`;
    read.textContent = `${ref} ${xr} ${unit}, retrieval ${yr} ${unit}: `
      + `${counts[j * NB + i].toLocaleString("en-US")} footprints`;
  });
  fig.querySelector(".hit").addEventListener("mouseleave", () => hl.setAttribute("visibility", "hidden"));
}

// ---------------------------------------------------------------- bias / RMSE by level
// Retrieval − IFS and retrieval − ERA5 for the whole day (both passes, every matched
// footprint), one row each, on the same axes so the two can be compared directly.
const GROUP_SETS = {
  global: ["global"],
  lat: ["global", "tropics", "nmid", "smid", "npolar", "spolar"],
  surface: ["global", "ocean", "land"],
};
// same colours as the earlier figures: globe in ink, then the categorical palette
const GROUP_COLOR = { global: "var(--ink)", tropics: "#2a78d6", nmid: "#eb6834", smid: "#1baf7a",
  npolar: "#eda100", spolar: "#e87ba4", ocean: "#2a78d6", land: "#eb6834" };
const PANELS = [
  { v: "t", s: "bias", name: "Temperature bias", unit: "K" },
  { v: "t", s: "rmse", name: "Temperature RMSE", unit: "K" },
  { v: "q", s: "bias", name: "Water vapour bias", unit: "g/kg" },
  { v: "q", s: "rmse", name: "Water vapour RMSE", unit: "g/kg" },
];
const SUM_TOP = 100, SUM_BOT = 1000;      // the title numbers pool these levels
const PR = { W: 236, H: 300, L: 40, R: 12, T: 8, B: 34 };
PR.w = PR.W - PR.L - PR.R; PR.h = PR.H - PR.T - PR.B;
const profCache = new Map();
let profToken = 0;

function getProfiles(url) {
  if (!profCache.has(url)) {
    profCache.set(url, fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${url}: ${r.status}`);
      return r.json();
    }));
  }
  return profCache.get(url);
}

// axis from lo to hi on round numbers
function niceAxis(lo, hi, n = 4) {
  if (!(hi > lo)) { hi = lo + 1; }
  const raw = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw);
  lo = Math.floor(lo / step + 1e-9) * step; hi = Math.ceil(hi / step - 1e-9) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 1e6; v += step) ticks.push(+v.toFixed(10));
  return { lo, hi, ticks };
}

// pooled over the given level indices: N, bias and RMSE of every footprint-level
function pooled(g, v, idx) {
  let n = 0, sb = 0, sr = 0;
  for (const i of idx) {
    const c = g[`n_${v}`][i], b = g[`${v}_bias`][i], r = g[`${v}_rmse`][i];
    if (!c || b === null || r === null) continue;
    n += c; sb += c * b; sr += c * r * r;
  }
  return n ? { n, bias: sb / n, rmse: Math.sqrt(sr / n) } : null;
}

const fmtN = (n) => n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : n >= 1e4 ? `${(n / 1e3).toFixed(0)} k` : n.toLocaleString("en-US");

async function renderProfiles() {
  const token = ++profToken;
  const entry = dayEntry();
  $("stats-panel").hidden = false;
  $("prof-title").textContent = `Retrieval − reference by level · ${S.day}, whole day`;
  if (!entry.profile_stats) { $("stats").innerHTML = `<p class="hint">${noMatchText()}</p>`; return; }
  let data;
  try { data = await getProfiles(withV(entry.profile_stats)); } catch (e) {
    $("stats").innerHTML = `<p class="hint">Couldn't load the statistics (${e.message}).</p>`; return;
  }
  if (token !== profToken) return;
  const refs = INDEX.refs.filter((r) => data.refs[r]);
  if (!refs.length) { $("stats").innerHTML = `<p class="hint">${noMatchText()}</p>`; return; }
  const label = Object.fromEntries(data.groups.map((g) => [g.key, g.label]));
  const groups = GROUP_SETS[S.group];

  // shared axes: pressure over every level of every reference shown (so IFS's chart goes
  // as high as ERA5's), and per column one x range across both references
  const allP = refs.flatMap((r) => data.refs[r].levels);
  const pTop = Math.min(...allP) * 0.85, pBot = 1050;
  const ext = PANELS.map((pn) => {
    let lo = Infinity, hi = -Infinity;
    for (const r of refs) for (const g of groups) {
      const gs = data.refs[r].groups[g];
      if (!gs) continue;
      gs[`${pn.v}_${pn.s}`].forEach((x, i) => {
        if (x === null || !gs[`n_${pn.v}`][i]) return;
        lo = Math.min(lo, x); hi = Math.max(hi, x);
      });
    }
    if (!Number.isFinite(lo)) return niceAxis(pn.s === "bias" ? -1 : 0, 1);
    if (pn.s === "bias") { const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1; return niceAxis(-m, m); }
    return niceAxis(0, hi || 1);
  });
  // title numbers: the levels from 1000 to 100 hPa that every reference shown has
  const sumLevels = refs.map((r) => data.refs[r].levels.filter((p) => p >= SUM_TOP && p <= SUM_BOT))
    .reduce((a, b) => a.filter((p) => b.includes(p)));
  $("prof-sub").textContent = "Every matched footprint of the day, both passes. Numbers in the titles: "
    + `all footprints over the ${sumLevels.length} level(s) from ${SUM_BOT} to ${SUM_TOP} hPa`
    + `${refs.length > 1 ? " that both references have" : ""}. Dashed line: the level selected above.`;

  $("stats").innerHTML = refs.map((r) => profRow(r, data.refs[r], groups, label, ext, pTop, pBot, sumLevels)).join("");
  $("stats").querySelectorAll(".prof-row").forEach((row) => hookProfRow(row, data.refs[row.dataset.ref],
    groups, label, pTop, pBot));
}

function profRow(ref, rd, groups, label, ext, pTop, pBot, sumLevels) {
  const idx = sumLevels.map((p) => rd.levels.indexOf(p));
  const glob = rd.groups.global;
  const nFoot = glob ? Math.max(...glob.n_t) : 0;
  const Y = (p) => PR.T + PR.h * (Math.log(p) - Math.log(pTop)) / (Math.log(pBot) - Math.log(pTop));
  const pTicks = [1000, 500, 300, 200, 100, 50, 20, 10, 5, 2, 1].filter((p) => p >= pTop && p <= pBot);
  const charts = PANELS.map((pn, c) => {
    const ax = ext[c];
    const X = (x) => PR.L + PR.w * (x - ax.lo) / (ax.hi - ax.lo);
    const g0 = glob && pooled(glob, pn.v, idx);
    const head = `${pn.name} · ${g0 ? `${num(g0[pn.s], pn.unit, pn.s === "bias")} ${pn.unit}` : "–"}`;
    const grid = ax.ticks.map((t) => `<line class="g" x1="${X(t)}" x2="${X(t)}" y1="${PR.T}" y2="${PR.T + PR.h}"/>`
      + `<text x="${X(t)}" y="${PR.T + PR.h + 14}" text-anchor="middle">${fmtVal(t, ax.hi - ax.lo)}</text>`).join("")
      + pTicks.map((p) => `<line class="g" x1="${PR.L}" x2="${PR.L + PR.w}" y1="${Y(p)}" y2="${Y(p)}"/>`
        + `<text x="${PR.L - 5}" y="${Y(p) + 4}" text-anchor="end">${p}</text>`).join("");
    const zero = pn.s === "bias" ? `<line class="z" x1="${X(0)}" x2="${X(0)}" y1="${PR.T}" y2="${PR.T + PR.h}"/>` : "";
    const sel = S.lev >= pTop && S.lev <= pBot
      ? `<line class="sel" x1="${PR.L}" x2="${PR.L + PR.w}" y1="${Y(S.lev)}" y2="${Y(S.lev)}"/>` : "";
    // globe last, so it's drawn on top of the groups
    const lines = [...groups].reverse().map((g) => {
      const gs = rd.groups[g];
      if (!gs) return "";
      const vals = gs[`${pn.v}_${pn.s}`], ns = gs[`n_${pn.v}`];
      const segs = []; let cur = [];
      rd.levels.forEach((p, i) => {
        if (vals[i] === null || !ns[i]) { if (cur.length) segs.push(cur); cur = []; return; }
        cur.push([X(vals[i]), Y(p)]);
      });
      if (cur.length) segs.push(cur);
      const col = GROUP_COLOR[g], wide = g === "global" ? 2.2 : 1.6;
      return segs.map((sg) => `<polyline fill="none" stroke="${col}" stroke-width="${wide}" stroke-linejoin="round" `
        + `points="${sg.map((q) => q.map((x) => x.toFixed(1)).join(",")).join(" ")}"/>`
        + sg.map((q) => `<circle cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="${wide}" fill="${col}"/>`).join("")).join("");
    }).join("");
    return `<figure class="prof-fig"><h4>${head}</h4>
<svg viewBox="0 0 ${PR.W} ${PR.H}" role="img" aria-label="${pn.name} of the retrieval against ${ref} by pressure level">
  <rect class="bg" x="${PR.L}" y="${PR.T}" width="${PR.w}" height="${PR.h}"/>
  ${grid}${zero}${sel}${lines}
  <rect class="fr" x="${PR.L}" y="${PR.T}" width="${PR.w}" height="${PR.h}"/>
  <line class="guide" x1="${PR.L}" x2="${PR.L + PR.w}" y1="0" y2="0" visibility="hidden"/>
  <text x="${PR.L + PR.w / 2}" y="${PR.H - 4}" text-anchor="middle">${pn.unit}</text>
  ${c === 0 ? `<text transform="translate(10 ${PR.T + PR.h / 2}) rotate(-90)" text-anchor="middle">hPa</text>` : ""}
  <rect class="hit" x="${PR.L}" y="${PR.T}" width="${PR.w}" height="${PR.h}" fill="transparent"/>
</svg></figure>`;
  }).join("");
  const shown = groups.filter((g) => rd.groups[g]);
  const table = groups.length > 1 ? `<table class="cape prof-table"><thead><tr><th></th><th>Footprints</th>`
    + `<th>T bias</th><th>T RMSE</th><th>q bias</th><th>q RMSE</th></tr></thead><tbody>`
    + shown.map((g) => {
      const t = pooled(rd.groups[g], "t", idx), q = pooled(rd.groups[g], "q", idx);
      return `<tr><th><i class="sw" style="background:${GROUP_COLOR[g]}"></i>${label[g]}</th>`
        + `<td>${fmtN(Math.max(...rd.groups[g].n_t))}</td>`
        + `<td>${t ? num(t.bias, "K", true) : "–"} K</td><td>${t ? num(t.rmse, "K") : "–"} K</td>`
        + `<td>${q ? num(q.bias, "g/kg", true) : "–"} g/kg</td><td>${q ? num(q.rmse, "g/kg") : "–"} g/kg</td></tr>`;
    }).join("") + `</tbody></table>` : "";
  return `<div class="prof-row" data-ref="${ref}">
<h3>Retrieval − ${ref} <span class="map-stats">· ${fmtN(nFoot)} footprints · ${rd.levels.length} levels, `
    + `${Math.max(...rd.levels)}–${Math.min(...rd.levels)} hPa</span></h3>
<div class="prof-charts">${charts}</div>
<p class="hint prof-read">Hover over a chart to read the values at a level.</p>${table}</div>`;
}

function hookProfRow(row, rd, groups, label, pTop, pBot) {
  const ref = row.dataset.ref;
  const pOf = (y) => Math.exp(Math.log(pTop) + (y - PR.T) / PR.h * (Math.log(pBot) - Math.log(pTop)));
  const Y = (p) => PR.T + PR.h * (Math.log(p) - Math.log(pTop)) / (Math.log(pBot) - Math.log(pTop));
  const guides = [...row.querySelectorAll(".guide")];
  row.querySelectorAll("svg").forEach((svg) => {
    const hit = svg.querySelector(".hit");
    hit.addEventListener("mousemove", (e) => {
      const r = svg.getBoundingClientRect();
      const p = pOf((e.clientY - r.top) / r.height * PR.H);
      let k = 0;
      rd.levels.forEach((lv, i) => { if (Math.abs(Math.log(lv / p)) < Math.abs(Math.log(rd.levels[k] / p))) k = i; });
      const y = Y(rd.levels[k]);
      guides.forEach((g) => { g.setAttribute("y1", y); g.setAttribute("y2", y); g.setAttribute("visibility", "visible"); });
      row.querySelector(".prof-read").textContent = `${rd.levels[k]} hPa · ` + groups.filter((g) => rd.groups[g]).map((g) => {
        const gs = rd.groups[g];
        const f = (v, s, u) => (gs[`${v}_${s}`][k] === null ? "–" : num(gs[`${v}_${s}`][k], u, s === "bias"));
        return `${label[g]}: T ${f("t", "bias", "K")} / ${f("t", "rmse", "K")} K, q ${f("q", "bias", "g/kg")} / `
          + `${f("q", "rmse", "g/kg")} g/kg (${fmtN(gs.n_t[k])})`;
      }).join(" · ") + " (bias / RMSE, footprints)";
    });
    hit.addEventListener("mouseleave", () => guides.forEach((g) => g.setAttribute("visibility", "hidden")));
  });
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
  setupSeg("pass", "pass"); setupSeg("var", "var"); setupSeg("view", "view"); setupSeg("ref", "ref");
  $("day").addEventListener("change", (e) => { S.day = e.target.value; render(); });
  $("lev").addEventListener("change", (e) => { S.lev = +e.target.value; render(); });
  $("prof-group").value = S.group;
  $("prof-group").addEventListener("change", (e) => { S.group = e.target.value; writeHash(); renderProfiles(); });
  $("map-wrap").addEventListener("click", onMapClick);
  $("point").addEventListener("submit", onPointSubmit);
  $("ccny").addEventListener("click", () => pick(PRESETS.ccny.lat, PRESETS.ccny.lon));
  if (S.lat !== null) { $("in-lat").value = S.lat.toFixed(2); $("in-lon").value = S.lon.toFixed(2); }
  render();
}
init();
