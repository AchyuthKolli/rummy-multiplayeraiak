// client/src/utils/cursor-spark.js
// Lightweight cursor sparkle trail. No deps. Call initCursorSpark() to start.
// Places a canvas overlay and draws small particle trail on pointer movement.

export default function initCursorSpark(opts = {}) {
  const color = opts.color || "rgba(160, 255, 200, 0.95)";
  const count = opts.count || 14;
  const size = opts.size || 6;
  const decay = opts.decay || 0.02;

  if (typeof window === "undefined") return () => {};

  // avoid double-init
  if (window.__AK_CURSOR_SPARK_INITED) return () => {};
  window.__AK_CURSOR_SPARK_INITED = true;

  const canvas = document.createElement("canvas");
  canvas.style.position = "fixed";
  canvas.style.left = "0";
  canvas.style.top = "0";
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = "999999";
  canvas.style.mixBlendMode = "screen";
  canvas.className = "ak-cursor-spark-canvas";
  document.body.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  let w = (canvas.width = window.innerWidth);
  let h = (canvas.height = window.innerHeight);

  const particles = [];

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }
  window.addEventListener("resize", resize);

  function addParticle(x, y) {
    const a = Math.random() * Math.PI * 2;
    const speed = Math.random() * 2 + 0.2;
    particles.push({
      x,
      y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      life: 1,
      size: (Math.random() * 0.6 + 0.6) * size,
      color,
    });
    if (particles.length > 300) particles.splice(0, particles.length - 300);
  }

  let mouse = { x: -9999, y: -9999, movedAt: 0 };
  function onMove(e) {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.movedAt = Date.now();
    for (let i = 0; i < Math.floor(Math.random() * 2) + 1; i++) addParticle(mouse.x, mouse.y);
  }

  function onClick(e) {
    for (let i = 0; i < (count * 2); i++) addParticle(e.clientX, e.clientY);
  }

  window.addEventListener("mousemove", onMove);
  window.addEventListener("pointerdown", onClick);

  let raf = null;
  function draw() {
    ctx.clearRect(0, 0, w, h);

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.98;
      p.vy *= 0.98;
      p.life -= decay;
      const alpha = Math.max(0, Math.min(1, p.life));
      ctx.beginPath();
      ctx.fillStyle = p.color.replace(/[\d\.]+\)$/g, `${alpha})`);
      // if color is rgba() and lacks alpha replacement, fallback:
      if (!/rgba\(/.test(p.color)) ctx.fillStyle = `rgba(160,255,200,${alpha})`;
      ctx.arc(p.x, p.y, Math.max(0.5, p.size * alpha), 0, Math.PI * 2);
      ctx.fill();

      if (p.life <= 0 || p.x < -50 || p.y < -50 || p.x > w + 50 || p.y > h + 50) {
        particles.splice(i, 1);
      }
    }

    raf = requestAnimationFrame(draw);
  }

  raf = requestAnimationFrame(draw);

  // Return stop function
  return function stop() {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("pointerdown", onClick);
    window.removeEventListener("resize", resize);
    if (raf) cancelAnimationFrame(raf);
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    window.__AK_CURSOR_SPARK_INITED = false;
  };
}
