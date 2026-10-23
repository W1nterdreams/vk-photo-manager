/*
 * Local VK Bridge-compatible runtime for the methods used by this Mini App.
 * Adapted from the public VKCOM/vk-bridge project (MIT License).
 * Original project: https://github.com/VKCOM/vk-bridge
 *
 * This local copy removes the runtime dependency on unpkg.com. It does not
 * transmit data anywhere by itself: it only forwards VK Bridge messages to
 * the VK host/native client in which the Mini App is running.
 */
(function () {
    "use strict";

    if (window.vkBridge && typeof window.vkBridge.send === "function") return;

    const isClient = typeof window !== "undefined";
    const androidBridge = isClient ? window.AndroidBridge : undefined;
    const iosHandlers = isClient ? window.webkit?.messageHandlers : undefined;
    const isIOS = Boolean(iosHandlers?.VKWebAppClose || iosHandlers?.VKWebAppInit);
    const isAndroid = Boolean(androidBridge);
    const isReactNative = Boolean(isClient && window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === "function");
    const isWeb = isClient && !isIOS && !isAndroid;
    const eventType = isWeb ? "message" : "VKWebAppEvent";
    const subscribers = [];
    const controllers = new Map();
    let requestCounter = 0;
    let webFrameId;
    const instanceId = Math.random().toString(36).slice(2, 5);
    const connectVersion = "2.15.0";

    function rawSend(method, props) {
        if (androidBridge && typeof androidBridge[method] === "function") {
            androidBridge[method](JSON.stringify(props || {}));
            return;
        }

        const iosMethod = iosHandlers?.[method];
        if (iosMethod && typeof iosMethod.postMessage === "function") {
            iosMethod.postMessage(props || {});
            return;
        }

        if (isReactNative) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ handler: method, params: props || {} }));
            return;
        }

        if (isWeb && window.parent && typeof window.parent.postMessage === "function") {
            window.parent.postMessage({
                handler: method,
                params: props || {},
                type: "vk-connect",
                webFrameId,
                connectVersion
            }, "*");
            return;
        }

        throw new Error("VK Bridge environment is unavailable.");
    }

    function subscribe(listener) {
        if (typeof listener === "function" && !subscribers.includes(listener)) subscribers.push(listener);
    }

    function unsubscribe(listener) {
        const index = subscribers.indexOf(listener);
        if (index >= 0) subscribers.splice(index, 1);
    }

    function dispatch(detail) {
        const event = { detail };
        [...subscribers].forEach(listener => {
            try { listener(event); } catch (error) { console.error("VK Bridge subscriber error:", error); }
        });
    }

    function handleEvent(event) {
        if (isIOS || isAndroid) {
            const detail = event?.detail;
            if (!detail?.type) return;
            processDetail(detail.type, detail.data, detail.frameId);
            return;
        }

        let payload = event?.data;
        if (!payload) return;

        if (isReactNative && typeof payload === "string") {
            try { payload = JSON.parse(payload); } catch { return; }
        }

        const { type, data, frameId } = payload || {};
        if (!type) return;
        processDetail(type, data, frameId);
    }

    function processDetail(type, data, frameId) {
        if (type === "VKWebAppSettings") {
            webFrameId = frameId;
            return;
        }

        if (data && typeof data === "object" && Object.prototype.hasOwnProperty.call(data, "request_id")) {
            const requestId = data.request_id;
            const controller = controllers.get(String(requestId));
            if (controller) {
                const response = { ...data };
                delete response.request_id;
                controllers.delete(String(requestId));
                if (Object.prototype.hasOwnProperty.call(response, "error_type")) controller.reject(response);
                else controller.resolve(response);
            }
        }

        dispatch({ type, data });
    }

    if (isReactNative && /android/i.test(navigator.userAgent || "")) {
        document.addEventListener(eventType, handleEvent);
    } else if (isClient && typeof window.addEventListener === "function") {
        window.addEventListener(eventType, handleEvent);
    }

    function send(method, props = {}) {
        return new Promise((resolve, reject) => {
            const customId = props && props.request_id != null ? props.request_id : null;
            const requestId = customId != null ? customId : `${++requestCounter}_${instanceId}`;
            controllers.set(String(requestId), { resolve, reject });
            try {
                rawSend(method, { ...props, request_id: requestId });
            } catch (error) {
                controllers.delete(String(requestId));
                reject(error);
            }
        });
    }

    const bridge = {
        send,
        sendPromise: send,
        subscribe,
        unsubscribe,
        isWebView: () => isIOS || isAndroid,
        isIframe: () => isWeb && window.parent !== window,
        isEmbedded: () => isIOS || isAndroid || (isWeb && window.parent !== window),
        isStandalone: () => !(isIOS || isAndroid || (isWeb && window.parent !== window))
    };

    window.vkBridge = bridge;
    window.vkConnect = bridge;
})();
