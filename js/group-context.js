import { state } from "./state.js?v=20260922-search30";
import { VK_APP_ID } from "./config.js?v=20260922-search30";

const COMMUNITY_TOKEN_METHODS = [
    "VKWebAppGetCommunityToken",
    "VKWebAppGetCommunityAuthToken",
    "VKWebAppCommunityAccessToken",
    "VKWebAppCommunityToken"
];

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
 * Она НЕ используется как источник авторизации.
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

async function bridgeSupports(method) {
    try {
        if (typeof vkBridge?.supportsAsync === "function") {
            return Boolean(await vkBridge.supportsAsync(method));
        }
    } catch (error) {
        console.warn(`Не удалось проверить поддержку ${method} через supportsAsync:`, error);
    }

    try {
        if (typeof vkBridge?.supports === "function") {
            return Boolean(vkBridge.supports(method));
        }
    } catch (error) {
        console.warn(`Не удалось проверить поддержку ${method} через supports:`, error);
    }

    return method === "VKWebAppGetCommunityToken";
}

async function chooseCommunityTokenMethod() {
    for (const method of COMMUNITY_TOKEN_METHODS) {
        if (await bridgeSupports(method)) return method;
    }
    return null;
}

/**
 * Проверяем права только относительно ТЕКУЩЕГО сообщества.
 * VK разрешает получить community token только администратору сообщества.
 * Список сообществ пользователя и scope=groups для этого больше не нужны.
 *
 * Сам токен нам не нужен для дальнейших API-вызовов и нигде не сохраняется:
 * успешный ответ используется только как подтверждение прав.
 */
async function verifyCurrentCommunityAdministrator(groupId) {
    const method = await chooseCommunityTokenMethod();
    if (!method) {
        throw new GroupAccessDeniedError(
            "Текущая версия VK не поддерживает проверку прав администратора сообщества.",
            "GROUP_ACCESS_CHECK_FAILED"
        );
    }

    let response;
    try {
        response = await vkBridge.send(method, {
            app_id: VK_APP_ID,
            group_id: Number(groupId),
            scope: ""
        });
    } catch (error) {
        console.warn(`Не удалось получить community token через ${method}:`, error);

        const { viewerGroupRole } = getLaunchContext();
        const clearlyNotAdmin = ["editor", "moder", "member", "none"].includes(viewerGroupRole);

        if (clearlyNotAdmin) {
            throw new GroupAccessDeniedError(
                "Доступ к приложению разрешён только владельцу и администраторам сообщества."
            );
        }

        throw new GroupAccessDeniedError(
            "Не удалось подтвердить права владельца/администратора текущего сообщества. " +
            "Повторите запуск приложения.",
            "GROUP_ACCESS_CHECK_FAILED"
        );
    }

    if (!response?.access_token) {
        throw new GroupAccessDeniedError(
            "VK не подтвердил права владельца/администратора текущего сообщества.",
            "GROUP_ACCESS_CHECK_FAILED"
        );
    }

    return method;
}

async function loadCurrentGroupInfo(groupId) {
    try {
        const response = await vkBridge.send("VKWebAppGetGroupInfo", {
            group_id: Number(groupId)
        });
        return response || null;
    } catch (error) {
        console.warn("Не удалось получить информацию о текущем сообществе:", error);
        return null;
    }
}

/**
 * Инициализация контекста сообщества и обязательная проверка доступа.
 *
 * В v30 приложение больше НЕ запрашивает scope=groups и НЕ читает список
 * сообществ пользователя. Проверка выполняется только для vk_group_id,
 * из которого запущено Mini App.
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
        accessSource: "community-token"
    };

    const accessMethod = await verifyCurrentCommunityAdministrator(groupId);

    const groupInfo = await loadCurrentGroupInfo(groupId);
    state.group.name = groupInfo?.name || "";
    state.group.isAdmin = true;
    state.group.adminLevel = 3;
    state.group.accessGranted = true;
    state.group.accessSource = accessMethod;

    console.log("GROUP CONTEXT:", state.group);
    console.log("GROUP ID:", state.group.id);
    console.log("PHOTO OWNER ID:", state.group.ownerId);
    console.log(`GROUP ACCESS: owner/administrator confirmed by ${accessMethod}`);

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
