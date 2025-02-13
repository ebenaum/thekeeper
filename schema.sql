PRAGMA foreign_keys = ON;

CREATE TABLE actors (
    id INTEGER PRIMARY KEY
);

INSERT INTO actors (id) VALUES (0);

CREATE TABLE public_keys (
    id INTEGER PRIMARY KEY,
    public_key BLOB NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS unique_public_keys_public_key ON public_keys (public_key);

CREATE TABLE actors_public_keys (
    actor_id INTEGER,
    public_key_id INTEGER,

    FOREIGN KEY(actor_id) REFERENCES actors(id),
    FOREIGN KEY(public_key_id) REFERENCES public_keys(id),
    CHECK (actor_id != 0)
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  source_actor_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  data BLOB,
  status INTEGER NOT NULL, -- 0 pending, 1 accepted, 2 rejected, 3 stuttering

  FOREIGN KEY source_actor_id REFERENCES actors(id)
);
