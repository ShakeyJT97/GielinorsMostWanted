import { useEffect, useState } from 'react';

/** Full-screen screenshot viewer: click to zoom to actual size, arrows to move between images, Esc to close. */
export function Lightbox({ images, start, onClose, caption }: { images: string[]; start: number; onClose: () => void; caption?: string }) {
  const [i, setI] = useState(start);
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') { setI((x) => (x + 1) % images.length); setZoom(false); }
      if (e.key === 'ArrowLeft') { setI((x) => (x - 1 + images.length) % images.length); setZoom(false); }
    }
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [images.length, onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label={caption ?? 'Screenshot'} className="fixed inset-0 z-50 flex flex-col bg-black/90" onClick={onClose}>
      <div className="flex items-center gap-3 px-4 py-2 text-parchment-100" onClick={(e) => e.stopPropagation()}>
        <span className="mr-auto text-sm">{caption} {images.length > 1 && `(${i + 1} of ${images.length})`}</span>
        <button className="btn btn-sm border border-parchment-200/40" onClick={() => setZoom((z) => !z)}>{zoom ? 'Fit to screen' : 'Actual size'}</button>
        <a className="btn btn-sm border border-parchment-200/40" href={images[i]} target="_blank" rel="noreferrer">Open in new tab</a>
        <button className="btn btn-sm btn-brass" onClick={onClose} autoFocus>Close</button>
      </div>
      <div className={`flex-1 ${zoom ? 'overflow-auto' : 'flex items-center justify-center overflow-hidden'} p-2`} onClick={(e) => e.stopPropagation()}>
        <img src={images[i]} alt={`${caption ?? 'Screenshot'} ${i + 1}`} onClick={() => setZoom((z) => !z)}
          className={zoom ? 'max-w-none cursor-zoom-out' : 'max-h-full max-w-full cursor-zoom-in object-contain'} />
      </div>
      {images.length > 1 && (
        <div className="flex justify-center gap-3 py-2" onClick={(e) => e.stopPropagation()}>
          <button className="btn btn-sm border border-parchment-200/40 text-parchment-100" onClick={() => { setI((x) => (x - 1 + images.length) % images.length); setZoom(false); }}>Previous</button>
          <button className="btn btn-sm border border-parchment-200/40 text-parchment-100" onClick={() => { setI((x) => (x + 1) % images.length); setZoom(false); }}>Next</button>
        </div>
      )}
    </div>
  );
}
