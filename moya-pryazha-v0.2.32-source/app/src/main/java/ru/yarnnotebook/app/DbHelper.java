package ru.yarnnotebook.app;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;

public class DbHelper extends SQLiteOpenHelper {
    private static final String DB_NAME = "yarn_notebook.db";
    private static final int DB_VERSION = 5;
    private final Context appContext;

    public DbHelper(Context context) {
        super(context, DB_NAME, null, DB_VERSION);
        appContext = context.getApplicationContext();
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE layouts (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT," +
                "date_iso TEXT NOT NULL UNIQUE," +
                "description TEXT NOT NULL DEFAULT ''," +
                "hidden INTEGER NOT NULL DEFAULT 0," +
                "created_at INTEGER NOT NULL)");

        db.execSQL("CREATE TABLE yarns (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT," +
                "layout_id INTEGER NOT NULL," +
                "is_saved INTEGER NOT NULL DEFAULT 1," +
                "internal_number INTEGER NOT NULL DEFAULT 0," +
                "archived INTEGER NOT NULL DEFAULT 0," +
                "archived_at INTEGER NOT NULL DEFAULT 0," +
                "photo_file TEXT NOT NULL DEFAULT ''," +
                "country TEXT NOT NULL DEFAULT ''," +
                "manufacturer TEXT NOT NULL DEFAULT ''," +
                "name TEXT NOT NULL DEFAULT ''," +
                "color TEXT NOT NULL DEFAULT ''," +
                "shade TEXT NOT NULL DEFAULT ''," +
                "composition TEXT NOT NULL DEFAULT ''," +
                "length_per_100 TEXT NOT NULL DEFAULT ''," +
                "thread_params TEXT NOT NULL DEFAULT ''," +
                "availability TEXT NOT NULL DEFAULT ''," +
                "price_per_100 TEXT NOT NULL DEFAULT ''," +
                "storage_location TEXT NOT NULL DEFAULT ''," +
                "description TEXT NOT NULL DEFAULT ''," +
                "created_at INTEGER NOT NULL," +
                "updated_at INTEGER NOT NULL," +
                "FOREIGN KEY(layout_id) REFERENCES layouts(id) ON DELETE CASCADE)");
        db.execSQL("CREATE INDEX idx_yarns_layout ON yarns(layout_id)");
        db.execSQL("CREATE INDEX idx_yarns_name ON yarns(name)");
        db.execSQL("CREATE UNIQUE INDEX idx_yarns_internal_number ON yarns(internal_number) WHERE internal_number>0");
        db.execSQL("CREATE INDEX idx_yarns_archived ON yarns(archived,archived_at)");
        db.execSQL("CREATE TABLE app_meta (meta_key TEXT PRIMARY KEY, meta_value INTEGER NOT NULL)");
        db.execSQL("INSERT INTO app_meta(meta_key,meta_value) VALUES('next_internal_number',1)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        if (oldVersion < 2) {
            db.execSQL("ALTER TABLE yarns ADD COLUMN country TEXT NOT NULL DEFAULT ''");
            db.execSQL("UPDATE yarns SET country='Италия' WHERE country=''");
            db.execSQL("ALTER TABLE yarns ADD COLUMN storage_location TEXT NOT NULL DEFAULT ''");
        }
        if (oldVersion < 3) {
            db.execSQL("ALTER TABLE layouts ADD COLUMN description TEXT NOT NULL DEFAULT ''");
        }
        if (oldVersion < 4) {
            db.execSQL("ALTER TABLE yarns ADD COLUMN internal_number INTEGER NOT NULL DEFAULT 0");
            db.execSQL("ALTER TABLE yarns ADD COLUMN archived INTEGER NOT NULL DEFAULT 0");
            db.execSQL("ALTER TABLE yarns ADD COLUMN archived_at INTEGER NOT NULL DEFAULT 0");
            db.execSQL("ALTER TABLE yarns ADD COLUMN photo_file TEXT NOT NULL DEFAULT ''");

            Cursor c = db.rawQuery("SELECT id FROM yarns ORDER BY id ASC", null);
            long number = 1;
            while (c.moveToNext()) {
                ContentValues values = new ContentValues();
                values.put("internal_number", number++);
                db.update("yarns", values, "id=?", new String[]{String.valueOf(c.getLong(0))});
            }
            c.close();

            db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS idx_yarns_internal_number ON yarns(internal_number) WHERE internal_number>0");
            db.execSQL("CREATE INDEX IF NOT EXISTS idx_yarns_archived ON yarns(archived,archived_at)");
            db.execSQL("CREATE TABLE IF NOT EXISTS app_meta (meta_key TEXT PRIMARY KEY, meta_value INTEGER NOT NULL)");
            ContentValues meta = new ContentValues();
            meta.put("meta_key", "next_internal_number");
            meta.put("meta_value", number);
            db.insertWithOnConflict("app_meta", null, meta, SQLiteDatabase.CONFLICT_REPLACE);
        }
        if (oldVersion < 5) {
            db.execSQL("ALTER TABLE layouts ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0");
        }
    }

