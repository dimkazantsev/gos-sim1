import type {FormalDocument} from './types';

// Match bootstrap v3's lightweight document projection without transferring
// full texts and metadata on background Realtime reconciliation.
// Column access continues through the existing formal_documents table RLS.
export const FORMAL_DOCUMENT_SUMMARY_COLUMNS=[
 'id','game_id','stage_no','registry_no','title','doc_type',
 'subject_key','subject_label','author_id','source_file_path',
 'source_file_name','source_mime_type','workflow_key','workflow_steps',
 'current_step','status_code','status_label','current_owner_key',
 'created_at','updated_at'
].join(',');

export type FormalDocumentSummary=Omit<FormalDocument,'body_text'|'metadata'|'file_url'>;

// Preserve already-authorized, unchanged full content only in this user's
// session. Changed versions lose old text/metadata; removed rows disappear.
export function mergeFormalDocumentSummaries(
 previous:readonly FormalDocument[],
 summaries:readonly FormalDocumentSummary[]
):FormalDocument[]{
 const cached=new Map(previous.map(row=>[row.id,row]));
 return summaries.map(row=>{
  const old=cached.get(row.id);
  const unchanged=old?.updated_at===row.updated_at;
  return {
   ...row,
   body_text:unchanged?old.body_text??null:null,
   metadata:unchanged?old.metadata??{}:{},
   file_url:old?.source_file_path===row.source_file_path?old.file_url||null:null
  };
 });
}
