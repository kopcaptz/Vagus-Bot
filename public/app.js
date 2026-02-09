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
        const newToken = prompt('🔒 Требуется авторизация.\n\nВведите ADMIN_TOKEN:');
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
        const newToken = prompt('🔒 Требуется авторизация.\n\nВведите ADMIN_TOKEN:');
        if (newToken) {
            setAdminToken(newToken);
            headers['X-Admin-Token'] = newToken;
            return fetch(url, { method: 'POST', headers, body: formData });
        }
    }
    return response;
}

// ============================================

// Загрузка статистики
async function loadStats() {
    try {
        const response = await apiFetch('/api/stats');
        const data = await response.json();
        
        let statsHtml = `<p><strong>Статус:</strong> ${data.status}</p>`;
        
        // Telegram статус
        if (data.telegram && data.telegram.enabled) {
            statsHtml += `
                <p><strong>Telegram:</strong> ✅ Подключен</p>
                <p><strong>Бот ID:</strong> ${data.telegram.bot.id}</p>
                <p><strong>Username:</strong> @${data.telegram.bot.username}</p>
                <p><strong>Имя:</strong> ${data.telegram.bot.firstName}</p>
            `;
        } else {
            statsHtml += `
                <p><strong>Telegram:</strong> ❌ Не подключен</p>
                <p><em>${data.telegram?.message || 'Telegram бот не настроен'}</em></p>
            `;
        }
        
        // AI статус
        if (data.ai) {
            if (data.ai.selectedModel && data.ai.selectedModel !== 'none') {
                if (data.ai.config && data.ai.config.hasApiKey) {
                    statsHtml += `
                        <p style="margin-top: 15px;"><strong>AI модель:</strong> ✅ ${data.ai.selectedModel}</p>
                        <p><strong>Провайдер:</strong> ${data.ai.config.provider}</p>
                        <p><strong>Модель:</strong> ${data.ai.config.model}</p>
                    `;
                } else {
                    statsHtml += `
                        <p style="margin-top: 15px;"><strong>AI модель:</strong> ⚠️ ${data.ai.selectedModel}</p>
                        <p style="color: orange;">API ключ не настроен</p>
                    `;
                }
            } else {
                statsHtml += `
                    <p style="margin-top: 15px;"><strong>AI модель:</strong> ❌ Не выбрана</p>
                `;
            }
        }

        if (data.persona && data.persona.selected) {
            statsHtml += `
                <p style="margin-top: 15px;"><strong>🎭 Личность:</strong> ${data.persona.selected}</p>
            `;
        }
        
        // База данных статус
        if (data.database) {
            statsHtml += `
                <p style="margin-top: 15px;"><strong>📊 База данных:</strong></p>
                <p>💬 Сообщений: ${data.database.totalMessages}</p>
                <p>👤 Пользователей: ${data.database.totalUsers}</p>
                <p>📝 Сессий: ${data.database.totalSessions} (активных: ${data.database.activeSessions})</p>
            `;
        }
        
        statsHtml += `<p style="margin-top: 15px;"><strong>Время:</strong> ${new Date(data.timestamp).toLocaleString('ru-RU')}</p>`;
        
        document.getElementById('stats').innerHTML = statsHtml;
    } catch (error) {
        document.getElementById('stats').innerHTML = 
            '<p class="error">Ошибка загрузки статистики</p>';
    }
}

// Отправка сообщения
document.getElementById('sendForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const chatId = document.getElementById('chatId').value;
    const message = document.getElementById('message').value;
    const resultDiv = document.getElementById('result');
    
    resultDiv.innerHTML = '<p>Отправка...</p>';
    
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
            resultDiv.innerHTML = '<p class="success">✅ Сообщение отправлено!</p>';
            document.getElementById('sendForm').reset();
        } else {
            resultDiv.innerHTML = `<p class="error">❌ ${data.error || 'Ошибка отправки сообщения'}</p>`;
        }
    } catch (error) {
        resultDiv.innerHTML = '<p class="error">❌ Ошибка отправки сообщения</p>';
    }
});