    public long createOrGetLayout(String dateIso) {
        return createOrGetLayout(dateIso, "");
    }

    public long createOrGetLayout(String dateIso, String description) {
        SQLiteDatabase db = getWritableDatabase();
        Cursor c = db.rawQuery("SELECT id,hidden FROM layouts WHERE date_iso=?", new String[]{dateIso});
        if (c.moveToFirst()) {
            long id = c.getLong(0);
            boolean hidden = c.getInt(1) != 0;
            c.close();
            if (hidden) {
                ContentValues restore = new ContentValues();
                restore.put("hidden", 0);
                if (!n(description).isEmpty()) restore.put("description", n(description));
                db.update("layouts", restore, "id=?", new String[]{String.valueOf(id)});
            }
            return id;
        }
        c.close();
        ContentValues v = new ContentValues();
        v.put("date_iso", dateIso);
        v.put("description", n(description));
        v.put("created_at", System.currentTimeMillis());
        return db.insertOrThrow("layouts", null, v);
    }

    public boolean layoutExists(String dateIso) {
        Cursor c = getReadableDatabase().rawQuery("SELECT 1 FROM layouts WHERE date_iso=? AND hidden=0 LIMIT 1", new String[]{dateIso});
        boolean exists = c.moveToFirst();
        c.close();
        return exists;
    }

    public String getLayoutDate(long layoutId) {
        Cursor c = getReadableDatabase().rawQuery("SELECT date_iso FROM layouts WHERE id=?", new String[]{String.valueOf(layoutId)});
        String result = "";
        if (c.moveToFirst()) result = c.getString(0);
        c.close();
        return result;
    }

    public String getLayoutDescription(long layoutId) {
        Cursor c = getReadableDatabase().rawQuery("SELECT description FROM layouts WHERE id=?", new String[]{String.valueOf(layoutId)});
        String result = "";
        if (c.moveToFirst()) result = c.getString(0);
        c.close();
        return result == null ? "" : result;
    }

    public void updateLayoutDescription(long layoutId, String description) {
        ContentValues v = new ContentValues();
        v.put("description", n(description));
        getWritableDatabase().update("layouts", v, "id=?", new String[]{String.valueOf(layoutId)});
    }

    public List<LayoutRecord> getLayouts() {
        List<LayoutRecord> out = new ArrayList<>();
        Cursor c = getReadableDatabase().rawQuery(
                "SELECT l.id,l.date_iso,l.description,l.hidden,COUNT(y.id),COALESCE(SUM(CASE WHEN y.is_saved=0 THEN 1 ELSE 0 END),0) " +
                        "FROM layouts l LEFT JOIN yarns y ON y.layout_id=l.id AND y.archived=0 " +
                        "WHERE l.hidden=0 " +
                        "GROUP BY l.id,l.date_iso,l.description,l.hidden ORDER BY l.date_iso DESC", null);
        while (c.moveToNext()) {
            LayoutRecord r = new LayoutRecord();
            r.id = c.getLong(0);
            r.dateIso = c.getString(1);
            r.description = c.getString(2) == null ? "" : c.getString(2);
            r.hidden = c.getInt(3) != 0;
            r.itemCount = c.getInt(4);
            r.draftCount = c.getInt(5);
            out.add(r);
        }
        c.close();
        return out;
    }

    private List<LayoutRecord> getLayoutsForBackup() {
        List<LayoutRecord> out = new ArrayList<>();
        Cursor c = getReadableDatabase().rawQuery(
                "SELECT id,date_iso,description,hidden FROM layouts ORDER BY date_iso DESC", null);
        while (c.moveToNext()) {
            LayoutRecord r = new LayoutRecord();
            r.id = c.getLong(0);
            r.dateIso = c.getString(1);
            r.description = c.getString(2) == null ? "" : c.getString(2);
            r.hidden = c.getInt(3) != 0;
            out.add(r);
        }
        c.close();
        return out;
    }

    private boolean isLayoutHidden(long layoutId) {
        Cursor c = getReadableDatabase().rawQuery(
                "SELECT hidden FROM layouts WHERE id=? LIMIT 1",
                new String[]{String.valueOf(layoutId)});
        boolean hidden = c.moveToFirst() && c.getInt(0) != 0;
        c.close();
        return hidden;
    }

