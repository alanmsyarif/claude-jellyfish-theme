// ==UserScript==
// @name         Galaxy Background for Claude
// @namespace    amsy.galaxy-claude
// @version      1.0.0
// @description  Interactive deep-space background for claude.ai — 3-layer parallax starfield that follows your cursor, twinkling stars, drifting nebulae, occasional shooting stars. Replaces the plexus script.
// @author       Amsy
// @match        https://claude.ai/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  /* ------------------ CONFIG ------------------ */
  const CFG = {
    starsPerLayer: [90, 60, 35],   // far, mid, near
    layerParallax: [6, 14, 26],    // px shift at screen edge per layer
    layerSize: [[0.4, 0.9], [0.7, 1.4], [1.0, 2.2]],
    twinkleSpeed: 0.9,             // higher = faster twinkle
    driftSpeed: 0.012,             // slow sideways drift of the whole field
    nebulae: [
      { color: "157, 78, 221", radius: 420, alpha: 0.10 }, // violet
      { color: "255, 46, 196", radius: 340, alpha: 0.07 }, // magenta
      { color: "139, 233, 253", radius: 300, alpha: 0.05 } // cyan
    ],
    shootingStarEveryMs: [9000, 22000], // random interval range (0 to disable: set huge)
    globalOpacity: 0.75,
    starColors: ["255,255,255", "230,230,250", "139,233,253", "255,209,102", "255,143,171"],
    colorWeights: [0.45, 0.2, 0.15, 0.1, 0.1],
  };
  /* -------------------------------------------- */

  if (document.getElementById("jf-galaxy")) return;
  // if the old plexus canvas is still around, remove it so they don't stack
  const oldPlexus = document.getElementById("jf-plexus");
  if (oldPlexus) oldPlexus.remove();

  const canvas = document.createElement("canvas");
  canvas.id = "jf-galaxy";
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: "100vw",
    height: "100vh",
    zIndex: "2147483646",
    pointerEvents: "none",
    mixBlendMode: "screen",
    opacity: String(CFG.globalOpacity),
  });
  document.documentElement.appendChild(canvas);

  const ctx = canvas.getContext("2d", { alpha: true });
  let W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2);

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  resize();
  window.addEventListener("resize", resize, { passive: true });

  const rand = (a, b) => a + Math.random() * (b - a);

  function pickColor() {
    let r = Math.random(), acc = 0;
    for (let i = 0; i < CFG.starColors.length; i++) {
      acc += CFG.colorWeights[i];
      if (r <= acc) return CFG.starColors[i];
    }
    return CFG.starColors[0];
  }

  // Star layers (far → near)
  const layers = CFG.starsPerLayer.map((count, li) =>
    Array.from({ length: count }, () => ({
      x: Math.random(),                     // stored 0–1, scaled at draw
      y: Math.random(),
      r: rand(CFG.layerSize[li][0], CFG.layerSize[li][1]),
      color: pickColor(),
      phase: Math.random() * Math.PI * 2,   // twinkle offset
      tw: rand(0.5, 1.5),                   // twinkle rate multiplier
    }))
  );

  // Nebulae drift on slow Lissajous paths
  const nebulae = CFG.nebulae.map((n, i) => ({
    ...n,
    ax: rand(0.2, 0.8), ay: rand(0.2, 0.8),
    sx: rand(0.00003, 0.00007) * (i % 2 ? -1 : 1),
    sy: rand(0.00002, 0.00005),
    px: Math.random() * Math.PI * 2,
    py: Math.random() * Math.PI * 2,
  }));

  // Mouse parallax (smoothed)
  const mouse = { x: 0.5, y: 0.5, sx: 0.5, sy: 0.5 };
  window.addEventListener("mousemove", (e) => {
    mouse.x = e.clientX / Math.max(1, window.innerWidth);
    mouse.y = e.clientY / Math.max(1, window.innerHeight);
  }, { passive: true });

  // Shooting stars
  let shots = [];
  function scheduleShot() {
    const [a, b] = CFG.shootingStarEveryMs;
    setTimeout(() => {
      const fromLeft = Math.random() < 0.5;
      shots.push({
        x: fromLeft ? -40 : W + 40,
        y: rand(0, H * 0.5),
        vx: (fromLeft ? 1 : -1) * rand(9, 14),
        vy: rand(2.5, 5),
        life: 1,
      });
      scheduleShot();
    }, rand(a, b));
  }
  scheduleShot();

  let running = true;
  document.addEventListener("visibilitychange", () => {
    running = !document.hidden;
    if (running) requestAnimationFrame(tick);
  });

  let t = 0;
  function tick() {
    if (!running) return;
    t += 16;
    ctx.clearRect(0, 0, W, H);

    // smooth the cursor for buttery parallax
    mouse.sx += (mouse.x - mouse.sx) * 0.04;
    mouse.sy += (mouse.y - mouse.sy) * 0.04;
    const cx = (mouse.sx - 0.5) * 2; // -1..1
    const cy = (mouse.sy - 0.5) * 2;

    // nebulae (drawn first, behind stars)
    for (const n of nebulae) {
      const nx = (n.ax + Math.sin(t * n.sx + n.px) * 0.12) * W + cx * -30;
      const ny = (n.ay + Math.cos(t * n.sy + n.py) * 0.10) * H + cy * -20;
      const g = ctx.createRadialGradient(nx, ny, 0, nx, ny, n.radius);
      g.addColorStop(0, `rgba(${n.color}, ${n.alpha})`);
      g.addColorStop(1, `rgba(${n.color}, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(nx - n.radius, ny - n.radius, n.radius * 2, n.radius * 2);
    }

    // star layers with parallax + twinkle + slow drift
    const drift = t * CFG.driftSpeed;
    for (let li = 0; li < layers.length; li++) {
      const par = CFG.layerParallax[li];
      const ox = cx * -par;
      const oy = cy * -par;
      for (const s of layers[li]) {
        const sx = ((s.x * W + drift * (li + 1) * 0.3) % (W + 40)) - 20 + ox;
        const sy = s.y * H + oy;
        const twinkle = 0.55 + 0.45 * Math.sin(t * 0.001 * CFG.twinkleSpeed * s.tw + s.phase);
        ctx.fillStyle = `rgba(${s.color}, ${twinkle})`;
        ctx.beginPath();
        ctx.arc(sx, sy, s.r, 0, Math.PI * 2);
        ctx.fill();
        // bright stars get a tiny cross-glint
        if (s.r > 1.6 && twinkle > 0.9) {
          ctx.strokeStyle = `rgba(${s.color}, ${(twinkle - 0.9) * 4})`;
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(sx - s.r * 3, sy); ctx.lineTo(sx + s.r * 3, sy);
          ctx.moveTo(sx, sy - s.r * 3); ctx.lineTo(sx, sy + s.r * 3);
          ctx.stroke();
        }
      }
    }

    // shooting stars
    for (const sh of shots) {
      sh.x += sh.vx;
      sh.y += sh.vy;
      sh.life -= 0.012;
      const tail = 14;
      const grad = ctx.createLinearGradient(sh.x, sh.y, sh.x - sh.vx * tail, sh.y - sh.vy * tail);
      grad.addColorStop(0, `rgba(255,255,255,${0.9 * sh.life})`);
      grad.addColorStop(1, "rgba(139,233,253,0)");
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(sh.x, sh.y);
      ctx.lineTo(sh.x - sh.vx * tail, sh.y - sh.vy * tail);
      ctx.stroke();
    }
    shots = shots.filter((sh) => sh.life > 0 && sh.x > -100 && sh.x < W + 100 && sh.y < H + 100);

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
