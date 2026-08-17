"use client";

import { useEffect, useRef } from "react";

// Hand-rolled <canvas> chart renderers — matches v3b's native-canvas approach
// (AdminJS.html draws its charts directly on canvas, no Chart.js dependency).
// Reads theme colors off CSS custom properties so it follows the tenant
// branding + light/dark toggle like everything else.

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function setupCanvas(canvas: HTMLCanvasElement, cssHeight: number): { ctx: CanvasRenderingContext2D; w: number; h: number } {
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || 600;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  canvas.style.height = `${cssHeight}px`;
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  return { ctx, w: cssWidth, h: cssHeight };
}

const PADDING = { top: 16, right: 16, bottom: 44, left: 52 };

function drawAxes(ctx: CanvasRenderingContext2D, w: number, h: number, maxVal: number, labels: string[], grid: string, muted: string, font: string, yTitle?: string, xTitle?: string) {
  const plotW = w - PADDING.left - PADDING.right;
  const plotH = h - PADDING.top - PADDING.bottom;
  ctx.font = "10px 'IBM Plex Mono', monospace";
  ctx.strokeStyle = grid;
  ctx.fillStyle = muted;
  ctx.lineWidth = 1;
  // Y gridlines + labels (5 steps)
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const y = PADDING.top + (plotH * i) / steps;
    const val = Math.round(maxVal * (1 - i / steps));
    ctx.beginPath();
    ctx.moveTo(PADDING.left, y);
    ctx.lineTo(w - PADDING.right, y);
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.fillText(String(val), PADDING.left - 6, y + 3);
  }
  // X labels (thinned to avoid overlap)
  ctx.textAlign = "center";
  const skip = Math.ceil(labels.length / 12);
  labels.forEach((lb, i) => {
    if (i % skip !== 0) return;
    const x = PADDING.left + (plotW * (i + 0.5)) / labels.length;
    ctx.fillText(lb.length > 6 ? lb.slice(5) : lb, x, h - PADDING.bottom + 16);
  });
  if (yTitle) {
    ctx.save();
    ctx.translate(12, PADDING.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillStyle = muted;
    ctx.fillText(yTitle, 0, 0);
    ctx.restore();
  }
  if (xTitle) {
    ctx.textAlign = "center";
    ctx.fillText(xTitle, PADDING.left + plotW / 2, h - 6);
  }
  return { plotW, plotH };
}

export function LineChart({ labels, values, height = 220, yTitle, xTitle }: { labels: string[]; values: number[]; height?: number; yTitle?: string; xTitle?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const { ctx, w, h } = setupCanvas(c, height);
    const accent = cssVar("--accent-optic", "#C6FF3D");
    const maxVal = Math.max(1, ...values);
    const { plotW, plotH } = drawAxes(ctx, w, h, maxVal, labels, cssVar("--line-grid", "#1C2733"), cssVar("--text-dim", "#7C93A3"), accent, yTitle, xTitle);
    if (!values.length) return;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = PADDING.left + (plotW * (i + 0.5)) / values.length;
      const y = PADDING.top + plotH * (1 - v / maxVal);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.fillStyle = accent;
    values.forEach((v, i) => {
      const x = PADDING.left + (plotW * (i + 0.5)) / values.length;
      const y = PADDING.top + plotH * (1 - v / maxVal);
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    });
  }, [labels, values, height, yTitle, xTitle]);
  return <canvas ref={ref} style={{ width: "100%", height }} />;
}

export function BarChart({ labels, values, color, height = 220, yTitle, xTitle }: { labels: string[]; values: number[]; color?: string; height?: number; yTitle?: string; xTitle?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const { ctx, w, h } = setupCanvas(c, height);
    const bar = color ?? cssVar("--accent-cyan", "#2EE6FF");
    const maxVal = Math.max(1, ...values);
    const { plotW, plotH } = drawAxes(ctx, w, h, maxVal, labels, cssVar("--line-grid", "#1C2733"), cssVar("--text-dim", "#7C93A3"), bar, yTitle, xTitle);
    const bw = (plotW / Math.max(1, values.length)) * 0.6;
    ctx.fillStyle = bar;
    values.forEach((v, i) => {
      const cx = PADDING.left + (plotW * (i + 0.5)) / values.length;
      const barH = plotH * (v / maxVal);
      ctx.fillRect(cx - bw / 2, PADDING.top + plotH - barH, bw, barH);
    });
  }, [labels, values, color, height, yTitle, xTitle]);
  return <canvas ref={ref} style={{ width: "100%", height }} />;
}

export function StackedBarChart({ labels, series, height = 260, yTitle, xTitle }: { labels: string[]; series: { label: string; color: string; data: number[] }[]; height?: number; yTitle?: string; xTitle?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const { ctx, w, h } = setupCanvas(c, height);
    const totals = labels.map((_, i) => series.reduce((s, ser) => s + (ser.data[i] ?? 0), 0));
    const maxVal = Math.max(1, ...totals);
    const { plotW, plotH } = drawAxes(ctx, w, h, maxVal, labels, cssVar("--line-grid", "#1C2733"), cssVar("--text-dim", "#7C93A3"), "#fff", yTitle, xTitle);
    const bw = (plotW / Math.max(1, labels.length)) * 0.6;
    labels.forEach((_, i) => {
      const cx = PADDING.left + (plotW * (i + 0.5)) / labels.length;
      let yBase = PADDING.top + plotH;
      series.forEach((ser) => {
        const v = ser.data[i] ?? 0;
        if (v <= 0) return;
        const segH = plotH * (v / maxVal);
        ctx.fillStyle = ser.color;
        ctx.fillRect(cx - bw / 2, yBase - segH, bw, segH);
        yBase -= segH;
      });
    });
    // legend
    ctx.font = "10px 'IBM Plex Mono', monospace";
    let lx = PADDING.left;
    series.forEach((ser) => {
      ctx.fillStyle = ser.color;
      ctx.fillRect(lx, 2, 8, 8);
      ctx.fillStyle = cssVar("--text-dim", "#7C93A3");
      ctx.textAlign = "left";
      ctx.fillText(ser.label, lx + 11, 10);
      lx += 16 + ctx.measureText(ser.label).width + 11;
    });
  }, [labels, series, height, yTitle, xTitle]);
  return <canvas ref={ref} style={{ width: "100%", height }} />;
}

export function DoughnutChart({ labels, values, colors, height = 220 }: { labels: string[]; values: number[]; colors: string[]; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const { ctx, w, h } = setupCanvas(c, height);
    const total = values.reduce((s, v) => s + v, 0) || 1;
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) / 2 - 20;
    let start = -Math.PI / 2;
    values.forEach((v, i) => {
      const ang = (v / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, start, start + ang);
      ctx.closePath();
      ctx.fillStyle = colors[i % colors.length];
      ctx.fill();
      start += ang;
    });
    // hole
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.58, 0, Math.PI * 2);
    ctx.fillStyle = cssVar("--bg-panel", "#0D1520");
    ctx.fill();
    // legend
    ctx.font = "10px 'IBM Plex Mono', monospace";
    ctx.textAlign = "left";
    labels.forEach((lb, i) => {
      const y = 12 + i * 14;
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(4, y - 8, 8, 8);
      ctx.fillStyle = cssVar("--text-dim", "#7C93A3");
      ctx.fillText(`${lb} (${values[i]})`, 16, y);
    });
  }, [labels, values, colors, height]);
  return <canvas ref={ref} style={{ width: "100%", height }} />;
}