// Загрузка информации о моделях
async function loadModels() {
    try {
        const response = await apiFetch('/api/models');
        const data = await response.json();
        
        // Установить выбранную модель в селекторе
        document.getElementById('modelSelect').value = data.selected || 'none';
        
        // Показать информацию о модели
        if (data.config && data.config.hasApiKey) {
            document.getElementById('modelInfo').innerHTML = `
                <p><strong>Текущая модель:</strong> ${data.selected}</p>
                <p><strong>Провайдер:</strong> ${data.config.provider}</p>
                <p><strong>Модель:</strong> ${data.config.model}</p>
                <p style="color: green;">✅ API ключ настроен</p>
            `;
        } else if (data.selected !== 'none') {
            document.getElementById('modelInfo').innerHTML = `
                <p><strong>Текущая модель:</strong> ${data.selected}</p>
                <p style="color: orange;">⚠️ API ключ не настроен. Добавьте ключ в .env файл.</p>
            `;
        } else {
            document.getElementById('modelInfo').innerHTML = `
                <p><strong>Текущая модель:</strong> Без AI</p>
                <p style="color: #666;">AI обработка отключена</p>
            `;
        }
    } catch (error) {
        document.getElementById('modelInfo').innerHTML = 
            '<p class="error">Ошибка загрузки информации о моделях</p>';
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
        status.innerHTML = '<p class="error">❌ Заполните имя и prompt</p>';
        return;
    }

    status.innerHTML = '<p>Сохраняю...</p>';

    try {
        const response = await apiFetch('/api/personas/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, name, prompt, saveAsNew: !!saveAsNew }),
        });
        const data = await response.json();
        if (data.success) {
            status.innerHTML = '<p class="success">✅ Сохранено</p>';
            await loadPersonas();
            if (data.persona?.id) {
                select.value = data.persona.id;
            }
            updatePersonaEditorFields();
        } else {
            status.innerHTML = `<p class="error">❌ ${data.error || 'Ошибка сохранения'}</p>`;
        }
    } catch (error) {
        status.innerHTML = '<p class="error">❌ Ошибка сохранения</p>';
    }
}

async function deletePersona() {
    const select = document.getElementById('personaSelect');
    const status = document.getElementById('personaEditorStatus');
    if (!select || !status) return;

    const id = select.value;
    if (!confirm(`Удалить личность "${id}"?`)) return;

    status.innerHTML = '<p>Удаляю...</p>';

    try {
        const response = await apiFetch(`/api/personas/${encodeURIComponent(id)}`, { method: 'DELETE' });
        const data = await response.json();
        if (data.success) {
            status.innerHTML = '<p class="success">✅ Удалено</p>';
            await loadPersonas();
        } else {
            status.innerHTML = `<p class="error">❌ ${data.error || 'Ошибка удаления'}</p>`;
        }
    } catch (error) {
        status.innerHTML = '<p class="error">❌ Ошибка удаления</p>';
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
            alert(`✅ Личность "${persona}" применена!`);
            loadPersonas();
            loadStats();
        } else {
            alert(`❌ Ошибка: ${data.error}`);
        }
    } catch (error) {
        alert('❌ Ошибка выбора личности');
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
            alert(`✅ Модель "${model}" выбрана!`);
            loadModels();
            loadStats(); // Обновить статистику
        } else {
            alert(`❌ Ошибка: ${data.error}`);
        }
    } catch (error) {
        alert('❌ Ошибка выбора модели');
    }
}

