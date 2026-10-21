/* Focused stages 10–11 brand regression; no network or database access. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const lab=fs.readFileSync('components/game/StateProgramLab.tsx','utf8');
const editor=fs.readFileSync('components/game/StateProgramEditor.tsx','utf8');
const css=fs.readFileSync('components/game/StageForms.module.css','utf8');
const ui=fs.readFileSync('components/ui/StageModuleHeader.tsx','utf8');

assert.match(lab,/className=\{'programLab '\+styles\.programWorkspace\}/,'Only the program workspace receives the design treatment');
assert.match(lab,/styles\.panel} \$\{styles\.addressPanel}/,'Presidential address uses the scoped panel');
assert.match(editor,/styles\.panel} \$\{styles\.programEditorPanel}/,'Program editor uses the scoped panel');
assert.match(lab,/styles\.addressActions/,'Address button has its own compact action row');
assert.match(lab,/className="primary" disabled=\{busy\|\|addressBody\.trim\(\)\.length<20\}/,'Keep the existing address submit guard');
assert.match(lab,/onClick=\{\(\)=>void saveAddress\(\)\}/,'Keep address saving');
assert.match(editor,/onClick=\{\(\)=>void save\(false\)\}/,'Keep draft saving');
assert.match(editor,/onClick=\{\(\)=>void save\(true\)\}/,'Keep program confirmation');
assert.match(ui,/data-stage-module-head/,'Use the existing stage heading component');
assert.match(css,/\.programWorkspace\s+:global\(\[data-stage-module-head\]\)/,'Scoped official stage header');
assert.match(css,/background:var\(--surface,#fff\);color:var\(--text,#10213c\)/,'Match the approved light Work/Documents form surface');
assert.match(css,/var\(--line,#dce4ef\)/,'Use the existing divider design token');
assert.match(css,/\.programWorkspace\s+\.field\s+input/,'Program fields only');
assert.match(css,/\.programWorkspace\s+:global\(\.styledSelectTrigger\)/,'Consistent existing selector styling');
assert.match(css,/@media\(max-width:1000px\)/,'Tablet layout');
assert.match(css,/@media\(max-width:700px\)/,'Phone layout');
assert.match(css,/@media\(max-width:420px\)/,'Narrow phone layout');
assert.doesNotMatch(css,/\.programWorkspace\s*\{[^}]*position:\s*fixed/,'Do not trap navigation or editor scroll');
console.log('PASS: stage 10–11 branding, isolated CSS, desktop/tablet/phone breakpoints and preserved save/approval controls');
