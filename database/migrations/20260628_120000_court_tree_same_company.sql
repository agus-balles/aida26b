-- Harden the multi-tenant invariant at the database layer: every court's
-- parent and root must belong to the SAME company as the court itself.
--
-- The partition service (reservations.ts) already builds the tree within one
-- company, and the cross-tenant write guard in companyAccess.ts blocks moving a
-- court to another company through the generic CRUD. This migration adds the
-- final defence-in-depth layer so no future code path (or manual query) can
-- cross-link the court tree across companies, which would otherwise leak one
-- company's courts/availability into another's.
--
-- Implemented as composite foreign keys (no trigger): a secondary UNIQUE (id,
-- company_id) lets parent_court_id/root_court_id reference (id, company_id).
-- Self/NULL references are exempt under MATCH SIMPLE, so root courts
-- (parent_court_id IS NULL, root_court_id = id) are unaffected, while any child
-- whose company diverges from its parent/root is rejected.

ALTER TABLE courts
  ADD CONSTRAINT courts_id_company_key UNIQUE (id, company_id);

ALTER TABLE courts
  ADD CONSTRAINT courts_parent_same_company
  FOREIGN KEY (parent_court_id, company_id)
  REFERENCES courts (id, company_id)
  ON DELETE CASCADE;

ALTER TABLE courts
  ADD CONSTRAINT courts_root_same_company
  FOREIGN KEY (root_court_id, company_id)
  REFERENCES courts (id, company_id)
  ON DELETE CASCADE;
