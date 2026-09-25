-- Optional link to this account's profile page, for platforms the app
-- can't build a link for from the username alone (see
-- src/main/platformLinks.js, which covers the common ones). Empty string
-- means "none" -- same free-text-with-empty-default convention as the
-- other text columns here. Only https:// links are ever stored (enforced
-- in platformAccount.js), since this gets handed to the OS to open.
ALTER TABLE platform_accounts ADD COLUMN profile_url TEXT NOT NULL DEFAULT '';
