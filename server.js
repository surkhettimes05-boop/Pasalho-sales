require('dotenv/config');
const path = require('path');
const express = require('express');
const { pool, initDb } = require('./src/db');
const { signToken, hashPin, comparePin, authRequired } = require('./src/auth');
const { resolvePrice } = require('./src/pricing');

const app = express();
const PORT = process.env.PORT || 3000;
const dbReady = initDb();

app.use(express.json({ limit: '200kb' }));
app.use('/api', async (req, res, next) => {
  try {
    await dbReady;
    next();
  } catch (error) {
    next(error);
  }
});
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const money = n => Number(Number(n || 0).toFixed(2));

app.get('/health', (_req, res) => res.json({ ok: true, service: 'pasalho-sales' }));
app.get('/api/config', (_req, res) => res.json({
  whatsappNumber: process.env.WHATSAPP_NUMBER || '',
  currency: process.env.CURRENCY || 'NPR'
}));

app.get('/control', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'control.html')));

app.post('/api/auth/admin', (req, res) => {
  const supplied = String(req.body.password || '');
  const expected = String(process.env.ADMIN_PASSWORD || '');
  if (!expected) return res.status(503).json({ error: 'ADMIN_PASSWORD is not configured' });
  if (supplied !== expected) return res.status(401).json({ error: 'Invalid password' });
  res.json({ token: signToken({ role: 'admin', sub: 'admin' }) });
});

app.post('/api/auth/rep', asyncRoute(async (req, res) => {
  const { phone, pin } = req.body;
  if (!phone || !pin) return res.status(400).json({ error: 'Phone and PIN are required' });
  const { rows } = await pool.query('SELECT id, name, phone, pin_hash, active FROM sales_reps WHERE phone=$1', [String(phone).trim()]);
  const rep = rows[0];
  if (!rep || !rep.active || !(await comparePin(pin, rep.pin_hash))) return res.status(401).json({ error: 'Invalid phone or PIN' });
  res.json({ token: signToken({ role: 'rep', sub: String(rep.id), name: rep.name }), rep: { id: rep.id, name: rep.name, phone: rep.phone } });
}));

