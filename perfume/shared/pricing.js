// Cart pricing and promotions engine — the single implementation used by the POS screen (preview)
// and by the server (authoritative; the server always recomputes and never trusts client totals).
//
// Stacking rule (prevents unauthorised discount stacking):
//   • At most ONE non-stackable promotion applies to a cart — the one that saves the customer the most.
//   • Promotions explicitly marked `stackable` by the owner may add on top, each on what is left.
//   • A manual (cashier) discount is refused when any promotion applied, unless the caller passes
//     allowManualWithPromo (the server sets that only for users holding POS "approve").
import { lineTax, pct, allocate } from './money.js';

const lower = (s) => String(s || '').trim().toLowerCase();

/** Is this promotion usable for this cart context (dates, channel, branch, audience, coupon, limits)? */
export function promoEligible(p, ctx) {
  const now = ctx.now ? new Date(ctx.now) : new Date();
  if (p.status !== 'approved') return 'not approved';
  if (p.starts_at && new Date(p.starts_at) > now) return 'not started';
  if (p.ends_at && new Date(p.ends_at) < now) return 'expired';
  if (p.channels?.length && !p.channels.includes(ctx.channel)) return 'other channel';
  if (p.branch_ids?.length && !p.branch_ids.includes(ctx.branchId)) return 'other branch';
  if (p.usage_limit != null && p.used_count >= p.usage_limit) return 'usage limit reached';
  if (p.coupon_code && lower(p.coupon_code) !== lower(ctx.couponCode)) return 'coupon required';
  const c = ctx.customer;
  if (p.customer_ids?.length && !(c && p.customer_ids.includes(c.id))) return 'customer-specific';
  switch (p.audience) {
    case 'customers': if (!c) return 'registered customers only'; break;
    case 'vip': if (!c?.vip) return 'VIP only'; break;
    case 'segment': if (!c || lower(c.segment) !== lower(p.segment)) return 'segment only'; break;
    case 'staff': if (!ctx.isStaff) return 'staff only'; break;
    case 'wholesale': if (!ctx.isWholesale) return 'wholesale only'; break;
  }
  return null;
}

function lineMatches(p, l) {
  const lists = [p.variant_ids, p.product_ids, p.category_ids, p.brand_ids];
  if (lists.every((x) => !x?.length)) return true;
  return (p.variant_ids || []).includes(l.variantId) || (p.product_ids || []).includes(l.productId)
    || (p.category_ids || []).includes(l.categoryId) || (p.brand_ids || []).includes(l.brandId);
}

/** Expand matching lines into single units, most expensive first: [{i, price}] */
function units(lines, idx) {
  const out = [];
  for (const i of idx) for (let k = 0; k < lines[i].qty; k++) out.push({ i, price: lines[i].remaining / lines[i].qty });
  return out.sort((a, b) => b.price - a.price);
}

/** Discount per line index for one promotion against the lines' remaining amounts. */
export function promoDiscount(p, lines) {
  const idx = lines.map((l, i) => (lineMatches(p, l) ? i : -1)).filter((i) => i >= 0);
  const per = new Array(lines.length).fill(0);
  if (!idx.length) return per;
  const base = idx.reduce((a, i) => a + lines[i].remaining, 0);
  if (base < (p.min_purchase || 0)) return per;
  const v = Number(p.value || 0);
  if (p.type === 'percent') {
    if (p.scope === 'order') allocate(pct(base, v), idx.map((i) => lines[i].remaining)).forEach((d, k) => { per[idx[k]] = d; });
    else for (const i of idx) per[i] = pct(lines[i].remaining, v);
  } else if (p.type === 'fixed') {
    if (p.scope === 'order') allocate(Math.min(v, base), idx.map((i) => lines[i].remaining)).forEach((d, k) => { per[idx[k]] = d; });
    else for (const i of idx) per[i] = Math.min(lines[i].remaining, v * lines[i].qty);
  } else if (p.type === 'fixed_price') {
    for (const i of idx) per[i] = Math.max(0, lines[i].remaining - v * lines[i].qty);
  } else if (p.type === 'buy_x_get_y') {
    const buy = p.buy_qty || 1, get = p.get_qty || 1, off = v || 10000;
    const u = units(lines, idx);
    for (let g = 0; g + buy + get <= u.length; g += buy + get) {
      for (let k = g + buy; k < g + buy + get; k++) per[u[k].i] += pct(u[k].price, off);
    }
  } else if (p.type === 'bundle_price') {
    const n = p.bundle_qty || 2;
    const u = units(lines, idx);
    for (let g = 0; g + n <= u.length; g += n) {
      const grp = u.slice(g, g + n);
      const sum = grp.reduce((a, x) => a + x.price, 0);
      const save = Math.max(0, sum - v);
      allocate(Math.round(save), grp.map((x) => x.price)).forEach((d, k) => { per[grp[k].i] += d; });
    }
  }
  for (const i of idx) per[i] = Math.min(Math.round(per[i]), lines[i].remaining);
  let total = per.reduce((a, b) => a + b, 0);
  if (p.max_discount != null && total > p.max_discount) {
    const capped = allocate(p.max_discount, per);
    for (let i = 0; i < per.length; i++) per[i] = capped[i];
    total = p.max_discount;
  }
  return per;
}

