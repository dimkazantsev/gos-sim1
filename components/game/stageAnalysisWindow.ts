import type {Stage} from './types';
export type AnalysisWindowStage=Pick<Stage,'status'|'completed_at'>;
export type AnalysisPhase='early'|'active'|'expired'|'unavailable';

/** The analysis hour begins at actual completion, not at the planned deadline. */
export function stageAnalysisPhase(stage:AnalysisWindowStage,now:number):AnalysisPhase{
 if(stage.status!=='completed')return stage.status==='open'?'early':'unavailable';
 if(!stage.completed_at)return 'unavailable';
 const completed=Date.parse(stage.completed_at);
 if(!Number.isFinite(completed))return 'unavailable';
 if(now<completed)return 'early';
 return now<completed+60*60*1000?'active':'expired';
}
