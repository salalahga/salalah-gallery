// Conversational marketing assistant: Claude + tools over live ERP data. Every action goes through the
// same permission checks as the screens; publishing still requires approval.
import * as P from './providers.js';
import * as E from './engine.js';
import { fail } from '../../util.js';

const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
const S = { type: 'string' }, N = { type: 'number' }, SA = { type: 'array', items: { type: 'string' } };
const TOOLS = [
  { name: 'find_products', description: 'Search the product catalogue (name, brand, SKU). Returns ids, sizes, prices in OMR, stock and whether a photo exists. Use "new" to list products added in the last 7 days.', input_schema: obj({ search: S }), strict: true },
  { name: 'marketing_summary', description: 'Followers, reach, engagement, website visits, published/scheduled/pending content and social-channel sales for a date range (YYYY-MM-DD).', input_schema: obj({ from: S, to: S }), strict: true },
  { name: 'campaign_performance', description: 'Every campaign with orders and revenue (OMR) attributed through its promotion, coupon or campaign tag, budget and spend.', input_schema: obj({}), strict: true },
  { name: 'list_content', description: 'List marketing content. status: draft, ai_generated, under_review, approved, scheduled, published, failed, archived or "any".', input_schema: obj({ status: S, limit: N }), strict: true },
  { name: 'create_content_package', description: 'Create AI marketing content for one product: kinds from post, story, reel, facebook, whatsapp, web_product. Creates drafts for approval (never publishes). lang: en, ar or ml. badge: short label like "New arrival" or "20% off" or empty.', input_schema: obj({ product_id: S, kinds: SA, lang: S, tone: S, badge: S, promotion_text: S }), strict: true },
  { name: 'write_copy', description: 'Write marketing copy for a product without saving it (captions, descriptions, hashtags, WhatsApp text, SEO).', input_schema: obj({ product_id: S, lang: S, tone: S, promotion_text: S }), strict: true },
  { name: 'schedule_content', description: 'Schedule approved content for a date-time in Oman time (YYYY-MM-DDTHH:MM). Requires approval permission.', input_schema: obj({ content_id: S, at: S }), strict: true },
  { name: 'create_campaign', description: 'Create a draft campaign. kind: new_arrivals, weekend, monthly, discount, luxury_collection, seasonal, clearance, gifts, occasion. Dates YYYY-MM-DD. budget in OMR.', input_schema: obj({ name: S, kind: S, start_date: S, end_date: S, product_ids: SA, discount_text: S, platforms: SA, budget: N }), strict: true },
  { name: 'sales_by_channel', description: 'Sales (OMR) and orders by channel (pos, web, whatsapp, instagram, facebook…) for a date range.', input_schema: obj({ from: S, to: S }), strict: true },
];

const SYSTEM = `You are the marketing assistant inside Belle Âme's perfume shop ERP (Salalah, Oman; currency OMR with 3 decimals; timezone Asia/Muscat).
Answer only from tool results — never invent numbers, products, followers, reach or sales. If data is missing or a service is not connected, say so plainly.
Content you create is a draft for the owner's approval; never claim something was published unless a tool says so.
Reply in the user's language (English, Arabic or Malayalam). Be brief and practical; use short lists. Money: "OMR 12.500".`;

