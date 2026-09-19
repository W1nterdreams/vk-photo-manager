import { state } from "./state.js";
import { dom } from "./dom.js";
import { vkApi } from "./vk-api.js";
import { getBestPhotoUrl, escapeHtml, getErrorMessage } from "./helpers.js";
import { showPhotosScreen } from "./navigation.js";
import { CACHE_TTL } from "./config.js";
import { cacheGet, cacheGetStale, cacheSet, albumPhotosKey } from "./cache.js";
import { getOwnerId } from "./group-context.js";

async function fetchPhotosFromVK(album) {
    const ownerId = getOwnerId();

    const result = await vkApi("photos.get", {
        owner_id: ownerId,
        album_id: album.id,
        extended: 1,
        photo_sizes: 1,
        count: 100
    });

    state.photos = result.items || [];
    cacheSet(albumPhotosKey(ownerId, album.id), state.photos);
    renderPhotos();
    dom.photoCount.textContent = `${state.photos.length} фото`;
}

export async function openAlbum(album) {
    state.currentAlbum = album;
    showPhotosScreen();

    dom.pageTitle.textContent = album.title || "Альбом";
    dom.albumTitle.textContent = album.title || "Альбом";
    dom.albumDescription.textContent = album.description || "";
    dom.photoCount.textContent = `${album.size || 0} фото`;

    try {
        await loadPhotos(album);
    } catch (error) {
        dom.photos.innerHTML =
            `<div class="error">Не удалось загрузить фотографии.<br><br>${escapeHtml(getErrorMessage(error))}</div>`;
    }
}

export async function loadPhotos(album, { force = false } = {}) {
    const ownerId = getOwnerId();
    const key = albumPhotosKey(ownerId, album.id);

    if (!force) {
        const cached = cacheGet(key, CACHE_TTL.photos);
        if (cached) {
            state.photos = cached;
            renderPhotos();
            dom.photoCount.textContent = `${state.photos.length} фото`;
            return;
        }

        const stale = cacheGetStale(key);
        if (stale) {
            state.photos = stale;
            renderPhotos();
            dom.photoCount.textContent = `${state.photos.length} фото`;
            try { await fetchPhotosFromVK(album); }
            catch (error) { console.warn("Фоновое обновление фотографий:", error); }
            return;
        }
    }

    dom.photos.innerHTML = '<div class="status-message">Загружаем фотографии...</div>';
    await fetchPhotosFromVK(album);
}

export function renderPhotos() {
    dom.photos.innerHTML = "";

    if (!state.photos.length) {
        dom.photos.innerHTML = '<div class="status-message">В этом альбоме нет фотографий</div>';
        return;
    }

    state.photos.forEach(photo => {
        const card = document.createElement("div");
        card.className = "photo-card";
        const url = getBestPhotoUrl(photo);

        if (url) {
            const image = document.createElement("img");
            image.src = url;
            image.alt = photo.text || "";
            image.loading = "lazy";
            card.appendChild(image);
        }

        card.addEventListener("click", () => console.log("Selected photo:", photo));
        dom.photos.appendChild(card);
    });
}
