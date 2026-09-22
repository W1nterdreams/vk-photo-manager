import { state } from "./state.js?v=20260922-adminfix29";
import { vkApi } from "./vk-api.js?v=20260922-adminfix29";

const ADMIN_GROUPS_PAGE_SIZE = 1000;

export class GroupAccessDeniedError extends Error {
    constructor(message, code = "GROUP_ACCESS_DENIED") {
        super(message);
        this.name = "GroupAccessDeniedError";
        this.code = code;
    }
}

/**
 * ID сообщества берём из launch params VK Mini Apps.
 */
function readGroupIdFromLaunchParams() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("vk_group_id") || params.get("group_id");
    const id = Number(raw);

    return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * vk_viewer_group_role сохраняем только для диагностики.
 * ВАЖНО: это параметр контекста запуска, а не источник авторизации.
 */
function readViewerGroupRoleFromLaunchParams() {
    const params = new URLSearchParams(window.location.search);
    const role = String(params.get("vk_viewer_group_role") || "")
        .trim()
        .toLowerCase();

    return role || null;
}

function getLaunchContext() {
    return {
        groupId: readGroupIdFromLaunchParams(),
        viewerGroupRole: readViewerGroupRoleFromLaunchParams()
    };
}

/**
 * Ранняя проверка выполняет только проверку наличия group_id.
 * vk_viewer_group_role намеренно НЕ используем для допуска/запрета.
 */
export function precheckLaunchGroupAccess() {
    const { groupId, viewerGroupRole } = getLaunchContext();

    if (!groupId) {
        throw new Error(
            "Не найден vk_group_id. " +
            "Откройте Mini App из сообщества VK, которым нужно управлять."
        );
    }

    return { groupId, viewerGroupRole };
}

function extractGroup(response) {
    if (Array.isArray(response)) return response[0] || null;
    return response?.groups?.[0] || response?.items?.[0] || response || null;
}

function extractGroupIds(response) {
    const items = Array.isArray(response?.items) ? response.items : [];

    return items
        .map(item => {
            if (typeof item === "number" || typeof item === "string") {
                return Number(item);
            }
            return Number(item?.id);
        })
        .filter(id => Number.isInteger(id) && id > 0);
}

/**
 * Надёжная серверная проверка: groups.get(filter=admin) возвращает только
 * сообщества, которыми текущий пользователь управляет как владелец/администратор.
 * Фильтры editor/moder мы намеренно НЕ используем.
 */
async function userAdministersGroup(groupId) {
    let offset = 0;

    while (true) {
        const response = await vkApi("groups.get", {
            filter: ["admin"],
            extended: 0,
            offset,
            count: ADMIN_GROUPS_PAGE_SIZE
        });

        const ids = extractGroupIds(response);
        if (ids.includes(groupId)) return true;

        const total = Number(response?.count || 0);
        if (ids.length === 0 || offset + ids.length >= total) {
            return false;
        }

        offset += ids.length;
    }
}

/**
 * Инициализация контекста сообщества и обязательная проверка доступа.
 *
 * Источник истины для прав — groups.get(filter=admin).
 * launch-параметр vk_viewer_group_role используется только для диагностики.
 */
export async function initGroupContext() {
    const { groupId, viewerGroupRole } = precheckLaunchGroupAccess();

    console.log("FULL URL:", window.location.href);
    console.log("VK GROUP ID:", groupId);
    console.log("VK VIEWER GROUP ROLE (diagnostic only):", viewerGroupRole);

    state.group = {
        id: groupId,
        ownerId: -Math.abs(groupId),
        name: "",
        isAdmin: false,
        adminLevel: 0,
        viewerGroupRole,
        accessGranted: false,
        accessSource: "groups.get:admin"
    };

    // Имя сообщества получаем отдельно. Оно не участвует в решении о доступе.
    try {
        const infoResponse = await vkApi("groups.getById", {
            group_id: groupId,
            fields: "name"
        });
        const group = extractGroup(infoResponse);
        state.group.name = group?.name || "";
    } catch (error) {
        console.warn("Не удалось получить название сообщества:", error);
    }

    let hasAdministratorAccess = false;

    try {
        hasAdministratorAccess = await userAdministersGroup(groupId);
    } catch (error) {
        console.warn("Не удалось проверить groups.get(filter=admin):", error);

        throw new GroupAccessDeniedError(
            "Не удалось подтвердить права владельца/администратора сообщества. " +
            "Убедитесь, что приложению разрешён доступ к сообществам, и повторите запуск.",
            "GROUP_ACCESS_CHECK_FAILED"
        );
    }

    if (!hasAdministratorAccess) {
        throw new GroupAccessDeniedError(
            "Доступ к приложению разрешён только владельцу и администраторам сообщества."
        );
    }

    state.group.isAdmin = true;
    state.group.adminLevel = 3;
    state.group.accessGranted = true;

    console.log("GROUP CONTEXT:", state.group);
    console.log("GROUP ID:", state.group.id);
    console.log("PHOTO OWNER ID:", state.group.ownerId);
    console.log("GROUP ACCESS: owner/administrator confirmed by groups.get(filter=admin)");

    return state.group;
}

export function getGroupId() {
    const groupId = Number(state.group?.id);

    if (!Number.isInteger(groupId) || groupId <= 0) {
        throw new Error(
            "Контекст сообщества не инициализирован: отсутствует group_id."
        );
    }

    return groupId;
}

export function getOwnerId() {
    const ownerId = Number(state.group?.ownerId);

    if (!Number.isInteger(ownerId) || ownerId >= 0) {
        throw new Error(
            "Контекст сообщества не инициализирован: отсутствует owner_id."
        );
    }

    return ownerId;
}

export function getGroupContext() {
    if (!state.group?.id || state.group?.accessGranted !== true) {
        throw new Error(
            "Контекст сообщества не инициализирован или доступ не подтверждён."
        );
    }

    return state.group;
}
