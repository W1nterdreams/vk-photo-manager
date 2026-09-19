import { state } from "./state.js?v=20260919-merge01";
import { dom } from "./dom.js?v=20260919-merge01";
import { vkApi } from "./vk-api.js?v=20260919-merge01";
import { getErrorMessage } from "./helpers.js?v=20260919-merge01";
import { loadAlbums } from "./albums.js?v=20260919-merge01";
import { closeMenu } from "./main-menu.js?v=20260919-merge01";
import { getGroupId, getOwnerId } from "./group-context.js?v=20260919-merge01";
import { cacheRemove } from "./cache.js?v=20260919-merge01";
import { albumsKey } from "./cache.js?v=20260919-merge01";

function openModal() {
    closeMenu();
    dom.newAlbumTitle.value = "";
    dom.newAlbumDescription.value = "";
    dom.createAlbumError.textContent = "";
    dom.createAlbumModal.classList.remove("hidden");
    dom.newAlbumTitle.focus();
}

function closeModal() {
    dom.createAlbumModal.classList.add("hidden");
    dom.createAlbumError.textContent = "";
}

async function createAlbum() {
    const title = dom.newAlbumTitle.value.trim();
    const description = dom.newAlbumDescription.value.trim();

    if (!title) {
        dom.createAlbumError.textContent = "Введите название альбома.";
        return;
    }

    dom.submitCreateAlbum.disabled = true;
    dom.createAlbumError.textContent = "";

    try {
        await vkApi("photos.createAlbum", {
            title,
            description,
            group_id: getGroupId(),
            comments_disabled: 0
        });

        cacheRemove(albumsKey(getOwnerId()));
        closeModal();
        await loadAlbums({ force: true });
    } catch (error) {
        dom.createAlbumError.textContent = getErrorMessage(error);
    } finally {
        dom.submitCreateAlbum.disabled = false;
    }
}

export function initAlbumCreate() {
    dom.createAlbumMenuButton.addEventListener("click", openModal);
    dom.closeCreateAlbum.addEventListener("click", closeModal);
    dom.cancelCreateAlbum.addEventListener("click", closeModal);
    dom.submitCreateAlbum.addEventListener("click", createAlbum);

    dom.newAlbumTitle.addEventListener("keydown", event => {
        if (event.key === "Enter") createAlbum();
    });
}
