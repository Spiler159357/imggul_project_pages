import { mountEditor } from "./workspace.js";
function renderEditorWorkspace(options = {}) {
  const root = document.getElementById(options.rootId || "project-image-editor-content");
  if (!root) return;
  return mountEditor(root, options);
}
function openImageEditorForKey(sourceKey = "") {
  if (!/\.(png|jpe?g|webp)$/i.test(sourceKey)) {
    alert("PNG, JPEG, WebP 이미지를 선택하세요.");
    return;
  }
  window.closeModal?.();
  window.PROJECT_IMAGE_EDITOR_NEXT_OPTIONS = { sourceKey };
  const project = (window.PROJECTS || []).filter((p) => p.prefix && sourceKey.startsWith(p.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0];
  window.switchTab?.("project", true);
  if (project) {
    window.PROJECT_ACTIVE_PROJECT_ID = project.id;
    void window.openProjectDetail(project.id, true).then(() => window.openProjectSection("image-editor"));
  } else window.openProjectSection?.("image-editor");
}
export {
  openImageEditorForKey,
  renderEditorWorkspace
};
