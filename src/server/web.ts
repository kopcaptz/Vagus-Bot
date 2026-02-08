import express from 'express';
import { createApiRouter } from './api.js';
import { config } from '../config/config.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createWebServer() {
  const app = express();
  
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '../../public')));
  
  // API routes
  app.use(createApiRouter());
  
  // Главная страница
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/index.html'));
  });

  return app;
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
