import { state } from "./state.js?v=20260920-albumtools08";
import { dom } from "./dom.js?v=20260920-albumtools08";
import { vkApi } from "./vk-api.js?v=20260920-albumtools08";
import { getBestPhotoUrl, getErrorMessage } from "./helpers.js?v=20260920-albumtools08";
import { getOwnerId } from "./group-context.js?v=20260920-albumtools08";
import {
    invalidateAlbumPhotosCache,
    invalidateAlbumCaches
} from "./cache.js?v=20260920-albumtools08";
import { closeMenu } from "./main-menu.js?v=20260920-albumtools08";
import { openPhotoTransfer } from "./photo-transfer.js?v=20260920-albumtools08";
import { openPhotoReorder } from "./photo-reorder.js?v=20260920-albumtools08";
import { openVkPhoto } from "./vk-links.js?v=20260920-albumtools08";
import { openSwipeOverlay, closeSwipeOverlay } from "./overlay-history.js?v=20260920-albumtools08";

let editOverlay = null;
let editInput = null;
let editError = null;
let editSave = null;
let editing = false;
let editTargetPhoto = null;
let deleting = false;

function currentPhoto() {
    return state.currentScreen === "photo" ? state.currentPhoto : null;
}

function fileNameForPhoto(photo) {
    return `vk-photo-${Number(photo?.id || Date.now())}.jpg`;
}

export async function downloadPhotoFile(photo, { quiet = false } = {}) {
    const url = getBestPhotoUrl(photo);
    if (!url) throw new Error("У фотографии нет ссылки на оригинал.");

    try {
        if (window.vkBridge?.send) {
            const result = await window.vkBridge.send("VKWebAppDownloadFile", {
                url,
                filename: fileNameForPhoto(photo)
            });
            if (result?.result === true || result === true) return true;
        }
    } catch (error) {
        console.warn("VKWebAppDownloadFile недоступен, используем браузер:", error);
    }

    try {
        const link = document.createElement("a");
        link.href = url;
        link.download = fileNameForPhoto(photo);
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        document.body.appendChild(link);
        link.click();
        link.remove();
        return true;
    } catch (error) {
        if (!quiet) throw error;
        return false;
    }
}

function ensureEditModal() {
    if (editOverlay) return;

    editOverlay = document.createElement("div");
    editOverlay.className = "modal-overlay hidden";
    editOverlay.id = "editPhotoDescriptionModal";

    const modal = document.createElement("div");
    modal.className = "modal";

    const header = document.createElement("div");
    header.className = "modal-header";

    const title = document.createElement("div");
    title.className = "modal-title";
    title.textContent = "Описание фотографии";

    const close = document.createElement("button");
    close.type = "button";
    close.className = "modal-close";
    close.textContent = "×";
    close.addEventListener("click", () => void closeEditModal());
    header.append(title, close);

    const label = document.createElement("label");
    label.className = "form-label";
    label.textContent = "Описание";

    editInput = document.createElement("textarea");
    editInput.className = "form-textarea";
    editInput.maxLength = 1000;
    editInput.rows = 6;

    editError = document.createElement("div");
    editError.className = "form-error hidden";

    const actions = document.createElement("div");
    actions.className = "modal-actions";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "secondary-button";
    cancel.textContent = "Отмена";
    cancel.addEventListener("click", () => void closeEditModal());

    editSave = document.createElement("button");
    editSave.type = "button";
    editSave.className = "primary-button";
    editSave.textContent = "Сохранить";
    editSave.addEventListener("click", () => void saveDescription());

    actions.append(cancel, editSave);
    modal.append(header, label, editInput, editError, actions);
    editOverlay.appendChild(modal);
    document.body.appendChild(editOverlay);

    editOverlay.addEventListener("click", event => {
        if (event.target === editOverlay) void closeEditModal();
    });
}

function showEditError(message = "") {
    if (!editError) return;
    editError.textContent = message;
    editError.classList.toggle("hidden", !message);
}

export function openPhotoDescriptionEditor(photo) {
    if (!photo?.id) return;

    editTargetPhoto = photo;
    ensureEditModal();
    showEditError("");
    editInput.value = String(photo.text || "");
    editOverlay.classList.remove("hidden");
    openSwipeOverlay("edit-photo-description", hideEditModalDirect);
    requestAnimationFrame(() => editInput.focus());
}

function hideEditModalDirect() {
    if (!editOverlay) return;
    editOverlay.classList.add("hidden");
    showEditError("");
    editTargetPhoto = null;
}

function closeEditModal() {
    if (!editOverlay || editing) return Promise.resolve(false);
    return closeSwipeOverlay("edit-photo-description");
}

function updatePhotoEverywhere(updated) {
    state.photos = state.photos.map(photo =>
        Number(photo.id) === Number(updated.id) ? { ...photo, ...updated } : photo
    );

    if (state.currentPhoto && Number(state.currentPhoto.id) === Number(updated.id)) {
        state.currentPhoto = { ...state.currentPhoto, ...updated };

        const text = String(updated.text || "");
        dom.photoViewerDescription.textContent = text;
        dom.photoViewerDescription.classList.toggle("hidden", !text.trim());
    }

    window.dispatchEvent(new CustomEvent("photo-data-updated", {
        detail: { photo: updated }
    }));
}

