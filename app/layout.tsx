import './globals.css';
import './design-tokens.css';
import './design-shell.css';
import './design-views.css';
import './design-responsive.css';
import './design-readability.css';
import './teacher-mobile.css';
import './impact-workbench.css';
import './mobile-nav-polish.css';
import './stage-map.css';
import './teacher-command.css';
import './teacher-operations.css';
import './teacher-ui-polish.css';
import './teacher-extended.css';
import './teacher-master-detail.css';
import './teacher-final-interactions.css';
import './2026-cinema-events.css';
import type {Metadata} from 'next';
import '@fontsource-variable/manrope';
import {GeistMono} from 'geist/font/mono';

export const metadata:Metadata={
 title:'GOS//SIMS — Республика Политология · симулятор',
 description:'Учебная многопользовательская платформа: политические процессы, НПА, голосования, партии, аналитика и автоматический журнал ВСН по 16 этапам',
 applicationName:'GOS//SIMS',
 other:{'gos-sims-release':process.env.VERCEL_GIT_COMMIT_SHA?.slice(0,8)||'local'}
};

export default function RootLayout({children}:{children:React.ReactNode}){
 return <html lang="ru" className={GeistMono.variable}><body>{children}</body></html>;
}
