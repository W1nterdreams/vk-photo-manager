import { state } from "./state.js?v=20260921-photoindex20";
import { dom } from "./dom.js?v=20260921-photoindex20";
import { vkApi } from "./vk-api.js?v=20260921-photoindex20";
import { getPhotoPreviewUrl, escapeHtml, getErrorMessage } from "./helpers.js?v=20260921-photoindex20";
import { showPhotosScreen, pushAlbumHistory } from "./navigation.js?v=20260921-photoindex20";
import { CACHE_TTL } from "./config.js?v=20260921-photoindex20";
import { cacheGet, cacheGetStale, cacheSet, albumPhotosKey } from "./cache.js?v=20260921-photoindex20";
import { getOwnerId } from "./group-context.js?v=20260921-photoindex20";
import { openPhotoViewer } from "./photo-viewer.js?v=20260921-photoindex20";
import { bindPhotoContextLongPress } from "./photo-context-menu.js?v=20260921-photoindex20";
import {
    isPhotoMultiSelectActive,
    isPhotoSelected,
    togglePhotoSelection,
    cancelPhotoMultiSelect
} from "./photo-multiselect.js?v=20260921-photoindex20";

const PAGE_SIZE = 20;
const SORT_FETCH_SIZE = 100;
const UI_PHOTO_CACHE_LIMIT = 60;

let sortingAllPhotos = false;
let photoSortControlsInitialized = false;
let photoSearchControlsInitialized = false;
let photoSearchRequestToken = 0;
let allPhotosLoadPromise = null;

export function getPhotoDateSort() {
    return state.photoSortMode || "vk";
}

function updatePhotoSortButtons() {
    const current = getPhotoDateSort();
    const newestActive = current === "newest";
    const oldestActive = current === "oldest";
    const currentActive = current === "vk";

    dom.sortNewestButton?.classList.toggle("active", newestActive);
    dom.sortNewestButton?.setAttribute("aria-pressed", newestActive ? "true" : "false");
    dom.sortNewestButton?.classList.toggle("loading", sortingAllPhotos);
    if (dom.sortNewestButton) dom.sortNewestButton.disabled = sortingAllPhotos;

    dom.sortOldestButton?.classList.toggle("active", oldestActive);
    dom.sortOldestButton?.setAttribute("aria-pressed", oldestActive ? "true" : "false");
    dom.sortOldestButton?.classList.toggle("loading", sortingAllPhotos);
    if (dom.sortOldestButton) dom.sortOldestButton.disabled = sortingAllPhotos;

    dom.sortCurrentButton?.classList.toggle("active", currentActive);
    dom.sortCurrentButton?.setAttribute("aria-pressed", currentActive ? "true" : "false");
    dom.sortCurrentButton?.classList.toggle("loading", sortingAllPhotos);
    if (dom.sortCurrentButton) dom.sortCurrentButton.disabled = sortingAllPhotos;
}

async function ensureAllPhotosLoadedForSort() {
    const album = state.currentAlbum;
    if (!album) return;

    const expectedTotal = Math.max(
        Number(state.photosTotal || 0),
        Number(album.size || 0),
        state.photos.length
    );

    if (expectedTotal > 0 && state.photos.length >= expectedTotal && !state.photosHasMore) {
        return;
    }

    if (allPhotosLoadPromise) {
        await allPhotosLoadPromise;
        return;
    }

    allPhotosLoadPromise = (async () => {
        sortingAllPhotos = true;
        updatePhotoSortButtons();

        try {
            let offset = 0;
            let total = expectedTotal;
            let allPhotos = [];

            while (true) {
                const result = await fetchPhotoPage(album, offset, SORT_FETCH_SIZE);
                if (!currentAlbumIs(album)) return;

                const items = Array.isArray(result?.items) ? result.items : [];
                allPhotos = mergePhotos(allPhotos, items);

                const apiTotal = Number(result?.count);
                if (Number.isFinite(apiTotal) && apiTotal >= 0) {
                    total = Math.max(apiTotal, allPhotos.length);
                } else {
                    total = Math.max(total, allPhotos.length);
                }

                offset += items.length;

                if (!items.length || offset >= total || items.length < SORT_FETCH_SIZE) {
                    break;
                }
            }

            if (!currentAlbumIs(album)) return;

            state.photos = allPhotos;
            state.photosTotal = Math.max(total, allPhotos.length);
            state.photosOffset = allPhotos.length;
            state.photosHasMore = false;
            state.photosLoadingMore = false;

            updateAlbumSize(album, state.photosTotal);
            savePhotosCache(album);
            updatePhotoCount();
        } finally {
            sortingAllPhotos = false;
            updatePhotoSortButtons();
        }
    })();

    try {
        await allPhotosLoadPromise;
    } finally {
        allPhotosLoadPromise = null;
    }
}

