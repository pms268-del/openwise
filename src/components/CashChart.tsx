// Simple dependency-free SVG line chart of cumulative cash by scenario.
type Pt = { month: number; cumulative: number };
export function CashChart({ series }: { series: { name: string; color: string; points: Pt[] }[] }) {
  const all = series.flatMap((s) => s.points);
  if (!all.length) return null;
  const W = 520, H = 180, pad = 36;
  const maxM = Math.max(...all.map((p) => p.month)), minY = Math.min(0, ...all.map((p) => p.cumulative)), maxY = Math.max(0, ...all.map((p) => p.cumulative));
  const x = (m: number) => pad + ((m - 1) / Math.max(1, maxM - 1)) * (W - pad * 1.5);
  const y = (v: number) => H - pad / 2 - ((v - minY) / Math.max(1, maxY - minY)) * (H - pad);
  const fmt = (v: number) => `${v < 0 ? "-" : ""}$${Math.round(Math.abs(v) / 1000)}k`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Cumulative cash position by scenario">
      <line x1={pad} x2={W - pad / 2} y1={y(0)} y2={y(0)} stroke="#a8a29e" strokeDasharray="3 3" />
      <text x={2} y={y(maxY) + 4} fontSize="10" fill="#78716c">{fmt(maxY)}</text>
      <text x={2} y={y(minY)} fontSize="10" fill="#78716c">{fmt(minY)}</text>
      <text x={2} y={y(0) + 3} fontSize="10" fill="#78716c">$0</text>
      {series.map((s) => <polyline key={s.name} fill="none" stroke={s.color} strokeWidth="2" points={s.points.map((p) => `${x(p.month)},${y(p.cumulative)}`).join(" ")} />)}
      {series.map((s, i) => <text key={s.name} x={pad + i * 110} y={12} fontSize="11" fill={s.color}>■ {s.name}</text>)}
      <text x={W - 4} y={H - 2} fontSize="10" fill="#78716c" textAnchor="end">month {maxM}</text>
    </svg>
  );
}
