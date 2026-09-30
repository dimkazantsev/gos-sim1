export type Detection = [number, number, number, number];
export type Classifier = (r:number,c:number,s:number,pixels:Uint8Array,ldim:number)=>number;
export function unpack_cascade(bytes:Int8Array):Classifier;
export function run_cascade(image:{pixels:Uint8Array;nrows:number;ncols:number;ldim:number},classify:Classifier,params:{shiftfactor:number;minsize:number;maxsize:number;scalefactor:number}):Detection[];
export function cluster_detections(detections:Detection[],threshold:number):Detection[];
