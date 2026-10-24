/** Account assets have their own private bucket; legacy game paths still resolve. */
export function resolveStoredAsset(bucket:'game-assets'|'game-media',storedPath:string){
 const marker='teacher-assets/';
 return bucket==='game-assets'&&storedPath.startsWith(marker)
  ?{bucket:'teacher-assets' as const,path:storedPath.slice(marker.length)}
  :{bucket,path:storedPath};
}
