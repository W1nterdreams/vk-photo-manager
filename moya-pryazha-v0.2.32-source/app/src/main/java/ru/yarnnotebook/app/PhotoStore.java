package ru.yarnnotebook.app;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;

public final class PhotoStore {
    private static final String INTERNAL_LAYOUTS_ROOT = "layouts";
    private static final String INTERNAL_PHOTOS = "photos";
    private static final String INTERNAL_ACTIVE = "active";
    private static final String INTERNAL_ARCHIVE = "archive";
    private static final String LEGACY_ROOT = "product_photos";

    private static final String PUBLIC_ROOT = "Моя пряжа";
    private static final String PUBLIC_ARCHIVE = "Архив";

    private static final int MAX_SIDE = 1200;
    private static final int JPEG_QUALITY = 78;

    private PhotoStore() { }

    public static String fileName(long internalNumber) {
        return "yarn_" + internalNumber + ".jpg";
    }

    public static String publicFolderLabel() {
        return "Pictures/" + PUBLIC_ROOT;
    }

    public static boolean exists(Context context, YarnRecord record) {
        return ensureVisibleUri(context, record) != null;
    }

    public static void migrateExistingPhotos(Context context, List<YarnRecord> records) {
        if (records == null) return;
        for (YarnRecord record : records) {
            try {
                ensureVisibleUri(context, record);
            } catch (Exception ignored) { }
        }
    }

    public static String saveCompressed(Context context, Uri sourceUri, YarnRecord record) throws IOException {
        if (sourceUri == null) throw new IOException("Фотография не выбрана");
        if (record == null || record.internalNumber <= 0 || record.layoutId <= 0) {
            throw new IOException("Карточка товара ещё не сохранена");
        }

        File tempSource = File.createTempFile("yarn_gallery_", ".img", galleryTempDir(context));
        try {
            try (InputStream in = context.getContentResolver().openInputStream(sourceUri);
                 FileOutputStream out = new FileOutputStream(tempSource)) {
                if (in == null) throw new IOException("Не удалось открыть выбранную фотографию");
                copy(in, out);
            }
            return saveCompressedFile(context, tempSource, record);
        } finally {
            if (tempSource.exists()) tempSource.delete();
        }
    }

    private static String saveCompressedFile(Context context, File source, YarnRecord record) throws IOException {
        if (source == null || !source.isFile()) throw new IOException("Фотография не найдена");

        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(source.getAbsolutePath(), bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
            throw new IOException("Не удалось прочитать фотографию");
        }

        int sample = 1;
        int largest = Math.max(bounds.outWidth, bounds.outHeight);
        while (largest / sample > MAX_SIDE * 2) sample *= 2;

        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = Math.max(1, sample);
        options.inPreferredConfig = Bitmap.Config.ARGB_8888;
        Bitmap bitmap = BitmapFactory.decodeFile(source.getAbsolutePath(), options);
        if (bitmap == null) throw new IOException("Не удалось декодировать фотографию");

        bitmap = applyOrientation(source, bitmap);
        if (Math.max(bitmap.getWidth(), bitmap.getHeight()) > MAX_SIDE) {
            float scale = MAX_SIDE / (float) Math.max(bitmap.getWidth(), bitmap.getHeight());
            int w = Math.max(1, Math.round(bitmap.getWidth() * scale));
            int h = Math.max(1, Math.round(bitmap.getHeight() * scale));
            Bitmap scaled = Bitmap.createScaledBitmap(bitmap, w, h, true);
            if (scaled != bitmap) bitmap.recycle();
            bitmap = scaled;
        }

        String name = fileName(record.internalNumber);
        Uri target = null;
        try {
            deleteVisiblePhoto(context, record, record.archived);
            target = createVisibleUri(context, record, record.archived, name);
            try (OutputStream out = openOutput(context, target)) {
                if (out == null || !bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)) {
                    throw new IOException("Не удалось сжать фотографию");
                }
                out.flush();
            }
            finishPending(context, target);
        } catch (Exception e) {
            if (target != null) deleteUri(context, target);
            if (e instanceof IOException) throw (IOException) e;
            throw new IOException("Не удалось сохранить фотографию: " + e.getMessage(), e);
        } finally {
            bitmap.recycle();
        }

