import { dom } from "./dom.js?v=20260919-nav03";
import { state } from "./state.js?v=20260919-nav03";
import { vkApi } from "./vk-api.js?v=20260919-nav03";
import {
    escapeHtml,
    getErrorMessage,
    getPhotoPreviewUrl
} from "./helpers.js?v=20260919-nav03";
import {
    showCommentsScreen,
    pushCommentsHistory
} from "./navigation.js?v=20260919-nav03";
import { getOwnerId } from "./group-context.js?v=20260919-nav03";
import { cacheGet, cacheSet } from "./cache.js?v=20260919-nav03";
import { CACHE_TTL } from "./config.js?v=20260919-nav03";

const ALBUM_COMMENTS_DAYS = 3;
const PAGE_SIZE = 100;
const MAX_COMMENTS = 30;
const LONG_PRESS_MS = 460;
const MOVE_TOLERANCE = 10;

let activeAlbum = null;
let loading = false;
let replyEditor = null;
let commentMenuOverlay = null;

function commentsTitleElement() {
    return document.querySelector(".comments-title");
}

function cacheKey(album) {
    return `album-comments:${getOwnerId()}:${album.id}:${ALBUM_COMMENTS_DAYS}d:${MAX_COMMENTS}`;
}

function cutoffTimestamp() {
    return Math.floor((Date.now() - ALBUM_COMMENTS_DAYS * 86400000) / 1000);
}

function commentPhotoId(comment) {
    const value = comment?.photo_id ?? comment?.pid;
    const id = Number(value);
    return Number.isFinite(id) && id > 0 ? id : null;
}

function commentId(comment) {
    const id = Number(comment?.id || comment?.cid || 0);
    return Number.isFinite(id) && id > 0 ? id : null;
}

function normalizeGroupsResponse(response) {
    if (Array.isArray(response)) return response;
    if (Array.isArray(response?.groups)) return response.groups;
    if (Array.isArray(response?.items)) return response.items;
    return [];
}

function formatDate(ts) {
    if (!ts) return "";
    return new Date(Number(ts) * 1000).toLocaleString("ru-RU");
}

function getAuthorLinkById(id) {
    if (id > 0) return `https://vk.com/id${id}`;
    if (id < 0) return `https://vk.com/club${Math.abs(id)}`;
    return "https://vk.com";
}

async function openVkLink(url) {
    try {
        if (window.vkBridge?.send) {
            await window.vkBridge.send("VKWebAppOpenLink", { url });
            return;
        }
    } catch (error) {
        console.debug("VKWebAppOpenLink failed:", error);
    }

    try {
        window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
        location.href = url;
    }
}

function updateCommentsTitle(album) {
    const title = commentsTitleElement();
    if (title) {
        title.textContent = `Комментарии: ${album?.title || "Альбом"}`;
    }
    dom.pageTitle.textContent = "Комментарии альбома";
}

async function loadRecentRawCommentsFast(album) {
    const ownerId = getOwnerId();
    const cutoff = cutoffTimestamp();
    const recent = [];
    let offset = 0;
    let hitOldComment = false;

    while (recent.length < MAX_COMMENTS) {
        const result = await vkApi("photos.getAllComments", {
            owner_id: ownerId,
            album_id: Number(album.id),
            count: PAGE_SIZE,
            offset
        });

        const items = Array.isArray(result?.items) ? result.items : [];
        if (!items.length) break;

        for (const comment of items) {
            const date = Number(comment?.date || 0);
            if (date < cutoff) {
                hitOldComment = true;
                break;
            }

            recent.push(comment);
            if (recent.length >= MAX_COMMENTS) break;
        }

        if (recent.length >= MAX_COMMENTS || hitOldComment || items.length < PAGE_SIZE) {
            break;
        }

        offset += items.length;
    }

    recent.sort((a, b) => Number(b.date || 0) - Number(a.date || 0));
    return recent.slice(0, MAX_COMMENTS);
}

async function loadAllAlbumPhotos(album) {
    const ownerId = getOwnerId();
    const all = [];
    let offset = 0;

    while (true) {
        const result = await vkApi("photos.get", {
            owner_id: ownerId,
            album_id: Number(album.id),
            photo_sizes: 1,
            count: PAGE_SIZE,
            offset
        });

        const items = Array.isArray(result?.items) ? result.items : [];
        if (!items.length) break;

        all.push(...items);
        offset += items.length;

        if (items.length < PAGE_SIZE) break;
    }

    return all;
}

