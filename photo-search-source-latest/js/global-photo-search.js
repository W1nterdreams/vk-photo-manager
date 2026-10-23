import { state } from "./state.js?v=20260929-client12-privacy";
import { dom } from "./dom.js?v=20260929-client12-privacy";
import { searchTokens, matchesAllTokens, getPhotoPreviewUrl, formatPhotoDate } from "./helpers.js?v=20260929-client12-privacy";
import { getFilteredAlbums, renderAlbums } from "./albums.js?v=20260929-client12-privacy";
import { getFreshAlbumPhotos } from "./photos.js?v=20260929-client12-privacy";
import { bindPhotoLongPress } from "./photo-actions.js?v=20260929-client12-privacy";

// На телефоне две колонки × пять строк дают первую порцию примерно из 10 фото.
const RENDER_BATCH = 10;
const LOAD_CONCURRENCY = 3;

let initialized = false;
let loading = false;
let pendingReload = false;
let pendingForce = false;
let searchTimer = 0;
let albumFilterTimer = 0;
let scrollTicking = false;
let openPhotoHandler = null;

function targetAlbums() {
    return getFilteredAlbums();
}

function targetAlbumIds() {
    return targetAlbums()
        .map(album => Number(album?.id || 0))
        .filter(id => Number.isInteger(id) && id !== 0);
}

function albumById(id) {
    return state.albums.find(album => Number(album.id) === Number(id)) || null;
}

function photoSearchActive() {
    return searchTokens(state.globalQuery || "").length > 0;
}

function setSearchMode(active) {
    dom.albums?.classList.toggle("hidden", active);
    dom.globalSearchResults?.classList.toggle("hidden", !active);
    dom.globalSearchStatus?.classList.toggle("hidden", !active);
}

function updateStatus(message = "") {
    if (dom.globalSearchStatus) dom.globalSearchStatus.textContent = message;
}

function sourceFromSession(ids = targetAlbumIds()) {
    const result = [];
    for (const albumId of ids) {
        const entry = state.sessionPhotosByAlbum.get(Number(albumId));
        if (Array.isArray(entry?.photos)) result.push(...entry.photos);
    }
    state.globalMatchesSource = result;
    return result;
}

function filterMatches() {
    const tokens = searchTokens(state.globalQuery || "");
    if (!tokens.length) return [];

    const allowedAlbums = new Set(targetAlbumIds());
    if (!allowedAlbums.size) return [];

    return (state.globalMatchesSource || [])
        .filter(photo => allowedAlbums.has(Number(photo?.album_id || 0)))
        .filter(photo => matchesAllTokens(photo?.text || "", tokens))
        .sort((a, b) => {
            const date = Number(b?.date || 0) - Number(a?.date || 0);
            return date || Number(b?.id || 0) - Number(a?.id || 0);
        });
}

function createResultCard(photo) {
    const card = document.createElement("div");
    card.className = "photo-card client-search-photo-card";
    card.dataset.photoId = String(photo.id);

    const preview = getPhotoPreviewUrl(photo, 360);
    if (preview) {
        const img = document.createElement("img");
        img.src = preview;
        img.alt = photo.text || "";
        img.loading = "lazy";
        img.decoding = "async";
        card.appendChild(img);
    }

    const date = formatPhotoDate(photo.date);
    if (date) {
        const badge = document.createElement("span");
        badge.className = "photo-card-date";
        badge.textContent = date;
        card.appendChild(badge);
    }

    const album = albumById(photo.album_id);
    const label = document.createElement("span");
    label.className = "client-global-photo-album";
    label.textContent = album?.title || `Альбом ${photo.album_id}`;
    card.appendChild(label);

    bindPhotoLongPress(card, photo);

    card.addEventListener("click", event => {
        if (Date.now() < Number(state.suppressPhotoOpenUntil || 0)) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (typeof openPhotoHandler !== "function") return;
        void openPhotoHandler(photo, album || {
            id: photo.album_id,
            owner_id: photo.owner_id,
            title: label.textContent
        }, {
            sequence: state.globalMatches,
            viewerSource: "global-search"
        });
    });

    return card;
}

function appendResults() {
    const matches = state.globalMatches || [];
    if (!matches.length || !dom.globalSearchResults) return;
    const start = Number(state.globalRenderedCount || 0);
    const end = Math.min(matches.length, start + RENDER_BATCH);
    const fragment = document.createDocumentFragment();
    for (let i = start; i < end; i += 1) fragment.appendChild(createResultCard(matches[i]));
    state.globalRenderedCount = end;
    dom.globalSearchResults.appendChild(fragment);
}