    private void setLayoutHidden(long layoutId, boolean hidden) {
        ContentValues values = new ContentValues();
        values.put("hidden", hidden ? 1 : 0);
        getWritableDatabase().update("layouts", values, "id=?",
                new String[]{String.valueOf(layoutId)});
    }

    private String yarnSelect() {
        return "SELECT y.id,y.layout_id,y.is_saved,y.internal_number,y.archived,y.archived_at,y.photo_file," +
                "y.country,y.manufacturer,y.name,y.color,y.shade,y.composition," +
                "y.length_per_100,y.thread_params,y.availability,y.price_per_100,y.storage_location,y.description,l.date_iso ";
    }

    public List<YarnRecord> getYarnsForLayout(long layoutId, String query) {
        List<YarnRecord> out = new ArrayList<>();
        String q = query == null ? "" : query.trim();
        String where = "WHERE y.layout_id=? AND y.archived=0";
        List<String> args = new ArrayList<>();
        args.add(String.valueOf(layoutId));
        if (!q.isEmpty()) {
            where += " AND (y.country LIKE ? OR y.manufacturer LIKE ? OR y.name LIKE ? OR y.color LIKE ? OR y.shade LIKE ? OR y.composition LIKE ? OR y.length_per_100 LIKE ? OR y.thread_params LIKE ? OR y.availability LIKE ? OR y.price_per_100 LIKE ? OR y.storage_location LIKE ? OR y.description LIKE ?)";
            String like = "%" + q + "%";
            for (int i = 0; i < 12; i++) args.add(like);
        }
        Cursor c = getReadableDatabase().rawQuery(
                yarnSelect() + "FROM yarns y JOIN layouts l ON l.id=y.layout_id " + where + " ORDER BY y.id DESC",
                args.toArray(new String[0]));
        while (c.moveToNext()) out.add(readYarn(c));
        c.close();
        return out;
    }

    public List<YarnRecord> searchAll(String query) {
        List<YarnRecord> out = new ArrayList<>();
        String q = query == null ? "" : query.trim();
        if (q.isEmpty()) return out;
        String like = "%" + q + "%";
        String[] args = new String[12];
        for (int i = 0; i < args.length; i++) args[i] = like;
        Cursor c = getReadableDatabase().rawQuery(
                yarnSelect() + "FROM yarns y JOIN layouts l ON l.id=y.layout_id WHERE y.archived=0 AND (" +
                        "y.country LIKE ? OR y.manufacturer LIKE ? OR y.name LIKE ? OR y.color LIKE ? OR y.shade LIKE ? OR y.composition LIKE ? OR y.length_per_100 LIKE ? OR y.thread_params LIKE ? OR y.availability LIKE ? OR y.price_per_100 LIKE ? OR y.storage_location LIKE ? OR y.description LIKE ?) " +
                        "ORDER BY l.date_iso DESC,y.id DESC",
                args);
        while (c.moveToNext()) out.add(readYarn(c));
        c.close();
        return out;
    }

    public List<YarnRecord> searchAdvanced(String manufacturer, String name, String color, String shade, String material) {
        List<YarnRecord> out = new ArrayList<>();
        Cursor c = getReadableDatabase().rawQuery(
                yarnSelect() + "FROM yarns y JOIN layouts l ON l.id=y.layout_id WHERE y.archived=0 ORDER BY l.date_iso DESC,y.id DESC", null);
        while (c.moveToNext()) {
            YarnRecord r = readYarn(c);
            if (!containsIgnoreCase(r.manufacturer, manufacturer)) continue;
            if (!containsIgnoreCase(r.name, name)) continue;
            if (!containsIgnoreCase(r.color, color)) continue;
            if (!containsIgnoreCase(r.shade, shade)) continue;
            if (!compositionMaterialsMatch(r.composition, material)) continue;
            out.add(r);
        }
        c.close();
        return out;
    }

    private boolean containsIgnoreCase(String value, String query) {
        String q = query == null ? "" : query.trim().toLowerCase(Locale.ROOT);
        if (q.isEmpty()) return true;
        String v = value == null ? "" : value.toLowerCase(Locale.ROOT);
        return v.contains(q);
    }

    private boolean compositionMaterialsMatch(String composition, String query) {
        String q = query == null ? "" : query.trim().toLowerCase(Locale.ROOT);
        if (q.isEmpty()) return true;
        StringBuilder materials = new StringBuilder();
        String raw = composition == null ? "" : composition;
        for (String part : raw.split(",")) {
            String material = part.trim().replaceFirst("^[0-9]+(?:[.,][0-9]+)?\\s*%\\s*", "");
            if (!material.isEmpty()) {
                if (materials.length() > 0) materials.append(' ');
                materials.append(material.toLowerCase(Locale.ROOT));
            }
        }
        String haystack = materials.toString();
        for (String token : q.split("\\s+")) {
            if (!token.isEmpty() && !haystack.contains(token)) return false;
        }
        return true;
    }

