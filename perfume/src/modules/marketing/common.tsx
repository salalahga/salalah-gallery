// Shared bits for the marketing screens.
import { useEffect, useState } from 'react';
import { ApiError } from '../../core/api';

export const KIND: Record<string, { label: string; icon: string; platform: string }> = {
  post: { label: 'Instagram post', icon: '◻', platform: 'instagram' },
  reel: { label: 'Instagram Reel', icon: '▶', platform: 'instagram' },
  story: { label: 'Instagram Story', icon: '◯', platform: 'instagram' },
  facebook: { label: 'Facebook post', icon: 'f', platform: 'facebook' },
  whatsapp: { label: 'WhatsApp promotion', icon: '✆', platform: 'whatsapp' },
  web_product: { label: 'Website product', icon: '⌂', platform: 'website' },
  blog: { label: 'Blog article', icon: '✎', platform: 'website' },
  banner: { label: 'Website banner / slider', icon: '▭', platform: 'website' },
  landing: { label: 'Landing page', icon: '⌂', platform: 'website' },
  offer: { label: 'Website offer prices', icon: '%', platform: 'website' },
};
export const STATUS_LABEL: Record<string, string> = { draft: 'Draft', ai_generated: 'AI generated', under_review: 'Under review', approved: 'Approved', scheduled: 'Scheduled', published: 'Published', failed: 'Failed', archived: 'Archived' };
export const LANGS: [string, string][] = [['en', 'English'], ['ar', 'العربية'], ['ml', 'മലയാളം']];
export const TONES = ['luxury', 'premium', 'professional', 'emotional', 'modern', 'promotional'];
export const fileUrl = (id?: string | null) => (id ? `/api/files/${id}` : '');

/** Shrink big phone photos before upload (keeps the product untouched, only resized). */
export async function shrinkImage(file: File, max = 2000): Promise<string> {
  const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(img.src);
  return c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.9);
}
/** Raw upload for videos, music and large images. */
export async function uploadMedia(file: File, productId?: string) {
  const r = await fetch(`/api/marketing/assets/upload?name=${encodeURIComponent(file.name)}${productId ? `&productId=${productId}` : ''}`, { method: 'POST', headers: { 'content-type': file.type || 'application/octet-stream' }, body: file, credentials: 'same-origin' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, d.error || r.statusText, d);
  return d;
}

/** Poll while something is processing (video rendering). */
export function usePoll(active: boolean, fn: () => void, ms = 4000) {
  useEffect(() => { if (!active) return; const t = setInterval(fn, ms); return () => clearInterval(t); }, [active, fn, ms]);
}

export function PhonePreview({ kind, assets, caption, hashtags, account = 'belleame' }: { kind: string; assets: any[]; caption?: string | null; hashtags?: string | null; account?: string }) {
  const media = assets?.find((a) => a.status === 'ready' && (kind === 'reel' ? a.kind === 'video' : true)) || assets?.[0];
  const tall = ['reel', 'story'].includes(kind);
  const [more, setMore] = useState(false);
  const src = media?.file_id ? fileUrl(media.file_id) : '';
  const m = media?.status === 'processing' ? <div className="phone-wait">Rendering video…</div>
    : !src ? <div className="phone-wait">No image yet</div>
      : media.kind === 'video' ? <video src={src} controls playsInline loop muted autoPlay poster={media.params?.thumbFileId ? fileUrl(media.params.thumbFileId) : undefined} />
        : <img src={src} alt="" />;
  if (kind === 'whatsapp') return (
    <div className="phone wa"><div className="wa-bubble">{src && media?.kind === 'image' && <img src={src} alt="" />}<div className="wa-text">{caption}</div><div className="wa-time">now ✓✓</div></div></div>
  );
  return (
    <div className={'phone' + (tall ? ' tall' : '')}>
      {!tall && <div className="phone-head"><span className="av" />{account}</div>}
      <div className={'phone-media' + (tall ? ' tall' : kind === 'facebook' ? ' sq' : '')}>{m}{tall && caption && kind === 'story' && <div className="story-text">{caption}</div>}</div>
      {kind !== 'story' && <div className="phone-cap"><b>{account}</b> {more ? caption : (caption || '').slice(0, 120)}{(caption || '').length > 120 && !more && <button className="linkbtn" onClick={() => setMore(true)}>… more</button>}{hashtags && <div className="tags">{hashtags}</div>}</div>}
    </div>
  );
}
