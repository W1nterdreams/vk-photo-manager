import { state } from "./state.js";
import { vkApi } from "./vk-api.js";

function readGroupIdFromLaunchParams() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("vk_group_id") || params.get("group_id");
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
}

export async function initGroupContext() {
    const groupId = readGroupIdFromLaunchParams();

    if (!groupId) {
        throw new Error(
            "Не найден vk_group_id. Откройте Mini App из сообщества VK, " +
            "которым нужно управлять."
        );
    }

    state.group = {
        id: groupId,
        ownerId: -groupId,
        name: "",
        isAdmin: false,
        adminLevel: 0
    };

    // Получаем данные сообщества и одновременно проверяем контекст.
    const groups = await vkApi("groups.getById", {
        group_id: groupId,
        fields: "name,is_admin,admin_level"
    });

    const group = Array.isArray(groups)
        ? groups[0]
        : (groups?.groups?.[0] || groups?.items?.[0] || groups);

    if (group) {
        state.group.name = group.name || "";
        state.group.isAdmin = Boolean(group.is_admin);
        state.group.adminLevel = Number(group.admin_level || 0);
    }

    if (!state.group.isAdmin && state.group.adminLevel <= 0) {
        throw new Error(
            `У пользователя нет прав администратора сообщества «${state.group.name || groupId}».`
        );
    }

    console.log("Group context:", state.group);
    return state.group;
}

export function getGroupId() {
    if (!state.group?.id) throw new Error("Контекст сообщества не инициализирован.");
    return state.group.id;
}

export function getOwnerId() {
    if (!state.group?.ownerId) throw new Error("Контекст сообщества не инициализирован.");
    return state.group.ownerId;
}
