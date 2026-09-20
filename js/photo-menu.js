import { state } from "./state.js?v=20260920-albumtools07";
import { dom } from "./dom.js?v=20260920-albumtools07";
import { vkApi } from "./vk-api.js?v=20260920-albumtools07";
import { getBestPhotoUrl, getErrorMessage } from "./helpers.js?v=20260920-albumtools07";
import { getOwnerId } from "./group-context.js?v=20260920-albumtools07";
import { invalidateAlbumPhotosCache } from "./cache.js?v=20260920-albumtools07";
import { closeMenu } from "./main-menu.js?v=20260920-albumtools07";
import { openPhotoTransfer } from "./photo-transfer.js?v=20260920-albumtools07";
import { openPhotoReorder } from "./photo-reorder.js?v=20260920-albumtools07";
import { openVkPhoto } from "./vk-links.js?v=20260920-albumtools07";
import { openSwipeOverlay, closeSwipeOverlay } from "./overlay-history.js?v=20260920-albumtools07";

let editOverlay = null;
let editInput = null;
let editError = null;
let editSave = null;
let editing = false;

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

function openEditModal() {
    const photo = currentPhoto();
    if (!photo) return;

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
}

function closeEditModal() {
    if (!editOverlay || editing) return Promise.resolve(false);
    return closeSwipeOverlay("edit-photo-description");
}

function updatePhotoEverywhere(updated) {
    state.currentPhoto = updated;
    state.photos = state.photos.map(photo =>
        Number(photo.id) === Number(updated.id) ? { ...photo, ...updated } : photo
    );

    const text = String(updated.text || "");
    dom.photoViewerDescription.textContent = text;
    dom.photoViewerDescription.classList.toggle("hidden", !text.trim());

    window.dispatchEvent(new CustomEvent("photo-data-updated", {
        detail: { photo: updated }
    }));
}

async function saveDescription() {
    const photo = currentPhoto();
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
    await closeMenu();
    openEditModal();
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

export function initPhotoMenu() {
    ensureEditModal();

    dom.downloadPhotoMenuButton?.addEventListener("click", () => void onDownload());
    dom.editPhotoDescriptionMenuButton?.addEventListener("click", () => void onEdit());
    dom.copyPhotoMenuButton?.addEventListener("click", () => void onCopy());
    dom.movePhotoMenuButton?.addEventListener("click", () => void onMove());
    dom.reorderPhotoMenuButton?.addEventListener("click", () => void onReorder());

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && editOverlay && !editOverlay.classList.contains("hidden")) {
            void closeEditModal();
        }
    });
}
