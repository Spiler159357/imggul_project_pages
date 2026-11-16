import { uid } from "./model.js";
import { decode } from "./bitmap.js";
async function api(path, options = {}) {
  const response = await fetch(`/api/editor${path}`, { cache: "no-store", ...options });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || "저장 요청 실패"), { status: response.status, ...data });
  return data;
}
let databasePromise;
function database() {
  if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
    const r = indexedDB.open("imggul-editor-workspace", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("recovery", { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => {
      databasePromise = null;
      reject(r.error);
    };
  });
  return databasePromise;
}
async function local(action, value) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("recovery", action === "put" || action === "delete" ? "readwrite" : "readonly"), s = tx.objectStore("recovery"), r = action === "list" ? s.getAll() : action === "put" ? s.put(value) : action === "delete" ? s.delete(value) : s.get(value);
    let result;
    r.onsuccess = () => {
      result = r.result;
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("복구 저장 중단"));
  });
}
class Persistence {
  constructor(engine, status) {
    this.engine = engine;
    this.status = status;
    this.timer = null;
    this.deadline = null;
    this.active = null;
    this.pending = null;
    this.uploaded = /* @__PURE__ */ new Set();
    this.disposed = false;
    this.onChange = () => {
      if (!engine.dirty || this.disposed || this.pending) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        void this.save().catch(() => {
        });
      }, 2e3);
      if (!this.deadline) this.deadline = setTimeout(() => {
        void this.save().catch(() => {
        });
      }, 15e3);
    };
    engine.addEventListener("change", this.onChange);
  }
  async save() {
    if (this.engine.isEditing) await new Promise((resolve) => {
      const done = () => {
        if (!this.engine.isEditing) {
          this.engine.removeEventListener("change", done);
          resolve();
        }
      };
      this.engine.addEventListener("change", done);
    });
    if (this.active) return this.active.then(() => this.engine.dirty ? this.save() : void 0);
    clearTimeout(this.timer);
    clearTimeout(this.deadline);
    this.deadline = null;
    this.active = this.run().finally(() => {
      this.active = null;
    });
    return this.active;
  }
  async run() {
    const e = this.engine, stateId = e.stateId, baseRevision = e.revision || "0";
    this.status("로컬 복구 저장 중");
    const pack = await e.pack();
    let localOk = false;
    const recovery = { id: e.doc.id, projectId: e.doc.projectId, title: pack.document.title, document: pack.document, blobs: pack.blobs, baseRevision, stateId, updatedAt: Date.now() };
    try {
      await local("put", recovery);
      localOk = true;
      this.status("로컬 복구됨 · 서버 저장 중");
    } catch (error) {
      this.status(`로컬 복구 실패 · 서버 저장 시도: ${error.message}`);
    }
    try {
      for (const a of pack.blobs) {
        if (this.uploaded.has(a.hash)) continue;
        const response = await fetch(`/api/editor/assets/${a.hash}`, { method: "PUT", body: a.blob });
        if (!response.ok) throw new Error((await response.json()).error || "자산 업로드 실패");
        this.uploaded.add(a.hash);
      }
      if (this.pending) throw new Error("이전 저장 요청을 재시도하거나 작업을 복제하세요.");
      const payload = JSON.stringify({ document: pack.document, baseRevision, requestId: uid() });
      this.pending = { payload, stateId };
      const result = await api(`/documents/${e.doc.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: payload });
      e.revision = result.revision;
      e.savedId = stateId;
      this.pending = null;
      recovery.baseRevision = result.revision;
      recovery.saved = true;
      await local("put", recovery).catch(() => {
      });
      this.status(e.dirty ? "저장됨 · 새 변경 대기" : "서버 저장됨");
      e.emit();
      return result;
    } catch (error) {
      this.status(`${error.status === 409 ? "저장 충돌" : "서버 저장 실패"} · ${localOk ? "로컬 복구본 유지" : "로컬 저장도 실패"}: ${error.message}`);
      throw error;
    }
  }
  async retry() {
    if (!this.pending) return this.save();
    const result = await api(`/documents/${this.engine.doc.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: this.pending.payload });
    this.engine.revision = result.revision;
    this.engine.savedId = this.pending.stateId;
    this.pending = null;
    this.status("서버 저장됨");
    this.engine.emit();
  }
  async open(id, revision = "") {
    const result = await api(`/documents/${id}${revision ? `?revision=${encodeURIComponent(revision)}` : ""}`);
    await this.engine.hydrate(result.document, async (_, meta) => {
      const r = await fetch(`/api/editor/assets/${meta.hash}`, { cache: "no-store" });
      if (!r.ok) throw new Error("저장된 자산을 열지 못했습니다.");
      this.uploaded.add(meta.hash);
      return r.blob();
    });
    this.engine.revision = result.revision;
    if (revision && revision !== result.revision) {
      this.engine.savedId = "";
      this.status("이전 버전 · 새 버전으로 저장 가능");
    } else this.status("서버 작업 열림");
  }
  async recover(id) {
    const result = await local("get", id);
    if (!result) throw new Error("복구본이 없습니다.");
    const blobs = new Map(result.blobs.map((a) => [a.id, a.blob]));
    await this.engine.hydrate(result.document, (assetId) => blobs.get(assetId));
    this.engine.revision = result.baseRevision;
    this.engine.savedId = result.saved ? this.engine.stateId : "";
    this.status("로컬 복구본 열림");
  }
  stop() {
    this.disposed = true;
    clearTimeout(this.timer);
    clearTimeout(this.deadline);
    this.engine.removeEventListener("change", this.onChange);
  }
}
export {
  Persistence,
  api,
  local
};
