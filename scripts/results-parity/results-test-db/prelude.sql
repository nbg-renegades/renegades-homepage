-- What hosted Supabase provides and the results migrations expect: the three API roles and the
-- supabase_realtime publication. Plain Postgres has neither, so the test database creates them.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create publication supabase_realtime;
