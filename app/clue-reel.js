"use client";

import { useEffect, useRef, useState } from "react";

const glyphs = [
  [1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1],
  [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1],
];

function drawGlyph(ctx, x, y, glyph, phase, scale) {
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 4; col++) {
      const i = row * 4 + col;
      const bit = glyph[i] || 0;
      const noiseGate = (i + phase) % 3 !== 0;
      if (bit && noiseGate) {
        ctx.fillRect(x + col * scale, y + row * scale, scale * 0.7, scale * 0.7);
      }
    }
  }
}

export default function ClueReel({ nonce }) {
  const canvasRef = useRef(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const start = performance.now();
    let raf;

    function frame(now) {
      const t = now - start;
      const phase = Math.floor(t / 80);
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = "#000";
      ctx.font = "14px monospace";
      ctx.fillText("watch. do not pause.", 14, 24);
      ctx.fillText(`session ${nonce.slice(0, 6)}`, 14, 46);

      const labels = ["A", "B", "C"];
      for (let i = 0; i < 3; i++) {
        const x = 36 + i * 140;
        ctx.strokeStyle = "#000";
        ctx.strokeRect(x, 78, 90, 90);
        ctx.fillText(labels[i], x + 38, 130);
      }

      const active = Math.floor(t / 900) % 3;
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 3;
      ctx.strokeRect(36 + active * 140 - 4, 74, 98, 98);
      ctx.lineWidth = 1;

      if (t > 2600 && t < 8200) {
        ctx.fillStyle = "#000";
        const baseX = 62;
        const baseY = 210;
        glyphs.forEach((glyph, index) => {
          drawGlyph(ctx, baseX + index * 35, baseY, glyph, phase + index, 7);
        });
      }

      if (t > 8200) {
        ctx.fillStyle = phase % 2 ? "#000" : "#fff";
        ctx.fillRect(310, 78, 90, 90);
        ctx.fillStyle = phase % 2 ? "#fff" : "#000";
        ctx.fillText("C", 348, 130);
      }

      if (t < 10500) {
        raf = requestAnimationFrame(frame);
      } else {
        setPlaying(false);
      }
    }

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, nonce]);

  return (
    <section>
      <h2>reel</h2>
      <button onClick={() => setPlaying(true)} disabled={playing}>
        {playing ? "playing" : "play"}
      </button>
      <canvas ref={canvasRef} width="460" height="280" className="reel" />
    </section>
  );
}
