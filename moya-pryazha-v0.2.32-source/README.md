# Моя пряжа — исходный код v0.2.32

Полный снимок Android-проекта **«Моя пряжа» v0.2.32**.

- Исходный репозиторий: [W1nterdreams/yarn-notebook-android](https://github.com/W1nterdreams/yarn-notebook-android)
- Исходный commit: `aa4e62ab7ebe6c1467ef6adbaa40ed29220d13b0`
- `applicationId`: `ru.yarnnotebook.app`
- `versionCode`: `33`
- `versionName`: `0.2.32`

## Состав

Включены исходники Java, AndroidManifest, ресурсы и иконка, Gradle-конфигурация, правила ProGuard, workflow сборки APK и debug-keystore из исходного проекта. Оригинальный README сохранён в `README-upstream.md`.

## Сборка

Требуются JDK 17, Android SDK 36 / Build Tools 36.0.0 и Gradle 9.6.0.

Из корня этой папки выполните:

```bash
gradle --no-daemon :app:assembleDebug
```

Готовый APK появится по пути `app/build/outputs/apk/debug/app-debug.apk`.

В проект включён debug keystore `app/yarn-debug.p12`, как в исходной версии. Он нужен для воспроизведения подписи debug-сборки; **не используйте его для production-релиза**.

## Важно

Это копия именно версии **0.2.32**, а не текущая версия приложения из Android-репозитория. Рабочие файлы в корне репозитория `vk-photo-manager` не изменены.
