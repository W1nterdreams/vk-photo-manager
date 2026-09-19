import { dom } from "./dom.js?v=20260919-nav03";
import { state } from "./state.js?v=20260919-nav03";
import { vkApi } from "./vk-api.js?v=20260919-nav03";
import {
    escapeHtml,
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
const READ_TIMEOUT_MS = 7000;
const PHOTO_LIST_TIMEOUT_MS = 10000;
const MUTATION_TIMEOUT_MS = 15000;
const DEEP_SCAN_CONCURRENCY = 6;
const CACHE_SCHEMA = 5;

let activeAlbum = null;
let replyEditor = null;
let commentMenuOverlay = null;
let loadSequence = 0;

function commentsTitleElement() {
    return document.querySelector(".comments-title");
}

function cacheKey(album) {
    return `album-comments:v${CACHE_SCHEMA}:${getOwnerId()}:${album.id}:${ALBUM_COMMENTS_DAYS}d:${MAX_COMMENTS}`;
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

function describeError(error) {
    if (!error) return "Неизвестная ошибка";
    if (typeof error === "string") return error;

    const candidates = [
        error.message,
        error.error_msg,
        error.error?.error_msg,
        error.error_data?.error_msg,
        error.error_data?.error_reason,
        error.data?.error_msg,
        error.data?.message
    ];

    for (const value of candidates) {
        if (typeof value === "string" && value.trim()) return value.trim();
    }

    try {
        return JSON.stringify(error);
    } catch (_) {
        return String(error);
    }
}

function withTimeout(promise, ms, label) {
    let timer = null;

    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            reject(new Error(`${label}: превышено время ожидания (${Math.round(ms / 1000)} с)`));
        }, ms);
    });

    return Promise.race([promise, timeout]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

function apiRead(method, params, timeout = READ_TIMEOUT_MS) {
    return withTimeout(vkApi(method, params), timeout, method);
}

function apiMutation(method, params) {
    // Мутации не повторяем автоматически: один клик = один запрос.
    return withTimeout(vkApi(method, params), MUTATION_TIMEOUT_MS, method);
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
    } catch (_) {
        location.href = url;
    }
}

function updateCommentsTitle(album) {
    const title = commentsTitleElement();
    if (title) title.textContent = `Комментарии: ${album?.title || "Альбом"}`;
    dom.pageTitle.textContent = "Комментарии альбома";
}

async function loadRecentRawCommentsFast(album) {
    const ownerId = getOwnerId();
    const cutoff = cutoffTimestamp();

    // Для последних 30 комментариев достаточно первой страницы из 100:
    // getAllComments отсортирован от новых к старым.
    const result = await apiRead("photos.getAllComments", {
        owner_id: ownerId,
        album_id: Number(album.id),
        count: PAGE_SIZE,
        offset: 0
    }, READ_TIMEOUT_MS);

    const items = Array.isArray(result?.items) ? result.items : [];

    return items
        .filter(comment => Number(comment?.date || 0) >= cutoffTimestamp())
        .sort((a, b) => Number(b.date || 0) - Number(a.date || 0))
        .slice(0, MAX_COMMENTS);
}

async function loadAlbumPhotosWithCommentCounts(album) {
    const ownerId = getOwnerId();
    const all = [];
    let offset = 0;
    const count = 1000;

    while (true) {
        const result = await apiRead("photos.get", {
            owner_id: ownerId,
            album_id: Number(album.id),
            photo_sizes: 1,
            extended: 1,
            count,
            offset
        }, PHOTO_LIST_TIMEOUT_MS);

        const items = Array.isArray(result?.items) ? result.items : [];
        if (!items.length) break;

        all.push(...items);
        offset += items.length;

        if (items.length < count) break;
    }

    return all;
}

function commentKey(comment) {
    return `${commentPhotoId(comment) || 0}:${commentId(comment) || 0}`;
}

