import { state } from "./state.js?v=20260929-client10-whitelist";
import { dom } from "./dom.js?v=20260929-client10-whitelist";
import { vkApi } from "./vk-api.js?v=20260929-client10-whitelist";
import { getAlbumCover, matchesAllTokens, searchTokens } from "./helpers.js?v=20260929-client10-whitelist";
import { getOwnerId, usesRestrictedAlbums, getConfiguredHomeAlbumIds } from "./group-context.js?v=20260929-client10-whitelist";

// Не полагаемся на незафиксированный большой размер страницы photos.getAlbums.
// 100 элементов + пагинация по response.count надёжно получает полный список.
const ALL_ALBUMS_PAGE_SIZE = 100;
const MAX_ALBUM_PAGES = 1000;

let initialized = false;
let openAlbumHandler = null;

function uniqueAlbums(items) {
    const seen = new Set();
    const result = [];
    for (const album of Array.isArray(items) ? items : []) {
        const id = Number(album?.id || 0);
        if (!Number.isInteger(id) || id === 0 || seen.has(id)) continue;
        seen.add(id);
        result.push(album);
    }
    return result;
}

function normalizeAlbumsForCurrentContext(items) {
    const unique = uniqueAlbums(items);
    if (!usesRestrictedAlbums()) return unique;

    const ids = getConfiguredHomeAlbumIds();
    const order = new Map(ids.map((id, index) => [Number(id), index]));
    return unique
        .filter(album => order.has(Number(album?.id)))
        .sort((a, b) => Number(order.get(Number(a.id))) - Number(order.get(Number(b.id))));
}

async function fetchAllAlbums() {
    const ownerId = getOwnerId();
    const all = [];
    let offset = 0;
    let total = null;

    for (let page = 0; page < MAX_ALBUM_PAGES; page += 1) {
        const response = await vkApi("photos.getAlbums", {
            owner_id: ownerId,
            // Для обычных групп и пользователей нужны также системные альбомы
            // (фото профиля/стены/сохранённые и т.п.). В домашней группе они
            // всё равно будут отброшены фильтром home_group_album_ids.
            need_system: 1,
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

        if (!items.length) break;
        if (total !== null && offset >= total) break;
        // Если count в ответе отсутствует, только тогда ориентируемся на размер страницы.
        if (total === null && items.length < ALL_ALBUMS_PAGE_SIZE) break;
    }

    return normalizeAlbumsForCurrentContext(all);
}

export function getSearchAlbumIds() {
    return state.albums
        .map(album => Number(album?.id || 0))
        .filter(id => Number.isInteger(id) && id !== 0);
}

export async function loadSearchAlbums({ force = false } = {}) {
    if (usesRestrictedAlbums() && !getConfiguredHomeAlbumIds().length) {
        state.albums = [];
        renderAlbums();
        return [];
    }

    // После верификации бизнес-профиля экономить один photos.getAlbums на
    // запуск нет смысла. Постоянный localStorage-кэш намеренно не используем:
    // каждый новый запуск получает список именно текущего владельца.
    dom.albums.innerHTML = `<div class="status-message">${force ? "Обновляем альбомы..." : "Загружаем альбомы..."}</div>`;

    const items = await fetchAllAlbums();
    state.albums = items;
    state.albumsFetchedAt = Date.now();
    renderAlbums();
    return items;
}

export const loadAllowedAlbums = loadSearchAlbums;

export function updateAlbumMetadataFromPhotos(albumId, photoCount) {
    const id = Number(albumId);
    state.albums = state.albums.map(album => Number(album.id) === id
        ? { ...album, size: Math.max(0, Number(photoCount || 0)) }
        : album
    );
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
    count.textContent = String(Math.max(0, Number(album.size || 0)));

    info.append(name, count);
    card.appendChild(info);

    card.addEventListener("click", () => {
        if (typeof openAlbumHandler === "function") void openAlbumHandler(album);
    });

    return card;
}

export function renderAlbums() {
    if (!dom.albums) return;

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
