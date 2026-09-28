import { state } from "./state.js?v=20260928-client06-memorysearch";
import { dom } from "./dom.js?v=20260928-client06-memorysearch";
import { vkApi } from "./vk-api.js?v=20260928-client06-memorysearch";
import { getPhotoPreviewUrl, matchesAllTokens, searchTokens, formatPhotoDate, getErrorMessage } from "./helpers.js?v=20260928-client06-memorysearch";
import { getOwnerId } from "./group-context.js?v=20260928-client06-memorysearch";
import { pushAlbumHistory, showPhotosScreen } from "./navigation.js?v=20260928-client06-memorysearch";
import { bindPhotoLongPress } from "./photo-actions.js?v=20260928-client06-memorysearch";
import { updateAlbumMetadataFromPhotos } from "./albums.js?v=20260928-client06-memorysearch";

const API_PAGE_SIZE = 1000;
const RENDER_BATCH_SIZE = 10;
const MAX_PAGES = 100;

let initialized = false;
let openPhotoHandler = null;
let renderedCount = 0;
let currentRenderList = [];
let scrollTicking = false;
let loadingAlbumPromise = null;

function freshWindowMs() {
    return Math.max(5_000, Number(state.config?.album_session_fresh_seconds || 60) * 1000);
}

function albumCacheEntry(albumId) {
    return state.sessionPhotosByAlbum.get(Number(albumId)) || null;
}

function isEntryFresh(entry) {
    return Boolean(entry && Date.now() - Number(entry.fetchedAt || 0) < freshWindowMs());
}

export function isAlbumFresh(albumId) {
    return isEntryFresh(albumCacheEntry(albumId));
}

function storeAlbumPhotos(albumId, photos) {
    const id = Number(albumId);
    const entry = { photos, fetchedAt: Date.now() };
    state.sessionPhotosByAlbum.set(id, entry);
    state.photosFreshAtByAlbum.set(id, entry.fetchedAt);
    return entry;
}

function findAlbum(albumId) {
    const id = Number(albumId);
    return state.albums.find(album => Number(album.id) === id) ||
        (state.currentAlbum && Number(state.currentAlbum.id) === id ? state.currentAlbum : null);
}

async function fetchAllAlbumPhotos(album) {
    const ownerId = getOwnerId();
    let offset = 0;
    let all = [];
    let total = Number(album?.size || 0);

    for (let page = 0; page < MAX_PAGES; page += 1) {
        const response = await vkApi("photos.get", {
            owner_id: ownerId,
            album_id: Number(album.id),
            extended: 1,
            photo_sizes: 1,
            count: API_PAGE_SIZE,
            offset
        });

        const items = Array.isArray(response?.items) ? response.items : [];
        const reported = Number(response?.count);
        if (Number.isFinite(reported) && reported >= 0) total = reported;

        const seen = new Set(all.map(photo => Number(photo.id)));
        const added = items.filter(photo => !seen.has(Number(photo.id)));
        all.push(...added);
        offset += items.length;

        if (!items.length || items.length < API_PAGE_SIZE || (total >= 0 && offset >= total)) break;
        if (!added.length) throw new Error(`VK повторил страницу альбома ${album.id}.`);
    }

    if (total > all.length && all.length && all.length % API_PAGE_SIZE === 0) {
        console.warn("Альбом мог достигнуть защитного лимита загрузки", { albumId: album.id, total, loaded: all.length });
    }

    updateAlbumMetadataFromPhotos(album.id, total || all.length);
    storeAlbumPhotos(album.id, all);

    return all;
}

