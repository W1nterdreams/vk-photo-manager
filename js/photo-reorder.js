import { state } from "./state.js?v=20260920-albumtools11";
import { vkApi } from "./vk-api.js?v=20260920-albumtools11";
import { getPhotoPreviewUrl, getErrorMessage } from "./helpers.js?v=20260920-albumtools11";
import { getOwnerId } from "./group-context.js?v=20260920-albumtools11";
import {
    cacheSet,
    albumPhotosKey,
    invalidateAlbumPhotosCache
} from "./cache.js?v=20260920-albumtools11";
import { openSwipeOverlay, closeSwipeOverlay } from "./overlay-history.js?v=20260920-albumtools11";

const PAGE_SIZE = 100;

let overlay = null;
let grid = null;
let title = null;
let subtitle = null;
let errorBox = null;
let activePhoto = null;
let activeAlbum = null;
let albumPhotos = [];
let busy = false;
let loadGeneration = 0;

function create(tag, className = "", text = "") {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
}

function formatPhotoDate(timestamp) {
    const seconds = Number(timestamp || 0);
    if (!Number.isFinite(seconds) || seconds <= 0) return "";

    const date = new Date(seconds * 1000);
    if (Number.isNaN(date.getTime())) return "";

    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
}

function installStyles() {
    if (document.getElementById("photoReorderStyles")) return;

    const style = document.createElement("style");
    style.id = "photoReorderStyles";
    style.textContent = `
        .photo-reorder-overlay {
            padding: 0;
            align-items: stretch;
            justify-content: stretch;
            background: #111315;
        }

        .photo-reorder-screen {
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

        .photo-reorder-topbar {
            flex: 0 0 auto;
            display: flex;
            align-items: center;
            min-height: 58px;
            padding: 0 8px;
            background: #39779b;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.30);
        }

        .photo-reorder-heading {
            flex: 1;
            min-width: 0;
            padding: 6px 8px;
        }

        .photo-reorder-title {
            color: #fff;
            font-size: 18px;
            font-weight: 600;
            line-height: 1.15;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .photo-reorder-subtitle {
            margin-top: 2px;
            color: rgba(255,255,255,0.78);
            font-size: 12px;
            line-height: 1.2;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .photo-reorder-close {
            flex: 0 0 auto;
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
            font-size: 28px;
            line-height: 1;
            cursor: pointer;
        }

        .photo-reorder-close:active {
            background: rgba(255,255,255,0.16);
        }

        .photo-reorder-hint {
            flex: 0 0 auto;
            padding: 10px 12px;
            border-bottom: 1px solid #34383b;
            background: #1b1e20;
            color: #c4c8cb;
            font-size: 13px;
            line-height: 1.35;
        }

        .photo-reorder-body {
            position: relative;
            flex: 1 1 auto;
            min-height: 0;
            overflow-y: auto;
            overscroll-behavior: contain;
            -webkit-overflow-scrolling: touch;
        }

        .photo-reorder-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 2px;
            width: 100%;
            padding: 2px;
        }

        .photo-reorder-card {
            position: relative;
            width: 100%;
            aspect-ratio: 1 / 1;
            overflow: hidden;
            padding: 0;
            border: 0;
            outline: 0;
            background: #2c3033;
            color: #fff;
            cursor: pointer;
            user-select: none;
            transform: translateZ(0);
        }

        .photo-reorder-card:active:not(:disabled) {
            transform: scale(0.97);
            opacity: 0.88;
        }

        .photo-reorder-card img {
            display: block;
            width: 100%;
            height: 100%;
            object-fit: cover;
        }

        .photo-reorder-card-selected {
            box-shadow: inset 0 0 0 4px #62a8d5;
        }

        .photo-reorder-card-selected::after {
            content: "Выбрано";
            position: absolute;
            z-index: 5;
            left: 6px;
            bottom: 6px;
            padding: 3px 6px;
            border-radius: 6px;
            background: rgba(57,119,155,0.94);
            color: #fff;
            font-size: 11px;
            font-weight: 600;
            pointer-events: none;
        }

        .photo-reorder-date {
            position: absolute;
            z-index: 3;
            top: 5px;
            left: 5px;
            padding: 2px 5px;
            border-radius: 5px;
            background: rgba(0,0,0,0.60);
            color: #fff;
            font-size: 10px;
            line-height: 1.2;
            pointer-events: none;
        }

        .photo-reorder-stats {
            position: absolute;
            z-index: 3;
            right: 5px;
            bottom: 5px;
            display: flex;
            gap: 4px;
            pointer-events: none;
        }

        .photo-reorder-stat {
            padding: 2px 4px;
            border-radius: 5px;
            background: rgba(0,0,0,0.60);
            color: #fff;
            font-size: 10px;
            line-height: 1.2;
        }

        .photo-reorder-status {
            grid-column: 1 / -1;
            padding: 32px 12px;
            color: #aeb4b9;
            text-align: center;
            line-height: 1.45;
        }

        .photo-reorder-error {
            margin: 10px;
        }

        .photo-reorder-busy {
            position: fixed;
            z-index: 100003;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            background: rgba(0,0,0,0.52);
            color: #fff;
            font-size: 16px;
            font-weight: 600;
            text-align: center;
            pointer-events: all;
        }

        @media (min-width: 700px) {
            .photo-reorder-grid {
                grid-template-columns: repeat(4, minmax(0, 1fr));
                gap: 4px;
                padding: 4px;
            }
        }

        @media (min-width: 1100px) {
            .photo-reorder-grid {
                grid-template-columns: repeat(5, minmax(0, 1fr));
            }
        }
    `;
    document.head.appendChild(style);
}

