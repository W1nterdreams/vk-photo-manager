import { state } from "./state.js?v=20260920-uploadmenu02";
import { dom } from "./dom.js?v=20260920-uploadmenu02";
import { vkApi } from "./vk-api.js?v=20260920-uploadmenu02";
import { getErrorMessage, logError } from "./helpers.js?v=20260920-uploadmenu02";
import { getGroupId, getOwnerId } from "./group-context.js?v=20260920-uploadmenu02";
import { closeMenu } from "./main-menu.js?v=20260920-uploadmenu02";
import { loadPhotos } from "./photos.js?v=20260920-uploadmenu02";
import { renderAlbums } from "./albums.js?v=20260920-uploadmenu02";
import { cacheRemove, albumsKey } from "./cache.js?v=20260920-uploadmenu02";

let uploading = false;

function showError(message = "") {
    dom.uploadPhotoError.textContent = message;
    dom.uploadPhotoError.classList.toggle("hidden", !message);
}

function showProgress(message = "") {
    dom.uploadPhotoProgress.textContent = message;
    dom.uploadPhotoProgress.classList.toggle("hidden", !message);
}

function selectedFiles() {
    return Array.from(dom.uploadPhotoFiles?.files || []).filter(file =>
        !file.type || file.type.startsWith("image/")
    );
}

function updateSelection() {
    const files = selectedFiles();

    if (!files.length) {
        dom.uploadPhotoSelection.textContent = "Файлы не выбраны";
        dom.submitUploadPhoto.disabled = true;
        return;
    }

    const totalBytes = files.reduce((sum, file) => sum + Number(file.size || 0), 0);
    const totalMb = (totalBytes / 1024 / 1024).toFixed(totalBytes >= 10 * 1024 * 1024 ? 1 : 2);
    dom.uploadPhotoSelection.textContent = `${files.length} фото · ${totalMb} МБ`;
    dom.submitUploadPhoto.disabled = uploading;
}

function openModal() {
    closeMenu();

    const album = state.currentAlbum;
    if (!album || state.currentScreen !== "photos") return;

    dom.uploadPhotoAlbumName.textContent = album.title || "Альбом";
    dom.uploadPhotoFiles.value = "";
    dom.uploadPhotoCaption.value = "";
    dom.uploadPhotoSelection.textContent = "Файлы не выбраны";
    dom.submitUploadPhoto.disabled = true;
    showProgress("");
    showError("");
    dom.uploadPhotoModal.classList.remove("hidden");
}

function closeModal() {
    if (uploading) return;
    dom.uploadPhotoModal.classList.add("hidden");
    showProgress("");
    showError("");
}

function validateUploadResponse(data) {
    const server = data?.server;
    const photosList = data?.photos_list;
    const hash = data?.hash;

    if (server === undefined || server === null || !photosList || !hash) {
        const errorText = data?.error || data?.error_msg || "";
        throw new Error(
            errorText
                ? `Сервер загрузки VK: ${errorText}`
                : `Сервер загрузки VK вернул неожиданный ответ: ${JSON.stringify(data)}`
        );
    }

    return { server, photosList, hash };
}

async function postFileToUploadServer(uploadUrl, file) {
    const form = new FormData();
    form.append("file1", file, file.name || "photo.jpg");

    let response;
    try {
        response = await fetch(uploadUrl, {
            method: "POST",
            body: form,
            cache: "no-store"
        });
    } catch (error) {
        const wrapped = new Error(
            "Не удалось отправить файл на сервер загрузки VK. " +
            "Если ниже в консоли будет CORS/Failed to fetch, значит VK WebView запрещает прямой POST на upload_url."
        );
        wrapped.cause = error;
        throw wrapped;
    }

    const raw = await response.text();
    let data;

    try {
        data = raw ? JSON.parse(raw) : {};
    } catch {
        throw new Error(
            `Сервер загрузки VK вернул не JSON (HTTP ${response.status}): ${raw.slice(0, 240)}`
        );
    }

    if (!response.ok) {
        throw new Error(
            `Ошибка сервера загрузки VK: HTTP ${response.status} ${response.statusText || ""}. ` +
            (data?.error || data?.error_msg || "")
        );
    }

    return validateUploadResponse(data);
}

