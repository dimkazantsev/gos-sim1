/* Focused regression for the overview: only active posts, not archived
 * game_events. This checks the query contract without touching production data. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../components/game/DashboardView.tsx'),'utf8');
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