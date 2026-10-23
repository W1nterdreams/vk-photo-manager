package ru.yarnnotebook.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DatePickerDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.AbsListView;
import android.widget.ArrayAdapter;
import android.widget.BaseAdapter;
import android.widget.AutoCompleteTextView;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.DatePicker;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.ScrollView;
import android.widget.SearchView;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MainActivity extends Activity {
    private final int BG = Color.rgb(247, 244, 241);
    private final int SURFACE = Color.WHITE;
    private final int PRIMARY = Color.rgb(106, 78, 61);
    private final int TEXT = Color.rgb(36, 28, 24);
    private final int MUTED = Color.rgb(116, 106, 100);
    private final int DRAFT = Color.rgb(161, 67, 46);
    private final int BORDER = Color.rgb(222, 214, 209);
    private final int COMPOSITION_OK = Color.rgb(46, 125, 50);
    private final int COMPOSITION_BAD = Color.rgb(198, 40, 40);
    private final int VALIDATION_BG = Color.rgb(255, 235, 238);
    private final int VALIDATION_ACCENT = Color.rgb(183, 28, 28);

    private DbHelper db;
    private long currentLayoutId = 0;
    private long currentYarnId = 0;
    private Screen screen = Screen.HOME;
    private long lastHomeBackAt = 0L;
    private Runnable descriptionScrollRunnable;
    private int homeScrollY = 0;
    private final Map<Long, Integer> layoutScrollPosition = new HashMap<>();
    private final Map<Long, Integer> layoutScrollOffset = new HashMap<>();

    private static final int REQ_EXPORT_JSON = 7001;
    private static final int REQ_IMPORT_DATABASE = 7002;
    private static final int REQ_IMPORT_LAYOUT = 7003;
    private static final int REQ_PICK_PHOTO = 7004;
    private static final int REQ_WRITE_STORAGE = 7005;
    private String pendingExportJson = "";
    private long pendingPhotoYarnId = 0;

    private ImageView editorPhotoPreview;
    private Button editorPhotoButton;
    private Button editorDeletePhotoButton;
    private TextView editorInternalArticle;

    private EditText fCountry, fManufacturer, fName, fColor, fShade, fLength,
            fThread, fAvailability, fPrice, fStorage, fDescription;
    private LinearLayout compositionContainer;
    private TextView compositionTotalLabel;
    private final List<CompositionRow> compositionRows = new ArrayList<>();
    private LinearLayout bobbinWeightContainer;
    private final List<EditText> bobbinWeightFields = new ArrayList<>();
    private final List<LinearLayout> bobbinWeightRowViews = new ArrayList<>();
    private final List<TextView> bobbinWeightLabels = new ArrayList<>();

    private enum Screen { HOME, LAYOUT, EDIT, GLOBAL_SEARCH, ARCHIVE }

    private static class CompositionRow {
        LinearLayout root;
        EditText percent;
        EditText material;
        Button remove;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        db = new DbHelper(this);
        configureWindow();
        registerSystemBackGesture();
        showHome();
        ensureOverlayServiceIfEnabled();
        startPhotoMigrationIfPossible();
    }

    @Override
    protected void onResume() {
        super.onResume();
        android.content.SharedPreferences prefs = getSharedPreferences(OverlayService.PREFS, MODE_PRIVATE);
        if (prefs.getBoolean(OverlayService.PREF_PENDING, false)) {
            prefs.edit().putBoolean(OverlayService.PREF_PENDING, false).apply();
            if (android.provider.Settings.canDrawOverlays(this)) {
                prefs.edit().putBoolean(OverlayService.PREF_ENABLED, true).apply();
                startOverlayService();
                Toast.makeText(this, "Плавающая кнопка включена", Toast.LENGTH_SHORT).show();
            } else {
                Toast.makeText(this, "Разрешение «Поверх других приложений» не выдано", Toast.LENGTH_LONG).show();
            }
        }
    }

    private void configureWindow() {
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getWindow().setStatusBarColor(PRIMARY);
            getWindow().setNavigationBarColor(BG);
        }
    }

    private void registerSystemBackGesture() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                    this::navigateBack);
        }
    }

    @Override
    public void onBackPressed() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            navigateBack();
        }
    }

    private void navigateBack() {
        if (screen == Screen.EDIT) {
            backFromEditor();
        } else if (screen == Screen.LAYOUT || screen == Screen.GLOBAL_SEARCH || screen == Screen.ARCHIVE) {
            showHome();
        } else {
            long now = System.currentTimeMillis();
            if (now - lastHomeBackAt <= 2000L) {
                finishAndRemoveTask();
            } else {
                lastHomeBackAt = now;
                Toast.makeText(this, "Ещё раз назад для выхода", Toast.LENGTH_SHORT).show();
            }
        }
    }

    private void backFromEditor() {
        YarnRecord current = currentYarnId > 0 ? db.getYarn(currentYarnId) : null;
        if (current != null && current.archived) {
            showArchive("");
        } else {
            showLayout(currentLayoutId, "");
        }
    }

    private void showHome() {
        screen = Screen.HOME;
        currentLayoutId = 0;
        currentYarnId = 0;

        LinearLayout page = page();
        page.addView(toolbar("Выкладки", null));

        TextView intro = text("Подготовка карточек пряжи для публикации", 15, MUTED, false);
        intro.setPadding(dp(16), dp(12), dp(16), dp(4));
        page.addView(intro);

        Button globalSearch = button("Поиск по базе");
        LinearLayout.LayoutParams searchParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        searchParams.setMargins(dp(12), dp(8), dp(12), dp(6));
        page.addView(globalSearch, searchParams);
        globalSearch.setOnClickListener(v -> showGlobalSearch());

        Button archive = button("Архив проданного · " + db.getArchivedCount());
        LinearLayout.LayoutParams archiveParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        archiveParams.setMargins(dp(12), 0, dp(12), dp(6));
        page.addView(archive, archiveParams);
        archive.setOnClickListener(v -> showArchive(""));

        ScrollView scroll = new ScrollView(this);
        final int restoreHomeScrollY = homeScrollY;
        scroll.setOnScrollChangeListener((v, scrollX, scrollY, oldScrollX, oldScrollY) ->
                homeScrollY = scrollY);
        LinearLayout list = vertical();
        list.setPadding(dp(12), dp(4), dp(12), dp(90));
        List<LayoutRecord> layouts = db.getLayouts();
        layouts.sort((a, b) -> {
            boolean asc = getSharedPreferences(OverlayService.PREFS, MODE_PRIVATE)
                    .getBoolean("layout_number_sort_asc", true);
            return asc ? Long.compare(a.id, b.id) : Long.compare(b.id, a.id);
        });
        if (layouts.isEmpty()) {
            TextView empty = text("Пока нет ни одной выкладки.\nСоздайте первую кнопкой ниже.", 17, MUTED, false);
            empty.setGravity(Gravity.CENTER);
            empty.setPadding(dp(20), dp(80), dp(20), dp(20));
            list.addView(empty);
        } else {
            List<LayoutRecord> numberedLayouts = new ArrayList<>(layouts);
            numberedLayouts.sort((a, b) -> Long.compare(a.id, b.id));
            for (LayoutRecord r : layouts) {
                int number = 0;
                for (int i = 0; i < numberedLayouts.size(); i++) {
                    if (numberedLayouts.get(i).id == r.id) {
                        number = i + 1;
                        break;
                    }
                }
                list.addView(layoutCard(r, number));
            }
        }
        scroll.addView(list);
        page.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        Button plus = primaryButton("＋  Новая выкладка");
        LinearLayout.LayoutParams pp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(58));
        pp.setMargins(dp(12), dp(6), dp(12), dp(12));
        page.addView(plus, pp);
        plus.setOnClickListener(v -> chooseLayoutDate());
        setContentView(page);
        scroll.post(() -> scroll.scrollTo(0, restoreHomeScrollY));
    }

    private View layoutCard(LayoutRecord r, int number) {
        LinearLayout card = card();
        TextView date = text("№" + number + " · " + formatDate(r.dateIso), 21, TEXT, true);
        card.addView(date);
        if (!blank(r.description)) {
            TextView description = text(r.description, 16, TEXT, false);
            description.setPadding(0, dp(4), 0, 0);
            card.addView(description);
        }
        String meta = r.itemCount + plural(r.itemCount, " товар", " товара", " товаров");
        if (r.draftCount > 0) meta += "  •  " + r.draftCount + " не сохранено";
        TextView sub = text(meta, 14, r.draftCount > 0 ? DRAFT : MUTED, false);
        sub.setPadding(0, dp(5), 0, 0);
        card.addView(sub);
        card.setOnClickListener(v -> showLayout(r.id, ""));
        card.setOnLongClickListener(v -> {
            showLayoutActions(r);
            return true;
        });
        return card;
    }

    private void showLayoutActions(LayoutRecord r) {
        new AlertDialog.Builder(this)
                .setTitle("Выкладка · " + formatDate(r.dateIso))
                .setItems(new String[]{"Изменить описание", "Дублировать", "Удалить"}, (dialog, which) -> {
                    if (which == 0) {
                        showLayoutDescriptionEditor(r);
                    } else if (which == 1) {
                        chooseDuplicateLayoutDate(r);
                    } else {
                        confirmDeleteLayout(r);
                    }
                })
                .show();
    }

    private void showLayoutDescriptionEditor(LayoutRecord r) {
        LinearLayout wrap = vertical();
        wrap.setPadding(dp(18), dp(8), dp(18), 0);
        EditText editor = input("Например: Кашемир и меринос",
                InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES, 1);
        editor.setText(r.description == null ? "" : r.description);
        editor.setSelection(editor.getText().length());
        wrap.addView(editor, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("Описание выкладки")
                .setMessage("Можно оставить пустым")
                .setView(wrap)
                .setNegativeButton("Отмена", null)
                .setPositiveButton("Сохранить", (d, w) -> {
                    db.updateLayoutDescription(r.id, editor.getText().toString());
                    showHome();
                })
                .create();
        dialog.setOnShowListener(d -> editor.requestFocus());
        dialog.show();
    }

    private void confirmDeleteLayout(LayoutRecord r) {
        int archivedCount = db.getArchivedCountForLayout(r.id);

        LinearLayout wrap = vertical();
        wrap.setPadding(dp(22), dp(4), dp(22), 0);

        TextView warning = text(
                "Обычные товары этой выкладки будут удалены. Архивные товары можно сохранить.",
                15, TEXT, false);
        warning.setPadding(0, 0, 0, dp(10));
        wrap.addView(warning);

        CheckBox deleteArchived = new CheckBox(this);
        deleteArchived.setText(archivedCount > 0
                ? "Удалить товары этой выкладки из архива (" + archivedCount + ")"
                : "Удалить товары этой выкладки из архива");
        deleteArchived.setTextSize(15);
        deleteArchived.setTextColor(TEXT);
        deleteArchived.setChecked(false);
        deleteArchived.setEnabled(archivedCount > 0);
        wrap.addView(deleteArchived);

        if (archivedCount == 0) {
            TextView none = text("В архиве товаров этой выкладки нет.", 13, MUTED, false);
            none.setPadding(dp(4), dp(2), 0, 0);
            wrap.addView(none);
        }

        new AlertDialog.Builder(this)
                .setTitle("Удалить выкладку?")
                .setView(wrap)
                .setNegativeButton("Отмена", null)
                .setPositiveButton("Удалить", (d, w) -> {
                    db.deleteLayout(r.id, deleteArchived.isChecked());
                    showHome();
                })
                .show();
    }

    private void chooseDuplicateLayoutDate(LayoutRecord source) {
        Calendar base = Calendar.getInstance();
        try {
            Date parsed = new SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(source.dateIso);
            if (parsed != null) base.setTime(parsed);
        } catch (ParseException ignored) { }
        base.add(Calendar.DAY_OF_MONTH, 1);

        DatePickerDialog dlg = new DatePickerDialog(this, (DatePicker view, int year, int month, int day) -> {
            Calendar c = Calendar.getInstance();
            c.set(year, month, day);
            String iso = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(c.getTime());
            if (db.layoutExists(iso)) {
                Toast.makeText(this, "Выкладка на эту дату уже существует", Toast.LENGTH_LONG).show();
                return;
            }
            long id = db.duplicateLayout(source.id, iso);
            if (id > 0) {
                Toast.makeText(this, "Выкладка скопирована · карточки отмечены как не сохраненные", Toast.LENGTH_LONG).show();
                showLayout(id, "");
            }
        }, base.get(Calendar.YEAR), base.get(Calendar.MONTH), base.get(Calendar.DAY_OF_MONTH));
        dlg.setTitle("Дата копии выкладки");
        dlg.show();
    }

    private void chooseLayoutDate() {
        Calendar now = Calendar.getInstance();
        DatePickerDialog dlg = new DatePickerDialog(this, (DatePicker view, int year, int month, int day) -> {
            Calendar c = Calendar.getInstance();
            c.set(year, month, day);
            String iso = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(c.getTime());
            if (db.layoutExists(iso)) {
                long id = db.createOrGetLayout(iso);
                showLayout(id, "");
            } else {
                showNewLayoutDescription(iso);
            }
        }, now.get(Calendar.YEAR), now.get(Calendar.MONTH), now.get(Calendar.DAY_OF_MONTH));
        dlg.setTitle("Дата выкладки");
        dlg.show();
    }

    private void showNewLayoutDescription(String dateIso) {
        LinearLayout wrap = vertical();
        wrap.setPadding(dp(18), dp(8), dp(18), 0);
        EditText editor = input("Например: Кашемир и меринос",
                InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES, 1);
        wrap.addView(editor, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle(formatDate(dateIso))
                .setMessage("Краткое описание выкладки — необязательно")
                .setView(wrap)
                .setNegativeButton("Отмена", null)
                .setPositiveButton("Создать", (d, w) -> {
                    long id = db.createOrGetLayout(dateIso, editor.getText().toString());
                    showLayout(id, "");
                })
                .create();
        dialog.setOnShowListener(d -> editor.requestFocus());
        dialog.show();
    }

    private void showLayout(long layoutId, String initialQuery) {
        screen = Screen.LAYOUT;
        currentLayoutId = layoutId;
        currentYarnId = 0;
        String date = db.getLayoutDate(layoutId);
        String layoutDescription = db.getLayoutDescription(layoutId);

        LinearLayout page = page();
        page.addView(toolbar("Выкладка · " + formatDate(date), v -> showHome()));
        if (!blank(layoutDescription)) {
            TextView description = text(layoutDescription, 15, MUTED, false);
            description.setPadding(dp(16), dp(8), dp(16), dp(2));
            page.addView(description);
        }

        SearchView search = new SearchView(this);
        search.setQueryHint("Артикул, цвет, место хранения…");
        search.setIconifiedByDefault(false);
        search.setQuery(initialQuery, false);
        page.addView(search, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(62)));

        ListView list = new ListView(this);
        list.setDivider(null);
        list.setDividerHeight(0);
        list.setBackgroundColor(BG);
        list.setPadding(dp(12), dp(4), dp(12), dp(90));
        list.setClipToPadding(false);
        list.setVerticalScrollBarEnabled(true);

        final int restorePosition = layoutScrollPosition.containsKey(layoutId)
                ? layoutScrollPosition.get(layoutId)
                : 0;
        final int restoreOffset = layoutScrollOffset.containsKey(layoutId)
                ? layoutScrollOffset.get(layoutId)
                : 0;

        list.setOnScrollListener(new AbsListView.OnScrollListener() {
            @Override public void onScrollStateChanged(AbsListView view, int scrollState) { }

            @Override
            public void onScroll(AbsListView view, int firstVisibleItem, int visibleItemCount, int totalItemCount) {
                if (totalItemCount <= 0) return;
                layoutScrollPosition.put(layoutId, firstVisibleItem);
                View first = view.getChildAt(0);
                layoutScrollOffset.put(layoutId, first == null ? 0 : first.getTop());
            }
        });

        page.addView(list, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        Runnable render = () -> {
            String query = search.getQuery().toString();
            renderYarns(list, layoutId, query);
            if (!blank(query)) list.setSelection(0);
        };
        search.setOnQueryTextListener(new SearchView.OnQueryTextListener() {
            @Override public boolean onQueryTextSubmit(String query) { render.run(); return true; }
            @Override public boolean onQueryTextChange(String newText) { render.run(); return true; }
        });
        render.run();

        Button plus = primaryButton("＋  Добавить пряжу");
        LinearLayout.LayoutParams pp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(58));
        pp.setMargins(dp(12), dp(6), dp(12), dp(12));
        page.addView(plus, pp);
        plus.setOnClickListener(v -> showEditor(layoutId, 0));
        setContentView(page);

        if (blank(initialQuery)) {
            list.post(() -> list.setSelectionFromTop(restorePosition, restoreOffset));
        }
    }

    private void renderYarns(ListView list, long layoutId, String query) {
        List<YarnRecord> yarns = db.getYarnsForLayout(layoutId, query);
        if (yarns.isEmpty()) {
            final String emptyText = query == null || query.trim().isEmpty()
                    ? "В выкладке пока нет пряжи."
                    : "Ничего не найдено.";
            list.setAdapter(new BaseAdapter() {
                @Override public int getCount() { return 1; }
                @Override public Object getItem(int position) { return null; }
                @Override public long getItemId(int position) { return 0; }

                @Override
                public View getView(int position, View convertView, ViewGroup parent) {
                    TextView empty = convertView instanceof TextView
                            ? (TextView) convertView
                            : text("", 17, MUTED, false);
                    empty.setText(emptyText);
                    empty.setTextColor(MUTED);
                    empty.setGravity(Gravity.CENTER);
                    empty.setPadding(dp(20), dp(70), dp(20), dp(70));
                    return empty;
                }
            });
            return;
        }

        List<YarnRecord> allYarns = db.getYarnsForLayout(layoutId, "");
        allYarns.sort((a, b) -> Long.compare(a.id, b.id));
        Map<Long, Integer> numberById = new HashMap<>();
        for (int i = 0; i < allYarns.size(); i++) {
            numberById.put(allYarns.get(i).id, i + 1);
        }

        boolean asc = getSharedPreferences(OverlayService.PREFS, MODE_PRIVATE)
                .getBoolean("yarn_number_sort_asc", true);
        yarns.sort((a, b) -> asc ? Long.compare(a.id, b.id) : Long.compare(b.id, a.id));

        list.setAdapter(new BaseAdapter() {
            @Override public int getCount() { return yarns.size(); }
            @Override public YarnRecord getItem(int position) { return yarns.get(position); }
            @Override public long getItemId(int position) { return yarns.get(position).id; }
            @Override public boolean hasStableIds() { return true; }

            @Override
            public View getView(int position, View convertView, ViewGroup parent) {
                LinearLayout host;
                if (convertView instanceof LinearLayout) {
                    host = (LinearLayout) convertView;
                    host.removeAllViews();
                } else {
                    host = vertical();
                    host.setPadding(0, 0, 0, 0);
                }

                YarnRecord y = getItem(position);
                Integer number = numberById.get(y.id);
                host.addView(yarnCard(y, false, number == null ? 0 : number));
                return host;
            }
        });
    }

    private View yarnCard(YarnRecord y, boolean showDate, int number) {
        LinearLayout card = card();
        card.setPadding(dp(14), dp(14), dp(14), dp(14));

        LinearLayout top = horizontal();
        top.setGravity(Gravity.TOP);

        Bitmap bitmap = PhotoStore.loadThumbnail(this, y, dp(180));
        if (bitmap != null) {
            ImageView thumb = new ImageView(this);
            thumb.setScaleType(ImageView.ScaleType.CENTER_CROP);
            thumb.setImageBitmap(bitmap);
            LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(dp(82), dp(82));
            tp.setMargins(0, 0, dp(12), 0);
            top.addView(thumb, tp);
        }

        LinearLayout info = vertical();
        LinearLayout titleRow = horizontal();
        titleRow.setGravity(Gravity.TOP);
        String numberedTitle = number > 0 ? "№" + number + " · " + displayTitle(y) : displayTitle(y);
        TextView title = text(numberedTitle, 19, TEXT, true);
        titleRow.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        if (!y.saved && !y.archived) {
            TextView draft = text("НЕ СОХРАНЕНА", 11, DRAFT, true);
            draft.setGravity(Gravity.END);
            draft.setPadding(dp(8), dp(4), 0, 0);
            titleRow.addView(draft);
        }
        info.addView(titleRow);

        if (y.internalNumber > 0) {
            TextView internal = text("#" + y.internalNumber, 13, MUTED, true);
            internal.setPadding(0, dp(4), 0, 0);
            info.addView(internal);
        }

        StringBuilder details = new StringBuilder();
        if (!blank(y.shade)) details.append("Оттенок: ").append(y.shade.trim());
        if (!blank(y.color)) {
            if (details.length() > 0) details.append("  •  ");
            details.append("Цвет: ").append(y.color.trim());
        }
        if (details.length() == 0) details.append("Оттенок и цвет не заполнены");
        TextView colorLine = text(details.toString(), 14, MUTED, false);
        colorLine.setPadding(0, dp(6), 0, 0);
        info.addView(colorLine);

        if (showDate) {
            TextView date = text("Выкладка: " + formatDate(y.layoutDate), 13, MUTED, false);
            date.setPadding(0, dp(5), 0, 0);
            info.addView(date);
        }

        top.addView(info, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        card.addView(top);

        LinearLayout storageRow = horizontal();
        storageRow.setGravity(Gravity.CENTER_VERTICAL);
        storageRow.setPadding(0, dp(10), 0, 0);
        String storageText = blank(y.storageLocation) ? "Место хранения: —" : "Место хранения: " + y.storageLocation.trim();
        TextView storage = text(storageText, 13, blank(y.storageLocation) ? MUTED : TEXT, false);
        storageRow.addView(storage, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        if (!showDate && !y.archived) {
            Button editStorage = button("Изменить место");
            editStorage.setTextSize(12);
            LinearLayout.LayoutParams ep = new LinearLayout.LayoutParams(dp(138), dp(42));
            ep.setMargins(dp(10), 0, 0, 0);
            storageRow.addView(editStorage, ep);
            editStorage.setOnClickListener(v -> showStorageEditor(y));
        }
        card.addView(storageRow);

        card.setOnClickListener(v -> {
            currentLayoutId = y.layoutId;
            showEditor(y.layoutId, y.id);
        });
        if (y.archived) {
            card.setOnLongClickListener(v -> {
                showArchivedYarnActions(y);
                return true;
            });
        } else if (!showDate) {
            card.setOnLongClickListener(v -> {
                showYarnActions(y);
                return true;
            });
        }
        return card;
    }

    private void showStorageEditor(YarnRecord y) {
        LinearLayout wrap = vertical();
        wrap.setPadding(dp(18), dp(8), dp(18), 0);
        AutoCompleteTextView editor = autoInput("Например: Стеллаж 2, ячейка Б4",
                InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES, "storage");
        editor.setText(y.storageLocation);
        editor.setSelectAllOnFocus(false);
        editor.setSelection(editor.getText().length());
        wrap.addView(editor, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("Место хранения")
                .setView(wrap)
                .setNegativeButton("Отмена", null)
                .setPositiveButton("Сохранить", (d, w) -> {
                    y.storageLocation = editor.getText().toString().trim();
                    db.updateStorage(y.id, y.storageLocation);
                    showLayout(y.layoutId, "");
                })
                .create();
        dialog.setOnShowListener(d -> {
            editor.requestFocus();
            editor.postDelayed(() -> {
                InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
                if (imm != null) imm.showSoftInput(editor, InputMethodManager.SHOW_IMPLICIT);
            }, 120);
        });
        dialog.show();
    }

    private void showYarnActions(YarnRecord y) {
        new AlertDialog.Builder(this)
                .setTitle(displayTitle(y))
                .setItems(new String[]{"Скопировать описание для VK", "Дублировать", "В архив проданного", "Удалить"}, (dialog, which) -> {
                    if (which == 0) {
                        copyVkText(y);
                    } else if (which == 1) {
                        long copyId = db.duplicateYarn(y.id);
                        if (copyId != 0) {
                            Toast.makeText(this, "Создана копия · НЕ СОХРАНЕНА", Toast.LENGTH_SHORT).show();
                            showLayout(y.layoutId, "");
                        }
                    } else if (which == 2) {
                        new AlertDialog.Builder(this)
                                .setTitle("Перенести в архив проданного?")
                                .setMessage("Карточка исчезнет из выкладки и общего поиска. Локальная фотография будет перенесена в папку архива.")
                                .setNegativeButton("Отмена", null)
                                .setPositiveButton("В архив", (d, w) -> {
                                    if (db.archiveYarn(y.id)) {
                                        Toast.makeText(this, "Перенесено в архив", Toast.LENGTH_SHORT).show();
                                        showLayout(y.layoutId, "");
                                    } else {
                                        Toast.makeText(this, "Не удалось перенести фотографию в архив", Toast.LENGTH_LONG).show();
                                    }
                                })
                                .show();
                    } else {
                        new AlertDialog.Builder(this)
                                .setTitle("Удалить карточку?")
                                .setMessage("Карточка и её локальная фотография будут удалены. Это действие нельзя отменить.")
                                .setNegativeButton("Отмена", null)
                                .setPositiveButton("Удалить", (d, w) -> {
                                    db.deleteYarn(y.id);
                                    showLayout(y.layoutId, "");
                                })
                                .show();
                    }
                })
                .show();
    }

    private void showArchivedYarnActions(YarnRecord y) {
        new AlertDialog.Builder(this)
                .setTitle("#" + y.internalNumber + " · " + displayTitle(y))
                .setItems(new String[]{"Вернуть в наличие", "Удалить навсегда"}, (dialog, which) -> {
                    if (which == 0) {
                        if (db.restoreYarn(y.id)) {
                            Toast.makeText(this, "Возвращено в наличие", Toast.LENGTH_SHORT).show();
                            showArchive("");
                        } else {
                            Toast.makeText(this, "Не удалось вернуть фотографию из архива", Toast.LENGTH_LONG).show();
                        }
                    } else {
                        new AlertDialog.Builder(this)
                                .setTitle("Удалить из архива?")
                                .setMessage("Карточка и её локальная фотография будут удалены навсегда.")
                                .setNegativeButton("Отмена", null)
                                .setPositiveButton("Удалить", (d, w) -> {
                                    db.deleteYarn(y.id);
                                    showArchive("");
                                })
                                .show();
                    }
                })
                .show();
    }

    private void showArchive(String initialQuery) {
        screen = Screen.ARCHIVE;
        currentLayoutId = 0;
        currentYarnId = 0;

        LinearLayout page = page();
        page.addView(toolbar("Архив проданного", v -> showHome()));

        SearchView search = new SearchView(this);
        search.setQueryHint("Поиск: #123, артикул, цвет, состав…");
        search.setIconifiedByDefault(false);
        search.setQuery(initialQuery == null ? "" : initialQuery, false);
        page.addView(search, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(62)));

        ScrollView scroll = new ScrollView(this);
        LinearLayout list = vertical();
        list.setPadding(dp(12), dp(4), dp(12), dp(90));
        scroll.addView(list);
        page.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        Runnable render = () -> {
            list.removeAllViews();
            List<YarnRecord> archived = db.searchArchive(search.getQuery().toString());
            TextView count = text("В архиве: " + archived.size(), 14, MUTED, false);
            count.setPadding(dp(4), dp(4), 0, dp(8));
            list.addView(count);

            if (archived.isEmpty()) {
                TextView empty = text(search.getQuery().length() == 0
                        ? "Архив пока пуст."
                        : "В архиве ничего не найдено.", 17, MUTED, false);
                empty.setGravity(Gravity.CENTER);
                empty.setPadding(dp(20), dp(55), dp(20), dp(20));
                list.addView(empty);
                return;
            }

            for (YarnRecord y : archived) list.addView(yarnCard(y, true, 0));
        };

        search.setOnQueryTextListener(new SearchView.OnQueryTextListener() {
            @Override public boolean onQueryTextSubmit(String query) { render.run(); return true; }
            @Override public boolean onQueryTextChange(String newText) { render.run(); return true; }
        });
        render.run();
        setContentView(page);
    }

    private void showGlobalSearch() {
        screen = Screen.GLOBAL_SEARCH;
        LinearLayout page = page();
        page.addView(toolbar("Поиск по базе", v -> showHome()));

        ScrollView scroll = new ScrollView(this);
        LinearLayout content = vertical();
        content.setPadding(dp(12), dp(10), dp(12), dp(36));

        TextView hint = text("Заполните одно или несколько полей. Все заполненные условия применяются одновременно.", 14, MUTED, false);
        hint.setPadding(dp(4), 0, dp(4), dp(8));
        content.addView(hint);

        int caps = InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES;
        EditText sManufacturer = addAutoField(content, "Производитель", "Например: Cariaggi", caps, "manufacturer");
        EditText sName = addAutoField(content, "Артикул/название", "Например: Superlana", caps, "name");
        EditText sShade = addAutoField(content, "Оттенок", "Например: Бордовый", caps, "shade");
        EditText sColor = addAutoField(content, "Цвет", "Например: Красный", caps, "color");
        EditText sComposition = addAutoField(content, "Состав · сырьё", "Например: Меринос", caps, "material");

        LinearLayout actions = horizontal();
        Button find = primaryButton("Найти");
        Button clear = button("Очистить");
        LinearLayout.LayoutParams fp = new LinearLayout.LayoutParams(0, dp(52), 1);
        LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(0, dp(52), 1);
        cp.setMargins(dp(8), 0, 0, 0);
        actions.addView(find, fp);
        actions.addView(clear, cp);
        LinearLayout.LayoutParams ap = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        ap.setMargins(0, dp(10), 0, dp(10));
        content.addView(actions, ap);

        LinearLayout results = vertical();
        content.addView(results);

        Runnable render = () -> {
            String manufacturer = sManufacturer.getText().toString().trim();
            String name = sName.getText().toString().trim();
            String shade = sShade.getText().toString().trim();
            String color = sColor.getText().toString().trim();
            String composition = sComposition.getText().toString().trim();

            results.removeAllViews();
            if (manufacturer.isEmpty() && name.isEmpty() && shade.isEmpty() && color.isEmpty() && composition.isEmpty()) {
                TextView empty = text("Укажите хотя бы один параметр поиска.", 16, MUTED, false);
                empty.setGravity(Gravity.CENTER);
                empty.setPadding(dp(12), dp(36), dp(12), dp(20));
                results.addView(empty);
                return;
            }

            List<YarnRecord> found = db.searchAdvanced(manufacturer, name, color, shade, composition);
            TextView count = text("Найдено: " + found.size(), 14, MUTED, false);
            count.setPadding(dp(4), 0, 0, dp(8));
            results.addView(count);
            if (found.isEmpty()) {
                TextView empty = text("Ничего не найдено.", 17, MUTED, false);
                empty.setGravity(Gravity.CENTER);
                empty.setPadding(dp(20), dp(40), dp(20), dp(20));
                results.addView(empty);
            } else {
                for (YarnRecord y : found) results.addView(yarnCard(y, true, 0));
            }
        };

        find.setOnClickListener(v -> {
            hideKeyboard(find);
            render.run();
        });
        clear.setOnClickListener(v -> {
            sManufacturer.setText("");
            sName.setText("");
            sShade.setText("");
            sColor.setText("");
            sComposition.setText("");
            hideKeyboard(clear);
            results.removeAllViews();
            TextView empty = text("Укажите один или несколько параметров поиска.", 16, MUTED, false);
            empty.setGravity(Gravity.CENTER);
            empty.setPadding(dp(12), dp(36), dp(12), dp(20));
            results.addView(empty);
        });

        TextView initial = text("Укажите один или несколько параметров поиска.", 16, MUTED, false);
        initial.setGravity(Gravity.CENTER);
        initial.setPadding(dp(12), dp(36), dp(12), dp(20));
        results.addView(initial);

        scroll.addView(content);
        page.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(page);
    }

    private void showEditor(long layoutId, long yarnId) {
        screen = Screen.EDIT;
        currentLayoutId = layoutId;
        currentYarnId = yarnId;
        YarnRecord existing = yarnId == 0 ? null : db.getYarn(yarnId);

        LinearLayout page = page();
        String top = existing == null
                ? "Новая пряжа"
                : (existing.archived
                    ? "Архив · #" + existing.internalNumber
                    : (!existing.saved ? "Пряжа · не сохранена" : "Карточка пряжи"));
        page.addView(toolbar(top, v -> backFromEditor()));

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        LinearLayout form = vertical();
        form.setPadding(dp(14), dp(14), dp(14), dp(36));

        TextView note = text("Обязательные поля отмечены *", 14, MUTED, false);
        note.setPadding(dp(2), 0, 0, dp(12));
        form.addView(note);

        int textCaps = InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES;
        fCountry = addAutoField(form, "Страна", "Италия", textCaps, "country");
        if (existing == null) fCountry.setText("Италия");
        fManufacturer = addAutoField(form, "Производитель", "Например: Cariaggi", textCaps, "manufacturer");
        fName = addAutoField(form, "Артикул/название", "Например: Superlana", textCaps, "name");
        fShade = addAutoField(form, "Оттенок", "Например: бордовый", InputType.TYPE_CLASS_TEXT, "shade");
        fShade.addTextChangedListener(new TextWatcher() {
            private boolean changing = false;

            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) { }
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) { }

            @Override
            public void afterTextChanged(Editable text) {
                if (changing || text == null || text.length() == 0) return;
                String current = text.toString();
                String normalized = lowerFirst(current);
                if (!current.equals(normalized)) {
                    changing = true;
                    int cursor = Math.max(0, fShade.getSelectionStart());
                    fShade.setText(normalized);
                    fShade.setSelection(Math.min(cursor, normalized.length()));
                    changing = false;
                }
            }
        });
        fColor = addAutoField(form, "Цвет", "Например: красный", InputType.TYPE_CLASS_TEXT, "color");
        fColor.addTextChangedListener(new TextWatcher() {
            private boolean changing = false;

            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) { }
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) { }

            @Override
            public void afterTextChanged(Editable text) {
                if (changing || text == null || text.length() == 0) return;
                String current = text.toString();
                String normalized = lowerFirst(current);
                if (!current.equals(normalized)) {
                    changing = true;
                    int cursor = Math.max(0, fColor.getSelectionStart());
                    fColor.setText(normalized);
                    fColor.setSelection(Math.min(cursor, normalized.length()));
                    changing = false;
                }
            }
        });

        addCompositionEditor(form, existing == null ? "" : existing.composition);

        EditText[] lengthThread = addInlineFields(
                form,
                "Метраж, м / 100 г *", "280", InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL,
                "Параметры нити", "Например: 1/3/4", textCaps,
                0.44f, 0.56f);
        fLength = lengthThread[0];
        fThread = lengthThread[1];

        EditText[] availabilityPrice = addInlineFields(
                form,
                "Вес / наличие, г *", "400", InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL,
                "Цена, ₽ / 100 г *", "350", InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL,
                0.45f, 0.55f);
        fAvailability = availabilityPrice[0];
        fPrice = availabilityPrice[1];

        bobbinWeightFields.clear();
        bobbinWeightRowViews.clear();
        bobbinWeightLabels.clear();
        bobbinWeightFields.add(fAvailability);
        bobbinWeightContainer = vertical();
        form.addView(bobbinWeightContainer);

        Button bobbinPlus = button("＋");
        bobbinPlus.setTextSize(22);
        GradientDrawable bobbinPlusBg = new GradientDrawable();
        bobbinPlusBg.setColor(SURFACE);
        bobbinPlusBg.setCornerRadius(dp(10));
        bobbinPlusBg.setStroke(dp(1), BORDER);
        bobbinPlus.setBackground(bobbinPlusBg);
        LinearLayout.LayoutParams bobbinPlusParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48));
        bobbinPlusParams.setMargins(0, dp(3), 0, dp(4));
        form.addView(bobbinPlus, bobbinPlusParams);
        bobbinPlus.setOnClickListener(v -> {
            EditText field = addBobbinWeightField("");
            field.requestFocus();
            InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
            if (imm != null) imm.showSoftInput(field, InputMethodManager.SHOW_IMPLICIT);
        });

        fStorage = addAutoField(form, "Место хранения", "Например: Стеллаж 2, ячейка Б4", textCaps, "storage");

        fDescription = addField(form, "Описание", "Свободный текст для товара", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES, 8);
        fDescription.setGravity(Gravity.TOP | Gravity.START);
        fDescription.setPadding(dp(12), dp(10), dp(12), dp(10));
        View.OnFocusChangeListener descriptionFocus = (v, hasFocus) -> {
            if (hasFocus) scheduleDescriptionVisibility(scroll);
        };
        fDescription.setOnFocusChangeListener(descriptionFocus);
        fDescription.setOnClickListener(v -> scheduleDescriptionVisibility(scroll));

        TextView photoLabel = text("Фото товара", 14, TEXT, true);
        photoLabel.setPadding(dp(2), dp(12), 0, dp(6));
        form.addView(photoLabel);

        editorPhotoPreview = new ImageView(this);
        editorPhotoPreview.setScaleType(ImageView.ScaleType.CENTER_CROP);
        editorPhotoPreview.setAdjustViewBounds(true);
        LinearLayout.LayoutParams previewParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(220));
        previewParams.setMargins(0, 0, 0, dp(6));
        form.addView(editorPhotoPreview, previewParams);

        LinearLayout photoActions = horizontal();
        editorPhotoButton = button("Выбрать фото");
        editorDeletePhotoButton = button("Удалить фото");
        LinearLayout.LayoutParams photoButtonParams = new LinearLayout.LayoutParams(0, dp(50), 1);
        LinearLayout.LayoutParams photoDeleteParams = new LinearLayout.LayoutParams(0, dp(50), 1);
        photoDeleteParams.setMargins(dp(8), 0, 0, 0);
        photoActions.addView(editorPhotoButton, photoButtonParams);
        photoActions.addView(editorDeletePhotoButton, photoDeleteParams);
        form.addView(photoActions);

        editorInternalArticle = text("", 15, TEXT, true);
        editorInternalArticle.setPadding(dp(2), dp(12), 0, dp(8));
        form.addView(editorInternalArticle);

        editorPhotoButton.setOnClickListener(v -> startPhotoPickerForEditor(existing));
        editorDeletePhotoButton.setOnClickListener(v -> removeCurrentPhoto(existing));
        updateEditorPhotoViews(existing);

        final int formLeft = dp(14);
        final int formTop = dp(14);
        final int formRight = dp(14);
        final int formBottom = dp(36);
        final int[] lastImeExtra = {0};
        final Runnable[] insetApply = {null};
        scroll.setOnApplyWindowInsetsListener((v, insets) -> {
            int imeExtra = 0;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
                Insets ime = insets.getInsets(WindowInsets.Type.ime());
                if (insets.isVisible(WindowInsets.Type.ime())) {
                    imeExtra = Math.max(0, ime.bottom - bars.bottom);
                }
            }
            if (imeExtra != lastImeExtra[0]) {
                lastImeExtra[0] = imeExtra;
                if (insetApply[0] != null) scroll.removeCallbacks(insetApply[0]);
                insetApply[0] = () -> {
                    form.setPadding(formLeft, formTop, formRight, formBottom + lastImeExtra[0]);
                    if (fDescription != null && fDescription.hasFocus()) ensureDescriptionVisible(scroll);
                };
                scroll.postDelayed(insetApply[0], 120);
            }
            return insets;
        });

        if (existing != null) fillFields(existing);

        Button save = primaryButton("Сохранить");
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(56));
        sp.setMargins(0, dp(12), 0, dp(8));
        form.addView(save, sp);
        save.setOnClickListener(v -> {
            if (!validateEditor()) return;
            YarnRecord r = collect(existing);
            long id = db.saveYarn(r, true);
            currentYarnId = id;
            hideKeyboard(save);
            Toast.makeText(this, "Карточка сохранена", Toast.LENGTH_SHORT).show();
            showEditor(layoutId, id);
        });

        Button copy = button("Скопировать карточку для VK");
        LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        cp.setMargins(0, 0, 0, dp(8));
        form.addView(copy, cp);
        copy.setOnClickListener(v -> {
            if (!validateEditor()) return;
            YarnRecord current = collect(existing);
            if (current.id == 0 || current.internalNumber <= 0) {
                db.saveYarn(current, false);
                currentYarnId = current.id;
                updateEditorPhotoViews(db.getYarn(current.id));
            }
            copyVkText(current);
        });

        if (existing != null) {
            Button duplicate = button("Дублировать");
            LinearLayout.LayoutParams dpv = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
            dpv.setMargins(0, 0, 0, dp(8));
            form.addView(duplicate, dpv);
            duplicate.setOnClickListener(v -> {
                if (!validateEditor()) return;
                YarnRecord current = collect(existing);
                db.saveYarn(current, existing.saved);
                long copyId = db.duplicateYarn(existing.id);
                if (copyId != 0) {
                    Toast.makeText(this, "Создана копия · НЕ СОХРАНЕНА", Toast.LENGTH_SHORT).show();
                    showEditor(layoutId, copyId);
                }
            });

            Button delete = button("Удалить карточку");
            LinearLayout.LayoutParams delp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
            form.addView(delete, delp);
            delete.setOnClickListener(v -> new AlertDialog.Builder(this)
                    .setTitle("Удалить карточку?")
                    .setMessage("Карточка и её локальная фотография будут удалены. Это действие нельзя отменить.")
                    .setNegativeButton("Отмена", null)
                    .setPositiveButton("Удалить", (d, w) -> {
                        boolean wasArchived = existing.archived;
                        db.deleteYarn(existing.id);
                        if (wasArchived) showArchive("");
                        else showLayout(layoutId, "");
                    }).show());
        }

        scroll.addView(form);
        page.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(page);
    }

    private void startPhotoPickerForEditor(YarnRecord existing) {
        YarnRecord current = collect(existing);
        if (current.id == 0 || current.internalNumber <= 0) {
            db.saveYarn(current, false);
            currentYarnId = current.id;
            updateEditorPhotoViews(db.getYarn(current.id));
        } else {
            currentYarnId = current.id;
        }

        pendingPhotoYarnId = currentYarnId;
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P &&
                checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_WRITE_STORAGE);
            return;
        }
        openPhotoPicker();
    }

    private void openPhotoPicker() {
        try {
            Intent intent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                intent = new Intent(MediaStore.ACTION_PICK_IMAGES);
                intent.setType("image/*");
            } else {
                intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("image/*");
            }
            startActivityForResult(intent, REQ_PICK_PHOTO);
        } catch (Exception e) {
            pendingPhotoYarnId = 0;
            Toast.makeText(this, "Не удалось открыть выбор фотографий: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private void startPhotoMigrationIfPossible() {
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P &&
                checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        new Thread(() -> {
            try {
                PhotoStore.migrateExistingPhotos(this, db.getAllYarnsForPhotoMigration());
            } catch (Exception ignored) { }
        }, "photo-storage-migration").start();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQ_WRITE_STORAGE) return;

        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            startPhotoMigrationIfPossible();
            if (pendingPhotoYarnId > 0) openPhotoPicker();
        } else {
            pendingPhotoYarnId = 0;
            Toast.makeText(this,
                    "Без разрешения Android не может сохранить фото в видимую папку Pictures/Моя пряжа",
                    Toast.LENGTH_LONG).show();
        }
    }

    private void removeCurrentPhoto(YarnRecord existing) {
        YarnRecord record = currentYarnId > 0 ? db.getYarn(currentYarnId) : existing;
        if (record == null || !PhotoStore.exists(this, record)) return;

        new AlertDialog.Builder(this)
                .setTitle("Удалить фотографию?")
                .setMessage("Карточка товара останется, будет удалено только локальное фото.")
                .setNegativeButton("Отмена", null)
                .setPositiveButton("Удалить", (d, w) -> {
                    PhotoStore.deletePhoto(this, record);
                    db.setPhotoFile(record.id, "");
                    record.photoFile = "";
                    updateEditorPhotoViews(record);
                })
                .show();
    }

    private void updateEditorPhotoViews(YarnRecord record) {
        YarnRecord current = record;
        if (current == null && currentYarnId > 0) current = db.getYarn(currentYarnId);

        if (editorInternalArticle != null) {
            if (current != null && current.internalNumber > 0) {
                editorInternalArticle.setText("Внутренний артикул: #" + current.internalNumber);
            } else {
                editorInternalArticle.setText("Внутренний артикул будет присвоен при сохранении");
            }
        }

        boolean hasPhoto = current != null && PhotoStore.exists(this, current);
        if (editorPhotoPreview != null) {
            if (hasPhoto) {
                Bitmap bitmap = PhotoStore.loadThumbnail(this, current, dp(900));
                editorPhotoPreview.setImageBitmap(bitmap);
                editorPhotoPreview.setVisibility(View.VISIBLE);
            } else {
                editorPhotoPreview.setImageDrawable(null);
                editorPhotoPreview.setVisibility(View.GONE);
            }
        }
        if (editorPhotoButton != null) editorPhotoButton.setText(hasPhoto ? "Заменить фото" : "Выбрать фото");
        if (editorDeletePhotoButton != null) {
            editorDeletePhotoButton.setVisibility(hasPhoto ? View.VISIBLE : View.GONE);
        }
    }

    private void addCompositionEditor(LinearLayout parent, String composition) {
        compositionRows.clear();

        LinearLayout compositionHeader = horizontal();
        compositionHeader.setGravity(Gravity.CENTER_VERTICAL);
        compositionHeader.setPadding(dp(2), dp(8), 0, dp(5));

        TextView label = text("Состав", 14, TEXT, true);
        compositionHeader.addView(label);

        compositionTotalLabel = text("· 0%", 14, COMPOSITION_BAD, true);
        LinearLayout.LayoutParams totalParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        totalParams.setMargins(dp(6), 0, 0, 0);
        compositionHeader.addView(compositionTotalLabel, totalParams);
        parent.addView(compositionHeader);

        compositionContainer = vertical();
        parent.addView(compositionContainer);

        boolean added = false;
        if (!blank(composition)) {
            Pattern p = Pattern.compile("^\\s*([0-9]+(?:[.,][0-9]+)?)\\s*%\\s*(.+?)\\s*$");
            String[] parts = composition.split(",\\s*");
            for (String part : parts) {
                Matcher m = p.matcher(part);
                if (m.matches()) {
                    addCompositionRow(m.group(1), m.group(2));
                    added = true;
                }
            }
        }
        if (!added) addCompositionRow("", "");

        Button plus = button("＋");
        plus.setTextSize(22);
        GradientDrawable plusBg = new GradientDrawable();
        plusBg.setColor(SURFACE);
        plusBg.setCornerRadius(dp(10));
        plusBg.setStroke(dp(1), BORDER);
        plus.setBackground(plusBg);
        LinearLayout.LayoutParams pp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48));
        pp.setMargins(0, dp(3), 0, dp(4));
        parent.addView(plus, pp);
        plus.setOnClickListener(v -> {
            addCompositionRow("", "");
            CompositionRow last = compositionRows.get(compositionRows.size() - 1);
            last.percent.requestFocus();
            InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
            if (imm != null) imm.showSoftInput(last.percent, InputMethodManager.SHOW_IMPLICIT);
        });
    }

    private void addCompositionRow(String percentValue, String materialValue) {
        CompositionRow row = new CompositionRow();
        row.root = horizontal();
        row.root.setGravity(Gravity.CENTER_VERTICAL);

        LinearLayout percentWrap = horizontal();
        percentWrap.setGravity(Gravity.CENTER_VERTICAL);
        row.percent = input("", InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL, 1);
        if (!blank(percentValue)) row.percent.setText(percentValue);
        percentWrap.addView(row.percent, new LinearLayout.LayoutParams(0, dp(50), 1));
        TextView pct = text("%", 16, TEXT, false);
        pct.setGravity(Gravity.CENTER);
        percentWrap.addView(pct, new LinearLayout.LayoutParams(dp(28), dp(50)));

        LinearLayout.LayoutParams p1 = new LinearLayout.LayoutParams(0, dp(50), 0.34f);
        row.root.addView(percentWrap, p1);

        row.material = autoInput("меринос", InputType.TYPE_CLASS_TEXT, "material");
        if (!blank(materialValue)) row.material.setText(lowerFirst(materialValue));
        LinearLayout.LayoutParams p2 = new LinearLayout.LayoutParams(0, dp(50), 0.66f);
        p2.setMargins(dp(6), 0, 0, 0);
        row.root.addView(row.material, p2);

        row.remove = button("×");
        row.remove.setTextSize(20);
        row.remove.setPadding(0, 0, 0, 0);
        LinearLayout.LayoutParams pr = new LinearLayout.LayoutParams(dp(44), dp(50));
        pr.setMargins(dp(4), 0, 0, 0);
        row.root.addView(row.remove, pr);
        row.remove.setOnClickListener(v -> {
            if (compositionRows.size() <= 1) return;
            compositionContainer.removeView(row.root);
            compositionRows.remove(row);
            refreshCompositionRemoveButtons();
            updateCompositionTotal();
        });

        LinearLayout.LayoutParams rootParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50));
        rootParams.setMargins(0, 0, 0, dp(6));
        compositionContainer.addView(row.root, rootParams);
        compositionRows.add(row);
        row.percent.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) { }
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) { }
            @Override public void afterTextChanged(Editable s) { updateCompositionTotal(); }
        });
        refreshCompositionRemoveButtons();
        updateCompositionTotal();
    }

    private void refreshCompositionRemoveButtons() {
        boolean many = compositionRows.size() > 1;
        for (CompositionRow row : compositionRows) {
            row.remove.setVisibility(many ? View.VISIBLE : View.GONE);
        }
    }

    private void updateCompositionTotal() {
        if (compositionTotalLabel == null) return;

        BigDecimal total = BigDecimal.ZERO;
        for (CompositionRow row : compositionRows) {
            String percentText = s(row.percent).replace(',', '.');
            if (blank(percentText)) continue;
            try {
                total = total.add(new BigDecimal(percentText));
            } catch (NumberFormatException ignored) { }
        }

        String value = total.stripTrailingZeros().toPlainString().replace('.', ',');
        compositionTotalLabel.setText("· " + value + "%");
        compositionTotalLabel.setTextColor(
                total.compareTo(new BigDecimal("100")) == 0 ? COMPOSITION_OK : COMPOSITION_BAD);
    }

    private String collectComposition() {
        StringBuilder b = new StringBuilder();
        for (CompositionRow row : compositionRows) {
            String percent = s(row.percent).replace(',', '.');
            String material = lowerFirst(s(row.material));
            if (blank(percent) || blank(material)) continue;
            if (b.length() > 0) b.append(", ");
            b.append(percent).append("% ").append(material);
        }
        return b.toString();
    }

    private boolean validateEditor() {
        return validateRequiredFields() && validateComposition();
    }

    private boolean validateRequiredFields() {
        if (blank(s(fLength))) {
            showValidationError("Укажите метраж пряжи.", fLength);
            return false;
        }
        if (blank(s(fPrice))) {
            showValidationError("Укажите цену за 100 г.", fPrice);
            return false;
        }
        if (blank(s(fAvailability))) {
            showValidationError("Укажите основной вес / наличие в граммах.", fAvailability);
            return false;
        }
        return true;
    }

    private void showValidationError(String message, EditText target) {
        if (target != null) target.setError("Обязательное поле");

        LinearLayout panel = vertical();
        panel.setPadding(dp(18), dp(16), dp(18), dp(16));

        GradientDrawable bg = new GradientDrawable();
        bg.setColor(VALIDATION_BG);
        bg.setCornerRadius(dp(12));
        bg.setStroke(dp(2), VALIDATION_ACCENT);
        panel.setBackground(bg);

        TextView title = text("Не заполнено обязательное поле", 16, VALIDATION_ACCENT, true);
        title.setPadding(0, 0, 0, dp(8));
        panel.addView(title);

        TextView body = text(message, 15, TEXT, false);
        panel.addView(body);

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setView(panel)
                .setPositiveButton("Понятно", null)
                .create();

        dialog.setOnShowListener(d -> {
            Button button = dialog.getButton(AlertDialog.BUTTON_POSITIVE);
            if (button != null) {
                button.setTextColor(VALIDATION_ACCENT);
                button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
            }
        });
        dialog.setOnDismissListener(d -> {
            if (target != null) {
                target.requestFocus();
                target.post(() -> {
                    InputMethodManager imm =
                            (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
                    if (imm != null) imm.showSoftInput(target, InputMethodManager.SHOW_IMPLICIT);
                });
            }
        });
        dialog.show();
    }

    private boolean validateComposition() {
        BigDecimal total = BigDecimal.ZERO;
        boolean hasComposition = false;

        for (CompositionRow row : compositionRows) {
            String percentText = s(row.percent).replace(',', '.');
            String material = s(row.material);

            if (blank(percentText) && blank(material)) continue;
            hasComposition = true;

            if (blank(percentText)) {
                showValidationError("Укажите процент для каждого компонента состава.", row.percent);
                return false;
            }
            if (blank(material)) {
                showValidationError("Укажите сырьё для каждого процента состава.", row.material);
                return false;
            }

            try {
                BigDecimal value = new BigDecimal(percentText);
                if (value.compareTo(BigDecimal.ZERO) <= 0 || value.compareTo(new BigDecimal("100")) > 0) {
                    showValidationError("Процент каждого компонента должен быть больше 0 и не больше 100.", row.percent);
                    return false;
                }
                total = total.add(value);
            } catch (NumberFormatException e) {
                showValidationError("Проверьте процент в составе.", row.percent);
                return false;
            }
        }

        if (hasComposition && total.compareTo(new BigDecimal("100")) != 0) {
            String value = total.stripTrailingZeros().toPlainString().replace('.', ',');
            showValidationError("Сумма состава сейчас " + value + "%. Должно быть 100%.", null);
            return false;
        }
        return true;
    }

    private EditText[] addInlineFields(
            LinearLayout parent,
            String label1, String hint1, int type1,
            String label2, String hint2, int type2,
            float weight1, float weight2) {
        LinearLayout row = horizontal();
        row.setGravity(Gravity.TOP);

        LinearLayout left = vertical();
        TextView l1 = text(label1, 14, TEXT, true);
        l1.setPadding(dp(2), dp(8), 0, dp(5));
        left.addView(l1);
        EditText e1 = input(hint1, type1, 1);
        left.addView(e1, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));

        LinearLayout right = vertical();
        TextView l2 = text(label2, 14, TEXT, true);
        l2.setPadding(dp(2), dp(8), 0, dp(5));
        right.addView(l2);
        EditText e2 = input(hint2, type2, 1);
        right.addView(e2, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));

        LinearLayout.LayoutParams lp1 = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, weight1);
        LinearLayout.LayoutParams lp2 = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, weight2);
        lp2.setMargins(dp(8), 0, 0, 0);
        row.addView(left, lp1);
        row.addView(right, lp2);

        LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        rp.setMargins(0, 0, 0, dp(4));
        parent.addView(row, rp);
        return new EditText[]{e1, e2};
    }

    private EditText addBobbinWeightField(String value) {
        if (bobbinWeightContainer == null) throw new IllegalStateException("Bobbin weight container is not ready");

        LinearLayout row = horizontal();
        row.setGravity(Gravity.TOP);

        LinearLayout left = vertical();
        TextView label = text("", 14, TEXT, true);
        label.setPadding(dp(2), dp(8), 0, dp(5));
        left.addView(label);

        EditText field = input("400", InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL, 1);
        if (!blank(value)) field.setText(value.trim());
        left.addView(field, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));

        LinearLayout right = vertical();
        right.setPadding(dp(8), dp(35), 0, 0);

        Button remove = button("×");
        remove.setTextSize(24);
        GradientDrawable removeBg = new GradientDrawable();
        removeBg.setColor(SURFACE);
        removeBg.setCornerRadius(dp(10));
        removeBg.setStroke(dp(1), BORDER);
        remove.setBackground(removeBg);
        right.addView(remove, new LinearLayout.LayoutParams(dp(52), dp(52)));

        row.addView(left, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 0.45f));
        row.addView(right, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 0.55f));

        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, 0, 0, dp(4));
        bobbinWeightContainer.addView(row, params);

        bobbinWeightFields.add(field);
        bobbinWeightRowViews.add(row);
        bobbinWeightLabels.add(label);
        refreshBobbinWeightLabels();

        remove.setOnClickListener(v -> {
            field.clearFocus();
            bobbinWeightContainer.removeView(row);
            bobbinWeightFields.remove(field);
            bobbinWeightRowViews.remove(row);
            bobbinWeightLabels.remove(label);
            refreshBobbinWeightLabels();
        });

        return field;
    }

    private void refreshBobbinWeightLabels() {
        for (int i = 0; i < bobbinWeightLabels.size(); i++) {
            bobbinWeightLabels.get(i).setText("Вес бобины " + (i + 2) + ", г");
        }
    }

    private String collectBobbinWeights() {
        StringBuilder out = new StringBuilder();
        for (EditText field : bobbinWeightFields) {
            String value = s(field);
            if (blank(value)) continue;
            if (out.length() > 0) out.append("; ");
            out.append(value.trim());
        }
        return out.toString();
    }

    private void fillBobbinWeights(String availability) {
        if (fAvailability == null) return;

        if (bobbinWeightContainer != null) bobbinWeightContainer.removeAllViews();
        bobbinWeightFields.clear();
        bobbinWeightRowViews.clear();
        bobbinWeightLabels.clear();
        bobbinWeightFields.add(fAvailability);
        fAvailability.setText("");

        if (blank(availability)) return;

        String[] weights = availability.split("\\s*;\\s*");
        if (weights.length > 0) fAvailability.setText(weights[0].trim());
        for (int i = 1; i < weights.length; i++) {
            if (!blank(weights[i])) addBobbinWeightField(weights[i].trim());
        }
    }

    private String formatBobbinWeightsForVk(String availability) {
        if (blank(availability)) return "";
        String[] weights = availability.split("\\s*;\\s*");
        StringBuilder out = new StringBuilder();
        for (String weight : weights) {
            if (blank(weight)) continue;
            if (out.length() > 0) out.append(", ");
            out.append(weight.trim());
        }
        return out.toString();
    }

    private YarnRecord collect(YarnRecord existing) {
        YarnRecord r = new YarnRecord();

        // Для уже существующей карточки всегда берём актуальное состояние из БД.
        // Иначе после выбора/удаления фото первоначальный объект existing остаётся
        // устаревшим и при нажатии "Сохранить" может затереть новое photo_file.
        YarnRecord base = currentYarnId > 0 ? db.getYarn(currentYarnId) : existing;
        if (base == null) base = existing;

        if (base != null) {
            r.id = base.id;
            r.saved = base.saved;
            r.internalNumber = base.internalNumber;
            r.archived = base.archived;
            r.archivedAt = base.archivedAt;
            r.photoFile = base.photoFile;
        }
        r.layoutId = currentLayoutId;
        r.country = s(fCountry);
        r.manufacturer = s(fManufacturer);
        r.name = s(fName);
        r.color = lowerFirst(s(fColor));
        r.shade = lowerFirst(s(fShade));
        r.composition = collectComposition();
        r.lengthPer100 = s(fLength);
        r.threadParams = s(fThread);
        r.availability = collectBobbinWeights();
        r.pricePer100 = s(fPrice);
        r.storageLocation = s(fStorage);
        r.description = s(fDescription);
        return r;
    }

    private void fillFields(YarnRecord r) {
        fCountry.setText(r.country);
        fManufacturer.setText(r.manufacturer);
        fName.setText(r.name);
        fColor.setText(lowerFirst(r.color));
        fShade.setText(lowerFirst(r.shade));
        fLength.setText(r.lengthPer100);
        fThread.setText(r.threadParams);
        fillBobbinWeights(r.availability);
        fPrice.setText(r.pricePer100);
        fStorage.setText(r.storageLocation);
        fDescription.setText(r.description);
    }


    private void scheduleDescriptionVisibility(ScrollView scroll) {
        if (descriptionScrollRunnable != null) scroll.removeCallbacks(descriptionScrollRunnable);
        descriptionScrollRunnable = () -> ensureDescriptionVisible(scroll);
        scroll.postDelayed(descriptionScrollRunnable, 220);
    }

    private void ensureDescriptionVisible(ScrollView scroll) {
        if (fDescription == null || !fDescription.hasFocus()) return;

        android.text.Layout layout = fDescription.getLayout();
        if (layout == null) return;

        int selection = fDescription.getSelectionStart();
        if (selection < 0) selection = 0;
        selection = Math.min(selection, fDescription.getText().length());

        int line = layout.getLineForOffset(selection);
        int localTop = fDescription.getCompoundPaddingTop()
                + layout.getLineTop(line)
                - fDescription.getScrollY();
        int localBottom = fDescription.getCompoundPaddingTop()
                + layout.getLineBottom(line)
                - fDescription.getScrollY();

        android.graphics.Rect cursorRect = new android.graphics.Rect(
                fDescription.getCompoundPaddingLeft(),
                localTop,
                Math.max(fDescription.getCompoundPaddingLeft() + dp(8),
                        fDescription.getWidth() - fDescription.getCompoundPaddingRight()),
                localBottom);

        scroll.offsetDescendantRectToMyCoords(fDescription, cursorRect);

        int margin = dp(18);
        int visibleTop = scroll.getScrollY() + margin;
        int visibleBottom = scroll.getScrollY() + scroll.getHeight() - margin;

        if (cursorRect.bottom > visibleBottom) {
            scroll.scrollBy(0, cursorRect.bottom - visibleBottom + dp(8));
        } else if (cursorRect.top < visibleTop) {
            scroll.scrollBy(0, cursorRect.top - visibleTop - dp(8));
        }
    }

    private void copyVkText(YarnRecord r) {
        String text = buildVkText(r);
        if (text.trim().isEmpty()) {
            Toast.makeText(this, "Карточка пока пустая", Toast.LENGTH_SHORT).show();
            return;
        }
        ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        if (cm != null) {
            cm.setPrimaryClip(ClipData.newPlainText("Карточка пряжи", text));
            Toast.makeText(this, "Описание для VK скопировано", Toast.LENGTH_SHORT).show();
        }
    }

    private String buildVkText(YarnRecord r) {
        StringBuilder b = new StringBuilder();
        b.append("#Манияпряжи\n\n");
        addLine(b, "Страна", r.country);
        addLine(b, "Производитель", r.manufacturer);
        addLine(b, "Артикул/название", r.name);
        addLine(b, "Оттенок", r.shade);
        addLine(b, "Цвет", r.color);
        addLine(b, "Состав", r.composition);
        if (!blank(r.lengthPer100)) {
            b.append("Метраж: ").append(r.lengthPer100.trim()).append(" м / 100 г");
            if (!blank(r.threadParams)) {
                String params = r.threadParams.trim();
                if (params.startsWith("(") && params.endsWith(")") && params.length() > 2) {
                    b.append(" ").append(params);
                } else {
                    b.append(" (").append(params).append(")");
                }
            }
            b.append("\n");
        }
        if (!blank(r.availability)) addLine(b, "Наличие", formatBobbinWeightsForVk(r.availability) + " г");
        if (!blank(r.pricePer100)) addLine(b, "Цена", r.pricePer100.trim() + " ₽ / 100 г");
        if (!blank(r.description)) {
            if (b.length() > 0) b.append("\n");
            b.append(r.description.trim());
        }
        if (r.internalNumber > 0) {
            if (b.length() > 0) b.append("\n\n");
            b.append("#").append(r.internalNumber);
        }
        return b.toString().trim();
    }

    private void addLine(StringBuilder b, String label, String value) {
        if (!blank(value)) b.append(label).append(": ").append(value.trim()).append("\n");
    }

    private EditText addField(LinearLayout parent, String label, String hint, int inputType, int lines) {
        TextView l = text(label, 14, TEXT, true);
        l.setPadding(dp(2), dp(8), 0, dp(5));
        parent.addView(l);
        EditText e = input(hint, inputType, lines);
        if (lines > 1) {
            e.setMinLines(lines);
            e.setMaxLines(Math.max(lines, 12));
        }
        LinearLayout.LayoutParams ep = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, lines == 1 ? dp(52) : ViewGroup.LayoutParams.WRAP_CONTENT);
        ep.setMargins(0, 0, 0, dp(4));
        parent.addView(e, ep);
        return e;
    }

    private EditText addAutoField(LinearLayout parent, String label, String hint, int inputType, String suggestionField) {
        TextView l = text(label, 14, TEXT, true);
        l.setPadding(dp(2), dp(8), 0, dp(5));
        parent.addView(l);
        AutoCompleteTextView e = autoInput(hint, inputType, suggestionField);
        LinearLayout.LayoutParams ep = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        ep.setMargins(0, 0, 0, dp(4));
        parent.addView(e, ep);
        return e;
    }

    private AutoCompleteTextView autoInput(String hint, int type, String suggestionField) {
        AutoCompleteTextView e = new AutoCompleteTextView(this);
        e.setHint(hint);
        e.setTextSize(16);
        e.setTextColor(TEXT);
        e.setHintTextColor(Color.rgb(155, 146, 141));
        e.setInputType(type);
        e.setSingleLine(true);
        configureDoneAction(e);
        e.setPadding(dp(12), 0, dp(12), 0);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(SURFACE);
        bg.setCornerRadius(dp(10));
        bg.setStroke(dp(1), BORDER);
        e.setBackground(bg);
        e.setThreshold(1);
        e.setDropDownHeight(ViewGroup.LayoutParams.WRAP_CONTENT);
        e.setDropDownVerticalOffset(dp(2));

        ArrayAdapter<String> adapter = new ArrayAdapter<>(this,
                android.R.layout.simple_dropdown_item_1line, new ArrayList<>());
        e.setAdapter(adapter);
        e.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) { }
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) { }
            @Override public void afterTextChanged(Editable text) {
                String q = text == null ? "" : text.toString().trim();
                if (q.isEmpty()) {
                    adapter.clear();
                    e.dismissDropDown();
                    return;
                }
                List<String> suggestions = db.getSuggestions(suggestionField, q, 1);
                if (!suggestions.isEmpty() && suggestions.get(0).trim().equalsIgnoreCase(q)) {
                    adapter.clear();
                    adapter.notifyDataSetChanged();
                    e.dismissDropDown();
                    return;
                }

                adapter.clear();
                adapter.addAll(suggestions);
                adapter.notifyDataSetChanged();
                if (!suggestions.isEmpty() && e.hasFocus()) {
                    e.post(() -> {
                        String current = e.getText() == null ? "" : e.getText().toString().trim();
                        String suggestion = adapter.getCount() > 0 && adapter.getItem(0) != null
                                ? adapter.getItem(0).trim()
                                : "";
                        if (!current.isEmpty() && current.equalsIgnoreCase(suggestion)) {
                            e.dismissDropDown();
                        } else if (e.hasFocus() && adapter.getCount() > 0) {
                            e.showDropDown();
                        }
                    });
                } else {
                    e.dismissDropDown();
                }
            }
        });
        e.setOnItemClickListener((parent, view, position, id) -> {
            String value = e.getText() == null ? "" : e.getText().toString();
            if ("color".equals(suggestionField) || "material".equals(suggestionField)) {
                value = lowerFirst(value);
                e.setText(value, false);
            }
            if (!value.isEmpty()) e.setSelection(value.length());
            e.dismissDropDown();
            e.post(e::dismissDropDown);
        });
        return e;
    }

    private LinearLayout toolbar(String title, View.OnClickListener back) {
        LinearLayout bar = horizontal();
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(10), dp(4), dp(12), dp(4));
        bar.setBackgroundColor(PRIMARY);
        if (back != null) {
            Button b = new Button(this);
            b.setText("‹");
            b.setTextSize(30);
            b.setTextColor(Color.WHITE);
            b.setBackgroundColor(Color.TRANSPARENT);
            b.setPadding(0, 0, 0, dp(3));
            b.setOnClickListener(back);
            bar.addView(b, new LinearLayout.LayoutParams(dp(52), dp(56)));
        }
        TextView t = text(title, 20, Color.WHITE, true);
        t.setGravity(Gravity.CENTER_VERTICAL);
        bar.addView(t, new LinearLayout.LayoutParams(0, dp(56), 1));

        Button vk = new Button(this);
        vk.setText("VK");
        vk.setTextSize(15);
        vk.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        vk.setTextColor(Color.WHITE);
        vk.setBackgroundColor(Color.TRANSPARENT);
        vk.setPadding(0, 0, 0, 0);
        vk.setContentDescription("Перейти в VK");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) vk.setTooltipText("Перейти в VK");
        vk.setOnClickListener(v -> launchVk());
        bar.addView(vk, new LinearLayout.LayoutParams(dp(52), dp(56)));

        Button menu = new Button(this);
        menu.setText("⋮");
        menu.setTextSize(28);
        menu.setTextColor(Color.WHITE);
        menu.setBackgroundColor(Color.TRANSPARENT);
        menu.setPadding(0, 0, 0, dp(3));
        menu.setOnClickListener(v -> showDataMenu());
        bar.addView(menu, new LinearLayout.LayoutParams(dp(52), dp(56)));
        return bar;
    }

    private void showDataMenu() {
        android.content.SharedPreferences prefs = getSharedPreferences(OverlayService.PREFS, MODE_PRIVATE);
        boolean overlayEnabled = prefs.getBoolean(OverlayService.PREF_ENABLED, false)
                && android.provider.Settings.canDrawOverlays(this);
        String overlayItem = overlayEnabled
                ? "Кнопка поверх приложений: выключить"
                : "Кнопка поверх приложений: включить";

        new AlertDialog.Builder(this)
                .setTitle("Меню")
                .setItems(new String[]{
                        "Выгрузить всю базу",
                        "Выгрузить выкладку",
                        "Добавить базу",
                        "Добавить выкладку",
                        "Сортировка по номеру",
                        "Хранилище фотографий",
                        overlayItem
                }, (dialog, which) -> {
                    if (which == 0) exportWholeDatabase();
                    else if (which == 1) exportOneLayout();
                    else if (which == 2) requestImport(true);
                    else if (which == 3) requestImport(false);
                    else if (which == 4) showNumberSortDialog();
                    else if (which == 5) showPhotoStorageDialog();
                    else toggleFloatingButton();
                })
                .show();
    }

    private void showPhotoStorageDialog() {
        PhotoStore.StorageStats stats = PhotoStore.getStorageStats(this);
        String message =
                "Папка: " + PhotoStore.publicFolderLabel() +
                "\n\nВсего: " + stats.totalFiles() + " фото · " + formatBytes(stats.totalBytes()) +
                "\n\nАктивные товары: " + stats.activeFiles + " фото · " + formatBytes(stats.activeBytes) +
                "\nАрхив: " + stats.archiveFiles + " фото · " + formatBytes(stats.archiveBytes) +
                "\n\nВнутри Pictures/Моя пряжа активные фото разложены по папкам выкладок, а проданные — в папке Архив." +
                "\n\nУдаление фотографий не удаляет карточки товаров. В карточках просто исчезнет фото.";

        new AlertDialog.Builder(this)
                .setTitle("Хранилище фотографий")
                .setMessage(message)
                .setItems(new String[]{
                        "Очистить фотографии архива",
                        "Удалить все фотографии"
                }, (dialog, which) -> {
                    if (which == 0) confirmClearArchivePhotos();
                    else confirmClearAllPhotos();
                })
                .setNegativeButton("Закрыть", null)
                .show();
    }

    private void confirmClearArchivePhotos() {
        PhotoStore.StorageStats stats = PhotoStore.getStorageStats(this);
        new AlertDialog.Builder(this)
                .setTitle("Очистить фото архива?")
                .setMessage("Будет удалено " + stats.archiveFiles + " фото · " +
                        formatBytes(stats.archiveBytes) +
                        ". Карточки товаров в архиве сохранятся.")
                .setNegativeButton("Отмена", null)
                .setPositiveButton("Удалить", (d, w) -> {
                    PhotoStore.clearArchiveStorage(this);
                    db.clearArchivedPhotoReferences();
                    Toast.makeText(this, "Фотографии архива удалены", Toast.LENGTH_SHORT).show();
                    showPhotoStorageDialog();
                })
                .show();
    }

    private void confirmClearAllPhotos() {
        PhotoStore.StorageStats stats = PhotoStore.getStorageStats(this);
        new AlertDialog.Builder(this)
                .setTitle("Удалить все фотографии?")
                .setMessage("Будет удалено " + stats.totalFiles() + " фото · " +
                        formatBytes(stats.totalBytes()) +
                        ". Все карточки товаров и их данные сохранятся.")
                .setNegativeButton("Отмена", null)
                .setPositiveButton("Удалить все", (d, w) -> {
                    PhotoStore.clearAllStorage(this);
                    db.clearAllPhotoReferences();
                    Toast.makeText(this, "Все фотографии удалены", Toast.LENGTH_SHORT).show();
                    showPhotoStorageDialog();
                })
                .show();
    }

    private String formatBytes(long bytes) {
        if (bytes < 1024L) return bytes + " Б";
        double kb = bytes / 1024.0;
        if (kb < 1024.0) return String.format(new Locale("ru", "RU"), "%.1f КБ", kb);
        double mb = kb / 1024.0;
        if (mb < 1024.0) return String.format(new Locale("ru", "RU"), "%.1f МБ", mb);
        return String.format(new Locale("ru", "RU"), "%.2f ГБ", mb / 1024.0);
    }

    private void showNumberSortDialog() {
        if (screen != Screen.HOME && screen != Screen.LAYOUT) {
            Toast.makeText(this, "Сортировка доступна на экране выкладок и внутри выкладки", Toast.LENGTH_SHORT).show();
            return;
        }

        new AlertDialog.Builder(this)
                .setTitle("Сортировка по номеру")
                .setItems(new String[]{"№1 → №2 → №3", "№3 → №2 → №1"}, (dialog, which) -> {
                    boolean asc = which == 0;
                    android.content.SharedPreferences prefs =
                            getSharedPreferences(OverlayService.PREFS, MODE_PRIVATE);

                    if (screen == Screen.HOME) {
                        prefs.edit().putBoolean("layout_number_sort_asc", asc).apply();
                        showHome();
                    } else {
                        prefs.edit().putBoolean("yarn_number_sort_asc", asc).apply();
                        showLayout(currentLayoutId, "");
                    }
                })
                .show();
    }

    private void launchVk() {
        try {
            Intent intent = getPackageManager().getLaunchIntentForPackage("com.vkontakte.android");
            if (intent == null) {
                Toast.makeText(this, "Приложение VK не найдено", Toast.LENGTH_SHORT).show();
                return;
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
            startActivity(intent);
        } catch (Exception e) {
            Toast.makeText(this, "Не удалось открыть VK", Toast.LENGTH_SHORT).show();
        }
    }

    private void toggleFloatingButton() {
        android.content.SharedPreferences prefs = getSharedPreferences(OverlayService.PREFS, MODE_PRIVATE);
        boolean enabled = prefs.getBoolean(OverlayService.PREF_ENABLED, false);

        if (enabled) {
            prefs.edit()
                    .putBoolean(OverlayService.PREF_ENABLED, false)
                    .putBoolean(OverlayService.PREF_PENDING, false)
                    .apply();
            stopService(new Intent(this, OverlayService.class));
            Toast.makeText(this, "Плавающая кнопка выключена", Toast.LENGTH_SHORT).show();
            return;
        }

        if (!android.provider.Settings.canDrawOverlays(this)) {
            prefs.edit().putBoolean(OverlayService.PREF_PENDING, true).apply();
            try {
                Intent permissionIntent = new Intent(
                        android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:" + getPackageName())
                );
                startActivity(permissionIntent);
            } catch (Exception e) {
                startActivity(new Intent(android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION));
            }
            return;
        }

        prefs.edit().putBoolean(OverlayService.PREF_ENABLED, true).apply();
        startOverlayService();
        Toast.makeText(this, "Плавающая кнопка включена", Toast.LENGTH_SHORT).show();
    }

    private void ensureOverlayServiceIfEnabled() {
        android.content.SharedPreferences prefs = getSharedPreferences(OverlayService.PREFS, MODE_PRIVATE);
        if (prefs.getBoolean(OverlayService.PREF_ENABLED, false)
                && android.provider.Settings.canDrawOverlays(this)) {
            startOverlayService();
        }
    }

    private void startOverlayService() {
        Intent serviceIntent = new Intent(this, OverlayService.class);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent);
            } else {
                startService(serviceIntent);
            }
        } catch (Exception e) {
            getSharedPreferences(OverlayService.PREFS, MODE_PRIVATE)
                    .edit()
                    .putBoolean(OverlayService.PREF_ENABLED, false)
                    .apply();
            Toast.makeText(this, "Не удалось запустить плавающую кнопку", Toast.LENGTH_LONG).show();
        }
    }

    private void exportWholeDatabase() {
        try {
            String json = db.exportDatabaseJson();
            String date = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
            requestCreateJson(json, "yarn-notebook-base-" + date + ".json");
        } catch (Exception e) {
            Toast.makeText(this, "Не удалось подготовить базу: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private void exportOneLayout() {
        if (currentLayoutId > 0 && !blank(db.getLayoutDate(currentLayoutId))) {
            exportLayoutById(currentLayoutId);
            return;
        }
        List<LayoutRecord> layouts = db.getLayouts();
        if (layouts.isEmpty()) {
            Toast.makeText(this, "Нет выкладок для выгрузки", Toast.LENGTH_SHORT).show();
            return;
        }
        String[] labels = new String[layouts.size()];
        for (int i = 0; i < layouts.size(); i++) {
            LayoutRecord r = layouts.get(i);
            labels[i] = formatDate(r.dateIso) + (blank(r.description) ? "" : " · " + r.description);
        }
        new AlertDialog.Builder(this)
                .setTitle("Какую выкладку выгрузить?")
                .setItems(labels, (d, which) -> exportLayoutById(layouts.get(which).id))
                .show();
    }

    private void exportLayoutById(long layoutId) {
        try {
            String dateIso = db.getLayoutDate(layoutId);
            String json = db.exportLayoutJson(layoutId);
            requestCreateJson(json, "yarn-layout-" + dateIso + ".json");
        } catch (Exception e) {
            Toast.makeText(this, "Не удалось подготовить выкладку: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private void requestCreateJson(String json, String fileName) {
        pendingExportJson = json;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, fileName);
        startActivityForResult(intent, REQ_EXPORT_JSON);
    }

    private void requestImport(boolean database) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        startActivityForResult(intent, database ? REQ_IMPORT_DATABASE : REQ_IMPORT_LAYOUT);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == REQ_PICK_PHOTO) {
            try {
                if (resultCode == RESULT_OK && data != null && data.getData() != null && pendingPhotoYarnId > 0) {
                    YarnRecord record = db.getYarn(pendingPhotoYarnId);
                    if (record == null) throw new IOException("Карточка товара не найдена");

                    String fileName = PhotoStore.saveCompressed(this, data.getData(), record);
                    db.setPhotoFile(record.id, fileName);
                    record.photoFile = fileName;
                    updateEditorPhotoViews(record);
                    Toast.makeText(this, "Фотография сохранена", Toast.LENGTH_SHORT).show();
                }
            } catch (Exception e) {
                Toast.makeText(this, "Ошибка фотографии: " + e.getMessage(), Toast.LENGTH_LONG).show();
            } finally {
                pendingPhotoYarnId = 0;
            }
            return;
        }

        if (resultCode != RESULT_OK || data == null || data.getData() == null) return;
        Uri uri = data.getData();
        if (requestCode == REQ_EXPORT_JSON) {
            try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                if (out == null) throw new IOException("Не удалось открыть файл");
                out.write(pendingExportJson.getBytes(StandardCharsets.UTF_8));
                out.flush();
                Toast.makeText(this, "Файл выгружен", Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                Toast.makeText(this, "Ошибка выгрузки: " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
            return;
        }
        if (requestCode == REQ_IMPORT_DATABASE || requestCode == REQ_IMPORT_LAYOUT) {
            try {
                String json = readText(uri);
                boolean expectDatabase = requestCode == REQ_IMPORT_DATABASE;
                DbHelper.ImportResult result = db.importJson(json, expectDatabase ? "database" : "layout");
                Toast.makeText(this,
                        "Добавлено: " + result.layouts + " выкладок, " + result.yarns + " карточек",
                        Toast.LENGTH_LONG).show();
                showHome();
            } catch (Exception e) {
                Toast.makeText(this, "Ошибка добавления данных: " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        }
    }

    private String readText(Uri uri) throws IOException {
        StringBuilder b = new StringBuilder();
        try (InputStream in = getContentResolver().openInputStream(uri)) {
            if (in == null) throw new IOException("Не удалось открыть файл");
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) b.append(line).append('\n');
            }
        }
        return b.toString();
    }

    private LinearLayout page() {
        LinearLayout l = vertical();
        l.setBackgroundColor(BG);
        l.setOnApplyWindowInsetsListener((v, insets) -> {
            int top;
            int bottom;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
                top = bars.top;
                bottom = bars.bottom;
            } else {
                top = insets.getSystemWindowInsetTop();
                bottom = insets.getSystemWindowInsetBottom();
            }
            v.setPadding(0, top, 0, bottom);
            return insets;
        });
        return l;
    }

    private LinearLayout vertical() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return l;
    }

    private LinearLayout horizontal() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.HORIZONTAL);
        return l;
    }

    private LinearLayout card() {
        LinearLayout c = vertical();
        c.setPadding(dp(16), dp(14), dp(16), dp(14));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(SURFACE);
        bg.setCornerRadius(dp(14));
        bg.setStroke(dp(1), BORDER);
        c.setBackground(bg);
        c.setElevation(dp(1));
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        p.setMargins(0, dp(6), 0, dp(6));
        c.setLayoutParams(p);
        return c;
    }

    private TextView text(String value, int sizeSp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(value);
        t.setTextSize(sizeSp);
        t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return t;
    }

    private EditText input(String hint, int type, int lines) {
        EditText e = new EditText(this);
        e.setHint(hint);
        e.setTextSize(16);
        e.setTextColor(TEXT);
        e.setHintTextColor(Color.rgb(155, 146, 141));
        e.setInputType(type);
        e.setSingleLine(lines == 1);
        if (lines == 1) configureDoneAction(e);
        e.setPadding(dp(12), 0, dp(12), 0);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(SURFACE);
        bg.setCornerRadius(dp(10));
        bg.setStroke(dp(1), BORDER);
        e.setBackground(bg);
        return e;
    }

    private Button button(String text) {
        Button b = new Button(this);
        b.setText(text);
        b.setTextSize(14);
        b.setTextColor(TEXT);
        b.setAllCaps(false);
        return b;
    }

    private Button primaryButton(String text) {
        Button b = button(text);
        b.setTextColor(Color.WHITE);
        b.setTextSize(16);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(PRIMARY);
        bg.setCornerRadius(dp(12));
        b.setBackground(bg);
        return b;
    }

    private int dp(int n) {
        return Math.round(n * getResources().getDisplayMetrics().density);
    }

    private String s(EditText e) { return e == null ? "" : e.getText().toString().trim(); }
    private String lowerFirst(String value) {
        if (value == null || value.isEmpty()) return value == null ? "" : value;
        int first = value.offsetByCodePoints(0, 1);
        return value.substring(0, first).toLowerCase(Locale.getDefault()) + value.substring(first);
    }

    private boolean blank(String s) { return s == null || s.trim().isEmpty(); }

    private String displayTitle(YarnRecord y) {
        if (!blank(y.name)) return y.name.trim();
        if (!blank(y.manufacturer)) return y.manufacturer.trim();
        String color = combineColor(y.color, y.shade);
        if (!blank(color)) return color;
        return "Без названия";
    }

    private String combineColor(String color, String shade) {
        if (blank(color)) return blank(shade) ? "" : shade.trim();
        if (blank(shade)) return color.trim();
        return color.trim() + " · " + shade.trim();
    }

    private void addMeta(StringBuilder b, String v) {
        if (blank(v)) return;
        if (b.length() > 0) b.append("  •  ");
        b.append(v.trim());
    }

    private String plural(int n, String one, String few, String many) {
        int n10 = n % 10, n100 = n % 100;
        if (n10 == 1 && n100 != 11) return one;
        if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
        return many;
    }

    private String formatDate(String iso) {
        if (blank(iso)) return "";
        try {
            Date d = new SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(iso);
            return new SimpleDateFormat("dd.MM.yyyy", new Locale("ru", "RU")).format(d);
        } catch (ParseException e) {
            return iso;
        }
    }

    private void configureDoneAction(EditText field) {
        field.setImeOptions(EditorInfo.IME_ACTION_DONE);
        field.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                if (v instanceof AutoCompleteTextView) {
                    ((AutoCompleteTextView) v).dismissDropDown();
                }
                hideKeyboard(v);
                v.clearFocus();
                return true;
            }
            return false;
        });
    }

    private void hideKeyboard(View view) {
        InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
        if (imm != null) imm.hideSoftInputFromWindow(view.getWindowToken(), 0);
    }
}
