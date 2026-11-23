'use client';

import {METRIC_RELATIONSHIPS} from './metricRelationshipCopy';

type Props={metricKey:string;compact?:boolean};

function RelationshipContent({metricKey}:{metricKey:string}){
 const relation=METRIC_RELATIONSHIPS[metricKey];
 if(!relation)return null;
 return <div className="metricRelationsBody">
  <p className="metricRelationsMeaning">{relation.meaning}</p>
  <dl className="metricRelationsGrid">
   <div><dt>От чего зависит</dt><dd>{relation.incoming}</dd></div>
   <div><dt>На что влияет</dt><dd>{relation.outgoing}</dd></div>
  </dl>
  {relation.note&&<p className="metricRelationsNote">{relation.note}</p>}
 </div>;
}

/** Static descriptions: no extra database reads, subscriptions, hooks or calculations. */
export default function MetricRelationships({metricKey,compact=false}:Props){
 if(!METRIC_RELATIONSHIPS[metricKey])return null;
 if(compact)return <details className="metricRelations metricRelationsCompact" data-metric-relations={metricKey}>
  <summary>Значение индекса и его связи с другими показателями</summary>
  <RelationshipContent metricKey={metricKey}/>
 </details>;
 return <section className="metricRelations" data-metric-relations={metricKey} aria-label="Значение индекса и связи показателей">
  <h4>Значение индекса и связи показателей</h4>
  <RelationshipContent metricKey={metricKey}/>
 </section>;
}
