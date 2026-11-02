import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loading, Sheet } from '../components/ui';
import { UNITS, tracePath, useAllDoodles, useSnapshots, type Stroke } from '../lib/doodles';
import { must, supabase } from '../lib/supabase';
import { fmtDateTime } from '../lib/format';

const LOGICAL_W = 1200;   // the gallery draws every board at this width

type Moment = { label: string; at: number };

/** Doodles that were on the board at a given moment. */
function visibleAt(strokes: Stroke[], at: number, snapshotTimes: Map<number, number>, retired: Map<string, number>) {
  return strokes.filter((s) => {
    if (new Date(s.created_at).getTime() > at) return false;
    if (s.snapshot_id != null && (snapshotTimes.get(s.snapshot_id) ?? Infinity) <= at) return false;
    if (s.contract_id && (retired.get(s.contract_id) ?? Infinity) <= at) return false;
    return true;
  });
}

function drawBoard(canvas: HTMLCanvasElement, strokes: Stroke[], titles: Map<string, string>, scale: number) {
  const u = LOGICAL_W / UNITS;
  // Posters: one box per poster, from its most recent doodle
  const boxes = new Map<string, number[]>();
  for (const s of strokes) if (s.contract_id && s.poster_box) boxes.set(s.contract_id, s.poster_box);
  // Crop to the part of the board that has something on it
  let minY = Infinity, maxY = 0;
  for (const s of strokes) {
    if (s.contract_id) continue;
    for (let i = 1; i < s.points.length; i += 2) { minY = Math.min(minY, s.points[i] * u); maxY = Math.max(maxY, s.points[i] * u); }
  }
  boxes.forEach((b) => { minY = Math.min(minY, b[1] * u); maxY = Math.max(maxY, (b[1] + b[3]) * u); });
  const top = Number.isFinite(minY) ? Math.max(0, Math.floor(minY - 60)) : 0;
  const H = Math.max(500, Math.ceil(maxY - top + 60));

  canvas.width = LOGICAL_W * scale;
  canvas.height = H * scale;
  canvas.style.aspectRatio = `${LOGICAL_W} / ${H}`;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(scale, 0, 0, scale, 0, -top * scale);

  // Wood
  const g = ctx.createLinearGradient(0, 0, LOGICAL_W, 0);
  g.addColorStop(0, '#5d3d21'); g.addColorStop(0.3, '#7a5330'); g.addColorStop(0.6, '#6a4626'); g.addColorStop(1, '#7d5531');
  ctx.fillStyle = g; ctx.fillRect(0, top, LOGICAL_W, H);
  for (let y = 118; y < top + H; y += 121) {
    ctx.fillStyle = 'rgba(20,10,3,.55)'; ctx.fillRect(0, y, LOGICAL_W, 3);
    ctx.fillStyle = 'rgba(255,220,170,.06)'; ctx.fillRect(0, y + 3, LOGICAL_W, 2);
  }

  // Posters
  boxes.forEach((b, id) => {
    const [x, y, w, h] = b.map((v) => v * u);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
    ctx.fillStyle = '#e6d3a6'; ctx.fillRect(x, y, w, h);
    ctx.restore();
    ctx.strokeStyle = 'rgba(60,40,20,.35)'; ctx.lineWidth = 1; ctx.strokeRect(x + 6, y + 6, w - 12, h - 12);
    ctx.fillStyle = '#2a1c11'; ctx.textAlign = 'center';
    ctx.font = `${Math.max(14, w / 9)}px Rye, Georgia, serif`;
    ctx.fillText('Bounty', x + w / 2, y + h * 0.16);
    ctx.font = `bold ${Math.max(11, w / 14)}px "Alegreya SC", Georgia, serif`;
    wrap(ctx, titles.get(id) ?? 'A bounty', x + w / 2, y + h * 0.27, w - 30, Math.max(13, w / 12));
    ctx.beginPath(); ctx.arc(x + w / 2, y + 14, 6, 0, Math.PI * 2); ctx.fillStyle = '#2b2a28'; ctx.fill();
  });

  // Doodles
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 1; ctx.shadowOffsetY = 1;
  for (const s of strokes) {
    let pts: number[]; let width: number;
    if (s.contract_id && s.poster_points && s.poster_box) {
      const b = boxes.get(s.contract_id)!;
      const k = (b[2] * u) / UNITS;
      pts = s.poster_points.map((v, i) => (i % 2 ? b[1] : b[0]) * u + v * k);
      width = (s.width * b[2] * u) / s.poster_box[2];
    } else {
      pts = s.points.map((v) => v * u);
      width = s.width * u;
    }
    ctx.globalAlpha = 0.92; ctx.strokeStyle = s.color; ctx.lineWidth = Math.max(width, 0.8);
    tracePath(ctx, pts); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, lh: number) {
  const words = text.split(' '); let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > max && line) { ctx.fillText(line, x, y); line = w; y += lh; } else line = test;
  }
  if (line) ctx.fillText(line, x, y);
}

