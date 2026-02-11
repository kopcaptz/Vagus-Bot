// ============================================
// AUTH: обёртка для всех API-запросов
// ============================================

function getAdminToken() {
    return localStorage.getItem('vagus_admin_token') || '';
}

function setAdminToken(token) {
    localStorage.setItem('vagus_admin_token', token);
}

async function apiFetch(url, options = {}) {
    const token = getAdminToken();
    if (token) {
        options.headers = options.headers || {};
        options.headers['X-Admin-Token'] = token;
    }
    const response = await fetch(url, options);
    if (response.status === 401) {
<<<<<<< HEAD
        let body = {};
        try { body = await response.clone().json(); } catch (_) {}
        if (body.error && body.error.includes('not configured')) {
            alert('🔒 ' + body.error);
            return response;
        }
        const newToken = prompt('🔒 Требуется авторизация.\n\nВведите ADMIN_TOKEN (из .env):');
=======
        const newToken = prompt('🔒 ' + t('msg.authRequired'));
>>>>>>> 4487979 (feat: implement dashboard i18n, model router, and secure skill gateway)
        if (newToken) {
            setAdminToken(newToken);
            options.headers = options.headers || {};
            options.headers['X-Admin-Token'] = newToken;
            return fetch(url, options);
        }
    }
    return response;
}

// Для multipart (FormData) — нельзя ставить Content-Type вручную
async function apiFetchMultipart(url, formData) {
    const token = getAdminToken();
    const headers = {};
    if (token) headers['X-Admin-Token'] = token;
    const response = await fetch(url, { method: 'POST', headers, body: formData });
    if (response.status === 401) {
<<<<<<< HEAD
        let body = {};
        try { body = await response.clone().json(); } catch (_) {}
        if (body.error && body.error.includes('not configured')) {
            alert('🔒 ' + body.error);
            return response;
        }
        const newToken = prompt('🔒 Требуется авторизация.\n\nВведите ADMIN_TOKEN (из .env):');
=======
        const newToken = prompt('🔒 ' + t('msg.authRequired'));
>>>>>>> 4487979 (feat: implement dashboard i18n, model router, and secure skill gateway)
        if (newToken) {
            setAdminToken(newToken);
            headers['X-Admin-Token'] = newToken;
            return fetch(url, { method: 'POST', headers, body: formData });
        }
    }
    return response;
}

// ============================================
<<<<<<< HEAD
// ИСТОЧНИК СИЛЫ (Auth Providers)
// ============================================

let currentAuthProvider = 'openrouter_key';
let providersCache = [];

async function loadProviders() {
    try {
        const response = await apiFetch('/api/auth/providers');
        const data = await response.json();

        providersCache = data.providers || [];
        currentAuthProvider = data.selected || 'openrouter_key';

        renderProviders(data.providers, data.selected);
        updateGoogleSection();
    } catch (error) {
        document.getElementById('providerList').innerHTML = '<p class="error">Ошибка загрузки провайдеров</p>';
    }
}

function renderProviders(providers, selected) {
    const container = document.getElementById('providerList');
    container.innerHTML = '';

    providers.forEach(p => {
        const isActive = p.id === selected;
        const div = document.createElement('div');
        div.className = `provider-option ${isActive ? 'active' : ''}`;
        div.onclick = () => selectProvider(p.id);

        const statusClass = p.status || 'disconnected';
        const statusLabels = {
            connected: 'Подключено',
            expired: 'Истекло',
            needs_reauth: 'Нужна авторизация',
            disconnected: 'Не подключено',
        };

        div.innerHTML = `
            <div class="provider-radio"></div>
            <div class="provider-info">
                <div class="provider-name">${p.name} ${p.isFree ? '<span style="color:#28a745;font-size:0.8em;">БЕСПЛАТНО</span>' : ''}</div>
                <div class="provider-desc">${p.description}</div>
            </div>
            <span class="provider-status ${statusClass}">${statusLabels[statusClass] || statusClass}</span>
        `;
        container.appendChild(div);
    });
}

async function selectProvider(providerId) {
    try {
        // Если Google OAuth не подключён — предложить подключить
        if (providerId === 'google_oauth') {
            const statusResp = await apiFetch('/api/auth/google/status');
            const statusData = await statusResp.json();
            if (statusData.status === 'disconnected') {
                if (statusData.configured) {
                    if (confirm('Google OAuth ещё не подключён. Подключить сейчас?')) {
                        await connectGoogle();
                        return;
                    }
                } else {
                    alert('Google OAuth не настроен. Задайте GOOGLE_OAUTH_CLIENT_ID и GOOGLE_OAUTH_CLIENT_SECRET в .env');
                    return;
                }
                return;
            }
        }

        const response = await apiFetch('/api/auth/provider/select', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: providerId }),
        });

        const data = await response.json();
        if (data.success) {
            currentAuthProvider = providerId;
            await loadProviders();
            await loadModels();
            await loadStats();
        } else {
            alert(`Ошибка: ${data.error}`);
        }
    } catch (error) {
        alert('Ошибка выбора провайдера');
    }
}

