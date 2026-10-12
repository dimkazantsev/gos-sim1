import {BrandName} from '@/components/ui/BrandIdentity';
export default function Loading(){
  return <main className="routeState"><div className="spinner"/><div><BrandName/><p>Загрузка игровой сессии…</p></div></main>;
}