    public List<String> getSuggestions(String field, String query, int limit) {
        String q = query == null ? "" : query.trim();
        List<String> values = new ArrayList<>();
        if (q.isEmpty() || limit <= 0) return values;

        LinkedHashMap<String, String> unique = new LinkedHashMap<>();
        if ("material".equals(field)) {
            Cursor c = getReadableDatabase().rawQuery("SELECT composition FROM yarns WHERE archived=0 AND TRIM(composition)<>''", null);
            while (c.moveToNext()) {
                for (String material : extractMaterials(c.getString(0))) {
                    String key = material.toLowerCase(Locale.ROOT);
                    if (!unique.containsKey(key)) unique.put(key, material);
                }
            }
            c.close();
        } else {
            String column = suggestionColumn(field);
            if (column == null) return values;
            Cursor c = getReadableDatabase().rawQuery(
                    "SELECT DISTINCT TRIM(" + column + ") FROM yarns WHERE archived=0 AND TRIM(" + column + ")<>''", null);
            while (c.moveToNext()) {
                String v = c.getString(0);
                if (v == null || v.trim().isEmpty()) continue;
                String clean = v.trim();
                String key = clean.toLowerCase(Locale.ROOT);
                if (!unique.containsKey(key)) unique.put(key, clean);
            }
            c.close();
        }

        String lowerQ = q.toLowerCase(Locale.ROOT);
        for (String v : unique.values()) {
            if (!v.equalsIgnoreCase(q)) values.add(v);
        }
        Collections.sort(values, (a, b) -> {
            int sa = suggestionScore(a, lowerQ);
            int sb = suggestionScore(b, lowerQ);
            if (sa != sb) return Integer.compare(sa, sb);
            if (a.length() != b.length()) return Integer.compare(a.length(), b.length());
            return a.compareToIgnoreCase(b);
        });
        if (values.size() > limit) return new ArrayList<>(values.subList(0, limit));
        return values;
    }

    private String suggestionColumn(String field) {
        if ("country".equals(field)) return "country";
        if ("manufacturer".equals(field)) return "manufacturer";
        if ("name".equals(field)) return "name";
        if ("shade".equals(field)) return "shade";
        if ("color".equals(field)) return "color";
        if ("storage".equals(field)) return "storage_location";
        return null;
    }

    private int suggestionScore(String value, String lowerQ) {
        String v = value.toLowerCase(Locale.ROOT);
        if (v.startsWith(lowerQ)) return v.length() - lowerQ.length();
        int idx = v.indexOf(lowerQ);
        if (idx >= 0) return 100 + idx * 5 + Math.max(0, v.length() - lowerQ.length());
        String prefix = v.substring(0, Math.min(v.length(), Math.max(lowerQ.length(), 1)));
        return 1000 + levenshtein(prefix, lowerQ) * 20 + Math.abs(v.length() - lowerQ.length());
    }

    private int levenshtein(String a, String b) {
        int[] prev = new int[b.length() + 1];
        int[] cur = new int[b.length() + 1];
        for (int j = 0; j <= b.length(); j++) prev[j] = j;
        for (int i = 1; i <= a.length(); i++) {
            cur[0] = i;
            for (int j = 1; j <= b.length(); j++) {
                int cost = a.charAt(i - 1) == b.charAt(j - 1) ? 0 : 1;
                cur[j] = Math.min(Math.min(cur[j - 1] + 1, prev[j] + 1), prev[j - 1] + cost);
            }
            int[] tmp = prev; prev = cur; cur = tmp;
        }
        return prev[b.length()];
    }

    private List<String> extractMaterials(String composition) {
        List<String> out = new ArrayList<>();
        String raw = composition == null ? "" : composition;
        for (String part : raw.split(",")) {
            String material = part.trim().replaceFirst("^[0-9]+(?:[.,][0-9]+)?\\s*%\\s*", "").trim();
            if (!material.isEmpty()) out.add(material);
        }
        return out;
    }

    public String exportDatabaseJson() throws JSONException {
        JSONObject root = backupRoot("database");
        JSONArray layouts = new JSONArray();
        for (LayoutRecord layout : getLayoutsForBackup()) layouts.put(layoutToJson(layout.id));
        root.put("layouts", layouts);
        return root.toString(2);
    }

