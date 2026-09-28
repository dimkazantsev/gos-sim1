import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'GOS//SIMS',
  description: 'Учебная многопользовательская симуляция государственного управления'
};

export default function RootLayout({children}:{children:React.ReactNode}){
  return <html lang="ru"><body>{children}</body></html>;
}
