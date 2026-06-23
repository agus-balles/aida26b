ALTER TABLE courts
  ADD CONSTRAINT courts_company_sport_fkey
  FOREIGN KEY (company_id, sport_id)
  REFERENCES company_sports(company_id, sport_id)
  ON DELETE RESTRICT;

ALTER TABLE courts
  ADD CONSTRAINT courts_id_sport_id_unique UNIQUE (id, sport_id);

ALTER TABLE court_prices
  ADD CONSTRAINT court_prices_court_sport_fkey
  FOREIGN KEY (court_id, sport_id)
  REFERENCES courts(id, sport_id)
  ON DELETE CASCADE;
