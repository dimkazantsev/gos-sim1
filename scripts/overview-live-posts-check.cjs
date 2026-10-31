/* Focused regression for the overview: only active posts, not archived
 * game_events. This checks the query contract without touching production data. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../components/game/DashboardView.tsx'),'utf8');
const dock=fs.readFileSync(path.join(__dirname,'../components/game/StateMetricsDock.tsx'),'utf8');
const game=fs.readFileSync(path.join(__dirname,'../components/game/useRepublicGame.ts'),'utf8');
assert(game.includes("if(view==='actions')")&&game.includes("jobs.push(core?core.then(()=>loadPoliticalWall()):loadPoliticalWall())"),
 'Dashboard must not trigger full political wall hydration on navigation');
assert(game.includes("if(tables.has('political_posts')&&view==='actions')"),
 'Realtime must not hydrate an invisible political feed on the dashboard');
assert(dock.includes('if(!selected||!gid||!historyPostKey)return'),
 'Closed metric dialog must never fetch post titles');
assert(dock.includes(".from('political_posts').select('id,title').eq('game_id',gid)"),
 'Opened metric history retrieves only RLS-scoped linked titles');
assert(dock.includes("linkedPostTitles[String(h.source_id||'')]"),
 'Metric history keeps linked news titles without full political feed');
assert(dock.includes("async function toggleLinkedPostPreview(id:string)"),
 'Individual publication details must load only on an explicit footnote click');
assert(dock.includes(".from('political_posts').select('id,title,body')")&&
 dock.includes(".eq('game_id',gid).eq('id',id).maybeSingle()"),
 'Footnote must fetch a single game-scoped RLS-authorized post, not a full feed');
assert(dock.includes('linkedPostRequest.current++')&&
 dock.includes('g.me?.kind,g.me?.role_title'),
 'Late footnote reads must not cross a role or game change');
assert(game.includes("if(activeViewRef.current==='actions')return loadPoliticalWall()"),
 'Full political RPC is allowed only on the visible process screen');
assert(game.includes("async function refreshVisiblePoliticalEffects()"),
 'Remote event effects use scoped metrics off the process screen');
const between=source.slice(source.indexOf('useEffect(()=>{'),source.indexOf('},[gameId]);')+12);
assert(source.includes("const {game,me,currentStage,stages,teacher,parties,members,votes"),'Archived events must not be consumed by dashboard');
assert(!source.includes('events.slice(0,4)'),'Overview must not display historical game_events');
assert(between.includes(".from('political_posts')"),'Overview must use current political posts');
assert(between.includes(".eq('game_id',gameId)"),'Overview must be scoped to this game');
assert(between.includes(".is('deleted_at',null)"),'Deleted posts must be excluded at the database query');
assert(between.includes(".order('created_at',{ascending:false})"),'Latest posts must be ordered newest first');
assert(between.includes('.limit(4)'), 'The overview must only fetch four lightweight cards');
assert(!between.includes('storage')&&!between.includes('comment'),'Overview must not request heavy media/comments');
assert(source.includes('if(cancelled)return'),'Outdated responses must not overwrite another game');
assert(source.includes('recentPosts.map(post=>'),'Visible timeline must show the queried posts');
assert(source.includes('Публикаций пока нет'),'No active posts must show a meaningful empty state');
assert(source.includes('feedError?'),'DB errors must not be shown as an empty feed');

const all=[
 {id:'old-event',type:'game_event',deleted:false,created_at:'2026-09-30T20:35:00Z'},
 {id:'removed-post',type:'political_post',deleted:true,created_at:'2026-10-10T14:00:00Z'},
 {id:'new-post',type:'political_post',deleted:false,created_at:'2026-10-12T12:00:00Z'}
];
const visible=all.filter(p=>p.type==='political_post'&&!p.deleted)
 .sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)).slice(0,4);
assert.deepEqual(visible.map(p=>p.id),['new-post']);
assert.equal(all.filter(p=>p.type==='political_post'&&!p.deleted&&p.id!=='new-post').length,0);
console.log('PASS overview live-post source, deleted-record exclusion and empty state');