export default function GalleryPage() {
  const all = useAllDoodles();
  const snaps = useSnapshots();
  const strokes = all.data ?? [];
  const ids = useMemo(() => [...new Set(strokes.map((s) => s.contract_id).filter(Boolean) as string[])], [strokes]);
  const contracts = useQuery({
    queryKey: ['gallery-contracts', ids.join()],
    enabled: ids.length > 0,
    queryFn: async () => must(await supabase.from('contracts').select('id, title, retired_at').in('id', ids)) as { id: string; title: string; retired_at: string | null }[],
  });
  const titles = useMemo(() => new Map((contracts.data ?? []).map((c) => [c.id, c.title])), [contracts.data]);
  const retired = useMemo(() => new Map((contracts.data ?? []).filter((c) => c.retired_at).map((c) => [c.id, new Date(c.retired_at!).getTime()])), [contracts.data]);
  const snapTimes = useMemo(() => new Map((snaps.data ?? []).map((s) => [s.id, new Date(s.taken_at).getTime()])), [snaps.data]);

  const [now] = useState(() => Date.now());
  const first = Math.min(strokes.length ? new Date(strokes[0].created_at).getTime() : now, now - 3_600_000);
  const moments: Moment[] = useMemo(() => [
    ...(snaps.data ?? []).map((s) => ({ label: s.name, at: new Date(s.taken_at).getTime() - 1 })),
    { label: 'The board now', at: now },
  ], [snaps.data, now]);
  const [at, setAt] = useState<number | null>(null);
  const when = at ?? now;
  const shown = useMemo(() => visibleAt(strokes, when, snapTimes, retired), [strokes, when, snapTimes, retired]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvasRef.current) return;
    const draw = () => drawBoard(canvasRef.current!, shown, titles, Math.min(2, window.devicePixelRatio || 1));
    draw();
    document.fonts?.ready.then(draw);
  }, [shown, titles]);

  function download() {
    const c = document.createElement('canvas');
    drawBoard(c, shown, titles, 2);
    const a = document.createElement('a');
    a.download = `board-doodles-${new Date(when).toISOString().slice(0, 16).replace(/[T:]/g, '-')}.png`;
    a.href = c.toDataURL('image/png');
    a.click();
  }

  const activeMoment = moments.find((m) => m.at === when);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Sheet>
        <h1 className="font-display text-3xl text-ink">The doodle gallery</h1>
        <p className="text-ink-soft">
          Everything the clan has scrawled on the board, at any moment of the hunt. Pick a saved board or drag through time, then
          download it for the collage. Doodles on a poster are shown on that poster. <Link to="/">Back to the board</Link>
        </p>

        {all.isLoading ? <Loading /> : strokes.length === 0 ? (
          <p className="mt-4">Nobody has drawn on the board yet.</p>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label="Saved boards">
              {moments.map((m) => (
                <button key={`${m.label}-${m.at}`} className={`btn btn-sm ${activeMoment === m ? 'btn-ink' : 'btn-ghost'}`}
                  aria-pressed={activeMoment === m} onClick={() => setAt(m.at === now ? null : m.at)}>
                  {m.label}
                </button>
              ))}
            </div>
            <label className="mt-4 block">
              <span className="text-sm font-bold">Scrub through time: {fmtDateTime(new Date(when).toISOString())}</span>
              <input type="range" className="mt-1 w-full accent-[#8e1f1f]" min={first} max={now} step={60_000} value={when}
                onChange={(e) => setAt(Number(e.target.value) >= now - 60_000 ? null : Number(e.target.value))} />
            </label>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <p className="text-sm text-ink-soft">{shown.length} {shown.length === 1 ? 'line' : 'lines'} on the board at this moment.</p>
              <button className="btn btn-sm btn-wax ml-auto" onClick={download} disabled={shown.length === 0}>Download picture</button>
            </div>
          </>
        )}
      </Sheet>
      {strokes.length > 0 && (
        <canvas ref={canvasRef} className="block w-full rounded-md shadow-[0_10px_30px_rgba(0,0,0,.6)]" role="img"
          aria-label={`The board's doodles at ${fmtDateTime(new Date(when).toISOString())}`} />
      )}
    </div>
  );
}
