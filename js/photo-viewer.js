import { state } from "./state.js?v=20260920-threadsearch02";
import { dom } from "./dom.js?v=20260920-threadsearch02";
import { vkApi } from "./vk-api.js?v=20260920-threadsearch02";
import { getBestPhotoUrl, escapeHtml } from "./helpers.js?v=20260920-threadsearch02";
import { getOwnerId } from "./group-context.js?v=20260920-threadsearch02";
import {
    showPhotoViewerScreen,
    pushPhotoHistory
} from "./navigation.js?v=20260920-threadsearch02";
import { photoCommentOwnerId } from "./photo-comment-api.js?v=20260920-threadsearch02";
import { openVkProfile, openVkTarget, openVkPhoto } from "./vk-links.js?v=20260920-threadsearch02";
import { invalidatePhotoActivityCaches } from "./cache.js?v=20260920-threadsearch02";

const COMMENT_PAGE_SIZE = 100;
const LONG_PRESS_MS = 460;
const MOVE_TOLERANCE = 10;

let initialized = false;
let activePhoto = null;
let activeAlbum = null;
let authors = new Map();
let comments = [];
let contextOverlay = null;

function normalizeGroupsResponse(response) {
    if (Array.isArray(response)) return response;
    if (Array.isArray(response?.groups)) return response.groups;
    if (Array.isArray(response?.items)) return response.items;
    return [];
}

function authorInfo(comment) {
    const id = Number(comment?.from_id || 0);
    if (authors.has(id)) return authors.get(id);
    return {
        id,
        name: id > 0 ? `Пользователь ${id}` : id < 0 ? `Сообщество ${Math.abs(id)}` : "Пользователь"
    };
}

function formatDate(ts) {
    if (!ts) return "";
    return new Date(Number(ts) * 1000).toLocaleString("ru-RU");
}

function commentId(comment) {
    const id = Number(comment?.id || comment?.cid || 0);
    return Number.isFinite(id) && id > 0 ? id : null;
}

function commentKey(comment) {
    return String(commentId(comment) || `${comment?.from_id || 0}:${comment?.date || 0}:${comment?.text || ""}`);
}

function parentCommentId(comment) {
    const stack = Array.isArray(comment?.parents_stack) ? comment.parents_stack : [];
    const fromStack = Number(stack[stack.length - 1] || 0);
    if (fromStack > 0) return fromStack;

    const direct = Number(comment?.reply_to_comment || comment?.reply_to_comment_id || 0);
    return direct > 0 ? direct : null;
}

function normalizeCommentForThread(comment, forcedParentId = null) {
    const parentId = Number(forcedParentId || parentCommentId(comment) || 0) || null;
    return {
        ...comment,
        _is_reply: Boolean(parentId),
        _parent_comment_id: parentId
    };
}

function flattenComments(items) {
    const map = new Map();

    for (const item of Array.isArray(items) ? items : []) {
        const root = normalizeCommentForThread(item);
        map.set(commentKey(root), root);

        const rootId = commentId(item);
        const threadItems = Array.isArray(item?.thread?.items) ? item.thread.items : [];
        for (const reply of threadItems) {
            const normalizedReply = normalizeCommentForThread(reply, parentCommentId(reply) || rootId);
            map.set(commentKey(normalizedReply), normalizedReply);
        }
    }

    return [...map.values()].sort((a, b) => Number(b.date || 0) - Number(a.date || 0));
}

function addAuthors(profiles = [], groups = []) {
    for (const user of Array.isArray(profiles) ? profiles : []) {
        const id = Number(user?.id || 0);
        if (!id) continue;
        authors.set(id, {
            id,
            name: `${user.first_name || ""} ${user.last_name || ""}`.trim() || `id${id}`
        });
    }

    for (const group of Array.isArray(groups) ? groups : []) {
        const raw = Number(group?.id || 0);
        if (!raw) continue;
        const id = -Math.abs(raw);
        authors.set(id, {
            id,
            name: group.name || `club${raw}`
        });
    }
}

