'use client';
import {useRef} from 'react';

// Precomputed QR matrix for exactly https://dimkazantsev.github.io/gos-sim1/
// Error correction M, four-module quiet zone. No external QR service is used.
const QR_ROWS=[
 '0000000000000000000000000000000000000',
 '0000000000000000000000000000000000000',
 '0000000000000000000000000000000000000',
 '0000000000000000000000000000000000000',
 '0000111111101100001111100011111110000',
 '0000100000100110011010110010000010000',
 '0000101110100101101011111010111010000',
 '0000101110101001011100100010111010000',
 '0000101110101101001110000010111010000',
 '0000100000101010010010011010000010000',
 '0000111111101010101010101011111110000',
 '0000000000001111101101011000000000000',
 '0000100010111010101101001111110010000',
 '0000000110010101110101101011111110000',
 '0000001010111111100101000110100010000',
 '0000011100000001001011011011110110000',
 '0000010100100000101011010100000100000',
 '0000011101010011101110000111111110000',
 '0000110010111101011101101100011010000',
 '0000010010000000101001101100100110000',
 '0000111110101001011101011100000100000',
 '0000110011000111001110100011110110000',
 '0000001110110010011100001110001010000',
 '0000000000011011010001010011100110000',
 '0000110001110000110001111111110010000',
 '0000000000001101111111101000100010000',
 '0000111111101101000100111010111010000',
 '0000100000100100101001011000100110000',
 '0000101110101111111101011111110010000',
 '0000101110100101100101111100000010000',
 '0000101110100010111101010100011110000',
 '0000100000100011001001111001010110000',
 '0000111111101000011101001011110100000',
 '0000000000000000000000000000000000000',
 '0000000000000000000000000000000000000',
 '0000000000000000000000000000000000000',
 '0000000000000000000000000000000000000'
] as const;

const QR_PATH=QR_ROWS.flatMap((row,y)=>{
 const sections:string[]=[];
 for(let x=0;x<row.length;){
  if(row[x]==='0'){x++;continue}
  const start=x;
  while(x<row.length&&row[x]==='1')x++;
  sections.push(`M${start} ${y}h${x-start}v1h-${x-start}z`);
 }
 return sections;
}).join('');

function QrGraphic({className}:{className:string}){
 return <svg className={className} viewBox="0 0 37 37" role="img"
  aria-label="QR-код для перехода на страницу ГОС.ID"
  shapeRendering="crispEdges" xmlns="http://www.w3.org/2000/svg">
  <rect width="37" height="37" fill="#fff"/>
  <path d={QR_PATH} fill="#111827"/>
 </svg>;
}

export default function GameEntryQr(){
 const dialogRef=useRef<HTMLDialogElement>(null);
 return <>
  <button type="button" className="entryQrCard" aria-haspopup="dialog"
   aria-label="Увеличить QR-код для открытия ГОС.ID на телефоне"
   onClick={()=>dialogRef.current?.showModal()}>
   <QrGraphic className="entryQrThumbnail"/>
   <span className="entryQrCopy">
    <strong>Открыть игру на телефоне</strong>
    <span>Сканируйте QR-код, чтобы перейти на страницу ГОС.ID</span>
    <small>dimkazantsev.github.io/gos-sim1</small>
   </span>
  </button>
  <dialog ref={dialogRef} className="entryQrDialog"
   aria-label="QR-код для открытия игры на телефоне"
   aria-describedby="entry-qr-dismiss"
   onClick={event=>{
    // Close on every area outside the enlarged QR, including the modal padding.
    // The QR itself stays visible when tapped; Escape closes the native dialog.
    if(event.target instanceof Element&&event.target.closest('.entryQrZoomGraphic'))return;
    event.currentTarget.close();
   }}>
   <QrGraphic className="entryQrZoomGraphic"/>
   <p id="entry-qr-dismiss">Нажмите вне QR-кода, чтобы закрыть</p>
  </dialog>
 </>;
}
