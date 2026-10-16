CREATE TABLE account_duplicate_evidence (
  account_id INTEGER NOT NULL,
  other_account_id INTEGER NOT NULL,
  PRIMARY KEY (account_id, other_account_id)
);