async function updateGoogleSection() {
    const section = document.getElementById('googleOAuthSection');
    const statusDiv = document.getElementById('googleStatus');
    const connectBtn = document.getElementById('googleConnectBtn');
    const disconnectBtn = document.getElementById('googleDisconnectBtn');
    const modelSelectDiv = document.getElementById('googleModelSelect');

    try {
        const response = await apiFetch('/api/auth/google/status');
        const data = await response.json();

        section.style.display = 'block';

        if (!data.configured) {
            statusDiv.innerHTML = '<p style="color: #666;">Google OAuth не настроен (нужен GOOGLE_OAUTH_CLIENT_ID/SECRET в .env)</p>';
            connectBtn.style.display = 'none';
            disconnectBtn.style.display = 'none';
            modelSelectDiv.style.display = 'none';
            return;
        }

        const statusColors = {
            connected: '#28a745',
            expired: '#ffc107',
            needs_reauth: '#dc3545',
            disconnected: '#666',
        };
        const statusIcons = {
            connected: '🟢',
            expired: '🟡',
            needs_reauth: '🔴',
            disconnected: '⚪',
        };

        statusDiv.innerHTML = `<p style="color: ${statusColors[data.status] || '#666'};">${statusIcons[data.status] || '⚪'} ${data.message}</p>`;

        if (data.status === 'disconnected' || data.status === 'needs_reauth') {
            connectBtn.style.display = 'block';
            disconnectBtn.style.display = data.status === 'needs_reauth' ? 'block' : 'none';
            modelSelectDiv.style.display = 'none';
        } else {
            connectBtn.style.display = 'none';
            disconnectBtn.style.display = 'block';
            modelSelectDiv.style.display = 'block';
            await loadGoogleModels();
        }
    } catch (error) {
        section.style.display = 'none';
    }
}

async function loadGoogleModels() {
    try {
        const response = await apiFetch('/api/auth/models-catalog?provider=google_oauth');
        const data = await response.json();

        const select = document.getElementById('googleModelDropdown');
        select.innerHTML = '';

        (data.models || []).forEach(m => {
            const option = document.createElement('option');
            option.value = m.id;
            option.textContent = `${m.name} (${m.tier})`;
            select.appendChild(option);
        });

        if (data.recommended) {
            select.value = data.recommended;
        }
    } catch (error) {
        // silently fail
    }
}

async function connectGoogle() {
    try {
        const response = await apiFetch('/api/auth/google/url');
        const data = await response.json();

        if (data.url) {
            // Открыть OAuth в новом окне
            const oauthWindow = window.open(data.url, 'google-oauth', 'width=500,height=700');

            // Слушаем результат
            window.addEventListener('message', async function handler(event) {
                if (event.data?.type === 'google-oauth-result') {
                    window.removeEventListener('message', handler);
                    if (event.data.success) {
                        alert('✅ Google OAuth подключён!');
                        await loadProviders();
                        // Автоматически переключиться на Google OAuth
                        await selectProvider('google_oauth');
                    } else {
                        await loadProviders();
                    }
                }
            });
        } else {
            alert(`Ошибка: ${data.error || 'Не удалось получить URL'}`);
        }
    } catch (error) {
        alert('Ошибка подключения Google OAuth');
    }
}

async function disconnectGoogle() {
    if (!confirm('Отключить Google OAuth? Бот переключится на OpenRouter.')) return;

    try {
        const response = await apiFetch('/api/auth/google/disconnect', { method: 'POST' });
        const data = await response.json();

        if (data.success) {
            alert('🔓 Google OAuth отключён');
            await loadProviders();
            await loadModels();
            await loadStats();
        } else {
            alert(`Ошибка: ${data.error}`);
        }
    } catch (error) {
        alert('Ошибка отключения Google OAuth');
    }
}

async function selectGoogleModel() {
    const select = document.getElementById('googleModelDropdown');
    const model = select.value;

    try {
        const response = await apiFetch('/api/auth/google/model', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model }),
        });

        const data = await response.json();
        if (data.success) {
            alert(`✅ Gemini модель: ${data.name}`);
            await loadStats();
        } else {
            alert(`Ошибка: ${data.error}`);
        }
    } catch (error) {
        alert('Ошибка выбора Gemini модели');
    }
}
=======
// VIEW & i18n
// ============================================

function showView(id) {
    document.querySelectorAll('.view').forEach(v => {
        v.classList.remove('view-active');
    });
    document.querySelectorAll('.nav-link').forEach(a => {
        a.classList.toggle('active', a.dataset.view === id);
    });
    const view = document.getElementById('view-' + id);
    if (view) view.classList.add('view-active');
}

