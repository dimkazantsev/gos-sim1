import type {GameProfile,Party} from './types';

// Keep the entire authority/score/mandate/registration state in every view.
// The only omitted fields are long editable descriptions and review notes.
export const PARTY_LIST_COLUMNS='id,game_id,created_by,name,support,mandates,regions,budget,leader_user_id,color,logo_path,ghost_loss_current,ghost_active,ghost_started_at,representation_penalty,regional_seat_penalty,ghost_risk_weight,presidential_rating_modifier,registration_status,registration_submitted_at,registration_reviewed_at,registration_reviewed_by,mandate_allocation_mode,regional_seats_awarded,created_at,rating' as const;

// Avatar/signature metadata is needed on the party screen, but a participant
// biography is required only on their profile. Full profiles remain RLS-scoped.
export const PROFILE_ASSET_COLUMNS='game_id,user_id,avatar_path,signature_path,updated_at,gender,onboarding_completed_at,intro_seen_at' as const;

export type PartyListRow=Omit<Party,'description'|'ideology'|'registration_note'|'logo_url'>;
export type ProfileAssetRow=Omit<GameProfile,'bio'|'avatar_url'|'signature_url'>;

export function asPartyListRow(row:PartyListRow):Party{
 return {...row,description:null,ideology:null,registration_note:null};
}

// No party revision timestamp exists; never reuse potentially stale text from
// an older full record after an authoritative lightweight reconciliation.
export function normalizePartyRows(
 rows:readonly PartyListRow[]|readonly Party[],full:boolean
):Party[]{
 return full?(rows as Party[]).map(row=>({...row})):
  (rows as PartyListRow[]).map(asPartyListRow);
}

export function mergeProfileAssetRows(
 previous:readonly GameProfile[],rows:readonly ProfileAssetRow[]
):GameProfile[]{
 const cached=new Map(previous.map(row=>[row.user_id,row]));
 return rows.map(row=>{
  const prior=cached.get(row.user_id);
  return {
   ...row,
   bio:prior&&prior.updated_at===row.updated_at?prior.bio??null:null,
   avatar_url:prior?.avatar_path===row.avatar_path?prior.avatar_url||null:null,
   signature_url:prior?.signature_path===row.signature_path?prior.signature_url||null:null
  };
 });
}
