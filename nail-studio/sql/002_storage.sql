-- Run once in Supabase SQL Editor. Public READ for portfolio; server-only WRITE.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('works','works',true,2000000,ARRAY['image/jpeg']) ON CONFLICT(id) DO NOTHING;
-- Do not grant INSERT/UPDATE/DELETE policies to anon/authenticated.