async function runTool(q, name, input, ctx) {
  const { can, user } = ctx;
  const today = E.localDate();
  switch (name) {
    case 'find_products': {
      const s = String(input.search || '').toLowerCase();
      const rows = await q(`SELECT p.id, p.name, b.name AS brand, p.image_url IS NOT NULL AS has_photo, p.created_at::date::text AS added,
          json_agg(json_build_object('size', COALESCE(v.size_ml::text || ' ml', v.label), 'price', (COALESCE(v.web_price, v.retail_price)/1000.0), 'stock', COALESCE((SELECT SUM(qty) FROM stock_levels sl WHERE sl.variant_id = v.id),0))) AS sizes
        FROM products p LEFT JOIN brands b ON b.id = p.brand_id JOIN variants v ON v.product_id = p.id AND v.active
        WHERE p.active AND ($1 = '' OR ($1 = 'new' AND p.created_at > now() - interval '7 days') OR lower(p.name) LIKE '%' || $1 || '%' OR lower(COALESCE(b.name,'')) LIKE '%' || $1 || '%' OR lower(v.sku) LIKE '%' || $1 || '%')
        GROUP BY p.id, b.name ORDER BY p.created_at DESC LIMIT 15`, [s]);
      return rows;
    }
    case 'marketing_summary': return E.dashboard(q, { from: input.from || today.slice(0, 8) + '01', to: input.to || today });
    case 'campaign_performance': return (await E.campaignPerformance(q, {})).map((c) => ({ ...c, revenue_omr: Number(c.revenue) / 1000, budget_omr: Number(c.budget) / 1000, spend_omr: Number(c.spend) / 1000 }));
    case 'list_content': return q(`SELECT id, number, kind, title, status, scheduled_at, published_at, external_url, error FROM mkt_content WHERE ($1 = 'any' OR status = $1) ORDER BY updated_at DESC LIMIT $2`, [input.status || 'any', Math.min(Number(input.limit) || 10, 30)]);
    case 'create_content_package':
      if (!can('marketing', 'create')) fail(403, 'You do not have permission to create marketing content');
      return E.buildPackage(q, { productId: input.product_id, kinds: input.kinds, lang: input.lang || 'en', tone: input.tone || undefined, badge: input.badge || undefined, promo: input.promotion_text || undefined, user });
    case 'write_copy': {
      const p = await E.productInfo(q, input.product_id);
      return E.writeCopy(q, p, { lang: input.lang || 'en', tone: input.tone || 'luxury', promo: input.promotion_text || '' }, p.id);
    }
    case 'schedule_content': {
      const at = E.omanAt(String(input.at).slice(0, 10), String(input.at).slice(11, 16));
      await E.transition(q, input.content_id, 'schedule', { user, can, scheduledAt: at });
      return { scheduled: true, at: at.toISOString() };
    }
    case 'create_campaign': {
      if (!can('marketing', 'create')) fail(403, 'You do not have permission to create campaigns');
      const { id } = await import('../../util.js');
      const cid = id('cmp_');
      await q(`INSERT INTO mkt_campaigns (id, name, kind, start_date, end_date, product_ids, discount_text, platforms, budget, utm, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [cid, input.name, input.kind || 'discount', input.start_date || null, input.end_date || null, input.product_ids || [], input.discount_text || null, input.platforms || [], Math.round((Number(input.budget) || 0) * 1000), cid.slice(4, 12).toLowerCase(), user.id]);
      return { id: cid, status: 'draft' };
    }
    case 'sales_by_channel':
      return q(`SELECT channel, COUNT(*)::int AS orders, (SUM(total - refunded)/1000.0) AS revenue_omr FROM sales WHERE status NOT IN ('pending','cancelled') AND created_at::date BETWEEN $1 AND $2 GROUP BY channel ORDER BY 3 DESC`, [input.from || today.slice(0, 8) + '01', input.to || today]);
    default: fail(400, 'Unknown tool');
  }
}

/** messages: [{role:'user'|'assistant', content: string}] from the chat UI (text only). */
export async function chat(q, history, ctx) {
  const messages = history.slice(-12).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 4000) }));
  if (!messages.length || messages[0].role !== 'user') fail(400, 'Ask a question');
  messages.push({ role: 'system', content: `Today is ${E.localDate()} (Oman). The user is ${ctx.user.name} (${ctx.user.role}).` });
  const actions = [];
  for (let i = 0; i < 6; i++) {
    const r = await P.claude(q, { system: SYSTEM, messages, tools: TOOLS, effort: 'low', maxTokens: 8000 });
    messages.push({ role: 'assistant', content: r.content }); // keep every block (thinking included) for the next turn
    if (r.stop_reason !== 'tool_use') return { reply: P.textOf(r), actions };
    const results = [];
    for (const b of r.content.filter((x) => x.type === 'tool_use')) {
      try {
        const out = await runTool(q, b.name, b.input || {}, ctx);
        actions.push({ tool: b.name, ok: true });
        results.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)).slice(0, 20000) });
      } catch (e) {
        actions.push({ tool: b.name, ok: false, error: e.message });
        results.push({ type: 'tool_result', tool_use_id: b.id, is_error: true, content: e.message });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  return { reply: 'I could not finish this request in a few steps — please ask something more specific.', actions };
}
