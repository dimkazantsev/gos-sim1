import type {ReactNode} from 'react';
import styles from './StageModuleHeader.module.css';

export default function StageModuleHeader({eyebrow,title,description,icon,stats=[]}:{eyebrow:string;title:string;description:string;icon?:ReactNode;stats?:{label:string;value:ReactNode;detail?:string}[]}){
 return <header className={styles.header} data-stage-module-head>
  <div className={styles.copy}><span className={styles.eyebrow}>{icon}{eyebrow}</span><h2>{title}</h2><p>{description}</p></div>
  {stats.length>0&&<dl className={styles.stats}>{stats.map(stat=><div key={stat.label}><dt>{stat.label}</dt><dd data-numeric={typeof stat.value==='number'||(typeof stat.value==='string'&&/^[\d\s.,/%−–-]+$/u.test(stat.value))||undefined}>{stat.value}</dd>{stat.detail&&<span>{stat.detail}</span>}</div>)}</dl>}
 </header>;
}