function ensureModal() {
    if (overlay) return;
    installStyles();

    overlay = create("div", "modal-overlay photo-reorder-overlay hidden");
    const screen = create("div", "modal photo-reorder-screen");

    const header = create("div", "photo-reorder-topbar");
    const heading = create("div", "photo-reorder-heading");
    title = create("div", "photo-reorder-title", "Переместить внутри альбома");
    subtitle = create("div", "photo-reorder-subtitle", "");
    heading.append(title, subtitle);

    const close = create("button", "photo-reorder-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Закрыть");
    close.addEventListener("click", () => void closeModal());
    header.append(heading, close);

    const hint = create(
        "div",
        "photo-reorder-hint",
        "Нажмите на фотографию, место которой должна занять выбранная фотография."
    );

    const body = create("div", "photo-reorder-body");
    grid = create("div", "photo-reorder-grid");
    errorBox = create("div", "form-error photo-reorder-error hidden");
    body.append(grid, errorBox);

    screen.append(header, hint, body);
    overlay.appendChild(screen);
    document.body.appendChild(overlay);
}

function showError(message = "") {
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.classList.toggle("hidden", !message);
}

function hideModalDirect() {
    if (!overlay) return;
    loadGeneration += 1;
    overlay.classList.add("hidden");
    activePhoto = null;
    activeAlbum = null;
    albumPhotos = [];
    busy = false;
    showError("");
}

function closeModal() {
    if (!overlay || busy) return Promise.resolve(false);
    return closeSwipeOverlay("photo-reorder");
}

function mergePhotos(current, incoming) {
    const map = new Map(current.map(photo => [String(photo.id), photo]));
    incoming.forEach(photo => map.set(String(photo.id), photo));
    return [...map.values()];
}

async function fetchAllPhotos(generation) {
    const ownerId = Number(activePhoto?.owner_id || activeAlbum?.owner_id || getOwnerId());
    const albumId = Number(activePhoto?.album_id || activeAlbum?.id || 0);

    if (!albumId || albumId <= 0) {
        throw new Error("Изменение порядка доступно только для обычных фотоальбомов.");
    }

    let offset = 0;
    let total = Infinity;
    let resultPhotos = [];

    while (offset < total) {
        const result = await vkApi("photos.get", {
            owner_id: ownerId,
            album_id: albumId,
            extended: 1,
            photo_sizes: 1,
            count: PAGE_SIZE,
            offset
        });

        if (generation !== loadGeneration || !activePhoto) return [];

        const items = Array.isArray(result?.items) ? result.items : [];
        resultPhotos = mergePhotos(resultPhotos, items);

        const apiTotal = Number(result?.count);
        total = Number.isFinite(apiTotal) && apiTotal >= 0
            ? apiTotal
            : offset + items.length;

        offset += items.length;
        if (!items.length || items.length < PAGE_SIZE) break;
    }

    return resultPhotos;
}

function renderPhotoCard(photo) {
    const button = create("button", "photo-reorder-card");
    button.type = "button";

    const selected = Number(photo.id) === Number(activePhoto?.id);
    button.classList.toggle("photo-reorder-card-selected", selected);
    button.setAttribute(
        "aria-label",
        selected ? "Выбранная фотография" : "Переместить выбранную фотографию на это место"
    );

    const url = getPhotoPreviewUrl(photo, 640);
    if (url) {
        const image = create("img");
        image.src = url;
        image.alt = photo.text || "Фотография";
        image.loading = "lazy";
        button.appendChild(image);
    }

    const dateText = formatPhotoDate(photo?.date);
    if (dateText) {
        button.appendChild(create("span", "photo-reorder-date", dateText));
    }

    const stats = create("div", "photo-reorder-stats");
    stats.append(
        create("span", "photo-reorder-stat", `♥ ${Number(photo?.likes?.count || 0)}`),
        create("span", "photo-reorder-stat", `💬 ${Number(photo?.comments?.count || 0)}`)
    );
    button.appendChild(stats);

    if (selected) {
        button.disabled = true;
    } else {
        button.addEventListener("pointerdown", event => {
            event.stopPropagation();
        });
        button.addEventListener("pointerup", event => {
            event.stopPropagation();
        });
        button.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            state.suppressPhotoOpenUntil = Date.now() + 900;
            void chooseTarget(photo);
        });
    }

    return button;
}

