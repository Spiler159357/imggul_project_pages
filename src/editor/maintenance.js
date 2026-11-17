import { ROOT, cleanupProject, objectJson, putJson } from './r2-store.js';

// Dedicated R2-only Worker. No D1 binding or request-time DDL.
export default {
  async scheduled(event,env){
    const bucket=env.imgBucket,cursorKey=`${ROOT}maintenance/cursor.json`;
    const previous=await objectJson(bucket,cursorKey);
    const page=await bucket.list({prefix:ROOT,delimiter:'/',limit:2,...(previous?.data.cursor?{cursor:previous.data.cursor}:{})});
    for(const prefix of page.delimitedPrefixes){
      const projectId=prefix.slice(ROOT.length,-1);
      if(['maintenance','output-metadata','output-backups','output-operations'].includes(projectId))continue;
      try{await cleanupProject(bucket,projectId);}catch(error){console.error('Editor R2 cleanup failed',{projectId,message:error.message});}
    }
    await putJson(bucket,cursorKey,{cursor:page.truncated?page.cursor:null});
    // Output repair receipts hold metadata only; completed image bytes stay in their project folder.
    const operations=await bucket.list({prefix:`${ROOT}output-operations/`,limit:20});
    for(const object of operations.objects)if(object.uploaded.getTime()+7*86400000<Date.now())await bucket.delete(object.key);
  },
  fetch(){return new Response('Not Found',{status:404});}
};
