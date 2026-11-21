-- Rules such as "visit date can't be in the future" use current_date. In UTC that is
-- still yesterday in Butuan until 8 a.m., so the app's Manila date would be rejected.
-- Takes effect on new connections; Supabase's API reconnects within minutes.
alter database postgres set timezone to 'Asia/Manila';
