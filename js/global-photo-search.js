import { state } from "./state.js?v=20260920-albumtools18";
import { vkApi } from "./vk-api.js?v=20260920-albumtools18";
import { getOwnerId } from "./group-context.js?v=20260920-albumtools18";
import { getPhotoPreviewUrl, getErrorMessage } from "./helpers.js?v=20260920-albumtools18";
import { ensureAlbumIndex } from "./albums.js?v=20260920-albumtools18";
import { openAlbum } from "./photos.js?v=20260920-albumtools18";
import { openPhotoViewer } from "./photo-viewer.js?v=20260920-albumtools18";
import { openSwipeOverlay, closeSwipeOverlay } from "./overlay-history.js?v=20260920-albumtools18";

const PAGE_SIZE = 200;
const MAX_PAGES = 250;
const MAX_RENDERED_RESULTS = 240;

let overlay = null;
let input = null;
let clearButton = null;
let status = null;
let results = null;
let refreshButton = null;
let query = "";
let allPhotos = [];
let totalPhotos = 0;
let loading = false;
let loadedAll = false;
let generation = 0;
let initialized = false;

function create(tag, className = "", text = "") {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
}

function normalize(value = "") {
    return String(value)
        .toLocaleLowerCase("ru-RU")
        .replace(/ё/g, "е")
        .replace(/\s+/g, " ")
        .trim();
}

function installStyles() {
    if (document.getElementById("globalPhotoSearchStyles")) return;

    const style = document.createElement("style");
    style.id = "globalPhotoSearchStyles";
    style.textContent = `
        .global-photo-search-overlay {
            padding: 0;
            align-items: stretch;
            justify-content: stretch;
            background: #111315;
        }

        .global-photo-search-screen {
            display: flex;
            flex-direction: column;
            width: 100%;
            height: 100%;
            max-height: none;
            padding: 0;
            border: 0;
            border-radius: 0;
            overflow: hidden;
            background: #111315;
            box-shadow: none;
        }

        .global-photo-search-topbar {
            flex: 0 0 auto;
            display: flex;
            align-items: center;
            min-height: 58px;
            padding: 0 7px;
            background: #39779b;
            box-shadow: 0 2px 8px rgba(0,0,0,.30);
        }

        .global-photo-search-title {
            flex: 1;
            min-width: 0;
            padding: 0 8px;
            color: #fff;
            font-size: 18px;
            font-weight: 600;
        }

        .global-photo-search-icon-button {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 42px;
            height: 42px;
            padding: 0;
            border: 0;
            border-radius: 50%;
            background: transparent;
            color: #fff;
            font-size: 25px;
            cursor: pointer;
        }

        .global-photo-search-icon-button:active {
            background: rgba(255,255,255,.16);
        }

        .global-photo-search-controls {
            flex: 0 0 auto;
            padding: 10px;
            border-bottom: 1px solid #34383b;
            background: #1b1e20;
        }

        .global-photo-search-box {
            display: flex;
            align-items: center;
            gap: 7px;
            min-height: 42px;
            padding: 0 10px;
            border: 1px solid #3c4145;
            border-radius: 10px;
            background: #151719;
        }

        .global-photo-search-box input {
            flex: 1;
            min-width: 0;
            height: 40px;
            padding: 0;
            border: 0;
            outline: 0;
            background: transparent;
            color: #fff;
            font-size: 15px;
        }

        .global-photo-search-clear {
            width: 30px;
            height: 30px;
            padding: 0;
            border: 0;
            border-radius: 50%;
            background: transparent;
            color: #9ea4a9;
            font-size: 22px;
        }

        .global-photo-search-status {
            flex: 0 0 auto;
            min-height: 34px;
            padding: 8px 12px;
            color: #9fa5aa;
            font-size: 12px;
            line-height: 1.35;
            background: #17191b;
            border-bottom: 1px solid #2f3336;
        }

        .global-photo-search-results {
            flex: 1 1 auto;
            min-height: 0;
            overflow-y: auto;
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            align-content: start;
            gap: 2px;
            padding: 2px;
            -webkit-overflow-scrolling: touch;
        }

        .global-photo-search-card {
            position: relative;
            width: 100%;
            aspect-ratio: 1 / 1;
            overflow: hidden;
            padding: 0;
            border: 0;
            background: #2b2f32;
            cursor: pointer;
        }

        .global-photo-search-card img {
            display: block;
            width: 100%;
            height: 100%;
            object-fit: cover;
        }

        .global-photo-search-album {
            position: absolute;
            z-index: 2;
            left: 5px;
            right: 5px;
            bottom: 5px;
            padding: 4px 6px;
            border-radius: 6px;
            overflow: hidden;
            background: rgba(0,0,0,.67);
            color: #fff;
            font-size: 10px;
            line-height: 1.25;
            white-space: nowrap;
            text-overflow: ellipsis;
            pointer-events: none;
        }

        .global-photo-search-date {
            position: absolute;
            z-index: 2;
            top: 5px;
            left: 5px;
            padding: 2px 5px;
            border-radius: 5px;
            background: rgba(0,0,0,.62);
            color: #fff;
            font-size: 10px;
            pointer-events: none;
        }

        .global-photo-search-empty {
            grid-column: 1 / -1;
            padding: 40px 16px;
            color: #aeb4b9;
            text-align: center;
            line-height: 1.45;
        }

        @media (min-width: 700px) {
            .global-photo-search-results {
                grid-template-columns: repeat(5, minmax(0, 1fr));
                gap: 4px;
                padding: 4px;
            }
        }
    `;
    document.head.appendChild(style);
}

