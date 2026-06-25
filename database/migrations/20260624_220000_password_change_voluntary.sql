ALTER TABLE auth.users
  ALTER COLUMN must_change_password SET DEFAULT false;

UPDATE auth.users
SET must_change_password = false
WHERE must_change_password = true;
