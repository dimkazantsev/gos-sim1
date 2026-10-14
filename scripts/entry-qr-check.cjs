const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const file=p=>fs.readFileSync(p,'utf8');
const qr=file('components/ui/GameEntryQr.tsx');
const home=file('app/page.tsx');
const css=file('app/entry-qr.css');
const layout=file('app/layout.tsx');
const rows=[...qr.matchAll(/'([01]{37})'/g)].map(x=>x[1]);
assert.equal(rows.length,37,'Full QR matrix with four-module quiet zone');
assert.equal(crypto.createHash('sha256').update(rows.join('')).digest('hex'),
 '9797cd48729e883191992cbd995e60b3ae5b3bd9c0006da7f144675fd10bccb1',
 'Exact QR matrix was generated and scan-verified for the approved destination');
assert(qr.includes('https://dimkazantsev.github.io/gos-sim1/'));
assert(qr.includes('dialogRef.current?.showModal()'),'QR click opens native modal');
assert(qr.includes("event.currentTarget.close()"),'Outside click closes native modal');
assert(qr.includes("closest('.entryQrZoomGraphic')"),'Clicking QR must not close it');
assert(qr.includes('type="button"'),'QR must not submit the entry form');
assert.equal((home.match(/<GameEntryQr\/>/g)||[]).length,2,'QR should appear in code and personal-password entry');
assert(layout.includes("import './entry-qr.css'"),'QR styles loaded');
assert(css.includes('.entryQrDialog::backdrop')&&css.includes('rgba(13,26,58,.65)'),'Background dimmed');
assert(css.includes('.entryQrDialog:not([open]){display:none}'),'Dialog remains hidden before opening');
assert(css.includes('@media(max-width:420px)'),'QR card adapts to narrow phones');
console.log('PASS: exact scannable QR, native modal interactions, two entry modes and CSS');
