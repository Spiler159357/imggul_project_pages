import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { build, transformSync } from 'esbuild';

// Syntax/import/encoding checks only. This never opens a browser or calls an API.
const root=path.resolve(import.meta.dirname,'..');
const frontend=fs.readdirSync(path.join(root,'public/js/editor')).filter(name=>name.endsWith('.js')).map(name=>`public/js/editor/${name}`);
const scripts=[...frontend,'src/editor/api.js','functions/[[path]].js','src/path-migration.js','src/path-utils.js','src/image-serving.js','src/guest-api.js','public/js/main.js','public/js/project.js','public/js/project/manage.js'];
const textFiles=[...scripts,'public/editor.css','public/style.css','public/app.html','migrations/0027_editor_workspace.sql'];
for(const relative of textFiles){
    const file=path.join(root,relative),bytes=fs.readFileSync(file);
    if(bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf)throw new Error(`UTF-8 BOM: ${relative}`);
    new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
for(const relative of scripts){
    const result=spawnSync(process.execPath,['--check',path.join(root,relative)],{encoding:'utf8'});
    if(result.status!==0)throw new Error(`${relative}\n${result.stderr||result.error}`);
}
for(const [entry,platform]of [['public/js/editor/index.js','browser'],['public/js/editor/subject-worker.js','browser'],['src/editor/api.js','neutral']]){
    await build({absWorkingDir:root,entryPoints:[path.join(root,entry)],tsconfigRaw:{compilerOptions:{target:'ES2022'}},bundle:true,format:'esm',platform,target:'es2022',external:['https://*'],write:false,logLevel:'silent'});
}
transformSync(fs.readFileSync(path.join(root,'public/editor.css'),'utf8'),{loader:'css',logLevel:'silent'});
const oldEntry=path.join(root,'public/js/image_editor.js');
if(fs.existsSync(oldEntry))throw new Error('Retired editor entry still exists.');
for(const relative of ['public/js/main.js','public/js/project/manage.js','functions/[[path]].js','src/path-migration.js']){
    const source=fs.readFileSync(path.join(root,relative),'utf8');
    if(/from\s+['"][^'"]*image_editor|\/api\/image-editor\/|UPDATE\s+image_editor_documents|ensureImageEditorSchema/.test(source))throw new Error(`Retired editor dependency: ${relative}`);
}
for(const relative of ['src/image-serving.js','src/guest-api.js','src/path-utils.js']){
    if(!fs.readFileSync(path.join(root,relative),'utf8').includes("'__editor'"))throw new Error(`Internal editor path not protected: ${relative}`);
}
console.log(`Editor static checks passed: ${scripts.length} JavaScript files, three import bundles, CSS syntax, UTF-8 encoding, retired imports and internal asset paths.`);
