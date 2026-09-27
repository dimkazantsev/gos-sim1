import PublicScreen from '@/components/PublicScreen';

export default async function SharedScreenPage({params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  return <PublicScreen gameId={id}/>;
}
