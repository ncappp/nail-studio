# Pearl · Nail Studio

Telegram Mini App для одного мастера. Единственное приложение находится в [nail-studio/](nail-studio/README.md); корневой package.json предоставляет команды npm workspace.

## Локальный запуск

Нужен Node.js 24 (или 22).

```bash
npm ci
cp nail-studio/.env.example nail-studio/.env
# Заполни серверные переменные в nail-studio/.env
npm run check:config
npm run migrate
npm run dev
```

```bash
npm test
npm run build
npx playwright install chromium --only-shell
npm run test:ui
```

В Vercel сохрани Root Directory: `nail-studio`, Build Command: `npm run build`, Output Directory: `public`. Не меняй Root Directory на корень этого workspace.

Подключение Supabase, Telegram и cron, обновление существующей установки и границы тестов описаны в [инструкции приложения](nail-studio/README.md), [проверках](nail-studio/VERIFICATION.md) и [порядке выпуска](nail-studio/OPERATIONS.md).
