import {ChevronDown,type LucideIcon} from 'lucide-react';
export default function DisclosureSummary({icon:Icon,title,description}:{icon:LucideIcon;title:string;description?:string}){
 return <summary className="projectDisclosureSummary"><span className="projectDisclosureIcon"><Icon size={22} aria-hidden="true"/></span><span className="projectDisclosureText"><b>{title}</b>{description&&<small>{description}</small>}</span><ChevronDown className="projectDisclosureArrow" size={20} aria-hidden="true"/></summary>;
}
