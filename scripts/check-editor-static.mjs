import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { build, transformSync } from 'esbuild';

// Syntax/import/encoding checks only. This never opens a browser or calls an API.
const root=path.resolve(import.meta.dirname,'..');
const frontend=fs.readdirSync(path.join(root,'public/js/editor')).filter(name=>name.endsWith('.js')).map(name=>`public/js/editor/${name}`);
const scripts=[...frontend,'src/editor/api.js','src/editor/r2-store.js','src/editor/maintenance.js','functions/[[path]].js','src/path-migration.js','src/path-utils.js','src/image-serving.js','src/guest-api.js','public/js/main.js','public/js/project.js','public/js/project/manage.js'];
const textFiles=[...scripts,'public/editor.css','public/style.css','public/app.html','migrations/0027_editor_workspace.sql','migrations/0028_remove_editor_database.sql','wrangler.editor-maintenance.toml'];
for(const relative of textFiles){
    const file=path.join(root,relative),bytes=fs.readFileSync(file);
    if(bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf)throw new Error(`UTF-8 BOM: ${relative}`);
    new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
for(const relative of scripts){
    const result=spawnSync(process.execPath,['--check',path.join(root,relative)],{encoding:'utf8'});
    if(result.status!==0)throw new Error(`${relative}\n${result.stderr||result.error}`);
}
for(const [entry,platform]of [['public/js/editor/index.js','browser'],['public/js/editor/subject-worker.js','browser'],['src/editor/api.js','neutral'],['src/editor/maintenance.js','neutral'],['functions/[[path]].js','neutral']]){
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
const runtimeDdl=/\b(?:CREATE|ALTER|DROP)\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|VIEW|TRIGGER)\b|\b(?:ATTACH|DETACH|VACUUM|PRAGMA)\b/i;
const editorApi=fs.readFileSync(path.join(root,'src/editor/api.js'),'utf8');
if(runtimeDdl.test(editorApi)||/\bensureJsonDbSchema\s*\(/.test(editorApi))throw new Error('Editor request handler contains runtime schema changes.');
const router=fs.readFileSync(path.join(root,'functions/[[path]].js'),'utf8');
if(!router.includes('handleEditorApi(request, { bucket: env.imgBucket }, isAdmin)'))throw new Error('Editor must receive only the R2 capability.');
for(const relative of ['src/editor/api.js','src/editor/r2-store.js','src/editor/maintenance.js',...frontend]){
    const source=fs.readFileSync(path.join(root,relative),'utf8');
    if(/\benv\.DB\b|\bcapabilities\.DB\b|\bensureJsonDbSchema\s*\(|\bindexedDB\.open\s*\(|InpaintSession|from\s+['"][^'"]*\/ai\.js/.test(source))throw new Error(`Retired editor storage/AI dependency: ${relative}`);
}
if(fs.existsSync(path.join(root,'public/js/editor/ai.js')))throw new Error('Editor AI module still exists.');
if(/async function (readFileMetadata|putFileMetadataForKey)\(/.test(router))throw new Error('Retired editor DB metadata callbacks remain.');
const migration=fs.readFileSync(path.join(root,'migrations/0028_remove_editor_database.sql'),'utf8');
for(const table of ['editor_workspace_documents','editor_workspace_revisions','image_editor_documents','image_editor_revisions'])if(!migration.includes(`DROP TABLE IF EXISTS ${table};`))throw new Error(`Missing editor cleanup: ${table}`);
console.log(`Editor static checks passed: ${scripts.length} JavaScript files, five import bundles, CSS syntax, UTF-8 encoding, retired imports, private asset paths and R2-only editor boundaries.`);
