/** Position the portalled listbox beside the trigger using its real content height.
 * An earlier calculation subtracted the *maximum* height from the trigger,
 * leaving a short (e.g. two-row) list detached far above its field.
 */
export type SelectMenuPlacement={top:number;left:number;width:number;maxHeight:number};
export function placeSelectMenu(
 trigger:{top:number;bottom:number;left:number;width:number},
 naturalMenuHeight:number,
 viewport:{width:number;height:number}
):SelectMenuPlacement{
 const edge=8,gap=6,maxHeight=340;
 const desired=Math.min(maxHeight,Math.max(0,naturalMenuHeight));
 const below=Math.max(0,viewport.height-trigger.bottom-gap-edge);
 const above=Math.max(0,trigger.top-gap-edge);
 const openAbove=desired>below&&above>below;
 const available=openAbove?above:below;
 const shownHeight=Math.min(desired,available);
 const width=Math.max(0,Math.min(trigger.width,viewport.width-edge*2));
 const left=Math.max(edge,Math.min(trigger.left,viewport.width-edge-width));
 const top=openAbove?trigger.top-gap-shownHeight:trigger.bottom+gap;
 return {top:Math.max(edge,top),left,width,maxHeight:available};
}