export async function setPhotoDateSort(mode = "vk") {
    const allowed = new Set(["vk", "newest", "oldest"]);
    const nextMode = allowed.has(mode) ? mode : "vk";

    if ((nextMode === "newest" || nextMode === "oldest") && state.currentAlbum) {
        await ensureAllPhotosLoadedForSort();
    }

    state.photoSortMode = nextMode;
    updatePhotoSortButtons();
    renderPhotos();
}

function initPhotoSortControls() {
    if (photoSortControlsInitialized) return;
    photoSortControlsInitialized = true;

    dom.sortNewestButton?.addEventListener("click", () => {
        void setPhotoDateSort("newest");
    });

    dom.sortOldestButton?.addEventListener("click", () => {
        void setPhotoDateSort("oldest");
    });

    dom.sortCurrentButton?.addEventListener("click", () => {
        void setPhotoDateSort("vk");
    });
}

function normalizePhotoSearchText(value = "") {
    return String(value)
        .toLocaleLowerCase("ru-RU")
        .replace(/ё/g, "е")
        .replace(/\s+/g, " ")
        .trim();
}

function updatePhotoSearchUi() {
    if (!dom.photoSearch || !dom.clearPhotoSearch) return;
    const hasQuery = Boolean(state.photoSearchText);
    dom.clearPhotoSearch.classList.toggle("hidden", !hasQuery);
}

async function applyPhotoSearchFromInput() {
    const query = normalizePhotoSearchText(dom.photoSearch?.value || "");
    state.photoSearchText = query;
    updatePhotoSearchUi();
    renderPhotos();

    if (!query || !state.currentAlbum) return;

    const requestToken = ++photoSearchRequestToken;
    const albumId = String(state.currentAlbum.id);

    try {
        await ensureAllPhotosLoadedForSort();
    } catch (error) {
        console.warn("Не удалось загрузить все фотографии для поиска:", error);
        return;
    }

    if (
        requestToken !== photoSearchRequestToken ||
        !state.currentAlbum ||
        String(state.currentAlbum.id) !== albumId ||
        state.photoSearchText !== query
    ) {
        return;
    }

    renderPhotos();
}

function initPhotoSearchControls() {
    if (photoSearchControlsInitialized) return;
    photoSearchControlsInitialized = true;

    let inputTimer = 0;

    dom.photoSearch?.addEventListener("input", () => {
        window.clearTimeout(inputTimer);
        inputTimer = window.setTimeout(() => {
            void applyPhotoSearchFromInput();
        }, 180);
    });

    dom.clearPhotoSearch?.addEventListener("click", () => {
        photoSearchRequestToken += 1;
        state.photoSearchText = "";
        if (dom.photoSearch) {
            dom.photoSearch.value = "";
            dom.photoSearch.focus();
        }
        updatePhotoSearchUi();
        renderPhotos();
    });
}

