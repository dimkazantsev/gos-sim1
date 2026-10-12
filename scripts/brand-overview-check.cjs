/* Canonical visible brand + shared overview pulse regression.
   Keep localStorage keys, RPC identifiers and database fields unchanged. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const brand=read('components/ui/BrandIdentity.tsx');
const css=read('app/brand-identity.css');
const overview=read('components/game/DashboardView.tsx');
const pulse=read('components/game/StateMetricsDock.tsx');
const home=read('app/page.tsx');
const shell=read('components/GameClient.tsx');
const layout=read('app/layout.tsx');
const icon=read('app/icon.svg');
assert(brand.includes("BRAND_NAME='ГОС.ID'"),'Canonical brand name missing');
assert(brand.includes("BRAND_TAGLINE='Республиканская цифровая платформа'"),'Canonical tagline missing');
assert(brand.includes('г<span>//</span>id'),'Slash motif must remain in mark');
assert(brand.includes('gosIdSuffix'),'ID letters must be independently stylable');
for(const variant of ['blue-pink','pink-blue']){
 assert(css.includes('gosIdMark--'+variant),'Missing '+variant+' icon palette');
 assert(css.includes('gosIdWordmark--'+variant),'Missing '+variant+' wordmark palette');
}
assert(layout.includes("import './brand-identity.css'"),'Brand styles must load after legacy layers');
assert(layout.includes('applicationName:BRAND_NAME'),'Metadata must use canonical brand');
assert(home.includes('<BrandIdentity/>'),'Home entry must use shared brand');
assert(shell.includes('<BrandIdentity tagline/>'),'Sidebar should show canonical tagline');
assert(shell.includes('<div className="mobileBrand"><BrandIdentity/></div>'),'Mobile brand must use shared component');
assert(icon.includes('aria-label="ГОС.ID"'),'Site icon must use new brand');
assert(overview.includes("import StateMetricsDock from './StateMetricsDock'"),'Overview should reuse StateMetricsDock');
assert(overview.includes('<StateMetricsDock g={g}/>'),'Overview must render canonical live metric panel');
assert(pulse.includes('visibleMetrics.map(card)'),'Pulse must use active metrics from shared game state');
const oldBrand=new RegExp('GOS'+'\\/\\/'+'SIMS','i');
const scan=(dir,out=[])=>{
 for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const f=path.join(dir,entry.name);
  if(entry.isDirectory())scan(f,out);
  else if(/\\.(tsx|jsx|ts)$/.test(f)&&!f.endsWith('BrandIdentity.tsx')){
   const value=fs.readFileSync(f,'utf8');
   if(oldBrand.test(value))out.push(path.relative(root,f));
  }
 }
 return out;
};
const remaining=[...scan(path.join(root,'app')),...scan(path.join(root,'components'))];
assert.deepEqual(remaining,[],'Visible UI still contains old name: '+remaining.join(', '));
console.log('PASS canonical ГОС.ID branding, two variants, unchanged storage keys and shared overview pulse');
