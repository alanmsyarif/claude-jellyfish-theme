// ==UserScript==
// @name         JellyFish Usage Bar for Claude
// @namespace    amsy.jellyfish-claude
// @version      1.0.1
// @description  Real-time session + weekly usage bars on claude.ai, styled to match the JellyFish theme. No more digging through Settings.
// @author       Amsy
// @match        https://claude.ai/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  /* ------------------ CONFIG ------------------ */
  const CFG = {
    refreshMs: 5 * 60 * 1000,   // auto-refresh every 5 min
    refreshAfterSendMs: 20000,  // refresh 20s after you send a message
    position: { bottom: "14px", left: "14px" },
    startCollapsed: false,
  };
  /* -------------------------------------------- */

  if (document.getElementById("jf-usage")) return;

  const css = `
    #jf-usage {
      position: fixed; bottom: ${CFG.position.bottom}; left: ${CFG.position.left};
      z-index: 2147483645; font-family: ui-monospace, "IBM Plex Mono", monospace;
      background: rgba(10, 0, 37, 0.92); border: 1px solid rgba(0,255,255,.25);
      border-radius: 10px; padding: 10px 12px; min-width: 210px;
      color: #eeffff; font-size: 11px; letter-spacing: .04em;
      box-shadow: 0 0 18px rgba(255,0,128,.15), 0 4px 16px rgba(0,0,0,.5);
      backdrop-filter: blur(6px); user-select: none;
    }
    #jf-usage.jf-collapsed { min-width: 0; padding: 6px 10px; cursor: pointer; }
    #jf-usage.jf-collapsed .jf-body { display: none; }
    #jf-usage .jf-head {
      display: flex; align-items: center; justify-content: space-between;
      gap: 10px; cursor: pointer; margin-bottom: 6px;
    }
    #jf-usage.jf-collapsed .jf-head { margin-bottom: 0; }
    #jf-usage .jf-title { color: #00ffff; font-weight: 600; text-transform: uppercase; font-size: 10px; }
    #jf-usage .jf-mini { color: #ff0080; font-weight: 700; }
    #jf-usage .jf-row { margin: 7px 0 2px; display: flex; justify-content: space-between; gap: 8px; }
    #jf-usage .jf-label { color: #838383; }
    #jf-usage .jf-val { color: #eeffff; }
    #jf-usage .jf-bar {
      height: 5px; border-radius: 3px; background: #28002b;
      overflow: hidden; margin-top: 3px;
    }
    #jf-usage .jf-fill {
      height: 100%; width: 0%; border-radius: 3px;
      background: linear-gradient(90deg, #00ffff, #ff0080);
      box-shadow: 0 0 8px rgba(255,0,128,.6);
      transition: width .6s ease;
    }
    #jf-usage .jf-fill.jf-warn  { background: linear-gradient(90deg, #ffd900, #ff7e34); }
    #jf-usage .jf-fill.jf-crit  { background: linear-gradient(90deg, #ff7e34, #FF5370); }
    #jf-usage .jf-reset { color: #4a505a; font-size: 10px; margin-top: 2px; }
    #jf-usage .jf-err { color: #FF5370; font-size: 10px; margin-top: 4px; }
    #jf-usage .jf-refresh { color: #838383; cursor: pointer; font-size: 10px; }
    #jf-usage .jf-refresh:hover { color: #00ffff; }
  `;
  const styleEl = document.createElement("style");
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  const box = document.createElement("div");
  box.id = "jf-usage";
  if (CFG.startCollapsed) box.classList.add("jf-collapsed");
  box.innerHTML = `
    <div class="jf-head">
      <span class="jf-title">◉ Usage</span>
      <span class="jf-mini">--%</span>
      <span class="jf-refresh" title="Refresh now">⟳</span>
    </div>
    <div class="jf-body"></div>
  `;
  document.documentElement.appendChild(box);

  const body = box.querySelector(".jf-body");
  const mini = box.querySelector(".jf-mini");

  box.querySelector(".jf-head").addEventListener("click", (e) => {
    if (e.target.classList.contains("jf-refresh")) return;
    box.classList.toggle("jf-collapsed");
  });
  box.querySelector(".jf-refresh").addEventListener("click", (e) => {
    e.stopPropagation();
    load();
  });

  /* ---------------- data layer ---------------- */

  let orgId = null;

  async function getOrgId() {
    if (orgId) return orgId;
    const res = await fetch("https://claude.ai/api/organizations", { credentials: "include" });
    if (!res.ok) throw new Error("org fetch " + res.status);
    const orgs = await res.json();
    const pick = orgs.find((o) => (o.capabilities || []).includes("chat")) || orgs[0];
    if (!pick) throw new Error("no organization found");
    orgId = pick.uuid;
    return orgId;
  }

  function fmtReset(iso) {
    if (!iso) return "";
    const t = new Date(iso) - Date.now();
    if (isNaN(t)) return "";
    if (t <= 0) return "resetting…";
    const h = Math.floor(t / 3.6e6);
    const m = Math.floor((t % 3.6e6) / 6e4);
    if (h >= 24) return `resets in ${Math.floor(h / 24)}d ${h % 24}h`;
    return `resets in ${h}h ${m}m`;
  }

  function pct(u) {
    if (u == null || isNaN(u)) return null;
    return Math.round(u <= 1 ? u * 100 : u);
  }

  // Normalize whatever schema the endpoint returns into [{label, percent, resetsAt, detail}]
  function normalize(data) {
    const out = [];

    // Schema A: { five_hour: {utilization, resets_at}, seven_day: {...}, ... }
    const known = {
      five_hour: "Session (5h)",
      seven_day: "Week (all)",
      seven_day_sonnet: "Week · Sonnet",
      seven_day_opus: "Week · Opus",
      seven_day_oauth_apps: "Week · Apps",
    };
    for (const [key, label] of Object.entries(known)) {
      const node = data && data[key];
      if (node && typeof node === "object") {
        out.push({
          label,
          percent: pct(node.utilization),
          resetsAt: node.resets_at || node.resetsAt || null,
        });
      }
    }
    if (out.length) return out;

    // Schema B: { usage: [ {period, usage_type, input_tokens, output_tokens, ...} ] }
    if (data && Array.isArray(data.usage)) {
      const byPeriod = {};
      for (const u of data.usage) {
        const p = u.period || "period";
        byPeriod[p] = (byPeriod[p] || 0) +
          (u.input_tokens || 0) + (u.output_tokens || 0) +
          (u.cache_creation_tokens || 0);
      }
      for (const [p, tokens] of Object.entries(byPeriod)) {
        out.push({
          label: p.replace(/_/g, " "),
          percent: null,
          resetsAt: null,
          detail: tokens >= 1e6 ? (tokens / 1e6).toFixed(2) + "M tok"
                : tokens >= 1e3 ? (tokens / 1e3).toFixed(1) + "k tok"
                : tokens + " tok",
        });
      }
      if (out.length) return out;
    }

    console.warn("[JF Usage] unrecognized schema:", data);
    return out;
  }

  function render(rows) {
    if (!rows.length) {
      body.innerHTML = `<div class="jf-err">Endpoint answered, but schema unknown.<br>Check console (F12) → [JF Usage].</div>`;
      mini.textContent = "?";
      return;
    }
    body.innerHTML = rows
      .map((r) => {
        const p = r.percent;
        const cls = p == null ? "" : p >= 90 ? "jf-crit" : p >= 70 ? "jf-warn" : "";
        return `
        <div class="jf-row">
          <span class="jf-label">${r.label}</span>
          <span class="jf-val">${p != null ? p + "%" : (r.detail || "–")}</span>
        </div>
        ${p != null ? `<div class="jf-bar"><div class="jf-fill ${cls}" style="width:${Math.min(p, 100)}%"></div></div>` : ""}
        ${r.resetsAt ? `<div class="jf-reset">${fmtReset(r.resetsAt)}</div>` : ""}
      `;
      })
      .join("");

    const session = rows.find((r) => /session|5h/i.test(r.label)) || rows[0];
    mini.textContent = session.percent != null ? session.percent + "%" : "•";
    mini.style.color =
      session.percent >= 90 ? "#FF5370" :
      session.percent >= 70 ? "#ffd900" : "#ff0080";
  }

  let loading = false;
  async function load() {
    if (loading) return;
    loading = true;
    try {
      const id = await getOrgId();
      const res = await fetch(`https://claude.ai/api/organizations/${id}/usage`, {
        credentials: "include",
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error("usage fetch " + res.status);
      const data = await res.json();
      render(normalize(data));
    } catch (err) {
      console.warn("[JF Usage]", err);
      body.innerHTML = `<div class="jf-err">Couldn't load usage (${String(err.message || err)})</div>`;
      mini.textContent = "!";
    } finally {
      loading = false;
    }
  }

  load();
  setInterval(load, CFG.refreshMs);

  // refresh shortly after you send a message (completion request goes out)
  const origFetch = window.fetch;
  window.fetch = function (...args) {
    try {
      const url = String(args[0] && args[0].url ? args[0].url : args[0] || "");
      if (url.includes("/completion")) setTimeout(load, CFG.refreshAfterSendMs);
    } catch (_) {}
    return origFetch.apply(this, args);
  };
})();
