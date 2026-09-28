import { state } from "./state.js?v=20260928-client04-albumfix";

function launchGroupId() {
    const params = new URLSearchParams(window.location.search);
    const id = Number(params.get("vk_group_id") || params.get("group_id") || 0);
    return Number.isInteger(id) && id > 0 ? id : 0;
}

export function initGroupContext(config) {
    const launched = launchGroupId();
    const homeGroupId = Number(config?.home_group_id || 0);

    // Если приложение запущено из сообщества, работаем с этим сообществом.
    // При прямом запуске используем нашу домашнюю группу.
    const groupId = launched || homeGroupId;
    if (!groupId) {
        throw new Error("VK не передал vk_group_id, а home_group_id не указан в config.json.");
    }

    const blocked = new Set((config?.blocked_group_ids || []).map(Number));
    if (blocked.has(groupId)) {
        throw new Error("Приложение недоступно для этого сообщества.");
    }

    state.groupId = groupId;
    state.ownerId = -Math.abs(groupId);
    state.restrictAlbums = Boolean(homeGroupId > 0 && groupId === homeGroupId);

    return {
        groupId,
        ownerId: state.ownerId,
        restrictAlbums: state.restrictAlbums,
        launchedGroupId: launched
    };
}

export function getGroupId() {
    if (!state.groupId) throw new Error("Контекст сообщества не инициализирован.");
    return state.groupId;
}

export function getOwnerId() {
    if (!state.ownerId) throw new Error("Контекст сообщества не инициализирован.");
    return state.ownerId;
}

export function usesRestrictedAlbums() {
    return Boolean(state.restrictAlbums);
}

export function getConfiguredHomeAlbumIds() {
    return Array.isArray(state.config?.home_group_album_ids)
        ? state.config.home_group_album_ids.map(Number).filter(id => Number.isInteger(id) && id > 0)
        : [];
}
