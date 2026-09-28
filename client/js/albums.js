import { state } from "./state.js?v=20260928-client02";
import { dom } from "./dom.js?v=20260928-client02";
import { vkApi } from "./vk-api.js?v=20260928-client02";
import { getAlbumCover, matchesAllTokens, searchTokens, getErrorMessage } from "./helpers.js?v=20260928-client02";
import { getOwnerId } from "./group-context.js?v=20260928-client02";
import { pushAlbumHistory, showPhotosScreen } from "./navigation.js?v=20260928-client02";

const MAX_ALBUM_IDS_PER_REQUEST = 1000;
let initialized = false;
let openAlbumHandler = null;

function idsSignature() {
    return (state.config?.allowed_album_ids || []).join(",");
}

function cacheKey() {
    return `vk-photo-client:albums:v1:${state.groupId}:${idsSignature()}`;
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

function orderedAllowedAlbums(items) {
    const order = new Map((state.config?.allowed_album_ids || []).map((id, index) => [Number(id), index]));
    return [...items]
        .filter(album => order.has(Number(album?.id)))
        .sort((a, b) => Number(order.get(Number(a.id))) - Number(order.get(Number(b.id))));
}

async function fetchAllowedAlbums() {
    const ids = state.config?.allowed_album_ids || [];
    if (!ids.length) return [];

    const ownerId = getOwnerId();
    const all = [];

    for (let offset = 0; offset < ids.length; offset += MAX_ALBUM_IDS_PER_REQUEST) {
        const chunk = ids.slice(offset, offset + MAX_ALBUM_IDS_PER_REQUEST);
        const response = await vkApi("photos.getAlbums", {
            owner_id: ownerId,
            album_ids: chunk,
            need_system: 0,
            need_covers: 1,
            photo_sizes: 1
        });
        all.push(...(Array.isArray(response?.items) ? response.items : []));
    }

    return orderedAllowedAlbums(all);
}

export async function loadAllowedAlbums({ force = false } = {}) {
    const ids = state.config?.allowed_album_ids || [];

    if (!ids.length) {
        state.albums = [];
        renderAlbums();
        return [];
    }

    const cached = loadCache();
    const cacheFresh = cached && Date.now() - Number(cached.savedAt || 0) < metadataTtlMs();

    if (!force && cached?.items?.length) {
        state.albums = orderedAllowedAlbums(cached.items);
        renderAlbums();
        if (cacheFresh) return state.albums;
    }

    if (!cached?.items?.length || force) {
        dom.albums.innerHTML = `<div class="status-message">${force ? "Обновляем альбомы..." : "Загружаем альбомы..."}</div>`;
    }

    try {
        const items = await fetchAllowedAlbums();
        state.albums = items;
        state.albumsFetchedAt = Date.now();
        saveCache(items);
        renderAlbums();
        return items;
    } catch (error) {
        if (cached?.items?.length) {
            state.albums = orderedAllowedAlbums(cached.items);
            renderAlbums();
            console.warn("Не удалось обновить альбомы, используем локальный список:", error);
            if (!force) return state.albums;
        }
        throw error;
    }
}

export function updateAlbumMetadataFromPhotos(albumId, photoCount) {
    const id = Number(albumId);
    state.albums = state.albums.map(album => Number(album.id) === id
        ? { ...album, size: Math.max(0, Number(photoCount || 0)) }
        : album
    );
    saveCache(state.albums);
}

function filteredAlbums() {
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
    dom.albums.innerHTML = "";

    if (!(state.config?.allowed_album_ids || []).length) {
        dom.albums.innerHTML = `
            <div class="status-message client-config-message">
                Список клиентских альбомов пока пуст.<br><br>
                Добавьте ID разрешённых альбомов в <b>config.json</b> → <b>allowed_album_ids</b>.
            </div>`;
        return;
    }

    const list = filteredAlbums();
    if (!list.length) {
        dom.albums.innerHTML = `<div class="status-message">${state.albumSearchText ? "Альбомы не найдены" : "Разрешённые альбомы недоступны"}</div>`;
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
    });
}
