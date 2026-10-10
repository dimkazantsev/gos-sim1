import type {Metadata} from 'next';
export const metadata:Metadata={title:'10 иллюстраций · GOS//SIMS',description:'Авторские иллюстрации учебных ситуаций, 1920×1080'};
const scenes=[{id:"budget-region-2026-05-essential-services-gap",title:"Снижение доходов и обязательные выплаты"},
{id:"budget-region-2026-10-hospital-equipment",title:"Районная больница без диагностики"},
{id:"budget-region-2026-22-drought-irrigation",title:"Засуха и восстановление посевов"},
{id:"budget-region-2026-25-bridge-detour",title:"Закрытый мост и длинный объезд"},
{id:"budget-region-2026-38-forest-recovery",title:"Лесной пожар и восстановление территории"},
{id:"budget-region-2026-40-industrial-grid",title:"Промышленная площадка и подключение к сетям"},
{id:"budget-region-2026-42-employment-retraining",title:"Спад заказов и переобучение работников"},
{id:"budget-region-2026-43-rural-cultural-centres",title:"Сельские культурные центры после обследования"},
{id:"budget-region-2026-45-rural-broadband",title:"Связь для удалённых поселений"},
{id:"budget-region-2026-47-food-logistics",title:"Складская сеть для местных производителей"}];
export default function Gallery(){return <main style={{margin:'0 auto',padding:'32px 20px 80px',maxWidth:1220,fontFamily:'Arial,sans-serif',background:'#f4f7f9',color:'#213247',minHeight:'100vh'}}><h1 style={{fontSize:30}}>Иллюстрации ситуаций · 10 сцен</h1><p>Каждая иллюстрация доступна отдельным файлом SVG, 1920×1080. Существующие иллюстрации игрового банка сохранены.</p><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,470px),1fr))',gap:20}}>{scenes.map((s,i)=><article key={s.id} style={{borderRadius:16,overflow:'hidden',background:'#fff',border:'1px solid #d5dfe7',boxShadow:'0 7px 18px rgba(32,54,68,.07)'}}><a href={'/event-art/'+s.id+'-20261010-1920.svg'} target="_blank" rel="noopener noreferrer"><img src={'/event-art/'+s.id+'-20261010-1920.svg'} alt={s.title} width={1920} height={1080} style={{width:'100%',height:'auto',aspectRatio:'16 / 9',display:'block'}}/></a><div style={{padding:16}}><b>{i+1}. {s.title}</b><div style={{marginTop:8,fontSize:13,opacity:.64}}>{s.id}</div></div></article>)}</div></main>}
