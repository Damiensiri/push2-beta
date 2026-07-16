CREATE TABLE IF NOT EXISTS catalog_products (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK(category IN ('services','soins','laverie')),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
  image_url TEXT NOT NULL DEFAULT '',
  badge TEXT NOT NULL DEFAULT '',
  featured INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_catalog_category_position ON catalog_products(category,active,position);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('services','soins','laverie','panier')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','validated','refused','ready','completed','cancelled')),
  comment TEXT NOT NULL DEFAULT '',
  total_cents INTEGER NOT NULL CHECK(total_cents >= 0),
  billed INTEGER NOT NULL DEFAULT 0,
  billed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status,created_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id TEXT NOT NULL,
  name TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents >= 0),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 99),
  line_total_cents INTEGER NOT NULL CHECK(line_total_cents >= 0),
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id,id);

INSERT OR REPLACE INTO catalog_products VALUES
('ser01','services','Longe Mardi','Mardi\nSéance de longe le mardi disponible à l''unité ou en forfait de 10',1700,'https://res.cloudinary.com/dnjz3iqmi/image/upload/v1773347347/locomotion-en-cercle_x08cwb.png','',0,1,5,datetime('now')),
('ser02','services','Longe Jeudi','Jeudi\nSéance de longe le jeudi, disponible à l''unité ou en forfait de 10',1700,'https://res.cloudinary.com/dnjz3iqmi/image/upload/v1773347347/locomotion-en-cercle_x08cwb.png','',0,1,6,datetime('now')),
('ser03','services','Longe Vendredi','Vendredi\nSéance de longe le vendredi, disponible à l''unité ou en forfait de 10',1700,'https://res.cloudinary.com/dnjz3iqmi/image/upload/v1773347347/locomotion-en-cercle_x08cwb.png','',0,1,7,datetime('now')),
('s01','soins','Tonte simple','Corps avec chaussettes et demi-tête',4500,'https://res.cloudinary.com/dnjz3iqmi/image/upload/v1773347792/tonte-chevaux-1.png_jsoart.webp','Populaire',0,1,2,datetime('now')),
('s02','soins','Tonte simple +','Corps avec chaussettes + tête complète',5500,'https://res.cloudinary.com/dnjz3iqmi/image/upload/v1773347792/tonte-chevaux-1.png_jsoart.webp','Classique',1,1,1,datetime('now')),
('s03','soins','Tonte complète','Corps, tête et membres',6500,'https://res.cloudinary.com/dnjz3iqmi/image/upload/v1773347792/tonte-chevaux-1.png_jsoart.webp','Le top',0,1,3,datetime('now')),
('la01','laverie','Tapis de selle','Nettoyage tapis de selle',300,'https://res.cloudinary.com/dnjz3iqmi/image/upload/v1773349123/ff7f34_1992d8eb7cd74c308aab4e4e47507319_mv2.webp_smidk6.avif','',1,1,1,datetime('now')),
('la02','laverie','Couverture 1/2 saison','Nettoyage couverture',600,'https://res.cloudinary.com/dnjz3iqmi/image/upload/v1773349123/ff7f34_b71eebeaeb424be9bd57db427b187371_mv2.webp_qcyh7j.avif','',0,1,2,datetime('now')),
('la03','laverie','Couverture d''hiver','Nettoyage couverture',1100,'https://res.cloudinary.com/dnjz3iqmi/image/upload/v1773349123/ff7f34_0b824c39ade64e33ae6238dbd640a880_mv2.jpg_fnuqzp.avif','',0,1,3,datetime('now')),
('la04','laverie','Bandes de repos et cotons','4 cotons et 4 bandes',500,'https://res.cloudinary.com/dnjz3iqmi/image/upload/v1773349123/ff7f34_775cc0e998344355936f590097923db4_mv2.jpg_ifhuol.avif','',0,1,4,datetime('now'));
