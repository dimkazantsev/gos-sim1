-- Security hardening for immutable formal workflow helper.
alter function private.formal_workflow(text) set search_path = '';
