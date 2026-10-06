import fs from 'node:fs';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import {execFileSync} from 'node:child_process';

const read=p=>fs.readFileSync(p,'utf8');
const styles=['design-tokens','design-shell','design-views','design-responsive','design-readability','2026-stage-system'];
const css=Object.fromEntries(styles.map(name=>[name,read(`app/${name}.css`)]));
let count=0;
function check(label,test){assert.ok(test,label);console.log(`PASS ${label}`);count++;}
const tokens=Object.fromEntries([...css['design-tokens'].matchAll(/(--gs-[\w-]+):([^;{}]+)/g)].map(m=>[m[1],m[2].trim()]));
function luminance(hex){const rgb=hex.replace('#','');const full=rgb.length===3?[...rgb].map(c=>c+c).join(''):rgb;const channels=[0,2,4].map(i=>{const c=parseInt(full.slice(i,i+2),16)/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4});return .2126*channels[0]+.7152*channels[1]+.0722*channels[2];}
function contrast(fg,bg){const a=luminance(fg),b=luminance(bg);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);}
const pairs=[['Основной текст',tokens['--gs-ink'],'#ffffff'],['Вторичный текст',tokens['--gs-muted'],'#ffffff'],['Подписи на фоне',tokens['--gs-muted'],tokens['--gs-bg']],['Основная кнопка','#ffffff',tokens['--gs-accent']],['Розовые подписи',tokens['--gs-pink-ink'],tokens['--gs-pink-soft']],['Успешный статус',tokens['--gs-green'],tokens['--gs-green-soft']],['Пауза',tokens['--gs-amber'],tokens['--gs-amber-soft']],['Ошибка',tokens['--gs-red'],tokens['--gs-red-soft']],['Текст текущего этапа','#e3eaff',tokens['--gs-accent']]];
for(const [name,fg,bg] of pairs){const ratio=contrast(fg,bg);check(`${name}: ${ratio.toFixed(2)}:1 (AA ≥ 4.5:1)`,ratio>=4.5);}
for(const [name,source] of Object.entries(css)){
 const root=postcss.parse(source,{from:`app/${name}.css`});
 check(`${name}: CSS parsed`,root.nodes.length>0);
 const undersized=[];root.walkDecls('font-size',d=>{if(/^\d+(\.\d+)?px$/.test(d.value)&&parseFloat(d.value)>0&&parseFloat(d.value)<12)undersized.push(d.toString())});
 check(`${name}: no text size below 12px`,undersized.length===0);
 const unknown=[];root.walkDecls(d=>{for(const match of d.value.matchAll(/var\((--gs-[\w-]+)/g))if(!(match[1] in tokens))unknown.push(match[1])});
 check(`${name}: all design tokens resolve`,unknown.length===0);
}
for(const name of ['globals','landing','sim-shell','sim-panels','public-screen','stage-map','teacher-command','teacher-operations','teacher-ui-polish','teacher-extended','teacher-master-detail','teacher-final-interactions','2026-interface-repair']){const root=postcss.parse(read(`app/${name}.css`),{from:`app/${name}.css`});check(`${name}: inherited CSS parsed`,root.nodes.length>0);}
const teacherSource=read('components/game/TeacherView.tsx');
const stageManager=read('components/game/TeacherStageManager.tsx');
const teacherCss=read('app/teacher-command.css');
const operationsCss=read('app/teacher-operations.css');
const activityJournal=read('components/game/ClassroomJournal.tsx');
const analyticsSource=read('components/game/ParticipantsAnalytics.tsx');
const gradesSource=read('components/game/GradesView.tsx');
const profileSource=read('components/game/ProfileView.tsx');
const layoutSource=read('app/layout.tsx');
const previewSourceTeacher=read('scripts/design-preview.cjs');
const previewUsesLayout=previewSourceTeacher.includes("readFileSync(path.join(root,'app/layout.tsx')")&&previewSourceTeacher.includes('matchAll(/import');
check('Operations stylesheet loaded after teacher command styles in production and preview',
 layoutSource.indexOf("import './teacher-operations.css';")>layoutSource.indexOf("import './teacher-command.css';")&&
 layoutSource.indexOf("import './teacher-final-interactions.css';")>layoutSource.indexOf("import './teacher-master-detail.css';")&&previewUsesLayout);
check('Ten upper navigation workspaces include Event, stages, journal, analytics and grades',
 teacherSource.includes('const WORKSPACES=[')&&
 ["overview","stages","journal","analytics","grades","impact","parties","tools","event","awards"].every(k=>teacherSource.includes("key:'"+k+"'"))&&
 teacherSource.includes('className="teacherWorkspaceNav"')&&
 teacherSource.includes("event.key==='ArrowRight'"));
check('Teacher stage matrix integrates readiness and safe reset actions',
 teacherSource.includes('<TeacherStageManager')&&
 stageManager.includes("supabase.rpc('get_game_readiness'")&&
 stageManager.includes("'teacherStageListItem '+")&&
 stageManager.includes('className="teacherStageInspectorReset"')&&
 stageManager.includes('className="teacherResetAll"')&&
 stageManager.includes("confirmation.trim()==='СБРОСИТЬ'")&&
 stageManager.includes('role="alertdialog"'));
check('Participant dashboard uses authoritative stage assessments and sortable measures',
 teacherSource.includes('<ParticipantsAnalytics')&&
 analyticsSource.includes("from('stage_assessments')")&&
 analyticsSource.includes("sort==='surname'")&&
 analyticsSource.includes("sort==='average'")&&
 analyticsSource.includes('className="participantsTable"'));
check('Assessment journal adds aggregate columns and teacher sorting',
 gradesSource.includes('className="gradesToolbar"')&&
 gradesSource.includes("gradeSort==='sum'")&&
 gradesSource.includes("gradeSort==='surname'")&&
 gradesSource.includes('className="gradeTotal"')&&
 gradesSource.includes('gradesRulesCompact'));
check('Shared classroom journal honors privacy and profile-specific access',
 teacherSource.includes("<ClassroomJournal g={g}/>")&&
 profileSource.includes("showMyJournal&&<ClassroomJournal g={g}/>")&&
 activityJournal.includes('teacher||a.actor_id===me?.user_id')&&
 read('supabase/migrations/20260929152000_student_activity_journal.sql').includes("game_activity_student_own_read"));
check('Teacher stage details remain linked to the source game routes',
 read('components/GameClient.tsx').includes("onOpenStages={stageNo=>navigate('stages',{stageNo})}")&&
 teacherCss.includes('.teacherCommand .teacherStageGrid')&&
 operationsCss.includes('.teacherCommand .teacherReadinessStatus'));
check('Static preview renders stage, analytics, grade and journal teacher workspaces',
 ['teacher-stages','teacher-journal','teacher-analytics','teacher-grades','teacher-event','teacher-parties','teacher-tools'].every(v=>previewSourceTeacher.includes("'"+v+"'")));
check('New director mechanics and scoped editor styles exist',
 teacherSource.includes("<TeacherPartyDossiers g={g} onOpenChat={onOpenChat}/>")&&
 teacherSource.includes("<TeacherGhostVotingPanel g={g}/>")&&
 teacherSource.includes("workspace==='event'&&<EventWorkspace")&&
 read('components/game/TeacherStageManager.tsx').includes("<StagePolicyEditor")&&
 read('components/game/EventWorkspace.tsx').includes("submit_event_decision")&&
 read('components/game/useRepublicGame.ts').includes("apply_ghost_voting_batch")&&
 read('app/teacher-extended.css').includes(".eventWorkspace"));
const stagesView=read('components/game/StagesView.tsx');
const stageSheet=read('app/stage-map.css');
const previewSource=read('scripts/design-preview.cjs');
check('Last-loaded stage stylesheet is included in offline browser preview',
 previewUsesLayout&&layoutSource.indexOf("import './stage-map.css';")>layoutSource.indexOf("import './mobile-nav-polish.css';")&&
 read('app/layout.tsx').includes("import './stage-map.css'"));
check('Atlas has search, status filters and selectable game phases',
 stagesView.includes('className="stageAtlasSearch"')&&
 stagesView.includes('className="stageAtlasFilters"')&&
 stagesView.includes('className="stageAtlasPhaseList"')&&
 stagesView.includes("setPhaseFilter(isSelected?null:p.id)"));
check('Reset controls are teacher-only, guarded, and backed by the RPC',
 stagesView.includes('teacher&&!readOnly&&<button type="button" className="stageAtlasResetStage"')&&
 stagesView.includes('className="stageAtlasResetAll"')&&
 stagesView.includes("setResetTarget(target)")&&
 stagesView.includes("resetConfirmation.trim()==='СБРОСИТЬ'")&&
 stagesView.includes('role="alertdialog"')&&
 read('components/game/useRepublicGame.ts').includes("supabase.rpc('reset_game_stage_progress'"));
check('New stage cards render a unique status, detail button and optional vote button',
 stagesView.includes('className="stageAtlasCardFooter"')&&
 stagesView.includes('className="stageAtlasVoteAction"')&&
 stagesView.includes('className="stageAtlasDetailAction"')&&
 stagesView.includes("className={'stageAtlasCardStatus is-'+s.status}")&&
 !stagesView.includes('className="stageTimeline"'));
check('Atlas owns last-loaded card styles without old fixed-width buttons',
 stageSheet.includes('.stagesAtlas .stageAtlasGrid')&&
 stageSheet.includes('.stagesAtlas .stageAtlasCardFooter')&&
 !stageSheet.includes('width:calc(100% - 55px)'));
const layout=read('app/layout.tsx');
check('Single ordered entry point for all design sheets',styles.every((name,i)=>layout.indexOf(name+'.css')>=0&&(i===0||layout.indexOf(name+'.css')>layout.indexOf(styles[i-1]+'.css'))));
const font=read('node_modules/@fontsource-variable/manrope/index.css');
check('Self-hosted Cyrillic font is available',font.includes('cyrillic')&&font.includes('font-display: swap'));
check('Legacy rules are isolated from the new design',read('app/globals.css').includes('@layer legacy {'));
check('Reduced motion',css['design-tokens'].includes('prefers-reduced-motion:reduce'));
check('Visible keyboard focus',css['design-tokens'].includes(':focus-visible'));
const readable=css['design-readability'];
check('Chart comparison header interpolates count without a literal dollar sign',
 read('components/game/StateMetricsDock.tsx').includes('до {MAX_CHART_SERIES-1} дополнительных показателей')&&
 !read('components/game/StateMetricsDock.tsx').includes('до ${MAX_CHART_SERIES}'));
check('Top action is consistently named Chat',
 read('components/GameClient.tsx').includes('<ChatToggleButton')&&
 read('components/game/ChatToggleButton.tsx').includes('<span>Чат</span>')&&
 !read('components/game/ChatToggleButton.tsx').includes('Связь'));
check('Header and page content use common responsive right alignment',
 readable.includes('calc((100% - var(--gs-content-max))/2)')&&
 readable.includes('--gs-layout-gutter:36px')&&
 readable.includes('--gs-layout-gutter:24px')&&
 readable.includes('--gs-layout-gutter:16px'));

const uiClose=read('components/ui/IconAction.tsx');
check('Unified accessible X action exposes close and remove variants',
 uiClose.includes("variant?:'close'|'remove'")&&
 uiClose.includes('aria-label={label}')&&
 uiClose.includes('type="button"')&&
 uiClose.includes('<X aria-hidden="true"'));
const closeFiles=[
 'components/GameClient.tsx',
 'components/game/StateMetricsDock.tsx',
 'components/game/StagesView.tsx',
 'components/game/GradesView.tsx',
 'components/game/ChatPanel.tsx',
 'components/game/MediaUploadButton.tsx',
 'components/game/PartiesView.tsx',
 'components/game/PresidentialElectionLab.tsx',
 'components/game/StateProgramLab.tsx',
 'components/game/InstitutionStaffingLab.tsx',
 'components/game/MunicipalGovernancePanel.tsx'
];
for(const source of closeFiles){
 check(source+': unified X icons, no font glyph buttons',
  read(source).includes('<IconAction')&&
  !read(source).includes('>×</button>')&&
  !read(source).includes('>✕</button>')&&
  !read(source).includes('>✖</button>'));
}
check('Close buttons have 44px targets with mobile and focus states',
 readable.includes('.gsIconAction{')&&readable.includes('width:44px;')&&
 readable.includes('.gsIconAction:focus-visible')&&
 readable.includes('@media(prefers-reduced-motion:reduce)'));
check('Inline remove buttons are distinct and touch accessible',
 readable.includes('.gsIconAction--remove{')&&
 readable.includes('width:40px;')&&
 read('components/game/PartiesView.tsx').includes('variant="remove"'));


const brandingFiles=[
 'app/page.tsx','app/layout.tsx','app/loading.tsx','components/GameClient.tsx',
 'components/PublicScreen.tsx','components/game/DocumentsView.tsx',
 'components/game/PoliticalWallView.tsx','production-app/app/page.tsx',
 'production-app/app/layout.tsx','production-app/components/GameClient.tsx',
 'demo/index.html','README.md','docs/ARCHITECTURE.md','docs/DESIGN.md',
 'docs/DEPLOYMENT.md','docs/DESIGN-AUDIT.md'
];
const oldFullBrand=new RegExp('GOS'+'\\/\\/SIM(?!S)');
const oldRichBrand=new RegExp('GOS'+'<span>\\/\\/<\\/span>SIM(?!S)');
const oldCompactBrand=new RegExp('g'+'<span>\\/\\/<\\/span>s(?!s)');
for(const name of brandingFiles){
 const source=read(name);
 check(name+': consistent GOS//SIMS branding',
  !oldFullBrand.test(source)&&!oldRichBrand.test(source)&&!oldCompactBrand.test(source));
}
check('Main and mobile masthead show the new full brand',
 read('components/GameClient.tsx').includes('GOS<span>//</span>SIMS')&&
 read('components/GameClient.tsx').includes('<b>GOS//SIMS</b>'));


const dock=read('components/game/StateMetricsDock.tsx');
check('State metric icons use unified Lucide vector icons rather than text glyphs',
 dock.includes("from 'lucide-react'")&&
 dock.includes("k==='economy'?TrendingUp")&&
 dock.includes("strokeWidth={1.75}")&&
 !dock.includes("return '⌁'"));
check('Dashboard icons use softly tinted group palettes',
 readable.includes('State metric icon system:')&&
 readable.includes('metric-economy .statePulseIcon')&&
 readable.includes('metric-public_trust .statePulseIcon')&&
 readable.includes('width:18px;'));

check('Metrics modal isolates scrollable content from the fixed header',
 dock.includes('className="metricModalBody"')&&
 readable.includes('.metricModal.redesigned>.metricModalBody')&&
 readable.includes('overflow-y:auto;')&&
 readable.includes('height:min(850px,calc(100dvh - 32px))'));
check('Chart, filters and history are ordered in distinct blocks',
 dock.indexOf('className="metricPlotViewport"')<dock.indexOf('className="metricSeriesControls"')&&
 dock.indexOf('className="metricSeriesControls"')<dock.indexOf('className="metricHistoryList"')&&
 readable.includes('.metricModal.redesigned .metricPlotViewport')&&
 readable.includes('min-height:250px'));
check('Responsive chart measures real SVG width and keeps plot dimensions stable',
 dock.includes("node.querySelector('svg')")&&
 dock.includes('ResizeObserver')&&
 dock.includes('preserveAspectRatio="xMidYMid meet"')&&
 readable.includes('.metricModal.redesigned .metricPlotViewport>svg'));
check('Series selection supports keyboard and stable colors',
 dock.includes('setFocusedPoint({id:line.metric.id,at:p.at})')&&
 dock.includes('aria-pressed={active}')&&
 dock.includes('comparisonOptions.findIndex(option=>option.id===metric.id)'));
check('Offline design preview includes an opened metric chart and current CSS',
 read('scripts/design-preview.cjs').includes("['metric-modal','График показателя'")&&
 previewUsesLayout&&layoutSource.includes("import './design-readability.css';"));
check('Dashboard renders all permitted metrics without a collapsed section',
 dock.includes('visibleMetrics.map(card)')&&!dock.includes('setMore('));
check('Dashboard compact grid has six columns and responsive container breakpoints',
 readable.includes('.overviewMetrics .statePulseGrid')&&
 readable.includes('grid-template-columns:repeat(6,minmax(0,1fr))')&&
 readable.includes('@container (max-width:1050px)')&&
 readable.includes('@container (max-width:690px)')&&
 readable.includes('@container (max-width:460px)'));
check('Dashboard cards remain readable with 28px icons and compact dimensions',
 readable.includes('min-height:108px')&&readable.includes('width:28px')&&
 readable.includes('.overviewMetrics .statePulseValue strong'));


check('Compact header status and chat match at 108px',
 readable.includes('flex:0 0 108px')&&readable.includes('width:108px'));
check('Preview selector remains contained at 188px',
 readable.includes('flex:0 0 188px')&&readable.includes('width:188px'));
check('Accessible preview menu supports compact screens',
 readable.includes('.viewAsMenu button:focus-visible')&&
 readable.includes('max-width:calc(100vw - 16px)')&&
 readable.includes('grid-column:2/5;'));
check('View-as menu uses accessible roles and Escape handling',
 read('components/GameClient.tsx').includes('role="menuitemradio"')&&
 read('components/GameClient.tsx').includes("event.key!=='Escape'"));

check('Every common page header receives a separated accent', ['pageHeader','gradesHero','votesHero','formalHero','teacherFocus','profileHero','wallHero','dashHero'].every(name=>{const root=postcss.parse(readable);return root.nodes.some(node=>node.type==='rule'&&node.selectors?.includes('.'+name+'::before')&&node.nodes.some(d=>d.prop==='background'&&d.value.includes('linear-gradient')));}));
check('Accent and text have separate insets on phones',readable.includes('padding:20px 18px 22px 42px')&&readable.includes('left:16px')&&readable.includes('padding:18px 14px 20px 36px')&&readable.includes('left:13px'));
check('Phone layout and touch targets',css['design-responsive'].includes('@media(max-width:390px)')&&css['design-responsive'].includes('@media(pointer:coarse)'));
const stageActions=read('components/game/stageActions.ts');
check('Every one of the 16 stages has a next action',Array.from({length:16},(_,i)=>i+1).every(n=>new RegExp(`\\b${n}:\\{title:`).test(stageActions)));
const chat=read('components/game/ChatPanel.tsx');
const chatCss=read('app/design-readability.css');
check('Chat uses one accessible styled channel switcher in the header',
 chat.includes('<ChatChannelDropdown')&&
 read('components/game/ChatChannelDropdown.tsx').includes('role="menuitemradio"')&&
 read('components/game/ChatChannelDropdown.tsx').includes('aria-expanded={open}')&&
 !chat.includes('<select aria-label="Канал общения"'));
check('Chat supports real backend pinning and icon-only send',
 chat.includes('chatPinnedWrap')&&chat.includes('setChatPin(m.id,!pinned)')&&
 chat.includes('chatPinAction')&&
 chat.includes('className="chatSendButton iconOnly"')&&
 !chat.includes('<span>Отправить</span>'));
check('Pinned media is secured, persistent and available outside recent history',
 read('supabase/migrations/068_chat_pins.sql').includes('enable row level security')&&
 read('supabase/migrations/068_chat_pins.sql').includes('private.can_access_channel')&&
 read('supabase/migrations/068_chat_pins.sql').includes('set_chat_pin')&&
 read('components/game/useRepublicGame.ts').includes('pinnedMessages')&&
 read('components/game/useRepublicGame.ts').includes("table:'chat_pins'")&&
 chat.includes('chatPinnedWrap')&&chat.includes('chatPinnedMedia'));
check('Audio and video files can be uploaded and played in chat',
 chat.includes('audio/*,video/*')&&
 chat.includes("m.mime_type?.startsWith('audio/')")&&
 chat.includes("m.mime_type?.startsWith('video/')"));
check('Styled channel menu has proper keyboard and focus management',
 read('components/game/ChatChannelDropdown.tsx').includes("event.key==='Escape'")&&
 read('components/game/ChatChannelDropdown.tsx').includes('ArrowDown')&&
 read('components/game/ChatChannelDropdown.tsx').includes('aria-checked={value===c.id}'));
check('Chat supports keyboard search, attachment filtering and scroll to latest',
 chat.includes('className="chatSearchBar"')&&
 chat.includes("'chatFilesFilter '")&&
 chat.includes('className="chatJumpLatest"')&&
 chat.includes('chatUtils'));
check('Chat uses distinct personal messages, day separators and one file card',
 chat.includes("own?'mine':'theirs'")&&
 chat.includes('className="chatDateSeparator"')&&
 chat.includes('className="chatDocument"'));
check('Chat has a fixed composer and full-screen tablet/mobile layout',
 chatCss.includes('.simChat.gsChatV2{')&&
 chatCss.includes('.gsChatV2 .chatCompose{')&&
 chatCss.includes('@media(max-width:1099px)')&&
 chatCss.includes('height:100dvh;'));
check('Chat has an offline full and empty preview',
 read('scripts/design-preview.cjs').includes("['chat-panel','Командный чат'")&&
 read('scripts/design-preview.cjs').includes("['chat-empty','Пустой чат'"));
execFileSync(process.execPath,['scripts/metric-chart-check.cjs'],{stdio:'inherit'});
check('Recording does not immediately upload on stop and supports local audio/video review',
 read('components/game/useRepublicGame.ts').includes('setRecordingPreview(preview)')&&
 read('components/game/useRepublicGame.ts').includes('sendRecordingPreview()')&&
 read('components/game/useRepublicGame.ts').includes('pendingChatUploads.current.set(blob,result.pending)')&&
 read('components/game/useRepublicGame.ts').includes('rec.start(1000)')&&
 chat.includes('className="chatCapturePanel chatCaptureReview"')&&
 chat.includes('chatCaptureVoicePreview')&&chat.includes('ChatVideoNote')&&
 chat.includes('recordingStream'));
check('Chat composer aligns icon send, attachment, visible mic and video controls',
 chat.includes('className="chatInputRow"')&&
 chat.includes('chatMediaShortcut')&&
 chatCss.includes('.gsChatV2 .chatInputRow{')&&
 chatCss.includes('.gsChatV2 .chatCapturePanel{')&&
 read('scripts/design-preview.cjs').includes("['chat-audio-preview'")&&
 read('scripts/design-preview.cjs').includes("['chat-video-preview'"));
execFileSync(process.execPath,['scripts/chat-logic-check.cjs'],{stdio:'inherit'});
execFileSync(process.execPath,['scripts/recording-media-check.cjs'],{stdio:'inherit'});
execFileSync(process.execPath,['scripts/chat-media-transport-check.cjs'],{stdio:'inherit'});
execFileSync(process.execPath,['scripts/chat-voice-player-check.cjs'],{stdio:'inherit'});
execFileSync(process.execPath,['scripts/voice-waveform-check.cjs'],{stdio:'inherit'});
check('Voice recordings preserve actual decoded waveform and metadata through Storage publication',
 read('components/game/useRepublicGame.ts').includes('analyseVoiceBlob(blob)')&&
 read('components/game/chatMediaTransport.ts').includes('voice_meta:input.voiceMeta')&&
 read('components/game/ChatPanel.tsx').includes('waveform={m.voice_meta?.waveform}')&&
 read('supabase/migrations/070_voice_metadata.sql').includes('voice_meta jsonb'));

check('Voice notes use same accessible compact player in chat and pins',
 chat.includes('import ChatVoicePlayer from')&&
 chat.includes('<ChatVoicePlayer src={m.url}')&&
 !chat.includes('<audio controls preload="none" src={m.url}')&&
 read('components/game/ChatVoicePlayer.tsx').includes("data-chat-voice-player")&&
 read('components/game/ChatVoicePlayer.tsx').includes('pauseOtherVoices()')&&
 chatCss.includes('.gsChatV2 .chatVoicePlayer{'));

check('Voice media securely renews expired signed URLs and keeps original message identity',
 read('components/game/useRepublicGame.ts').includes('async function refreshChatMediaUrl(')&&
 read('components/game/useRepublicGame.ts').includes("createSignedUrl(storagePath,3600)")&&
 read('components/game/ChatVoicePlayer.tsx').includes('refreshAttempts.current++')&&
 read('components/game/ChatPanel.tsx').includes('onRefresh={refreshChatMediaUrl}')&&
 read('components/game/ChatPanel.tsx').includes('chatAttachmentUnavailable'));
check('Media transfer failure is visible in the chat and local preview survives',
 read('components/game/useRepublicGame.ts').includes('setChatMediaError(result.error)')&&
 read('components/game/useRepublicGame.ts').includes('pendingChatUploads.current.set(blob,result.pending)')&&
 read('components/game/ChatPanel.tsx').includes('chatMediaError')&&
 read('components/game/ChatPanel.tsx').includes('Публикация…'));
check('Chat entries have intentional breathing room',
 chatCss.includes('.simChat.gsChatV2 .chatEntry + .chatEntry')&&
 chatCss.includes('.simChat.gsChatV2 .chatBubble{'));

console.log(`\n${count} source and contrast checks passed. This does not certify browser layout, keyboard interaction, or a live classroom session.`);