// Тест AI
async function testAI() {
    const message = document.getElementById('testMessage').value;
    const resultDiv = document.getElementById('testResult');
    
    if (!message) {
        resultDiv.innerHTML = '<p class="error">Введите сообщение для теста</p>';
        return;
    }
    
    resultDiv.innerHTML = '<p>Обработка...</p>';
    
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
                    <p><strong>Ответ:</strong> ${data.response}</p>
                    <p style="font-size: 0.9em; color: #666;">Модель: ${data.model} (${data.provider})</p>
                </div>
            `;
        } else {
            resultDiv.innerHTML = `<p class="error">❌ ${data.error}</p>`;
        }
    } catch (error) {
        resultDiv.innerHTML = '<p class="error">❌ Ошибка тестирования AI</p>';
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
        list.innerHTML = '<div class="history-empty">Введите Chat ID для просмотра</div>';
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
    
    list.innerHTML = '<div class="history-empty">Загрузка...</div>';
    pagination.innerHTML = '';
    
    try {
        const response = await apiFetch(`/api/history/${encodeURIComponent(chatId)}?${params.toString()}`);
        const data = await response.json();
        
        if (data.success) {
            renderHistory(data.messages);
            renderPagination(data.total, data.offset, data.limit);
        } else {
            list.innerHTML = `<div class="history-empty error">❌ ${data.error || 'Ошибка загрузки'}</div>`;
        }
    } catch (error) {
        list.innerHTML = '<div class="history-empty error">❌ Ошибка загрузки истории</div>';
    }
}

function renderHistory(messages) {
    const container = document.getElementById('history-list');
    container.innerHTML = '';
    
    if (!messages || messages.length === 0) {
        container.innerHTML = '<div class="history-empty">Сообщений не найдено</div>';
        return;
    }
    
    messages.forEach((msg) => {
        const isBot = Boolean(msg.is_bot);
        const sender = isBot ? '🤖 Бот' : `👤 ${msg.username || 'Пользователь'}`;
        const time = new Date(msg.created_at).toLocaleString('ru-RU');
        const modelInfo = msg.ai_model ? `<div class="history-meta">Модель: ${msg.ai_model}</div>` : '';
        
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
    prevBtn.textContent = '← Назад';
    prevBtn.disabled = offset === 0;
    prevBtn.onclick = () => loadHistory(offset - limit);
    
    const info = document.createElement('span');
    info.textContent = `Стр. ${currentPage} из ${totalPages}`;
    
    const nextBtn = document.createElement('button');
    nextBtn.textContent = 'Вперед →';
    nextBtn.disabled = offset + limit >= total;
    nextBtn.onclick = () => loadHistory(offset + limit);
    
    container.appendChild(prevBtn);
    container.appendChild(info);
    container.appendChild(nextBtn);
}

async function clearCurrentChat() {
    const chatId = document.getElementById('historychatId').value.trim();
    if (!chatId) {
        alert('Введите Chat ID!');
        return;
    }
    if (!confirm('Вы уверены? Это удалит ВСЮ историю этого чата.')) return;
    
    try {
        const response = await apiFetch(`/api/history/${encodeURIComponent(chatId)}`, { method: 'DELETE' });
        const data = await response.json();
        if (data.success) {
            loadHistory(0);
        } else {
            alert(data.error || 'Ошибка очистки');
        }
    } catch (error) {
        alert('Ошибка очистки');
    }
}

function exportHistory() {
    const chatId = document.getElementById('historychatId').value.trim();
    if (!chatId) {
        alert('Введите Chat ID!');
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
                <p><strong>Статус:</strong> ${config.enabled ? '✅ Включена' : '❌ Отключена'}</p>
                <p><strong>Максимум сообщений:</strong> ${config.maxMessages}</p>
                <p><strong>Максимум токенов:</strong> ${config.maxTokens}</p>
                <p><strong>Системный промпт:</strong> ${config.includeSystemPrompt ? '✅ Включен' : '❌ Отключен'}</p>
            `;
            document.getElementById('contextConfig').innerHTML = statusHtml;
        }
    } catch (error) {
        document.getElementById('contextConfig').innerHTML = '<p class="error">Ошибка загрузки настроек контекста</p>';
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
            alert('✅ Настройки контекста сохранены!');
            loadContextConfig();
        } else {
            alert(`❌ Ошибка: ${data.error}`);
        }
    } catch (error) {
        alert('❌ Ошибка сохранения настроек контекста');
    }
}

