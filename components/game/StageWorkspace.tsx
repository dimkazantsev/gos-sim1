'use client';

import type {ReturnTypeRepublic} from './viewTypes';
import type {Stage,View} from './types';
import GovernanceStageWorkspace from './GovernanceStageWorkspace';

export default function StageWorkspace(props:{
 g:ReturnTypeRepublic;
 stage:Stage;
 readOnly?:boolean;
 onBack:()=>void;
 onOpenStage?:(stageNo:number)=>void;
 onOpenVotes:(voteId?:string)=>void;
 onOpenDocument?:(id:string)=>void;
 onCreateDocument?:(key:string,stageNo:number)=>void;
 onNavigate?:(view:View)=>void;
}){
 return <GovernanceStageWorkspace key={props.stage.stage_no} {...props}/>;
}