function applyTranslations() {
    document.documentElement.lang = currentLang;
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (key) el.textContent = t(key);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (key) el.placeholder = t(key);
    });
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.lang === currentLang);
    });
    document.title = t('pageTitle');
}

document.addEventListener('DOMContentLoaded', () => {
    applyTranslations();
    document.querySelectorAll('.nav-link').forEach(a => {
        a.addEventListener('click', (e) => {
            e.preventDefault();
            const id = a.dataset.view;
            if (id) showView(id);
        });
    });
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            setLang(btn.dataset.lang);
        });
    });
});
>>>>>>> 4487979 (feat: implement dashboard i18n, model router, and secure skill gateway)

// ============================================

// Загрузка статистики
async function loadStats() {
    try {
        const response = await apiFetch('/api/stats');
        const data = await response.json();
        if (data.error || !response.ok) {
            document.getElementById('stats').innerHTML =
                `<p class="error">${data.error || t('msg.errorStats')}</p>`;
            const hintEl = document.getElementById('telegramSendHint');
            if (hintEl) hintEl.textContent = '⚠️ ' + t('stats.telegramRequired');
            return;
        }
        
        let statsHtml = `<p><strong>${t('stats.status')}:</strong> ${data.status || t('msg.running')}</p>`;
        
        // Telegram статус
        if (data.telegram && data.telegram.enabled) {
            const bot = data.telegram?.bot;
            statsHtml += `
                <p><strong>${t('stats.telegram')}:</strong> ✅ ${t('stats.telegramConnected')}</p>
                ${bot ? `<p><strong>${t('stats.botId')}:</strong> ${bot.id || '-'}</p><p><strong>${t('stats.username')}:</strong> @${bot.username || '-'}</p><p><strong>${t('stats.botName')}:</strong> ${bot.firstName || '-'}</p>` : ''}
            `;
        } else {
            statsHtml += `
                <p><strong>${t('stats.telegram')}:</strong> ❌ ${t('stats.telegramNotConnected')}</p>
                <p><em>${data.telegram?.message || t('stats.telegramNotConfigured')}</em></p>
            `;
        }
        
        // AI статус
        if (data.ai) {
            const providerLabel = data.ai.authProvider === 'google_oauth' ? '⚡ Google OAuth (Gemini)' : '🔑 OpenRouter API Key';
            statsHtml += `<p style="margin-top: 15px;"><strong>Источник силы:</strong> ${providerLabel}</p>`;

            if (data.ai.config) {
                if (data.ai.config.hasApiKey) {
                    statsHtml += `
<<<<<<< HEAD
                        <p><strong>Провайдер:</strong> ${data.ai.config.provider}</p>
                        <p><strong>Модель:</strong> ${data.ai.config.model}</p>
                    `;
                } else {
                    statsHtml += `
                        <p style="color: orange;">⚠️ API ключ / OAuth не настроен</p>
=======
                        <p style="margin-top: 15px;"><strong>${t('stats.aiModel')}:</strong> ✅ ${data.ai.selectedModel}</p>
                        <p><strong>${t('stats.provider')}:</strong> ${data.ai.config.provider}</p>
                        <p><strong>${t('stats.model')}:</strong> ${data.ai.config.model}</p>
                    `;
                } else {
                    statsHtml += `
                        <p style="margin-top: 15px;"><strong>${t('stats.aiModel')}:</strong> ⚠️ ${data.ai.selectedModel}</p>
                        <p style="color: orange;">${t('stats.apiKeyNotConfigured')}</p>
>>>>>>> 4487979 (feat: implement dashboard i18n, model router, and secure skill gateway)
                    `;
                }
            } else {
                statsHtml += `
<<<<<<< HEAD
                    <p><strong>AI модель:</strong> ❌ Не выбрана</p>
=======
                    <p style="margin-top: 15px;"><strong>${t('stats.aiModel')}:</strong> ❌ ${t('stats.aiNotSelected')}</p>
>>>>>>> 4487979 (feat: implement dashboard i18n, model router, and secure skill gateway)
                `;
            }
        }

        if (data.persona && data.persona.selected) {
            statsHtml += `
                <p style="margin-top: 15px;"><strong>🎭 ${t('stats.persona')}:</strong> ${data.persona.selected}</p>
            `;
        }
        
        // Google Drive статус
        if (data.drive) {
            if (data.drive.enabled) {
                statsHtml += `
                    <p style="margin-top: 15px;"><strong>Google Drive:</strong> ${t('stats.driveConnected')}</p>
                    <p><em>${t('stats.driveFolder')}: ${data.drive.root || t('stats.driveRoot')}</em></p>
                `;
            } else {
                statsHtml += `
                    <p style="margin-top: 15px;"><strong>Google Drive:</strong> ${t('stats.driveNotConfigured')}</p>
                    <p><em>${t('stats.driveEnvHint')}</em></p>
                `;
            }
        }
        
        // База данных статус
        if (data.database) {
            statsHtml += `
                <p style="margin-top: 15px;"><strong>📊 ${t('stats.database')}:</strong></p>
                <p>💬 ${t('stats.messages')}: ${data.database.totalMessages}</p>
                <p>👤 ${t('stats.users')}: ${data.database.totalUsers}</p>
                <p>📝 ${t('stats.sessions')}: ${data.database.totalSessions} (${t('stats.activeSessions')}: ${data.database.activeSessions})</p>
            `;
        }
        
        statsHtml += `<p style="margin-top: 15px;"><strong>${t('stats.time')}:</strong> ${new Date(data.timestamp).toLocaleString(currentLang === 'ru' ? 'ru-RU' : 'en-US')}</p>`;
        
        document.getElementById('stats').innerHTML = statsHtml;
        const hintEl = document.getElementById('telegramSendHint');
        if (hintEl) {
            hintEl.textContent = data.telegram?.enabled ? '✅ ' + t('stats.telegramConnectedHint') : '⚠️ ' + t('stats.telegramRequired');
        }
    } catch (error) {
        document.getElementById('stats').innerHTML = 
            '<p class="error">' + t('msg.errorStats') + '</p>';
        const hintEl = document.getElementById('telegramSendHint');
        if (hintEl) hintEl.textContent = '⚠️ ' + t('stats.telegramRequired');
    }
}

