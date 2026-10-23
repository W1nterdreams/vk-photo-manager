const DB_NAME = "vk-photo-client-index";
const DB_VERSION = 1;
const PHOTO_STORE = "photos";
const META_STORE = "meta";
const INDEX_SCHEMA = 1;

let dbPromise = null;

function photoKey(ownerId, photoId) {
    return `${Number(ownerId)}:${Number(photoId)}`;
}

function albumKey(ownerId, albumId) {
    return `${Number(ownerId)}:${Number(albumId)}`;
}

function metaKey(ownerId) {
    return `owner:${Number(ownerId)}`;
}

function normalize(value = "") {
    return String(value)
        .toLocaleLowerCase("ru-RU")
        .replace(/ё/g, "е")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function compactSizes(sizes) {
    if (!Array.isArray(sizes)) return [];
    const list = sizes.filter(item => item?.url).map(item => ({
        type: item.type || "",
        url: item.url,
        width: Number(item.width || 0),
        height: Number(item.height || 0)
    }));
    if (!list.length) return [];

    const sorted = [...list].sort((a, b) => (a.width * a.height) - (b.width * b.height));
    const preview = sorted.find(item => Math.max(item.width, item.height) >= 320) || sorted[sorted.length - 1];
    const best = sorted[sorted.length - 1];
    return preview.url === best.url ? [best] : [preview, best];
}

export function compactPhoto(photo, fallbackOwnerId = 0) {
    const id = Number(photo?.id || 0);
    const ownerId = Number(photo?.owner_id || fallbackOwnerId || 0);
    const albumId = Number(photo?.album_id || 0);
    if (!id || !ownerId || !albumId) return null;

    const text = String(photo?.text || "");
    return {
        key: photoKey(ownerId, id),
        id,
        owner_id: ownerId,
        album_id: albumId,
        owner_album_key: albumKey(ownerId, albumId),
        date: Number(photo?.date || 0),
        text,
        search_text: normalize(text),
        sizes: compactSizes(photo?.sizes),
        likes: photo?.likes ? { count: Number(photo.likes.count || 0) } : undefined,
        comments: photo?.comments ? { count: Number(photo.comments.count || 0) } : undefined,
        reposts: photo?.reposts ? { count: Number(photo.reposts.count || 0) } : undefined,
        cached_at: Date.now()
    };
}

function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        if (typeof indexedDB === "undefined") {
            reject(new Error("IndexedDB недоступен."));
            return;
        }
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(PHOTO_STORE)) {
                const store = db.createObjectStore(PHOTO_STORE, { keyPath: "key" });
                store.createIndex("owner_id", "owner_id", { unique: false });
                store.createIndex("owner_album_key", "owner_album_key", { unique: false });
            }
            if (!db.objectStoreNames.contains(META_STORE)) {
                db.createObjectStore(META_STORE, { keyPath: "key" });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Не удалось открыть IndexedDB."));
    }).catch(error => {
        dbPromise = null;
        throw error;
    });
    return dbPromise;
}

function requestResult(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Ошибка IndexedDB."));
    });
}

function transactionDone(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("Ошибка транзакции IndexedDB."));
        tx.onabort = () => reject(tx.error || new Error("Транзакция IndexedDB отменена."));
    });
}

export async function getIndexMeta(ownerId) {
    const db = await openDb();
    const tx = db.transaction(META_STORE, "readonly");
    const value = await requestResult(tx.objectStore(META_STORE).get(metaKey(ownerId)));
    return value || {
        key: metaKey(ownerId), owner_id: Number(ownerId), schema: INDEX_SCHEMA,
        complete: false,
        allowedSignature: "",
        total: 0,
        lastMetadataCheck: 0,
        albumFingerprints: {},
        updatedAt: 0
    };
}

export async function updateIndexMeta(ownerId, patch = {}) {
    const previous = await getIndexMeta(ownerId);
    const db = await openDb();
    const tx = db.transaction(META_STORE, "readwrite");
    tx.objectStore(META_STORE).put({
        ...previous,
        ...patch,
        key: metaKey(ownerId),
        owner_id: Number(ownerId),
        schema: INDEX_SCHEMA,
        updatedAt: Date.now()
    });
    await transactionDone(tx);
}

async function albumKeys(ownerId, albumId) {
    const db = await openDb();
    const tx = db.transaction(PHOTO_STORE, "readonly");
    return requestResult(tx.objectStore(PHOTO_STORE).index("owner_album_key").getAllKeys(IDBKeyRange.only(albumKey(ownerId, albumId))));
}

export async function replaceIndexedAlbum(ownerId, albumId, photos) {
    const numericOwner = Number(ownerId);
    const numericAlbum = Number(albumId);
    const compact = (Array.isArray(photos) ? photos : [])
        .map(photo => compactPhoto(photo, numericOwner))
        .filter(Boolean)
        .map(photo => ({ ...photo, album_id: numericAlbum, owner_album_key: albumKey(numericOwner, numericAlbum) }));

    const [db, keys] = await Promise.all([openDb(), albumKeys(numericOwner, numericAlbum)]);
    const tx = db.transaction(PHOTO_STORE, "readwrite");
    const store = tx.objectStore(PHOTO_STORE);
    keys.forEach(key => store.delete(key));
    compact.forEach(photo => store.put(photo));
    await transactionDone(tx);
    return compact;
}

export async function replaceIndexedAlbumIfIndexExists(ownerId, albumId, photos) {
    const meta = await getIndexMeta(ownerId);
    if (!meta.complete) return false;
    await replaceIndexedAlbum(ownerId, albumId, photos);
    await updateIndexMeta(ownerId, { updatedAt: Date.now() });
    return true;
}

export async function removeDisallowedAlbums(ownerId, allowedAlbumIds) {
    const allowed = new Set((allowedAlbumIds || []).map(Number));
    const db = await openDb();
    const txRead = db.transaction(PHOTO_STORE, "readonly");
    const items = await requestResult(txRead.objectStore(PHOTO_STORE).index("owner_id").getAll(IDBKeyRange.only(Number(ownerId))));
    const remove = items.filter(item => !allowed.has(Number(item.album_id))).map(item => item.key);
    if (!remove.length) return 0;

    const tx = db.transaction(PHOTO_STORE, "readwrite");
    const store = tx.objectStore(PHOTO_STORE);
    remove.forEach(key => store.delete(key));
    await transactionDone(tx);
    return remove.length;
}

export async function getIndexedPhotos(ownerId, allowedAlbumIds = []) {
    const allowed = new Set((allowedAlbumIds || []).map(Number));
    const db = await openDb();
    const tx = db.transaction(PHOTO_STORE, "readonly");
    const items = await requestResult(tx.objectStore(PHOTO_STORE).index("owner_id").getAll(IDBKeyRange.only(Number(ownerId))));
    return (Array.isArray(items) ? items : []).filter(item => !allowed.size || allowed.has(Number(item.album_id)));
}

export async function getIndexSnapshot(ownerId, allowedAlbumIds = []) {
    const [items, meta] = await Promise.all([
        getIndexedPhotos(ownerId, allowedAlbumIds),
        getIndexMeta(ownerId)
    ]);
    return { items, meta };
}