function renderPhotos() {
    if (!grid) return;
    grid.innerHTML = "";

    if (!albumPhotos.length) {
        grid.appendChild(create("div", "photo-reorder-status", "В альбоме нет фотографий."));
        return;
    }

    albumPhotos.forEach(photo => grid.appendChild(renderPhotoCard(photo)));
}

function localReorder(items, sourceIndex, targetIndex) {
    const result = [...items];
    const [moved] = result.splice(sourceIndex, 1);
    const safeTarget = Math.max(0, Math.min(Number(targetIndex), result.length));
    result.splice(safeTarget, 0, moved);
    return result;
}

function buildReorderParamsFromCurrent(items, sourceIndex, targetIndex, ownerId, photoId) {
    const params = {
        owner_id: Number(ownerId),
        photo_id: Number(photoId)
    };

    if (!Array.isArray(items) || sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
        return params;
    }

    // ВАЖНО: якорь берём из ТЕКУЩЕГО серверного порядка, а направление
    // определяем по текущему положению самой фотографии.
    //
    // Движение к началу: ставим выбранное фото ПЕРЕД карточкой нужной позиции.
    // Движение к концу: ставим выбранное фото ПОСЛЕ карточки нужной позиции.
    //
    // Такой вариант не зависит от сдвига индексов после удаления исходного
    // элемента и одинаково корректно работает в обе стороны.
    const anchor = items[targetIndex];
    if (!anchor?.id || Number(anchor.id) === Number(photoId)) {
        return params;
    }

    if (targetIndex < sourceIndex) {
        params.before = Number(anchor.id);
    } else {
        params.after = Number(anchor.id);
    }

    return params;
}
function photoIndex(items, photoId) {
    return items.findIndex(item => Number(item.id) === Number(photoId));
}

function sleep(ms) {
    return new Promise(resolve => window.setTimeout(resolve, ms));
}

function saveReorderedState(items) {
    const albumId = Number(activeAlbum?.id || activePhoto?.album_id || 0);
    const ownerId = Number(activePhoto?.owner_id || activeAlbum?.owner_id || getOwnerId());

    albumPhotos = items;

    if (state.currentAlbum && Number(state.currentAlbum.id) === albumId) {
        state.photos = items;
        state.photosTotal = items.length;
        state.photosOffset = items.length;
        state.photosHasMore = false;
        state.photosLoadingMore = false;
        state.photoSortMode = "vk";

        const current = items.find(item => Number(item.id) === Number(activePhoto?.id));
        if (current) {
            state.currentPhoto = { ...(state.currentPhoto || {}), ...current };
        }

        cacheSet(albumPhotosKey(ownerId, albumId), {
            items,
            total: items.length
        });
    } else {
        invalidateAlbumPhotosCache(ownerId, albumId);
    }
}

function addBusyLayer() {
    const layer = create("div", "photo-reorder-busy", "Перемещаем фотографию...");
    layer.id = "photoReorderBusyLayer";
    overlay.appendChild(layer);
    return layer;
}

async function fetchServerOrderAfterMove(generation, photoId, targetIndex) {
    // VK иногда отдаёт старый порядок ещё несколько сотен миллисекунд после
    // успешного reorderPhotos. Несколько чтений безопаснее, чем сразу делать
    // второй reorder по устаревшему списку.
    const delays = [280, 450, 700];
    let lastOrder = [];

    for (const delay of delays) {
        await sleep(delay);
        lastOrder = await fetchAllPhotos(generation);
        if (generation !== loadGeneration || !activePhoto) return [];

        if (photoIndex(lastOrder, photoId) === targetIndex) {
            return lastOrder;
        }
    }

    return lastOrder;
}

