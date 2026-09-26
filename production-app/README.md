# GOS//SIM production client

## Setup

1. Create a Supabase project.
2. Enable **Anonymous Sign-Ins** in Auth settings (or replace with your preferred auth flow).
3. Run `../supabase/schema.sql` in the SQL editor.
4. As the game owner/teacher, create a game row and teacher membership, then create student/teacher invite codes through `create_invite(...)`.
5. Copy `.env.example` to `.env.local` and fill Supabase URL + anon key.
6. `npm install`
7. `npm run dev`

## Important

The SQL schema intentionally protects teacher-only writes with RLS. The frontend never uses a service-role key. Do not put the Supabase service-role key in `NEXT_PUBLIC_*` variables.
