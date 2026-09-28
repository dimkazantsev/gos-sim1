import './globals.css';
import './design-tokens.css';
import './design-shell.css';
import './design-views.css';
import './design-responsive.css';
import type {Metadata} from 'next';
import '@fontsource-variable/manrope';
import {GeistMono} from 'geist/font/mono';

export const metadata:Metadata={
 title:'GOS//SIM — Республика Политология · симулятор',
 description:'Учебная многопользовательская платформа: политические процессы, НПА, голосования, партии, аналитика и автоматический журнал ВСН по 16 этапам',
 applicationName:'GOS//SIM'
};

export default function RootLayout({children}:{children:React.ReactNode}){
 return <html lang="ru" className={GeistMono.variable}><body>{children}</body></html>;
}
