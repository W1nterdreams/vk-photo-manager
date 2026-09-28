import { state } from "./state.js?v=20260928-client05-dualsearch";
import { dom } from "./dom.js?v=20260928-client05-dualsearch";
import { getOwnerId, usesRestrictedAlbums } from "./group-context.js?v=20260928-client05-dualsearch";
import { searchTokens, matchesAllTokens, getPhotoPreviewUrl, formatPhotoDate } from "./helpers.js?v=20260928-client05-dualsearch";
import { getIndexSnapshot, replaceIndexedAlbum, removeDisallowedAlbums, updateIndexMeta } from "./photo-index-db.js?v=20260928-client05-dualsearch";
import { getFreshAlbumPhotos } from "./photos.js?v=20260928-client05-dualsearch";
import { loadSearchAlbums, getSearchAlbumIds, getFilteredAlbums, renderAlbums } from "./albums.js?v=20260928-client05-dualsearch";
import { bindPhotoLongPress } from "./photo-actions.js?v=20260928-client05-dualsearch";

// На телефоне две колонки × пять строк дают первую порцию примерно из 10 фото.
const RENDER_BATCH = 10;
let initialized = false;
let syncing = false;
let pendingSync = false;
let searchTimer = 0;
let albumFilterTimer = 0;
let scrollTicking = false;
let openPhotoHandler = null;

function allSearchAlbumIds() {
    return getSearchAlbumIds();
}

function targetAlbums() {
    return getFilteredAlbums();
}

function targetAlbumIds() {
    return targetAlbums()
        .map(album => Number(album?.id || 0))
        .filter(id => Number.isInteger(id) && id > 0);
}

function signature() {
    const mode = usesRestrictedAlbums() ? "restricted" : "all";
    return `${state.groupId}:${mode}:${allSearchAlbumIds().join(",")}`;
}

function checkIntervalMs() {
    return Math.max(5 * 60_000, Number(state.config?.global_index_check_minutes || 30) * 60_000);
}

function albumById(id) {
    return state.albums.find(album => Number(album.id) === Number(id)) || null;
}

function albumFingerprint(album) {
    if (!album?.id) return "";
    return [
        Number(album.id || 0),
        Number(album.updated || 0),
        Number(album.size || 0),
        Number(album.thumb_id || 0)
    ].join(":");
}

function photoSearchActive() {
    return searchTokens(state.globalQuery || "").length > 0;
}

function setSearchMode(active) {
    dom.albums?.classList.toggle("hidden", active);
    dom.globalSearchResults?.classList.toggle("hidden", !active);
    dom.globalSearchStatus?.classList.toggle("hidden", !active);
}

function filterMatches() {
    const tokens = searchTokens(state.globalQuery || "");
    if (!tokens.length) return [];

    const allowedAlbums = new Set(targetAlbumIds());
    if (!allowedAlbums.size) return [];

    return (state.globalMatchesSource || [])
        .filter(photo => allowedAlbums.has(Number(photo?.album_id || 0)))
        .filter(photo => matchesAllTokens(photo?.search_text || photo?.text || "", tokens))
        .sort((a, b) => {
            const date = Number(b?.date || 0) - Number(a?.date || 0);
            return date || Number(b?.id || 0) - Number(a?.id || 0);
        });
}

function updateStatus(message = "") {
    if (dom.globalSearchStatus) dom.globalSearchStatus.textContent = message;
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
        state.globalMatches = filterMatches();
        state.globalRenderedCount = 0;
        dom.globalSearchResults.innerHTML = "";
    }

    if (!targetAlbumIds().length) {
        dom.globalSearchResults.innerHTML = '<div class="client-global-search-empty">По запросу альбомов ничего не найдено</div>';
        updateStatus("Нет альбомов для поиска фотографий");
        return;
    }

    if (!state.globalMatches.length) {
        dom.globalSearchResults.innerHTML = '<div class="client-global-search-empty">Фотографии не найдены</div>';
        updateStatus(syncing ? "Идёт обновление поиска…" : "Ничего не найдено");
        return;
    }

    appendResults();
    const shown = Math.min(state.globalRenderedCount, state.globalMatches.length);
    const albumScope = searchTokens(state.albumSearchText || "").length
        ? ` · альбомов: ${targetAlbumIds().length}`
        : "";
    updateStatus(`${syncing ? "Обновляем индекс · " : ""}Найдено ${state.globalMatches.length}. Показано ${shown}${albumScope}.`);
}

async function hydrateIndex(ids = targetAlbumIds()) {
    const ownerId = getOwnerId();
    const snap = await getIndexSnapshot(ownerId, ids);
    state.globalMatchesSource = snap.items || [];
    return snap;
}

function metadataCheckDue(meta, forceCheck) {
    if (forceCheck) return true;
    if (!Number(state.albumsFetchedAt || 0)) return true;
    const last = Math.max(Number(meta?.lastMetadataCheck || 0), Number(state.albumsFetchedAt || 0));
    return Date.now() - last >= checkIntervalMs();
}

