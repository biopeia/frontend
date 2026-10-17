import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css=readFileSync(new URL('../src/style.css',import.meta.url),'utf8');
const themeVariables=theme=>{
 const match=css.match(new RegExp(`html\\[data-theme="${theme}"\\]\\{([^}]+)\\}`));
 assert.ok(match,`${theme} theme variables exist`);
 return Object.fromEntries([...match[1].matchAll(/--([\w-]+):(#[\da-fA-F]{6})/g)].map(([,name,value])=>[name,value]));
};
const linear=value=>{const channel=parseInt(value,16)/255;return channel<=0.04045?channel/12.92:((channel+0.055)/1.055)**2.4;};
const luminance=hex=>{const rgb=hex.slice(1).match(/../g).map(linear);return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];};
const contrast=(a,b)=>{const values=[luminance(a),luminance(b)].sort((x,y)=>y-x);return (values[0]+.05)/(values[1]+.05);};

test('muted shell text meets WCAG AA normal-text contrast on each shell surface in both themes',()=>{
 for(const theme of ['light','dark']){
  const vars=themeVariables(theme);
  for(const surface of ['canvas','surface','raised','sidebar']){
   assert.ok(contrast(vars.muted,vars[surface])>=4.5,`${theme} muted on ${surface}: ${contrast(vars.muted,vars[surface]).toFixed(2)}:1`);
  }
 }
});

test('navigation numerals do not reduce the contrast of their inherited text color',()=>{
 const rule=css.match(/\.nav-numeral\{([^}]+)\}/)?.[1];
 assert.ok(rule,'navigation numeral rule exists');
 assert.doesNotMatch(rule,/opacity\s*:/,'numerals keep the inherited foreground at full opacity');
});

test('spatial selector has an explicitly associated accessible label',()=>{
 const source=readFileSync(new URL('../src/spatial-renderer.js',import.meta.url),'utf8');
 assert.match(source,/<label for="spatial-item-selection">Select an authored geometry item<\/label><select id="spatial-item-selection">/);
});

test('spatial disclosure summaries let provenance badges wrap on narrow screens',()=>{
 assert.match(css,/@media\(max-width:690px\)\{[^}]*\.spatial-inspector>summary,\.spatial-diagnostics>summary\{[^}]*flex-wrap:wrap/);
 assert.match(css,/\.spatial-inspector>summary \.small-tag,\.spatial-diagnostics>summary \.small-tag\{[^}]*white-space:normal/);
});