// Отправка сообщения
document.getElementById('sendForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const chatId = document.getElementById('chatId').value;
    const message = document.getElementById('message').value;
    const resultDiv = document.getElementById('result');
    
    resultDiv.innerHTML = '<p>' + t('msg.sending') + '</p>';
    
    try {
        const response = await apiFetch('/api/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ chatId, message }),
        });
        
        const data = await response.json();
        
        if (data.success) {
            resultDiv.innerHTML = '<p class="success">✅ ' + t('msg.sent') + '</p>';
            document.getElementById('sendForm').reset();
        } else {
            resultDiv.innerHTML = `<p class="error">❌ ${data.error || t('msg.errorSend')}</p>`;
        }
    } catch (error) {
        resultDiv.innerHTML = '<p class="error">❌ ' + t('msg.errorSend') + '</p>';
    }
});

// Загрузка информации о моделях
async function loadModels() {
    try {
        const response = await apiFetch('/api/models');
        const data = await response.json();
        
        const select = document.getElementById('modelSelect');
        if (select && data.available && Array.isArray(data.available)) {
            select.innerHTML = '';
            data.available.forEach((m) => {
                const opt = document.createElement('option');
                opt.value = m.id;
                opt.textContent = m.name;
                select.appendChild(opt);
            });
        }
        if (select) select.value = data.selected || 'none';
        
        // Показать информацию о модели
        if (data.config && data.config.hasApiKey) {
            document.getElementById('modelInfo').innerHTML = `
                <p><strong>${t('models.currentModel')}:</strong> ${data.selected}</p>
                <p><strong>${t('stats.provider')}:</strong> ${data.config.provider}</p>
                <p><strong>${t('stats.model')}:</strong> ${data.config.model}</p>
                <p style="color: green;">✅ ${t('models.apiKeyOk')}</p>
            `;
        } else if (data.selected !== 'none') {
            document.getElementById('modelInfo').innerHTML = `
                <p><strong>${t('models.currentModel')}:</strong> ${data.selected}</p>
                <p style="color: orange;">⚠️ ${t('models.apiKeyMissing')}</p>
            `;
        } else {
            document.getElementById('modelInfo').innerHTML = `
                <p><strong>${t('models.currentModel')}:</strong> ${t('models.noAi')}</p>
                <p style="color: #666;">${t('models.aiDisabled')}</p>
            `;
        }
    } catch (error) {
        document.getElementById('modelInfo').innerHTML = 
            '<p class="error">' + t('msg.errorModels') + '</p>';
    }
}

let personasCache = [];

// Загрузка списка персон
async function loadPersonas() {
    try {
        const response = await apiFetch('/api/personas');
        const data = await response.json();
        
        const select = document.getElementById('personaSelect');
        if (!select) return;
        
        select.innerHTML = '';
        personasCache = data.available || [];
        personasCache.forEach((p) => {
            const option = document.createElement('option');
            option.value = p.id;
            option.textContent = p.name;
            select.appendChild(option);
        });
        
        select.value = data.selected || 'default';
        updatePersonaEditorFields();
    } catch (error) {
        // silently fail for now
    }
}

function updatePersonaEditorFields() {
    const select = document.getElementById('personaSelect');
    const nameInput = document.getElementById('personaName');
    const promptInput = document.getElementById('personaPrompt');
    if (!select || !nameInput || !promptInput) return;

    const selectedId = select.value;
    const persona = personasCache.find(p => p.id === selectedId);
    if (persona) {
        nameInput.value = persona.name || '';
        promptInput.value = persona.prompt || '';
    } else {
        nameInput.value = '';
        promptInput.value = '';
    }
}

