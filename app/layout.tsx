import './globals.css';
import './design-tokens.css';
import './design-shell.css';
import './design-views.css';
import './design-responsive.css';
import './design-readability.css';
import './teacher-mobile.css';
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
