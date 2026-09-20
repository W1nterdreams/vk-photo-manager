import { state } from "./state.js?v=20260920-albumtools03";
import { dom } from "./dom.js?v=20260920-albumtools03";
import { vkApi } from "./vk-api.js?v=20260920-albumtools03";
import { getErrorMessage } from "./helpers.js?v=20260920-albumtools03";
import { getOwnerId } from "./group-context.js?v=20260920-albumtools03";
import { cacheSet, cacheRemove, albumsKey, albumIndexKey } from "./cache.js?v=20260920-albumtools03";
import { renderAlbums, ensureAlbumIndex } from "./albums.js?v=20260920-albumtools03";

let activeAlbum = null;
let opening = false;
let saving = false;

function asFlag(value) {
    return value === true || value === 1 || value === "1";
}

function showError(message = "") {
    dom.editAlbumError.textContent = message;
    dom.editAlbumError.classList.toggle("hidden", !message);
}

function fillForm(album) {
    dom.editAlbumTitle.value = album?.title || "";
    dom.editAlbumDescription.value = album?.description || "";

    // В VK эти параметры обратные по смыслу нашим галочкам.
    dom.editAlbumAllowComments.checked = !asFlag(album?.comments_disabled);
    dom.editAlbumAllowUploads.checked = !asFlag(album?.upload_by_admins_only);
}

async function fetchFreshAlbum(album) {
    const ownerId = Number(album?.owner_id) || getOwnerId();
    const targetId = String(album.id);

    try {
        const result = await vkApi("photos.getAlbums", {
            owner_id: ownerId,
            album_ids: [Number(album.id)],
            need_system: 1,
            need_covers: 1,
            photo_sizes: 1
        });

        // VK может вернуть не только один элемент, поэтому выбираем
        // именно тот альбом, по которому открыли меню.
        const items = Array.isArray(result?.items) ? result.items : [];
        const fresh = items.find(item => String(item.id) === targetId);
        if (!fresh) return album;

        return {
            ...album,
            ...fresh
        };
    } catch (error) {
        console.warn("Не удалось обновить данные альбома перед редактированием:", error);
        return album;
    }
}

async function openModal(album) {
    if (!album || opening) return;

    opening = true;
    activeAlbum = album;
    showError("");
    dom.saveEditAlbum.disabled = true;
    dom.editAlbumModal.classList.remove("hidden");
    fillForm(album);

    try {
        const fresh = await fetchFreshAlbum(album);
        activeAlbum = fresh;
        fillForm(fresh);
    } finally {
        opening = false;
        dom.saveEditAlbum.disabled = false;
        requestAnimationFrame(() => dom.editAlbumTitle.focus());
    }
}

function closeModal() {
    if (saving) return;
    dom.editAlbumModal.classList.add("hidden");
    activeAlbum = null;
    showError("");
}

function replaceAlbumInState(updated) {
    state.albums = state.albums.map(album =>
        String(album.id) === String(updated.id)
            ? { ...album, ...updated }
            : album
    );

    state.albumIndex = state.albumIndex.map(album =>
        String(album.id) === String(updated.id)
            ? { ...album, ...updated }
            : album
    );

    if (state.currentAlbum && String(state.currentAlbum.id) === String(updated.id)) {
        state.currentAlbum = { ...state.currentAlbum, ...updated };

        if (state.currentScreen === "photos") {
            dom.pageTitle.textContent = updated.title || "Альбом";
            dom.albumTitle.textContent = updated.title || "Альбом";
            dom.albumDescription.textContent = updated.description || "";
        }
    }
}

function persistAlbumState() {
    const ownerId = getOwnerId();

    cacheSet(albumsKey(ownerId), {
        items: state.albums,
        total: state.albumsTotal
    });

    // Индекс поиска нельзя сохранять, если он ещё строится: иначе частичные
    // первые страницы превращаются в "полный" индекс на несколько минут.
    cacheRemove(albumIndexKey(ownerId));
    state.albumIndexReady = false;
}

async function saveAlbum(event) {
    event?.preventDefault?.();
    if (!activeAlbum || saving) return;

    const title = dom.editAlbumTitle.value.trim();
    const description = dom.editAlbumDescription.value.trim();
    const allowComments = dom.editAlbumAllowComments.checked;
    const allowUploads = dom.editAlbumAllowUploads.checked;

    if (!title) {
        showError("Введите название альбома.");
        dom.editAlbumTitle.focus();
        return;
    }

    saving = true;
    dom.saveEditAlbum.disabled = true;
    dom.cancelEditAlbum.disabled = true;
    dom.closeEditAlbum.disabled = true;
    showError("");

    const ownerId = Number(activeAlbum.owner_id) || getOwnerId();

    try {
        await vkApi("photos.editAlbum", {
            album_id: Number(activeAlbum.id),
            owner_id: ownerId,
            title,
            description,
            comments_disabled: allowComments ? 0 : 1,
            upload_by_admins_only: allowUploads ? 0 : 1
        });

        const updated = {
            ...activeAlbum,
            title,
            description,
            comments_disabled: allowComments ? 0 : 1,
            upload_by_admins_only: allowUploads ? 0 : 1
        };

        replaceAlbumInState(updated);
        persistAlbumState();
        renderAlbums();

        // Перестраиваем полный поисковый индекс с сервера. Это одновременно
        // защищает от гонки с фоновой индексацией, начатой до редактирования.
        void ensureAlbumIndex({ force: true });

        dom.editAlbumModal.classList.add("hidden");
        activeAlbum = null;
    } catch (error) {
        showError(getErrorMessage(error));
    } finally {
        saving = false;
        dom.saveEditAlbum.disabled = false;
        dom.cancelEditAlbum.disabled = false;
        dom.closeEditAlbum.disabled = false;
    }
}

export function initAlbumEdit() {
    window.addEventListener("album-menu-action", event => {
        if (event?.detail?.action !== "edit") return;
        void openModal(event.detail.album);
    });

    dom.editAlbumForm.addEventListener("submit", saveAlbum);
    dom.closeEditAlbum.addEventListener("click", closeModal);
    dom.cancelEditAlbum.addEventListener("click", closeModal);

    dom.editAlbumModal.addEventListener("click", event => {
        if (event.target === dom.editAlbumModal) closeModal();
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !dom.editAlbumModal.classList.contains("hidden")) {
            closeModal();
        }
    });
}
