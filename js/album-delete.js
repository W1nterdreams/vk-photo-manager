import { getOwnerId } from "./group-context.js?v=20260920-uploadsafe01";
import { openVkTarget } from "./vk-links.js?v=20260920-uploadsafe01";
import { loadAlbums } from "./albums.js?v=20260920-uploadsafe01";

let waitingForVkReturn = false;
let refreshingAfterReturn = false;

function albumEditLink(album) {
    const ownerId = Number(album?.owner_id) || getOwnerId();
    const albumId = Number(album?.id || 0);

    if (!ownerId || !albumId) return "";

    return `https://vk.com/album${ownerId}_${albumId}?act=edit`;
}

async function refreshAfterVkReturn() {
    if (!waitingForVkReturn || refreshingAfterReturn) return;
    if (document.visibilityState === "hidden") return;

    waitingForVkReturn = false;
    refreshingAfterReturn = true;

    try {
        await loadAlbums({ force: true });
    } catch (error) {
        console.warn("Не удалось обновить альбомы после возврата из VK:", error);
    } finally {
        refreshingAfterReturn = false;
    }
}

function openAlbumDeleteInVk(album) {
    if (!album) return;

    const albumId = Number(album.id);
    if (!Number.isFinite(albumId) || albumId <= 0) {
        window.alert("Этот системный альбом удалить нельзя.");
        return;
    }

    const link = albumEditLink(album);
    if (!link) {
        window.alert("Не удалось сформировать ссылку на альбом.");
        return;
    }

    const title = String(album.title || "Без названия").trim();

    const confirmed = window.confirm(
        `Удалить альбом «${title}»?\n\n` +
        "Удаление откроется в штатном интерфейсе VK."
    );

    if (!confirmed) return;

    waitingForVkReturn = true;
    openVkTarget(link);
}

export function initAlbumDelete() {
    window.addEventListener("album-menu-action", event => {
        if (event?.detail?.action !== "delete") return;
        openAlbumDeleteInVk(event.detail.album);
    });

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            setTimeout(() => void refreshAfterVkReturn(), 250);
        }
    });

    window.addEventListener("focus", () => {
        setTimeout(() => void refreshAfterVkReturn(), 250);
    });
}
