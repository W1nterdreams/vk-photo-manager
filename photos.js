import { state } from "./state.js?v=20260920-albumtools03";
import { dom } from "./dom.js?v=20260920-albumtools03";
import { vkApi } from "./vk-api.js?v=20260920-albumtools03";
import { getPhotoPreviewUrl, escapeHtml, getErrorMessage } from "./helpers.js?v=20260920-albumtools03";
import { showPhotosScreen, pushAlbumHistory } from "./navigation.js?v=20260920-albumtools03";
import { CACHE_TTL } from "./config.js?v=20260920-albumtools03";
import { cacheGet, cacheGetStale, cacheSet, albumPhotosKey } from "./cache.js?v=20260920-albumtools03";
import { getOwnerId } from "./group-context.js?v=20260920-albumtools03";
import { openPhotoViewer } from "./photo-viewer.js?v=20260920-albumtools03";

const PAGE_SIZE = 20;

export function setPhotoDateSort(mode = "vk") {
    const allowed = new Set(["vk", "newest", "oldest"]);
    state.photoSortMode = allowed.has(mode) ? mode : "vk";
    updatePhotoSortButtons();
    renderPhotos();
}


export function getPhotoDateSort() {
    return state.photoSortMode || "vk";
}

function updatePhotoSortButtons() {
    const current = getPhotoDateSort();
    const newestActive = current === "newest";
    const oldestActive = current === "oldest";

    dom.sortNewestButton?.classList.toggle("active", newestActive);
    dom.sortNewestButton?.setAttribute("aria-pressed", newestActive ? "true" : "false");

    dom.sortOldestButton?.classList.toggle("active", oldestActive);
    dom.sortOldestButton?.setAttribute("aria-pressed", oldestActive ? "true" : "false");
}

let photoSortControlsInitialized = false;

function initPhotoSortControls() {
    if (photoSortControlsInitialized) return;
    photoSortControlsInitialized = true;

    dom.sortNewestButton?.addEventListener("click", () => {
        setPhotoDateSort("newest");
    });

    dom.sortOldestButton?.addEventListener("click", () => {
        setPhotoDateSort("oldest");
    });
}

function photosForRender() {
    const items = [...state.photos];
    if (state.photoSortMode === "newest") {
        items.sort((a, b) => Number(b?.date || 0) - Number(a?.date || 0));
    } else if (state.photoSortMode === "oldest") {
        items.sort((a, b) => Number(a?.date || 0) - Number(b?.date || 0));
    }
    return items;
}

let photoScrollTicking = false;
let photosInitialized = false;
let firstPageRefreshToken = 0;

function mergePhotos(current, incoming) {
    const map = new Map(current.map(photo => [String(photo.id), photo]));
    incoming.forEach(photo => map.set(String(photo.id), photo));
    return [...map.values()];
}

