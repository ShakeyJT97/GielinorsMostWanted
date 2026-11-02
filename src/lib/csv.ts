import { supabase } from './supabase';

type Row = Record<string, unknown>;

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = Array.isArray(v) ? v.join(' ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
  // Quote everything that needs it; neutralise spreadsheet formulas in user-entered text
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: Row[], columns: [key: string, header: string][]): string {
  const head = columns.map(([, h]) => cell(h)).join(',');
  const body = rows.map((r) => columns.map(([k]) => cell(r[k])).join(','));
  return [head, ...body].join('\r\n');
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }); // BOM so Excel reads accents
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Read every row of a table in pages of 1000 (Supabase's per-request limit). */
export async function fetchAll(table: string, select: string, orderBy: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(select).order(orderBy).range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < 1000) return out;
  }
}

export const stamp = () => new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '');