function currentFingerprintsFor(albums) {
    return Object.fromEntries(
        albums.map(album => [String(Number(album.id)), albumFingerprint(album)])
    );
}

export async function synchronizeGlobalIndex({ forceCheck = false } = {}) {
    if (!photoSearchActive()) return false;
    if (syncing) {
        pendingSync = true;
        return false;
    }

    syncing = true;
    pendingSync = false;

    try {
        const ownerId = getOwnerId();
        let fullIds = allSearchAlbumIds();
        let targetIds = targetAlbumIds();
        let snap = await getIndexSnapshot(ownerId, targetIds);
        let oldFingerprints = { ...(snap.meta?.albumFingerprints || {}) };
        const oldSignature = signature();

        const needMetadata = metadataCheckDue(snap.meta, forceCheck) ||
            snap.meta?.allowedSignature !== oldSignature;

        if (needMetadata) {
            updateStatus("Проверяем актуальность альбомов…");
            await loadSearchAlbums({ force: true });
            fullIds = allSearchAlbumIds();
            targetIds = targetAlbumIds();
            snap = await getIndexSnapshot(ownerId, targetIds);
            oldFingerprints = { ...(snap.meta?.albumFingerprints || {}) };
        }

        // Удаляем только действительно недоступные альбомы. Альбомы, временно
        // исключённые строкой "Поиск альбомов", из IndexedDB не удаляем.
        await removeDisallowedAlbums(ownerId, fullIds);

        const fullAlbums = fullIds.map(id => albumById(id)).filter(Boolean);
        const target = targetIds.map(id => albumById(id)).filter(Boolean);
        const fullFingerprints = currentFingerprintsFor(fullAlbums);

        const fullAllowedKeys = new Set(fullIds.map(id => String(Number(id))));
        const nextFingerprints = Object.fromEntries(
            Object.entries(oldFingerprints).filter(([key]) => fullAllowedKeys.has(key))
        );

        let failed = 0;
        let changed = 0;

        for (const album of target) {
            const key = String(Number(album.id));
            const fingerprint = fullFingerprints[key] || albumFingerprint(album);
            const needsAlbumSync = !nextFingerprints[key] || nextFingerprints[key] !== fingerprint;

            if (!needsAlbumSync) continue;

            changed += 1;
            updateStatus(`Обновляем поиск: ${album.title || `альбом ${album.id}`}…`);

            try {
                const photos = await getFreshAlbumPhotos(album, { force: false });
                await replaceIndexedAlbum(ownerId, album.id, photos);
                nextFingerprints[key] = fingerprint;
            } catch (error) {
                failed += 1;
                console.warn(`Не удалось обновить альбом ${album.id} для поиска:`, error);
            }
        }

        const complete = fullAlbums.length > 0 && fullAlbums.every(album => {
            const key = String(Number(album.id));
            return nextFingerprints[key] === fullFingerprints[key];
        });

        await updateIndexMeta(ownerId, {
            complete,
            allowedSignature: signature(),
            albumFingerprints: nextFingerprints,
            lastMetadataCheck: needMetadata ? Date.now() : Number(snap.meta?.lastMetadataCheck || 0)
        });

        snap = await hydrateIndex(targetIds);
        renderGlobalSearch({ reset: true });

        if (failed) {
            updateStatus(`Поиск обновлён частично: ${failed} альбом(а/ов) не удалось получить.`);
        } else if (!changed) {
            updateStatus(`Найдено ${state.globalMatches.length}. Данные уже были в локальном индексе.`);
        }

        return failed === 0;
    } catch (error) {
        console.warn("Не удалось синхронизировать поиск фотографий:", error);
        updateStatus("Не удалось обновить поисковый индекс. Используются сохранённые данные.");
        return false;
    } finally {
        syncing = false;
        if (pendingSync && photoSearchActive()) {
            pendingSync = false;
            queueMicrotask(() => { void synchronizeGlobalIndex({ forceCheck: false }); });
        }
    }
}

async function refreshSearchData({ forceCheck = false } = {}) {
    if (!photoSearchActive()) {
        renderGlobalSearch({ reset: true });
        return;
    }

    try {
        await hydrateIndex(targetAlbumIds());
        renderGlobalSearch({ reset: true });
    } catch (error) {
        console.warn("Не удалось прочитать локальный индекс:", error);
        state.globalMatchesSource = [];
        renderGlobalSearch({ reset: true });
    }

    void synchronizeGlobalIndex({ forceCheck });
}

export async function refreshGlobalSearch() {
    if (!photoSearchActive()) return;
    await synchronizeGlobalIndex({ forceCheck: true });
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
        updateStatus(`${syncing ? "Обновляем индекс · " : ""}Найдено ${state.globalMatches.length}. Показано ${shown}.`);
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
            if (photoSearchActive()) void refreshSearchData({ forceCheck: false });
        }, 140);
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
            void refreshSearchData({ forceCheck: false });
        }, 100);
    });

    window.addEventListener("scroll", handleWindowScroll, { passive: true });
    window.addEventListener("resize", handleWindowScroll, { passive: true });
}
