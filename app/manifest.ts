import type {MetadataRoute} from 'next';
export default function manifest():MetadataRoute.Manifest{
 return {
  id:'/',name:'ГОС.ID — Цифровая платформа России',short_name:'ГОС.ID',
  description:'Учебная политико-административная игра',
  start_url:'/',scope:'/',display:'standalone',
  background_color:'#f7f9fd',theme_color:'#2453e6',
  lang:'ru',orientation:'any',
  icons:[
   {src:'/pwa/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},
   {src:'/pwa/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any maskable'}
  ]
 };
}
