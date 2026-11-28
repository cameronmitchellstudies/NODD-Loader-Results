"use strict";
// Parcel analysis for the skew-T: LCL, LFC, EL, CAPE and CIN of a lifted parcel, with
// the same definitions as MetPy's cape_cin (virtual temperature correction; LFC = the
// lowest, EL = the highest crossing; CAPE = net area between them, CIN = net area below
// the LFC, never positive). Checked against MetPy in website/tests/test_parcel.py.
(function (root) {
  const RD = 287.04749, CP = 1004.6662, LV = 2.50084e6, EPS = 0.6219569, KAPPA = RD / CP;
  const esat = (T) => 6.112 * Math.exp(17.67 * (T - 273.15) / (T - 29.65));       // hPa
  const wsat = (T, p) => { const e = esat(T); return EPS * e / Math.max(p - e, 1e-6); };
  const tvirt = (T, w) => T * (w + EPS) / (EPS * (1 + w));
  const dTdp = (T, p) => {                                // pseudo-adiabatic lapse rate
    const rs = wsat(T, p);
    return (RD * T + LV * rs) / (p * (CP + LV * LV * rs * EPS / (RD * T * T)));
  };
  const dewpointK = (w, p) => {
    const e = Math.max(w, 1e-10) * p / (EPS + w), x = Math.log(e / 6.112);
    return 243.5 * x / (17.67 - x) + 273.15;
  };

  // p (hPa), T (K), q (specific humidity, kg/kg) at any levels, in any order.
  // opts.start: pressure (hPa) of the parcel's starting level (default: the lowest level).
  function parcelAnalysis(pIn, TIn, qIn, opts = {}) {
    const top = opts.top || 100, step = opts.step || 2;
    const idx = pIn.map((_, i) => i)
      .filter((i) => Number.isFinite(pIn[i]) && Number.isFinite(TIn[i]) && Number.isFinite(qIn[i])
        && pIn[i] >= top - 1e-6)
      .sort((a, b) => pIn[b] - pIn[a]);
    if (idx.length < 3) return null;
    const P = idx.map((i) => pIn[i]), T = idx.map((i) => TIn[i]);
    const W = idx.map((i) => Math.max(qIn[i], 1e-10) / (1 - qIn[i]));
    const envAt = (pp) => {
      let k = 0;
      while (k < P.length - 2 && P[k + 1] >= pp) k++;
      const f = (Math.log(pp) - Math.log(P[k])) / (Math.log(P[k + 1]) - Math.log(P[k]));
      return [T[k] + f * (T[k + 1] - T[k]), W[k] + f * (W[k + 1] - W[k])];
    };
    let s = 0;
    if (opts.start !== undefined) {
      s = P.findIndex((x) => Math.abs(x - opts.start) < 0.5);
      if (s < 0) return null;
    }
    const p0 = P[s], T0 = T[s], w0 = W[s];
    const Td0 = Math.min(dewpointK(w0, p0), T0);
    const TL = 1 / (1 / (Td0 - 56) + Math.log(T0 / Td0) / 800) + 56;          // Bolton (1980)
    const pL = p0 * Math.pow(TL / T0, 1 / KAPPA);

    // the parcel's path, every `step` hPa (plus the LCL), and its buoyancy B (K)
    const pts = [];
    let Tm = null, pm = null;
    const levels = [];
    for (let i = 0; p0 - i * step > top + 1e-9; i++) levels.push(p0 - i * step);
    levels.push(top);
    if (pL < p0 && pL > top) levels.push(pL);
    levels.sort((a, b) => b - a);
    for (const pp of levels) {
      let Tp, wp;
      if (pp >= pL) { Tp = T0 * Math.pow(pp / p0, KAPPA); wp = w0; } else {
        if (Tm === null) { Tm = TL; pm = pL; }
        while (pm - pp > 1e-9) {
          const dp = -Math.min(1, pm - pp);
          const k1 = dTdp(Tm, pm), k2 = dTdp(Tm + k1 * dp, pm + dp);
          Tm += 0.5 * (k1 + k2) * dp; pm += dp;
        }
        Tp = Tm; wp = wsat(Tp, pp);
      }
      const [Te, we] = envAt(pp);
      pts.push({ p: pp, Tp, Te, B: tvirt(Tp, wp) - tvirt(Te, we) });
    }

    // LFC: lowest level at or above the LCL where B turns positive; EL: highest where it
    // turns negative again (or the top). Crossings are interpolated in ln p.
    const cross = (a, b) => {
      const f = a.B / (a.B - b.B);
      return Math.exp(Math.log(a.p) + f * (Math.log(b.p) - Math.log(a.p)));
    };
    const iL = pts.findIndex((x) => x.p <= pL + 1e-9);
    let pLFC = null, pEL = null;
    if (iL >= 0) {
      if (pts[iL].B > 0) pLFC = pts[iL].p;
      else {
        for (let i = iL + 1; i < pts.length; i++) {
          if (pts[i].B > 0) { pLFC = cross(pts[i - 1], pts[i]); break; }
        }
      }
      if (pLFC !== null) {
        let last = -1;
        for (let i = pts.length - 1; i >= iL; i--) if (pts[i].B > 0) { last = i; break; }
        pEL = last === pts.length - 1 ? pts[last].p : cross(pts[last], pts[last + 1]);
      }
    }

    // net area of B over ln p between two pressures (pa > pb), with zero crossings added
    const area = (pa, pb) => {
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        if (a.p <= pa + 1e-9 && a.p >= pb - 1e-9) xs.push([a.p, a.B]);
        const b = pts[i + 1];
        if (b && a.B * b.B < 0) {
          const pc = cross(a, b);
          if (pc <= pa + 1e-9 && pc >= pb - 1e-9) xs.push([pc, 0]);
        }
      }
      xs.sort((u, v) => v[0] - u[0]);
      let sum = 0;
      for (let i = 0; i + 1 < xs.length; i++) {
        sum += 0.5 * (xs[i][1] + xs[i + 1][1]) * Math.log(xs[i][0] / xs[i + 1][0]);
      }
      return RD * sum;
    };
    let cape = 0, cin = 0;
    if (pLFC !== null) {
      cape = Math.max(area(pLFC, pEL), 0);
      cin = Math.min(area(p0, pLFC), 0);
    }
    return { p0, pLCL: pL, pLFC, pEL, cape, cin, path: pts.map((x) => ({ p: x.p, T: x.Tp, Te: x.Te })) };
  }

  // Most-unstable parcel: the level in the lowest `depth` hPa with the highest
  // equivalent potential temperature.
  function mostUnstable(pIn, TIn, qIn, depth = 300) {
    const ok = pIn.map((_, i) => i).filter((i) => Number.isFinite(TIn[i]) && Number.isFinite(qIn[i]));
    if (!ok.length) return null;
    const pmax = Math.max(...ok.map((i) => pIn[i]));
    let best = null, bestTe = -Infinity;
    for (const i of ok) {
      if (pIn[i] < pmax - depth - 1e-6) continue;
      const w = qIn[i] / (1 - qIn[i]), T = TIn[i], p = pIn[i];
      const Td = Math.min(dewpointK(w, p), T);
      const TL = 1 / (1 / (Td - 56) + Math.log(T / Td) / 800) + 56;
      const the = T * Math.pow(1000 / p, KAPPA) * Math.exp(LV * w / (CP * TL));
      if (the > bestTe) { bestTe = the; best = p; }
    }
    return best === null ? null : parcelAnalysis(pIn, TIn, qIn, { start: best });
  }

  // The part of a profile above the ground. Where the surface is above the lowest level
  // (high ground), the levels below it are left out and a level is added at the surface
  // (T and ln q interpolated in ln p). Where it's below the lowest level (sp > 1000 hPa,
  // most of the ocean) the profile is used as it is, starting at its lowest level.
  function aboveSurface(p, t, q, sp) {
    if (!Number.isFinite(sp)) return { p, t, q };
    const ok = p.map((_, i) => i).filter((i) => Number.isFinite(t[i]) && Number.isFinite(q[i]))
      .sort((a, b) => p[b] - p[a]);
    if (!ok.length || sp >= p[ok[0]] - 0.5) return { p, t, q };
    const above = ok.filter((i) => p[i] < sp - 0.5), at = ok.filter((i) => p[i] >= sp - 0.5);
    if (!above.length) return { p: [], t: [], q: [] };
    const a = at[at.length - 1], b = above[0];        // the levels either side of the surface
    let ts = t[a], qs = q[a];
    if (Math.abs(p[a] - sp) >= 0.5) {
      const f = Math.log(sp / p[a]) / Math.log(p[b] / p[a]);
      ts = t[a] + f * (t[b] - t[a]);
      qs = Math.exp(Math.log(q[a]) + f * (Math.log(q[b]) - Math.log(q[a])));
    }
    return { p: [sp, ...above.map((i) => p[i])], t: [ts, ...above.map((i) => t[i])],
      q: [qs, ...above.map((i) => q[i])] };
  }

  const api = { parcelAnalysis, mostUnstable, aboveSurface };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis);