/**
 * Price a cart.
 * lines: [{ variantId, productId, brandId, categoryId, qty, unitPrice, vatRateBp, unitCost? }]
 * opts:  { promotions, ctx, inclusive=true, manualDiscount: {type:'percent'|'fixed', value}, allowManualWithPromo }
 */
export function priceCart(lines, opts = {}) {
  const { promotions = [], ctx = {}, inclusive = true, manualDiscount, allowManualWithPromo = false } = opts;
  const work = lines.map((l) => ({ ...l, gross: l.unitPrice * l.qty, remaining: l.unitPrice * l.qty, discount: 0, promotionId: null }));
  const applied = [];
  const skipped = [];
  const eligible = [];
  for (const p of promotions) {
    const why = promoEligible(p, ctx);
    if (why) { if (p.coupon_code && ctx.couponCode && lower(p.coupon_code) === lower(ctx.couponCode)) skipped.push({ id: p.id, name: p.name, reason: why }); continue; }
    eligible.push(p);
  }
  const apply = (p, per) => {
    const amount = per.reduce((a, b) => a + b, 0);
    if (amount <= 0) return;
    per.forEach((d, i) => { if (d) { work[i].remaining -= d; work[i].discount += d; work[i].promotionId ||= p.id; } });
    applied.push({ id: p.id, name: p.name, amount, couponCode: p.coupon_code || null });
  };
  // best single non-stackable promotion
  let best = null;
  for (const p of eligible.filter((x) => !x.stackable)) {
    const per = promoDiscount(p, work);
    const amount = per.reduce((a, b) => a + b, 0);
    if (amount > 0 && (!best || amount > best.amount || (amount === best.amount && (p.priority || 0) > (best.p.priority || 0)))) best = { p, per, amount };
  }
  if (best) apply(best.p, best.per);
  for (const p of eligible.filter((x) => x.stackable).sort((a, b) => (b.priority || 0) - (a.priority || 0))) apply(p, promoDiscount(p, work));
  for (const p of eligible.filter((x) => !x.stackable && x !== best?.p)) skipped.push({ id: p.id, name: p.name, reason: 'not combinable with a better offer' });

  let manualBlocked = false;
  let manual = 0;
  if (manualDiscount && Number(manualDiscount.value) > 0) {
    if (applied.length && !allowManualWithPromo) manualBlocked = true;
    else {
      const base = work.reduce((a, l) => a + l.remaining, 0);
      manual = manualDiscount.type === 'percent' ? pct(base, Math.round(Number(manualDiscount.value) * 100)) : Math.min(base, Math.round(Number(manualDiscount.value)));
      allocate(manual, work.map((l) => l.remaining)).forEach((d, i) => { work[i].remaining -= d; work[i].discount += d; });
    }
  }
  const out = work.map((l) => {
    const t = lineTax(l.remaining, l.vatRateBp ?? 0, inclusive);
    return { ...l, net: t.net, vat: t.vat, total: t.total };
  });
  const sum = (k) => out.reduce((a, l) => a + l[k], 0);
  return {
    lines: out, applied, skipped, manualDiscount: manual, manualBlocked,
    subtotal: sum('gross'), discount: sum('discount'), net: sum('net'), vat: sum('vat'), total: sum('total'),
  };
}
