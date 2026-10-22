-- Preserve fulfilled Stage 10 programme work after a legitimate Stage 11 rejection.
-- No updates to decisions, votes, grades, programme status or prior documents.
-- Unapproved drafts and programmes rejected without a verified Stage 11 vote
-- continue to be incomplete. The server's personal document gate stays enabled.
CREATE OR REPLACE FUNCTION private.stage_required_final_documents(p_game uuid, p_stage integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
WITH policy(stage_no,template_key,label,doc_type,subject_key) AS (
 VALUES
 (2,'minutes','Протокол заседания КСРФ','other','ksrf'),
 (3,'minutes','Протокол заседания КСРФ','other','ksrf'),
 (4,'gd_chair_resolution','Постановление об избрании Председателя Государственной Думы','gd_resolution','gd'),
 (4,'gd_deputies_resolution','Постановление об избрании заместителей Председателя ГД','gd_resolution','gd'),
 (4,'gd_committees_resolution','Постановление об избрании председателей пяти комитетов ГД','gd_resolution','gd'),
 (4,'minutes','Протокол заседания Государственной Думы','other','gd'),
 (5,'gd_resolution','Постановление Государственной Думы','gd_resolution','gd'),
 (5,'minutes','Протокол заседания Государственной Думы','other','gd'),
 (6,'sf_resolution','Постановление Совета Федерации о назначении выборов','sf_resolution','sf'),
 (8,'president_decree','Указ Президента Российской Федерации','president_decree','president'),
 (8,'gd_resolution','Постановление Государственной Думы','gd_resolution','gd'),
 (9,'president_decree','Указ Президента о назначении','president_decree','president'),
 (9,'gd_resolution','Постановление Государственной Думы','gd_resolution','gd'),
 (10,'state_program','Государственная программа в реестре','state_program','government'),
 
 (11,'minutes','Протокол заседания Правительства','other','government'),
 (14,'municipal_act','Муниципальный правовой акт','municipal_act','municipality'),
 (15,'crisis_act','Правовой акт о реагировании на кризис','any','any')
), matches AS (
 SELECT x.*,
 EXISTS(
 SELECT 1 FROM public.formal_documents d
 WHERE d.game_id=p_game AND d.stage_no=p_stage
   AND (d.status_code='published' OR
       (p_stage=10 AND x.template_key = 'state_program'
        AND d.status_code IN ('draft','submitted','under_review','review')))
   AND (CASE WHEN x.doc_type='any'
      THEN d.doc_type IN ('president_decree','government_resolution','ministry_order','municipal_act')
      WHEN x.template_key IN ('gd_chair_resolution','gd_deputies_resolution','gd_committees_resolution')
      THEN d.doc_type='gd_resolution' AND d.subject_key='gd'
        AND d.metadata->>'document_kind'='stage4_office_result'
        AND d.metadata->>'source_result_key'=CASE x.template_key
         WHEN 'gd_chair_resolution' THEN 'gd_chair'
         WHEN 'gd_deputies_resolution' THEN 'gd_deputies'
         ELSE 'gd_committees' END
      WHEN x.template_key='minutes'
      THEN ((d.doc_type IN ('meeting_minutes','minutes')
          OR d.metadata->>'template_key'='minutes'
          OR (d.doc_type='other' AND d.title ILIKE 'Протокол заседания%'))
          AND (d.subject_key=x.subject_key OR d.subject_key IS NULL))
      WHEN x.template_key='state_program'
      THEN d.doc_type='state_program' AND d.metadata->>'auto_synced'='true'
       AND EXISTS (
         SELECT 1 FROM public.state_programs p
         WHERE p.game_id=d.game_id
          AND p.id::text=d.metadata->>'state_program_id'
          AND (
           p.status IN ('ready','government_vote','adopted')
           OR (
             p.status='rejected'
             -- A final rejection at Stage 11 cannot erase Stage 10's
             -- already prepared programme. Admission to a programme vote
             -- proves it passed Stage 10 and was presented to Government.
             AND EXISTS (
              SELECT 1
              FROM public.government_program_agenda a
              JOIN public.game_votes v ON v.id=a.vote_id AND v.game_id=a.game_id
              WHERE a.game_id=p.game_id AND a.program_id=p.id
               AND v.stage_no=11 AND v.procedure_key='state_program'
             )
           )
          )
       ) WHEN x.template_key='financial_economic'
      THEN d.metadata->>'template_key'='financial_economic'
      ELSE d.doc_type=x.doc_type AND
        (d.subject_key=x.subject_key OR d.subject_key IS NULL)
   END)
 ) AS fulfilled
 FROM policy x WHERE x.stage_no=p_stage
)
SELECT coalesce(jsonb_agg(jsonb_build_object(
 'template_key',template_key,'title',label,'subject_key',subject_key,'fulfilled',fulfilled,'evidence_state',case when stage_no=10 then 'prepared' else 'published' end)
 ORDER BY template_key),'[]'::jsonb)
FROM matches;
$function$