async function uploadOne(album, file, caption) {
    const groupId = getGroupId();

    const uploadServer = await vkApi("photos.getUploadServer", {
        group_id: groupId,
        album_id: Number(album.id)
    });

    if (!uploadServer?.upload_url) {
        throw new Error("VK не вернул upload_url для этого альбома.");
    }

    const uploaded = await postFileToUploadServer(uploadServer.upload_url, file);

    const params = {
        group_id: groupId,
        album_id: Number(album.id),
        server: uploaded.server,
        photos_list: uploaded.photosList,
        hash: uploaded.hash
    };

    if (caption) params.caption = caption;

    const saved = await vkApi("photos.save", params);
    const items = Array.isArray(saved) ? saved : [];

    if (!items.length) {
        throw new Error("VK принял файл, но photos.save не вернул сохранённую фотографию.");
    }

    return items;
}

async function refreshAfterUpload(album) {
    // Не оставляем старый счётчик альбома в localStorage. Текущий экран
    // перечитываем целиком с VK, после чего скрытый список карточек рендерим
    // уже с обновлённым size.
    cacheRemove(albumsKey(getOwnerId()));
    await loadPhotos(album, { force: true });
    renderAlbums();
}

async function uploadSelected() {
    if (uploading) return;

    const album = state.currentAlbum;
    if (!album || state.currentScreen !== "photos") {
        showError("Альбом больше не открыт. Вернитесь в альбом и повторите загрузку.");
        return;
    }

    const files = selectedFiles();
    if (!files.length) {
        showError("Выберите хотя бы одну фотографию.");
        return;
    }

    uploading = true;
    dom.submitUploadPhoto.disabled = true;
    dom.cancelUploadPhoto.disabled = true;
    dom.closeUploadPhoto.disabled = true;
    dom.uploadPhotoFiles.disabled = true;
    dom.uploadPhotoCaption.disabled = true;
    showError("");

    const caption = dom.uploadPhotoCaption.value.trim();
    let done = 0;

    try {
        // Намеренно грузим строго по одной фотографии. Так меньше шанс поймать
        // flood control и проще понять, на каком файле произошла ошибка.
        for (let i = 0; i < files.length; i += 1) {
            const file = files[i];
            showProgress(`Загрузка ${i + 1} из ${files.length}: ${file.name || "фото"}`);
            await uploadOne(album, file, caption);
            done += 1;
        }

        showProgress(`Готово: загружено ${done} из ${files.length}.`);
        await refreshAfterUpload(album);

        setTimeout(() => {
            if (!uploading) closeModal();
        }, 450);
    } catch (error) {
        logError("Загрузка фото:", error);
        const suffix = done > 0 ? ` До ошибки успешно загружено: ${done}.` : "";
        showError(getErrorMessage(error) + suffix);

        if (done > 0) {
            try {
                await refreshAfterUpload(album);
            } catch (refreshError) {
                console.warn("Не удалось обновить альбом после частичной загрузки:", refreshError);
            }
        }
    } finally {
        uploading = false;
        dom.cancelUploadPhoto.disabled = false;
        dom.closeUploadPhoto.disabled = false;
        dom.uploadPhotoFiles.disabled = false;
        dom.uploadPhotoCaption.disabled = false;
        updateSelection();
    }
}

export function initPhotoUpload() {
    dom.uploadPhotoMenuButton?.addEventListener("click", openModal);
    dom.uploadPhotoFiles?.addEventListener("change", () => {
        showError("");
        showProgress("");
        updateSelection();
    });
    dom.submitUploadPhoto?.addEventListener("click", () => void uploadSelected());
    dom.closeUploadPhoto?.addEventListener("click", closeModal);
    dom.cancelUploadPhoto?.addEventListener("click", closeModal);

    dom.uploadPhotoModal?.addEventListener("click", event => {
        if (event.target === dom.uploadPhotoModal) closeModal();
    });
}