function currentAlbumIs(album) {
    return Boolean(
        album &&
        state.currentAlbum &&
        String(album.id) === String(state.currentAlbum.id)
    );
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

function updateAlbumSize(album, total) {
    const numericTotal = Math.max(0, Number(total || 0));
    album.size = numericTotal;

    state.albums = state.albums.map(item =>
        String(item.id) === String(album.id)
            ? { ...item, size: numericTotal }
            : item
    );

    state.albumIndex = state.albumIndex.map(item =>
        String(item.id) === String(album.id)
            ? { ...item, size: numericTotal }
            : item
    );

    if (state.currentAlbum && String(state.currentAlbum.id) === String(album.id)) {
        state.currentAlbum = { ...state.currentAlbum, size: numericTotal };
    }
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

function applyFirstPage(album, result, { preserveLoadedTail = false } = {}) {
    if (!currentAlbumIs(album)) return false;

    const items = Array.isArray(result?.items) ? result.items : [];
    const apiTotal = Number(result?.count);
    const total = Number.isFinite(apiTotal) && apiTotal >= 0
        ? Math.max(apiTotal, items.length)
        : Math.max(Number(album.size || 0), items.length);

    if (preserveLoadedTail && state.photos.length > PAGE_SIZE) {
        const firstIds = new Set(items.map(photo => String(photo.id)));
        const tail = state.photos
            .slice(PAGE_SIZE)
            .filter(photo => !firstIds.has(String(photo.id)));
        state.photos = [...items, ...tail];
    } else {
        state.photos = items;
    }

    state.photosTotal = total;
    state.photosOffset = state.photos.length;
    state.photosHasMore = state.photosOffset < state.photosTotal;
    updateAlbumSize(album, total);
    savePhotosCache(album);
    renderPhotos();
    updatePhotoCount();
    setTimeout(handlePhotoScroll, 0);
    return true;
}

async function fetchFirstPhotoPage(album) {
    const result = await fetchPhotoPage(album, 0, PAGE_SIZE);
    applyFirstPage(album, result, { preserveLoadedTail: false });
}

async function revalidateFirstPhotoPage(album) {
    const token = ++firstPageRefreshToken;

    try {
        const result = await fetchPhotoPage(album, 0, PAGE_SIZE);
        if (token !== firstPageRefreshToken || !currentAlbumIs(album)) return;
        applyFirstPage(album, result, { preserveLoadedTail: true });
    } catch (error) {
        console.warn("Фоновое обновление фотографий:", error);
    }
}

export async function refreshCurrentAlbumPhotos() {
    const album = state.currentAlbum;
    if (!album) return;
    await revalidateFirstPhotoPage(album);
}

export async function openAlbum(album, { fromHistory = false, restoreScroll = 0 } = {}) {
    if (!fromHistory) {
        pushAlbumHistory(album);
    }

    state.currentAlbum = album;
    showPhotosScreen({ restoreScroll });

    dom.pageTitle.textContent = "";
    dom.albumTitle.textContent = album.title || "Альбом";
    dom.albumDescription.textContent = album.description || "";
    dom.photoCount.textContent = `${album.size || 0} фото`;

    initPhotoPagination();
    initPhotoSortControls();
    updatePhotoSortButtons();

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

    firstPageRefreshToken += 1;
    state.photos = [];
    state.photosTotal = Number(album.size || 0);
    state.photosOffset = 0;
    state.photosHasMore = false;
    state.photosLoadingMore = false;

    if (!force) {
        // Сначала мгновенно показываем любой имеющийся локальный снимок данных,
        // затем ОБЯЗАТЕЛЬНО сверяем первую страницу с VK. Благодаря этому лайки
        // и счётчики комментариев быстро обновляются после возврата к альбому.
        const cached = cacheGet(key, CACHE_TTL.photos) || cacheGetStale(key);
        if (cached) {
            restorePhotosCache(cached, album);
            renderPhotos();
            updatePhotoCount();
            setTimeout(handlePhotoScroll, 0);
            void revalidateFirstPhotoPage(album);
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
        const items = Array.isArray(result?.items) ? result.items : [];

        const beforeCount = state.photos.length;
        state.photos = mergePhotos(state.photos, items);
        const addedCount = state.photos.length - beforeCount;

        const apiTotal = Number(result?.count);
        if (Number.isFinite(apiTotal) && apiTotal >= 0) {
            state.photosTotal = Math.max(apiTotal, state.photos.length);
        } else {
            state.photosTotal = Math.max(
                Number(album.size || 0),
                state.photosTotal || 0,
                state.photos.length
            );
        }

        state.photosOffset += items.length;
        state.photosHasMore = state.photosOffset < state.photosTotal || (
            !Number.isFinite(apiTotal) && items.length === PAGE_SIZE
        );

        if (items.length > 0 && addedCount === 0) {
            state.photosHasMore = false;
        }

        updateAlbumSize(album, state.photosTotal);
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
    updatePhotoSortButtons();
    dom.photos.innerHTML = "";

    if (!state.photos.length) {
        dom.photos.innerHTML = '<div class="status-message">В этом альбоме нет фотографий</div>';
        return;
    }

    photosForRender().forEach(photo => {
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

        const stats = document.createElement("div");
        stats.className = "photo-card-stats";

        const likes = document.createElement("span");
        likes.className = "photo-card-stat";
        likes.textContent = `♥ ${Number(photo?.likes?.count || 0)}`;

        const comments = document.createElement("span");
        comments.className = "photo-card-stat";
        comments.textContent = `💬 ${Number(photo?.comments?.count || 0)}`;

        stats.append(likes, comments);
        card.appendChild(stats);

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