function formatPhotoDate(timestamp) {
    const seconds = Number(timestamp || 0);
    if (!Number.isFinite(seconds) || seconds <= 0) return "";

    const date = new Date(seconds * 1000);
    if (Number.isNaN(date.getTime())) return "";

    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
}

function photosForRender() {
    const query = normalizePhotoSearchText(state.photoSearchText || "");
    const tokens = query ? query.split(" ").filter(Boolean) : [];

    const items = state.photos.filter(photo => {
        if (!tokens.length) return true;
        const description = normalizePhotoSearchText(photo?.text || "");
        return tokens.every(token => description.includes(token));
    });

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
    // localStorage оставляем только как быстрый UI-кэш. Никогда не кладём
    // туда целый большой альбом: полный поисковый индекс хранится в IndexedDB.
    cacheSet(albumPhotosKey(ownerId, album.id), {
        items: state.photos.slice(0, UI_PHOTO_CACHE_LIMIT),
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
    cancelPhotoMultiSelect({ silent: true });

    const previousAlbumId = state.currentAlbum ? String(state.currentAlbum.id) : "";
    const nextAlbumId = String(album?.id || "");
    const keepSearch = fromHistory && previousAlbumId === nextAlbumId;

    if (!fromHistory) {
        pushAlbumHistory(album);
    }

    if (!keepSearch) {
        photoSearchRequestToken += 1;
        state.photoSearchText = "";
        if (dom.photoSearch) dom.photoSearch.value = "";
    }

    state.currentAlbum = album;
    showPhotosScreen({ restoreScroll });

    dom.albumTitle.textContent = album.title || "Альбом";
    dom.albumDescription.textContent = album.description || "";
    dom.photoCount.textContent = `${album.size || 0} фото`;

    initPhotoPagination();
    initPhotoMultiSelectRendering();
    initPhotoSortControls();
    initPhotoSearchControls();
    updatePhotoSortButtons();
    updatePhotoSearchUi();

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


let photoMultiSelectRenderInitialized = false;

function initPhotoMultiSelectRendering() {
    if (photoMultiSelectRenderInitialized) return;
    photoMultiSelectRenderInitialized = true;
    window.addEventListener("photo-multiselect-change", () => {
        if (state.currentScreen === "photos") renderPhotos();
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
    updatePhotoSearchUi();
    dom.photos.innerHTML = "";

    if (!state.photos.length) {
        dom.photos.innerHTML = '<div class="status-message">В этом альбоме нет фотографий</div>';
        return;
    }

    const photosToRender = photosForRender();

    if (!photosToRender.length && state.photoSearchText) {
        dom.photos.innerHTML = '<div class="status-message">По описанию ничего не найдено</div>';
        return;
    }

    photosToRender.forEach(photo => {
        const card = document.createElement("div");
        card.className = "photo-card";
        card.dataset.photoId = String(photo.id);
        const url = getPhotoPreviewUrl(photo, 200);

        if (url) {
            const image = document.createElement("img");
            image.src = url;
            image.alt = photo.text || "";
            image.loading = "lazy";
            card.appendChild(image);
        }

        const uploadedDate = formatPhotoDate(photo?.date);
        if (uploadedDate) {
            const dateBadge = document.createElement("span");
            dateBadge.className = "photo-card-date";
            dateBadge.textContent = uploadedDate;
            card.appendChild(dateBadge);
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

        if (isPhotoMultiSelectActive()) {
            const selected = isPhotoSelected(photo);
            card.classList.toggle("photo-multi-selected", selected);

            const check = document.createElement("span");
            check.className = "photo-select-check";
            check.textContent = selected ? "✓" : "";
            card.appendChild(check);
        }

        bindPhotoContextLongPress(card, photo);

        card.addEventListener("click", event => {
            if (isPhotoMultiSelectActive()) {
                event.preventDefault();
                event.stopPropagation();
                togglePhotoSelection(photo);
                return;
            }

            if (Date.now() < Number(state.suppressPhotoOpenUntil || 0)) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
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
