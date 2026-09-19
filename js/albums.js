import { state } from "./state.js?v=20260919-photo01";
import { dom } from "./dom.js?v=20260919-photo01";
import { vkApi } from "./vk-api.js?v=20260919-photo01";
import { getAlbumCover, escapeHtml, getErrorMessage } from "./helpers.js?v=20260919-photo01";
import { openAlbum } from "./photos.js?v=20260919-photo01";
import { CACHE_TTL } from "./config.js?v=20260919-photo01";
import {
    cacheGet,
    cacheGetStale,
    cacheSet,
    albumsKey,
    albumIndexKey
} from "./cache.js?v=20260919-photo01";
import { getOwnerId } from "./group-context.js?v=20260919-photo01";
import { bindAlbumLongPress } from "./album-menu.js?v=20260919-photo01";

const PAGE_SIZE = 20;
const INDEX_PAGE_SIZE = 100;

let loadMoreObserver = null;
let indexBuildPromise = null;
let albumScrollTicking = false;

function normalizeTitle(value) {
    return String(value || "").trim().toLocaleLowerCase("ru");
}

function toIndexItem(album) {
    return {
        id: album.id,
        owner_id: album.owner_id,
        title: album.title || "",
        description: album.description || "",
        size: Number(album.size || 0),
        can_upload: album.can_upload,
        comments_disabled: album.comments_disabled,
        upload_by_admins_only: album.upload_by_admins_only,
        created: album.created,
        updated: album.updated
    };
}

function mergeAlbums(current, incoming) {
    const map = new Map(current.map(album => [String(album.id), album]));
    incoming.forEach(album => map.set(String(album.id), album));
    return [...map.values()];
}

function mergeIndex(current, incoming) {
    const map = new Map(current.map(album => [String(album.id), album]));
    incoming.forEach(album => map.set(String(album.id), toIndexItem(album)));
    return [...map.values()];
}

async function fetchAlbumPage(offset, count = PAGE_SIZE) {
    const ownerId = getOwnerId();
    return vkApi("photos.getAlbums", {
        owner_id: ownerId,
        need_system: 1,
        need_covers: 1,
        photo_sizes: 1,
        count,
        offset
    });
}

async function fetchFirstPageFromVK() {
    const ownerId = getOwnerId();
    const result = await fetchAlbumPage(0, PAGE_SIZE);

    state.albums = result.items || [];
    state.albumsTotal = Math.max(
        Number(result.count || 0),
        state.albumIndex.length,
        state.albums.length
    );
    state.albumsOffset = state.albums.length;
    state.albumsHasMore =
        state.albumsOffset < state.albumsTotal ||
        state.albums.length === PAGE_SIZE;

    cacheSet(albumsKey(ownerId), {
        items: state.albums,
        total: state.albumsTotal
    });

    // Первые 20 сразу добавляем и в поисковый индекс.
    state.albumIndex = mergeIndex(state.albumIndex, state.albums);
    renderAlbums();
    setTimeout(handleAlbumScroll, 0);

    // Полный индекс строится в фоне и не задерживает показ экрана.
    void ensureAlbumIndex();
}

function restoreAlbumsCache(cached) {
    const items = Array.isArray(cached) ? cached : (cached?.items || []);
    const savedTotal = Array.isArray(cached) ? 0 : Number(cached?.total || 0);

    state.albums = items;
    state.albumsTotal = Math.max(savedTotal, items.length);
    state.albumsOffset = items.length;

    // Старые версии приложения сохраняли в кэш только первые 20 альбомов
    // без реального общего count. Такой кэш нельзя считать концом списка.
    state.albumsHasMore = savedTotal > items.length || items.length >= PAGE_SIZE;
}

export async function loadAlbums({ force = false } = {}) {
    const ownerId = getOwnerId();
    const key = albumsKey(ownerId);

    // Индекс живёт отдельно от экранного кэша.
    if (!force) {
        const cachedIndex = cacheGet(albumIndexKey(ownerId), CACHE_TTL.albumIndex);
        if (Array.isArray(cachedIndex)) state.albumIndex = cachedIndex;
    }

    if (!force) {
        const cached = cacheGet(key, CACHE_TTL.albums);
        if (cached) {
            restoreAlbumsCache(cached);
            renderAlbums();
            void ensureAlbumIndex();
            return;
        }

        const stale = cacheGetStale(key);
        if (stale) {
            restoreAlbumsCache(stale);
            renderAlbums();
            try { await fetchFirstPageFromVK(); }
            catch (error) { console.warn("Фоновое обновление альбомов:", error); }
            return;
        }
    }

    dom.albums.innerHTML = '<div class="status-message">Загружаем альбомы сообщества...</div>';
    await fetchFirstPageFromVK();
}

