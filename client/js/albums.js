import { state } from "./state.js?v=20260929-client07-contextfix";
import { dom } from "./dom.js?v=20260929-client07-contextfix";
import { vkApi } from "./vk-api.js?v=20260929-client07-contextfix";
import { getAlbumCover, matchesAllTokens, searchTokens } from "./helpers.js?v=20260929-client07-contextfix";
import { getOwnerId, usesRestrictedAlbums, getConfiguredHomeAlbumIds } from "./group-context.js?v=20260929-client07-contextfix";

const ALL_ALBUMS_PAGE_SIZE = 1000;
const MAX_ALBUM_PAGES = 100;

let initialized = false;
let openAlbumHandler = null;

function restrictionSignature() {
    return usesRestrictedAlbums() ? getConfiguredHomeAlbumIds().join(",") : "all";
}

function cacheKey() {
    return `vk-photo-client:albums:v3:${state.ownerId}:${restrictionSignature()}`;
}

function loadCache() {
    try {
        const raw = localStorage.getItem(cacheKey());
        if (!raw) return null;
        const value = JSON.parse(raw);
        if (!Array.isArray(value?.items)) return null;
        return value;
    } catch {
        return null;
    }
}

function saveCache(items) {
    try {
        localStorage.setItem(cacheKey(), JSON.stringify({ savedAt: Date.now(), items }));
    } catch {}
}

function metadataTtlMs() {
    return Math.max(60_000, Number(state.config?.album_metadata_ttl_minutes || 30) * 60_000);
}

function uniqueAlbums(items) {
    const seen = new Set();
    const result = [];
    for (const album of Array.isArray(items) ? items : []) {
        const id = Number(album?.id || 0);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        result.push(album);
    }
    return result;
}

function normalizeAlbumsForCurrentGroup(items) {
    const unique = uniqueAlbums(items);
    if (!usesRestrictedAlbums()) return unique;

    const ids = getConfiguredHomeAlbumIds();
    const order = new Map(ids.map((id, index) => [Number(id), index]));
    return unique
        .filter(album => order.has(Number(album?.id)))
        .sort((a, b) => Number(order.get(Number(a.id))) - Number(order.get(Number(b.id))));
}

async function fetchRestrictedAlbums() {
    // Не передаём album_ids в photos.getAlbums. В некоторых контекстах
    // VKWebAppCallAPIMethod отклоняет массив значений с ошибкой
    // `album_ids not integer`. Один раз получаем список альбомов сообщества
    // обычной пагинацией и фильтруем его локально по home_group_album_ids.
    // Для сообщества с <1000 альбомов это по-прежнему ровно 1 вызов API.
    return fetchAllAlbums();
}

async function fetchAllAlbums() {
    const ownerId = getOwnerId();
    const all = [];
    let offset = 0;
    let total = Infinity;

    for (let page = 0; page < MAX_ALBUM_PAGES && offset < total; page += 1) {
        const response = await vkApi("photos.getAlbums", {
            owner_id: ownerId,
            need_system: 0,
            need_covers: 1,
            photo_sizes: 1,
            count: ALL_ALBUMS_PAGE_SIZE,
            offset
        });

        const items = Array.isArray(response?.items) ? response.items : [];
        const reported = Number(response?.count);
        if (Number.isFinite(reported) && reported >= 0) total = reported;

        all.push(...items);
        offset += items.length;

        if (!items.length || items.length < ALL_ALBUMS_PAGE_SIZE) break;
    }

    return normalizeAlbumsForCurrentGroup(all);
}

async function fetchAlbumsForCurrentGroup() {
    return usesRestrictedAlbums() ? fetchRestrictedAlbums() : fetchAllAlbums();
}

export function getSearchAlbumIds() {
    return state.albums
        .map(album => Number(album?.id || 0))
        .filter(id => Number.isInteger(id) && id > 0);
}