async function loadMissingAuthors(items) {
    const userIds = [...new Set(
        items.map(x => Number(x?.from_id || 0)).filter(id => id > 0 && !authors.has(id))
    )];
    const groupIds = [...new Set(
        items.map(x => Number(x?.from_id || 0)).filter(id => id < 0 && !authors.has(id)).map(Math.abs)
    )];

    if (userIds.length) {
        try {
            const users = await vkApi("users.get", { user_ids: userIds.join(",") });
            addAuthors(users, []);
        } catch (error) {
            console.warn("Не удалось загрузить имена пользователей фото:", error);
        }
    }

    if (groupIds.length) {
        try {
            const groups = normalizeGroupsResponse(await vkApi("groups.getById", {
                group_ids: groupIds.join(",")
            }));
            addAuthors([], groups);
        } catch (error) {
            console.warn("Не удалось загрузить сообщества-авторы фото:", error);
        }
    }
}

async function fetchPhoto(photo) {
    const ownerId = Number(photo?.owner_id || getOwnerId());
    const photoId = Number(photo?.id || 0);
    if (!photoId) throw new Error("Неизвестен ID фотографии.");

    const result = await vkApi("photos.getById", {
        photos: `${ownerId}_${photoId}`,
        extended: 1,
        photo_sizes: 1
    });

    return Array.isArray(result) && result[0] ? result[0] : photo;
}

async function fetchAllComments(photo) {
    const ownerId = photoCommentOwnerId(photo);
    const photoId = Number(photo.id);
    const collected = [];
    authors = new Map();
    let offset = 0;

    while (true) {
        const result = await vkApi("photos.getComments", {
            owner_id: ownerId,
            photo_id: photoId,
            need_likes: 1,
            offset,
            count: COMMENT_PAGE_SIZE,
            sort: "desc",
            extended: 1,
            ...(photo.access_key ? { access_key: String(photo.access_key) } : {})
        });

        const items = Array.isArray(result?.items) ? result.items : [];
        collected.push(...items);
        addAuthors(result?.profiles, result?.groups);

        if (!items.length || items.length < COMMENT_PAGE_SIZE) break;
        offset += items.length;
    }

    comments = flattenComments(collected);
    await loadMissingAuthors(comments);
    return comments;
}

function appendRichText(container, rawText) {
    const raw = String(rawText || "");
    if (!raw) {
        container.textContent = "(без текста)";
        return;
    }

    const re = /\[((?:id|club|public)\d+)\|([^\]]+)\]/g;
    let last = 0;
    let match;

    while ((match = re.exec(raw)) !== null) {
        if (match.index > last) {
            container.appendChild(document.createTextNode(raw.slice(last, match.index)));
        }

        const button = document.createElement("button");
        button.type = "button";
        button.className = "comment-inline-link";
        button.textContent = match[2];
        button.addEventListener("click", event => {
            event.stopPropagation();
            openVkTarget(match[1]);
        });
        container.appendChild(button);
        last = match.index + match[0].length;
    }

    if (last < raw.length) {
        container.appendChild(document.createTextNode(raw.slice(last)));
    }
}

function copyText(text) {
    const value = String(text || "");
    if (!value) return Promise.resolve();

    if (navigator.clipboard?.writeText) {
        return navigator.clipboard.writeText(value).catch(() => fallbackCopy(value));
    }

    return fallbackCopy(value);
}

function fallbackCopy(value) {
    const area = document.createElement("textarea");
    area.value = value;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
    return Promise.resolve();
}

function userCanEdit(comment) {
    if (Number(comment?.can_edit || 0) === 1 || comment?.can_edit === true) return true;
    return Number(comment?.from_id || 0) === Number(state.currentUser?.id || 0);
}

function closeContextMenu() {
    if (contextOverlay?.remove) contextOverlay.remove();
    contextOverlay = null;
}

function makeMenuButton(text, action, danger = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `context-menu-button${danger ? " context-menu-button-danger" : ""}`;
    button.textContent = text;
    button.addEventListener("click", async () => {
        closeContextMenu();
        await action();
    });
    return button;
}