export async function getFreshAlbumPhotos(album, { force = false, showCached = false } = {}) {
    const id = Number(album?.id || 0);
    if (!id) throw new Error("Не указан album_id.");

    const cached = albumCacheEntry(id);
    if (!force && isEntryFresh(cached)) return cached.photos;

    if (showCached && cached?.photos?.length && Number(state.currentAlbum?.id) === id) {
        state.photos = cached.photos;
        renderPhotos({ reset: true });
    }

    if (loadingAlbumPromise?.albumId === id) return loadingAlbumPromise.promise;

    const promise = fetchAllAlbumPhotos(album).finally(() => {
        if (loadingAlbumPromise?.albumId === id) loadingAlbumPromise = null;
    });
    loadingAlbumPromise = { albumId: id, promise };
    return promise;
}

export async function ensureAlbumFreshForGlobal(albumId) {
    const album = findAlbum(albumId);
    if (!album) throw new Error(`Разрешённый альбом ${albumId} не найден.`);
    return getFreshAlbumPhotos(album, { force: false, showCached: false });
}

function photosForRender() {
    const tokens = searchTokens(state.photoSearchText || "");
    const list = state.photos.filter(photo => matchesAllTokens(photo?.text || "", tokens));

    if (state.photoSortMode === "newest") {
        list.sort((a, b) => Number(b?.date || 0) - Number(a?.date || 0));
    } else if (state.photoSortMode === "oldest") {
        list.sort((a, b) => Number(a?.date || 0) - Number(b?.date || 0));
    }
    return list;
}

function updateSortButtons() {
    const mode = state.photoSortMode || "vk";
    for (const [button, value] of [
        [dom.sortNewestButton, "newest"],
        [dom.sortOldestButton, "oldest"],
        [dom.sortCurrentButton, "vk"]
    ]) {
        button?.classList.toggle("active", mode === value);
        button?.setAttribute("aria-pressed", mode === value ? "true" : "false");
    }
}

function createPhotoCard(photo) {
    const card = document.createElement("div");
    card.className = "photo-card";
    card.dataset.photoId = String(photo.id);

    const preview = getPhotoPreviewUrl(photo, 260);
    if (preview) {
        const image = document.createElement("img");
        image.src = preview;
        image.alt = photo.text || "";
        image.loading = "lazy";
        image.decoding = "async";
        card.appendChild(image);
    }

    const date = formatPhotoDate(photo.date);
    if (date) {
        const badge = document.createElement("span");
        badge.className = "photo-card-date";
        badge.textContent = date;
        card.appendChild(badge);
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

    bindPhotoLongPress(card, photo);

    card.addEventListener("click", event => {
        if (Date.now() < Number(state.suppressPhotoOpenUntil || 0)) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (typeof openPhotoHandler === "function") {
            void openPhotoHandler(photo, state.currentAlbum, {
                sequence: currentRenderList,
                viewerSource: state.photoSearchText ? "album-search" : "album"
            });
        }
    });

    return card;
}

function appendNextBatch() {
    if (!dom.photos || renderedCount >= currentRenderList.length) return;
    const fragment = document.createDocumentFragment();
    const end = Math.min(currentRenderList.length, renderedCount + RENDER_BATCH_SIZE);
    for (let index = renderedCount; index < end; index += 1) {
        fragment.appendChild(createPhotoCard(currentRenderList[index]));
    }
    renderedCount = end;
    dom.photos.appendChild(fragment);
}

export function renderPhotos({ reset = true } = {}) {
    updateSortButtons();
    dom.clearPhotoSearch?.classList.toggle("hidden", !state.photoSearchText);

    if (reset) {
        currentRenderList = photosForRender();
        renderedCount = 0;
        dom.photos.innerHTML = "";
    }

    if (!currentRenderList.length) {
        dom.photos.innerHTML = `<div class="status-message">${state.photoSearchText ? "По описанию ничего не найдено" : "В этом альбоме нет фотографий"}</div>`;
        return;
    }

    appendNextBatch();
}

function nearBottom(distance = 900) {
    const root = document.scrollingElement || document.documentElement;
    return window.innerHeight + window.scrollY >= Number(root?.scrollHeight || 0) - distance;
}

function handleScroll() {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(() => {
        scrollTicking = false;
        if (state.currentScreen === "photos" && renderedCount < currentRenderList.length && nearBottom()) {
            appendNextBatch();
        }
    });
}

function setPhotoSearch(value) {
    state.photoSearchText = String(value || "");
    renderPhotos({ reset: true });
}

export async function openAlbum(album, { fromHistory = false, restoreScroll = 0 } = {}) {
    const sameAlbum = Number(state.currentAlbum?.id || 0) === Number(album?.id || 0);
    const returningWithGrid = Boolean(fromHistory && sameAlbum && state.photos.length);

    if (!fromHistory) pushAlbumHistory(album);

    if (!returningWithGrid) {
        state.photoSearchText = "";
        if (dom.photoSearch) dom.photoSearch.value = "";
    }

    state.currentAlbum = album;
    showPhotosScreen({ restoreScroll: returningWithGrid ? 0 : restoreScroll });
    dom.albumTitle.textContent = album.title || "Альбом";
    dom.albumDescription.textContent = album.description || "";
    dom.photoCount.textContent = `${Number(album.size || 0)} фото`;

    if (returningWithGrid) {
        renderPhotos({ reset: true });
        requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, Number(restoreScroll) || 0)));
        return;
    }

    const cached = albumCacheEntry(album.id);
    if (cached?.photos?.length) {
        state.photos = cached.photos;
        renderPhotos({ reset: true });
    } else {
        dom.photos.innerHTML = '<div class="status-message">Загружаем фотографии...</div>';
    }

    try {
        const photos = await getFreshAlbumPhotos(album, { force: false, showCached: true });
        if (Number(state.currentAlbum?.id) !== Number(album.id)) return;
        state.photos = photos;
        dom.photoCount.textContent = `${photos.length} фото`;
        renderPhotos({ reset: true });
        if (fromHistory && restoreScroll > 0) {
            requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, Number(restoreScroll) || 0)));
        }
    } catch (error) {
        if (Number(state.currentAlbum?.id) !== Number(album.id)) return;
        dom.photos.innerHTML = `<div class="error">Не удалось загрузить фотографии.<br><br>${getErrorMessage(error)}</div>`;
    }
}