function togglePersonaEditor() {
    const editor = document.getElementById('personaEditor');
    if (!editor) return;
    const isHidden = editor.style.display === 'none' || editor.style.display === '';
    editor.style.display = isHidden ? 'block' : 'none';
    if (isHidden) {
        updatePersonaEditorFields();
    }
}

async function savePersona(saveAsNew) {
    const select = document.getElementById('personaSelect');
    const nameInput = document.getElementById('personaName');
    const promptInput = document.getElementById('personaPrompt');
    const status = document.getElementById('personaEditorStatus');
    if (!select || !nameInput || !promptInput || !status) return;

    const id = select.value;
    const name = nameInput.value.trim();
    const prompt = promptInput.value.trim();

    if (!name || !prompt) {
        status.innerHTML = '<p class="error">❌ ' + t('msg.fillNameAndPrompt') + '</p>';
        return;
    }

    status.innerHTML = '<p>' + t('msg.saving') + '</p>';

    try {
        const response = await apiFetch('/api/personas/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, name, prompt, saveAsNew: !!saveAsNew }),
        });
        const data = await response.json();
        if (data.success) {
            status.innerHTML = '<p class="success">✅ ' + t('msg.saved') + '</p>';
            await loadPersonas();
            if (data.persona?.id) {
                select.value = data.persona.id;
            }
            updatePersonaEditorFields();
        } else {
            status.innerHTML = `<p class="error">❌ ${data.error || t('msg.errorSave')}</p>`;
        }
    } catch (error) {
        status.innerHTML = '<p class="error">❌ ' + t('msg.errorSave') + '</p>';
    }
}

async function deletePersona() {
    const select = document.getElementById('personaSelect');
    const status = document.getElementById('personaEditorStatus');
    if (!select || !status) return;

    const id = select.value;
    if (!confirm(t('msg.deletePersonaConfirm', id))) return;

    status.innerHTML = '<p>' + t('msg.deleting') + '</p>';

    try {
        const response = await apiFetch(`/api/personas/${encodeURIComponent(id)}`, { method: 'DELETE' });
        const data = await response.json();
        if (data.success) {
            status.innerHTML = '<p class="success">✅ ' + t('msg.deleted') + '</p>';
            await loadPersonas();
        } else {
            status.innerHTML = `<p class="error">❌ ${data.error || t('msg.errorDelete')}</p>`;
        }
    } catch (error) {
        status.innerHTML = '<p class="error">❌ ' + t('msg.errorDelete') + '</p>';
    }
}

// Выбор персоны
async function selectPersona() {
    const select = document.getElementById('personaSelect');
    const persona = select.value;
    
    try {
        const response = await apiFetch('/api/personas/select', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ persona }),
        });
        
        const data = await response.json();
        if (data.success) {
            alert('✅ ' + t('msg.personaApplied', persona));
            loadPersonas();
            loadStats();
        } else {
            alert('❌ ' + t('msg.errorWithDetail', data.error));
        }
    } catch (error) {
        alert('❌ ' + t('msg.errorSelectPersona'));
    }
}

// Выбор модели
async function selectModel() {
    const select = document.getElementById('modelSelect');
    const model = select.value;
    
    try {
        const response = await apiFetch('/api/models/select', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ model }),
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert('✅ ' + t('msg.modelSelected', model));
            loadModels();
            loadStats(); // Обновить статистику
        } else {
            alert('❌ ' + t('msg.errorWithDetail', data.error));
        }
    } catch (error) {
        alert('❌ ' + t('msg.errorSelectModel'));
    }
}

// Тест AI
async function testAI() {
    const message = document.getElementById('testMessage').value;
    const resultDiv = document.getElementById('testResult');
    
    if (!message) {
        resultDiv.innerHTML = '<p class="error">' + t('msg.enterMessageForTest') + '</p>';
        return;
    }
    
    resultDiv.innerHTML = '<p>' + t('msg.processing') + '</p>';
    
    try {
        const response = await apiFetch('/api/ai/test', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message }),
        });
        
        const data = await response.json();
        
        if (data.success) {
            resultDiv.innerHTML = `
                <div class="success">
                    <p><strong>${t('msg.response')}</strong> ${data.response}</p>
                    <p style="font-size: 0.9em; color: #666;">${t('msg.modelLabel')}: ${data.model} (${data.provider})</p>
                </div>
            `;
        } else {
            resultDiv.innerHTML = `<p class="error">❌ ${data.error}</p>`;
        }
    } catch (error) {
        resultDiv.innerHTML = '<p class="error">❌ ' + t('msg.errorTest') + '</p>';
    }
}

let currentOffset = 0;
const HISTORY_LIMIT = 20;