async function saveDescription() {
    const photo = editTargetPhoto || currentPhoto();
    if (!photo || editing) return;

    editing = true;
    editSave.disabled = true;
    editSave.textContent = "Сохраняем...";
    showEditError("");

    const caption = editInput.value.trim();
    const ownerId = Number(photo.owner_id || getOwnerId());
    const albumId = Number(photo.album_id || state.currentAlbum?.id || 0);

    try {
        const response = await vkApi("photos.edit", {
            owner_id: ownerId,
            photo_id: Number(photo.id),
            caption
        });

        if (response !== 1 && response !== true) {
            throw new Error("VK не подтвердил изменение описания.");
        }

        const updated = { ...photo, text: caption };
        updatePhotoEverywhere(updated);
        invalidateAlbumPhotosCache(ownerId, albumId);
        await closeSwipeOverlay("edit-photo-description");
    } catch (error) {
        showEditError(getErrorMessage(error));
    } finally {
        editing = false;
        editSave.disabled = false;
        editSave.textContent = "Сохранить";
    }
}

async function onDownload() {
    const photo = currentPhoto();
    if (!photo) return;
    await closeMenu();

    try {
        await downloadPhotoFile(photo);
    } catch (error) {
        alert(`Не удалось скачать фотографию.\n\n${getErrorMessage(error)}`);
    }
}

async function onEdit() {
    const photo = currentPhoto();
    if (!photo) return;
    await closeMenu();
    openPhotoDescriptionEditor(photo);
}

async function onCopy() {
    const photo = currentPhoto();
    if (!photo) return;
    await closeMenu();
    void openPhotoTransfer(photo, "copy");
}

async function onMove() {
    const photo = currentPhoto();
    if (!photo) return;
    await closeMenu();
    void openPhotoTransfer(photo, "move");
}

async function onReorder() {
    const photo = currentPhoto();
    if (!photo) return;
    await closeMenu();
    void openPhotoReorder(photo);
}


function removePhotoFromLocalState(photo) {
    const photoId = Number(photo?.id || 0);
    const albumId = Number(photo?.album_id || state.currentAlbum?.id || 0);
    const ownerId = Number(photo?.owner_id || state.currentAlbum?.owner_id || getOwnerId());
    if (!photoId) return;

    const beforeLength = state.photos.length;
    state.photos = state.photos.filter(item => Number(item.id) !== photoId);
    const removedFromLoaded = state.photos.length < beforeLength;

    if (removedFromLoaded || Number(state.photosTotal || 0) > 0) {
        state.photosTotal = Math.max(0, Number(state.photosTotal || state.currentAlbum?.size || 1) - 1);
    }
    state.photosOffset = Math.min(Number(state.photosOffset || 0), state.photos.length);

    const updateAlbum = album => {
        if (Number(album?.id || 0) !== albumId) return album;
        return { ...album, size: Math.max(0, Number(album.size || 1) - 1) };
    };

    state.albums = state.albums.map(updateAlbum);
    state.albumIndex = state.albumIndex.map(updateAlbum);

    if (state.currentAlbum && Number(state.currentAlbum.id) === albumId) {
        state.currentAlbum = updateAlbum(state.currentAlbum);
        dom.photoCount.textContent = `${Math.max(0, Number(state.photosTotal || state.currentAlbum.size || 0))} фото`;
    }

    if (state.currentPhoto && Number(state.currentPhoto.id) === photoId) {
        state.currentPhoto = null;
    }

    document.querySelector(`.photo-card[data-photo-id="${photoId}"]`)?.remove();

    invalidateAlbumPhotosCache(ownerId, albumId);
    invalidateAlbumCaches(ownerId);

    window.dispatchEvent(new CustomEvent("photo-deleted", {
        detail: { photoId, albumId, ownerId }
    }));
}

export async function deletePhoto(photo, { returnFromViewer = false } = {}) {
    if (!photo?.id || deleting) return false;
    if (!confirm("Удалить фотографию? Это действие нельзя отменить.")) return false;

    deleting = true;
    const ownerId = Number(photo.owner_id || getOwnerId());

    try {
        const response = await vkApi("photos.delete", {
            owner_id: ownerId,
            photo_id: Number(photo.id)
        });

        if (response !== 1 && response !== true) {
            throw new Error("VK не подтвердил удаление фотографии.");
        }

        removePhotoFromLocalState(photo);

        if (returnFromViewer) {
            state.suppressPhotoOpenUntil = Date.now() + 700;
            history.back();
        }
        return true;
    } catch (error) {
        alert(`Не удалось удалить фотографию.\n\n${getErrorMessage(error)}`);
        return false;
    } finally {
        deleting = false;
    }
}

async function onDelete() {
    const photo = currentPhoto();
    if (!photo) return;
    await closeMenu();
    await deletePhoto(photo, { returnFromViewer: true });
}

export function initPhotoMenu() {
    ensureEditModal();

    dom.downloadPhotoMenuButton?.addEventListener("click", () => void onDownload());
    dom.editPhotoDescriptionMenuButton?.addEventListener("click", () => void onEdit());
    dom.copyPhotoMenuButton?.addEventListener("click", () => void onCopy());
    dom.movePhotoMenuButton?.addEventListener("click", () => void onMove());
    dom.reorderPhotoMenuButton?.addEventListener("click", () => void onReorder());
    dom.deletePhotoMenuButton?.addEventListener("click", () => void onDelete());

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && editOverlay && !editOverlay.classList.contains("hidden")) {
            void closeEditModal();
        }
    });
}