async function loadRecentRawCommentsFallback(album) {
    const ownerId = getOwnerId();
    const cutoff = cutoffTimestamp();
    const photos = await loadAllAlbumPhotos(album);
    const recent = [];
    const photosMap = new Map();

    for (const photo of photos) {
        if (photo?.id) photosMap.set(String(photo.id), photo);

        let offset = 0;
        while (true) {
            const result = await vkApi("photos.getComments", {
                owner_id: ownerId,
                photo_id: Number(photo.id),
                count: PAGE_SIZE,
                offset,
                sort: "desc"
            });

            const items = Array.isArray(result?.items) ? result.items : [];
            if (!items.length) break;

            let hitOld = false;

            for (const comment of items) {
                const date = Number(comment?.date || 0);
                if (date < cutoff) {
                    hitOld = true;
                    break;
                }

                const normalized = {
                    ...comment,
                    photo_id: Number(photo.id)
                };
                recent.push(normalized);
            }

            if (hitOld || items.length < PAGE_SIZE) break;
            offset += items.length;
        }
    }

    recent.sort((a, b) => Number(b.date || 0) - Number(a.date || 0));
    return {
        comments: recent.slice(0, MAX_COMMENTS),
        photos: photosMap
    };
}

async function loadPhotosForComments(comments) {
    const ownerId = getOwnerId();
    const ids = [...new Set(comments.map(commentPhotoId).filter(Boolean))];
    const map = new Map();

    for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        if (!chunk.length) continue;

        try {
            const photos = await vkApi("photos.getById", {
                photos: chunk.map(id => `${ownerId}_${id}`),
                photo_sizes: 1
            });

            for (const photo of Array.isArray(photos) ? photos : []) {
                map.set(String(photo.id), photo);
            }
        } catch (error) {
            console.warn("Не удалось получить превью фотографий комментариев:", error);
        }
    }

    return map;
}

async function loadAuthors(comments) {
    const userIds = [...new Set(
        comments
            .map(item => Number(item?.from_id || 0))
            .filter(id => id > 0)
    )];

    const groupIds = [...new Set(
        comments
            .map(item => Number(item?.from_id || 0))
            .filter(id => id < 0)
            .map(id => Math.abs(id))
    )];

    const authors = new Map();

    if (userIds.length) {
        try {
            const users = await vkApi("users.get", {
                user_ids: userIds
            });

            for (const user of Array.isArray(users) ? users : []) {
                const id = Number(user.id);
                const name = `${user.first_name || ""} ${user.last_name || ""}`.trim() || `id${id}`;
                authors.set(id, {
                    id,
                    name,
                    url: getAuthorLinkById(id),
                    isGroup: false
                });
            }
        } catch (error) {
            console.warn("Не удалось получить имена авторов комментариев:", error);
        }
    }

    if (groupIds.length) {
        try {
            const response = await vkApi("groups.getById", {
                group_ids: groupIds
            });

            for (const group of normalizeGroupsResponse(response)) {
                const id = -Math.abs(Number(group.id));
                authors.set(id, {
                    id,
                    name: group.name || `club${group.id}`,
                    url: getAuthorLinkById(id),
                    isGroup: true
                });
            }
        } catch (error) {
            console.warn("Не удалось получить названия сообществ-авторов:", error);
        }
    }

    return authors;
}

function authorInfo(comment, authors) {
    const id = Number(comment?.from_id || 0);
    if (authors.has(id)) return authors.get(id);
    return {
        id,
        name: id > 0 ? `Пользователь ${id}` : id < 0 ? `Сообщество ${Math.abs(id)}` : "Пользователь",
        url: getAuthorLinkById(id),
        isGroup: id < 0
    };
}

function serializeForCache(data) {
    return {
        comments: data.comments,
        photos: [...data.photos.entries()],
        authors: [...data.authors.entries()]
    };
}

function restoreFromCache(data) {
    return {
        comments: Array.isArray(data?.comments) ? data.comments : [],
        photos: new Map(Array.isArray(data?.photos) ? data.photos : []),
        authors: new Map(Array.isArray(data?.authors) ? data.authors : [])
    };
}

