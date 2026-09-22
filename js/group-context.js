import { state } from "./state.js?v=20260922-access31";
import { vkApi } from "./vk-api.js?v=20260922-access31";

let lastAccessDiagnostic = null;

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
 * Роль из launch params сохраняем только для диагностики.
 * Она НЕ используется как источник авторизации: контекст запуска может
 * отличаться от фактических прав пользователя в сообществе.
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

function normalizeGroupsResponse(response) {
    if (Array.isArray(response)) return response;
    if (Array.isArray(response?.groups)) return response.groups;
    if (Array.isArray(response?.items)) return response.items;
    return [];
}

/**
 * Проверяем права пользователя только для ТЕКУЩЕГО vk_group_id.
 *
 * Важное отличие от v29/v30:
 * - НЕ запрашиваем scope=groups;
 * - НЕ читаем список сообществ пользователя;
 * - НЕ используем community token как обязательную проверку;
 * - используем обычный user token приложения и groups.getById.
 *
 * groups.getById возвращает is_admin и admin_level для текущего пользователя.
 * Разрешаем только уровень 3 (administrator). Владельцы сообщества в этом
 * контексте также представлены с максимальным административным уровнем.
 */
async function verifyCurrentCommunityAdministrator(groupId) {
    let response;

    try {
        response = await vkApi("groups.getById", {
            group_id: Number(groupId),
            fields: "is_admin,admin_level"
        });
    } catch (error) {
        lastAccessDiagnostic = {
            checkedAt: Date.now(),
            groupId: Number(groupId),
            ok: false,
            stage: "groups.getById",
            error: String(error?.message || error?.error_msg || error || "unknown")
        };

        throw new GroupAccessDeniedError(
            "Не удалось проверить права в текущем сообществе через VK API. " +
            "Повторите запуск приложения.",
            "GROUP_ACCESS_CHECK_FAILED"
        );
    }

    const groups = normalizeGroupsResponse(response);
    const group = groups.find(item => Number(item?.id) === Number(groupId)) || groups[0] || null;

    const isAdmin = group?.is_admin === true || Number(group?.is_admin) === 1;
    const adminLevel = Number(group?.admin_level || 0);
    const allowed = Boolean(group && isAdmin && adminLevel === 3);

    lastAccessDiagnostic = {
        checkedAt: Date.now(),
        groupId: Number(groupId),
        ok: allowed,
        launchRole: readViewerGroupRoleFromLaunchParams(),
        responseShape: Array.isArray(response)
            ? "array"
            : Array.isArray(response?.groups)
                ? "object.groups"
                : Array.isArray(response?.items)
                    ? "object.items"
                    : typeof response,
        group: group
            ? {
                id: Number(group.id || 0),
                name: String(group.name || ""),
                is_admin: group.is_admin,
                admin_level: group.admin_level
            }
            : null
    };

    if (!group) {
        throw new GroupAccessDeniedError(
            "VK не вернул данные текущего сообщества.",
            "GROUP_ACCESS_CHECK_FAILED"
        );
    }

    if (!allowed) {
        throw new GroupAccessDeniedError(
            "Доступ к приложению разрешён только владельцу и администраторам сообщества."
        );
    }

    return group;
}

/**
 * Инициализация контекста сообщества и обязательная проверка доступа.
 * Требует уже полученный user access token (scope=photos достаточно).
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
        accessSource: "groups.getById"
    };

    const group = await verifyCurrentCommunityAdministrator(groupId);

    state.group.name = String(group?.name || "");
    state.group.isAdmin = true;
    state.group.adminLevel = 3;
    state.group.accessGranted = true;

    console.log("GROUP CONTEXT:", state.group);
    console.log("GROUP ID:", state.group.id);
    console.log("PHOTO OWNER ID:", state.group.ownerId);
    console.log("GROUP ACCESS: owner/administrator confirmed by groups.getById");

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

if (typeof window !== "undefined") {
    window.groupAccessDebug = {
        status: () => lastAccessDiagnostic ? JSON.parse(JSON.stringify(lastAccessDiagnostic)) : null
    };
}
