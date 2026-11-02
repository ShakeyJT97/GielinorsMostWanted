import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { errorMessage, supabase } from '../../lib/supabase';
import { PEN_COLOURS, PEN_SIZES, UNITS, pathD, shoutRefresh, useLiveDoodles, usePlayerNames, type Stroke } from '../../lib/doodles';

type Rect = { left: number; top: number; width: number; height: number };
type Mode = 'off' | 'draw' | 'erase';

const MAX_POINTS = 480;      // numbers per line = 2 × this

/**
 * The doodle layer over the noticeboard. Lines drawn on the wood are placed relative to the board's width;
 * lines drawn over a poster follow that poster (and leave with it when it retires).
 */
export function DoodleLayer({ boardRef, layoutKey }: { boardRef: RefObject<HTMLElement>; layoutKey: string }) {
  const { session, profile, isAdmin } = useAuth();
  const { strokes, setStrokes, refresh } = useLiveDoodles();
  const names = usePlayerNames(isAdmin).data;
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [rects, setRects] = useState<Map<string, Rect>>(new Map());
  const [mode, setMode] = useState<Mode>('off');
  const [color, setColor] = useState(PEN_COLOURS[0].value);
  const [pen, setPen] = useState(PEN_SIZES[1].value);
  const [live, setLive] = useState<number[] | null>(null);     // the line being drawn, in px
  const [mine, setMine] = useState<number[]>([]);              // my lines this visit, for undo
  const [hover, setHover] = useState<{ id: number; x: number; y: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem('gmw-hide-doodles') === '1'; } catch { return false; } });
  const drawing = useRef<number[] | null>(null);

  // Measure the board and where each poster sits on it
  const measure = useCallback(() => {
    const board = boardRef.current;
    if (!board) return;
    const b = board.getBoundingClientRect();
    setSize({ w: board.offsetWidth, h: board.offsetHeight });
    const m = new Map<string, Rect>();
    board.querySelectorAll<HTMLElement>('[data-doodle-contract]').forEach((el) => {
      const r = el.getBoundingClientRect();
      m.set(el.dataset.doodleContract!, { left: r.left - b.left, top: r.top - b.top, width: r.width, height: r.height });
    });
    setRects(m);
  }, [boardRef]);

  useLayoutEffect(() => {
    measure();
    const t = window.setTimeout(measure, 900);   // after poster animations and font loading settle
    return () => window.clearTimeout(t);
  }, [measure, layoutKey]);
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(board);
    return () => ro.disconnect();
  }, [boardRef, measure]);

  // Leave drawing mode with Escape
  useEffect(() => {
    if (mode === 'off') return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMode('off'); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [mode]);

  const W = size.w;
  const placed = useMemo(() => {
    if (!W) return [];
    const u = W / UNITS;
    const out: { s: Stroke; pts: number[]; width: number }[] = [];
    for (const s of strokes) {
      if (s.contract_id) {
        const r = rects.get(s.contract_id);
        if (!r || !s.poster_points || !s.poster_box) continue;     // poster not on the board right now
        const k = r.width / UNITS;
        out.push({ s, pts: s.poster_points.map((v, i) => (i % 2 ? r.top : r.left) + v * k), width: (s.width * r.width) / s.poster_box[2] });
      } else {
        out.push({ s, pts: s.points.map((v) => v * u), width: s.width * u });
      }
    }
    return out;
  }, [strokes, rects, W]);

  function local(e: RPointerEvent) {
    const b = boardRef.current!.getBoundingClientRect();
    return [Math.round((e.clientX - b.left) * 10) / 10, Math.round((e.clientY - b.top) * 10) / 10];
  }

  function down(e: RPointerEvent<SVGSVGElement>) {
    if (mode !== 'draw' || e.button > 0) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drawing.current = local(e);
    setLive([...drawing.current]);
  }
  function move(e: RPointerEvent<SVGSVGElement>) {
    const d = drawing.current;
    if (!d) return;
    const [x, y] = local(e);
    const dx = x - d[d.length - 2], dy = y - d[d.length - 1];
    if (dx * dx + dy * dy < 4) return;
    d.push(x, y);
    setLive([...d]);
    if (d.length >= MAX_POINTS * 2) up();
  }
  async function up() {
    const d = drawing.current;
    drawing.current = null;
    setLive(null);
    if (!d || !W) return;
    if (d.length === 2) d.push(d[0] + 0.5, d[1]);
    const u = UNITS / W;
    const points = d.map((v) => Math.round(v * u));

    // Which poster (if any) holds most of the line?
    let contract: string | null = null, best = 0;
    rects.forEach((r, id) => {
      let n = 0;
      for (let i = 0; i < d.length; i += 2) if (d[i] >= r.left && d[i] <= r.left + r.width && d[i + 1] >= r.top && d[i + 1] <= r.top + r.height) n++;
      if (n > best) { best = n; contract = id; }
    });
    let posterPoints: number[] | null = null, posterBox: number[] | null = null;
    if (contract && best * 2 > d.length / 2) {
      const r = rects.get(contract)!;
      const k = UNITS / r.width;
      posterPoints = d.map((v, i) => Math.round((v - (i % 2 ? r.top : r.left)) * k));
      posterBox = [r.left, r.top, r.width, r.height].map((v) => Math.round(v * u));
    } else contract = null;

    const temp: Stroke = { id: -Date.now(), player_id: session!.user.id, color, width: pen, points, contract_id: contract,
      poster_points: posterPoints, poster_box: posterBox, created_at: new Date().toISOString(), erased_at: null, snapshot_id: null };
    setStrokes((cur) => [...cur, temp]);
    const { data, error } = await supabase.rpc('draw_stroke', {
      p_color: color, p_width: pen, p_points: points, p_contract_id: contract, p_poster_points: posterPoints, p_poster_box: posterBox,
    });
    if (error) {
      setError(errorMessage(error));
      setStrokes((cur) => cur.filter((s) => s.id !== temp.id));
      return;
    }
    setError(null);
    const id = Number(data);
    setStrokes((cur) => (cur.some((s) => s.id === id) ? cur.filter((s) => s.id !== temp.id) : cur.map((s) => (s.id === temp.id ? { ...s, id } : s))));
    setMine((m) => [...m, id]);
  }

  async function undo() {
    const id = mine[mine.length - 1];
    if (!id) return;
    setMine((m) => m.slice(0, -1));
    setStrokes((cur) => cur.filter((s) => s.id !== id));
    const { error } = await supabase.rpc('undo_stroke', { p_id: id });
    if (error) { setError(errorMessage(error)); refresh(); } else shoutRefresh();
  }

  async function erase(s: Stroke) {
    setHover(null);
    setStrokes((cur) => cur.filter((x) => x.id !== s.id));
    const { error } = await supabase.rpc('erase_stroke', { p_id: s.id });
    if (error) { setError(errorMessage(error)); refresh(); } else shoutRefresh();
  }

  function toggleHidden() {
    setHidden((h) => { try { localStorage.setItem('gmw-hide-doodles', h ? '0' : '1'); } catch { /* not saved */ } return !h; });
  }

  const canDraw = !!session && !!profile?.rs_name && !profile.is_banned;
  const showLines = !hidden || mode !== 'off';

  return (
    <>
      {W > 0 && showLines && (
        <svg width={W} height={size.h} className="absolute left-0 top-0 z-10 overflow-visible"
          style={{ pointerEvents: mode === 'draw' ? 'auto' : 'none', touchAction: mode === 'draw' ? 'none' : undefined, cursor: mode === 'draw' ? 'crosshair' : undefined }}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-hidden={mode !== 'draw'}
          role={mode === 'draw' ? 'img' : undefined} aria-label={mode === 'draw' ? 'Drawing area over the board' : undefined}>
          <g strokeLinecap="round" strokeLinejoin="round" fill="none" style={{ filter: 'drop-shadow(0 1px 0.6px rgba(0,0,0,.45))' }}>
            {placed.map(({ s, pts, width }) => (
              <path key={s.id} d={pathD(pts)} stroke={s.color} strokeWidth={Math.max(width, 0.8)}
                opacity={mode === 'erase' && hover?.id === s.id ? 0.35 : 0.92} />
            ))}
            {live && <path d={pathD(live)} stroke={color} strokeWidth={(pen * W) / UNITS} opacity={0.92} />}
          </g>
          {mode === 'erase' && (
            <g fill="none" stroke="transparent" strokeLinecap="round" style={{ pointerEvents: 'stroke', cursor: 'pointer' }}>
              {placed.map(({ s, pts, width }) => (
                <path key={s.id} d={pathD(pts)} strokeWidth={Math.max(width, 2) + 16}
                  onPointerEnter={(e) => { const b = boardRef.current!.getBoundingClientRect(); setHover({ id: s.id, x: e.clientX - b.left, y: e.clientY - b.top }); }}
                  onPointerLeave={() => setHover((h) => (h?.id === s.id ? null : h))}
                  onClick={() => erase(s)} />
              ))}
            </g>
          )}
        </svg>
      )}
      {mode === 'erase' && hover && (
        <span className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-[140%] whitespace-nowrap rounded bg-ink px-2 py-0.5 text-xs text-parchment-50"
          style={{ left: hover.x, top: hover.y }}>
          {names?.get(strokes.find((s) => s.id === hover.id)?.player_id ?? '') ?? 'Someone'} · click to erase
        </span>
      )}

      {/* The entry buttons sit on the board; the toolbar floats while drawing */}
      <div className="mx-auto mt-4 flex flex-wrap items-center justify-center gap-2">
        {canDraw && mode === 'off' && (
          <button className="rounded-full bg-oak-900/70 px-3.5 py-1 font-sc text-sm font-bold text-parchment-100 shadow-[0_2px_4px_rgba(0,0,0,.4)] hover:bg-oak-900"
            onClick={() => { setHidden(false); setMode(profile?.is_draw_banned ? 'off' : 'draw'); if (profile?.is_draw_banned) setError('An admin has stopped you drawing on the board.'); }}>
            ✎ Draw on the board
          </button>
        )}
        {strokes.length > 0 && mode === 'off' && (
          <button className="rounded-full bg-oak-900/70 px-3.5 py-1 font-sc text-sm font-bold text-parchment-100 shadow-[0_2px_4px_rgba(0,0,0,.4)] hover:bg-oak-900"
            aria-pressed={hidden} onClick={toggleHidden}>
            {hidden ? 'Show doodles' : 'Hide doodles'}
          </button>
        )}
        {mode === 'off' && (
          <Link to="/gallery" className="rounded-full bg-oak-900/70 px-3.5 py-1 font-sc text-sm font-bold text-parchment-100 no-underline shadow-[0_2px_4px_rgba(0,0,0,.4)] hover:bg-oak-900">
            Doodle gallery
          </Link>
        )}
        {error && mode === 'off' && <span className="rounded bg-wax-pvm px-3 py-1 text-sm text-parchment-50">{error}</span>}
      </div>

      {mode !== 'off' && (
        <div className="sheet fixed bottom-3 left-3 right-3 z-40 mx-auto flex max-w-2xl flex-wrap items-center gap-x-3 gap-y-2 !p-3 shadow-[0_10px_30px_rgba(0,0,0,.6)] sm:bottom-6"
          role="toolbar" aria-label="Drawing tools">
          {mode === 'draw' ? (
            <>
              <div className="flex gap-1.5" role="radiogroup" aria-label="Pen colour">
                {PEN_COLOURS.map((c) => (
                  <button key={c.value} role="radio" aria-checked={color === c.value} aria-label={c.name} title={c.name}
                    onClick={() => setColor(c.value)}
                    className={`h-7 w-7 rounded-full border-2 shadow-inner ${color === c.value ? 'border-ink ring-2 ring-ink/40 ring-offset-1 ring-offset-parchment-100' : 'border-ink/30'}`}
                    style={{ background: c.value }} />
                ))}
              </div>
              <div className="flex gap-1" role="radiogroup" aria-label="Pen size">
                {PEN_SIZES.map((p) => (
                  <button key={p.value} role="radio" aria-checked={pen === p.value} title={p.name} aria-label={p.name}
                    onClick={() => setPen(p.value)}
                    className={`grid h-8 w-8 place-items-center rounded border ${pen === p.value ? 'border-ink bg-ink/10' : 'border-ink/25'}`}>
                    <span className="block rounded-full bg-ink" style={{ width: 4 + p.value / 7, height: 4 + p.value / 7 }} />
                  </button>
                ))}
              </div>
              <button className="btn btn-sm btn-ghost" disabled={mine.length === 0} onClick={undo}>Undo</button>
              {isAdmin && <button className="btn btn-sm btn-ghost" onClick={() => setMode('erase')}>Eraser</button>}
            </>
          ) : (
            <>
              <p className="text-sm"><strong>Eraser:</strong> hover a line to see who drew it, click to remove it.</p>
              <button className="btn btn-sm btn-ghost" onClick={() => setMode('draw')}>Back to pen</button>
            </>
          )}
          <button className="btn btn-sm btn-ink ml-auto" onClick={() => { setMode('off'); setHover(null); }}>Done</button>
          {error && <p className="w-full text-sm font-bold text-wax-pvm">{error}</p>}
          {mode === 'draw' && <p className="w-full text-xs text-ink-soft">Lines on a poster stay with it. Keep it to the clan's idea of fun; admins can erase anything.</p>}
        </div>
      )}
    </>
  );
}
