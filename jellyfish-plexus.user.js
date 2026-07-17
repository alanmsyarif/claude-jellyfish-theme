// ==UserScript==
// @name         JellyFish Plexus for Claude
// @namespace    amsy.jellyfish-claude
// @version      1.0.0
// @description  Interactive plexus particle-network animation over claude.ai, in JellyFish neon cyan/pink. Companion to the JellyFish for Claude userstyle.
// @author       Amsy
// @match        https://claude.ai/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  /* ------------------ CONFIG — tweak freely ------------------ */
  const CFG = {
    particleCount: 70,        // total particles (60–90 is a good range)
    maxSpeed: 0.22,           // drift speed
    linkDistance: 150,        // px distance at which particles connect
    mouseRadius: 200,         // px radius where cursor links to particles
    dotSize: [1.0, 2.2],      // min/max particle radius
    lineWidth: 0.7,
    globalOpacity: 0.45,      // overall layer opacity (0.3 subtle – 0.7 loud)
    colors: {
      cyan: "0, 255, 255",    // particle + link color A
      pink: "255, 0, 128",    // particle + link color B
      mouse: "255, 0, 128",   // cursor link color
    },
    pinkRatio: 0.3,           // fraction of particles that are pink
    parallax: 0.015,          // subtle drift toward cursor (0 = off)
  };
  /* ----------------------------------------------------------- */

  // Avoid double-injection on SPA soft reloads
  if (document.getElementById("jf-plexus")) return;

  const canvas = document.createElement("canvas");
  canvas.id = "jf-plexus";
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: "100vw",
    height: "100vh",
    zIndex: "2147483646",
    pointerEvents: "none",
    mixBlendMode: "screen",     // only brightens the dark UI — reads as background
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

  const particles = Array.from({ length: CFG.particleCount }, () => ({
    x: Math.random() * window.innerWidth,
    y: Math.random() * window.innerHeight,
    vx: rand(-CFG.maxSpeed, CFG.maxSpeed),
    vy: rand(-CFG.maxSpeed, CFG.maxSpeed),
    r: rand(CFG.dotSize[0], CFG.dotSize[1]),
    pink: Math.random() < CFG.pinkRatio,
  }));

  const mouse = { x: -9999, y: -9999, active: false };
  window.addEventListener("mousemove", (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.active = true;
  }, { passive: true });
  window.addEventListener("mouseleave", () => { mouse.active = false; mouse.x = -9999; mouse.y = -9999; }, { passive: true });

  const LINK2 = CFG.linkDistance * CFG.linkDistance;
  const MOUSE2 = CFG.mouseRadius * CFG.mouseRadius;

  let running = true;
  document.addEventListener("visibilitychange", () => {
    running = !document.hidden;
    if (running) requestAnimationFrame(tick);
  });

  function tick() {
    if (!running) return;
    ctx.clearRect(0, 0, W, H);

    // move
    for (const p of particles) {
      // gentle parallax pull toward cursor
      if (mouse.active && CFG.parallax > 0) {
        p.x += (mouse.x - W / 2) * CFG.parallax * 0.001;
        p.y += (mouse.y - H / 2) * CFG.parallax * 0.001;
      }
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < -20) p.x = W + 20; else if (p.x > W + 20) p.x = -20;
      if (p.y < -20) p.y = H + 20; else if (p.y > H + 20) p.y = -20;
    }

    // links between particles
    ctx.lineWidth = CFG.lineWidth;
    for (let i = 0; i < particles.length; i++) {
      const a = particles[i];
      for (let j = i + 1; j < particles.length; j++) {
        const b = particles[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < LINK2) {
          const t = 1 - d2 / LINK2; // 1 close → 0 far
          const col = (a.pink || b.pink) ? CFG.colors.pink : CFG.colors.cyan;
          ctx.strokeStyle = `rgba(${col}, ${t * 0.5})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    // links to cursor
    if (mouse.active) {
      for (const p of particles) {
        const dx = p.x - mouse.x, dy = p.y - mouse.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < MOUSE2) {
          const t = 1 - d2 / MOUSE2;
          ctx.strokeStyle = `rgba(${CFG.colors.mouse}, ${t * 0.6})`;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(mouse.x, mouse.y);
          ctx.stroke();
        }
      }
    }

    // dots
    for (const p of particles) {
      const col = p.pink ? CFG.colors.pink : CFG.colors.cyan;
      ctx.fillStyle = `rgba(${col}, 0.85)`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