    public String exportLayoutJson(long layoutId) throws JSONException {
        String date = getLayoutDate(layoutId);
        if (date == null || date.trim().isEmpty()) throw new JSONException("Выкладка не найдена");
        JSONObject root = backupRoot("layout");
        JSONArray layouts = new JSONArray();
        layouts.put(layoutToJson(layoutId));
        root.put("layouts", layouts);
        return root.toString(2);
    }

    private JSONObject backupRoot(String type) throws JSONException {
        JSONObject root = new JSONObject();
        root.put("format", "yarn-notebook");
        root.put("version", 2);
        root.put("type", type);
        root.put("exported_at", System.currentTimeMillis());
        return root;
    }

    private JSONObject layoutToJson(long layoutId) throws JSONException {
        JSONObject layout = new JSONObject();
        layout.put("date", getLayoutDate(layoutId));
        layout.put("description", getLayoutDescription(layoutId));
        layout.put("hidden", isLayoutHidden(layoutId));
        JSONArray yarns = new JSONArray();
        List<YarnRecord> items = getYarnsForLayoutForBackup(layoutId);
        for (int i = items.size() - 1; i >= 0; i--) yarns.put(yarnToJson(items.get(i)));
        layout.put("yarns", yarns);
        return layout;
    }

    private JSONObject yarnToJson(YarnRecord r) throws JSONException {
        JSONObject o = new JSONObject();
        o.put("saved", r.saved);
        o.put("internal_number", r.internalNumber);
        o.put("archived", r.archived);
        o.put("archived_at", r.archivedAt);
        o.put("country", n(r.country));
        o.put("manufacturer", n(r.manufacturer));
        o.put("name", n(r.name));
        o.put("shade", n(r.shade));
        o.put("color", n(r.color));
        o.put("composition", n(r.composition));
        o.put("length_per_100", n(r.lengthPer100));
        o.put("thread_params", n(r.threadParams));
        o.put("availability", n(r.availability));
        o.put("price_per_100", n(r.pricePer100));
        o.put("storage_location", n(r.storageLocation));
        o.put("description", n(r.description));
        return o;
    }

    public static class ImportResult {
        public int layouts;
        public int yarns;
    }

    public ImportResult importJson(String json, String expectedType) throws JSONException {
        JSONObject root = new JSONObject(json);
        if (!"yarn-notebook".equals(root.optString("format"))) throw new JSONException("Неверный формат файла");
        String type = root.optString("type");
        if (!expectedType.equals(type)) {
            String fileLabel = "database".equals(type) ? "база" : ("layout".equals(type) ? "выкладка" : type);
            String expectedLabel = "database".equals(expectedType) ? "база" : "выкладка";
            throw new JSONException("Это файл типа «" + fileLabel + "», а выбран пункт «Добавить " + expectedLabel + "»");
        }
        JSONArray layouts = root.optJSONArray("layouts");
        if (layouts == null) throw new JSONException("В файле нет выкладок");

        ImportResult result = new ImportResult();
        SQLiteDatabase sql = getWritableDatabase();
        sql.beginTransaction();
        try {
            for (int i = 0; i < layouts.length(); i++) {
                JSONObject l = layouts.optJSONObject(i);
                if (l == null) continue;
                String date = l.optString("date").trim();
                if (date.isEmpty()) continue;
                String description = l.optString("description", "").trim();
                boolean hiddenLayout = l.optBoolean("hidden", false);
                long layoutId = createOrGetLayout(date, description);
                if (!description.isEmpty() && getLayoutDescription(layoutId).trim().isEmpty()) {
                    updateLayoutDescription(layoutId, description);
                }
                result.layouts++;
                JSONArray yarns = l.optJSONArray("yarns");
                if (yarns == null) continue;
                for (int j = 0; j < yarns.length(); j++) {
                    JSONObject y = yarns.optJSONObject(j);
                    if (y == null) continue;
                    YarnRecord r = new YarnRecord();
                    r.layoutId = layoutId;
                    r.saved = y.optBoolean("saved", true);
                    r.internalNumber = y.optLong("internal_number", 0);
                    if (r.internalNumber > 0 && internalNumberExists(r.internalNumber)) r.internalNumber = 0;
                    r.archived = y.optBoolean("archived", false);
                    r.archivedAt = y.optLong("archived_at", 0);
                    r.country = y.optString("country", "");
                    r.manufacturer = y.optString("manufacturer", "");
                    r.name = y.optString("name", "");
                    r.shade = y.optString("shade", "");
                    r.color = y.optString("color", "");
                    r.composition = y.optString("composition", "");
                    r.lengthPer100 = y.optString("length_per_100", "");
                    r.threadParams = y.optString("thread_params", "");
                    r.availability = y.optString("availability", "");
                    r.pricePer100 = y.optString("price_per_100", "");
                    r.storageLocation = y.optString("storage_location", "");
                    r.description = y.optString("description", "");
                    saveYarn(r, r.saved);
                    result.yarns++;
                }
                if (hiddenLayout) setLayoutHidden(layoutId, true);
            }
            sql.setTransactionSuccessful();
        } finally {
            sql.endTransaction();
        }
        return result;
    }

