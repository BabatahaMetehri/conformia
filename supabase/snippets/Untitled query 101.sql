select id, email, email_confirmed_at, banned_until from auth.users;
select id, email, is_active from profiles;
-- select * from auth_attempts order by created_at desc limit 20;