import { useState } from 'react';
import { formatBytes, shrinkImage } from '../lib/images';
import { EVIDENCE_BUCKET, supabase } from '../lib/supabase';

const MAX_FILES = 3;
const MAX_BYTES = 5 * 1024 * 1024;       // storage limit per file, after shrinking
const MAX_PICK_BYTES = 25 * 1024 * 1024; // largest original we'll try to shrink
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/** Screenshot + link state shared by the player claim form and the admin entry form. */
export function useEvidence() {
  const [files, setFiles] = useState<File[]>([]);
  const [links, setLinks] = useState(['']);
  const [shrinking, setShrinking] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  async function addFiles(list: FileList | File[] | null) {
    setFileError(null);
    const picked = Array.from(list ?? []).slice(0, MAX_FILES - files.length);
    if (picked.length === 0) return;
    const wrongType = picked.find((f) => !IMAGE_TYPES.includes(f.type));
    if (wrongType) { setFileError(`${wrongType.name || 'That file'} isn't a PNG, JPG, WebP or GIF.`); return; }
    const huge = picked.find((f) => f.size > MAX_PICK_BYTES);
    if (huge) { setFileError(`${huge.name} is over 25 MB. Try a smaller screenshot.`); return; }
    setShrinking(true);
    try {
      const ready = await Promise.all(picked.map(shrinkImage));
      const tooBig = ready.find((f) => f.size > MAX_BYTES);
      if (tooBig) { setFileError(`${tooBig.name} is still over 5 MB after shrinking. GIFs aren't shrunk; try a PNG or JPG.`); return; }
      setFiles((prev) => [...prev, ...ready].slice(0, MAX_FILES));
    } finally {
      setShrinking(false);
    }
  }

  const cleanLinks = () => links.map((l) => l.trim()).filter(Boolean);

  /** Returns an error message, or null when the evidence is ready to send. */
  function validate(): string | null {
    const l = cleanLinks();
    if (files.length === 0 && l.length === 0) return 'Add at least one screenshot or link.';
    if (l.some((x) => !/^https:\/\/\S+$/i.test(x))) return 'Links must start with https://';
    return null;
  }

  function reset() { setFiles([]); setLinks(['']); setFileError(null); }

  return { files, setFiles, links, setLinks, shrinking, fileError, addFiles, cleanLinks, validate, reset };
}

export type Evidence = ReturnType<typeof useEvidence>;

/** Upload the files into evidence/{playerId}/{submissionId}/ and return their paths. */
export async function uploadEvidence(playerId: string, submissionId: string, files: File[]): Promise<string[]> {
  const paths: string[] = [];
  for (const [i, f] of files.entries()) {
    const ext = (f.name.split('.').pop() ?? 'png').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'png';
    const path = `${playerId}/${submissionId}/${i + 1}.${ext}`;
    const { error } = await supabase.storage.from(EVIDENCE_BUCKET).upload(path, f, { contentType: f.type, upsert: false });
    if (error) throw new Error(`Upload failed for ${f.name}: ${error.message}`);
    paths.push(path);
  }
  return paths;
}

export function EvidenceInputs({ ev, filesHint, linksHint, allowPaste = false }: {
  ev: Evidence; filesHint: string; linksHint: string; allowPaste?: boolean;
}) {
  const { files, setFiles, links, setLinks, shrinking, fileError, addFiles } = ev;
  return (
    <>
      <div onPaste={allowPaste ? (e) => { const imgs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/')); if (imgs.length) { e.preventDefault(); addFiles(imgs); } } : undefined}>
        <label className="label" htmlFor="ev-files">Screenshots</label>
        <input id="ev-files" type="file" accept={IMAGE_TYPES.join(',')} multiple
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
          disabled={files.length >= MAX_FILES || shrinking}
          className="block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-ink file:px-3 file:py-1.5 file:font-sc file:font-bold file:text-parchment-50" />
        <p className="hint">{filesHint}</p>
        {allowPaste && (
          <textarea aria-label="Paste a screenshot here" rows={1} value="" onChange={() => undefined}
            placeholder="Or click here and paste a copied image (Ctrl+V)"
            className="field mt-2 resize-none text-sm" />
        )}
        {shrinking && <p className="hint" role="status">Preparing screenshots…</p>}
        {fileError && <p className="mt-1 text-sm text-wax-pvm" role="alert">{fileError}</p>}
        {files.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm">
            {files.map((f, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span className="truncate">{f.name} <span className="text-ink-soft">({formatBytes(f.size)})</span></span>
                <button type="button" className="text-wax-pvm underline" onClick={() => setFiles(files.filter((_, j) => j !== i))}>Remove</button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <label className="label" htmlFor="ev-link0">Links</label>
        {links.map((l, i) => (
          <input key={i} id={`ev-link${i}`} className="field mt-1" type="url" placeholder="https://…" value={l}
            onChange={(e) => setLinks(links.map((x, j) => (j === i ? e.target.value : x)))} />
        ))}
        {links.length < 3 && <button type="button" className="mt-1 text-sm underline" onClick={() => setLinks([...links, ''])}>Add another link</button>}
        <p className="hint">{linksHint}</p>
      </div>
    </>
  );
}