function openCommentContext(comment) {
    closeContextMenu();

    const overlay = document.createElement("div");
    overlay.className = "context-menu-overlay";
    const sheet = document.createElement("div");
    sheet.className = "context-menu-sheet";

    sheet.appendChild(makeMenuButton("Копировать", () => copyText(comment.text || "")));

    sheet.appendChild(makeMenuButton("Удалить", async () => {
        if (!confirm("Удалить комментарий?")) return;

        try {
            await vkApi("photos.deleteComment", {
                owner_id: photoCommentOwnerId(activePhoto),
                comment_id: Number(comment.id)
            });
            invalidatePhotoActivityCaches(
                photoCommentOwnerId(activePhoto),
                Number(activePhoto?.album_id || activeAlbum?.id || 0),
                Number(activePhoto?.id || 0)
            );
            await refreshPhotoComments();
        } catch (error) {
            alert(`Не удалось удалить комментарий.\n\n${escapeHtml(String(error?.error_data?.error_msg || error?.error_msg || error?.message || error))}`);
        }
    }, true));

    sheet.appendChild(makeMenuButton("Отмена", async () => {}));
    overlay.appendChild(sheet);
    overlay.addEventListener("click", event => {
        if (event.target === overlay) closeContextMenu();
    });
    document.body.appendChild(overlay);
    contextOverlay = overlay;
}

function installLongPress(element, handler) {
    let timer = null;
    let x = 0;
    let y = 0;

    const clear = () => {
        if (timer) clearTimeout(timer);
        timer = null;
    };

    element.addEventListener("pointerdown", event => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        x = event.clientX;
        y = event.clientY;
        clear();
        timer = setTimeout(() => handler(), LONG_PRESS_MS);
    }, { passive: true });

    element.addEventListener("pointermove", event => {
        if (!timer) return;
        if (Math.abs(event.clientX - x) > MOVE_TOLERANCE || Math.abs(event.clientY - y) > MOVE_TOLERANCE) {
            clear();
        }
    }, { passive: true });

    element.addEventListener("pointerup", clear, { passive: true });
    element.addEventListener("pointercancel", clear, { passive: true });
    element.addEventListener("contextmenu", event => {
        event.preventDefault();
        handler();
    });
}

function renderPhotoHeader(photo) {
    const url = getBestPhotoUrl(photo);
    dom.photoViewerImage.src = url;
    dom.photoViewerImage.alt = photo.text || "Фотография";
    dom.photoViewerDescription.textContent = photo.text || "";
    dom.photoViewerDescription.classList.toggle("hidden", !String(photo.text || "").trim());

    dom.photoViewerLikes.textContent = String(Number(photo?.likes?.count || 0));
    dom.photoViewerReposts.textContent = String(Number(photo?.reposts?.count || 0));
}

function unansweredPhotoCommentIds(items) {
    const answered = new Set();

    for (const comment of Array.isArray(items) ? items : []) {
        const stack = Array.isArray(comment?.parents_stack) ? comment.parents_stack : [];
        for (const raw of stack) {
            const id = Number(raw || 0);
            if (id > 0) answered.add(String(id));
        }

        const parent = Number(
            comment?._parent_comment_id ||
            comment?.reply_to_comment ||
            comment?.reply_to_comment_id ||
            0
        );
        if (parent > 0) answered.add(String(parent));
    }

    const currentUserId = Number(state.currentUser?.id || 0);
    const communityOwnerId = Number(getOwnerId() || 0);
    const result = new Set();

    for (const comment of Array.isArray(items) ? items : []) {
        if (comment?._is_reply) continue;
        const id = commentId(comment);
        if (!id || answered.has(String(id))) continue;

        const authorId = Number(comment?.from_id || 0);
        if (currentUserId && authorId === currentUserId) continue;
        if (communityOwnerId && authorId === communityOwnerId) continue;
        result.add(String(id));
    }

    return result;
}

