import { state } from "./state.js?v=20260920-albumtools04";
import { vkApi } from "./vk-api.js?v=20260920-albumtools04";
import { ensureAlbumIndex } from "./albums.js?v=20260920-albumtools04";
import { getBestPhotoUrl, getErrorMessage } from "./helpers.js?v=20260920-albumtools04";
import { getOwnerId } from "./group-context.js?v=20260920-albumtools04";
import {
    invalidateAlbumCaches,
    invalidateAlbumPhotosCache
} from "./cache.js?v=20260920-albumtools04";
import { openVkTarget, openVkPhoto } from "./vk-links.js?v=20260920-albumtools04";

let overlay = null;
let list = null;
let search = null;
let title = null;
let hint = null;
let errorBox = null;
let activePhoto = null;
let mode = "move";
let busy = false;
let allAlbums = [];

function create(tag, className = "", text = "") {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
}

function installStyles() {
    if (document.getElementById("photoTransferStyles")) return;

    const style = document.createElement("style");
    style.id = "photoTransferStyles";
    style.textContent = `
        .photo-transfer-modal { width: min(520px, 100%); }
        .photo-transfer-hint { margin: -4px 0 12px; color: #aeb4b9; font-size: 13px; line-height: 1.4; }
        .photo-transfer-search { margin-bottom: 10px; }
        .photo-transfer-list { max-height: min(58vh, 580px); overflow-y: auto; overscroll-behavior: contain; }
        .photo-transfer-album { display: flex; width: 100%; min-height: 48px; padding: 10px 12px; border: 0; border-bottom: 1px solid #34393e; background: transparent; color: #eef0f2; text-align: left; align-items: center; gap: 10px; cursor: pointer; }
        .photo-transfer-album:hover, .photo-transfer-album:active { background: #2b3035; }
        .photo-transfer-name { flex: 1; min-width: 0; word-break: break-word; }
        .photo-transfer-count { flex: 0 0 auto; color: #8f979e; font-size: 12px; }
        .photo-transfer-loading { padding: 22px 10px; color: #aeb4b9; text-align: center; }
        .photo-transfer-native-note { margin-top: 10px; color: #9da5ab; font-size: 12px; line-height: 1.4; }
    `;
    document.head.appendChild(style);
}

