const assert=require('node:assert/strict'),fs=require('node:fs');
const entry=fs.readFileSync('app/page.tsx','utf8');
const brand=fs.readFileSync('components/ui/BrandIdentity.tsx','utf8');
assert(brand.includes("export const BRAND_NAME='ГОС.ID'")&&brand.includes("export const BRAND_TAGLINE='Цифровая платформа России'"),'Approved product identity must not change');
assert(entry.includes('<div className="entryVisualCaption"><span>{BRAND_NAME} // {BRAND_TAGLINE}</span>'),'Public entry art must use canonical brand and approved slash separator');
assert(!entry.includes('РЕСПУБЛИКА ПОЛИТОЛОГИЯ'),'Retired game name must never appear in current login view');
assert(entry.includes('import {BrandIdentity,BRAND_NAME,BRAND_TAGLINE}'),'Brand caption uses the same source as the logo');
console.log('PASS canonical ГОС.ID entry caption, no retired branding');
