/** Lightweight SVG illustration; decorative animation respects reduced motion. */
export default function CivicArtwork(){
 return <svg className="civicArtwork" viewBox="0 0 680 260" fill="none" aria-hidden="true">
  <defs><clipPath id="gos-cuckoo-window"><rect x="265" y="81" width="30" height="32" rx="4"/></clipPath></defs>
  <path d="M0 224H680M0 242H680M46 0V260M640 0V260" stroke="currentColor" opacity=".13"/>
  <circle className="civicSun" cx="523" cy="94" r="79" fill="#F3A8CF"/>
  <g className="civicOrbit"><circle cx="523" cy="94" r="97" stroke="#172E74" strokeDasharray="3 9" opacity=".4"/></g>
  <path d="M110 224V112L280 28L450 112V224H110Z" fill="#2453E6"/>
  <path d="M91 112L280 18L469 112H91Z" fill="#173DAE"/>
  <rect x="262" y="78" width="36" height="38" rx="6" fill="#102E8A" stroke="#AFC7FF" strokeWidth="3"/>
  <g clipPath="url(#gos-cuckoo-window)">
   <g className="civicCuckoo">
    <ellipse cx="280" cy="105" rx="12" ry="15" fill="#FFFFFF"/>
    <circle cx="280" cy="96" r="10" fill="#FFFFFF"/>
    <circle cx="276.5" cy="95" r="1.6" fill="#122F76"/>
    <circle cx="283.5" cy="95" r="1.6" fill="#122F76"/>
    <path d="M276 100L280 105L284 100Z" fill="#F3A8CF"/>
    <path d="M268 107L274 103M286 103L292 107" stroke="#A8C4FF" strokeWidth="3" strokeLinecap="round"/>
   </g>
  </g>
  <path d="M148 224V137H181V224M224 224V137H257V224M301 224V137H334V224M378 224V137H411V224" fill="#F6F8FF"/>
  <path d="M91 223H469V242H91V223Z" fill="#173DAE"/>
  <path d="M274 43L280 38L286 43V69H274V43Z" fill="#F3A8CF"/>
  <g className="civicArrow">
   <path d="M496 217L535 175L570 187L621 136" stroke="#172E74" strokeWidth="3" strokeLinecap="round"/>
   <path d="M597 136H621V160" stroke="#172E74" strokeWidth="3"/>
  </g>
  <circle cx="535" cy="175" r="5" fill="#172E74"/><circle cx="570" cy="187" r="5" fill="#172E74"/>
  <g className="civicCross"><path d="M44 83V111M30 97H58" stroke="#2453E6" strokeWidth="2"/></g>
  <path d="M584 27V43M576 35H592" stroke="#172E74" strokeWidth="2"/>
  <circle className="civicSmallCircle" cx="53" cy="186" r="12" stroke="#2453E6" strokeWidth="2"/>
  <path d="M137 119H422" stroke="#87A7FF"/>
 </svg>;
}