export async function loadMoreAlbums() {
    if (state.albumSearchText.trim()) return;
    if (state.albumsLoadingMore || !state.albumsHasMore) return;

    state.albumsLoadingMore = true;
    renderAlbums();

    try {
        const result = await fetchAlbumPage(state.albumsOffset, PAGE_SIZE);
        const items = result.items || [];

        const beforeCount = state.albums.length;
        state.albums = mergeAlbums(state.albums, items);
        const addedCount = state.albums.length - beforeCount;

        state.albumsTotal = Math.max(
            Number(result.count || 0),
            state.albumsTotal || 0,
            state.albums.length
        );
        state.albumsOffset += items.length;

        // Не полагаемся только на result.count: для старого кэша он мог быть потерян.
        // Полная страница из 20 элементов означает, что пробуем следующую.
        state.albumsHasMore =
            items.length === PAGE_SIZE ||
            state.albumsOffset < state.albumsTotal;

        // Защита от зацикливания, если API неожиданно вернул ту же страницу.
        if (items.length > 0 && addedCount === 0) {
            state.albumsHasMore = false;
        }

        state.albumIndex = mergeIndex(state.albumIndex, items);

        const ownerId = getOwnerId();
        cacheSet(albumsKey(ownerId), {
            items: state.albums,
            total: state.albumsTotal
        });
    } catch (error) {
        console.warn("Не удалось догрузить альбомы:", error);
    } finally {
        state.albumsLoadingMore = false;
        renderAlbums();
        setTimeout(handleAlbumScroll, 0);
    }
}

async function buildAlbumIndex() {
    const ownerId = getOwnerId();
    let index = [...state.albumIndex];
    let offset = 0;
    let total = Infinity;

    state.albumIndexBuilding = true;

    try {
        while (offset < total) {
            const result = await fetchAlbumPage(offset, INDEX_PAGE_SIZE);
            const items = result.items || [];

            total = Number(result.count || items.length);
            index = mergeIndex(index, items);
            state.albumIndex = index;

            // Поиск начинает видеть новые названия сразу, не дожидаясь конца индексации.
            if (state.albumSearchText.trim()) renderAlbums();

            if (!items.length) break;
            offset += items.length;

            if (items.length < INDEX_PAGE_SIZE && offset >= total) break;
        }

        cacheSet(albumIndexKey(ownerId), index);
        state.albumIndexReady = true;

        // Индекс является дополнительным источником истины о количестве
        // альбомов. Это важно для WebView VK: иногда первый ответ/старый кэш
        // содержит count, равный только размеру первой страницы.
        state.albumsTotal = Math.max(state.albumsTotal || 0, index.length);
        state.albumsHasMore = state.albums.length < state.albumsTotal;

        if (state.currentScreen === "albums" && !state.albumSearchText.trim()) {
            renderAlbums();
            setTimeout(handleAlbumScroll, 0);
        }

        console.log("Album index ready:", {
            visible: state.albums.length,
            total: state.albumsTotal,
            index: index.length,
            hasMore: state.albumsHasMore
        });

        return index;
    } catch (error) {
        console.warn("Не удалось обновить поисковый индекс альбомов:", error);
        return index;
    } finally {
        state.albumIndexBuilding = false;
        if (state.albumSearchText.trim()) renderAlbums();
    }
}

async function ensureAlbumIndex({ force = false } = {}) {
    const ownerId = getOwnerId();

    if (!force) {
        const cached = cacheGet(albumIndexKey(ownerId), CACHE_TTL.albumIndex);
        if (Array.isArray(cached) && cached.length) {
            state.albumIndex = cached;
            state.albumIndexReady = true;
            state.albumsTotal = Math.max(state.albumsTotal || 0, cached.length);
            state.albumsHasMore = state.albums.length < state.albumsTotal;
            if (state.albumSearchText.trim()) renderAlbums();
            else if (state.currentScreen === "albums") {
                renderAlbums();
                setTimeout(handleAlbumScroll, 0);
            }
            return cached;
        }
    }

    if (!indexBuildPromise) {
        indexBuildPromise = buildAlbumIndex().finally(() => {
            indexBuildPromise = null;
        });
    }

    return indexBuildPromise;
}

function filtered() {
    const q = normalizeTitle(state.albumSearchText);
    if (!q) return state.albums;

    // Поиск идёт по полному локальному индексу, а не только по 20 карточкам на экране.
    const source = state.albumIndex.length ? state.albumIndex : state.albums;
    return source.filter(album => normalizeTitle(album.title).includes(q));
}

