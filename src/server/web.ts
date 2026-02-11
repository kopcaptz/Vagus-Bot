import express from 'express';
import { createApiRouter } from './api.js';
import { config } from '../config/config.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { exchangeCodeForTokens, isGoogleOAuthConfigured } from '../auth/google-oauth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createWebServer() {
  const app = express();
  
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '../../public')));

  // ─── Google OAuth callback (вне auth middleware — Google редиректит сюда) ───
  app.get('/auth/google/callback', async (req, res) => {
    try {
      const code = req.query.code as string;
      const error = req.query.error as string;

      if (error) {
        console.error('❌ Google OAuth error:', error);
        return res.send(buildOAuthResultPage(false, `Google OAuth ошибка: ${error}`));
      }

      if (!code) {
        return res.send(buildOAuthResultPage(false, 'Отсутствует authorization code'));
      }

      if (!isGoogleOAuthConfigured()) {
        return res.send(buildOAuthResultPage(false, 'Google OAuth не настроен на сервере'));
      }

      await exchangeCodeForTokens(code);
      return res.send(buildOAuthResultPage(true, 'Google OAuth подключён! Можете закрыть это окно.'));
    } catch (err) {
      console.error('❌ Google OAuth callback error:', err);
      const msg = err instanceof Error ? err.message : 'Неизвестная ошибка';
      return res.send(buildOAuthResultPage(false, msg));
    }
  });
  
  // API routes
  app.use(createApiRouter());
  
  // Главная страница
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/index.html'));
  });

  return app;
}

/** Страница результата OAuth callback */
function buildOAuthResultPage(success: boolean, message: string): string {
  const emoji = success ? '✅' : '❌';
  const color = success ? '#28a745' : '#dc3545';
  return `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="UTF-8"><title>Google OAuth</title>
<style>
  body { font-family: -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); margin: 0; }
  .card { background: white; border-radius: 16px; padding: 40px; text-align: center; box-shadow: 0 10px 40px rgba(0,0,0,0.2); max-width: 400px; }
  h1 { color: ${color}; margin-bottom: 15px; font-size: 2em; }
  p { color: #333; font-size: 1.1em; line-height: 1.6; }
  .btn { display: inline-block; margin-top: 20px; padding: 12px 30px; background: #667eea; color: white; border: none; border-radius: 8px; font-size: 16px; cursor: pointer; text-decoration: none; }
  .btn:hover { background: #5568d3; }
</style>
</head>
<body>
  <div class="card">
    <h1>${emoji}</h1>
    <p>${message}</p>
    <a class="btn" href="/" onclick="window.close(); return false;">Закрыть</a>
  </div>
  <script>
    // Сообщить родительскому окну о результате
    if (window.opener) {
      window.opener.postMessage({ type: 'google-oauth-result', success: ${success} }, '*');
    }
  </script>
</body>
</html>`;
}

export function startWebServer(): Promise<void> {
  const app = createWebServer();

  return new Promise((resolve) => {
    app.listen(config.server.port, config.server.host, () => {
      console.log(`🌐 Веб-сервер запущен (localhost не отключён):`);
      console.log(`   Локально: http://localhost:${config.server.port}`);
      if (config.server.host === '0.0.0.0') {
        console.log(`   В сети: http://<ваш-ip>:${config.server.port}`);
        console.log(`   💡 HOST=0.0.0.0 — доступ и с этого ПК (localhost), и с других устройств`);
      } else {
        console.log(`   💡 Только с этого ПК (HOST=${config.server.host})`);
      }
      resolve();
    });
  });
}