app.get('/api/products', authRequired(), asyncRoute(async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT p.id, p.sku, p.name, p.category, p.unit, p.base_price,
      COALESCE(json_agg(json_build_object('min_qty', s.min_qty, 'price', s.price) ORDER BY s.min_qty) FILTER (WHERE s.id IS NOT NULL), '[]') slabs
    FROM products p
    LEFT JOIN price_slabs s ON s.product_id=p.id
    WHERE p.active=TRUE
    GROUP BY p.id
    ORDER BY p.category, p.name
  `);
  res.json(rows);
}));

app.get('/api/retailers', authRequired(), asyncRoute(async (req, res) => {
  const params = [];
  let where = 'WHERE r.active=TRUE';
  if (req.user.role === 'rep') {
    params.push(Number(req.user.sub));
    where += ` AND r.sales_rep_id=$${params.length}`;
  }
  const { rows } = await pool.query(`
    SELECT r.*,
      MAX(o.created_at) last_order_at,
      COUNT(o.id)::int order_count,
      COALESCE(SUM(o.total),0) lifetime_sales
    FROM retailers r
    LEFT JOIN orders o ON o.retailer_id=r.id
    ${where}
    GROUP BY r.id
    ORDER BY r.shop_name
  `, params);
  res.json(rows);
}));

app.post('/api/retailers', authRequired(), asyncRoute(async (req, res) => {
  const { shopName, ownerName, phone, area, address, locationUrl, paymentTermsDays } = req.body;
  if (!shopName) return res.status(400).json({ error: 'Shop name is required' });
  const repId = req.user.role === 'rep' ? Number(req.user.sub) : Number(req.body.salesRepId || 0) || null;
  const { rows } = await pool.query(`
    INSERT INTO retailers (sales_rep_id, shop_name, owner_name, phone, area, address, location_url, payment_terms_days)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    RETURNING *
  `, [repId, shopName.trim(), ownerName || null, phone || null, area || null, address || null, locationUrl || null, Number(paymentTermsDays || 7)]);
  res.status(201).json(rows[0]);
}));

app.get('/api/my/orders', authRequired('rep'), asyncRoute(async (req, res) => {
  const repId = Number(req.user.sub);
  const { rows } = await pool.query(`
    SELECT o.*, r.shop_name,
      COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.order_id=o.id),0) paid_amount
    FROM orders o JOIN retailers r ON r.id=o.retailer_id
    WHERE o.sales_rep_id=$1
    ORDER BY o.created_at DESC LIMIT 100
  `, [repId]);
  res.json(rows);
}));

app.post('/api/orders', authRequired('rep'), asyncRoute(async (req, res) => {
  const repId = Number(req.user.sub);
  const { retailerId, items, deliveryDate, notes } = req.body;
  if (!retailerId || !Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Retailer and items are required' });

  const retail = await pool.query('SELECT * FROM retailers WHERE id=$1 AND sales_rep_id=$2 AND active=TRUE', [retailerId, repId]);
  if (!retail.rows[0]) return res.status(403).json({ error: 'Retailer is not assigned to this sales rep' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const prepared = [];
    let orderTotal = 0;

    for (const item of items) {
      const productId = Number(item.productId);
      const qty = Number(item.quantity);
      if (!productId || !Number.isFinite(qty) || qty <= 0) throw Object.assign(new Error('Invalid order item'), { status: 400 });
      const pr = await client.query(`
        SELECT p.id, p.name, p.unit, p.base_price,
          COALESCE(json_agg(json_build_object('min_qty',s.min_qty,'price',s.price) ORDER BY s.min_qty) FILTER (WHERE s.id IS NOT NULL), '[]') slabs
        FROM products p LEFT JOIN price_slabs s ON s.product_id=p.id
        WHERE p.id=$1 AND p.active=TRUE GROUP BY p.id
      `, [productId]);
      const product = pr.rows[0];
      if (!product) throw Object.assign(new Error('Product not found'), { status: 400 });
      const quote = resolvePrice(product.base_price, product.slabs, qty);
      const lineTotal = money(quote.price * qty);
      orderTotal += lineTotal;
      prepared.push({ product, qty, unitPrice: money(quote.price), lineTotal });
    }

    const inserted = await client.query(`
      INSERT INTO orders (retailer_id, sales_rep_id, delivery_date, notes, total)
      VALUES ($1,$2,$3,$4,$5) RETURNING *
    `, [retailerId, repId, deliveryDate || null, notes || null, money(orderTotal)]);
    const order = inserted.rows[0];
    const orderNo = `SO-${String(order.id).padStart(6, '0')}`;
    await client.query('UPDATE orders SET order_no=$1 WHERE id=$2', [orderNo, order.id]);

    for (const line of prepared) {
      await client.query(`
        INSERT INTO order_items (order_id, product_id, product_name_snapshot, unit_snapshot, quantity, unit_price, line_total)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, [order.id, line.product.id, line.product.name, line.product.unit, line.qty, line.unitPrice, line.lineTotal]);
    }

    await client.query('COMMIT');
    res.status(201).json({
      id: order.id,
      orderNo,
      retailer: retail.rows[0],
      salesRep: req.user.name,
      deliveryDate: deliveryDate || null,
      notes: notes || '',
      total: money(orderTotal),
      items: prepared.map(x => ({ productId: x.product.id, name: x.product.name, unit: x.product.unit, quantity: x.qty, unitPrice: x.unitPrice, lineTotal: x.lineTotal }))
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

app.get('/api/my/unpaid-orders', authRequired('rep'), asyncRoute(async (req, res) => {
  const repId = Number(req.user.sub);
  const { rows } = await pool.query(`
    SELECT o.id, o.order_no, o.retailer_id, r.shop_name, o.total, o.created_at,
      COALESCE(SUM(p.amount),0) paid_amount,
      (o.total-COALESCE(SUM(p.amount),0)) balance
    FROM orders o
    JOIN retailers r ON r.id=o.retailer_id
    LEFT JOIN payments p ON p.order_id=o.id
    WHERE o.sales_rep_id=$1
    GROUP BY o.id, r.shop_name
    HAVING o.total-COALESCE(SUM(p.amount),0) > 0
    ORDER BY o.created_at DESC
  `, [repId]);
  res.json(rows);
}));

app.post('/api/payments', authRequired(), asyncRoute(async (req, res) => {
  const { retailerId, orderId, amount, paymentDate, method, note } = req.body;
  const value = Number(amount);
  if (!retailerId || !orderId || !Number.isFinite(value) || value <= 0) return res.status(400).json({ error: 'Retailer, order and positive amount are required' });
  const repId = req.user.role === 'rep' ? Number(req.user.sub) : (Number(req.body.salesRepId || 0) || null);
  const orderCheck = await pool.query('SELECT id, retailer_id, sales_rep_id, total FROM orders WHERE id=$1', [orderId]);
  const order = orderCheck.rows[0];
  if (!order || Number(order.retailer_id) !== Number(retailerId)) return res.status(400).json({ error: 'Order does not belong to retailer' });
  if (req.user.role === 'rep' && Number(order.sales_rep_id) !== repId) return res.status(403).json({ error: 'Forbidden' });
  const paid = await pool.query('SELECT COALESCE(SUM(amount),0) total FROM payments WHERE order_id=$1', [orderId]);
  const balance = Number(order.total) - Number(paid.rows[0].total);
  if (value > balance + 0.001) return res.status(400).json({ error: `Payment exceeds order balance (${money(balance)})` });
  const { rows } = await pool.query(`
    INSERT INTO payments (retailer_id, sales_rep_id, order_id, amount, payment_date, method, note)
    VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
  `, [retailerId, repId, orderId, money(value), paymentDate || new Date().toISOString().slice(0,10), method || 'Cash', note || null]);
  res.status(201).json(rows[0]);
}));

app.get('/api/admin/reps', authRequired('admin'), asyncRoute(async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT sr.id, sr.name, sr.phone, sr.active, sr.created_at,
      COUNT(DISTINCT r.id)::int retailers,
      COUNT(DISTINCT o.id)::int orders,
      COALESCE(SUM(DISTINCT CASE WHEN o.id IS NOT NULL THEN 0 ELSE 0 END),0) ignored,
      COALESCE((SELECT SUM(o2.total) FROM orders o2 WHERE o2.sales_rep_id=sr.id),0) sales,
      COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.sales_rep_id=sr.id),0) collections,
      COALESCE((SELECT AVG(o3.total) FROM orders o3 WHERE o3.sales_rep_id=sr.id),0) avg_order
    FROM sales_reps sr
    LEFT JOIN retailers r ON r.sales_rep_id=sr.id
    LEFT JOIN orders o ON o.sales_rep_id=sr.id
    GROUP BY sr.id
    ORDER BY sr.active DESC, sr.name
  `);
  res.json(rows);
}));

app.post('/api/admin/reps', authRequired('admin'), asyncRoute(async (req, res) => {
  const { name, phone, pin } = req.body;
  if (!name || !phone || !pin || String(pin).length < 4) return res.status(400).json({ error: 'Name, phone and PIN (4+ chars) are required' });
  const pinHash = await hashPin(pin);
  const { rows } = await pool.query('INSERT INTO sales_reps (name, phone, pin_hash) VALUES ($1,$2,$3) RETURNING id,name,phone,active,created_at', [name.trim(), phone.trim(), pinHash]);
  res.status(201).json(rows[0]);
}));

app.patch('/api/admin/reps/:id', authRequired('admin'), asyncRoute(async (req, res) => {
  const active = Boolean(req.body.active);
  const { rows } = await pool.query('UPDATE sales_reps SET active=$1 WHERE id=$2 RETURNING id,name,phone,active', [active, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Rep not found' });
  res.json(rows[0]);
}));

app.get('/api/admin/products', authRequired('admin'), asyncRoute(async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT p.*, COALESCE(json_agg(json_build_object('min_qty',s.min_qty,'price',s.price) ORDER BY s.min_qty) FILTER (WHERE s.id IS NOT NULL), '[]') slabs
    FROM products p LEFT JOIN price_slabs s ON s.product_id=p.id
    GROUP BY p.id ORDER BY p.category,p.name
  `);
  res.json(rows);
}));

