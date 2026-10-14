const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
function read(file){return fs.readFileSync(path.join(root,file),'utf8')}
const source=read('components/game/achievementPreview.ts');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const compiledExports={};new Function('exports',code)(compiledExports);
const {publicAchievementPreview}=compiledExports;
const catalog=Array.from({length:100},(_,i)=>({
 id:'award-'+i,title:'Достижение '+i,description:'Заслужить '+i,
 hidden:i>=60,earned_at:i%3===0?'2026-10-13T02:00:00Z':null,progress:i%2?90:100
}));
const result=publicAchievementPreview(catalog);
assert.equal(result.length,60,'Exactly 60 public awards may be previewed; secret entries are excluded even when earned');
assert(result.every(row=>row.earned_at===null&&row.progress===0&&row.hidden===false),'Generic preview shows neither actual teacher progress nor earned status');
assert(!result.some(row=>row.id==='award-99'),'A teacher-earned secret must never leak into the student preview');
assert.equal(catalog[0].earned_at,'2026-10-13T02:00:00Z','Real award records are not modified');
const game=read('components/GameClient.tsx'),profile=read('components/game/ProfileView.tsx'),shelf=read('components/game/Achievements.tsx');
assert(game.includes("const GENERIC_STUDENT='__generic_student_preview__'"),'Generic student retains its internal non-UUID sentinel');
assert(game.includes('previewAchievementsUserId={teacher&&viewAs===GENERIC_STUDENT?me?.user_id:undefined}'),'Only generic teacher preview replaces sentinel with authenticated teacher UUID');
assert(profile.includes('userId={previewAchievementsUserId||target.user_id}')&&profile.includes('previewOnly={!!previewAchievementsUserId}'),'Only generic preview uses proxy catalog, ordinary students use real user IDs');
assert(profile.includes('!previewAchievementsUserId&&<BlitzArchive'),'Generic preview cannot send fake UUID to blitz RPC');
assert(profile.includes('if(!game||!target||previewAchievementsUserId)return;'),'Generic preview cannot send fake UUID to public stats RPC');
assert(shelf.includes("supabase.rpc('get_game_achievements'")&&shelf.includes('publicAchievementPreview((r.data||[]) as Achievement[])'),'Catalog fetched with existing authorized RPC and cleansed locally');
assert(shelf.includes('Демонстрационный профиль:')&&shelf.includes("previewOnly?publicAchievementPreview"),'UI explains that progress is demonstration-only');
assert(profile.includes('previewOnly={!!previewAchievementsUserId} defaultCollapsed/>'),'Every student profile starts with achievements collapsed, including generic preview');
assert(shelf.includes('const [expanded,setExpanded]=useState(!defaultCollapsed)'),'Collapsed default state is controlled by an opt-in prop');
assert(shelf.includes('useEffect(()=>setExpanded(!defaultCollapsed),[gameId,userId,defaultCollapsed])'),'Switching student profiles restores default collapsed state');
assert(shelf.includes('aria-expanded={expanded}')&&shelf.includes('aria-controls={contentId}')&&shelf.includes('hidden={!expanded}'),'The catalog has an accessible toggle and hidden content while collapsed');
assert(shelf.includes('showCatalog&&expanded')&&shelf.includes('setFilter(\'earned\')'),'Expanded mode retains the existing earned and available filters');
assert(shelf.includes('className="awardCollectionSummary"'),'Progress and total earned remain visible while the catalog is collapsed');
console.log('PASS: student catalog collapsed by default; accessible expansion preserves counters, filters and protected previews');
