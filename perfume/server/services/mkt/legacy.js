// One-time import of the catalogue published on the old belleameoman.com (Hostinger Website Builder).
// Names, brand lines, prices and photos are exactly as they appear on that site (checked 2026-11-18).
import sharp from 'sharp';
import { id } from '../../util.js';
import { saveFile } from './studio.js';

const IMG_DEFAULT = 'https://cdn.zyrosite.com/cdn-cgi/image/format=jpeg,w=1200,fit=scale-down/cdn-ecommerce/store_01J2XQ8XF6VDEKN8HWT6Z7VCEK%2Fassets%2F';
const D1 = 'Indulge in our carefully curated collection of perfumes and fragrances that embody elegance, sophistication, and allure. Each scent tells a unique story, crafted to enhance your natural charm and captivate the senses.';
const D2 = 'Indulge in our exquisite fragrances that embody elegance, sophistication, and allure. Each scent tells a unique story, enhancing your natural charm and captivating the senses.';

export const LEGACY_PRODUCTS = [
  { name: 'Leo Hebrew Collection', brand: null, price: 15750, file: '1722416327300-WhatsApp%20Image%202024-07-31%20at%2012.13.33%20PM.jpeg', old: '/leo-hebrew-collection' },
  { name: 'Luxury Edition Magic', brand: 'Linea De Bella', price: 20000, file: '1722414432052-WhatsApp%20Image%202024-07-30%20at%206.07.06%20PM.jpeg', old: '/luxury-edition-magic' },
  { name: 'Laid Back Girl', brand: 'Paris', price: 15750, file: '1722414997201-WhatsApp%20Image%202024-07-31%20at%2012.13.29%20PM.jpeg', old: '/captivating-fragrances-collection', description: D1 },
  { name: 'Sensu', brand: null, price: 11025, file: '1722415096908-WhatsApp%20Image%202024-07-31%20at%2012.13.30%20PM.jpeg', old: '/captivating-fragrances-collection-2', description: D2 },
  { name: 'Sports Homme', brand: 'Luxe', price: 13650, file: '1722415156438-WhatsApp%20Image%202024-07-31%20at%2012.13.30%20PM%20(1).jpeg', old: '/captivating-fragrances-collection-3', description: D2 },
  { name: '3D Emperor', brand: 'Luxe', price: 14700, file: '1722415212220-WhatsApp%20Image%202024-07-31%20at%2012.13.31%20PM.jpeg', old: '/captivating-fragrances-for-beautiful-souls', description: D1 },
  { name: 'Signature Collection Pantheon', brand: 'Pantheon', price: 8400, file: '1722415267401-WhatsApp%20Image%202024-07-31%20at%2012.13.31%20PM%20(1).jpeg', old: '/captivating-fragrance-collection-2', description: D2 },
  { name: 'Signature Collection Charonne', brand: 'Charonne', price: 8400, file: '1722415392820-WhatsApp%20Image%202024-07-31%20at%2012.13.31%20PM%20(2).jpeg', old: '/captivating-fragrances-collection-4', description: D1 },
];

async function brandId(q, name) {
  if (!name) return null;
  const b = await q.one('SELECT id FROM brands WHERE lower(name) = lower($1)', [name]);
  if (b) return b.id;
  const bid = id('brd_');
  await q('INSERT INTO brands (id, name) VALUES ($1,$2)', [bid, name]);
  return bid;
}

async function photo(q, file, fetchImpl) {
  const r = await fetchImpl((process.env.LEGACY_IMG_BASE || IMG_DEFAULT) + file);
  if (!r.ok) throw new Error(`photo download failed (${r.status})`);
  const buf = await sharp(Buffer.from(await r.arrayBuffer())).rotate().jpeg({ quality: 90 }).toBuffer();
  return `/api/files/${await saveFile(q, buf, 'image/jpeg', decodeURIComponent(file))}`;
}

/** Creates the old-site products that are not in the catalogue yet (matched by name). Safe to run again. */
export async function importLegacy(db, { saveVariant, productFields, fetchImpl = fetch, items = LEGACY_PRODUCTS }) {
  const q = db.query;
  const created = []; const skipped = []; const failed = [];
  for (const it of items) {
    if (await q.one('SELECT id FROM products WHERE lower(name) = lower($1) AND active', [it.name])) { skipped.push(it.name); continue; }
    try {
      const imageUrl = await photo(q, it.file, fetchImpl);
      const pid = await db.tx(async (tq) => {
        const pid = id('prd_');
        const b = { name: it.name, brandId: await brandId(tq, it.brand), description: it.description || null, imageUrl, webVisible: true, active: true };
        await tq(`INSERT INTO products (name, name_ar, brand_id, category_id, description, description_ar, gender, concentration, notes_top, notes_heart, notes_base, image_url, web_visible, active, id, is_test)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,false)`, [...productFields(b), pid]);
        await saveVariant(tq, pid, { label: 'Standard', retailPrice: it.price, webPrice: it.price, openingQty: 0 }, null, { perms: {} }, b);
        return pid;
      });
      created.push({ id: pid, name: it.name, price: it.price });
    } catch (e) { failed.push({ name: it.name, error: e.message }); }
  }
  return { created, skipped, failed };
}
