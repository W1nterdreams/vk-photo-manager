from pathlib import Path
import xml.etree.ElementTree as ET

main = Path('yarn-notebook-android/app/src/main/java/ru/yarnnotebook/app/MainActivity.java')
src = main.read_text()

old_oncreate = '''    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        db = new DbHelper(this);
        configureWindow();
        registerSystemBackGesture();
        showHome();
    }
'''
new_oncreate = '''    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        db = new DbHelper(this);
        configureWindow();
        registerSystemBackGesture();
        showHome();
        ensureOverlayServiceIfEnabled();
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
'''
if old_oncreate not in src:
    raise SystemExit('onCreate target not found')
src = src.replace(old_oncreate, new_oncreate, 1)

old_menu_button = '        Button menu = new Button(this);\n'
new_menu_button = '''        Button vk = new Button(this);
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
'''
if old_menu_button not in src:
    raise SystemExit('toolbar target not found')
src = src.replace(old_menu_button, new_menu_button, 1)

old_data_menu = '''    private void showDataMenu() {
        new AlertDialog.Builder(this)
                .setTitle("Данные")
                .setItems(new String[]{"Выгрузить всю базу", "Выгрузить выкладку", "Добавить базу", "Добавить выкладку"}, (dialog, which) -> {
                    if (which == 0) exportWholeDatabase();
                    else if (which == 1) exportOneLayout();
                    else if (which == 2) requestImport(true);
                    else requestImport(false);
                })
                .show();
    }
'''
new_data_menu = '''    private void showDataMenu() {
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
                        overlayItem
                }, (dialog, which) -> {
                    if (which == 0) exportWholeDatabase();
                    else if (which == 1) exportOneLayout();
                    else if (which == 2) requestImport(true);
                    else if (which == 3) requestImport(false);
                    else toggleFloatingButton();
                })
                .show();
    }
'''
if old_data_menu not in src:
    raise SystemExit('data menu target not found')
src = src.replace(old_data_menu, new_data_menu, 1)

marker = '    private void exportWholeDatabase() {\n'
helpers = '''    private void launchVk() {
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

'''
if marker not in src:
    raise SystemExit('helper insertion target not found')
src = src.replace(marker, helpers + marker, 1)
main.write_text(src)

manifest = Path('yarn-notebook-android/app/src/main/AndroidManifest.xml')
android_ns = 'http://schemas.android.com/apk/res/android'
ET.register_namespace('android', android_ns)
tree = ET.parse(manifest)
root = tree.getroot()
app = root.find('application')
if app is None:
    raise SystemExit('application tag not found')

app_index = list(root).index(app)

def has_permission(name):
    return any(x.get(f'{{{android_ns}}}name') == name for x in root.findall('uses-permission'))

for perm in [
    'android.permission.SYSTEM_ALERT_WINDOW',
    'android.permission.FOREGROUND_SERVICE',
    'android.permission.FOREGROUND_SERVICE_SPECIAL_USE'
]:
    if not has_permission(perm):
        el = ET.Element('uses-permission')
        el.set(f'{{{android_ns}}}name', perm)
        root.insert(app_index, el)
        app_index += 1

queries = root.find('queries')
if queries is None:
    queries = ET.Element('queries')
    root.insert(app_index, queries)

if not any(x.get(f'{{{android_ns}}}name') == 'com.vkontakte.android' for x in queries.findall('package')):
    pkg = ET.SubElement(queries, 'package')
    pkg.set(f'{{{android_ns}}}name', 'com.vkontakte.android')

service = None
for candidate in app.findall('service'):
    if candidate.get(f'{{{android_ns}}}name') == '.OverlayService':
        service = candidate
        break
if service is None:
    service = ET.SubElement(app, 'service')
service.set(f'{{{android_ns}}}name', '.OverlayService')
service.set(f'{{{android_ns}}}exported', 'false')
service.set(f'{{{android_ns}}}foregroundServiceType', 'specialUse')

prop = None
for candidate in service.findall('property'):
    if candidate.get(f'{{{android_ns}}}name') == 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE':
        prop = candidate
        break
if prop is None:
    prop = ET.SubElement(service, 'property')
prop.set(f'{{{android_ns}}}name', 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE')
prop.set(f'{{{android_ns}}}value', 'user_enabled_floating_shortcut_for_switching_between_yarn_app_and_vk')
tree.write(manifest, encoding='utf-8', xml_declaration=True)

gradle = Path('yarn-notebook-android/app/build.gradle')
txt = gradle.read_text()
if 'versionCode 14' not in txt or "versionName '0.2.13'" not in txt:
    raise SystemExit('expected v0.2.13 version not found')
txt = txt.replace('versionCode 14', 'versionCode 15')
txt = txt.replace("versionName '0.2.13'", "versionName '0.2.14'")
gradle.write_text(txt)