async function fetchAlbumComments(album) {
    let comments = [];
    let photos = new Map();

    try {
        comments = await loadRecentRawCommentsFast(album);
    } catch (error) {
        console.warn("photos.getAllComments failed, fallback scan will be used:", error);
    }

    if (comments.length) {
        photos = await loadPhotosForComments(comments);
    }

    // Для альбомов, где fast-метод VK не отдаёт комментарии,
    // делаем надёжный резервный проход по фото альбома.
    if (!comments.length) {
        const fallback = await loadRecentRawCommentsFallback(album);
        comments = fallback.comments;
        photos = fallback.photos;
    }

    comments.sort((a, b) => Number(b.date || 0) - Number(a.date || 0));
    comments = comments.slice(0, MAX_COMMENTS);

    const authors = await loadAuthors(comments);
    return { comments, photos, authors };
}

function clearReplyEditor() {
    if (replyEditor?.container?.remove) {
        replyEditor.container.remove();
    }
    replyEditor = null;
}

function closeCommentMenu() {
    if (commentMenuOverlay?.remove) commentMenuOverlay.remove();
    commentMenuOverlay = null;
}

async function copyText(text) {
    const value = String(text || "").trim();
    if (!value) return;

    try {
        await navigator.clipboard.writeText(value);
        return;
    } catch (_) {
        const input = document.createElement("textarea");
        input.value = value;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.focus();
        input.select();
        document.execCommand("copy");
        input.remove();
    }
}

function userCanEditComment(comment) {
    const currentId = Number(state.currentUser?.id || 0);
    return currentId > 0 && Number(comment?.from_id || 0) === currentId;
}

function appendRichCommentText(container, text) {
    const raw = String(text || "");
    if (!raw) {
        container.textContent = "(без текста)";
        return;
    }

    const re = /\[((?:id|club|public)\d+)\|([^\]]+)\]/g;
    let lastIndex = 0;
    let match;

    while ((match = re.exec(raw)) !== null) {
        const [full, target, label] = match;
        if (match.index > lastIndex) {
            container.appendChild(document.createTextNode(raw.slice(lastIndex, match.index)));
        }

        const link = document.createElement("button");
        link.type = "button";
        link.className = "comment-inline-link";
        link.textContent = label;
        link.addEventListener("click", event => {
            event.stopPropagation();
            void openVkLink(`https://vk.com/${target}`);
        });
        container.appendChild(link);

        lastIndex = match.index + full.length;
    }

    if (lastIndex < raw.length) {
        container.appendChild(document.createTextNode(raw.slice(lastIndex)));
    }
}

function createReplyEditor(card, body, comment, mode = "reply") {
    clearReplyEditor();

    const container = document.createElement("div");
    container.className = "comment-reply-box";

    const textarea = document.createElement("textarea");
    textarea.className = "comment-reply-input";
    textarea.placeholder = mode === "reply" ? "Ответ на комментарий..." : "Изменить комментарий...";
    textarea.value = mode === "edit" ? String(comment?.text || "") : "";

    const actions = document.createElement("div");
    actions.className = "comment-reply-actions";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "secondary-button";
    cancel.textContent = "Отмена";
    cancel.addEventListener("click", () => clearReplyEditor());

    const submit = document.createElement("button");
    submit.type = "button";
    submit.className = "primary-button";
    submit.textContent = mode === "reply" ? "Ответить" : "Сохранить";

    const error = document.createElement("div");
    error.className = "form-error hidden";

    submit.addEventListener("click", async () => {
        const message = textarea.value.trim();
        if (!message) {
            error.textContent = "Введите текст комментария.";
            error.classList.remove("hidden");
            return;
        }

        const photoId = commentPhotoId(comment);
        const id = commentId(comment);
        if (!photoId || !id) return;

        submit.disabled = true;
        cancel.disabled = true;
        error.classList.add("hidden");

        try {
            if (mode === "reply") {
                await vkApi("photos.createComment", {
                    owner_id: getOwnerId(),
                    photo_id: photoId,
                    message,
                    reply_to_comment: id
                });
            } else {
                await vkApi("photos.editComment", {
                    owner_id: getOwnerId(),
                    comment_id: id,
                    message
                });
            }

            clearReplyEditor();
            if (activeAlbum) await loadAlbumComments(activeAlbum, { force: true });
        } catch (apiError) {
            error.textContent = getErrorMessage(apiError);
            error.classList.remove("hidden");
        } finally {
            submit.disabled = false;
            cancel.disabled = false;
        }
    });

    actions.append(cancel, submit);
    container.append(textarea, error, actions);
    body.appendChild(container);

    textarea.focus();
    textarea.selectionStart = textarea.value.length;
    textarea.selectionEnd = textarea.value.length;

    replyEditor = { container, card, commentId: commentId(comment), mode };
}

