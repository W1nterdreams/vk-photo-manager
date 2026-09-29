import { state } from "./state.js?v=20260929-client07-contextfix";
import { dom } from "./dom.js?v=20260929-client07-contextfix";
import { getBestPhotoUrl, getPhotoPreviewUrl } from "./helpers.js?v=20260929-client07-contextfix";
import { showPhotoViewerScreen, pushPhotoHistory, replacePhotoHistory } from "./navigation.js?v=20260929-client07-contextfix";
import { bindPhotoLongPress, openPhotoComments } from "./photo-actions.js?v=20260929-client07-contextfix";
import { ensureAlbumFreshForGlobal, isAlbumFresh } from "./photos.js?v=20260929-client07-contextfix";

let initialized = false;
let activePhoto = null;
let activeAlbum = null;
let viewerSequence = [];
let viewerSource = "";
let imageGeneration = 0;

function normalizeSequence(sequence, currentPhoto) {
    const source = Array.isArray(sequence) && sequence.length ? sequence : [currentPhoto];
    const seen = new Set();
    const result = [];
    for (const item of source) {
        const id = Number(item?.id || 0);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        result.push(item);
    }
    if (currentPhoto?.id && !seen.has(Number(currentPhoto.id))) result.push(currentPhoto);
    return result;
}

function activeIndex() {
    const id = Number(activePhoto?.id || 0);
    return viewerSequence.findIndex(item => Number(item?.id || 0) === id);
}

function albumForPhoto(photo) {
    const id = Number(photo?.album_id || activeAlbum?.id || 0);
    return state.albums.find(album => Number(album.id) === id) ||
        (activeAlbum && Number(activeAlbum.id) === id ? activeAlbum : {
            id,
            owner_id: Number(photo?.owner_id || state.ownerId),
            title: `Альбом ${id}`
        });
}

function updateArrows() {
    const index = activeIndex();
    dom.photoViewerPrev?.classList.toggle("hidden", index <= 0);
    dom.photoViewerNext?.classList.toggle("hidden", index < 0 || index >= viewerSequence.length - 1);
}

function renderImage(photo) {
    const generation = ++imageGeneration;
    const preview = getPhotoPreviewUrl(photo, 420);
    const best = getBestPhotoUrl(photo);

    dom.photoViewerImage.classList.add("is-loading");
    dom.photoViewerImage.removeAttribute("src");

    if (preview) {
        dom.photoViewerImage.src = preview;
        dom.photoViewerImage.classList.remove("is-loading");
    } else if (best) {
        dom.photoViewerImage.src = best;
        dom.photoViewerImage.classList.remove("is-loading");
        return;
    }

    if (!best || best === preview) return;
    const loader = new Image();
    loader.onload = () => {
        if (generation !== imageGeneration || Number(activePhoto?.id) !== Number(photo?.id)) return;
        dom.photoViewerImage.src = best;
        dom.photoViewerImage.classList.remove("is-loading");
    };
    loader.src = best;
}

function renderPhoto(photo) {
    activePhoto = photo;
    state.currentPhoto = photo;

    renderImage(photo);

    const text = String(photo?.text || "");
    dom.photoViewerDescription.textContent = text;
    dom.photoViewerDescription.classList.toggle("hidden", !text.trim());
    dom.photoViewerLikes.textContent = String(Number(photo?.likes?.count || 0));
    dom.photoViewerReposts.textContent = String(Number(photo?.reposts?.count || 0));
    updateArrows();
}

function setFreshnessWarning(text = "") {
    if (!dom.photoViewerFreshness) return;
    dom.photoViewerFreshness.textContent = text;
    dom.photoViewerFreshness.classList.toggle("hidden", !text);
}

function patchSequenceWithAlbumPhotos(albumId, photos) {
    const map = new Map((photos || []).map(photo => [Number(photo.id), photo]));
    viewerSequence = viewerSequence.map(item => Number(item?.album_id) === Number(albumId) && map.has(Number(item.id))
        ? map.get(Number(item.id))
        : item
    );
    state.viewerSequence = viewerSequence;

    if (Array.isArray(state.globalMatches)) {
        state.globalMatches = state.globalMatches.map(item => Number(item?.album_id) === Number(albumId) && map.has(Number(item.id))
            ? map.get(Number(item.id))
            : item
        );
    }

    if (Array.isArray(state.globalMatchesSource)) {
        const otherAlbums = state.globalMatchesSource.filter(item => Number(item?.album_id) !== Number(albumId));
        state.globalMatchesSource = [...otherAlbums, ...(photos || [])];
    }
}

async function refreshGlobalPhotoIfNeeded(photo) {
    if (viewerSource !== "global-search") return photo;
    const albumId = Number(photo?.album_id || 0);
    if (!albumId) return photo;

    try {
        setFreshnessWarning(isAlbumFresh(albumId) ? "" : "Проверяем актуальность данных…");
        const photos = await ensureAlbumFreshForGlobal(albumId);
        patchSequenceWithAlbumPhotos(albumId, photos);
        const fresh = photos.find(item => Number(item.id) === Number(photo.id)) || photo;
        setFreshnessWarning("");
        return fresh;
    } catch (error) {
        console.warn("Не удалось проверить актуальность фотографии:", error);
        setFreshnessWarning("Не удалось проверить актуальность данных. Показана сохранённая версия.");
        return photo;
    }
}

async function moveByStep(step) {
    const index = activeIndex();
    if (index < 0) return;
    const candidate = viewerSequence[index + step];
    if (!candidate?.id) return;

    const album = albumForPhoto(candidate);
    await openPhotoViewer(candidate, album, {
        replaceHistory: true,
        sequence: viewerSequence,
        viewerSource
    });
}

export async function openPhotoViewer(photo, album, {
    fromHistory = false,
    replaceHistory = false,
    sequence = null,
    viewerSource: source = ""
} = {}) {
    if (!photo?.id) return;

    activeAlbum = album || albumForPhoto(photo);
    viewerSource = String(source || state.photoViewerSource || "album");
    state.photoViewerSource = viewerSource;

    if (Array.isArray(sequence) && sequence.length) {
        viewerSequence = normalizeSequence(sequence, photo);
    } else if (!viewerSequence.length || !viewerSequence.some(item => Number(item.id) === Number(photo.id))) {
        viewerSequence = normalizeSequence(state.photos, photo);
    }
    state.viewerSequence = viewerSequence;

    if (!fromHistory) {
        if (replaceHistory) replacePhotoHistory(photo, activeAlbum, { viewerSource });
        else pushPhotoHistory(photo, activeAlbum, { viewerSource });
    }

    showPhotoViewerScreen();
    setFreshnessWarning("");
    renderPhoto(photo);

    const fresh = await refreshGlobalPhotoIfNeeded(photo);
    if (Number(state.currentPhoto?.id) !== Number(photo.id)) return;
    activeAlbum = albumForPhoto(fresh);
    renderPhoto(fresh);
}

export function initPhotoViewer() {
    if (initialized) return;
    initialized = true;

    dom.photoViewerPrev?.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        void moveByStep(-1);
    });

    dom.photoViewerNext?.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        void moveByStep(1);
    });

    dom.openPhotoCommentsButton?.addEventListener("click", () => {
        if (activePhoto) openPhotoComments(activePhoto);
    });

    if (dom.photoViewerImage) {
        dom.photoViewerImage.draggable = false;
        // Long press uses the same restricted client menu as cards in albums.
        bindPhotoLongPress(dom.photoViewerImage, new Proxy({}, {
            get(_target, prop) {
                return activePhoto?.[prop];
            }
        }));
    }
}
