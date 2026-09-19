import { state } from "./state.js";
import { dom } from "./dom.js";
import { vkApi } from "./vk-api.js";
import { getBestPhotoUrl, escapeHtml, getErrorMessage } from "./helpers.js";
import { showPhotosScreen } from "./navigation.js";
import { CACHE_TTL } from "./config.js";
import { cacheGet, cacheGetStale, cacheSet, albumPhotosKey } from "./cache.js";
import { getOwnerId } from "./group-context.js";

const PAGE_SIZE = 20;
let photoScrollTicking = false;
let photosInitialized = false;

function mergePhotos(current, incoming) {
    const map = new Map(current.map(photo => [String(photo.id), photo]));
    incoming.forEach(photo => map.set(String(photo.id), photo));
    return [...map.values()];
}

async function fetchPhotoPage(album, offset, count = PAGE_SIZE) {
    const ownerId = getOwnerId();
    return vkApi("photos.get", {
        owner_id: ownerId,
        album_id: album.id,
        extended: 1,
        photo_sizes: 1,
        count,
        offset
    });
}

function savePhotosCache(album) {
    const ownerId = getOwnerId();
    cacheSet(albumPhotosKey(ownerId, album.id), {
        items: state.photos,
        total: state.photosTotal
    });
}

function restorePhotosCache(cached, album) {
    const items = Array.isArray(cached) ? cached : (cached?.items || []);
    const total = Array.isArray(cached)
        ? Number(album.size || items.length)
        : Number(cached?.total ?? album.size ?? items.length);

    state.photos = items;
    state.photosTotal = total;
    state.photosOffset = items.length;
    state.photosHasMore = state.photosOffset < state.photosTotal;
}

async function fetchFirstPhotoPage(album) {
    const result = await fetchPhotoPage(album, 0, PAGE_SIZE);
    state.photos = result.items || [];
    state.photosTotal = Number(result.count ?? album.size ?? state.photos.length);
    state.photosOffset = state.photos.length;
    state.photosHasMore = state.photosOffset < state.photosTotal;
    savePhotosCache(album);
    renderPhotos();
    updatePhotoCount();
    setTimeout(handlePhotoScroll, 0);
}

export async function openAlbum(album) {
    state.currentAlbum = album;
    showPhotosScreen();

    dom.pageTitle.textContent = album.title || "Альбом";
    dom.albumTitle.textContent = album.title || "Альбом";
    dom.albumDescription.textContent = album.description || "";
    dom.photoCount.textContent = `${album.size || 0} фото`;

    initPhotoPagination();

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

    state.photos = [];
    state.photosTotal = Number(album.size || 0);
    state.photosOffset = 0;
    state.photosHasMore = false;
    state.photosLoadingMore = false;

    if (!force) {
        const cached = cacheGet(key, CACHE_TTL.photos);
        if (cached) {
            restorePhotosCache(cached, album);
            renderPhotos();
            updatePhotoCount();
            setTimeout(handlePhotoScroll, 0);
            return;
        }

        const stale = cacheGetStale(key);
        if (stale) {
            restorePhotosCache(stale, album);
            renderPhotos();
            updatePhotoCount();
            try { await fetchFirstPhotoPage(album); }
            catch (error) { console.warn("Фоновое обновление фотографий:", error); }
            return;
        }
    }

    dom.photos.innerHTML = '<div class="status-message">Загружаем фотографии...</div>';
    await fetchFirstPhotoPage(album);
}

export async function loadMorePhotos() {
    const album = state.currentAlbum;
    if (!album || state.currentScreen !== "photos") return;
    if (state.photosLoadingMore || !state.photosHasMore) return;

    state.photosLoadingMore = true;
    renderPhotos();

    try {
        const result = await fetchPhotoPage(album, state.photosOffset, PAGE_SIZE);
        const items = result.items || [];

        state.photos = mergePhotos(state.photos, items);
        state.photosTotal = Number(result.count ?? state.photosTotal ?? state.photos.length);
        state.photosOffset += items.length;
        state.photosHasMore = items.length > 0 && state.photosOffset < state.photosTotal;
        savePhotosCache(album);
    } catch (error) {
        console.warn("Не удалось догрузить фотографии:", error);
    } finally {
        state.photosLoadingMore = false;
        renderPhotos();
        updatePhotoCount();
        setTimeout(handlePhotoScroll, 0);
    }
}

function updatePhotoCount() {
    const total = Number(state.photosTotal || state.currentAlbum?.size || state.photos.length);
    dom.photoCount.textContent = `${total} фото`;
}

function isNearPageBottom(distance = 900) {
    const doc = document.documentElement;
    return window.innerHeight + window.scrollY >= doc.scrollHeight - distance;
}

function handlePhotoScroll() {
    if (photoScrollTicking) return;
    photoScrollTicking = true;

    requestAnimationFrame(() => {
        photoScrollTicking = false;
        if (
            state.currentScreen === "photos" &&
            state.photosHasMore &&
            !state.photosLoadingMore &&
            isNearPageBottom()
        ) {
            void loadMorePhotos();
        }
    });
}

function initPhotoPagination() {
    if (photosInitialized) return;
    photosInitialized = true;
    window.addEventListener("scroll", handlePhotoScroll, { passive: true });
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

    if (state.photosLoadingMore) {
        const loading = document.createElement("div");
        loading.className = "status-message";
        loading.textContent = "Загружаем ещё фотографии...";
        dom.photos.appendChild(loading);
    }
}