// Предпросмотр контекста
async function previewContext() {
    const chatId = document.getElementById('contextPreviewChatId').value;
    const previewDiv = document.getElementById('contextPreviewContent');
    
    if (!chatId) {
        previewDiv.innerHTML = '<p class="error">Введите Chat ID</p>';
        return;
    }
    
    previewDiv.innerHTML = '<p>Загрузка...</p>';
    
    try {
        const response = await apiFetch(`/api/context/${chatId}`);
        const data = await response.json();
        
        if (data.success) {
            let previewHtml = `<p><strong>Статистика контекста:</strong></p>`;
            previewHtml += `<p>📊 Сообщений в контексте: ${data.stats.contextMessages}</p>`;
            previewHtml += `<p>💡 Примерное количество токенов: ${data.stats.estimatedTokens}</p>`;
            previewHtml += `<hr style="margin: 15px 0;">`;
            previewHtml += `<p><strong>Сообщения в контексте:</strong></p>`;
            previewHtml += '<div style="max-height: 300px; overflow-y: auto; margin-top: 10px;">';
            
            data.messages.forEach((msg, idx) => {
                const roleEmoji = msg.role === 'system' ? '⚙️' : msg.role === 'assistant' ? '🤖' : '👤';
                const roleName = msg.role === 'system' ? 'Система' : msg.role === 'assistant' ? 'Ассистент' : 'Пользователь';
                
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
            previewDiv.innerHTML = `<p class="error">❌ ${data.error || 'Ошибка загрузки контекста'}</p>`;
        }
    } catch (error) {
        previewDiv.innerHTML = '<p class="error">❌ Ошибка загрузки контекста</p>';
    }
}

// Добавить сообщение в историю
async function addToHistory() {
    const message = document.getElementById('testMessage').value;
    const chatId = document.getElementById('testChatId')?.value?.trim();
    const role = document.getElementById('testRole')?.value || 'user';
    const resultDiv = document.getElementById('testResult');
    
    if (!chatId) {
        resultDiv.innerHTML = '<p class="error">❌ Укажите Chat ID, чтобы сохранить сообщение в историю</p>';
        return;
    }
    
    if (!message) {
        resultDiv.innerHTML = '<p class="error">❌ Введите сообщение для сохранения</p>';
        return;
    }
    
    resultDiv.innerHTML = '<p>Сохраняю сообщение в историю...</p>';
    
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
            resultDiv.innerHTML = `<p class="success">✅ Сообщение добавлено в историю (Chat ID: ${chatId})</p>`;
            
            // Если открыт блок истории или контекста - обновим
            const historyChatId = document.getElementById('historychatId')?.value?.trim();
            if (historyChatId && historyChatId === chatId) {
                loadHistory();
            }
        } else {
            resultDiv.innerHTML = `<p class="error">❌ ${data.error || 'Ошибка сохранения сообщения'}</p>`;
        }
    } catch (error) {
        resultDiv.innerHTML = '<p class="error">❌ Ошибка сохранения сообщения</p>';
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
        resultDiv.innerHTML = '<p class="error">❌ Введите сообщение или выберите изображения</p>';
        return;
    }
    
    // Предупреждение, если Chat ID не указан
    if (!chatId) {
        const confirmUse = confirm('⚠️ Chat ID не указан!\n\nБез Chat ID контекстная память НЕ будет работать.\n\nХотите продолжить без контекста?');
        if (!confirmUse) {
            resultDiv.innerHTML = '<p class="error">❌ Укажите Chat ID для использования контекста</p>';
            return;
        }
    }
    
    resultDiv.innerHTML = '<p>Обработка...</p>';
    
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
                    <p><strong>Ответ:</strong> ${data.response}</p>
                    <p style="font-size: 0.9em; color: #666;">Модель: ${data.model} (${data.provider})</p>
            `;
            
            if (data.tokensUsed) {
                resultHtml += `<p style="font-size: 0.9em; color: #666;">💡 Токенов использовано: ${data.tokensUsed}</p>`;
            }
            
            if (chatId) {
                if (data.contextEnabled) {
                    if (data.contextUsed > 0) {
                        resultHtml += `<p style="font-size: 0.9em; color: #28a745;">📚 ✅ Использован контекст из ${data.contextUsed} сообщений (Chat ID: ${chatId})</p>`;
                        if (data.contextTotal > data.contextUsed) {
                            resultHtml += `<p style="font-size: 0.85em; color: #666;">   Всего в контексте: ${data.contextTotal} (включая системный промпт)</p>`;
                        }
                    } else {
                        resultHtml += `<p style="font-size: 0.9em; color: #ffc107;">⚠️ Контекст включен, но история пуста для Chat ID: ${chatId}</p>`;
                        resultHtml += `<p style="font-size: 0.85em; color: #666;">   Сначала создайте историю сообщений (используйте тестовый скрипт или Telegram бота)</p>`;
                    }
                } else {
                    resultHtml += `<p style="font-size: 0.9em; color: #ffc107;">⚠️ Контекстная память отключена в настройках</p>`;
                }
            } else {
                resultHtml += `<p style="font-size: 0.9em; color: #666;">ℹ️ Контекст не использован (Chat ID не указан)</p>`;
                resultHtml += `<p style="font-size: 0.85em; color: #666;">   Укажите Chat ID для использования контекстной памяти</p>`;
            }
            
            resultHtml += '</div>';
            resultDiv.innerHTML = resultHtml;
        } else {
            resultDiv.innerHTML = `<p class="error">❌ ${data.error}</p>`;
        }
    } catch (error) {
        resultDiv.innerHTML = '<p class="error">❌ Ошибка тестирования AI</p>';
    }
}

// Загрузка статистики при загрузке страницы
loadStats();
loadModels();
loadContextConfig();
loadPersonas();

// Обновлять редактор при смене персоны
const personaSelectEl = document.getElementById('personaSelect');
if (personaSelectEl) {
    personaSelectEl.addEventListener('change', updatePersonaEditorFields);
}