function mergeRecentComments(...lists) {
    const cutoff = cutoffTimestamp();
    const map = new Map();

    for (const list of lists) {
        for (const comment of Array.isArray(list) ? list : []) {
            if (Number(comment?.date || 0) < cutoff) continue;
            map.set(commentKey(comment), comment);
        }
    }

    return [...map.values()]
        .sort((a, b) => Number(b.date || 0) - Number(a.date || 0))
        .slice(0, MAX_COMMENTS);
}

function addProfilesToAuthors(authors, profiles = [], groups = []) {
    for (const user of Array.isArray(profiles) ? profiles : []) {
        const id = Number(user?.id || 0);
        if (!id) continue;
        authors.set(id, {
            id,
            name: `${user.first_name || ""} ${user.last_name || ""}`.trim() || `id${id}`,
            url: getAuthorLinkById(id),
            isGroup: false
        });
    }

    for (const group of Array.isArray(groups) ? groups : []) {
        const rawId = Number(group?.id || 0);
        if (!rawId) continue;
        const id = -Math.abs(rawId);
        authors.set(id, {
            id,
            name: group.name || `club${rawId}`,
            url: getAuthorLinkById(id),
            isGroup: true
        });
    }
}

function normalizePhotoComments(items, photoId) {
    const result = [];

    for (const comment of Array.isArray(items) ? items : []) {
        const normalized = {
            ...comment,
            photo_id: commentPhotoId(comment) || Number(photoId)
        };
        result.push(normalized);

        // Если VK вложил часть ответов в thread.items, тоже учитываем их.
        const threadItems = Array.isArray(comment?.thread?.items)
            ? comment.thread.items
            : [];

        for (const reply of threadItems) {
            result.push({
                ...reply,
                photo_id: commentPhotoId(reply) || Number(photoId)
            });
        }
    }

    return result;
}

async function deepScanAlbumComments(album, baseData, seq, key) {
    let photos;

    try {
        photos = await loadAlbumPhotosWithCommentCounts(album);
    } catch (error) {
        console.warn("Не удалось получить список фотографий для полной проверки комментариев:", error);
        return baseData;
    }

    if (!currentRequestIsValid(seq, album)) return baseData;

    const photosMap = new Map(baseData.photos);
    for (const photo of photos) {
        if (photo?.id) photosMap.set(String(photo.id), photo);
    }

    let comments = mergeRecentComments(baseData.comments);
    const authors = new Map(baseData.authors);

    // Уже на этом этапе обновляем карточки — поэтому миниатюры появляются
    // независимо от photos.getById.
    let current = { comments, photos: photosMap, authors, complete: false };
    if (comments.length) renderComments(album, current);

    const candidates = photos.filter(photo => Number(photo?.comments?.count || 0) > 0);

    if (!candidates.length) {
        current.complete = true;
        cacheSet(key, serializeForCache(current));
        if (currentRequestIsValid(seq, album)) renderComments(album, current);
        return current;
    }

    let nextIndex = 0;
    let finished = 0;

    async function worker() {
        while (true) {
            if (!currentRequestIsValid(seq, album)) return;

            const index = nextIndex++;
            if (index >= candidates.length) return;

            const photo = candidates[index];

            try {
                const response = await apiRead("photos.getComments", {
                    owner_id: getOwnerId(),
                    photo_id: Number(photo.id),
                    count: MAX_COMMENTS,
                    offset: 0,
                    sort: "desc",
                    extended: 1
                }, READ_TIMEOUT_MS);

                if (!currentRequestIsValid(seq, album)) return;

                const found = normalizePhotoComments(response?.items, photo.id)
                    .filter(comment => Number(comment?.date || 0) >= cutoffTimestamp());

                comments = mergeRecentComments(comments, found);
                addProfilesToAuthors(authors, response?.profiles, response?.groups);
            } catch (error) {
                console.warn(`Комментарии фото ${photo?.id}:`, error);
            } finally {
                finished += 1;

                if (currentRequestIsValid(seq, album)) {
                    current = {
                        comments,
                        photos: photosMap,
                        authors,
                        complete: false
                    };

                    // Перерисовываем при найденных комментариях и периодически
                    // во время долгой проверки большого альбома.
                    if (comments.length && !replyEditor && !commentMenuOverlay) {
                        renderComments(album, current);
                    }
                }
            }
        }
    }

    await Promise.all(
        Array.from(
            { length: Math.min(DEEP_SCAN_CONCURRENCY, candidates.length) },
            () => worker()
        )
    );

    if (!currentRequestIsValid(seq, album)) return current;

    current = {
        comments: mergeRecentComments(comments),
        photos: photosMap,
        authors,
        complete: true
    };

    // Если часть авторов пришла только из быстрого getAllComments,
    // добираем их одним компактным запросом.
    try {
        const extraAuthors = await loadAuthors(current.comments);
        for (const [id, author] of extraAuthors) {
            if (!current.authors.has(id)) current.authors.set(id, author);
        }
    } catch (error) {
        console.warn("Не удалось дополнить имена авторов:", error);
    }

    if (currentRequestIsValid(seq, album)) {
        cacheSet(key, serializeForCache(current));
        if (!replyEditor && !commentMenuOverlay) {
            renderComments(album, current);
        }
    }

    return current;
}

