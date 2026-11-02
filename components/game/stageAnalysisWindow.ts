import type {Stage} from './types';
export type AnalysisWindowStage=Pick<Stage,'status'|'deadline'>;
export type AnalysisPhase='early'|'active'|'expired'|'unavailable';
export function stageAnalysisPhase(stage:AnalysisWindowStage,now:number):AnalysisPhase{
 if(stage.status==='completed')return 'expired';
 if(stage.status!=='open'||!stage.deadline)return 'unavailable';
 const end=Date.parse(stage.deadline);
 if(!Number.isFinite(end))return 'unavailable';
 if(now>=end)return 'expired';
 return now>=end-3600000?'active':'early';
}
