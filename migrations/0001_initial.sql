-- A revision and nonce make each D1 batch an optimistic, atomic transaction.
CREATE TABLE portal_revision (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL, token TEXT NOT NULL);
INSERT INTO portal_revision VALUES (1, 0, 'initial');
CREATE TABLE portal_records (namespace TEXT NOT NULL, id TEXT NOT NULL, position INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (namespace, id));
CREATE INDEX portal_records_order ON portal_records(namespace, position);