    public YarnRecord getYarn(long id) {
        Cursor c = getReadableDatabase().rawQuery(
                yarnSelect() + "FROM yarns y JOIN layouts l ON l.id=y.layout_id WHERE y.id=?", new String[]{String.valueOf(id)});
        YarnRecord r = null;
        if (c.moveToFirst()) r = readYarn(c);
        c.close();
        return r;
    }

    private YarnRecord readYarn(Cursor c) {
        YarnRecord r = new YarnRecord();
        r.id = c.getLong(0);
        r.layoutId = c.getLong(1);
        r.saved = c.getInt(2) != 0;
        r.internalNumber = c.getLong(3);
        r.archived = c.getInt(4) != 0;
        r.archivedAt = c.getLong(5);
        r.photoFile = c.getString(6) == null ? "" : c.getString(6);
        r.country = c.getString(7);
        r.manufacturer = c.getString(8);
        r.name = c.getString(9);
        r.color = c.getString(10);
        r.shade = c.getString(11);
        r.composition = c.getString(12);
        r.lengthPer100 = c.getString(13);
        r.threadParams = c.getString(14);
        r.availability = c.getString(15);
        r.pricePer100 = c.getString(16);
        r.storageLocation = c.getString(17);
        r.description = c.getString(18);
        r.layoutDate = c.getString(19);
        return r;
    }

    public long saveYarn(YarnRecord r, boolean markSaved) {
        SQLiteDatabase db = getWritableDatabase();
        if (r.id == 0 && r.internalNumber <= 0) {
            r.internalNumber = nextInternalNumber();
        } else if (r.id == 0 && r.internalNumber > 0) {
            ensureNextInternalNumberAtLeast(r.internalNumber + 1);
        }
        ContentValues v = valuesFor(r, markSaved);
        long now = System.currentTimeMillis();
        v.put("updated_at", now);
        if (r.id == 0) {
            v.put("created_at", now);
            r.id = db.insertOrThrow("yarns", null, v);
            return r.id;
        }
        db.update("yarns", v, "id=?", new String[]{String.valueOf(r.id)});
        return r.id;
    }

    private ContentValues valuesFor(YarnRecord r, boolean saved) {
        ContentValues v = new ContentValues();
        v.put("layout_id", r.layoutId);
        v.put("is_saved", saved ? 1 : 0);
        v.put("internal_number", r.internalNumber);
        v.put("archived", r.archived ? 1 : 0);
        v.put("archived_at", r.archivedAt);
        v.put("photo_file", n(r.photoFile));
        v.put("country", n(r.country));
        v.put("manufacturer", n(r.manufacturer));
        v.put("name", n(r.name));
        v.put("color", n(r.color));
        v.put("shade", n(r.shade));
        v.put("composition", n(r.composition));
        v.put("length_per_100", n(r.lengthPer100));
        v.put("thread_params", n(r.threadParams));
        v.put("availability", n(r.availability));
        v.put("price_per_100", n(r.pricePer100));
        v.put("storage_location", n(r.storageLocation));
        v.put("description", n(r.description));
        return v;
    }

    public void updateStorage(long id, String storage) {
        ContentValues v = new ContentValues();
        v.put("storage_location", n(storage));
        v.put("updated_at", System.currentTimeMillis());
        getWritableDatabase().update("yarns", v, "id=?", new String[]{String.valueOf(id)});
    }

    private String n(String s) { return s == null ? "" : s.trim(); }

    public long duplicateYarn(long id) {
        YarnRecord source = getYarn(id);
        if (source == null) return 0;
        source.id = 0;
        source.internalNumber = 0;
        source.archived = false;
        source.archivedAt = 0;
        source.photoFile = "";
        return saveYarn(source, false);
    }

    public long duplicateLayout(long sourceLayoutId, String targetDateIso) {
        if (layoutExists(targetDateIso)) return -1;
        long newLayoutId = createOrGetLayout(targetDateIso, getLayoutDescription(sourceLayoutId));
        List<YarnRecord> sourceItems = getYarnsForLayout(sourceLayoutId, "");
        for (YarnRecord source : sourceItems) {
            source.id = 0;
            source.internalNumber = 0;
            source.archived = false;
            source.archivedAt = 0;
            source.photoFile = "";
            source.layoutId = newLayoutId;
            saveYarn(source, false);
        }
        return newLayoutId;
    }

