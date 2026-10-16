'use client';
import {createContext,useContext,useState,type ReactNode} from 'react';

// The provider spans the header and workspace without adding another DOM box.
const TeacherNavigationContext=createContext<HTMLElement|null|undefined>(undefined);
export const useTeacherNavigationTarget=()=>useContext(TeacherNavigationContext);

export default function GameHeader({children,teacherNavigation=false}:{children:ReactNode;teacherNavigation?:boolean}){
 return <div className={teacherNavigation?'simHeader unifiedTeacherHeader':'simHeader'}>
  {children}{teacherNavigation&&<TeacherNavigationMount/>}
 </div>;
}

export function TeacherNavigationProvider({children}:{children:ReactNode}){
 const [target,setTarget]=useState<HTMLDivElement|null>(null);
 return <TeacherNavigationContext.Provider value={target}>
  <TeacherNavigationMountContext.Provider value={setTarget}>{children}</TeacherNavigationMountContext.Provider>
 </TeacherNavigationContext.Provider>;
}
const TeacherNavigationMountContext=createContext<((element:HTMLDivElement|null)=>void)|undefined>(undefined);
export function TeacherNavigationMount(){
 const mount=useContext(TeacherNavigationMountContext);
 return <div className="teacherHeaderNavigation"><div className="teacherCommand" ref={mount}/></div>;
}