export function renderGlobalSearch({ reset = true } = {}) {
    dom.clearGlobalPhotoSearch?.classList.toggle("hidden", !state.globalQuery);

    if (!photoSearchActive()) {
        setSearchMode(false);
        state.globalMatches = [];
        state.globalRenderedCount = 0;
        if (dom.globalSearchResults) dom.globalSearchResults.innerHTML = "";
        updateStatus("");
        renderAlbums();
        return;
    }

    setSearchMode(true);

    if (reset) {
        sourceFromSession();
        state.globalMatches = filterMatches();
        state.globalRenderedCount = 0;
        if (dom.globalSearchResults) dom.globalSearchResults.innerHTML = "";
    }

    const ids = targetAlbumIds();
    if (!ids.length) {
        dom.globalSearchResults.innerHTML = '<div class="client-global-search-empty">По запросу альбомов ничего не найдено</div>';
        updateStatus("Нет альбомов для поиска фотографий");
        return;
    }

    if (!state.globalMatches.length) {
        dom.globalSearchResults.innerHTML = '<div class="client-global-search-empty">Фотографии не найдены</div>';
        updateStatus(loading ? "Загружаем фотографии для поиска…" : "Ничего не найдено");
        return;
    }

    appendResults();
    const shown = Math.min(state.globalRenderedCount, state.globalMatches.length);
    const albumScope = searchTokens(state.albumSearchText || "").length ? ` · альбомов: ${ids.length}` : "";
    updateStatus(`${loading ? "Загружаем данные · " : ""}Найдено ${state.globalMatches.length}. Показано ${shown}${albumScope}.`);
}

async function runPool(items, worker, concurrency = LOAD_CONCURRENCY) {
    let cursor = 0;
    const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor++;
            await worker(items[index], index);
        }
    });
    await Promise.all(runners);
}

async function loadTargetAlbumsIntoMemory({ force = false } = {}) {
    if (!photoSearchActive()) return false;
    if (loading) {
        pendingReload = true;
        pendingForce = pendingForce || force;
        return false;
    }

    const albums = targetAlbums();
    if (!albums.length) {
        sourceFromSession([]);
        renderGlobalSearch({ reset: true });
        return true;
    }

    loading = true;
    pendingReload = false;
    pendingForce = false;

    let completed = 0;
    let failed = 0;
    try {
        const toLoad = force
            ? albums
            : albums.filter(album => !state.sessionPhotosByAlbum.has(Number(album.id)));

        if (!toLoad.length) {
            sourceFromSession();
            renderGlobalSearch({ reset: true });
            return true;
        }

        updateStatus(`Подготавливаем поиск: 0 из ${toLoad.length} альбомов…`);

        await runPool(toLoad, async album => {
            try {
                await getFreshAlbumPhotos(album, { force, showCached: false });
            } catch (error) {
                failed += 1;
                console.warn(`Не удалось загрузить альбом ${album.id} для поиска:`, error);
            } finally {
                completed += 1;
                sourceFromSession();
                renderGlobalSearch({ reset: true });
                updateStatus(`Подготавливаем поиск: ${completed} из ${toLoad.length} альбомов${failed ? ` · ошибок: ${failed}` : ""}…`);
            }
        });

        sourceFromSession();
        renderGlobalSearch({ reset: true });
        if (failed) {
            updateStatus(`Поиск подготовлен частично: ${failed} альбом(а/ов) не удалось получить.`);
        }
        return failed === 0;
    } finally {
        loading = false;
        if (pendingReload && photoSearchActive()) {
            const forceNext = pendingForce;
            pendingReload = false;
            pendingForce = false;
            queueMicrotask(() => { void loadTargetAlbumsIntoMemory({ force: forceNext }); });
        } else {
            renderGlobalSearch({ reset: true });
        }
    }
}

async function refreshSearchData() {
    if (!photoSearchActive()) {
        renderGlobalSearch({ reset: true });
        return;
    }

    sourceFromSession();
    renderGlobalSearch({ reset: true });
    await loadTargetAlbumsIntoMemory({ force: false });
}

export async function refreshGlobalSearch() {
    if (!photoSearchActive()) return;
    await loadTargetAlbumsIntoMemory({ force: true });
}

function nearBottom(distance = 800) {
    const root = document.scrollingElement || document.documentElement;
    return window.innerHeight + window.scrollY >= Number(root?.scrollHeight || 0) - distance;
}

function handleWindowScroll() {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(() => {
        scrollTicking = false;
        if (state.currentScreen !== "albums" || !photoSearchActive()) return;
        if (state.globalRenderedCount >= state.globalMatches.length || !nearBottom()) return;
        appendResults();
        const shown = Math.min(state.globalRenderedCount, state.globalMatches.length);
        updateStatus(`${loading ? "Загружаем данные · " : ""}Найдено ${state.globalMatches.length}. Показано ${shown}.`);
    });
}

export function initGlobalPhotoSearch({ onOpenPhoto } = {}) {
    if (initialized) return;
    initialized = true;
    openPhotoHandler = onOpenPhoto || null;
    state.globalMatchesSource = [];

    dom.globalPhotoSearch?.addEventListener("input", event => {
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => {
            state.globalQuery = String(event.target.value || "");
            renderGlobalSearch({ reset: true });
            if (photoSearchActive()) void refreshSearchData();
        }, 180);
    });

    dom.clearGlobalPhotoSearch?.addEventListener("click", () => {
        state.globalQuery = "";
        if (dom.globalPhotoSearch) {
            dom.globalPhotoSearch.value = "";
            dom.globalPhotoSearch.focus();
        }
        renderGlobalSearch({ reset: true });
    });

    window.addEventListener("client-album-filter-changed", () => {
        if (!photoSearchActive()) return;
        window.clearTimeout(albumFilterTimer);
        albumFilterTimer = window.setTimeout(() => {
            renderGlobalSearch({ reset: true });
            void refreshSearchData();
        }, 120);
    });

    window.addEventListener("scroll", handleWindowScroll, { passive: true });
    window.addEventListener("resize", handleWindowScroll, { passive: true });
}
