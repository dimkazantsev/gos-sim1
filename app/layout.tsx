import './globals.css';
import type {Metadata} from 'next';
export const metadata:Metadata={title:'GOS//SIM — Республика Политология · симулятор',description:'Учебная многопользовательская платформа: политические процессы, НПА, голосования, партии и аналитика государственного управления',applicationName:'GOS//SIM'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ru"><body>{children}</body></html>}