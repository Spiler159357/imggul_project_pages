import { createSelectionCard } from './selection-ui.js?v=selection-ui-20261106a';

// URL policy, filtering and selection actions stay with the caller.
export function createAssetParentCard(onClick) {
    const card = createSelectionCard({ title: '상위 폴더', placeholder: '↰' });
    card.onclick = onClick;
    return card;
}

export function createAssetFolderCard({ folderName, alias, image = '', onClick }) {
    const card = createSelectionCard({ title: alias || folderName, subtitle: alias ? folderName : '', image, placeholder: '폴더', badge: '열기' });
    card.onclick = onClick;
    return card;
}

export function createAssetImageCard({ fileName, alias, fileUrl, onClick }) {
    const card = createSelectionCard({ title: alias || fileName, subtitle: alias ? fileName : '', image: fileUrl });
    card.onclick = onClick;
    return card;
}
