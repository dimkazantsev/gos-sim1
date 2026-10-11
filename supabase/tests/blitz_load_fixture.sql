
-- Isolated CI-only PostgreSQL schema, never run against the live Supabase project.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
CREATE TABLE public.games (id uuid PRIMARY KEY);
CREATE TABLE public.game_members (game_id uuid NOT NULL, user_id uuid NOT NULL, kind text NOT NULL);
CREATE TABLE public.blitz_questions (
 id bigint PRIMARY KEY, question text NOT NULL, topic text NOT NULL, options jsonb NOT NULL,
 correct_index integer NOT NULL, legal_act text NOT NULL, article text NOT NULL,
 source_url text NOT NULL, explanation text NOT NULL
);
CREATE TABLE public.blitz_assignments (
 id uuid PRIMARY KEY, game_id uuid NOT NULL, user_id uuid NOT NULL,
 question_id bigint NOT NULL REFERENCES public.blitz_questions(id),
 started_at timestamptz, answered_at timestamptz, available_at timestamptz NOT NULL,
 chosen_index integer, is_correct boolean, stage_no integer NOT NULL
);
INSERT INTO public.games VALUES (md5('game')::uuid);
INSERT INTO public.game_members
 SELECT md5('game')::uuid,md5('student-'||i)::uuid,'student' FROM generate_series(1,30) i;
INSERT INTO public.blitz_questions VALUES
 (1,'Проверка полномочий','Конституция','["Да","Нет"]'::jsonb,0,'Конституция РФ','ст. 1','https://pravo.gov.ru','Тестовый вопрос для проверки конкурентного исполнения'),
 (2,'Дополнительная карточка №1','Конституция','["Да","Нет"]'::jsonb,0,'Конституция РФ','ст. 1','https://pravo.gov.ru','Проверка конкурентного открытия одного задания'),
 (3,'Дополнительная карточка №2','Конституция','["Да","Нет"]'::jsonb,0,'Конституция РФ','ст. 1','https://pravo.gov.ru','Проверка отсутствия второго одновременно открытого задания');
INSERT INTO public.blitz_assignments(id,game_id,user_id,question_id,stage_no,available_at)
 SELECT md5('assignment-'||i)::uuid,md5('game')::uuid,md5('student-'||i)::uuid,1,1,clock_timestamp()-interval '5 minutes'
 FROM generate_series(1,30) i;
INSERT INTO public.blitz_assignments(id,game_id,user_id,question_id,stage_no,available_at)
 VALUES
 (md5('extra-1')::uuid,md5('game')::uuid,md5('student-1')::uuid,2,1,clock_timestamp()-interval '2 minutes'),
 (md5('extra-2')::uuid,md5('game')::uuid,md5('student-1')::uuid,3,1,clock_timestamp()-interval '1 minutes');
CREATE INDEX ON public.blitz_assignments(game_id,user_id,answered_at,available_at);
