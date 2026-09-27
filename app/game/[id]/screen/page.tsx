import {redirect} from 'next/navigation';

export default async function SharedScreenPage({params}:{params:Promise<{id:string}>}){
 const {id}=await params;
 redirect('/game/'+id);
}