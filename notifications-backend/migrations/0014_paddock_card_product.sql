CREATE TABLE IF NOT EXISTS paddock_card_product (
  id INTEGER PRIMARY KEY CHECK(id=1), name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL CHECK(price_cents >= 0), units INTEGER NOT NULL CHECK(units BETWEEN 1 AND 999),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO paddock_card_product(id,name,description,price_cents,units,active,updated_at)
VALUES(1,'Carte paddock','Votre carte paddock est activée. Elle comprend 10 mises.',4000,10,1,datetime('now'));