function createAlbumCard(album) {
    const card = document.createElement("div");
    card.className = "album-card";

    // Если этот альбом уже был загружен как полноценная карточка,
    // берём её данные с обложкой. Для результата только из индекса
    // используем обычный placeholder.
    const fullAlbum = state.albums.find(item => String(item.id) === String(album.id));
    const displayAlbum = fullAlbum || album;
    const cover = getAlbumCover(displayAlbum);

    if (cover) {
        const img = document.createElement("img");
        img.className = "album-cover";
        img.src = cover;
        img.alt = displayAlbum.title || "";
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
    name.textContent = displayAlbum.title || "Без названия";

    const count = document.createElement("div");
    count.className = "album-count";
    count.textContent = String(displayAlbum.size || 0);

    info.append(name, count);
    card.appendChild(info);

    // Долгое нажатие открывает контекстное меню альбома.
    // Обычный короткий тап по-прежнему открывает альбом.
    bindAlbumLongPress(card, displayAlbum);
    card.addEventListener("click", () => openAlbum(displayAlbum));

    return card;
}

function installLoadMoreSentinel() {
    if (loadMoreObserver) {
        loadMoreObserver.disconnect();
        loadMoreObserver = null;
    }

    if (state.albumSearchText.trim() || !state.albumsHasMore) return;

    const sentinel = document.createElement("div");
    sentinel.className = "albums-load-more-sentinel";
    sentinel.style.height = "1px";
    sentinel.setAttribute("aria-hidden", "true");
    dom.albums.appendChild(sentinel);

    loadMoreObserver = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) {
            void loadMoreAlbums();
        }
    }, { rootMargin: "500px 0px" });

    loadMoreObserver.observe(sentinel);
}

export function renderAlbums() {
    dom.albums.innerHTML = "";
    const list = filtered();
    const searching = Boolean(state.albumSearchText.trim());

    if (!list.length) {
        if (searching && state.albumIndexBuilding) {
            dom.albums.innerHTML = '<div class="status-message">Ищем по альбомам...</div>';
        } else {
            dom.albums.innerHTML = `<div class="status-message">${
                searching ? "Альбомы не найдены" : "Альбомов нет"
            }</div>`;
        }
        return;
    }

    list.forEach(album => dom.albums.appendChild(createAlbumCard(album)));

    if (state.albumsLoadingMore && !searching) {
        const loading = document.createElement("div");
        loading.className = "status-message";
        loading.textContent = "Загружаем ещё альбомы...";
        dom.albums.appendChild(loading);
    }

    installLoadMoreSentinel();

    // Если 20 карточек почти полностью помещаются в экран, scroll-события
    // может вообще не быть. Проверяем возможность догрузки сразу после render.
    if (!searching && state.albumsHasMore && !state.albumsLoadingMore) {
        requestAnimationFrame(() => {
            if (state.currentScreen === "albums" && isNearPageBottom()) {
                void loadMoreAlbums();
            }
        });
    }
}

function isNearPageBottom(distance = 900) {
    const doc = document.documentElement;
    return window.innerHeight + window.scrollY >= doc.scrollHeight - distance;
}

function handleAlbumScroll() {
    if (albumScrollTicking) return;
    albumScrollTicking = true;

    requestAnimationFrame(() => {
        albumScrollTicking = false;
        if (
            state.currentScreen === "albums" &&
            !state.albumSearchText.trim() &&
            state.albumsHasMore &&
            !state.albumsLoadingMore &&
            isNearPageBottom()
        ) {
            void loadMoreAlbums();
        }
    });
}

export function initAlbums() {
    window.addEventListener("scroll", handleAlbumScroll, { passive: true });

    dom.albumSearch.addEventListener("input", event => {
        state.albumSearchText = event.target.value;
        dom.clearSearch.classList.toggle("hidden", !state.albumSearchText);
        renderAlbums();

        // Если это первый запуск и полный индекс ещё не построен — запускаем его сразу.
        if (state.albumSearchText.trim() && !state.albumIndexReady) {
            void ensureAlbumIndex();
        }
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
            state.albumIndexReady = false;
            await loadAlbums({ force: true });
            void ensureAlbumIndex({ force: true });
        } catch (error) {
            dom.albums.innerHTML =
                `<div class="error">Не удалось обновить альбомы.<br><br>${escapeHtml(getErrorMessage(error))}</div>`;
        } finally {
            dom.refreshAlbums.disabled = false;
        }
    });
}
