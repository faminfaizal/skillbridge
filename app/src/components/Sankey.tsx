"use client";
// Value sources -> total unlocked -> reinvestment initiatives. Bands are drawn to one scale.
import { money } from "../lib/format";

export interface Flow { label: string; value: number; color: string; note?: string }

export default function Sankey({ sources, targets, totalLabel }: { sources: Flow[]; targets: Flow[]; totalLabel: string }) {
  const VW = 1000, VH = 380, pad = 16;
  const total = sources.reduce((s, d) => s + d.value, 0) || 1;
  const tTotal = targets.reduce((s, d) => s + d.value, 0) || 1;
  const gapL = 14, gapR = 10;
  const k = (VH - pad * 2 - gapR * Math.max(0, targets.length - 1)) / Math.max(total, tTotal);
  const xL = 260, xC = 480, xR = 700, nw = 10, cw = 36;
  const cH = total * k, cY = (VH - cH) / 2;
  const band = (x0: number, a0: number, b0: number, x1: number, a1: number, b1: number) => {
    const mx = (x0 + x1) / 2;
    return `M${x0},${a0} C${mx},${a0} ${mx},${a1} ${x1},${a1} L${x1},${b1} C${mx},${b1} ${mx},${b0} ${x0},${b0} Z`;
  };
  let y = (VH - (cH + gapL * (sources.length - 1))) / 2, cy = cY;
  const left = sources.map((s) => {
    const h = s.value * k, r = { ...s, y, h, cy };
    y += h + gapL; cy += h;
    return r;
  });
  const tk = (cH) / tTotal;
  y = (VH - (cH + gapR * (targets.length - 1))) / 2; cy = cY;
  const right = targets.map((t) => {
    const h = t.value * tk, r = { ...t, y, h, cy };
    y += h + gapR; cy += h;
    return r;
  });
  return (
    <svg className="sankey" viewBox={`0 0 ${VW} ${VH}`} role="img" aria-label={`${totalLabel}: value sources flowing into reinvestment initiatives`}>
      <defs>
        <linearGradient id="sk-c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#38bdf8" /><stop offset="1" stopColor="#a78bfa" /></linearGradient>
      </defs>
      {left.map((s) => (
        <g key={s.label}>
          <path d={band(xL + nw, s.y, s.y + s.h, xC, s.cy, s.cy + s.h)} fill={s.color} fillOpacity={0.32}><title>{`${s.label}: ${money(s.value)}`}</title></path>
          <rect x={xL} y={s.y} width={nw} height={Math.max(2, s.h)} rx={3} fill={s.color} />
          <text x={xL - 12} y={s.y + s.h / 2 - 2} textAnchor="end" fontSize={15} fill="#e8eefc">{s.label}</text>
          <text x={xL - 12} y={s.y + s.h / 2 + 16} textAnchor="end" fontSize={14} fontWeight={700} fill={s.color}>{money(s.value)}</text>
        </g>
      ))}
      {right.map((t) => (
        <g key={t.label}>
          <path d={band(xC + cw, t.cy, t.cy + t.h, xR, t.y, t.y + t.h)} fill="#a78bfa" fillOpacity={0.2}><title>{`${t.label}: ${money(t.value)}`}</title></path>
          <rect x={xR} y={t.y} width={nw} height={Math.max(2, t.h)} rx={3} fill="#a78bfa" />
          <text x={xR + nw + 12} y={t.y + t.h / 2 - 1} fontSize={15} fill="#e8eefc">{t.label}</text>
          <text x={xR + nw + 12} y={t.y + t.h / 2 + 16} fontSize={13} fill="#b4c0d8">{`${money(t.value)}${t.note ? ` · ${t.note}` : ""}`}</text>
        </g>
      ))}
      <rect x={xC} y={cY} width={cw} height={cH} rx={8} fill="url(#sk-c)" />
      <text x={xC + cw / 2} y={VH / 2} dy={6} textAnchor="middle" fontSize={16} fontWeight={700} fill="#04111f" transform={`rotate(-90 ${xC + cw / 2} ${VH / 2})`}>{totalLabel}</text>
    </svg>
  );
}
