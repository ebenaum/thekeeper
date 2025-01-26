CREATE TABLE states (
    id INTEGER PRIMARY KEY
);

CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    public_key BLOB NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS unique_users_public_key ON users (public_key);

CREATE TABLE users_states (
    user_id INTEGER,
    state_id INTEGER,

    FOREIGN KEY(user_id) REFERENCES states(id),
    FOREIGN KEY(state_id) REFERENCES users(id)
);

CREATE TABLE events (
  ts INTEGER NOT NULL,
  state_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  data BLOB,
  status INTEGER NOT NULL, -- 0 pending, 1 accepted, 2 rejected, 3 stuttering

  FOREIGN KEY(state_id) REFERENCES states(id)
);

CREATE INDEX IF NOT EXISTS events_state_id ON events (state_id);