// Загрузка истории сообщений (с фильтрами и пагинацией)
async function loadHistory(offset = 0) {
    const chatId = document.getElementById('historychatId').value.trim();
    const list = document.getElementById('history-list');
    const pagination = document.getElementById('history-pagination');
    
    if (!chatId) {
        list.innerHTML = '<div class="history-empty">' + t('msg.enterChatId') + '</div>';
        pagination.innerHTML = '';
        return;
    }
    
    currentOffset = Math.max(0, offset);
    
    const search = document.getElementById('history-search').value.trim();
    const role = document.getElementById('history-role').value;
    
    const params = new URLSearchParams({
        limit: String(HISTORY_LIMIT),
        offset: String(currentOffset),
    });
    if (search) params.set('q', search);
    if (role) params.set('role', role);
    
    list.innerHTML = '<div class="history-empty">' + t('msg.loading') + '</div>';
    pagination.innerHTML = '';
    
    try {
        const response = await apiFetch(`/api/history/${encodeURIComponent(chatId)}?${params.toString()}`);
        const data = await response.json();
        
        if (data.success) {
            renderHistory(data.messages);
            renderPagination(data.total, data.offset, data.limit);
        } else {
            list.innerHTML = `<div class="history-empty error">❌ ${data.error || t('msg.errorLoad')}</div>`;
        }
    } catch (error) {
        list.innerHTML = '<div class="history-empty error">❌ ' + t('msg.errorHistory') + '</div>';
    }
}

function renderHistory(messages) {
    const container = document.getElementById('history-list');
    container.innerHTML = '';
    
    if (!messages || messages.length === 0) {
        container.innerHTML = '<div class="history-empty">' + t('msg.noMessages') + '</div>';
        return;
    }
    
    messages.forEach((msg) => {
        const isBot = Boolean(msg.is_bot);
        const sender = isBot ? '🤖 ' + t('msg.bot') : `👤 ${msg.username || t('msg.user')}`;
        const time = new Date(msg.created_at).toLocaleString(currentLang === 'ru' ? 'ru-RU' : 'en-US');
        const modelInfo = msg.ai_model ? `<div class="history-meta">${t('history.model')} ${msg.ai_model}</div>` : '';
        
        const item = document.createElement('div');
        item.className = `history-item ${isBot ? 'bot' : 'user'}`;
        item.innerHTML = `
            <div class="history-title">${sender}</div>
            <div class="history-text">${msg.message_text}</div>
            <div class="history-meta">${time}</div>
            ${modelInfo}
        `;
        container.appendChild(item);
    });
}

function renderPagination(total, offset, limit) {
    const container = document.getElementById('history-pagination');
    container.innerHTML = '';
    
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const currentPage = Math.floor(offset / limit) + 1;
    
    const prevBtn = document.createElement('button');
    prevBtn.textContent = '← ' + t('history.prev');
    prevBtn.disabled = offset === 0;
    prevBtn.onclick = () => loadHistory(offset - limit);
    
    const info = document.createElement('span');
    info.textContent = `${t('history.page')} ${currentPage} ${t('history.of')} ${totalPages}`;
    
    const nextBtn = document.createElement('button');
    nextBtn.textContent = t('history.next') + ' →';
    nextBtn.disabled = offset + limit >= total;
    nextBtn.onclick = () => loadHistory(offset + limit);
    
    container.appendChild(prevBtn);
    container.appendChild(info);
    container.appendChild(nextBtn);
}

async function clearCurrentChat() {
    const chatId = document.getElementById('historychatId').value.trim();
    if (!chatId) {
        alert(t('msg.enterChatIdForClear'));
        return;
    }
    if (!confirm(t('msg.confirmClear'))) return;
    
    try {
        const response = await apiFetch(`/api/history/${encodeURIComponent(chatId)}`, { method: 'DELETE' });
        const data = await response.json();
        if (data.success) {
            loadHistory(0);
        } else {
            alert(data.error || t('msg.errorClear'));
        }
    } catch (error) {
        alert(t('msg.errorClear'));
    }
}

function exportHistory() {
    const chatId = document.getElementById('historychatId').value.trim();
    if (!chatId) {
        alert(t('msg.enterChatIdForClear'));
        return;
    }
    window.open(`/api/history/${encodeURIComponent(chatId)}?limit=1000`, '_blank');
}

// ============================================
// КОНТЕКСТНАЯ ПАМЯТЬ
// ============================================