function photosFromCurrentState(comments) {
    const wanted = new Set(comments.map(commentPhotoId).filter(Boolean).map(String));
    const map = new Map();

    for (const photo of Array.isArray(state.photos) ? state.photos : []) {
        if (wanted.has(String(photo?.id))) {
            map.set(String(photo.id), photo);
        }
    }

    return map;
}

async function loadPhotosForComments(comments, existing = new Map()) {
    const ownerId = getOwnerId();
    const map = new Map(existing);

    for (const [id, photo] of photosFromCurrentState(comments)) {
        if (!map.has(id)) map.set(id, photo);
    }

    const ids = [...new Set(comments.map(commentPhotoId).filter(Boolean))]
        .filter(id => !map.has(String(id)));

    for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        if (!chunk.length) continue;

        const photosParam = chunk.map(id => `${ownerId}_${id}`).join(",");

        try {
            const photos = await apiRead("photos.getById", {
                photos: photosParam,
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
            const users = await apiRead("users.get", {
                user_ids: userIds.join(",")
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
            const response = await apiRead("groups.getById", {
                group_ids: groupIds.join(",")
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
        authors: [...data.authors.entries()],
        complete: Boolean(data.complete)
    };
}

function restoreFromCache(data) {
    return {
        comments: Array.isArray(data?.comments) ? data.comments : [],
        photos: new Map(Array.isArray(data?.photos) ? data.photos : []),
        authors: new Map(Array.isArray(data?.authors) ? data.authors : []),
        complete: Boolean(data?.complete)
    };
}

function clearReplyEditor() {
    if (replyEditor?.container?.remove) replyEditor.container.remove();
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
    if (Number(comment?.can_edit || 0) === 1 || comment?.can_edit === true) return true;
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

function showInlineError(errorBox, error, prefix = "") {
    const message = describeError(error);
    errorBox.textContent = prefix ? `${prefix}: ${message}` : message;
    errorBox.classList.remove("hidden");
    console.error(prefix || "Ошибка комментария", error);
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

        if (!photoId || !id) {
            error.textContent = "VK не вернул ID фотографии или комментария. Обновите список.";
            error.classList.remove("hidden");
            return;
        }

        submit.disabled = true;
        cancel.disabled = true;
        error.classList.add("hidden");

        try {
            if (mode === "reply") {
                await apiMutation("photos.createComment", {
                    owner_id: getOwnerId(),
                    photo_id: photoId,
                    message,
                    reply_to_comment: id
                });
            } else {
                await apiMutation("photos.editComment", {
                    owner_id: getOwnerId(),
                    comment_id: id,
                    message
                });
            }

            clearReplyEditor();

            // Ошибка повторной загрузки не должна выглядеть как ошибка отправки.
            if (activeAlbum) {
                void loadAlbumComments(activeAlbum, { force: true }).catch(refreshError => {
                    console.warn("Комментарий отправлен, но список не обновился:", refreshError);
                });
            }
        } catch (apiError) {
            showInlineError(error, apiError, mode === "reply" ? "Не удалось отправить ответ" : "Не удалось сохранить");
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

    if (!window.confirm("Удалить этот комментарий?")) return;

    try {
        await apiMutation("photos.deleteComment", {
            owner_id: getOwnerId(),
            comment_id: id
        });

        if (activeAlbum) {
            void loadAlbumComments(activeAlbum, { force: true });
        }
    } catch (error) {
        alert(`Не удалось удалить комментарий.\n\n${describeError(error)}`);
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

function openCommentMenu({ card, body, comment }) {
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

    card.addEventListener("pointerdown", onPointerDown, { passive: true });
    card.addEventListener("pointermove", onPointerMove, { passive: true });
    card.addEventListener("pointerup", clear, { passive: true });
    card.addEventListener("pointercancel", clear, { passive: true });
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
        openCommentMenu({ card, body, comment });
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

function currentRequestIsValid(seq, album) {
    return seq === loadSequence && activeAlbum && String(activeAlbum.id) === String(album.id);
}

async function enrichFastAuthors(album, data, seq, key) {
    try {
        const authors = await loadAuthors(data.comments);
        if (!currentRequestIsValid(seq, album)) return;

        const enriched = {
            ...data,
            authors,
            complete: false
        };
        cacheSet(key, serializeForCache(enriched));
        renderComments(album, enriched);
    } catch (error) {
        console.warn("Не удалось быстро получить имена авторов:", error);
    }
}

export async function loadAlbumComments(album, { force = false } = {}) {
    if (!album) return;

    activeAlbum = album;
    updateCommentsTitle(album);

    const seq = ++loadSequence;
    const key = cacheKey(album);

    if (!force) {
        const cached = cacheGet(key, CACHE_TTL.comments);
        if (cached) {
            const restored = restoreFromCache(cached);
            renderComments(album, restored);
            if (restored.complete) return;
        }
    }

    // ВАЖНО: комментарии конкретного альбома получаем ОДНИМ методом
    // photos.getAllComments. VK сам возвращает их от новых к старым.
    // Мы НЕ перебираем фотографии альбома и НЕ вызываем getComments для каждой.
    dom.comments.innerHTML = `
        <div class="status-message">
            Загружаем последние ${MAX_COMMENTS} комментариев за ${ALBUM_COMMENTS_DAYS} дня...
        </div>
    `;

    try {
        const comments = await loadRecentRawCommentsFast(album);
        if (!currentRequestIsValid(seq, album)) return;

        if (!comments.length) {
            const emptyData = {
                comments: [],
                photos: new Map(),
                authors: new Map(),
                complete: true
            };
            cacheSet(key, serializeForCache(emptyData));
            renderComments(album, emptyData);
            return;
        }

        // Сами комментарии уже есть — показываем их сразу.
        // Фото и ФИО догружаются отдельными компактными запросами.
        let data = {
            comments,
            photos: photosFromCurrentState(comments),
            authors: new Map(),
            complete: false
        };

        renderComments(album, data);

        const [photos, authors] = await Promise.all([
            loadPhotosForComments(comments, data.photos),
            loadAuthors(comments)
        ]);

        if (!currentRequestIsValid(seq, album)) return;

        data = {
            comments,
            photos,
            authors,
            complete: true
        };

        cacheSet(key, serializeForCache(data));

        if (!replyEditor && !commentMenuOverlay) {
            renderComments(album, data);
        }
    } catch (error) {
        console.error("Не удалось загрузить комментарии альбома:", error);

        if (!currentRequestIsValid(seq, album)) return;

        dom.comments.innerHTML = `
            <div class="error">
                Не удалось загрузить комментарии альбома.<br><br>
                ${escapeHtml(describeError(error))}
                <br><br>Нажмите «Обновить», чтобы повторить.
            </div>
        `;
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
        ++loadSequence;
        clearReplyEditor();
        closeCommentMenu();
        const title = commentsTitleElement();
        if (title) title.textContent = "Комментарии к фотографиям";
    }, true);

    dom.comments.addEventListener("click", () => {
        closeCommentMenu();
    });

    window.addEventListener("popstate", () => {
        ++loadSequence;
        closeCommentMenu();
        clearReplyEditor();
    });
}
