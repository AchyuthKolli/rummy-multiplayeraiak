// client/src/utils/cursor-spark.js
// simple cursor particle + click ripple manager (no external deps)

let pointerHandler, clickHandler, particles = [];
let rafId = null;

export function initCursorSparks() {
  if (typeof window === "undefined") return;
  const root = document;
  pointerHandler = (e) => {
    spawnParticle(e.clientX, e.clientY);
  };
  clickHandler = (e) => {
    spawnRipple(e.clientX, e.clientY);
  };
  root.addEventListener("pointermove", pointerHandler);
  root.addEventListener("click", clickHandler);
  tick();
}

export function destroyCursorSparks() {
  document.removeEventListener("pointermove", pointerHandler);
  document.removeEventListener("click", clickHandler);
  if (rafId) cancelAnimationFrame(rafId);
  particles.forEach(p => p.el && p.el.remove());
  particles = [];
}

function spawnParticle(x, y) {
  // small rare sparkles to avoid perf cost
  if (Math.random() > 0.22) return;
  const el = document.createElement("div");
  el.style.position = "fixed";
  el.style.left = x + "px";
  el.style.top = y + "px";
  el.style.pointerEvents = "none";
  el.style.width = el.style.height = "6px";
  el.style.borderRadius = "50%";
  el.style.background = `radial-gradient(circle at 30% 30%, rgba(255,255,255,0.95), rgba(0,0,0,0))`;
  el.style.transform = `translate(-50%,-50%) scale(${0.5 + Math.random()})`;
  el.style.opacity = "1";
  el.style.zIndex = "9999";
  document.body.appendChild(el);

  particles.push({
    type: "spark",
    el,
    x,
    y,
    life: 220 + Math.random() * 260,
    vx: (Math.random() - 0.5) * 0.8,
    vy: - (0.2 + Math.random() * 0.6),
  });
}

function spawnRipple(x, y) {
  const el = document.createElement("div");
  el.className = "cursor-ripple";
  el.style.left = x + "px";
  el.style.top = y + "px";
  el.style.width = el.style.height = "26px";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 700);
}

function tick(time) {
  for (let i = particles.length -1; i >= 0; i--) {
    const p = particles[i];
    if (!p) continue;
    p.life -= 16;
    p.x += p.vx;
    p.y += p.vy;
    if (p.el) {
      p.el.style.left = p.x + "px";
      p.el.style.top = p.y + "px";
      p.el.style.opacity = Math.max(0, p.life / 400).toString();
      p.el.style.transform = `translate(-50%,-50%) scale(${1 - (1 - p.life/400)})`;
    }
    if (p.life <= 0) {
      if (p.el) p.el.remove();
      particles.splice(i, 1);
    }
  }
  rafId = requestAnimationFrame(tick);
}
