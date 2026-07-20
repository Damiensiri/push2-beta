ALTER TABLE paddock_requests ADD COLUMN is_free INTEGER NOT NULL DEFAULT 0 CHECK(is_free IN (0,1));