async function deleteComment(comment) {
    const id = commentId(comment);
    if (!id) return;

    const confirmed = window.confirm("Удалить этот комментарий?");
    if (!confirmed) return;

    try {
        await vkApi("photos.deleteComment", {
            owner_id: getOwnerId(),
            comment_id: id
        });
        if (activeAlbum) await loadAlbumComments(activeAlbum, { force: true });
    } catch (error) {
        alert(`Не удалось удалить комментарий.\n\n${getErrorMessage(error)}`);
    }
}

function createMenuButton(label, onClick, { dangerous = false } = {}) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `context-menu-button${dangerous ? " context-menu-button-danger" : ""}`;
    btn.textContent = label;
    btn.addEventListener("click", async event => {
        event.stopPropagation();
        closeCommentMenu();
        await onClick();
    });
    return btn;
}

function openCommentMenu({ card, body, comment, author, photo }) {
    closeCommentMenu();

    const overlay = document.createElement("div");
    overlay.className = "context-menu-overlay";

    const menu = document.createElement("div");
    menu.className = "context-menu-sheet";

    menu.appendChild(createMenuButton("Копировать", async () => {
        await copyText(comment?.text || "");
    }));

    if (userCanEditComment(comment)) {
        menu.appendChild(createMenuButton("Редактировать", async () => {
            createReplyEditor(card, body, comment, "edit");
        }));
    }

    menu.appendChild(createMenuButton("Удалить", async () => {
        await deleteComment(comment);
    }, { dangerous: true }));

    const cancel = createMenuButton("Отмена", async () => {});
    cancel.classList.add("context-menu-button-cancel");
    menu.appendChild(cancel);

    overlay.appendChild(menu);
    overlay.addEventListener("click", event => {
        if (event.target === overlay) closeCommentMenu();
    });

    document.body.appendChild(overlay);
    commentMenuOverlay = overlay;
}

function installLongPress(card, handler) {
    let timer = null;
    let startX = 0;
    let startY = 0;
    let longPressed = false;

    const clear = () => {
        if (timer) clearTimeout(timer);
        timer = null;
    };

    const onPointerDown = event => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        longPressed = false;
        startX = event.clientX;
        startY = event.clientY;
        clear();
        timer = setTimeout(() => {
            longPressed = true;
            handler(event);
        }, LONG_PRESS_MS);
    };

    const onPointerMove = event => {
        if (!timer) return;
        const dx = Math.abs(event.clientX - startX);
        const dy = Math.abs(event.clientY - startY);
        if (dx > MOVE_TOLERANCE || dy > MOVE_TOLERANCE) clear();
    };

    const onPointerUp = () => clear();
    const onPointerCancel = () => clear();

    card.addEventListener("pointerdown", onPointerDown, { passive: true });
    card.addEventListener("pointermove", onPointerMove, { passive: true });
    card.addEventListener("pointerup", onPointerUp, { passive: true });
    card.addEventListener("pointercancel", onPointerCancel, { passive: true });
    card.addEventListener("contextmenu", event => {
        event.preventDefault();
        handler(event);
    });

    return () => longPressed;
}

