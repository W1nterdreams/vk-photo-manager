import { state } from "./state.js?v=20260929-client09-albumsfix";

function urlLaunchGroupId() {
    const params = new URLSearchParams(window.location.search);
    const id = Number(params.get("vk_group_id") || params.get("group_id") || 0);
    return Number.isInteger(id) && id > 0 ? id : 0;
}

function bridgeLaunchGroupId(launchParams) {
    const id = Number(launchParams?.vk_group_id || 0);
    return Number.isInteger(id) && id > 0 ? id : 0;
}

function currentUserId(user, launchParams) {
    const fromBridge = Number(launchParams?.vk_user_id || 0);
    if (Number.isInteger(fromBridge) && fromBridge > 0) return fromBridge;

    const fromUser = Number(user?.id || 0);
    return Number.isInteger(fromUser) && fromUser > 0 ? fromUser : 0;
}

export function initGroupContext(config, currentUser, launchParams = null) {
    // VKWebAppGetLaunchParams — основной источник контекста. URL оставлен только
    // как запасной вариант для старых клиентов/режимов запуска.
    const launchedGroupId = bridgeLaunchGroupId(launchParams) || urlLaunchGroupId();
    const homeGroupId = Number(config?.home_group_id || 0);
    const blocked = new Set((config?.blocked_group_ids || []).map(Number));

    if (launchedGroupId > 0) {
        if (blocked.has(launchedGroupId)) {
            throw new Error("Доступ к приложению для этого сообщества запрещён.");
        }

        state.groupId = launchedGroupId;
        state.ownerId = -Math.abs(launchedGroupId);
        state.contextType = "group";
        state.restrictAlbums = Boolean(homeGroupId > 0 && launchedGroupId === homeGroupId);

        return {
            contextType: state.contextType,
            groupId: state.groupId,
            ownerId: state.ownerId,
            restrictAlbums: state.restrictAlbums,
            launchedGroupId
        };
    }

    // Прямой запуск: работаем с альбомами именно текущего пользователя.
    const userId = currentUserId(currentUser, launchParams);
    if (!userId) {
        throw new Error("Не удалось определить пользователя или сообщество запуска.");
    }

    state.groupId = 0;
    state.ownerId = userId;
    state.contextType = "user";
    state.restrictAlbums = false;

    return {
        contextType: state.contextType,
        groupId: 0,
        ownerId: state.ownerId,
        restrictAlbums: false,
        launchedGroupId: 0
    };
}

export function getGroupId() {
    return Number(state.groupId || 0);
}

export function getOwnerId() {
    if (!state.ownerId) throw new Error("Контекст владельца фото не инициализирован.");
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
