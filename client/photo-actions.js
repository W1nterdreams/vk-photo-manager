import { state } from "./state.js?v=20260928-client02";
import { dom } from "./dom.js?v=20260928-client02";
import { getOwnerId } from "./group-context.js?v=20260928-client02";
import { searchTokens, matchesAllTokens, getPhotoPreviewUrl, formatPhotoDate } from "./helpers.js?v=20260928-client02";
import { pushGlobalSearchHistory, showGlobalSearchScreen } from "./navigation.js?v=20260928-client02";
import { getIndexSnapshot, replaceIndexedAlbum, removeDisallowedAlbums, updateIndexMeta } from "./photo-index-db.js?v=20260928-client02";
import { getFreshAlbumPhotos } from "./photos.js?v=20260928-client02";
import { loadAllowedAlbums } from "./albums.js?v=20260928-client02";
import { bindPhotoLongPress } from "./photo-actions.js?v=20260928-client02";

const RENDER_BATCH = 100;
let initialized = false;
let syncing = false;
let searchTimer = 0;
let openPhotoHandler = null;

function allowedIds() {
    return state.config?.allowed_album_ids || [];
}

function signature() {
    return allowedIds().join(",");
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

function filterMatches() {
    const tokens = searchTokens(state.globalQuery || "");
    if (!tokens.length) return [];

    return (state.globalMatchesSource || [])
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
    const card = document.createElement("button");
    card.type = "button";
    card.className = "client-global-photo-card";

    const preview = getPhotoPreviewUrl(photo, 320);
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
        badge.className = "client-global-photo-date";
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
    if (!matches.length) return;
    const start = Number(state.globalRenderedCount || 0);
    const end = Math.min(matches.length, start + RENDER_BATCH);
    const fragment = document.createDocumentFragment();
    for (let i = start; i < end; i += 1) fragment.appendChild(createResultCard(matches[i]));
    state.globalRenderedCount = end;
    dom.globalSearchResults.appendChild(fragment);
}

export function renderGlobalSearch({ reset = true } = {}) {
    dom.clearGlobalPhotoSearch?.classList.toggle("hidden", !state.globalQuery);

    if (reset) {
        state.globalMatches = filterMatches();
        state.globalRenderedCount = 0;
        dom.globalSearchResults.innerHTML = "";
    }

    const tokens = searchTokens(state.globalQuery || "");
    if (!tokens.length) {
        dom.globalSearchResults.innerHTML = '<div class="client-global-search-empty">Введите одно или несколько слов.<br>Будут найдены фотографии, где присутствуют все введённые слова.</div>';
        updateStatus(syncing ? "Поисковый индекс обновляется…" : `В индексе: ${(state.globalMatchesSource || []).length} фото`);
        return;
    }

    if (!state.globalMatches.length) {
        dom.globalSearchResults.innerHTML = '<div class="client-global-search-empty">Ничего не найдено</div>';
        updateStatus(syncing ? "Ничего не найдено · индекс обновляется…" : "Ничего не найдено");
        return;
    }

    appendResults();
    const shown = Math.min(state.globalRenderedCount, state.globalMatches.length);
    updateStatus(`${syncing ? "Индекс обновляется · " : ""}Найдено ${state.globalMatches.length}. Показано ${shown}.`);
}

async function hydrateIndex() {
    const ownerId = getOwnerId();
    const snap = await getIndexSnapshot(ownerId, allowedIds());
    state.globalMatchesSource = snap.items || [];
    return snap;
}

function metadataCheckDue(meta, forceCheck) {
    if (forceCheck) return true;
    if (!Number(state.albumsFetchedAt || 0)) return true;
    const last = Math.max(Number(meta?.lastMetadataCheck || 0), Number(state.albumsFetchedAt || 0));
    return Date.now() - last >= checkIntervalMs();
}

export async function synchronizeGlobalIndex({ forceCheck = false } = {}) {
    if (syncing) return false;
    syncing = true;

    try {
        const ownerId = getOwnerId();
        const sig = signature();
        let snap = await getIndexSnapshot(ownerId, allowedIds());
        const oldFingerprints = { ...(snap.meta?.albumFingerprints || {}) };

        await removeDisallowedAlbums(ownerId, allowedIds());

        const needMetadata = metadataCheckDue(snap.meta, forceCheck) ||
            snap.meta?.allowedSignature !== sig ||
            !snap.meta?.complete;

        if (needMetadata) {
            updateStatus("Проверяем актуальность альбомов…");
            // Один photos.getAlbums на каждые 1000 разрешённых album_id.
            await loadAllowedAlbums({ force: true });
        }

        const albums = allowedIds().map(id => albumById(id)).filter(Boolean);
        const currentFingerprints = Object.fromEntries(
            albums.map(album => [String(Number(album.id)), albumFingerprint(album)])
        );

        const nextFingerprints = {};
        let failed = 0;
        let changed = 0;

        for (const album of albums) {
            const key = String(Number(album.id));
            const fingerprint = currentFingerprints[key];
            const alreadyIndexed = Boolean(oldFingerprints[key]);
            const needsAlbumSync = !alreadyIndexed || oldFingerprints[key] !== fingerprint;

            if (!needsAlbumSync) {
                nextFingerprints[key] = oldFingerprints[key];
                continue;
            }

            changed += 1;
            updateStatus(`Обновляем поиск: ${album.title || `альбом ${album.id}`}…`);

            try {
                // Если альбом уже был только что открыт пользователем, это 0 API.
                // Иначе типичный альбом до 1000 фото = 1 photos.get.
                const photos = await getFreshAlbumPhotos(album, { force: false });
                await replaceIndexedAlbum(ownerId, album.id, photos);
                nextFingerprints[key] = fingerprint;
            } catch (error) {
                failed += 1;
                if (oldFingerprints[key]) nextFingerprints[key] = oldFingerprints[key];
                console.warn(`Не удалось обновить альбом ${album.id} для глобального поиска:`, error);
            }
        }

        const complete = failed === 0 && albums.every(album => {
            const key = String(Number(album.id));
            return nextFingerprints[key] === currentFingerprints[key];
        });

        await updateIndexMeta(ownerId, {
            complete,
            allowedSignature: sig,
            albumFingerprints: nextFingerprints,
            lastMetadataCheck: Math.max(Date.now(), Number(state.albumsFetchedAt || 0))
        });

        snap = await hydrateIndex();
        await updateIndexMeta(ownerId, { total: snap.items.length });
        renderGlobalSearch({ reset: true });

        if (failed) {
            updateStatus(`Индекс обновлён частично: ${failed} альбом(а/ов) не удалось получить.`);
        } else if (!changed) {
            updateStatus(state.globalQuery
                ? `Найдено ${state.globalMatches.length}. Данные актуальны.`
                : `В индексе: ${state.globalMatchesSource.length} фото · изменений нет`);
        }

        return complete;
    } catch (error) {
        console.warn("Не удалось синхронизировать глобальный поиск:", error);
        updateStatus("Не удалось обновить поисковый индекс. Используются сохранённые данные.");
        return false;
    } finally {
        syncing = false;
    }
}

export async function openGlobalSearch({ fromHistory = false } = {}) {
    if (!fromHistory) pushGlobalSearchHistory();
    showGlobalSearchScreen({ restoreScroll: state.globalScrollTop || 0 });

    if (dom.globalPhotoSearch && dom.globalPhotoSearch.value !== state.globalQuery) {
        dom.globalPhotoSearch.value = state.globalQuery;
    }

    try {
        const snap = await hydrateIndex();
        renderGlobalSearch({ reset: true });

        const shouldCheck = !snap.meta?.complete ||
            snap.meta?.allowedSignature !== signature() ||
            Date.now() - Number(snap.meta?.lastMetadataCheck || 0) >= checkIntervalMs();

        if (shouldCheck) void synchronizeGlobalIndex({ forceCheck: false });
    } catch (error) {
        console.warn("Не удалось прочитать локальный поисковый индекс:", error);
        state.globalMatchesSource = [];
        renderGlobalSearch({ reset: true });
        void synchronizeGlobalIndex({ forceCheck: true });
    }
}

export async function refreshGlobalSearch() {
    await synchronizeGlobalIndex({ forceCheck: true });
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
        }, 120);
    });

    dom.clearGlobalPhotoSearch?.addEventListener("click", () => {
        state.globalQuery = "";
        if (dom.globalPhotoSearch) {
            dom.globalPhotoSearch.value = "";
            dom.globalPhotoSearch.focus();
        }
        renderGlobalSearch({ reset: true });
    });

    dom.globalSearchResults?.addEventListener("scroll", () => {
        state.globalScrollTop = Number(dom.globalSearchResults.scrollTop || 0);
        if (state.globalRenderedCount >= state.globalMatches.length) return;
        const nearBottom = dom.globalSearchResults.scrollTop + dom.globalSearchResults.clientHeight >= dom.globalSearchResults.scrollHeight - 700;
        if (nearBottom) {
            appendResults();
            const shown = Math.min(state.globalRenderedCount, state.globalMatches.length);
            updateStatus(`${syncing ? "Индекс обновляется · " : ""}Найдено ${state.globalMatches.length}. Показано ${shown}.`);
        }
    }, { passive: true });
}