async function chooseTarget(targetPhoto) {
    if (busy || !activePhoto || !targetPhoto) return;

    const sourceIndex = photoIndex(albumPhotos, activePhoto.id);
    const targetIndex = photoIndex(albumPhotos, targetPhoto.id);

    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;

    busy = true;
    showError("");
    const busyLayer = addBusyLayer();

    const ownerId = Number(activePhoto.owner_id || activeAlbum?.owner_id || getOwnerId());
    const photoId = Number(activePhoto.id);
    const generation = loadGeneration;
    const albumIdToRefresh = Number(activeAlbum?.id || activePhoto?.album_id || 0);
    const desiredOrder = localReorder(albumPhotos, sourceIndex, targetIndex);

    try {
        // Первый запрос строится прямо от карточки, на место которой нажали:
        // вверх -> before target, вниз -> after target.
        let params = buildReorderParamsFromCurrent(
            albumPhotos,
            sourceIndex,
            targetIndex,
            ownerId,
            photoId
        );

        if (!params.before && !params.after) {
            throw new Error("Не удалось определить позицию для перемещения фотографии.");
        }

        let response = await vkApi("photos.reorderPhotos", params);
        if (response !== 1 && response !== true) {
            throw new Error("VK не подтвердил изменение порядка фотографий.");
        }

        // Перечитываем реальный порядок с VK и даём серверу время применить
        // изменение. Это одновременно является автоматическим обновлением.
        let serverOrder = await fetchServerOrderAfterMove(generation, photoId, targetIndex);
        if (generation !== loadGeneration || !activePhoto) return;

        let serverIndex = photoIndex(serverOrder, photoId);

        // Если позиция всё ещё не совпала, корректируем максимум два раза,
        // каждый раз используя НОВЫЙ серверный порядок и направление от
        // текущей позиции к требуемой. Это особенно важно при движении назад.
        for (let attempt = 0; attempt < 2 && serverIndex >= 0 && serverIndex !== targetIndex; attempt += 1) {
            params = buildReorderParamsFromCurrent(
                serverOrder,
                serverIndex,
                targetIndex,
                ownerId,
                photoId
            );

            if (!params.before && !params.after) break;

            response = await vkApi("photos.reorderPhotos", params);
            if (response !== 1 && response !== true) {
                throw new Error("VK не подтвердил корректировку порядка фотографий.");
            }

            serverOrder = await fetchServerOrderAfterMove(generation, photoId, targetIndex);
            if (generation !== loadGeneration || !activePhoto) return;
            serverIndex = photoIndex(serverOrder, photoId);
        }

        if (serverIndex >= 0 && serverIndex !== targetIndex) {
            throw new Error(
                `VK сохранил фотографию на позиции ${serverIndex + 1}, а выбрана позиция ${targetIndex + 1}. Повторите перемещение.`
            );
        }

        const finalOrder = serverIndex === targetIndex ? serverOrder : desiredOrder;
        saveReorderedState(finalOrder);
        state.suppressPhotoOpenUntil = Date.now() + 1000;

        busy = false;
        busyLayer.remove();
        await closeSwipeOverlay("photo-reorder");

        // Не загружаем только первые 20 фотографий поверх уже полученного
        // полного серверного порядка. Просто сразу перерисовываем открытый
        // альбом по свежим данным, полученным выше.
        if (
            state.currentAlbum &&
            Number(state.currentAlbum.id) === albumIdToRefresh
        ) {
            try {
                const { setPhotoDateSort } = await import("./photos.js?v=20260920-albumtools11");
                await setPhotoDateSort("vk");
            } catch (error) {
                console.warn("Не удалось перерисовать альбом после перестановки:", error);
            }
        }
    } catch (error) {
        busy = false;
        busyLayer.remove();
        showError(getErrorMessage(error));
    }
}

export async function openPhotoReorder(photo) {
    if (!photo?.id) return;
    ensureModal();

    activePhoto = photo;
    activeAlbum = state.currentAlbum || state.albums.find(
        album => Number(album.id) === Number(photo.album_id)
    ) || null;
    albumPhotos = [];
    busy = false;
    showError("");

    const albumName = activeAlbum?.title || "Альбом";
    title.textContent = "Переместить внутри альбома";
    subtitle.textContent = albumName;
    grid.innerHTML = "";
    grid.appendChild(create("div", "photo-reorder-status", "Загружаем фотографии..."));

    overlay.classList.remove("hidden");
    openSwipeOverlay("photo-reorder", hideModalDirect);

    const generation = ++loadGeneration;

    try {
        albumPhotos = await fetchAllPhotos(generation);
        if (generation !== loadGeneration || !activePhoto) return;

        if (!albumPhotos.some(item => Number(item.id) === Number(activePhoto.id))) {
            throw new Error("Выбранная фотография не найдена в этом альбоме.");
        }

        renderPhotos();
    } catch (error) {
        if (generation !== loadGeneration) return;
        grid.innerHTML = "";
        grid.appendChild(create("div", "photo-reorder-status", "Не удалось загрузить фотографии."));
        showError(getErrorMessage(error));
    }
}

export function initPhotoReorder() {
    ensureModal();

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && overlay && !overlay.classList.contains("hidden")) {
            void closeModal();
        }
    });
}
