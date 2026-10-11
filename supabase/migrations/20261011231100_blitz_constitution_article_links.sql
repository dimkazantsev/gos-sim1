-- Link each Constitution card to the cited article rather than the whole law.
update public.blitz_questions set source_url='https://www.zakonrf.info/konstitucia/'||substring(article from '([0-9]+)$')||'/' where legal_act='Конституция Российской Федерации' and article ~ '^статья [0-9]+$';
