import { state } from "./state.js?v=20260928-client02";

function launchGroupId() {
    const params = new URLSearchParams(window.location.search);
    const id = Number(params.get("vk_group_id") || params.get("group_id") || 0);
    return Number.isInteger(id) && id > 0 ? id : 0;
}

export function initGroupContext(config) {
    const configured = Number(config?.group_id || 0);
    const launched = launchGroupId();

    if (configured > 0 && launched > 0 && configured !== launched) {
        throw new Error(
            `Приложение настроено для сообщества ${configured}, а открыто из сообщества ${launched}.`
        );
    }

    const groupId = configured || launched;
    if (!groupId) {
        throw new Error("Не указан group_id в config.json и VK не передал vk_group_id.");
    }

    state.groupId = groupId;
    state.ownerId = -Math.abs(groupId);
    return { groupId, ownerId: state.ownerId };
}

export function getGroupId() {
    if (!state.groupId) throw new Error("Контекст сообщества не инициализирован.");
    return state.groupId;
}

export function getOwnerId() {
    if (!state.ownerId) throw new Error("Контекст сообщества не инициализирован.");
    return state.ownerId;
}