export async function loadSearchAlbums({ force = false } = {}) {
    if (usesRestrictedAlbums() && !getConfiguredHomeAlbumIds().length) {
        state.albums = [];
        renderAlbums();
        return [];
    }

    const cached = loadCache();
    const cacheFresh = cached && Date.now() - Number(cached.savedAt || 0) < metadataTtlMs();

    if (!force && cached?.items?.length) {
        state.albums = normalizeAlbumsForCurrentGroup(cached.items);
        renderAlbums();
        if (cacheFresh) return state.albums;
    }

    if (!cached?.items?.length || force) {
        dom.albums.innerHTML = `<div class="status-message">${force ? "Обновляем альбомы..." : "Загружаем альбомы..."}</div>`;
    }

    try {
        const items = await fetchAlbumsForCurrentGroup();
        state.albums = items;
        state.albumsFetchedAt = Date.now();
        saveCache(items);
        renderAlbums();
        return items;
    } catch (error) {
        if (cached?.items?.length) {
            state.albums = normalizeAlbumsForCurrentGroup(cached.items);
            renderAlbums();
            console.warn("Не удалось обновить альбомы, используем локальный список:", error);
            if (!force) return state.albums;
        }
        throw error;
    }
}

// Совместимый экспорт для старых импортов/кэшей модулей.
export const loadAllowedAlbums = loadSearchAlbums;

export function updateAlbumMetadataFromPhotos(albumId, photoCount) {
    const id = Number(albumId);
    state.albums = state.albums.map(album => Number(album.id) === id
        ? { ...album, size: Math.max(0, Number(photoCount || 0)) }
        : album
    );
    saveCache(state.albums);
}

export function getFilteredAlbums() {
    const tokens = searchTokens(state.albumSearchText || "");
    if (!tokens.length) return state.albums;

    return state.albums.filter(album => matchesAllTokens(
        `${album?.title || ""} ${album?.description || ""}`,
        tokens
    ));
}

function createAlbumCard(album) {
    const card = document.createElement("div");
    card.className = "album-card";

    const cover = getAlbumCover(album);
    if (cover) {
        const img = document.createElement("img");
        img.className = "album-cover";
        img.src = cover;
        img.alt = album.title || "";
        img.loading = "lazy";
        img.decoding = "async";
        card.appendChild(img);
    } else {
        const placeholder = document.createElement("div");
        placeholder.className = "album-placeholder";
        placeholder.textContent = "▣";
        card.appendChild(placeholder);
    }

    const info = document.createElement("div");
    info.className = "album-info";

    const name = document.createElement("div");
    name.className = "album-name";
    name.textContent = album.title || "Без названия";

    const count = document.createElement("div");
    count.className = "album-count";
    count.textContent = String(Number(album.size || 0));

    info.append(name, count);
    card.appendChild(info);

    card.addEventListener("click", () => {
        if (typeof openAlbumHandler === "function") void openAlbumHandler(album);
    });

    return card;
}

export function renderAlbums() {
    if (!dom.albums) return;

    // Если введён запрос по фотографиям, главный экран показывает
    // результаты фото-поиска, а не карточки альбомов.
    if (searchTokens(state.globalQuery || "").length) {
        dom.albums.classList.add("hidden");
        return;
    }

    dom.albums.classList.remove("hidden");
    dom.albums.innerHTML = "";

    if (usesRestrictedAlbums() && !getConfiguredHomeAlbumIds().length) {
        dom.albums.innerHTML = `
            <div class="status-message client-config-message">
                Для нашей группы список альбомов пока пуст.<br><br>
                Добавьте ID в <b>config.json</b> → <b>home_group_album_ids</b>.
            </div>`;
        return;
    }

    const list = getFilteredAlbums();
    if (!list.length) {
        dom.albums.innerHTML = `<div class="status-message">${state.albumSearchText ? "Альбомы не найдены" : "Доступные альбомы не найдены"}</div>`;
        return;
    }

    const fragment = document.createDocumentFragment();
    list.forEach(album => fragment.appendChild(createAlbumCard(album)));
    dom.albums.appendChild(fragment);
}

export function initAlbums({ onOpenAlbum } = {}) {
    if (initialized) return;
    initialized = true;
    openAlbumHandler = onOpenAlbum || null;

    let timer = 0;
    dom.albumSearch?.addEventListener("input", event => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
            state.albumSearchText = String(event.target.value || "");
            dom.clearAlbumSearch?.classList.toggle("hidden", !state.albumSearchText);
            renderAlbums();
            window.dispatchEvent(new CustomEvent("client-album-filter-changed"));
        }, 100);
    });

    dom.clearAlbumSearch?.addEventListener("click", () => {
        state.albumSearchText = "";
        if (dom.albumSearch) {
            dom.albumSearch.value = "";
            dom.albumSearch.focus();
        }
        dom.clearAlbumSearch.classList.add("hidden");
        renderAlbums();
        window.dispatchEvent(new CustomEvent("client-album-filter-changed"));
    });
}
