PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS auth_keys (
    key VARCHAR PRIMARY KEY,
    actor_id INTEGER, 
    redeemed_at INTEGER,

    FOREIGN KEY(actor_id) REFERENCES actors(id),
    CHECK (actor_id != 0)
);

CREATE TABLE IF NOT EXISTS actors (
    id INTEGER PRIMARY KEY,
    space TEXT CHECK( space IN ('orga','player') ) NOT NULL DEFAULT 'player'
);

INSERT OR IGNORE INTO actors (id) VALUES (0);

CREATE TABLE IF NOT EXISTS public_keys (
    id INTEGER PRIMARY KEY,
    public_key BLOB NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS unique_public_keys_public_key ON public_keys (public_key);

CREATE TABLE IF NOT EXISTS actors_public_keys (
    actor_id INTEGER,
    public_key_id INTEGER,

    FOREIGN KEY(actor_id) REFERENCES actors(id),
    FOREIGN KEY(public_key_id) REFERENCES public_keys(id),
    CHECK (actor_id != 0)
);

CREATE TABLE IF NOT EXISTS events (
  ts INTEGER PRIMARY KEY,
  source_actor_id INTEGER NOT NULL,
  data BLOB,
  status INTEGER CHECK( status IN (1, 2, 4, 8) ) NOT NULL, -- 1 pending, 2 accepted, 4 rejected, 8 stuttering

  FOREIGN KEY(source_actor_id) REFERENCES actors(id)
) WITHOUT ROWID;
