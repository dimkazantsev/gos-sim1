'use client';
import {FormEvent,useEffect,useMemo,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {supabase} from '@/lib/supabase';
import type {ActionItem,Activity,Ballot,Channel,Crisis,Evaluation,EventItem,FormalDocument,FormalHistory,Game,GameDocument,GameProfile,ImpactLedger,ImpactRule,Member,Message,Metric,MetricHistory,Party,PartyAgreement,PartyDocument,PartyInvitation,PartyMandateAllocation,PartySupportHistory,PoliticalDecision,PoliticalPost,PoliticalPostFormalLink,PoliticalPostMedia,Presence,Stage,Vote} from './types';
import {CRISES} from './constants';

export function useRepublicGame(gameId:string){
 const router=useRouter();
 const [game,setGame]=useState<Game|null>(null),[me,setMe]=useState<Member|null>(null),[metrics,setMetrics]=useState<Metric[]>([]),[events,setEvents]=useState<EventItem[]>([]),[actions,setActions]=useState<ActionItem[]>([]),[members,setMembers]=useState<Member[]>([]);
 const [channels,setChannels]=useState<Channel[]>([]),[channelId,setChannelId]=useState(''),[messages,setMessages]=useState<Message[]>([]);
 const [stages,setStages]=useState<Stage[]>([]),[parties,setParties]=useState<Party[]>([]),[votes,setVotes]=useState<Vote[]>([]),[ballots,setBallots]=useState<Ballot[]>([]),[evaluations,setEvaluations]=useState<Evaluation[]>([]),[crises,setCrises]=useState<Crisis[]>([]),[documents,setDocuments]=useState<GameDocument[]>([]),[activities,setActivities]=useState<Activity[]>([]),[presence,setPresence]=useState<Presence[]>([]),[profiles,setProfiles]=useState<GameProfile[]>([]),[partyDocuments,setPartyDocuments]=useState<PartyDocument[]>([]),[partyInvitations,setPartyInvitations]=useState<PartyInvitation[]>([]),[partyMandates,setPartyMandateRows]=useState<PartyMandateAllocation[]>([]),[partyAgreements,setPartyAgreements]=useState<PartyAgreement[]>([]),[formalDocuments,setFormalDocuments]=useState<FormalDocument[]>([]),[formalHistory,setFormalHistory]=useState<FormalHistory[]>([]),[politicalPosts,setPoliticalPosts]=useState<PoliticalPost[]>([]),[politicalMedia,setPoliticalMedia]=useState<PoliticalPostMedia[]>([]),[postFormalLinks,setPostFormalLinks]=useState<PoliticalPostFormalLink[]>([]),[politicalDecisions,setPoliticalDecisions]=useState<PoliticalDecision[]>([]),[metricHistory,setMetricHistory]=useState<MetricHistory[]>([]),[partySupportHistory,setPartySupportHistory]=useState<PartySupportHistory[]>([]),[impactRules,setImpactRules]=useState<ImpactRule[]>([]),[impactLedger,setImpactLedger]=useState<ImpactLedger[]>([]);
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[chatOpen,setChatOpen]=useState(false),[secondsLeft,setSecondsLeft]=useState(0);
 const [recording,setRecording]=useState<'audio'|'video'|null>(null),[realtimeState,setRealtimeState]=useState<'connecting'|'connected'|'disconnected'>('connecting');
 const liveRef=useRef<ReturnType<typeof supabase.channel>|null>(null),channelRef=useRef(''),recorder=useRef<MediaRecorder|null>(null),chunks=useRef<Blob[]>([]);

 const teacher=me?.kind==='teacher';
 const names=useMemo(()=>Object.fromEntries(members.map(x=>[x.user_id,x.full_name])),[members]);
 const currentStage=useMemo(()=>stages.find(s=>s.status==='open')||stages.find(s=>s.stage_no===game?.current_round)||stages[0],[stages,game?.current_round]);
 const myEvaluations=useMemo(()=>evaluations.filter(e=>e.user_id===me?.user_id),[evaluations,me?.user_id]);
 const averageVsn=myEvaluations.length?myEvaluations.reduce((a,b)=>a+b.score,0)/myEvaluations.length:0;

 useEffect(()=>{
  void loadAll();
  const live=supabase.channel('republic:'+gameId)
   .on('postgres_changes',{event:'*',schema:'public',table:'games',filter:'id=eq.'+gameId},()=>void loadAll(false))
   .on('postgres_changes',{event:'*',schema:'public',table:'game_members',filter:'game_id=eq.'+gameId},()=>void loadAll(false))
   .on('postgres_changes',{event:'*',schema:'public',table:'state_metrics',filter:'game_id=eq.'+gameId},()=>void loadAll(false))
   .on('postgres_changes',{event:'*',schema:'public',table:'game_stages',filter:'game_id=eq.'+gameId},()=>void loadAll(false))
   .on('postgres_changes',{event:'*',schema:'public',table:'game_parties',filter:'game_id=eq.'+gameId},()=>void loadAll(false))
   .on('postgres_changes',{event:'*',schema:'public',table:'game_votes',filter:'game_id=eq.'+gameId},()=>void loadAll(false))
   .on('postgres_changes',{event:'*',schema:'public',table:'game_ballots'},()=>void loadAll(false))
   .on('postgres_changes',{event:'*',schema:'public',table:'game_evaluations',filter:'game_id=eq.'+gameId},()=>void loadAll(false))
   .on('postgres_changes',{event:'*',schema:'public',table:'game_crises',filter:'game_id=eq.'+gameId},()=>void loadAll(false))
   .on('postgres_changes',{event:'*',schema:'public',table:'game_events',filter:'game_id=eq.'+gameId},()=>void loadAll(false))
   .on('postgres_changes',{event:'*',schema:'public',table:'player_actions',filter:'game_id=eq.'+gameId},()=>void loadAll(false))
   .on('postgres_changes',{event:'*',schema:'public',table:'game_documents',filter:'game_id=eq.'+gameId},()=>void loadAll(false))
   .on('postgres_changes',{event:'*',schema:'public',table:'game_activity',filter:'game_id=eq.'+gameId},()=>void loadClassroomTelemetry())
   .on('postgres_changes',{event:'*',schema:'public',table:'game_presence',filter:'game_id=eq.'+gameId},()=>void loadClassroomTelemetry())
   .on('postgres_changes',{event:'*',schema:'public',table:'game_profiles',filter:'game_id=eq.'+gameId},()=>void loadPartyAssets())
   .on('postgres_changes',{event:'*',schema:'public',table:'party_documents',filter:'game_id=eq.'+gameId},()=>void loadPartyAssets())
   .on('postgres_changes',{event:'*',schema:'public',table:'party_invitations',filter:'game_id=eq.'+gameId},()=>void loadPartyRepresentation())
   .on('postgres_changes',{event:'*',schema:'public',table:'party_member_mandates',filter:'game_id=eq.'+gameId},()=>void loadPartyRepresentation())
   .on('postgres_changes',{event:'*',schema:'public',table:'party_agreements',filter:'game_id=eq.'+gameId},()=>void loadPartyRepresentation())
   .on('postgres_changes',{event:'*',schema:'public',table:'formal_documents',filter:'game_id=eq.'+gameId},()=>void loadFormalRegistry())
   .on('postgres_changes',{event:'*',schema:'public',table:'formal_document_history',filter:'game_id=eq.'+gameId},()=>void loadFormalRegistry())
   .on('postgres_changes',{event:'*',schema:'public',table:'political_posts',filter:'game_id=eq.'+gameId},()=>void loadPoliticalWall())
   .on('postgres_changes',{event:'*',schema:'public',table:'political_post_media',filter:'game_id=eq.'+gameId},()=>void loadPoliticalWall())
   .on('postgres_changes',{event:'*',schema:'public',table:'political_decisions',filter:'game_id=eq.'+gameId},()=>void loadPoliticalWall())
   .on('postgres_changes',{event:'*',schema:'public',table:'state_metric_history',filter:'game_id=eq.'+gameId},()=>void loadPoliticalWall())
   .on('postgres_changes',{event:'*',schema:'public',table:'impact_rules',filter:'game_id=eq.'+gameId},()=>void loadImpactEngine())
   .on('postgres_changes',{event:'*',schema:'public',table:'impact_ledger',filter:'game_id=eq.'+gameId},()=>void loadImpactEngine())
   .on('postgres_changes',{event:'*',schema:'public',table:'chat_channels',filter:'game_id=eq.'+gameId},()=>void loadAll(false))
   .on('postgres_changes',{event:'*',schema:'public',table:'channel_members'},()=>void loadAll(false))
   .on('postgres_changes',{event:'INSERT',schema:'public',table:'chat_messages',filter:'game_id=eq.'+gameId},()=>{if(channelRef.current)void loadMessages(channelRef.current)})
   .subscribe(status=>{setRealtimeState(status==='SUBSCRIBED'?'connected':status==='CLOSED'||status==='CHANNEL_ERROR'?'disconnected':'connecting')});
  liveRef.current=live;
  return()=>{if(liveRef.current)void supabase.removeChannel(liveRef.current)};
 },[gameId]);

 useEffect(()=>{channelRef.current=channelId;setMessages([]);if(channelId)void loadMessages(channelId)},[channelId]);

 useEffect(()=>{
  const tick=()=>{
   if(!game?.turn_ends_at||!game.turn_open){setSecondsLeft(0);return}
   setSecondsLeft(Math.max(0,Math.floor((new Date(game.turn_ends_at).getTime()-Date.now())/1000)));
  };
  tick();const id=setInterval(tick,1000);return()=>clearInterval(id);
 },[game?.turn_ends_at,game?.turn_open]);

 async function loadAll(show=true){
  if(show)setLoading(true);
  const u=(await supabase.auth.getUser()).data.user;
  if(!u){router.replace('/');return}
  const [g,m,mt,ev,ac,mb,ch,st,pa,vo,ba,ge,cr,dc,al,pr,pf,pd,pi,pm,ag,fd,fh,pp,px,pl,pc,mh,psh]=await Promise.all([
   supabase.from('games').select('*').eq('id',gameId).single(),
   supabase.from('game_members').select('*').eq('game_id',gameId).eq('user_id',u.id).single(),
   supabase.from('state_metrics').select('*').eq('game_id',gameId).order('label'),
   supabase.from('game_events').select('*').eq('game_id',gameId).order('published_at',{ascending:false}).limit(100),
   supabase.from('player_actions').select('*').eq('game_id',gameId).order('submitted_at',{ascending:false}),
   supabase.from('game_members').select('*').eq('game_id',gameId).order('full_name'),
   supabase.from('chat_channels').select('*').eq('game_id',gameId).order('name'),
   supabase.from('game_stages').select('*').eq('game_id',gameId).order('stage_no'),
   supabase.from('game_parties').select('*').eq('game_id',gameId).order('support',{ascending:false}),
   supabase.from('game_votes').select('*').eq('game_id',gameId).order('opened_at',{ascending:false}),
   supabase.from('game_ballots').select('*'),
   supabase.from('game_evaluations').select('*').eq('game_id',gameId).order('stage_no'),
   supabase.from('game_crises').select('*').eq('game_id',gameId).order('created_at',{ascending:false}),
   supabase.from('game_documents').select('*').eq('game_id',gameId).order('created_at',{ascending:false}),
   supabase.from('game_activity').select('*').eq('game_id',gameId).order('created_at',{ascending:false}).limit(250),
   supabase.from('game_presence').select('*').eq('game_id',gameId).order('last_seen_at',{ascending:false}),
   supabase.from('game_profiles').select('*').eq('game_id',gameId),
   supabase.from('party_documents').select('*').eq('game_id',gameId).order('created_at',{ascending:false}),
   supabase.from('party_invitations').select('*').eq('game_id',gameId).order('created_at',{ascending:false}),
   supabase.from('party_member_mandates').select('*').eq('game_id',gameId),
   supabase.from('party_agreements').select('*').eq('game_id',gameId).order('created_at',{ascending:false}),
   supabase.from('formal_documents').select('*').eq('game_id',gameId).order('updated_at',{ascending:false}),
   supabase.from('formal_document_history').select('*').eq('game_id',gameId).order('created_at',{ascending:false}),
   supabase.from('political_posts').select('*').eq('game_id',gameId).order('created_at',{ascending:false}).limit(250),
   supabase.from('political_post_media').select('*').eq('game_id',gameId).order('created_at',{ascending:false}),
   supabase.from('political_post_formal_links').select('*').eq('game_id',gameId),
   supabase.from('political_decisions').select('*').eq('game_id',gameId).order('created_at',{ascending:false}),
   supabase.from('state_metric_history').select('*').eq('game_id',gameId).order('recorded_at',{ascending:true}).limit(3000),
   supabase.from('party_support_history').select('*').eq('game_id',gameId).order('recorded_at',{ascending:true}).limit(3000)
  ]);
  if(g.error||m.error){setError(g.error?.message||m.error?.message||'Нет доступа к игре');setLoading(false);return}
  setGame(g.data as Game);setMe(m.data as Member);setMetrics((mt.data||[]) as Metric[]);setEvents((ev.data||[]) as EventItem[]);setActions((ac.data||[]) as ActionItem[]);
  setMembers((mb.data||[]) as Member[]);setChannels((ch.data||[]) as Channel[]);setStages((st.data||[]) as Stage[]);setVotes((vo.data||[]) as Vote[]);
  const voteIds=new Set(((vo.data||[]) as Vote[]).map(v=>v.id));setBallots(((ba.data||[]) as Ballot[]).filter(b=>voteIds.has(b.vote_id)));
  setEvaluations((ge.data||[]) as Evaluation[]);setCrises((cr.data||[]) as Crisis[]);setDocuments((dc.data||[]) as GameDocument[]);setActivities((al.data||[]) as Activity[]);setPresence((pr.data||[]) as Presence[]);
  const rawProfiles=(pf.data||[]) as GameProfile[];
  const rawPartyDocs=(pd.data||[]) as PartyDocument[];
  const profileRows=await Promise.all(rawProfiles.map(async x=>x.avatar_path?{...x,avatar_url:(await supabase.storage.from('game-assets').createSignedUrl(x.avatar_path,3600)).data?.signedUrl||null}:x));
  const partyRows=await Promise.all(((pa.data||[]) as Party[]).map(async x=>x.logo_path?{...x,logo_url:(await supabase.storage.from('game-assets').createSignedUrl(x.logo_path,3600)).data?.signedUrl||null}:x));
  const docRows=await Promise.all(rawPartyDocs.map(async x=>({...x,url:(await supabase.storage.from('game-assets').createSignedUrl(x.storage_path,3600)).data?.signedUrl||null})));
  setProfiles(profileRows);setParties(partyRows);setPartyDocuments(docRows);setPartyInvitations((pi.data||[]) as PartyInvitation[]);setPartyMandateRows((pm.data||[]) as PartyMandateAllocation[]);setPartyAgreements((ag.data||[]) as PartyAgreement[]);
  const formalRows=await Promise.all(((fd.data||[]) as FormalDocument[]).map(async x=>x.source_file_path?{...x,file_url:(await supabase.storage.from('game-assets').createSignedUrl(x.source_file_path,3600)).data?.signedUrl||null}:x));
  setFormalDocuments(formalRows);setFormalHistory((fh.data||[]) as FormalHistory[]);
  const mediaRows=await Promise.all(((px.data||[]) as PoliticalPostMedia[]).map(async x=>({...x,url:(await supabase.storage.from('game-assets').createSignedUrl(x.storage_path,3600)).data?.signedUrl||null})));
  setPoliticalPosts((pp.data||[]) as PoliticalPost[]);setPoliticalMedia(mediaRows);setPostFormalLinks((pl.data||[]) as PoliticalPostFormalLink[]);setPoliticalDecisions((pc.data||[]) as PoliticalDecision[]);setMetricHistory((mh.data||[]) as MetricHistory[]);setPartySupportHistory((psh.data||[]) as PartySupportHistory[]);
  if(!channelRef.current&&ch.data?.[0])setChannelId(ch.data[0].id);
  await loadImpactEngine();
  if(show)setLoading(false);
 }

 async function loadClassroomTelemetry(){
  const [al,pr]=await Promise.all([
   supabase.from('game_activity').select('*').eq('game_id',gameId).order('created_at',{ascending:false}).limit(250),
   supabase.from('game_presence').select('*').eq('game_id',gameId).order('last_seen_at',{ascending:false})
  ]);
  if(!al.error)setActivities((al.data||[]) as Activity[]);
  if(!pr.error)setPresence((pr.data||[]) as Presence[]);
 }

 async function loadPartyAssets(){
  const [pa,pf,pd]=await Promise.all([
   supabase.from('game_parties').select('*').eq('game_id',gameId).order('support',{ascending:false}),
   supabase.from('game_profiles').select('*').eq('game_id',gameId),
   supabase.from('party_documents').select('*').eq('game_id',gameId).order('created_at',{ascending:false})
  ]);
  if(!pa.error){
   const rows=await Promise.all(((pa.data||[]) as Party[]).map(async x=>x.logo_path?{...x,logo_url:(await supabase.storage.from('game-assets').createSignedUrl(x.logo_path,3600)).data?.signedUrl||null}:x));
   setParties(rows);
  }
  if(!pf.error){
   const rows=await Promise.all(((pf.data||[]) as GameProfile[]).map(async x=>x.avatar_path?{...x,avatar_url:(await supabase.storage.from('game-assets').createSignedUrl(x.avatar_path,3600)).data?.signedUrl||null}:x));
   setProfiles(rows);
  }
  if(!pd.error){
   const rows=await Promise.all(((pd.data||[]) as PartyDocument[]).map(async x=>({...x,url:(await supabase.storage.from('game-assets').createSignedUrl(x.storage_path,3600)).data?.signedUrl||null})));
   setPartyDocuments(rows);
  }
 }

 async function loadPartyRepresentation(){
  const [pi,pm,pa,mb,ag]=await Promise.all([
   supabase.from('party_invitations').select('*').eq('game_id',gameId).order('created_at',{ascending:false}),
   supabase.from('party_member_mandates').select('*').eq('game_id',gameId),
   supabase.from('game_parties').select('*').eq('game_id',gameId).order('support',{ascending:false}),
   supabase.from('game_members').select('*').eq('game_id',gameId).order('full_name'),
   supabase.from('party_agreements').select('*').eq('game_id',gameId).order('created_at',{ascending:false})
  ]);
  if(!pi.error)setPartyInvitations((pi.data||[]) as PartyInvitation[]);
  if(!pm.error)setPartyMandateRows((pm.data||[]) as PartyMandateAllocation[]);
  if(!ag.error)setPartyAgreements((ag.data||[]) as PartyAgreement[]);
  if(!mb.error)setMembers((mb.data||[]) as Member[]);
  if(!pa.error){
   const rows=await Promise.all(((pa.data||[]) as Party[]).map(async x=>x.logo_path?{...x,logo_url:(await supabase.storage.from('game-assets').createSignedUrl(x.logo_path,3600)).data?.signedUrl||null}:x));
   setParties(rows);
  }
 }

 async function loadFormalRegistry(){
  const [fd,fh]=await Promise.all([
   supabase.from('formal_documents').select('*').eq('game_id',gameId).order('updated_at',{ascending:false}),
   supabase.from('formal_document_history').select('*').eq('game_id',gameId).order('created_at',{ascending:false})
  ]);
  if(!fd.error){
   const rows=await Promise.all(((fd.data||[]) as FormalDocument[]).map(async x=>x.source_file_path?{...x,file_url:(await supabase.storage.from('game-assets').createSignedUrl(x.source_file_path,3600)).data?.signedUrl||null}:x));
   setFormalDocuments(rows);
  }
  if(!fh.error)setFormalHistory((fh.data||[]) as FormalHistory[]);
 }

 async function loadPoliticalWall(){
  const [pp,px,pl,pc,mh,psh,mt,pa]=await Promise.all([
   supabase.from('political_posts').select('*').eq('game_id',gameId).order('created_at',{ascending:false}).limit(250),
   supabase.from('political_post_media').select('*').eq('game_id',gameId).order('created_at',{ascending:false}),
   supabase.from('political_post_formal_links').select('*').eq('game_id',gameId),
   supabase.from('political_decisions').select('*').eq('game_id',gameId).order('created_at',{ascending:false}),
   supabase.from('state_metric_history').select('*').eq('game_id',gameId).order('recorded_at',{ascending:true}).limit(3000),
   supabase.from('party_support_history').select('*').eq('game_id',gameId).order('recorded_at',{ascending:true}).limit(3000),
   supabase.from('state_metrics').select('*').eq('game_id',gameId).order('sort_order'),
   supabase.from('game_parties').select('*').eq('game_id',gameId).order('support',{ascending:false})
  ]);
  if(!pp.error)setPoliticalPosts((pp.data||[]) as PoliticalPost[]);
  if(!px.error){
   const rows=await Promise.all(((px.data||[]) as PoliticalPostMedia[]).map(async x=>({...x,url:(await supabase.storage.from('game-assets').createSignedUrl(x.storage_path,3600)).data?.signedUrl||null})));
   setPoliticalMedia(rows);
  }
  if(!pl.error)setPostFormalLinks((pl.data||[]) as PoliticalPostFormalLink[]);
  if(!pc.error)setPoliticalDecisions((pc.data||[]) as PoliticalDecision[]);
  if(!mh.error)setMetricHistory((mh.data||[]) as MetricHistory[]);
  if(!psh.error)setPartySupportHistory((psh.data||[]) as PartySupportHistory[]);
  if(!mt.error)setMetrics((mt.data||[]) as Metric[]);
  if(!pa.error){
   const rows=await Promise.all(((pa.data||[]) as Party[]).map(async x=>x.logo_path?{...x,logo_url:(await supabase.storage.from('game-assets').createSignedUrl(x.logo_path,3600)).data?.signedUrl||null}:x));
   setParties(rows);
  }
 }

 async function loadImpactEngine(){
  const [ir,il]=await Promise.all([
   supabase.from('impact_rules').select('*').eq('game_id',gameId).order('priority'),
   supabase.from('impact_ledger').select('*').eq('game_id',gameId).order('created_at',{ascending:false}).limit(500)
  ]);
  if(!ir.error)setImpactRules((ir.data||[]) as ImpactRule[]);
  if(!il.error)setImpactLedger((il.data||[]) as ImpactLedger[]);
 }

 async function loadMessages(cid:string){
  const r=await supabase.from('chat_messages').select('*').eq('channel_id',cid).order('created_at',{ascending:false}).limit(150);
  if(r.error){setError(r.error.message);return}
   const rows=await Promise.all(((r.data||[]) as Message[]).map(async m=>{if(!m.storage_path)return m;const x=await supabase.storage.from('game-media').createSignedUrl(m.storage_path,3600);return {...m,url:x.data?.signedUrl||null}}));
  if(channelRef.current===cid)setMessages(rows.reverse());
 }
 async function refresh(){await loadAll(false);if(channelRef.current)await loadMessages(channelRef.current)}

 async function logActivity(eventType:string,label:string,viewKey?:string,payload:Record<string,unknown>={}){
  const u=(await supabase.auth.getUser()).data.user;if(!u)return;
  await supabase.from('game_activity').insert({game_id:gameId,actor_id:u.id,event_type:eventType,label,view_key:viewKey||null,payload});
 }
 async function touchPresence(viewKey:string,label?:string){
  const u=(await supabase.auth.getUser()).data.user;if(!u)return;
  await supabase.from('game_presence').upsert({game_id:gameId,user_id:u.id,current_view:viewKey,last_seen_at:new Date().toISOString()},{onConflict:'game_id,user_id'});
  if(label)await logActivity('navigation',label,viewKey);
 }

 async function logout(){await supabase.auth.signOut();router.replace('/')}
 async function setTurn(open:boolean){const r=await supabase.from('games').update({turn_open:open,status:open?'running':'paused',turn_ends_at:open?new Date(Date.now()+12*60*1000).toISOString():null}).eq('id',gameId);if(r.error)setError(r.error.message);else await refresh()}
 async function setTurnMinutes(minutes:number){if(!game)return;const r=await supabase.from('games').update({turn_open:true,status:'running',turn_ends_at:new Date(Date.now()+minutes*60*1000).toISOString()}).eq('id',gameId);if(r.error)setError(r.error.message);else await refresh()}

 async function openStage(stageNo:number){
  if(!teacher)return;
  const r=await supabase.rpc('set_game_stage',{p_game_id:gameId,p_stage_no:stageNo,p_minutes:12});
  if(r.error)setError(r.error.message);else await refresh();
 }
 async function nextStage(){await openStage(Math.min(16,(currentStage?.stage_no||1)+1))}
 async function setStageDeadline(stageId:string,value:string){const r=await supabase.from('game_stages').update({deadline:value?new Date(value).toISOString():null}).eq('id',stageId);if(r.error)setError(r.error.message);else await refresh()}

 async function submitAction(e:FormEvent,data:{type:string;title:string;body:string;budget:number}){
  e.preventDefault();if(!me||!game)return false;
  const r=await supabase.from('player_actions').insert({game_id:gameId,round_no:currentStage?.stage_no||game.current_round,author_id:me.user_id,action_type:data.type,title:data.title,body:data.body,budget:data.budget,status:'submitted'});
  if(r.error){setError(r.error.message);return false}await refresh();return true;
 }
 async function judgeAction(id:string,status:'accepted'|'rejected'){const r=await supabase.from('player_actions').update({status,reviewed_by:me?.user_id,reviewed_at:new Date().toISOString()}).eq('id',id);if(r.error)setError(r.error.message);else await refresh()}

 function availableActors(){
  if(!me)return [];
  const role=(me.role_title||'').toLowerCase();
  const x:{key:string;label:string}[]=[{key:'participant',label:me.full_name}];
  if(me.team)x.push({key:'party',label:me.team});
  if(teacher||role.includes('президент'))x.push({key:'president',label:'Президент Российской Федерации'});
  if(teacher||role.includes('правительств')||role.includes('министр'))x.push({key:'government',label:'Правительство Российской Федерации'});
  if(teacher||role.includes('депутат')||role.includes('государственн')&&role.includes('дум'))x.push({key:'gd',label:'Государственная Дума'});
  if(teacher||role.includes('совет федерац')||role.includes('сенатор'))x.push({key:'sf',label:'Совет Федерации'});
  if(teacher||role.includes('министр'))x.push({key:'ministry',label:me.role_title||'Федеральный орган исполнительной власти'});
  if(teacher||role.includes('муницип')||role.includes('глава города'))x.push({key:'municipality',label:'Орган местного самоуправления'});
  if(teacher||role.includes('сми')||role.includes('журналист'))x.push({key:'media',label:'Средства массовой информации'});
  if(teacher)x.push({key:'teacher',label:'Руководитель симуляции'});
  return x;
 }
 async function createPoliticalPost(data:{processType:string;actorKey:string;actorLabel:string;title:string;body:string;tags:string[];externalUrl?:string;internalView?:string;internalRefId?:string;formalIds?:string[]},files:File[]=[]){
  if(!me||!data.title.trim()||!data.body.trim())return null;
  const r=await supabase.rpc('create_political_post',{
   p_game_id:gameId,p_process_type:data.processType,p_actor_key:data.actorKey,p_title:data.title.trim(),p_body:data.body.trim(),
   p_tags:data.tags,p_external_url:data.externalUrl?.trim()||null,p_internal_view:data.internalView||null,p_internal_ref_id:data.internalRefId||null
  });
  if(r.error){setError(r.error.message);return null}
  const postId=r.data as string;
  if(data.formalIds?.length){
   const links=data.formalIds.map(id=>({game_id:gameId,post_id:postId,formal_document_id:id,created_by:me.user_id}));
   const lr=await supabase.from('political_post_formal_links').insert(links);if(lr.error)setError(lr.error.message);
  }
  for(const file of files){
   const ext=(file.name.split('.').pop()||'bin').toLowerCase();
   const path=gameId+'/wall/'+postId+'/'+crypto.randomUUID()+'.'+ext;
   const up=await supabase.storage.from('game-assets').upload(path,file,{contentType:file.type||'application/octet-stream'});
   if(up.error){setError(up.error.message);continue}
   const kind:'image'|'audio'|'video'|'file'=file.type.startsWith('image/')?'image':file.type.startsWith('audio/')?'audio':file.type.startsWith('video/')?'video':'file';
   const mr=await supabase.from('political_post_media').insert({game_id:gameId,post_id:postId,uploader_id:me.user_id,media_kind:kind,storage_path:path,file_name:file.name,mime_type:file.type||null,file_size:file.size});
   if(mr.error)setError(mr.error.message);
  }
  await logActivity('political_post','Опубликовал политический процесс «'+data.title.trim()+'»','dashboard',{post_id:postId});
  await loadPoliticalWall();return postId;
 }
 async function addMediaToPoliticalPost(postId:string,files:File[]){
  if(!me||!files.length)return false;
  for(const file of files){
   const ext=(file.name.split('.').pop()||'bin').toLowerCase();
   const path=gameId+'/wall/'+postId+'/'+crypto.randomUUID()+'.'+ext;
   const up=await supabase.storage.from('game-assets').upload(path,file,{contentType:file.type||'application/octet-stream'});
   if(up.error){setError(up.error.message);return false}
   const kind:'image'|'audio'|'video'|'file'=file.type.startsWith('image/')?'image':file.type.startsWith('audio/')?'audio':file.type.startsWith('video/')?'video':'file';
   const mr=await supabase.from('political_post_media').insert({
    game_id:gameId,post_id:postId,uploader_id:me.user_id,media_kind:kind,
    storage_path:path,file_name:file.name,mime_type:file.type||null,file_size:file.size
   });
   if(mr.error){setError(mr.error.message);return false}
  }
  await loadPoliticalWall();return true;
 }
 async function acceptPoliticalPost(postId:string,impactPlan?:Record<string,unknown>){
  const r=await supabase.rpc('accept_political_post',{p_post_id:postId,p_impact_plan:impactPlan||null});
  if(r.error){setError(r.error.message);return false}await loadPoliticalWall();return true;
 }
 async function rejectPoliticalPost(postId:string){
  const r=await supabase.rpc('reject_political_post',{p_post_id:postId});
  if(r.error){setError(r.error.message);return false}await loadPoliticalWall();return true;
 }
 async function approvePostImpact(postId:string,impactPlan:Record<string,unknown>){
  const r=await supabase.rpc('approve_post_impact',{p_post_id:postId,p_impact_plan:impactPlan});
  if(r.error){setError(r.error.message);return false}await loadPoliticalWall();return true;
 }
 async function createVoteFromPost(postId:string,institutionKey='all',mode:'member'|'faction'|'mandate'='member'){
  const r=await supabase.rpc('create_vote_from_post',{p_post_id:postId,p_institution_key:institutionKey,p_voting_mode:mode,p_quorum_value:2/3,p_majority_kind:'present_majority',p_majority_value:0.5});
  if(r.error){setError(r.error.message);return null}await refresh();return r.data as string;
 }
 async function updateMetric(id:string,value:number,note?:string){
  if(!teacher)return;const r=await supabase.rpc('set_state_metric',{p_metric_id:id,p_value:value,p_note:note||null});
  if(r.error)setError(r.error.message);else await loadPoliticalWall();
 }
 async function updateImpactRule(ruleId:string,enabled:boolean,autoApply:boolean,effects:Record<string,unknown>,description?:string){
  const r=await supabase.rpc('update_impact_rule',{p_rule_id:ruleId,p_enabled:enabled,p_auto_apply:autoApply,p_effects:effects,p_description:description||null});
  if(r.error){setError(r.error.message);return false}await loadImpactEngine();return true;
 }
 async function revertImpactEntry(id:number){
  const r=await supabase.rpc('revert_impact_entry',{p_ledger_id:id});
  if(r.error){setError(r.error.message);return false}await Promise.all([loadImpactEngine(),loadPoliticalWall()]);return true;
 }
 async function createParty(name:string,ideology:string){
  if(!teacher||!me||!name.trim())return false;const n=name.trim();const colors=['#6f7cff','#4dc9ff','#55d99b','#ff8d72','#c77dff'];
  const p=await supabase.from('game_parties').insert({game_id:gameId,name:n,ideology:ideology.trim()||null,color:colors[parties.length%colors.length]});
  if(p.error){setError(p.error.message);return false}
  const c=await supabase.from('chat_channels').insert({game_id:gameId,name:'Фракция · '+n,kind:'team',created_by:me.user_id});if(c.error)setError(c.error.message);
  await refresh();return true;
 }
 async function updateParty(id:string,patch:Partial<Party>){const r=await supabase.from('game_parties').update(patch).eq('id',id);if(r.error)setError(r.error.message);else await refresh()}
 async function setPartyLeader(partyId:string,userId:string){
  const r=await supabase.rpc('set_party_leader',{p_party_id:partyId,p_user_id:userId});
  if(r.error){setError(r.error.message);return false}
  await loadPartyRepresentation();return true;
 }
 async function setPartyMandates(partyId:string,mandates:number){
  const r=await supabase.rpc('set_party_mandates',{p_party_id:partyId,p_mandates:mandates});
  if(r.error){setError(r.error.message);return false}
  await loadPartyRepresentation();return true;
 }
 async function inviteToParty(partyId:string,userId:string){
  const r=await supabase.rpc('invite_to_party',{p_party_id:partyId,p_user_id:userId});
  if(r.error){setError(r.error.message);return false}
  await loadPartyRepresentation();return true;
 }
 async function respondPartyInvitation(invitationId:string,accept:boolean){
  const r=await supabase.rpc('respond_party_invitation',{p_invitation_id:invitationId,p_accept:accept});
  if(r.error){setError(r.error.message);return false}
  await loadPartyRepresentation();return true;
 }
 async function cancelPartyInvitation(invitationId:string){
  const r=await supabase.rpc('cancel_party_invitation',{p_invitation_id:invitationId});
  if(r.error){setError(r.error.message);return false}
  await loadPartyRepresentation();return true;
 }
 async function removePartyMember(partyId:string,userId:string){
  const r=await supabase.rpc('remove_party_member',{p_party_id:partyId,p_user_id:userId});
  if(r.error){setError(r.error.message);return false}
  await loadPartyRepresentation();return true;
 }
 async function proposePartyAgreement(data:{counterpartyPartyId:string;title:string;terms:string;targetVoteId?:string|null;proposerChoice?:'yes'|'no'|null;counterpartyChoice?:'yes'|'no'|null}){
  const r=await supabase.rpc('propose_party_agreement',{
   p_game_id:gameId,p_counterparty_party_id:data.counterpartyPartyId,p_title:data.title,p_terms:data.terms,
   p_target_vote_id:data.targetVoteId||null,p_proposer_choice:data.proposerChoice||null,p_counterparty_choice:data.counterpartyChoice||null
  });
  if(r.error){setError(r.error.message);return false}
  await loadPartyRepresentation();return true;
 }
 async function respondPartyAgreement(agreementId:string,accept:boolean){
  const r=await supabase.rpc('respond_party_agreement',{p_agreement_id:agreementId,p_accept:accept});
  if(r.error){setError(r.error.message);return false}
  await loadPartyRepresentation();return true;
 }
 async function submitPartyRegistration(partyId:string){
  const r=await supabase.rpc('submit_party_registration',{p_party_id:partyId});
  if(r.error){setError(r.error.message);return false}
  await refresh();return true;
 }
 async function reviewPartyRegistration(partyId:string,status:'registered'|'revision'|'rejected',note?:string){
  const r=await supabase.rpc('review_party_registration',{p_party_id:partyId,p_status:status,p_note:note||null});
  if(r.error){setError(r.error.message);return false}
  await refresh();return true;
 }
 async function applyPartyGhostLoss(partyId:string,loss:number){
  const r=await supabase.rpc('apply_party_ghost_loss',{p_party_id:partyId,p_loss:loss});
  if(r.error){setError(r.error.message);return false}
  await refresh();return true;
 }
 async function drawGhostVoting(totalLoss?:number){
  const r=await supabase.rpc('draw_ghost_voting',{p_game_id:gameId,p_total_loss:totalLoss??null});
  if(r.error){setError(r.error.message);return null}
  await refresh();
  return r.data as {round_id:string;total_loss:number;result:{party_id:string;party_name:string;loss:number}[]};
 }
 async function clearPartyGhostLoss(partyId?:string){
  const r=await supabase.rpc('clear_party_ghost_loss',{p_game_id:gameId,p_party_id:partyId||null});
  if(r.error){setError(r.error.message);return false}
  await refresh();return true;
 }
 async function updateMember(userId:string,patch:Partial<Pick<Member,'role_title'|'score'>>){const r=await supabase.from('game_members').update(patch).eq('game_id',gameId).eq('user_id',userId);if(r.error)setError(r.error.message);else await refresh()}

 async function createVote(data:{
  title:string;body:string;mode:'member'|'faction'|'mandate';
  institutionKey?:string;procedureKey?:string;quorumKind?:'none'|'fraction';quorumValue?:number;
  majorityKind?:'yes_no_simple'|'present_majority'|'eligible_majority'|'eligible_fraction';majorityValue?:number;
  allowAbstain?:boolean;tieBreakerChair?:boolean;formalDocumentId?:string|null;
  passTransition?:string;failTransition?:string;
 }){
  if(!me||!data.title.trim())return false;
  const r=await supabase.rpc('create_procedural_vote',{
   p_game_id:gameId,
   p_title:data.title.trim(),
   p_body:data.body.trim()||null,
   p_voting_mode:data.mode,
   p_institution_key:data.institutionKey||'all',
   p_procedure_key:data.procedureKey||'generic',
   p_quorum_kind:data.quorumKind||'fraction',
   p_quorum_value:data.quorumValue??0.6666667,
   p_majority_kind:data.majorityKind||'yes_no_simple',
   p_majority_value:data.majorityValue??0.5,
   p_allow_abstain:data.allowAbstain??true,
   p_tie_breaker_chair:data.tieBreakerChair??false,
   p_formal_document_id:data.formalDocumentId||null,
   p_pass_transition:data.passTransition||'none',
   p_fail_transition:data.failTransition||'none'
  });
  if(r.error){setError(r.error.message);return false}await refresh();return true;
 }
 function partyForUser(uid:string){const m=members.find(x=>x.user_id===uid);return parties.find(p=>p.name===m?.team)}
 function memberMatchesInstitution(uid:string,institution:string){
  const m=members.find(x=>x.user_id===uid);if(!m||m.kind==='observer')return false;
  const role=(m.role_title||'').toLowerCase();
  if(institution==='all'||institution==='factions')return m.kind==='student';
  if(institution==='gd')return role.includes('депутат')||(role.includes('государственн')&&role.includes('дум'));
  if(institution==='government')return role.includes('правительств')||role.includes('министр');
  if(institution==='sf')return role.includes('совет федерац')||role.includes('сенатор');
  if(institution==='committee')return role.includes('комитет')||role.includes('депутат');
  if(institution==='municipality')return role.includes('муницип')||role.includes('администрац')||role.includes('глава города');
  return false;
 }
 function canVote(v:Vote){
  if(!me)return false;
  if(v.voting_mode==='member')return memberMatchesInstitution(me.user_id,v.institution_key||'all');
  const p=partyForUser(me.user_id);if(!p)return false;
  if(v.voting_mode==='faction')return p.leader_user_id===me.user_id;
  return (partyMandates.find(x=>x.user_id===me.user_id&&x.party_id===p.id)?.effective_mandates||0)>0;
 }
 function ballotWeight(v:Vote){
  if(v.voting_mode==='member')return canVote(v)?1:0;
  const p=partyForUser(me?.user_id||'');if(!p)return 0;
  if(v.voting_mode==='faction')return p.leader_user_id===me?.user_id?1:0;
  return partyMandates.find(x=>x.user_id===me?.user_id&&x.party_id===p.id)?.effective_mandates||0;
 }
 function eligibleWeight(v:Vote){
  if(v.voting_mode==='faction')return parties.filter(p=>p.leader_user_id).length;
  if(v.voting_mode==='mandate')return parties.reduce((a,p)=>a+Math.max(0,Number(p.mandates)||0),0);
  return members.filter(m=>memberMatchesInstitution(m.user_id,v.institution_key||'all')).length;
 }
 function quorum(v:Vote){
  const eligible=eligibleWeight(v);
  const x=ballots.filter(b=>b.vote_id===v.id);
  const cast=v.voting_mode==='member'?x.length:x.reduce((a,b)=>a+Number(b.weight),0);
  const quorumValue=Number(v.quorum_value||0);
  const needed=v.quorum_kind==='none'?0:v.institution_key==='gd'&&quorumValue===0.5?Math.floor(eligible/2)+1:Math.ceil(eligible*quorumValue);
  return {eligible,cast,needed,met:v.quorum_kind==='none'||(eligible>0&&cast>=needed)};
 }
 function tally(v:Vote){
  const x=ballots.filter(b=>b.vote_id===v.id);
  const yes=x.filter(b=>b.choice==='yes').reduce((a,b)=>a+Number(b.weight),0);
  const no=x.filter(b=>b.choice==='no').reduce((a,b)=>a+Number(b.weight),0);
  const abstain=x.filter(b=>b.choice==='abstain').reduce((a,b)=>a+Number(b.weight),0);
  return {yes,no,abstain,total:yes+no+abstain};
 }
 async function castVote(v:Vote,choice:'yes'|'no'|'abstain'){
  if(!me||!canVote(v))return;
  const r=await supabase.rpc('cast_procedural_vote',{p_vote_id:v.id,p_choice:choice});
  if(r.error)setError(r.error.message);else await refresh();
 }
 async function closeVote(id:string,note?:string){
  const r=await supabase.rpc('close_procedural_vote',{p_vote_id:id,p_note:note||null});
  if(r.error){setError(r.error.message);return null}
  await refresh();return r.data;
 }

 async function setEvaluation(userId:string,score:number,note?:string){
  if(!teacher||!me||!currentStage)return;const old=evaluations.find(e=>e.user_id===userId&&e.stage_no===currentStage.stage_no);
  const payload={score,note:note||old?.note||null,evaluator_id:me.user_id,updated_at:new Date().toISOString()};
  const r=old?await supabase.from('game_evaluations').update(payload).eq('id',old.id):await supabase.from('game_evaluations').insert({game_id:gameId,stage_no:currentStage.stage_no,user_id:userId,...payload});
  if(r.error){setError(r.error.message);return}
  await refresh();
 }

 async function publishEvent(title:string,body:string,severity='notice',category='Режиссёрская'){if(!me||!title.trim()||!body.trim())return false;const r=await supabase.from('game_events').insert({game_id:gameId,round_no:currentStage?.stage_no||1,category,severity,title:title.trim(),body:body.trim(),created_by:me.user_id});if(r.error){setError(r.error.message);return false}await refresh();return true}
 async function triggerCrisis(){
  if(!teacher||!me)return;
  const c=CRISES[Math.floor(Math.random()*CRISES.length)];
  const keys=['low','medium','high','ultra'] as const;
  const intensity=keys[Math.floor(Math.random()*keys.length)];
  const description=c.levels[intensity];
  const r=await supabase.rpc('launch_crisis',{p_game_id:gameId,p_crisis_type:c.type,p_intensity:intensity,p_description:description,p_response_minutes:20});
  if(r.error)setError(r.error.message);else await refresh();
 }
 async function ghostVoting(){
  if(!teacher||!me||!parties.length){setError('Сначала создайте партии.');return}
  const eligible=parties.filter(p=>p.mandates>0);if(!eligible.length){setError('Сначала распределите мандаты между партиями.');return}
  return await drawGhostVoting();
 }

 async function createDocument(data:{title:string;type:string;body:string}){if(!teacher||!me||!data.title.trim())return false;const r=await supabase.from('game_documents').insert({game_id:gameId,title:data.title.trim(),doc_type:data.type.trim()||'Документ',body:data.body.trim()||null,created_by:me.user_id});if(r.error){setError(r.error.message);return false}await refresh();return true}


 async function saveProfile(bio:string,file?:File){
  if(!me)return false;
  let avatarPath=profiles.find(x=>x.user_id===me.user_id)?.avatar_path||null;
  if(file){
    const ext=(file.name.split('.').pop()||'jpg').toLowerCase();
    const path=gameId+'/profiles/'+me.user_id+'/avatar-'+Date.now()+'.'+ext;
    const up=await supabase.storage.from('game-assets').upload(path,file,{upsert:true,contentType:file.type});
    if(up.error){setError(up.error.message);return false}
    avatarPath=path;
  }
  const r=await supabase.from('game_profiles').upsert({game_id:gameId,user_id:me.user_id,bio:bio.trim()||null,avatar_path:avatarPath,updated_at:new Date().toISOString()},{onConflict:'game_id,user_id'});
  if(r.error){setError(r.error.message);return false}
  await loadPartyAssets();return true;
 }
 async function savePartyIdentity(partyId:string,description:string,file?:File){
  let logoPath=parties.find(x=>x.id===partyId)?.logo_path||null;
  if(file){
    const ext=(file.name.split('.').pop()||'png').toLowerCase();
    const path=gameId+'/parties/'+partyId+'/logo-'+Date.now()+'.'+ext;
    const up=await supabase.storage.from('game-assets').upload(path,file,{upsert:true,contentType:file.type});
    if(up.error){setError(up.error.message);return false}
    logoPath=path;
  }
  const r=await supabase.rpc('update_my_party_identity',{p_party_id:partyId,p_description:description.trim()||null,p_logo_path:logoPath});
  if(r.error){setError(r.error.message);return false}
  await loadPartyAssets();return true;
 }
 async function uploadPartyDocument(partyId:string,kind:PartyDocument['doc_kind'],title:string,file:File){
  if(!me)return false;
  const ext=(file.name.split('.').pop()||'bin').toLowerCase();
  const path=gameId+'/parties/'+partyId+'/docs/'+crypto.randomUUID()+'.'+ext;
  const up=await supabase.storage.from('game-assets').upload(path,file,{contentType:file.type});
  if(up.error){setError(up.error.message);return false}
  const r=await supabase.from('party_documents').insert({game_id:gameId,party_id:partyId,doc_kind:kind,title:title.trim()||file.name,storage_path:path,file_name:file.name,mime_type:file.type||null,file_size:file.size,uploaded_by:me.user_id,status:'submitted'});
  if(r.error){setError(r.error.message);return false}
  await loadPartyAssets();return true;
 }
 async function reviewPartyDocument(id:string,status:'accepted'|'revision',note?:string){
  if(!teacher)return;
  const r=await supabase.from('party_documents').update({status,note:note?.trim()||null}).eq('id',id);
  if(r.error)setError(r.error.message);else await loadPartyAssets();
 }

 async function createFormalDocument(data:{stageNo:number;title:string;docType:string;subjectKey:string;subjectLabel:string;bodyText:string;workflowKey:string;metadata?:Record<string,unknown>},file?:File){
  if(!me)return null;
  let filePath:string|null=null;
  if(file){
   const ext=(file.name.split('.').pop()||'bin').toLowerCase();
   filePath=gameId+'/formal/'+me.user_id+'/'+crypto.randomUUID()+'.'+ext;
   const up=await supabase.storage.from('game-assets').upload(filePath,file,{contentType:file.type||'application/octet-stream'});
   if(up.error){setError(up.error.message);return null}
  }
  const r=await supabase.rpc('create_formal_document',{
   p_game_id:gameId,p_stage_no:data.stageNo,p_title:data.title,p_doc_type:data.docType,
   p_subject_key:data.subjectKey,p_subject_label:data.subjectLabel,p_body_text:data.bodyText||'',
   p_file_path:filePath,p_file_name:file?.name||null,p_mime:file?.type||null,p_workflow_key:data.workflowKey,
   p_metadata:data.metadata||{}
  });
  if(r.error){setError(r.error.message);return null}
  await loadFormalRegistry();return r.data as string;
 }
 async function advanceFormalDocument(id:string,action:'advance'|'return'|'reject'='advance',note?:string){
  const r=await supabase.rpc('advance_formal_document',{p_document_id:id,p_action:action,p_note:note||null});
  if(r.error){setError(r.error.message);return false}
  await loadFormalRegistry();return true;
 }
 async function updateFormalDraft(id:string,title:string,bodyText:string,metadata?:Record<string,unknown>){
  const r=await supabase.rpc('update_formal_draft',{p_document_id:id,p_title:title,p_body_text:bodyText,p_metadata:metadata||null});
  if(r.error){setError(r.error.message);return false}
  await loadFormalRegistry();return true;
 }
 async function vetoFormalDocument(id:string,note?:string){
  const r=await supabase.rpc('veto_formal_document',{p_document_id:id,p_note:note||null});
  if(r.error){setError(r.error.message);return false}
  await loadFormalRegistry();return true;
 }
 async function resolveBudgetConciliation(id:string,action:'agreed'|'government_revision',note?:string){
  const r=await supabase.rpc('resolve_budget_conciliation',{p_document_id:id,p_action:action,p_note:note||null});
  if(r.error){setError(r.error.message);return false}
  await loadFormalRegistry();return true;
 }
 async function startBudgetRejectionBranch(id:string,action:'conciliation'|'government_revision',note?:string){
  const r=await supabase.rpc('start_budget_rejection_branch',{p_document_id:id,p_action:action,p_note:note||null});
  if(r.error){setError(r.error.message);return false}
  await loadFormalRegistry();return true;
 }

 async function sendText(text:string){if(!me||!channelId||!text.trim())return false;const r=await supabase.from('chat_messages').insert({game_id:gameId,channel_id:channelId,author_id:me.user_id,kind:'text',text:text.trim()});if(r.error){setError(r.error.message);return false}await loadMessages(channelId);return true}
 async function sendChatFile(file:File){
  if(!me||!channelId)return false;
  const ext=(file.name.split('.').pop()||'bin').toLowerCase();
  const path=gameId+'/'+channelId+'/'+me.user_id+'/'+crypto.randomUUID()+'.'+ext;
  const up=await supabase.storage.from('game-media').upload(path,file,{contentType:file.type||'application/octet-stream'});
  if(up.error){setError(up.error.message);return false}
  const r=await supabase.from('chat_messages').insert({game_id:gameId,channel_id:channelId,author_id:me.user_id,kind:'file',text:file.name,storage_path:path,mime_type:file.type||null});
  if(r.error){setError(r.error.message);return false}
  await loadMessages(channelId);return true;
 }
 async function toggleRecording(kind:'audio'|'video'){
  if(recorder.current?.state==='recording'){recorder.current.stop();return}
  if(!me||!channelId)return;
  try{
   const stream=await navigator.mediaDevices.getUserMedia(kind==='audio'?{audio:true}:{audio:true,video:{facingMode:'user'}});chunks.current=[];const rec=new MediaRecorder(stream);recorder.current=rec;setRecording(kind);
   rec.ondataavailable=e=>e.data.size&&chunks.current.push(e.data);
   rec.onstop=async()=>{const mime=rec.mimeType||'video/webm',blob=new Blob(chunks.current,{type:mime}),path=gameId+'/'+channelId+'/'+me.user_id+'/'+crypto.randomUUID()+'.webm';const up=await supabase.storage.from('game-media').upload(path,blob,{contentType:mime});if(up.error)setError(up.error.message);else await supabase.from('chat_messages').insert({game_id:gameId,channel_id:channelId,author_id:me.user_id,kind,storage_path:path,mime_type:mime});stream.getTracks().forEach(t=>t.stop());recorder.current=null;setRecording(null);await loadMessages(channelId)};
   rec.start();
  }catch(e){setError(e instanceof Error?e.message:'Нет доступа к микрофону/камере')}
 }

 return {game,me,metrics,events,actions,members,channels,channelId,setChannelId,messages,stages,parties,votes,ballots,evaluations,crises,documents,activities,presence,profiles,partyDocuments,partyInvitations,partyMandates,partyAgreements,politicalPosts,politicalMedia,postFormalLinks,politicalDecisions,metricHistory,partySupportHistory,impactRules,impactLedger,formalDocuments,formalHistory,loading,error,setError,chatOpen,setChatOpen,recording,secondsLeft,realtimeState,teacher,names,currentStage,myEvaluations,averageVsn,
  logout,touchPresence,logActivity,setTurn,setTurnMinutes,openStage,nextStage,setStageDeadline,submitAction,judgeAction,availableActors,createPoliticalPost,addMediaToPoliticalPost,acceptPoliticalPost,rejectPoliticalPost,approvePostImpact,createVoteFromPost,updateImpactRule,revertImpactEntry,createParty,updateParty,setPartyLeader,setPartyMandates,inviteToParty,respondPartyInvitation,cancelPartyInvitation,removePartyMember,proposePartyAgreement,respondPartyAgreement,submitPartyRegistration,reviewPartyRegistration,applyPartyGhostLoss,drawGhostVoting,clearPartyGhostLoss,updateMember,createVote,canVote,castVote,closeVote,tally,quorum,setEvaluation,publishEvent,triggerCrisis,ghostVoting,createDocument,updateMetric,saveProfile,savePartyIdentity,uploadPartyDocument,reviewPartyDocument,createFormalDocument,advanceFormalDocument,updateFormalDraft,vetoFormalDocument,resolveBudgetConciliation,startBudgetRejectionBranch,sendText,sendChatFile,toggleRecording};
}
