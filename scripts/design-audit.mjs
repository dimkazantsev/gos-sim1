import fs from 'node:fs';

const read=(p)=>fs.readFileSync(p,'utf8');
const files={
 layout:read('app/layout.tsx'),
 tokens:read('app/design-tokens.css'),
 shell:read('app/design-shell.css'),
 views:read('app/design-views.css'),
 responsive:read('app/design-responsive.css'),
 client:read('components/GameClient.tsx')
};

const checks=[
 ['layout loads final design layers', ['design-tokens.css','design-shell.css','design-views.css','design-responsive.css'].every(x=>files.layout.includes(x))],
 ['Geist typography is configured', files.layout.includes('GeistSans')&&files.tokens.includes('--gs-font-sans')],
 ['single primary accent token exists', files.tokens.includes('--gs-accent:#5b5cf0')],
 ['desktop command sidebar exists', files.client.includes('simSidebar')&&files.shell.includes('.simSidebar')],
 ['mobile dock exists', files.client.includes('mobileDock')&&files.responsive.includes('.mobileDock')],
 ['complete mobile more sheet exists', files.client.includes('mobileMoreSheet')&&files.responsive.includes('.mobileMoreSheet')],
 ['chat has responsive mobile treatment', files.responsive.includes('.simChat')&&files.responsive.includes('78dvh')],
 ['focus-visible treatment exists', files.tokens.includes(':focus-visible')],
 ['reduced motion treatment exists', files.tokens.includes('prefers-reduced-motion')],
 ['high contrast treatment exists', files.responsive.includes('prefers-contrast:more')],
 ['coarse pointer touch sizing exists', files.responsive.includes('pointer:coarse')&&files.responsive.includes('min-height:44px')],
 ['mobile portrait breakpoint exists', files.responsive.includes('@media(max-width:650px)')],
 ['small-phone breakpoint exists', files.responsive.includes('@media(max-width:390px)')],
 ['operational state metrics are responsive', files.views.includes('.statePulseGrid')&&files.responsive.includes('.statePulseGrid')],
 ['stage modal has narrow-screen fallback', files.responsive.includes('.stageDetailPanel')&&files.responsive.includes('max-height:100dvh')],
 ['dense grades table remains scrollable', files.views.includes('.gradesMatrix')&&files.views.includes('overflow:auto')],
 ['icon-only controls have labels', files.client.includes('aria-label="Выйти"')&&files.client.includes("aria-label={chatOpen?'Закрыть связь':'Открыть связь'}")],
 ['mobile navigation sheet is a modal dialog', files.client.includes('role="dialog"')&&files.client.includes('aria-modal="true"')]
];

let failed=0;
for(const [name,ok] of checks){
 console.log(`${ok?'PASS':'FAIL'}  ${name}`);
 if(!ok)failed++;
}
console.log(`\nDesign QA: ${checks.length-failed}/${checks.length} checks passed.`);
if(failed)process.exit(1);