export async function refreshCurrentAlbum() {
    const album = state.currentAlbum;
    if (!album) return;
    dom.photos.innerHTML = '<div class="status-message">Обновляем фотографии...</div>';
    try {
        const photos = await getFreshAlbumPhotos(album, { force: true });
        if (Number(state.currentAlbum?.id) !== Number(album.id)) return;
        state.photos = photos;
        dom.photoCount.textContent = `${photos.length} фото`;
        renderPhotos({ reset: true });
    } catch (error) {
        dom.photos.innerHTML = `<div class="error">Не удалось обновить альбом.<br><br>${getErrorMessage(error)}</div>`;
    }
}

export function initPhotos({ onOpenPhoto } = {}) {
    if (initialized) return;
    initialized = true;
    openPhotoHandler = onOpenPhoto || null;

    let searchTimer = 0;
    dom.photoSearch?.addEventListener("input", event => {
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => setPhotoSearch(event.target.value), 100);
    });

    dom.clearPhotoSearch?.addEventListener("click", () => {
        if (dom.photoSearch) {
            dom.photoSearch.value = "";
            dom.photoSearch.focus();
        }
        setPhotoSearch("");
    });

    dom.sortNewestButton?.addEventListener("click", () => {
        state.photoSortMode = "newest";
        renderPhotos({ reset: true });
    });
    dom.sortOldestButton?.addEventListener("click", () => {
        state.photoSortMode = "oldest";
        renderPhotos({ reset: true });
    });
    dom.sortCurrentButton?.addEventListener("click", () => {
        state.photoSortMode = "vk";
        renderPhotos({ reset: true });
    });

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll, { passive: true });
}