// Загрузка настроек контекста
async function loadContextConfig() {
    try {
        const response = await apiFetch('/api/context/config');
        const data = await response.json();
        
        if (data.success) {
            const config = data.config;
            
            // Обновляем UI
            document.getElementById('contextEnabled').checked = config.enabled;
            document.getElementById('contextMaxMessages').value = config.maxMessages;
            document.getElementById('contextMaxTokens').value = config.maxTokens;
            document.getElementById('contextSystemPrompt').checked = config.includeSystemPrompt;
            
            // Показываем статус
            const statusHtml = `
                <p><strong>${t('stats.status')}:</strong> ${config.enabled ? '✅ ' + t('context.statusEnabled') : '❌ ' + t('context.statusDisabled')}</p>
                <p><strong>${t('context.maxMessagesLabel')}</strong> ${config.maxMessages}</p>
                <p><strong>${t('context.maxTokensLabel')}</strong> ${config.maxTokens}</p>
                <p><strong>${t('context.systemPromptLabel')}</strong> ${config.includeSystemPrompt ? '✅ ' + t('context.statusEnabled') : '❌ ' + t('context.statusDisabled')}</p>
            `;
            document.getElementById('contextConfig').innerHTML = statusHtml;
        }
    } catch (error) {
        document.getElementById('contextConfig').innerHTML = '<p class="error">' + t('msg.errorContextConfig') + '</p>';
    }
}

// Сохранение настроек контекста
async function saveContextConfig() {
    const enabled = document.getElementById('contextEnabled').checked;
    const maxMessages = parseInt(document.getElementById('contextMaxMessages').value);
    const maxTokens = parseInt(document.getElementById('contextMaxTokens').value);
    const includeSystemPrompt = document.getElementById('contextSystemPrompt').checked;
    
    try {
        const response = await apiFetch('/api/context/config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                enabled,
                maxMessages,
                maxTokens,
                includeSystemPrompt,
            }),
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert('✅ ' + t('msg.contextSaved'));
            loadContextConfig();
        } else {
            alert('❌ ' + t('msg.errorWithDetail', data.error));
        }
    } catch (error) {
        alert('❌ ' + t('msg.errorContextSave'));
    }
}

// Предпросмотр контекста
async function previewContext() {
    const chatId = document.getElementById('contextPreviewChatId').value;
    const previewDiv = document.getElementById('contextPreviewContent');
    
    if (!chatId) {
        previewDiv.innerHTML = '<p class="error">' + t('msg.enterChatIdForPreview') + '</p>';
        return;
    }
    
    previewDiv.innerHTML = '<p>' + t('msg.loading') + '</p>';
    
    try {
        const response = await apiFetch(`/api/context/${chatId}`);
        const data = await response.json();
        
        if (data.success) {
            let previewHtml = `<p><strong>${t('context.stats')}</strong></p>`;
            previewHtml += `<p>📊 ${t('context.messagesInContext')} ${data.stats.contextMessages}</p>`;
            previewHtml += `<p>💡 ${t('context.estimatedTokens')} ${data.stats.estimatedTokens}</p>`;
            previewHtml += `<hr style="margin: 15px 0;">`;
            previewHtml += `<p><strong>${t('context.messagesInContextLabel')}</strong></p>`;
            previewHtml += '<div style="max-height: 300px; overflow-y: auto; margin-top: 10px;">';
            
            data.messages.forEach((msg, idx) => {
                const roleEmoji = msg.role === 'system' ? '⚙️' : msg.role === 'assistant' ? '🤖' : '👤';
                const roleName = msg.role === 'system' ? t('context.roleSystem') : msg.role === 'assistant' ? t('context.roleAssistant') : t('context.roleUser');
                
                previewHtml += `
                    <div style="background: ${msg.role === 'system' ? '#fff3cd' : msg.role === 'assistant' ? '#e3f2fd' : '#f5f5f5'}; padding: 10px; margin-bottom: 8px; border-radius: 6px; border-left: 3px solid ${msg.role === 'system' ? '#ffc107' : msg.role === 'assistant' ? '#2196F3' : '#757575'};">
                        <div style="font-weight: bold; margin-bottom: 5px;">${roleEmoji} ${roleName}</div>
                        <div style="font-size: 0.9em;">${msg.content.substring(0, 200)}${msg.content.length > 200 ? '...' : ''}</div>
                    </div>
                `;
            });
            
            previewHtml += '</div>';
            previewDiv.innerHTML = previewHtml;
        } else {
            previewDiv.innerHTML = `<p class="error">❌ ${data.error || t('msg.errorContextLoad')}</p>`;
        }
    } catch (error) {
        previewDiv.innerHTML = '<p class="error">❌ ' + t('msg.errorContextLoad') + '</p>';
    }
}

