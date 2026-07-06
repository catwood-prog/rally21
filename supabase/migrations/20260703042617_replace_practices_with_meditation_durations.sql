-- Swap the 3 hardcoded practices for meditation-duration options. Updating
-- the existing rows in place (not delete+insert) so any circles already
-- created against these practice_ids keep working — the app fetches
-- practices dynamically by key, nothing hardcoded client-side to update.
update public.practices set key = 'meditation-5', name = '5 Min Meditation', description = 'A short, steady sit — five minutes, once a day.' where key = 'dry-january';
update public.practices set key = 'meditation-10', name = '10 Min Meditation', description = 'Ten quiet minutes to reset, once a day.' where key = 'couch-to-5k';
update public.practices set key = 'meditation-15', name = '15 Min Meditation', description = 'Fifteen minutes, once a day — room to actually settle in.' where key = 'morning-sit';
