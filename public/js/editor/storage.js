import { uid } from './model.js?v=editor-rework-20261117a';
export async function api(path,options={},retry=0){
  const response=await fetch(`/api/editor/v2${path}`,{cache:'no-store',...options,headers:{'X-Editor-Protocol':'2',...options.headers}});
  const data=await response.json();if(response.status===423&&retry<8){await new Promise(resolve=>setTimeout(resolve,250*(retry+1)));return api(path,options,retry+1);}if(!response.ok)throw Object.assign(new Error(data.error||'작업 요청 실패'),data,{status:response.status});return data;
}
export function queryFor(engine,kind='saved',sessionId=''){
  return new URLSearchParams({projectId:engine.doc.projectId||'global',kind,...(kind==='autosave'?{sessionId}:{})}).toString();
}
export class Persistence{
  constructor(engine,status){
    this.engine=engine;this.status=status;this.sessionId=uid();this.autoRevision='0';this.autoStateId=engine.stateId;this.timer=null;this.active=null;this.pending=new Map();this.disposed=false;this.abort=new AbortController();
    this.onChange=()=>{if(this.disposed||this.suspended||this.temporaryUnavailable)return;clearTimeout(this.timer);this.timer=setTimeout(()=>void this.flush().catch(()=>{}),5000);};
    engine.addEventListener('document:changed',this.onChange);
  }
  url(action='',kind='saved',documentId=this.engine.doc.id,sessionId=this.sessionId){return `/documents/${documentId}${action}?${queryFor(this.engine,kind,sessionId)}`;}
  async flush(){
    if(this.disposed||this.suspended||this.temporaryUnavailable)return;
    if(this.engine.isEditing){this.status('편집 확정 후 임시 저장합니다.');if(!this.waitingIdle)this.waitingIdle=this.engine.whenIdle().then(()=>{this.waitingIdle=null;this.onChange();});return;}
    if(this.active){await this.active.catch(()=>{});return this.flush();}
    clearTimeout(this.timer);
    if(!this.engine.dirty){if(this.autoRevision!=='0')await this.discardAuto();return;}
    if(this.engine.stateId===this.autoStateId)return;
    return this.persist('autosave');
  }
  async save(name=this.engine.doc.title){
    await this.engine.whenIdle();if(this.disposed)throw new Error('닫힌 작업입니다.');
    if(this.pending.get('saved')?.expired)throw new Error('저장 요청이 만료되었거나 작업이 삭제되었습니다. 작업 목록을 확인하거나 다른 이름으로 저장하세요.');
    if(this.active){await this.active.catch(()=>{});return this.save(name);}
    const result=await this.persist('saved',name);if(this.engine.dirty||this.engine.doc.title!==name)return this.save(name);return result;
  }
  async saveAs(name){
    await this.engine.whenIdle();if(this.active)await this.active.catch(()=>{});
    const pending=this.pending.get('saved'),retryId=pending?.newId&&!pending.expired&&pending.body.document.title===name?pending.newId:null;
    if(!retryId)this.pending.delete('saved');return this.persist('saved',name,retryId||uid());
  }
  async persist(kind,name=null,newId=null){
    if(this.disposed)throw new Error('닫힌 작업입니다.');
    if(kind==='autosave'&&this.temporaryUnavailable)throw new Error('임시 저장이 중단되었습니다. 작업 목록을 확인한 뒤 작업 저장 또는 다른 이름으로 저장하세요.');
    if(this.active){await this.active.catch(()=>{});return kind==='autosave'?this.flush():this.persist(kind,name,newId);}
    clearTimeout(this.timer);
    this.active=this.run(kind,name,newId).finally(()=>this.active=null);
    return this.active;
  }
  async run(kind,name,newId){
    const e=this.engine,sourceId=e.doc.id,sourceState=e.stateId;
    this.status(kind==='saved'?'작업 저장 중…':'임시 저장 중…');
    let pending=this.pending.get(kind);
    try{
      if(!pending){
        const pack=await e.pack();if(this.disposed)throw new Error('닫힌 작업입니다.');
        if(name!==null)pack.document.title=String(name).trim()||'제목 없음';
        if(newId)pack.document.id=newId;
        const stateId=sourceState,body={document:pack.document,stateId,manualStateId:kind==='saved'?stateId:e.savedId,initialStateId:e.initialStateId,manualRevision:kind==='saved'&&newId?'0':String(e.revision||'0'),baseRevision:kind==='saved'?newId?'0':String(e.revision||'0'):this.autoRevision,requestId:uid()};
        pending={pack,body,sourceId,sourceState,kind,sessionId:this.sessionId,newId};this.pending.set(kind,pending);
      }
      const options={signal:this.abort.signal};
      if(!pending.ticketId){
        const result=await api(this.url('/prepare',kind,pending.body.document.id,pending.sessionId),{...options,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pending.body)});
        pending.ticketId=result.ticketId;pending.missing=result.missing;
      }
      for(const hash of pending.missing){
        const asset=pending.pack.blobs.find(a=>a.hash===hash);if(!asset)throw new Error('전송할 이미지가 없습니다.');
        await api(`/tickets/${pending.ticketId}/assets/${hash}?projectId=${encodeURIComponent(e.doc.projectId||'global')}`,{...options,method:'PUT',body:asset.blob});
      }
      const result=await api(`/tickets/${pending.ticketId}/commit?projectId=${encodeURIComponent(e.doc.projectId||'global')}`,{...options,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pending.body)});
      this.pending.delete(kind);
      if(kind==='saved'){
        const snapshot=pending.body.document;
        if(e.doc.id!==pending.sourceId)throw new Error('저장 중 작업 대상이 변경되었습니다. 저장 목록에서 결과를 확인하세요.');
        e.doc.id=snapshot.id;e.doc.title=snapshot.title;e.revision=result.revision;e.savedId=pending.sourceState;e.everSaved=true;
        await this.discardAuto(pending.sourceId).catch(()=>{});
        this.status(e.dirty?'작업 저장됨 · 새 변경 있음':'작업 저장됨');
      }else{this.autoRevision=result.revision;this.autoStateId=pending.sourceState;this.status('임시 저장됨 · 작업 저장 필요');}
      e.emit();
      if(e.stateId!==pending.sourceState){if(kind==='saved')return this.status('작업 저장됨 · 새 변경 있음');this.onChange();}
      return result;
    }catch(error){
      if(error.status===410){if(pending)pending.expired=true;if(kind==='autosave')this.temporaryUnavailable=true;}
      if([409,507].includes(error.status))this.pending.delete(kind);
      this.status(`${kind==='saved'?'작업 저장 실패':'임시 저장 실패'}: ${error.message}`);throw error;
    }
  }
  async discardAuto(documentId=this.engine.doc.id){
    const oldSession=this.sessionId;
    if(this.autoRevision!=='0'||this.pending.has('autosave'))await api(this.url('', 'autosave',documentId,oldSession),{method:'DELETE'});
    this.pending.delete('autosave');this.temporaryUnavailable=false;this.sessionId=uid();this.autoRevision='0';this.autoStateId=this.engine.stateId;
  }
  async open(row){
    const kind=row.kind||'saved',sessionId=row.sessionId||'';
    const result=await api(this.url('',kind,row.id,sessionId));
    await this.engine.hydrate(result.document,async(_,meta)=>{
      const response=await fetch(`/api/editor/v2/documents/${row.id}/assets/${meta.hash}?${queryFor({doc:result.document},kind,sessionId)}`,{cache:'no-store',signal:this.abort.signal});
      if(!response.ok)throw new Error('작업 이미지를 불러오지 못했습니다. 목록을 다시 연 뒤 시도하세요.');return response.blob();
    });
    const e=this.engine;e.stateId=result.stateId;e.initialStateId=result.initialStateId||result.stateId;
    e.savedId=kind==='saved'?result.stateId:result.manualStateId;e.everSaved=kind==='saved'||Boolean(result.manualRevision&&result.manualRevision!=='0');
    e.revision=kind==='saved'?result.revision:result.manualRevision||'0';
    if(kind==='autosave'){this.sessionId=sessionId;this.autoRevision=result.revision;this.autoStateId=e.stateId;}
    else{this.sessionId=uid();this.autoRevision='0';this.autoStateId=e.stateId;}
    this.status(kind==='saved'?'작업 불러옴':'저장하지 않은 편집을 이어갑니다.');e.emit();
  }
  stop(){this.disposed=true;clearTimeout(this.timer);this.abort.abort();this.engine.removeEventListener('document:changed',this.onChange);}
}
export function clearLegacyRecovery(notify=()=>{}){
  if(!('indexedDB' in window))return;
  // No recovery database is opened or used by this editor. Remove the retired one.
  const request=indexedDB.deleteDatabase('imggul-editor-workspace');
  request.onerror=()=>notify('이전 임시 저장소를 정리하지 못했습니다. 브라우저 사이트 데이터에서 imggul-editor-workspace를 삭제할 수 있습니다.');request.onblocked=()=>notify('이전 편집기가 열린 다른 탭을 닫으면 구 임시 저장소 정리가 완료됩니다.');
  try{localStorage.removeItem('imggul-editor-preset');localStorage.removeItem('imggul-editor-presets');}catch{}
}
