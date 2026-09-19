import { state } from "./state.js?v=20260919-native01";
import { dom } from "./dom.js?v=20260919-native01";
import { vkApi } from "./vk-api.js?v=20260919-native01";
import { getPhotoPreviewUrl, escapeHtml, getErrorMessage } from "./helpers.js?v=20260919-native01";
import { showPhotosScreen, pushAlbumHistory } from "./navigation.js?v=20260919-native01";
import { CACHE_TTL } from "./config.js?v=20260919-native01";
import { cacheGet, cacheGetStale, cacheSet, albumPhotosKey } from "./cache.js?v=20260919-native01";
import { getOwnerId } from "./group-context.js?v=20260919-native01";
import { openPhotoViewer } from "./photo-viewer.js?v=20260919-native01";

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
    const cachedTotal = Array.isArray(cached) ? 0 : Number(cached?.total || 0);
    const albumTotal = Number(album.size || 0);
    const total = Math.max(cachedTotal, albumTotal, items.length);

    state.photos = items;
    state.photosTotal = total;
    state.photosOffset = items.length;
    state.photosHasMore = state.photosOffset < state.photosTotal;
}

async function fetchFirstPhotoPage(album) {
    const result = await fetchPhotoPage(album, 0, PAGE_SIZE);
    state.photos = result.items || [];
    state.photosTotal = Math.max(
        Number(result.count || 0),
        Number(album.size || 0),
        state.photos.length
    );
    state.photosOffset = state.photos.length;
    state.photosHasMore =
        state.photosOffset < state.photosTotal ||
        state.photos.length === PAGE_SIZE;
    savePhotosCache(album);
    renderPhotos();
    updatePhotoCount();
    setTimeout(handlePhotoScroll, 0);
}

export async function openAlbum(album, { fromHistory = false, restoreScroll = 0 } = {}) {
    if (!fromHistory) {
        pushAlbumHistory(album);
    }

    state.currentAlbum = album;
    showPhotosScreen({ restoreScroll });

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
        state.photosTotal = Math.max(
            Number(result.count || 0),
            Number(album.size || 0),
            state.photosTotal || 0,
            state.photos.length
        );
        state.photosOffset += items.length;
        state.photosHasMore =
            items.length > 0 &&
            (state.photosOffset < state.photosTotal || items.length === PAGE_SIZE);
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
    document.addEventListener("scroll", handlePhotoScroll, { passive: true, capture: true });
    window.addEventListener("resize", handlePhotoScroll, { passive: true });
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
        const url = getPhotoPreviewUrl(photo, 640);

        if (url) {
            const image = document.createElement("img");
            image.src = url;
            image.alt = photo.text || "";
            image.loading = "lazy";
            card.appendChild(image);
        }

        card.addEventListener("click", () => {
            void openPhotoViewer(photo, state.currentAlbum);
        });
        dom.photos.appendChild(card);
    });

    if (state.photosLoadingMore) {
        const loading = document.createElement("div");
        loading.className = "status-message";
        loading.textContent = "Загружаем ещё фотографии...";
        dom.photos.appendChild(loading);
    }
}
