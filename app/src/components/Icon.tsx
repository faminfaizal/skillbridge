// Inline SVG icon set (no emoji as UI icons). Decorative by default: pair with visible text.
const PATHS: Record<string, string> = {
  spark: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z M19 3v4 M17 5h4",
  network: "M12 7.5v4 M12 11.5 6.5 17 M12 11.5l5.5 5.5",
  star: "m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z",
  alert: "M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z M12 9v4 M12 17h.01",
  zap: "M13 2 3 14h9l-1 8 10-12h-9z",
  x: "M18 6 6 18 M6 6l12 12",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  back: "M19 12H5 M11 6l-6 6 6 6",
  chart: "M3 3v18h18 M7 15l4-4 3 3 5-6",
  search: "M20 20l-3.5-3.5",
  user: "M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1",
  grad: "M22 10 12 5 2 10l10 5z M6 12v5c3 2 9 2 12 0v-5",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  check: "M20 6 9 17l-5-5",
  coin: "M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .9-3 2s1.3 1.8 3 2 3 .9 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5 M12 6.5v1.5 M12 16v1.5",
  trend: "M3 17l6-6 4 4 8-8 M14 7h7v7",
  clock: "M12 7v5l3 2",
  headset: "M3 14v-2a9 9 0 0 1 18 0v2 M20 20a2 2 0 0 1-2 2h-4",
  reset: "M3 12a9 9 0 1 0 3-6.7L3 8 M3 3v5h5",
  copy: "M9 9h11v11H9z M5 15H4V4h11v1",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  brief: "M4 5h16v14H4z M8 9h8 M8 13h8 M8 17h5",
  bridge: "M2 17h20 M4 17v-3a8 8 0 0 1 16 0v3 M9 17v-4 M15 17v-4",
  gauge: "M4 18a9 9 0 1 1 16 0 M12 14l4.5-4.5",
  island: "M2 19c3-2 7-2 10 0s7 2 10 0 M7 15a5 5 0 0 1 10 0 M12 10V4l4 2-4 2",
  offchart: "M3 7V3h4 M17 3h4v4 M21 17v4h-4 M7 21H3v-4 M7.5 18a4.5 4.5 0 0 1 9 0",
  chevron: "M6 9l6 6 6-6",
  users: "M2 21v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1 M16 4.5a3.5 3.5 0 0 1 0 7 M22 21v-1a5 5 0 0 0-3.5-4.8",
  plus: "M12 5v14 M5 12h14",
  minus: "M5 12h14",
  chat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z M8 9h8 M8 13h5",
  upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z",
  eyeoff: "M3 3l18 18 M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9 M6.6 6.6C3.8 8.4 2 12 2 12s4 7 10 7a9.7 9.7 0 0 0 5.4-1.6",
  edit: "M4 20h4L19 9l-4-4L4 16z M13.5 6.5l4 4",
  lock: "M6 11h12v10H6z M8 11V7a4 4 0 0 1 8 0v4",
  doc: "M6 2h9l5 5v15H6z M14 2v6h6 M9 13h8 M9 17h6",
  inbox: "M22 12h-6l-2 3h-4l-2-3H2 M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1z",
  hand:"M12 21c4 0 7-3 7-7v-3a2 2 0 0 0-4 0 M15 11V6a2 2 0 0 0-4 0v5 M11 10V5a2 2 0 0 0-4 0v8l-1.5-1.5a2 2 0 0 0-3 2.6L7 19",
};
const CIRCLES: Record<string, [number, number, number][]> = {
  network: [[12, 5, 2.5], [5, 19, 2.5], [19, 19, 2.5]],
  search: [[11, 11, 7]],
  user: [[12, 8, 4]],
  users: [[9, 8, 3.5]],
  coin: [[12, 12, 9]],
  clock: [[12, 12, 9]],
  offchart: [[12, 10, 3]],
  eye: [[12, 12, 3]],
};

export function Icon({ name, label, className = "icon" }: { name: string; label?: string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden={label ? undefined : true} role={label ? "img" : undefined} aria-label={label}>
      {(CIRCLES[name] ?? []).map(([cx, cy, r], i) => <circle key={i} cx={cx} cy={cy} r={r} />)}
      <path d={PATHS[name] ?? ""} />
      {name === "headset" && <><rect x="2" y="14" width="4" height="6" rx="1.5" /><rect x="18" y="14" width="4" height="6" rx="1.5" /></>}
    </svg>
  );
}
