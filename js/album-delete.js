import { state } from "./state.js?v=20260919-native01";
import { vkApi } from "./vk-api.js?v=20260919-native01";
import { getErrorMessage } from "./helpers.js?v=20260919-native01";
import { getOwnerId } from "./group-context.js?v=20260919-native01";
import {
    cacheSet,
    cacheRemove,
    albumsKey,
    albumIndexKey,
    albumPhotosKey
} from "./cache.js?v=20260919-native01";
import { renderAlbums } from "./albums.js?v=20260919-native01";

let deleting = false;

function removeAlbumFromState(albumId) {
    const id = String(albumId);

    state.albums = state.albums.filter(album => String(album.id) !== id);
    state.albumIndex = state.albumIndex.filter(album => String(album.id) !== id);

    if (state.currentAlbum && String(state.currentAlbum.id) === id) {
        state.currentAlbum = null;
    }

    // После удаления элементы в API сдвигаются на одну позицию.
    // Следующую страницу нужно запрашивать с нового фактического offset,
    // иначе можно пропустить один альбом.
    state.albumsOffset = state.albums.length;
    state.albumsTotal = Math.max(0, Number(state.albumsTotal || 0) - 1);
    state.albumsHasMore = state.albums.length < state.albumsTotal;
}

function persistAlbumState(deletedAlbumId) {
    const ownerId = getOwnerId();

    cacheSet(albumsKey(ownerId), {
        items: state.albums,
        total: state.albumsTotal
    });

    cacheSet(albumIndexKey(ownerId), state.albumIndex);
    cacheRemove(albumPhotosKey(ownerId, deletedAlbumId));
}

async function deleteAlbum(album) {
    if (!album || deleting) return;

    const albumId = Number(album.id);
    if (!Number.isFinite(albumId) || albumId <= 0) {
        window.alert("Этот системный альбом удалить нельзя.");
        return;
    }

    const title = String(album.title || "Без названия").trim();
    const confirmed = window.confirm(
        `Удалить альбом «${title}»?\n\nЭто действие нельзя отменить.`
    );

    if (!confirmed) return;

    deleting = true;

    try {
        const groupId = Math.abs(Number(getOwnerId()));
        const result = await vkApi("photos.deleteAlbum", {
            album_id: albumId,
            group_id: groupId
        });

        if (result !== 1 && result !== true) {
            throw new Error("VK не подтвердил удаление альбома.");
        }

        removeAlbumFromState(albumId);
        persistAlbumState(albumId);
        renderAlbums();
    } catch (error) {
        window.alert(`Не удалось удалить альбом.\n\n${getErrorMessage(error)}`);
    } finally {
        deleting = false;
    }
}

export function initAlbumDelete() {
    window.addEventListener("album-menu-action", event => {
        if (event?.detail?.action !== "delete") return;
        void deleteAlbum(event.detail.album);
    });
}
