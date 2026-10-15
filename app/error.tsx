'use client';

export default function GlobalError({reset}:{error:Error & {digest?:string};reset:()=>void}){
  return <main className="routeState routeError"><div className="routeStateIcon">!</div><div><b>Не удалось загрузить экран</b><p>Проверьте соединение и повторите попытку. Данные игры сохраняются на сервере.</p><button className="primary" onClick={reset}>Повторить</button></div></main>;
}