function formatDate(timestamp) {
    const value = Number(timestamp || 0);
    if (!value) return "";
    const d = new Date(value * 1000);
    if (Number.isNaN(d.getTime())) return "";
    return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

function albumForPhoto(photo) {
    const albumId = Number(photo?.album_id || 0);
    return state.albumIndex.find(album => Number(album.id) === albumId)
        || state.albums.find(album => Number(album.id) === albumId)
        || null;
}

function albumTitle(photo) {
    const album = albumForPhoto(photo);
    if (album?.title) return album.title;

    const id = Number(photo?.album_id || 0);
    if (id === -6) return "Фотографии профиля";
    if (id === -7) return "Фотографии со стены";
    if (id === -15) return "Сохранённые фотографии";
    return id ? `Альбом ${id}` : "Альбом";
}

function filteredPhotos() {
    const q = normalize(query);
    if (!q) return [];
    const tokens = q.split(" ").filter(Boolean);

    return allPhotos.filter(photo => {
        const text = normalize(photo?.text || "");
        return tokens.every(token => text.includes(token));
    });
}

function render() {
    if (!results || !status) return;
    results.innerHTML = "";

    const q = normalize(query);
    clearButton?.classList.toggle("hidden", !q);

    if (!q) {
        status.textContent = loadedAll
            ? `Индекс готов: ${allPhotos.length} фото. Введите текст описания.`
            : (loading ? `Индексируем фотографии… ${allPhotos.length}${totalPhotos ? ` из ${totalPhotos}` : ""}` : "Введите текст из описания фотографии.");
        results.appendChild(create("div", "global-photo-search-empty", "Поиск выполняется по описаниям фотографий во всех альбомах."));
        return;
    }

    const matches = filteredPhotos();
    const shown = matches.slice(0, MAX_RENDERED_RESULTS);

    if (loading) {
        status.textContent = `Ищем во всех альбомах… загружено ${allPhotos.length}${totalPhotos ? ` из ${totalPhotos}` : ""}. Найдено: ${matches.length}`;
    } else if (matches.length > shown.length) {
        status.textContent = `Найдено ${matches.length}. Показаны первые ${shown.length}. Уточните запрос.`;
    } else {
        status.textContent = `Найдено: ${matches.length}${loadedAll ? "" : " · индекс ещё строится"}`;
    }

    if (!shown.length) {
        results.appendChild(create(
            "div",
            "global-photo-search-empty",
            loading ? "Поиск продолжается…" : "Фотографии с таким описанием не найдены."
        ));
        return;
    }

    for (const photo of shown) {
        const card = create("button", "global-photo-search-card");
        card.type = "button";
        card.title = photo.text || albumTitle(photo);

        const url = getPhotoPreviewUrl(photo, 200);
        if (url) {
            const image = create("img");
            image.src = url;
            image.alt = photo.text || "Фотография";
            image.loading = "lazy";
            card.appendChild(image);
        }

        const date = formatDate(photo.date);
        if (date) card.appendChild(create("span", "global-photo-search-date", date));
        card.appendChild(create("span", "global-photo-search-album", albumTitle(photo)));

        card.addEventListener("click", async () => {
            const album = albumForPhoto(photo) || {
                id: Number(photo.album_id),
                owner_id: Number(photo.owner_id || getOwnerId()),
                title: albumTitle(photo),
                size: 0,
                description: ""
            };

            await closeGlobalPhotoSearch();
            try {
                await openAlbum(album);
                await openPhotoViewer(photo, album);
            } catch (error) {
                console.warn("Не удалось открыть найденную фотографию:", error);
            }
        });

        results.appendChild(card);
    }
}

function mergePhotos(current, incoming) {
    const map = new Map(current.map(photo => [`${photo.owner_id || ""}_${photo.id}`, photo]));
    incoming.forEach(photo => map.set(`${photo.owner_id || ""}_${photo.id}`, photo));
    return [...map.values()];
}

async function loadAllPhotos({ force = false } = {}) {
    if (loading) return;
    if (loadedAll && !force) return;

    if (force) {
        allPhotos = [];
        totalPhotos = 0;
        loadedAll = false;
    }

    loading = true;
    const currentGeneration = ++generation;
    render();

    try {
        // Не запускаем две тяжёлые пагинации VK одновременно: основной
        // индекс альбомов обычно уже строится при старте приложения. Дожидаемся
        // его и затем последовательно читаем фотографии через photos.getAll.
        await ensureAlbumIndex();
        if (currentGeneration !== generation) return;

        const ownerId = getOwnerId();
        let offset = allPhotos.length;
        let pages = 0;

        while (pages < MAX_PAGES) {
            const response = await vkApi("photos.getAll", {
                owner_id: ownerId,
                extended: 1,
                photo_sizes: 1,
                count: PAGE_SIZE,
                offset
            });

            if (currentGeneration !== generation) return;

            const items = Array.isArray(response?.items) ? response.items : [];
            const count = Number(response?.count || 0);
            if (Number.isFinite(count) && count >= 0) totalPhotos = Math.max(totalPhotos, count);

            const before = allPhotos.length;
            allPhotos = mergePhotos(allPhotos, items);
            const added = allPhotos.length - before;

            offset += items.length;
            pages += 1;
            render();

            if (!items.length || items.length < PAGE_SIZE || added === 0 || (totalPhotos > 0 && offset >= totalPhotos)) {
                break;
            }
        }

        if (currentGeneration !== generation) return;
        loadedAll = true;
    } catch (error) {
        if (currentGeneration !== generation) return;
        status.textContent = `Не удалось продолжить глобальный поиск: ${getErrorMessage(error)}`;
        console.warn("Глобальный поиск фотографий:", error);
    } finally {
        if (currentGeneration === generation) {
            loading = false;
            render();
        }
    }
}

function ensureUi() {
    if (overlay) return;
    installStyles();

    overlay = create("div", "modal-overlay global-photo-search-overlay hidden");
    const screen = create("div", "modal global-photo-search-screen");

    const topbar = create("div", "global-photo-search-topbar");
    const title = create("div", "global-photo-search-title", "Поиск фотографий");
    refreshButton = create("button", "global-photo-search-icon-button", "↻");
    refreshButton.type = "button";
    refreshButton.title = "Перестроить индекс";
    const close = create("button", "global-photo-search-icon-button", "×");
    close.type = "button";
    close.title = "Закрыть";
    topbar.append(title, refreshButton, close);

    const controls = create("div", "global-photo-search-controls");
    const box = create("div", "global-photo-search-box");
    box.appendChild(create("span", "", "🔎"));
    input = create("input");
    input.type = "search";
    input.placeholder = "Поиск по описанию во всех альбомах…";
    input.autocomplete = "off";
    input.spellcheck = false;
    clearButton = create("button", "global-photo-search-clear hidden", "×");
    clearButton.type = "button";
    clearButton.setAttribute("aria-label", "Очистить поиск");
    box.append(input, clearButton);
    controls.appendChild(box);

    status = create("div", "global-photo-search-status", "Введите текст из описания фотографии.");
    results = create("div", "global-photo-search-results");

    screen.append(topbar, controls, status, results);
    overlay.appendChild(screen);
    document.body.appendChild(overlay);

    input.addEventListener("input", () => {
        query = input.value;
        render();
        if (normalize(query) && !loadedAll) void loadAllPhotos();
    });

    clearButton.addEventListener("click", () => {
        input.value = "";
        query = "";
        render();
        input.focus();
    });

    refreshButton.addEventListener("click", () => void loadAllPhotos({ force: true }));
    close.addEventListener("click", () => void closeGlobalPhotoSearch());

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && overlay && !overlay.classList.contains("hidden")) {
            void closeGlobalPhotoSearch();
        }
    });
}

function hideDirect() {
    if (!overlay) return;
    overlay.classList.add("hidden");
}

export async function openGlobalPhotoSearch() {
    ensureUi();
    overlay.classList.remove("hidden");
    openSwipeOverlay("global-photo-search", hideDirect);
    query = input.value || "";
    render();

    // Названия альбомов нужны для подписей результатов. Индекс строится
    // параллельно и не задерживает сам поиск по фотографиям.
    void ensureAlbumIndex().then(() => render()).catch(() => {});

    if (normalize(query) && !loadedAll) void loadAllPhotos();
    requestAnimationFrame(() => input.focus());
}

export function closeGlobalPhotoSearch() {
    if (!overlay || overlay.classList.contains("hidden")) return Promise.resolve(false);
    return closeSwipeOverlay("global-photo-search");
}

export function initGlobalPhotoSearch() {
    if (initialized) return;
    initialized = true;
    ensureUi();
}
