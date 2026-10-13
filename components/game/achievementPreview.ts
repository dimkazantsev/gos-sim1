/** Demonstration of the public achievement catalog, never real student data. */
export type PreviewAchievement={id:string;title:string;description:string;hidden:boolean;earned_at:string|null;progress:number};

/** Strip private and earned data even if the teacher has unlocked secret achievements. */
export function publicAchievementPreview<T extends PreviewAchievement>(rows:T[]):PreviewAchievement[]{
 return rows.filter(row=>!row.hidden).map(row=>({
  id:row.id,title:row.title,description:row.description,
  hidden:false,earned_at:null,progress:0
 }));
}