function ensureModal() {
    if (overlay) return;
    installStyles();

    overlay = create("div", "modal-overlay hidden");
    const modal = create("div", "modal photo-transfer-modal");

    const header = create("div", "modal-header");
    title = create("div", "modal-title", "Переместить в альбом");
    const close = create("button", "modal-close", "×");
    close.type = "button";
    close.addEventListener("click", closeModal);
    header.append(title, close);

    hint = create("div", "photo-transfer-hint");

    search = create("input", "form-input photo-transfer-search");
    search.type = "search";
    search.placeholder = "Найти альбом...";
    search.autocomplete = "off";
    search.addEventListener("input", renderAlbums);

    list = create("div", "photo-transfer-list");
    errorBox = create("div", "form-error hidden");

    const actions = create("div", "modal-actions");
    const cancel = create("button", "secondary-button", "Отмена");
    cancel.type = "button";
    cancel.addEventListener("click", closeModal);
    actions.appendChild(cancel);

    modal.append(header, hint, search, list, errorBox, actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    overlay.addEventListener("click", event => {
        if (event.target === overlay) closeModal();
    });
}

function showError(message = "") {
    errorBox.textContent = message;
    errorBox.classList.toggle("hidden", !message);
}

function normalize(value) {
    return String(value || "").trim().toLocaleLowerCase("ru");
}

function candidateAlbums() {
    const sourceId = String(activePhoto?.album_id || state.currentAlbum?.id || "");
    const q = normalize(search?.value);

    return allAlbums.filter(album => {
        if (String(album.id) === sourceId) return false;
        if (Number(album.id) <= 0) return false;
        return !q || normalize(album.title).includes(q);
    });
}

function renderAlbums() {
    if (!list) return;
    list.innerHTML = "";

    const albums = candidateAlbums();
    if (!albums.length) {
        list.innerHTML = '<div class="photo-transfer-loading">Подходящие альбомы не найдены.</div>';
        return;
    }

    for (const album of albums) {
        const button = create("button", "photo-transfer-album");
        button.type = "button";

        const name = create("span", "photo-transfer-name", album.title || "Без названия");
        const count = create("span", "photo-transfer-count", `${Number(album.size || 0)} фото`);
        button.append(name, count);
        button.addEventListener("click", () => void chooseAlbum(album, button));
        list.appendChild(button);
    }
}

function closeModal() {
    if (!overlay || busy) return;
    overlay.classList.add("hidden");
    activePhoto = null;
    allAlbums = [];
    search.value = "";
    showError("");
}

function updateAlbumSizes(sourceAlbumId, targetAlbumId) {
    const update = album => {
        const id = Number(album.id);
        if (id === Number(sourceAlbumId)) {
            return { ...album, size: Math.max(0, Number(album.size || 0) - 1) };
        }
        if (id === Number(targetAlbumId)) {
            return { ...album, size: Number(album.size || 0) + 1 };
        }
        return album;
    };

    state.albums = state.albums.map(update);
    state.albumIndex = state.albumIndex.map(update);

    if (state.currentAlbum && Number(state.currentAlbum.id) === Number(sourceAlbumId)) {
        state.currentAlbum = update(state.currentAlbum);
    }
}

async function movePhoto(album) {
    const photo = activePhoto;
    const ownerId = Number(photo?.owner_id || getOwnerId());
    const sourceAlbumId = Number(photo?.album_id || state.currentAlbum?.id || 0);

    const response = await vkApi("photos.move", {
        owner_id: ownerId,
        target_album_id: Number(album.id),
        photo_id: Number(photo.id)
    });

    if (response !== 1 && response !== true) {
        throw new Error("VK не подтвердил перемещение фотографии.");
    }

    invalidateAlbumPhotosCache(ownerId, sourceAlbumId);
    invalidateAlbumPhotosCache(ownerId, Number(album.id));
    invalidateAlbumCaches(ownerId);
    updateAlbumSizes(sourceAlbumId, Number(album.id));

    // На исходном экране альбома сразу убираем перемещённое фото.
    state.photos = state.photos.filter(item => Number(item.id) !== Number(photo.id));
    state.photosTotal = Math.max(0, Number(state.photosTotal || 0) - 1);

    overlay.classList.add("hidden");
    busy = false;

    // Возвращаемся туда, откуда была открыта фотография.
    history.back();
}

async function downloadForNativeCopy(photo) {
    const url = getBestPhotoUrl(photo);
    if (!url) throw new Error("У фотографии нет ссылки на оригинал.");

    if (window.vkBridge?.send) {
        const result = await window.vkBridge.send("VKWebAppDownloadFile", {
            url,
            filename: `vk-photo-${Number(photo.id)}.jpg`
        });
        if (result?.result === true || result === true) return true;
    }

    throw new Error("Нативное скачивание файла недоступно на этом устройстве.");
}

async function copyPhotoNative(album) {
    const photo = activePhoto;
    const ownerId = Number(photo?.owner_id || getOwnerId());

    // В актуальном Photos API photos.copy копирует только в «Сохранённые фото»,
    // а не в произвольный альбом сообщества. Поэтому сохраняем файл на устройство
    // и сразу открываем выбранный альбом VK в режиме добавления фотографии.
    await downloadForNativeCopy(photo);

    invalidateAlbumPhotosCache(ownerId, Number(album.id));
    invalidateAlbumCaches(ownerId);

    overlay.classList.add("hidden");
    busy = false;

    const url = `https://vk.com/album${ownerId}_${Number(album.id)}?act=add`;
    openVkTarget(url, {
        type: "photo-copy-target",
        ownerId,
        albumId: Number(album.id),
        photoId: Number(photo.id)
    });
}

async function chooseAlbum(album, button) {
    if (busy || !activePhoto) return;

    busy = true;
    showError("");
    const oldText = button.textContent;
    button.disabled = true;
    button.textContent = mode === "move" ? "Перемещаем..." : "Подготавливаем копию...";

    try {
        if (mode === "move") {
            await movePhoto(album);
        } else {
            await copyPhotoNative(album);
        }
    } catch (error) {
        busy = false;
        button.disabled = false;
        button.textContent = oldText;
        showError(getErrorMessage(error));

        if (mode === "move") {
            const msg = getErrorMessage(error);
            if (/denied|permission|unknown method|недоступ|запрещ/i.test(msg)) {
                const goNative = confirm(`${msg}\n\nОткрыть фотографию в VK и выполнить действие штатно?`);
                if (goNative) openVkPhoto(activePhoto, Number(activePhoto?.owner_id || getOwnerId()));
            }
        }
    }
}

export async function openPhotoTransfer(photo, requestedMode = "move") {
    if (!photo?.id) return;
    ensureModal();

    activePhoto = photo;
    mode = requestedMode === "copy" ? "copy" : "move";
    busy = false;
    search.value = "";
    showError("");

    title.textContent = mode === "move" ? "Переместить в альбом" : "Копировать в альбом";
    hint.textContent = mode === "move"
        ? "Выберите альбом, куда нужно перенести фотографию."
        : "Выберите альбом. Фото будет скачано на устройство, затем откроется этот альбом в VK для штатной загрузки копии.";

    list.innerHTML = '<div class="photo-transfer-loading">Загружаем список альбомов...</div>';
    overlay.classList.remove("hidden");

    try {
        const indexed = await ensureAlbumIndex();
        allAlbums = Array.isArray(indexed) && indexed.length ? indexed : state.albumIndex;
        renderAlbums();
        requestAnimationFrame(() => search.focus());
    } catch (error) {
        showError(getErrorMessage(error));
        list.innerHTML = "";
    }
}

export function initPhotoTransfer() {
    ensureModal();

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && overlay && !overlay.classList.contains("hidden")) {
            closeModal();
        }
    });

    window.addEventListener("vk-native-return", event => {
        const detail = event?.detail;
        if (detail?.type !== "photo-copy-target") return;
        invalidateAlbumPhotosCache(Number(detail.ownerId || getOwnerId()), Number(detail.albumId || 0));
        invalidateAlbumCaches(Number(detail.ownerId || getOwnerId()));
    });
}