function createCommentCard(comment, data) {
    const card = document.createElement("div");
    card.className = "comment-card comment-card-rich";

    const photoId = commentPhotoId(comment);
    const photo = photoId ? data.photos.get(String(photoId)) : null;
    const photoUrl = getPhotoPreviewUrl(photo, 220);
    const author = authorInfo(comment, data.authors);

    const thumbWrap = document.createElement("button");
    thumbWrap.type = "button";
    thumbWrap.className = "comment-thumb-button";

    if (photoUrl) {
        const img = document.createElement("img");
        img.className = "comment-photo";
        img.src = photoUrl;
        img.alt = "";
        img.loading = "lazy";
        thumbWrap.appendChild(img);
    } else {
        const ph = document.createElement("div");
        ph.className = "comment-photo comment-photo-placeholder";
        ph.textContent = "🖼";
        thumbWrap.appendChild(ph);
    }

    thumbWrap.addEventListener("click", event => {
        event.stopPropagation();
        if (!photo?.id) return;
        const ownerId = photo.owner_id || getOwnerId();
        void openVkLink(`https://vk.com/photo${ownerId}_${photo.id}`);
    });

    const body = document.createElement("div");
    body.className = "comment-body";

    const header = document.createElement("div");
    header.className = "comment-header";

    const authorBtn = document.createElement("button");
    authorBtn.type = "button";
    authorBtn.className = "comment-author-link";
    authorBtn.textContent = author.name;
    authorBtn.addEventListener("click", event => {
        event.stopPropagation();
        void openVkLink(author.url);
    });

    header.appendChild(authorBtn);

    const text = document.createElement("div");
    text.className = "comment-text";
    appendRichCommentText(text, comment.text || "");

    const meta = document.createElement("div");
    meta.className = "comment-meta-row";

    const date = document.createElement("div");
    date.className = "comment-date";
    date.textContent = formatDate(comment.date);

    const reply = document.createElement("button");
    reply.type = "button";
    reply.className = "comment-reply-link";
    reply.textContent = "Ответить";
    reply.addEventListener("click", event => {
        event.stopPropagation();
        createReplyEditor(card, body, comment, "reply");
    });

    meta.append(date, reply);
    body.append(header, text, meta);

    const wasLongPress = installLongPress(card, () => {
        openCommentMenu({ card, body, comment, author, photo });
    });

    card.addEventListener("click", event => {
        if (wasLongPress()) {
            event.preventDefault();
            event.stopPropagation();
        }
    });

    card.append(thumbWrap, body);
    return card;
}

function renderComments(album, data) {
    dom.comments.innerHTML = "";
    clearReplyEditor();
    closeCommentMenu();

    if (!data.comments.length) {
        dom.comments.innerHTML = `
            <div class="status-message">
                Комментариев за последние ${ALBUM_COMMENTS_DAYS} дня нет
            </div>
        `;
        return;
    }

    for (const comment of data.comments) {
        dom.comments.appendChild(createCommentCard(comment, data));
    }
}

export async function loadAlbumComments(album, { force = false } = {}) {
    if (!album || loading) return;

    activeAlbum = album;
    updateCommentsTitle(album);

    const key = cacheKey(album);

    if (!force) {
        const cached = cacheGet(key, CACHE_TTL.comments);
        if (cached) {
            renderComments(album, restoreFromCache(cached));
            return;
        }
    }

    loading = true;
    dom.refreshComments.disabled = true;
    dom.comments.innerHTML = `
        <div class="status-message">
            Загружаем последние ${MAX_COMMENTS} комментариев за ${ALBUM_COMMENTS_DAYS} дня...
        </div>
    `;

    try {
        const data = await fetchAlbumComments(album);
        cacheSet(key, serializeForCache(data));
        renderComments(album, data);
    } catch (error) {
        dom.comments.innerHTML = `
            <div class="error">
                Не удалось загрузить комментарии альбома.<br><br>
                ${escapeHtml(getErrorMessage(error))}
            </div>
        `;
    } finally {
        loading = false;
        dom.refreshComments.disabled = false;
    }
}

async function openAlbumComments(album) {
    activeAlbum = album;
    pushCommentsHistory();
    showCommentsScreen();
    updateCommentsTitle(album);
    await loadAlbumComments(album);
}

export function initAlbumComments() {
    window.addEventListener("album-menu-action", event => {
        if (event?.detail?.action !== "comments") return;
        const album = event.detail.album;
        if (!album) return;
        void openAlbumComments(album);
    });

    dom.refreshComments.addEventListener("click", event => {
        if (!activeAlbum) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void loadAlbumComments(activeAlbum, { force: true });
    }, true);

    dom.commentsMenuButton.addEventListener("click", () => {
        activeAlbum = null;
        clearReplyEditor();
        closeCommentMenu();
        const title = commentsTitleElement();
        if (title) title.textContent = "Комментарии к фотографиям";
    }, true);

    dom.comments.addEventListener("click", () => {
        closeCommentMenu();
    });

    window.addEventListener("popstate", () => {
        closeCommentMenu();
        clearReplyEditor();
    });
}
