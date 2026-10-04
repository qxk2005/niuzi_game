import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import vm from 'node:vm';
const files=readdirSync('.').filter(f=>f.endsWith('.html'));
assert.equal(files.length,15);
let scripts=0;
for(const file of files){
  const html=readFileSync(file,'utf8');
  for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const src=match[1].match(/src="([^"]+)"/);
    if(src){assert.ok(existsSync(src[1]),`${file}: missing ${src[1]}`);new vm.Script(readFileSync(src[1],'utf8'),{filename:src[1]});}
    else {new vm.Script(match[2],{filename:file});scripts++;}
  }
  for(const match of html.matchAll(/(?:src|href)="(assets\/[^"#]+)"/g))assert.ok(existsSync(match[1]),`${file}: missing asset ${match[1]}`);
  assert.ok(!html.includes('user-scalable=no'),`${file}: zoom must remain available`);
  if(file!=='index.html')assert.match(html,/data-game="\d+"/);
}
const sandbox={window:{}};vm.runInNewContext(readFileSync('assets/games.js','utf8'),sandbox);
const games=sandbox.window.NiuziGames;
assert.equal(games.length,14);assert.equal(new Set(games.map(g=>g.file)).size,14);
for(const game of games)assert.ok(existsSync(game.file),`missing game ${game.file}`);
console.log(`PASS: ${files.length} HTML pages, ${scripts} inline scripts, shared JS, assets and all 14 lobby entries.`);