    public synchronized long nextInternalNumber() {
        SQLiteDatabase db = getWritableDatabase();
        db.execSQL("CREATE TABLE IF NOT EXISTS app_meta (meta_key TEXT PRIMARY KEY, meta_value INTEGER NOT NULL)");
        Cursor c = db.rawQuery(
                "SELECT meta_value FROM app_meta WHERE meta_key='next_internal_number' LIMIT 1", null);
        long next;
        if (c.moveToFirst()) {
            next = Math.max(1, c.getLong(0));
        } else {
            Cursor max = db.rawQuery("SELECT COALESCE(MAX(internal_number),0)+1 FROM yarns", null);
            next = max.moveToFirst() ? Math.max(1, max.getLong(0)) : 1;
            max.close();
        }
        c.close();

        ContentValues values = new ContentValues();
        values.put("meta_key", "next_internal_number");
        values.put("meta_value", next + 1);
        db.insertWithOnConflict("app_meta", null, values, SQLiteDatabase.CONFLICT_REPLACE);
        return next;
    }

    private synchronized void ensureNextInternalNumberAtLeast(long requiredNext) {
        SQLiteDatabase db = getWritableDatabase();
        db.execSQL("CREATE TABLE IF NOT EXISTS app_meta (meta_key TEXT PRIMARY KEY, meta_value INTEGER NOT NULL)");
        Cursor c = db.rawQuery(
                "SELECT meta_value FROM app_meta WHERE meta_key='next_internal_number' LIMIT 1", null);
        long current = c.moveToFirst() ? c.getLong(0) : 1;
        c.close();
        if (current >= requiredNext) return;

        ContentValues values = new ContentValues();
        values.put("meta_key", "next_internal_number");
        values.put("meta_value", requiredNext);
        db.insertWithOnConflict("app_meta", null, values, SQLiteDatabase.CONFLICT_REPLACE);
    }

    public boolean internalNumberExists(long number) {
        if (number <= 0) return false;
        Cursor c = getReadableDatabase().rawQuery(
                "SELECT 1 FROM yarns WHERE internal_number=? LIMIT 1",
                new String[]{String.valueOf(number)});
        boolean exists = c.moveToFirst();
        c.close();
        return exists;
    }

    public YarnRecord getYarnByInternalNumber(long number) {
        Cursor c = getReadableDatabase().rawQuery(
                yarnSelect() + "FROM yarns y JOIN layouts l ON l.id=y.layout_id WHERE y.internal_number=? LIMIT 1",
                new String[]{String.valueOf(number)});
        YarnRecord r = null;
        if (c.moveToFirst()) r = readYarn(c);
        c.close();
        return r;
    }

    public void setPhotoFile(long id, String fileName) {
        ContentValues values = new ContentValues();
        values.put("photo_file", n(fileName));
        values.put("updated_at", System.currentTimeMillis());
        getWritableDatabase().update("yarns", values, "id=?", new String[]{String.valueOf(id)});
    }

    public boolean archiveYarn(long id) {
        YarnRecord record = getYarn(id);
        if (record == null || record.archived) return record != null;
        if (!PhotoStore.moveToArchive(appContext, record)) return false;

        ContentValues values = new ContentValues();
        values.put("archived", 1);
        values.put("archived_at", System.currentTimeMillis());
        values.put("updated_at", System.currentTimeMillis());
        getWritableDatabase().update("yarns", values, "id=?", new String[]{String.valueOf(id)});
        return true;
    }

    public boolean restoreYarn(long id) {
        YarnRecord record = getYarn(id);
        if (record == null || !record.archived) return record != null;
        if (!PhotoStore.moveToActive(appContext, record)) return false;

        ContentValues values = new ContentValues();
        values.put("archived", 0);
        values.put("archived_at", 0);
        values.put("updated_at", System.currentTimeMillis());
        getWritableDatabase().update("yarns", values, "id=?", new String[]{String.valueOf(id)});
        setLayoutHidden(record.layoutId, false);
        return true;
    }

    public int clearArchivedPhotoReferences() {
        ContentValues values = new ContentValues();
        values.put("photo_file", "");
        values.put("updated_at", System.currentTimeMillis());
        return getWritableDatabase().update(
                "yarns", values, "archived=1 AND TRIM(photo_file)<>''", null);
    }

    public int clearAllPhotoReferences() {
        ContentValues values = new ContentValues();
        values.put("photo_file", "");
        values.put("updated_at", System.currentTimeMillis());
        return getWritableDatabase().update(
                "yarns", values, "TRIM(photo_file)<>''", null);
    }