        deleteOldInternalCopies(context, record, name);
        return name;
    }

    public static Bitmap loadThumbnail(Context context, YarnRecord record, int targetPx) {
        Uri uri = ensureVisibleUri(context, record);
        if (uri == null) return null;

        try {
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            try (InputStream in = openInput(context, uri)) {
                if (in == null) return null;
                BitmapFactory.decodeStream(in, null, bounds);
            }
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;

            int sample = 1;
            int largest = Math.max(bounds.outWidth, bounds.outHeight);
            while (largest / sample > targetPx * 2) sample *= 2;

            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inSampleSize = Math.max(1, sample);
            options.inPreferredConfig = Bitmap.Config.RGB_565;
            try (InputStream in = openInput(context, uri)) {
                if (in == null) return null;
                return BitmapFactory.decodeStream(in, null, options);
            }
        } catch (Exception ignored) {
            return null;
        }
    }

    public static void deletePhoto(Context context, YarnRecord record) {
        if (record == null || record.photoFile == null || record.photoFile.trim().isEmpty()) return;
        deleteVisiblePhoto(context, record, record.archived);
        deleteOldInternalCopies(context, record, record.photoFile.trim());
    }

    public static boolean moveToArchive(Context context, YarnRecord record) {
        return move(context, record, true);
    }

    public static boolean moveToActive(Context context, YarnRecord record) {
        return move(context, record, false);
    }

    private static boolean move(Context context, YarnRecord record, boolean toArchive) {
        if (record == null || record.photoFile == null || record.photoFile.trim().isEmpty()) return true;

        // Сначала ищем фото строго в текущем месте. Широкий поиск оставляем только
        // как запасной вариант для карточек, переживших старые версии/миграцию.
        Uri from = findVisibleUriInLocation(context, record, record.archived);
        if (from == null) from = ensureVisibleUri(context, record);
        if (from == null) return true;

        String sourcePath = relativePath(record, record.archived);
        String targetPath = relativePath(record, toArchive);
        if (sourcePath.equals(targetPath)) return true;

        Uri to = null;
        try {
            // ВАЖНО: очищаем только целевую папку. Нельзя использовать широкий
            // findVisibleUri(), иначе можно удалить исходное фото до копирования.
            deleteVisiblePhotoInLocation(context, record, toArchive);
            to = createVisibleUri(context, record, toArchive, record.photoFile.trim());
            try (InputStream in = openInput(context, from);
                 OutputStream out = openOutput(context, to)) {
                if (in == null || out == null) throw new IOException("Не удалось открыть фотографию");
                copy(in, out);
            }
            finishPending(context, to);
            deleteUri(context, from);
            return true;
        } catch (Exception ignored) {
            if (to != null) deleteUri(context, to);
            return false;
        }
    }

    private static Uri ensureVisibleUri(Context context, YarnRecord record) {
        if (record == null || record.photoFile == null || record.photoFile.trim().isEmpty()) return null;

        Uri visible = findVisibleUri(context, record, record.archived);
        if (visible != null) return visible;

        File old = findOldInternalFile(context, record);
        if (old == null || !old.isFile()) return null;

        Uri target = null;
        try {
            target = createVisibleUri(context, record, record.archived, record.photoFile.trim());
            try (FileInputStream in = new FileInputStream(old);
                 OutputStream out = openOutput(context, target)) {
                if (out == null) throw new IOException("Не удалось открыть новую папку фотографий");
                copy(in, out);
            }
            finishPending(context, target);
            if (old.delete()) cleanupOldInternalFolders(context, record.layoutId);
            return target;
        } catch (Exception ignored) {
            if (target != null) deleteUri(context, target);
            return null;
        }
    }

    private static Uri findVisibleUriInLocation(Context context, YarnRecord record, boolean archived) {
        String name = record == null || record.photoFile == null ? "" : record.photoFile.trim();
        if (name.isEmpty()) return null;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            Uri collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
            String[] projection = {
                    MediaStore.Images.Media._ID,
                    MediaStore.Images.Media.RELATIVE_PATH
            };
            String selection = MediaStore.Images.Media.DISPLAY_NAME + "=?";
            String[] args = {name};
            String expected = normalizeRelativePath(relativePath(record, archived));

            try (Cursor c = context.getContentResolver().query(
                    collection, projection, selection, args,
                    MediaStore.Images.Media.DATE_ADDED + " DESC")) {
                if (c != null) {
                    int idCol = c.getColumnIndexOrThrow(MediaStore.Images.Media._ID);
                    int pathCol = c.getColumnIndex(MediaStore.Images.Media.RELATIVE_PATH);
                    while (c.moveToNext()) {
                        String rel = pathCol >= 0 && !c.isNull(pathCol) ? c.getString(pathCol) : "";
                        if (!expected.equals(normalizeRelativePath(rel))) continue;
                        return ContentUris.withAppendedId(collection, c.getLong(idCol));
                    }
                }
            } catch (Exception ignored) { }
            return null;
        }

        File file = publicFile(record, archived, name);
        return file.isFile() ? Uri.fromFile(file) : null;
    }

    private static String normalizeRelativePath(String relativePath) {
        if (relativePath == null) return "";
        String path = relativePath.replace('\\', '/').trim();
        while (path.startsWith("/")) path = path.substring(1);
        while (path.endsWith("/")) path = path.substring(0, path.length() - 1);
        return path;
    }

    private static Uri findVisibleUri(Context context, YarnRecord record, boolean archived) {
        String name = record.photoFile == null ? "" : record.photoFile.trim();
        if (name.isEmpty()) return null;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            Uri collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);

            // Некоторые прошивки Android нормализуют RELATIVE_PATH по-разному
            // (например, убирают завершающий "/"). Поэтому не требуем точного
            // совпадения пути: имя yarn_<номер>.jpg у нас уникально.
            String[] projection = {
                    MediaStore.Images.Media._ID,
                    MediaStore.Images.Media.RELATIVE_PATH,
                    MediaStore.Images.Media.OWNER_PACKAGE_NAME
            };
            String selection = MediaStore.Images.Media.DISPLAY_NAME + "=?";
            String[] args = {name};

            Uri ownedFallback = null;
            try (Cursor c = context.getContentResolver().query(
                    collection, projection, selection, args,
                    MediaStore.Images.Media.DATE_ADDED + " DESC")) {
                if (c != null) {
                    int idCol = c.getColumnIndexOrThrow(MediaStore.Images.Media._ID);
                    int pathCol = c.getColumnIndex(MediaStore.Images.Media.RELATIVE_PATH);
                    int ownerCol = c.getColumnIndex(MediaStore.Images.Media.OWNER_PACKAGE_NAME);

                    while (c.moveToNext()) {
                        long id = c.getLong(idCol);
                        String rel = pathCol >= 0 && !c.isNull(pathCol) ? c.getString(pathCol) : "";
                        String owner = ownerCol >= 0 && !c.isNull(ownerCol) ? c.getString(ownerCol) : "";
                        Uri candidate = ContentUris.withAppendedId(collection, id);

                        if (isOurPublicPath(rel)) return candidate;
                        if (context.getPackageName().equals(owner) && ownedFallback == null) {
                            ownedFallback = candidate;
                        }
                    }
                }
            } catch (Exception ignored) { }

            return ownedFallback;
        }

        File file = publicFile(record, archived, name);
        if (file.isFile()) return Uri.fromFile(file);

        // На старых Android также допускаем поиск по всем подпапкам "Моя пряжа".
        File fallback = findByName(publicRoot(), name);
        return fallback != null ? Uri.fromFile(fallback) : null;
    }

    private static boolean isOurPublicPath(String relativePath) {
        if (relativePath == null) return false;
        String path = relativePath.replace('\\', '/').trim();
        while (path.startsWith("/")) path = path.substring(1);
        while (path.endsWith("/")) path = path.substring(0, path.length() - 1);

        String root = (Environment.DIRECTORY_PICTURES + "/" + PUBLIC_ROOT).replace('\\', '/');
        return path.equals(root) || path.startsWith(root + "/");
    }

    private static File findByName(File dir, String name) {
        if (dir == null || !dir.isDirectory() || name == null || name.isEmpty()) return null;
        File[] children = dir.listFiles();
        if (children == null) return null;

        for (File child : children) {
            if (child == null) continue;
            if (child.isFile() && name.equals(child.getName())) return child;
            if (child.isDirectory()) {
                File found = findByName(child, name);
                if (found != null) return found;
            }
        }
        return null;
    }

    private static Uri createVisibleUri(Context context, YarnRecord record, boolean archived, String name)
            throws IOException {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, name);
            values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
            values.put(MediaStore.Images.Media.RELATIVE_PATH, relativePath(record, archived));
            values.put(MediaStore.Images.Media.IS_PENDING, 1);

            Uri collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
            Uri uri = context.getContentResolver().insert(collection, values);
            if (uri == null) throw new IOException("Не удалось создать файл фотографии");
            return uri;
        }

        File file = publicFile(record, archived, name);
        File parent = file.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            throw new IOException("Не удалось создать папку фотографий");
        }
        return Uri.fromFile(file);
    }

    private static void finishPending(Context context, Uri uri) {
        if (uri == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && "content".equals(uri.getScheme())) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.IS_PENDING, 0);
            try {
                context.getContentResolver().update(uri, values, null, null);
            } catch (Exception ignored) { }
        } else if ("file".equals(uri.getScheme()) && uri.getPath() != null) {
            MediaScannerConnection.scanFile(context, new String[]{uri.getPath()},
                    new String[]{"image/jpeg"}, null);
        }
    }

    private static void deleteVisiblePhoto(Context context, YarnRecord record, boolean archived) {
        Uri uri = findVisibleUri(context, record, archived);
        if (uri != null) deleteUri(context, uri);
    }

    private static void deleteVisiblePhotoInLocation(Context context, YarnRecord record, boolean archived) {
        Uri uri = findVisibleUriInLocation(context, record, archived);
        if (uri != null) deleteUri(context, uri);
    }

    private static void deleteUri(Context context, Uri uri) {
        if (uri == null) return;
        try {
            if ("file".equals(uri.getScheme())) {
                String path = uri.getPath();
                if (path != null) new File(path).delete();
            } else {
                context.getContentResolver().delete(uri, null, null);
            }
        } catch (Exception ignored) { }
    }

    private static InputStream openInput(Context context, Uri uri) throws IOException {
        if (uri == null) return null;
        if ("file".equals(uri.getScheme())) {
            if (uri.getPath() == null) return null;
            return new FileInputStream(new File(uri.getPath()));
        }
        return context.getContentResolver().openInputStream(uri);
    }

    private static OutputStream openOutput(Context context, Uri uri) throws IOException {
        if (uri == null) return null;
        if ("file".equals(uri.getScheme())) {
            if (uri.getPath() == null) return null;
            return new FileOutputStream(new File(uri.getPath()));
        }
        return context.getContentResolver().openOutputStream(uri, "w");
    }

    private static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buffer = new byte[32 * 1024];
        int read;
        while ((read = in.read(buffer)) >= 0) out.write(buffer, 0, read);
        out.flush();
    }

    private static String relativePath(YarnRecord record, boolean archived) {
        String folder = archived ? PUBLIC_ARCHIVE : layoutFolder(record);
        return Environment.DIRECTORY_PICTURES + "/" + PUBLIC_ROOT + "/" + folder + "/";
    }

    private static String layoutFolder(YarnRecord record) {
        String date = formatLayoutDate(record == null ? "" : record.layoutDate);
        if (date.isEmpty()) {
            long id = record == null ? 0 : record.layoutId;
            return "Выкладка " + id;
        }
        return "Выкладка " + date;
    }

    private static String formatLayoutDate(String iso) {
        if (iso == null || iso.trim().isEmpty()) return "";
        try {
            Date d = new SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(iso.trim());
            if (d == null) return "";
            return new SimpleDateFormat("dd.MM.yyyy", new Locale("ru", "RU")).format(d);
        } catch (ParseException ignored) {
            return iso.trim().replace('/', '.');
        }
    }

    @SuppressWarnings("deprecation")
    private static File publicRoot() {
        return new File(Environment.getExternalStoragePublicDirectory(
                Environment.DIRECTORY_PICTURES), PUBLIC_ROOT);
    }

    private static File publicFile(YarnRecord record, boolean archived, String name) {
        File folder = new File(publicRoot(), archived ? PUBLIC_ARCHIVE : layoutFolder(record));
        return new File(folder, name);
    }

    private static File internalLayoutDir(Context context, long layoutId) {
        return new File(context.getFilesDir(),
                INTERNAL_LAYOUTS_ROOT + File.separator + "layout_" + layoutId);
    }

    private static File findOldInternalFile(Context context, YarnRecord record) {
        String name = record.photoFile == null ? "" : record.photoFile.trim();
        if (name.isEmpty()) return null;

        File layout = internalLayoutDir(context, record.layoutId);
        File current = new File(
                new File(new File(layout, INTERNAL_PHOTOS),
                        record.archived ? INTERNAL_ARCHIVE : INTERNAL_ACTIVE),
                name);
        if (current.isFile()) return current;

        File legacy = new File(
                new File(new File(context.getFilesDir(), LEGACY_ROOT),
                        record.archived ? INTERNAL_ARCHIVE : INTERNAL_ACTIVE),
                name);
        return legacy.isFile() ? legacy : null;
    }

    private static void deleteOldInternalCopies(Context context, YarnRecord record, String name) {
        if (record == null || name == null || name.trim().isEmpty()) return;

        File layout = internalLayoutDir(context, record.layoutId);
        File photos = new File(layout, INTERNAL_PHOTOS);
        new File(new File(photos, INTERNAL_ACTIVE), name).delete();
        new File(new File(photos, INTERNAL_ARCHIVE), name).delete();

        File legacyRoot = new File(context.getFilesDir(), LEGACY_ROOT);
        new File(new File(legacyRoot, INTERNAL_ACTIVE), name).delete();
        new File(new File(legacyRoot, INTERNAL_ARCHIVE), name).delete();

        cleanupOldInternalFolders(context, record.layoutId);
        deleteIfEmpty(new File(legacyRoot, INTERNAL_ACTIVE));
        deleteIfEmpty(new File(legacyRoot, INTERNAL_ARCHIVE));
        deleteIfEmpty(legacyRoot);
    }

    private static void cleanupOldInternalFolders(Context context, long layoutId) {
        File layout = internalLayoutDir(context, layoutId);
        File photos = new File(layout, INTERNAL_PHOTOS);
        deleteIfEmpty(new File(photos, INTERNAL_ACTIVE));
        deleteIfEmpty(new File(photos, INTERNAL_ARCHIVE));
        deleteIfEmpty(photos);
        deleteIfEmpty(layout);
    }

    private static File galleryTempDir(Context context) {
        File dir = new File(context.getCacheDir(), "gallery");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    private static Bitmap applyOrientation(File source, Bitmap bitmap) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return bitmap;
        try {
            android.media.ExifInterface exif = new android.media.ExifInterface(source.getAbsolutePath());
            int orientation = exif.getAttributeInt(
                    android.media.ExifInterface.TAG_ORIENTATION,
                    android.media.ExifInterface.ORIENTATION_NORMAL);
            float degrees = 0f;
            if (orientation == android.media.ExifInterface.ORIENTATION_ROTATE_90) degrees = 90f;
            else if (orientation == android.media.ExifInterface.ORIENTATION_ROTATE_180) degrees = 180f;
            else if (orientation == android.media.ExifInterface.ORIENTATION_ROTATE_270) degrees = 270f;
            if (degrees == 0f) return bitmap;

            Matrix matrix = new Matrix();
            matrix.postRotate(degrees);
            Bitmap rotated = Bitmap.createBitmap(
                    bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
            if (rotated != bitmap) bitmap.recycle();
            return rotated;
        } catch (Exception ignored) {
            return bitmap;
        }
    }

    public static final class StorageStats {
        public int activeFiles;
        public long activeBytes;
        public int archiveFiles;
        public long archiveBytes;

        public int totalFiles() { return activeFiles + archiveFiles; }
        public long totalBytes() { return activeBytes + archiveBytes; }
    }

    public static StorageStats getStorageStats(Context context) {
        StorageStats stats = new StorageStats();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            Uri collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
            String[] projection = {
                    MediaStore.Images.Media.RELATIVE_PATH,
                    MediaStore.Images.Media.SIZE
            };
            String selection = MediaStore.Images.Media.DISPLAY_NAME + " LIKE ?";
            String[] args = {"yarn_%.jpg"};

            try (Cursor c = context.getContentResolver().query(
                    collection, projection, selection, args, null)) {
                if (c != null) {
                    while (c.moveToNext()) {
                        String rel = c.getString(0);
                        if (!isOurPublicPath(rel)) continue;

                        long size = c.isNull(1) ? 0L : c.getLong(1);
                        String normalized = rel == null ? "" : rel.replace('\\', '/');
                        boolean archive = normalized.contains("/" + PUBLIC_ROOT + "/" + PUBLIC_ARCHIVE) ||
                                normalized.endsWith(PUBLIC_ROOT + "/" + PUBLIC_ARCHIVE);
                        if (archive) {
                            stats.archiveFiles++;
                            stats.archiveBytes += size;
                        } else {
                            stats.activeFiles++;
                            stats.activeBytes += size;
                        }
                    }
                }
            } catch (Exception ignored) { }
            return stats;
        }

        addLegacyStats(publicRoot(), stats);
        return stats;
    }

    private static void addLegacyStats(File root, StorageStats stats) {
        if (root == null || !root.isDirectory()) return;
        File[] folders = root.listFiles();
        if (folders == null) return;

        for (File folder : folders) {
            if (folder == null || !folder.isDirectory()) continue;
            boolean archive = PUBLIC_ARCHIVE.equals(folder.getName());
            File[] files = folder.listFiles();
            if (files == null) continue;
            for (File file : files) {
                if (file == null || !file.isFile() ||
                        !file.getName().startsWith("yarn_") ||
                        !file.getName().endsWith(".jpg")) continue;
                if (archive) {
                    stats.archiveFiles++;
                    stats.archiveBytes += file.length();
                } else {
                    stats.activeFiles++;
                    stats.activeBytes += file.length();
                }
            }
        }
    }

    public static void clearArchiveStorage(Context context) {
        clearVisibleStorage(context, true);
    }

    public static void clearAllStorage(Context context) {
        clearVisibleStorage(context, false);
    }

    private static void clearVisibleStorage(Context context, boolean archiveOnly) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            Uri collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
            String selection = MediaStore.Images.Media.DISPLAY_NAME + " LIKE ?";
            String[] args = {"yarn_%.jpg"};

            String[] projection = {
                    MediaStore.Images.Media._ID,
                    MediaStore.Images.Media.RELATIVE_PATH
            };
            try (Cursor c = context.getContentResolver().query(
                    collection, projection, selection, args, null)) {
                if (c != null) {
                    while (c.moveToNext()) {
                        String rel = c.isNull(1) ? "" : c.getString(1);
                        if (!isOurPublicPath(rel)) continue;

                        String normalized = rel.replace('\\', '/');
                        boolean archive = normalized.contains("/" + PUBLIC_ROOT + "/" + PUBLIC_ARCHIVE) ||
                                normalized.endsWith(PUBLIC_ROOT + "/" + PUBLIC_ARCHIVE);
                        if (archiveOnly && !archive) continue;

                        Uri uri = ContentUris.withAppendedId(collection, c.getLong(0));
                        deleteUri(context, uri);
                    }
                }
            } catch (Exception ignored) { }
            return;
        }

        File root = publicRoot();
        if (archiveOnly) {
            deleteYarnFiles(new File(root, PUBLIC_ARCHIVE));
            deleteIfEmpty(new File(root, PUBLIC_ARCHIVE));
        } else {
            File[] folders = root.listFiles();
            if (folders != null) {
                for (File folder : folders) {
                    deleteYarnFiles(folder);
                    deleteIfEmpty(folder);
                }
            }
            deleteIfEmpty(root);
        }
    }

    private static void deleteYarnFiles(File dir) {
        if (dir == null || !dir.isDirectory()) return;
        File[] files = dir.listFiles();
        if (files == null) return;
        for (File file : files) {
            if (file != null && file.isFile() &&
                    file.getName().startsWith("yarn_") &&
                    file.getName().endsWith(".jpg")) {
                file.delete();
            }
        }
    }

    private static void deleteIfEmpty(File dir) {
        if (dir == null || !dir.isDirectory()) return;
        File[] children = dir.listFiles();
        if (children != null && children.length == 0) dir.delete();
    }
}
