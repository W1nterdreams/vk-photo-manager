import { state } from "./state.js?v=20260929-client08-authfix";

function launchGroupId() {
    const params = new URLSearchParams(window.location.search);
    const id = Number(params.get("vk_group_id") || params.get("group_id") || 0);
    return Number.isInteger(id) && id > 0 ? id : 0;
}

function currentUserId(user) {
    const id = Number(user?.id || 0);
    return Number.isInteger(id) && id > 0 ? id : 0;
}

export function initGroupContext(config, currentUser) {
    const launchedGroupId = launchGroupId();
    const homeGroupId = Number(config?.home_group_id || 0);
    const blocked = new Set((config?.blocked_group_ids || []).map(Number));

    // Если приложение запущено из сообщества, владельцем данных является именно
    // это сообщество. Домашняя группа получает специальный список альбомов,
    // остальные разрешённые группы — все свои обычные фотоальбомы.
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

    // При прямом запуске Mini App из каталога/ссылки vk_group_id отсутствует.
    // В этом случае НЕ подставляем home_group_id: показываем фотоальбомы
    // текущего пользователя. Это устраняет утечку нашей домашней конфигурации
    // в чужой пользовательский запуск.
    const userId = currentUserId(currentUser);
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
