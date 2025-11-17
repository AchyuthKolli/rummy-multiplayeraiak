// client/src/pages/Home.jsx
import React, { useEffect, useRef } from "react";
import { User, Gamepad2, ChevronRight } from "lucide-react";
import "./home.css";
import { initCursorSparks, destroyCursorSparks } from "../utils/cursor-spark";

/**
 * Akadoodle Home — enhanced galaxy + UI animation + hover effects + optional sounds
 *
 * - Works w/o Router; uses window.__AKADOODLE_NAVIGATE if available else window.location.href
 * - Provide optional audio files in /public/sounds for click/hover/load
 */

export default function Home() {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const lastShooting = useRef(0);

  useEffect(() => {
    // init cursor sparkles (C)
    initCursorSparks();

    // optional page load chime
    const chime = new Audio("/sounds/load-chime.mp3");
    chime.volume = 0.2;
    chime.play().catch(() => { /* ignore autoplay block */ });

    // Canvas: galaxy + nebula + parallax stars + shooting stars
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let w = (canvas.width = window.innerWidth);
    let h = (canvas.height = window.innerHeight);

    // layers: far stars, near stars, nebula blobs, subtle gradients
    const farStars = createStars(120, w, h, 0.3);
    const nearStars = createStars(60, w, h, 0.9);
    const nebulaBlobs = createNebulaBlobs(3, w, h);

    function draw(timestamp) {
      ctx.clearRect(0, 0, w, h);

      // faint gradient background
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, "#030419");
      g.addColorStop(0.5, "#07122a");
      g.addColorStop(1, "#021125");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      // moving nebula soft blobs
      nebulaBlobs.forEach((b) => {
        b.x += Math.cos(b.seed + timestamp / 6000) * 0.1;
        b.y += Math.sin(b.seed + timestamp / 8000) * 0.05;
        drawNebulaBlob(ctx, b);
      });

      // parallax stars
      drawStars(ctx, farStars, 0.2, timestamp);
      drawStars(ctx, nearStars, 0.6, timestamp);

      // occasional shooting star (every ~12–20 sec)
      if (timestamp - lastShooting.current > 15000 + Math.random() * 10000) {
        spawnShootingStar(ctx, w, h);
        lastShooting.current = timestamp;
      }

      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);

    // resize handler
    const onResize = () => {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", onResize);

    // cleanup
    return () => {
      window.removeEventListener("resize", onResize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      destroyCursorSparks();
    };
  }, []);

  // nav helper (works outside router)
  function goTo(to) {
    try {
      if (typeof window.__AKADOODLE_NAVIGATE === "function") {
        window.__AKADOODLE_NAVIGATE(to);
        return;
      }
    } catch (e) {}
    window.location.href = to;
  }

  // game cards (images in /public/assets/games)
  const games = [
    { id: "rummy", name: "Rummy", image: "/assets/games/rummy_glow.png", to: "/rummy/home", desc: "Classic 13-card strategy" },
    { id: "uno", name: "UNO", image: "/assets/games/uno_glow.png", to: "/uno/home", desc: "Fast-paced card chaos" },
    { id: "teen", name: "Teen Patti", image: "/assets/games/teenpatti_glow.png", to: "/teenpatti/home", desc: "3-card poker action" },
  ];

  // optional sound effects on clicks/hover
  function playClick() {
    const s = new Audio("/sounds/click-pop.mp3");
    s.volume = 0.25;
    s.play().catch(()=>{});
  }
  function playHover() {
    const s = new Audio("/sounds/hover-woosh.mp3");
    s.volume = 0.12;
    s.play().catch(()=>{});
  }

  return (
    <div className="ak-home root">
      <canvas ref={canvasRef} className="bg-canvas" />

      <header className="ak-header">
        <div className="brand" aria-hidden>
          <span className="ak-letter ak-a">A</span>
          <span className="ak-letter ak-k">K</span>

          {/* doodle eyes */}
          <div className="ak-doodle">
            <div className="eye left">
              <div className="pupil" />
            </div>
            <div className="eye right">
              <div className="pupil wink" />
            </div>
            <div className="smile" />
          </div>

          <span className="ak-doodle-text">doodle</span>
        </div>

        <a className="profile-btn" href="/profile" onMouseEnter={playHover}>
          <User /> Profile
        </a>
      </header>

      <main className="ak-main">
        <h2 className="section-title"><Gamepad2/> Choose Your Game</h2>

        <div className="games-grid">
          {games.map((g, i) => (
            <article key={g.id}
              className="game-card"
              onClick={() => { playClick(); goTo(g.to); }}
              onMouseEnter={playHover}
              role="button"
              tabIndex={0}
              onKeyDown={(e)=> e.key === "Enter" && (playClick(), goTo(g.to))}
            >
              <div className="card-inner">
                <img src={g.image} alt={g.name} className="game-art" />
                <div className="game-info">
                  <h3>{g.name}</h3>
                  <p>{g.desc}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </main>

      <footer className="ak-footer">© {new Date().getFullYear()} Akadoodle — Play & Doodle</footer>
    </div>
  );
}

/* -------------------------
   Canvas helpers (inline)
   Small, optimized; tweak sizes to taste.
   Not exported — internal to component
------------------------- */

function createStars(n, w, h, sizeFactor = 1) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    arr.push({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * (1.1 * sizeFactor) + 0.2 * sizeFactor,
      vx: (Math.random() - 0.5) * 0.03 * sizeFactor,
      vy: (Math.random() - 0.5) * 0.03 * sizeFactor,
      twinkle: Math.random() * Math.PI * 2,
    });
  }
  return arr;
}

function drawStars(ctx, stars, brightnessFactor = 0.6, time = 0) {
  stars.forEach((s) => {
    s.x += s.vx;
    s.y += s.vy;
    s.twinkle += 0.03;
    if (s.x < -10) s.x += ctx.canvas.width + 20;
    if (s.x > ctx.canvas.width + 10) s.x -= ctx.canvas.width + 20;
    if (s.y < -10) s.y += ctx.canvas.height + 20;
    if (s.y > ctx.canvas.height + 10) s.y -= ctx.canvas.height + 20;

    const alpha = 0.5 + Math.sin(s.twinkle + time / 300) * 0.5 * brightnessFactor;
    ctx.beginPath();
    ctx.fillStyle = `rgba(255, 250, 245, ${Math.max(0.18, alpha)})`;
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  });
}

function createNebulaBlobs(count, w, h) {
  const blobs = [];
  for (let i = 0; i < count; i++) {
    blobs.push({
      x: Math.random() * w,
      y: Math.random() * h * 0.6,
      r: w * (0.15 + Math.random() * 0.2),
      seed: Math.random() * 1000,
      hue: 200 + Math.random() * 120,
      alpha: 0.06 + Math.random() * 0.08,
    });
  }
  return blobs;
}

function drawNebulaBlob(ctx, b) {
  const gradient = ctx.createRadialGradient(b.x, b.y, 10, b.x, b.y, b.r);
  gradient.addColorStop(0, `hsla(${b.hue},80%,65%, ${b.alpha})`);
  gradient.addColorStop(0.5, `hsla(${b.hue},70%,40%, ${b.alpha * 0.8})`);
  gradient.addColorStop(1, `rgba(2,8,20,0)`);
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(b.x, b.y, b.r, b.r * 0.6, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
}

// quick shooting star visual (not physical simulation)
function spawnShootingStar(ctx, w, h) {
  const x = Math.random() * w * 0.8 + w * 0.1;
  const y = Math.random() * h * 0.35 + 20;
  const len = Math.random() * 180 + 120;
  const angle = -Math.PI / 6 - Math.random() * Math.PI / 12;
  const grad = ctx.createLinearGradient(x, y, x + Math.cos(angle) * len, y + Math.sin(angle) * len);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.beginPath();
  ctx.strokeStyle = grad;
  ctx.lineWidth = 2;
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
  ctx.stroke();
  // small tail glow
  ctx.beginPath();
  ctx.fillStyle = "rgba(255,240,210,0.08)";
  ctx.ellipse(x + Math.cos(angle) * len * 0.5, y + Math.sin(angle) * len * 0.5, len * 0.8, 30, angle, 0, Math.PI*2);
  ctx.fill();
}
