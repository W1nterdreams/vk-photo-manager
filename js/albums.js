import { state } from "./state.js";
import { dom } from "./dom.js";
import { vkApi } from "./vk-api.js";
import { getAlbumCover, escapeHtml, getErrorMessage } from "./helpers.js";
import { openAlbum } from "./photos.js";
import { CACHE_TTL } from "./config.js";
import { cacheGet, cacheGetStale, cacheSet, albumsKey } from "./cache.js";
import { getOwnerId } from "./group-context.js";

async function fetchAlbumsFromVK() {
    const ownerId = getOwnerId();

    const result = await vkApi("photos.getAlbums", {
        owner_id: ownerId,
        need_system: 1,
        need_covers: 1,
        photo_sizes: 1,
        count: 100
    });

    state.albums = result.items || [];
    cacheSet(albumsKey(ownerId), state.albums);
    renderAlbums();
}

export async function loadAlbums({ force = false } = {}) {
    const ownerId = getOwnerId();
    const key = albumsKey(ownerId);

    if (!force) {
        const cached = cacheGet(key, CACHE_TTL.albums);
        if (cached) {
            state.albums = cached;
            renderAlbums();
            return;
        }

        const stale = cacheGetStale(key);
        if (stale) {
            state.albums = stale;
            renderAlbums();
            try { await fetchAlbumsFromVK(); }
            catch (error) { console.warn("Фоновое обновление альбомов:", error); }
            return;
        }
    }

    dom.albums.innerHTML = '<div class="status-message">Загружаем альбомы сообщества...</div>';
    await fetchAlbumsFromVK();
}

function filtered() {
    const q = state.albumSearchText.trim().toLocaleLowerCase("ru");
    return q
        ? state.albums.filter(a => String(a.title || "").toLocaleLowerCase("ru").includes(q))
        : state.albums;
}

export function renderAlbums() {
    dom.albums.innerHTML = "";
    const list = filtered();

    if (!list.length) {
        dom.albums.innerHTML = `<div class="status-message">${
            state.albumSearchText.trim() ? "Альбомы не найдены" : "Альбомов нет"
        }</div>`;
        return;
    }

    list.forEach(album => {
        const card = document.createElement("div");
        card.className = "album-card";

        const cover = getAlbumCover(album);
        if (cover) {
            const img = document.createElement("img");
            img.className = "album-cover";
            img.src = cover;
            img.alt = album.title || "";
            img.loading = "lazy";
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
        count.textContent = String(album.size || 0);

        info.append(name, count);
        card.appendChild(info);
        card.addEventListener("click", () => openAlbum(album));
        dom.albums.appendChild(card);
    });
}

export function initAlbums() {
    dom.albumSearch.addEventListener("input", event => {
        state.albumSearchText = event.target.value;
        dom.clearSearch.classList.toggle("hidden", !state.albumSearchText);
        renderAlbums();
    });

    dom.clearSearch.addEventListener("click", () => {
        dom.albumSearch.value = "";
        state.albumSearchText = "";
        dom.clearSearch.classList.add("hidden");
        renderAlbums();
        dom.albumSearch.focus();
    });

    dom.refreshAlbums.addEventListener("click", async () => {
        dom.refreshAlbums.disabled = true;
        try {
            await loadAlbums({ force: true });
        } catch (error) {
            dom.albums.innerHTML =
                `<div class="error">Не удалось обновить альбомы.<br><br>${escapeHtml(getErrorMessage(error))}</div>`;
        } finally {
            dom.refreshAlbums.disabled = false;
        }
    });
}