app.post('/api/admin/products', authRequired('admin'), asyncRoute(async (req, res) => {
  const { sku, name, category, unit, basePrice, slabs } = req.body;
  if (!name || !unit || !Number.isFinite(Number(basePrice))) return res.status(400).json({ error: 'Name, unit and base price are required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`INSERT INTO products (sku,name,category,unit,base_price) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [sku || null, name.trim(), category || 'General', unit.trim(), money(basePrice)]);
    const product = rows[0];
    for (const slab of Array.isArray(slabs) ? slabs : []) {
      if (Number(slab.minQty) > 0 && Number(slab.price) >= 0) await client.query('INSERT INTO price_slabs (product_id,min_qty,price) VALUES ($1,$2,$3)', [product.id, Number(slab.minQty), money(slab.price)]);
    }
    await client.query('COMMIT');
    res.status(201).json(product);
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));

app.put('/api/admin/products/:id', authRequired('admin'), asyncRoute(async (req, res) => {
  const { sku, name, category, unit, basePrice, active, slabs } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`UPDATE products SET sku=$1,name=$2,category=$3,unit=$4,base_price=$5,active=$6,updated_at=NOW() WHERE id=$7 RETURNING *`, [sku || null, name, category || 'General', unit, money(basePrice), active !== false, req.params.id]);
    if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Product not found' }); }
    await client.query('DELETE FROM price_slabs WHERE product_id=$1', [req.params.id]);
    for (const slab of Array.isArray(slabs) ? slabs : []) {
      if (Number(slab.minQty) > 0 && Number(slab.price) >= 0) await client.query('INSERT INTO price_slabs (product_id,min_qty,price) VALUES ($1,$2,$3)', [req.params.id, Number(slab.minQty), money(slab.price)]);
    }
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));

app.get('/api/admin/overview', authRequired('admin'), asyncRoute(async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT
      (SELECT COALESCE(SUM(total),0) FROM orders WHERE created_at::date=CURRENT_DATE) sales_today,
      (SELECT COUNT(*) FROM orders WHERE created_at::date=CURRENT_DATE)::int orders_today,
      (SELECT COUNT(*) FROM sales_reps WHERE active=TRUE)::int active_reps,
      (SELECT COUNT(*) FROM retailers WHERE active=TRUE)::int retailers,
      (SELECT COUNT(*) FROM retailers WHERE created_at >= date_trunc('month',CURRENT_DATE))::int new_retailers_month,
      (SELECT COALESCE(SUM(amount),0) FROM payments WHERE payment_date=CURRENT_DATE) collections_today,
      (SELECT COALESCE(SUM(o.total),0)-COALESCE(SUM(p.paid),0) FROM orders o LEFT JOIN (SELECT order_id,SUM(amount) paid FROM payments GROUP BY order_id) p ON p.order_id=o.id) outstanding,
      (SELECT COALESCE(SUM(o.total-COALESCE(p.paid,0)),0) FROM orders o JOIN retailers r ON r.id=o.retailer_id LEFT JOIN (SELECT order_id,SUM(amount) paid FROM payments GROUP BY order_id) p ON p.order_id=o.id WHERE o.created_at::date + r.payment_terms_days < CURRENT_DATE AND o.total > COALESCE(p.paid,0)) overdue
  `);
  res.json(rows[0]);
}));

app.get('/api/admin/orders', authRequired('admin'), asyncRoute(async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT o.*, r.shop_name, r.area, sr.name sales_rep_name,
      COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.order_id=o.id),0) paid_amount,
      o.total-COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.order_id=o.id),0) balance
    FROM orders o JOIN retailers r ON r.id=o.retailer_id JOIN sales_reps sr ON sr.id=o.sales_rep_id
    ORDER BY o.created_at DESC LIMIT 500
  `);
  res.json(rows);
}));

app.get('/api/admin/retailers', authRequired('admin'), asyncRoute(async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT r.*, sr.name sales_rep_name,
      COUNT(DISTINCT o.id)::int order_count,
      COALESCE(SUM(o.total),0) lifetime_sales,
      MAX(o.created_at) last_order_at,
      COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.retailer_id=r.id),0) total_paid,
      COALESCE(SUM(o.total),0)-COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.retailer_id=r.id),0) outstanding,
      COALESCE((SELECT SUM(o2.total-COALESCE(pp.paid,0)) FROM orders o2 LEFT JOIN (SELECT order_id,SUM(amount) paid FROM payments GROUP BY order_id) pp ON pp.order_id=o2.id WHERE o2.retailer_id=r.id AND o2.created_at::date + r.payment_terms_days < CURRENT_DATE AND o2.total > COALESCE(pp.paid,0)),0) overdue,
      (SELECT AVG(p.payment_date - o3.created_at::date) FROM payments p JOIN orders o3 ON o3.id=p.order_id WHERE p.retailer_id=r.id) avg_payment_days
    FROM retailers r
    LEFT JOIN sales_reps sr ON sr.id=r.sales_rep_id
    LEFT JOIN orders o ON o.retailer_id=r.id
    GROUP BY r.id, sr.name
    ORDER BY r.created_at DESC
  `);
  res.json(rows.map(r => ({
    ...r,
    lifecycle: new Date(r.created_at) > new Date(Date.now()-30*864e5) ? 'NEW' : (!r.last_order_at || new Date(r.last_order_at) < new Date(Date.now()-30*864e5) ? 'INACTIVE' : 'ACTIVE')
  })));
}));

app.get('/api/admin/payments', authRequired('admin'), asyncRoute(async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT p.*, r.shop_name, o.order_no, sr.name sales_rep_name,
      (p.payment_date - o.created_at::date) payment_days
    FROM payments p
    JOIN retailers r ON r.id=p.retailer_id
    LEFT JOIN orders o ON o.id=p.order_id
    LEFT JOIN sales_reps sr ON sr.id=p.sales_rep_id
    ORDER BY p.payment_date DESC, p.id DESC LIMIT 500
  `);
  res.json(rows);
}));

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err.code === '23505') return res.status(409).json({ error: 'That value already exists' });
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Server error' });
});

module.exports = app;

if (!process.env.VERCEL) {
  dbReady
    .then(() => app.listen(PORT, () => console.log(`Pasalho Sales listening on ${PORT}`)))
    .catch(err => { console.error('Database initialization failed', err); process.exit(1); });
}