function renderPhotoComments() {
    dom.photoViewerComments.innerHTML = "";

    if (!comments.length) {
        const empty = document.createElement("div");
        empty.className = "photo-viewer-empty-comments";

        const message = document.createElement("div");
        message.className = "status-message";
        message.textContent = "Комментариев пока нет";

        const openVk = document.createElement("button");
        openVk.type = "button";
        openVk.className = "secondary-button photo-viewer-open-vk-comment";
        openVk.textContent = "Написать первый комментарий в VK";
        openVk.addEventListener("click", () => {
            openVkPhoto(activePhoto, photoCommentOwnerId(activePhoto));
        });

        empty.append(message, openVk);
        dom.photoViewerComments.appendChild(empty);
        return;
    }

    const unansweredIds = unansweredPhotoCommentIds(comments);

    for (const comment of comments) {
        const card = document.createElement("div");
        card.className = "photo-viewer-comment";
        if (comment?._is_reply) {
            card.classList.add("photo-viewer-comment-reply");
        } else if (unansweredIds.has(String(commentId(comment)))) {
            card.classList.add("photo-viewer-comment-unanswered");
        }

        const top = document.createElement("div");
        top.className = "photo-viewer-comment-top";

        const info = authorInfo(comment);
        const authorButton = document.createElement("button");
        authorButton.type = "button";
        authorButton.className = "comment-author-link";
        authorButton.textContent = info.name;
        authorButton.addEventListener("click", event => {
            event.stopPropagation();
            openVkProfile(info.id);
        });

        const date = document.createElement("span");
        date.className = "comment-date";
        date.textContent = formatDate(comment.date);
        top.append(authorButton, date);

        const text = document.createElement("div");
        text.className = "comment-text";
        appendRichText(text, comment.text || "");

        const actions = document.createElement("div");
        actions.className = "photo-viewer-comment-actions";
        const reply = document.createElement("button");
        reply.type = "button";
        reply.className = "comment-reply-link";
        reply.textContent = "Ответить";
        reply.addEventListener("click", () => {
            // Ответы через photos.createComment из Mini App запрещены VK
            // для non-standalone приложений. Открываем фотографию в
            // нативном VK и отвечаем штатными средствами VK.
            openVkPhoto(activePhoto, photoCommentOwnerId(activePhoto));
        });
        actions.appendChild(reply);

        card.append(top, text, actions);
        installLongPress(card, () => openCommentContext(comment));
        dom.photoViewerComments.appendChild(card);
    }
}

async function refreshPhotoComments() {
    dom.photoViewerComments.innerHTML = '<div class="status-message">Загружаем комментарии...</div>';

    try {
        await fetchAllComments(activePhoto);
        renderPhotoComments();
    } catch (error) {
        dom.photoViewerComments.innerHTML = `
            <div class="error">
                Не удалось загрузить комментарии.<br><br>
                ${escapeHtml(String(error?.error_data?.error_msg || error?.error_msg || error?.message || error))}
            </div>
        `;
    }
}

async function refreshAfterNativePhotoReturn(detail) {
    if (!activePhoto || state.currentScreen !== "photo") return;
    if (detail?.type !== "photo") return;
    if (Number(detail?.photoId || 0) !== Number(activePhoto.id || 0)) return;

    const ownerId = photoCommentOwnerId(activePhoto);
    const albumId = Number(activePhoto?.album_id || activeAlbum?.id || detail?.albumId || 0);

    invalidatePhotoActivityCaches(ownerId, albumId, Number(activePhoto.id || 0));

    try {
        const fullPhoto = await fetchPhoto(activePhoto);
        activePhoto = fullPhoto;
        state.currentPhoto = fullPhoto;
        renderPhotoHeader(fullPhoto);
        await refreshPhotoComments();
    } catch (error) {
        console.warn("Не удалось обновить фотографию после возврата из VK:", error);
    }
}

export async function openPhotoViewer(photo, album, {
    fromHistory = false,
    fromComments = false
} = {}) {
    if (!photo?.id) return;

    activeAlbum = album || state.currentAlbum || state.albums.find(a => String(a.id) === String(photo.album_id));
    activePhoto = photo;
    state.currentAlbum = activeAlbum || state.currentAlbum;
    state.currentPhoto = photo;

    if (!fromHistory) {
        pushPhotoHistory(photo, activeAlbum, { fromComments });
    }

    showPhotoViewerScreen();
    dom.pageTitle.textContent = "Фотография";
    dom.photoViewerComments.innerHTML = '<div class="status-message">Загружаем комментарии...</div>';

    try {
        const fullPhoto = await fetchPhoto(photo);
        activePhoto = fullPhoto;
        state.currentPhoto = fullPhoto;
        renderPhotoHeader(fullPhoto);
        await refreshPhotoComments();
    } catch (error) {
        console.error("Не удалось открыть фотографию:", error);
        renderPhotoHeader(photo);
        dom.photoViewerComments.innerHTML = `
            <div class="error">
                Не удалось полностью загрузить фотографию.<br><br>
                ${escapeHtml(String(error?.error_data?.error_msg || error?.error_msg || error?.message || error))}
            </div>
        `;
    }
}

export function initPhotoViewer() {
    if (initialized) return;
    initialized = true;

    window.addEventListener("vk-native-return", event => {
        void refreshAfterNativePhotoReturn(event?.detail);
    });
}
