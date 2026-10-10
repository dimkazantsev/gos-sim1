"""Regenerate SQL migrations from authored JSON. Run before deploying."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
a = json.loads((root/"content/events-v3-authority.json").read_text())
b = json.loads((root/"content/events-legal-2026.json").read_text())
assert len(a)==50 and len(b)==150
cases=a+b
assert len({c["case_key"] for c in cases})==200
for c in cases:
    assert len(c["situation"].split())>200, c["case_key"]
    assert 4<=len(c["decision_options"])<=6
    assert len(c["decision_options"])==len(c["effect_plan"]["options"])
for j in range(0,150,25):
    batch=b[j:j+25]
    payload=json.dumps(batch,ensure_ascii=False,separators=(",",":"))
    where=",".join("'"+c["case_key"]+"'" for c in batch)
    sql=(
        "-- Preserve assigned or completed events and their original answers.\n"
        "WITH docs AS (SELECT value AS doc FROM jsonb_array_elements($authored$"+payload+"$authored$::jsonb))\n"
        "INSERT INTO private.authored_event_catalog(case_key,content)\n"
        "SELECT doc->>'case_key',doc FROM docs ON CONFLICT(case_key) DO UPDATE SET content=excluded.content;\n"
        "UPDATE public.event_cases e SET situation=c.content->>'situation',"
        "decision_options=c.content->'decision_options',effect_plan=c.content->'effect_plan',"
        "allowed_roles=ARRAY(SELECT jsonb_array_elements_text(c.content->'allowed_roles'))\n"
        "FROM private.authored_event_catalog c WHERE e.case_key=c.case_key AND e.case_key IN ("+where+")\n"
        "AND NOT EXISTS(SELECT 1 FROM public.event_assignments a WHERE a.case_id=e.id)\n"
        "AND NOT EXISTS(SELECT 1 FROM public.event_decisions d WHERE d.case_id=e.id)\n"
        "AND NOT EXISTS(SELECT 1 FROM public.event_case_outcomes o WHERE o.case_id=e.id);\n"
    )
    out=root/"supabase/migrations"/f"2026101014{j//25:02d}00_legal_event_competency_{j//25+1}.sql"
    out.write_text(sql,encoding="utf-8")
    print(out.relative_to(root),len(batch),"cases")
print("PASS: 200 cases checked")