    public int getArchivedCountForLayout(long layoutId) {
        Cursor c = getReadableDatabase().rawQuery(
                "SELECT COUNT(*) FROM yarns WHERE layout_id=? AND archived=1",
                new String[]{String.valueOf(layoutId)});
        int count = c.moveToFirst() ? c.getInt(0) : 0;
        c.close();
        return count;
    }

    public int getArchivedCount() {
        Cursor c = getReadableDatabase().rawQuery("SELECT COUNT(*) FROM yarns WHERE archived=1", null);
        int count = 0;
        if (c.moveToFirst()) count = c.getInt(0);
        c.close();
        return count;
    }

    public List<YarnRecord> getAllYarnsForPhotoMigration() {
        List<YarnRecord> out = new ArrayList<>();
        Cursor c = getReadableDatabase().rawQuery(
                yarnSelect() + "FROM yarns y JOIN layouts l ON l.id=y.layout_id ORDER BY y.id ASC", null);
        while (c.moveToNext()) out.add(readYarn(c));
        c.close();
        return out;
    }

    public List<YarnRecord> searchArchive(String query) {
        List<YarnRecord> out = new ArrayList<>();
        String q = query == null ? "" : query.trim();
        String where = "WHERE y.archived=1";
        List<String> args = new ArrayList<>();
        if (!q.isEmpty()) {
            where += " AND (CAST(y.internal_number AS TEXT) LIKE ? OR y.country LIKE ? OR y.manufacturer LIKE ? OR y.name LIKE ? OR y.color LIKE ? OR y.shade LIKE ? OR y.composition LIKE ? OR y.storage_location LIKE ? OR y.description LIKE ?)";
            String like = "%" + q.replace("#", "") + "%";
            for (int i = 0; i < 9; i++) args.add(like);
        }
        Cursor c = getReadableDatabase().rawQuery(
                yarnSelect() + "FROM yarns y JOIN layouts l ON l.id=y.layout_id " + where +
                        " ORDER BY y.archived_at DESC,y.internal_number DESC",
                args.toArray(new String[0]));
        while (c.moveToNext()) out.add(readYarn(c));
        c.close();
        return out;
    }

    private List<YarnRecord> getYarnsForLayoutForBackup(long layoutId) {
        List<YarnRecord> out = new ArrayList<>();
        Cursor c = getReadableDatabase().rawQuery(
                yarnSelect() + "FROM yarns y JOIN layouts l ON l.id=y.layout_id WHERE y.layout_id=? ORDER BY y.id DESC",
                new String[]{String.valueOf(layoutId)});
        while (c.moveToNext()) out.add(readYarn(c));
        c.close();
        return out;
    }

    public void deleteYarn(long id) {
        YarnRecord record = getYarn(id);
        if (record != null) PhotoStore.deletePhoto(appContext, record);
        getWritableDatabase().delete("yarns", "id=?", new String[]{String.valueOf(id)});

        if (record != null && isLayoutHidden(record.layoutId)) {
            Cursor c = getReadableDatabase().rawQuery(
                    "SELECT COUNT(*) FROM yarns WHERE layout_id=?",
                    new String[]{String.valueOf(record.layoutId)});
            int remaining = c.moveToFirst() ? c.getInt(0) : 0;
            c.close();
            if (remaining == 0) {
                getWritableDatabase().delete("layouts", "id=?",
                        new String[]{String.valueOf(record.layoutId)});
            }
        }
    }

    public void deleteLayout(long id, boolean deleteArchived) {
        List<YarnRecord> records = getYarnsForLayoutForBackup(id);

        if (deleteArchived) {
            for (YarnRecord record : records) PhotoStore.deletePhoto(appContext, record);
            SQLiteDatabase db = getWritableDatabase();
            db.beginTransaction();
            try {
                db.delete("yarns", "layout_id=?", new String[]{String.valueOf(id)});
                db.delete("layouts", "id=?", new String[]{String.valueOf(id)});
                db.setTransactionSuccessful();
            } finally {
                db.endTransaction();
            }
            return;
        }

        for (YarnRecord record : records) {
            if (!record.archived) PhotoStore.deletePhoto(appContext, record);
        }

        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            db.delete("yarns", "layout_id=? AND archived=0", new String[]{String.valueOf(id)});
            Cursor c = db.rawQuery("SELECT COUNT(*) FROM yarns WHERE layout_id=? AND archived=1",
                    new String[]{String.valueOf(id)});
            int archivedLeft = c.moveToFirst() ? c.getInt(0) : 0;
            c.close();

            if (archivedLeft > 0) {
                ContentValues hidden = new ContentValues();
                hidden.put("hidden", 1);
                db.update("layouts", hidden, "id=?", new String[]{String.valueOf(id)});
            } else {
                db.delete("layouts", "id=?", new String[]{String.valueOf(id)});
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }
}
