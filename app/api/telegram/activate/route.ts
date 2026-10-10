import {NextResponse} from 'next/server';
import {POST as registerWebhook} from '../register/route';

export const runtime='nodejs';
export const dynamic='force-dynamic';

// Public method probe: does not reveal server configuration or secret values.
export function GET(){
 return NextResponse.json({ok:true,method:'POST',service:'telegram-activation'},{headers:{'Cache-Control':'no-store'}});
}

export async function POST(request:Request){
 return registerWebhook(request);
}