// Добавить сообщение в историю
async function addToHistory() {
    const message = document.getElementById('testMessage').value;
    const chatId = document.getElementById('testChatId')?.value?.trim();
    const role = document.getElementById('testRole')?.value || 'user';
    const resultDiv = document.getElementById('testResult');
    
    if (!chatId) {
        resultDiv.innerHTML = '<p class="error">❌ ' + t('msg.specifyChatId') + '</p>';
        return;
    }
    
    if (!message) {
        resultDiv.innerHTML = '<p class="error">❌ ' + t('msg.enterMessageToSave') + '</p>';
        return;
    }
    
    resultDiv.innerHTML = '<p>' + t('msg.savingToHistory') + '</p>';
    
    try {
        const response = await apiFetch('/api/history/add', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                chatId,
                message,
                role,
            }),
        });
        
        const data = await response.json();
        
        if (data.success) {
            resultDiv.innerHTML = `<p class="success">✅ ${t('msg.addedToHistory')} (Chat ID: ${chatId})</p>`;
            
            // Если открыт блок истории или контекста - обновим
            const historyChatId = document.getElementById('historychatId')?.value?.trim();
            if (historyChatId && historyChatId === chatId) {
                loadHistory();
            }
        } else {
            resultDiv.innerHTML = `<p class="error">❌ ${data.error || t('msg.errorSaveMessage')}</p>`;
        }
    } catch (error) {
        resultDiv.innerHTML = '<p class="error">❌ ' + t('msg.errorSaveMessage') + '</p>';
    }
}

// Обновление теста AI для использования контекста
async function testAI() {
    const message = document.getElementById('testMessage').value;
    const chatId = document.getElementById('testChatId')?.value?.trim() || null;
    const imagesInput = document.getElementById('testImages');
    const imageFiles = imagesInput?.files ? Array.from(imagesInput.files) : [];
    const resultDiv = document.getElementById('testResult');
    
    if (!message && imageFiles.length === 0) {
        resultDiv.innerHTML = '<p class="error">❌ ' + t('msg.enterMessageOrImages') + '</p>';
        return;
    }
    
    // Предупреждение, если Chat ID не указан
    if (!chatId) {
        const confirmUse = confirm('⚠️ ' + t('msg.chatIdNotSpecified') + '\n\n' + t('msg.chatIdWarning'));
        if (!confirmUse) {
            resultDiv.innerHTML = '<p class="error">❌ ' + t('msg.specifyChatIdForContext') + '</p>';
            return;
        }
    }
    
    resultDiv.innerHTML = '<p>' + t('msg.processing') + '</p>';
    
    try {
        let response;
        if (imageFiles.length > 0) {
            const formData = new FormData();
            formData.append('message', message || '');
            if (chatId) formData.append('chatId', chatId);
            imageFiles.slice(0, 5).forEach(f => formData.append('images', f));
            response = await apiFetch('/api/ai/upload', {
                method: 'POST',
                body: formData,
            });
        } else {
            const requestBody = { message };
            if (chatId) requestBody.chatId = chatId;
            response = await apiFetch('/api/ai/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            });
        }
        
        const data = await response.json();
        
        if (data.success) {
            let resultHtml = `
                <div class="success">
                    <p><strong>${t('msg.response')}</strong> ${data.response}</p>
                    <p style="font-size: 0.9em; color: #666;">${t('msg.modelLabel')}: ${data.model} (${data.provider})</p>
            `;
            
            if (data.tokensUsed) {
                resultHtml += `<p style="font-size: 0.9em; color: #666;">💡 ${t('msg.tokensUsed')} ${data.tokensUsed}</p>`;
            }
            
            if (chatId) {
                if (data.contextEnabled) {
                    if (data.contextUsed > 0) {
                        resultHtml += `<p style="font-size: 0.9em; color: #28a745;">📚 ✅ ${t('msg.contextUsed', data.contextUsed)} (Chat ID: ${chatId})</p>`;
                        if (data.contextTotal > data.contextUsed) {
                            resultHtml += `<p style="font-size: 0.85em; color: #666;">   ${t('msg.contextTotal')} ${data.contextTotal}</p>`;
                        }
                    } else {
                        resultHtml += `<p style="font-size: 0.9em; color: #ffc107;">⚠️ ${t('msg.contextEmpty')} (Chat ID: ${chatId})</p>`;
                        resultHtml += `<p style="font-size: 0.85em; color: #666;">   ${t('msg.contextEmptyHint')}</p>`;
                    }
                } else {
                    resultHtml += `<p style="font-size: 0.9em; color: #ffc107;">⚠️ ${t('msg.contextDisabled')}</p>`;
                }
            } else {
                resultHtml += `<p style="font-size: 0.9em; color: #666;">ℹ️ ${t('msg.contextNotUsed')}</p>`;
                resultHtml += `<p style="font-size: 0.85em; color: #666;">   ${t('msg.contextNotUsedHint')}</p>`;
            }
            
            resultHtml += '</div>';
            resultDiv.innerHTML = resultHtml;
        } else {
            resultDiv.innerHTML = `<p class="error">❌ ${data.error}</p>`;
        }
    } catch (error) {
        resultDiv.innerHTML = '<p class="error">❌ ' + t('msg.errorTest') + '</p>';
    }
}

// Загрузка статистики при загрузке страницы
loadStats();
loadProviders();
loadModels();
loadContextConfig();
loadPersonas();

// Обновлять редактор при смене персоны
const personaSelectEl = document.getElementById('personaSelect');
if (personaSelectEl) {
    personaSelectEl.addEventListener('change', updatePersonaEditorFields);
}
