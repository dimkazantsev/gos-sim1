/**
 * GitHub Pages cannot serve dynamic Next.js /game/[id] routes.
 * Install a custom 404 page that redirects only legacy UUID game links to
 * the static application's /?game=UUID route.
 *
 * Run after "next build": Next's static exporter also generates 404.html.
 */
import {existsSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

const base=process.env.PAGES_BASE_PATH||'/gos-sim1';
if(!/^\/[A-Za-z0-9._-]+$/.test(base))throw Error('Unexpected GitHub Pages base path.');
const out=resolve(import.meta.dirname,'../.pages-build/out');
if(!existsSync(resolve(out,'index.html')))throw Error('Static root must be built before installing 404 fallback.');

const html=[
 '<!doctype html>',
 '<html lang="ru">',
 '<head>',
 '<meta charset="utf-8">',
 '<meta name="viewport" content="width=device-width, initial-scale=1">',
 '<title>GOS//SIMS — переход к игровой сессии</title>',
 '</head>',
 '<body style="font-family:system-ui,sans-serif;margin:12vh auto;padding:0 20px;max-width:620px;line-height:1.6">',
 '<h1>Открываем GOS//SIMS</h1>',
 '<p>Если переход не состоялся, вернитесь на <a href="'+base+'/">главную страницу игры</a>.</p>',
 '<script>',
 '(function(){',
 ' const base='+JSON.stringify(base)+';',
 ' const prefix=base+"/game/";',
 ' const path=window.location.pathname;',
 ' let id=path.startsWith(prefix)?path.slice(prefix.length):"";',
 ' if(id.endsWith("/"))id=id.slice(0,-1);',
 ' if(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)){',
 '   window.location.replace(base+"/?game="+encodeURIComponent(id)+window.location.hash);',
 ' }',
 '})();',
 '</script>',
 '</body></html>'
].join('\n');
writeFileSync(resolve(out,'404.html'),html,'utf8');
console.log('Installed GitHub Pages deep-link fallback at '+base+'/404.html');
