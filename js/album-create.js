import { state } from "./state.js";
import { dom } from "./dom.js";
import { vkApi } from "./vk-api.js";
import { getErrorMessage } from "./helpers.js";
import { loadAlbums } from "./albums.js";
import { closeMenu } from "./main-menu.js";
import { getGroupId, getOwnerId } from "./group-context.js";
import { cacheRemove } from "./cache.js";
import { albumsKey } from "./cache.js";

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
    dom.closeCreateAlbumButton.addEventListener("click", closeModal);
    dom.cancelCreateAlbumButton.addEventListener("click", closeModal);
    dom.submitCreateAlbum.addEventListener("click", createAlbum);

    dom.newAlbumTitle.addEventListener("keydown", event => {
        if (event.key === "Enter") createAlbum();
    });
}
