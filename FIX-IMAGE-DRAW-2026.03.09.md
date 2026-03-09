# Исправление ошибки редактирования изображений (GPT-5 Image Mini)

**Дата:** 09.03.2026  
**Проблема:** Запросы на редактирование изображений ("нарисуй", "укажи") попадали на анализ в Qwen VL вместо редактирования в GPT-5 Image Mini

---

## Описание проблемы

**Запрос пользователя:**
> Скриншот графика + текст: "Малыш, нарисуй канал на графике и стрелкой укажи, где продать можно."

**Что происходило:**
1. Запрос обрабатывала **Gemma 3 27** (logicModel) через `runLogicModel()`
2. Gemma возвращала `needsDraw: false` (неправильное решение)
3. Запрос уходил в **Qwen3 VL 30B** (visionModel) на анализ
4. Бот возвращал текстовое описание вместо редактирования изображения

**Логи:**
```
[DRAW CHECK] AI решил: needsDraw=false, model=visionModel, prompt="null"
[DEBUG DRAW] ❌ Запрос ушел на анализ в visionModel (Qwen)
```

**Ожидаемое поведение:**
1. Запрос обрабатывается через `checkDrawNeeded()`
2. Найдено ключевое слово "нарисуй" → `needsDraw: true`
3. Запрос уходит в **GPT-5 Image Mini** (drawModel)
4. Бот возвращает отредактированное изображение

---

## Причины проблем

### Проблема 1: Неправильный SDK
Для работы с GPT-5 Image Mini на OpenRouter требуется использование **@openrouter/sdk**, а не стандартного `openai` SDK.

### Проблема 2: Неправильная обработка ответа
GPT-5 Image Mini возвращает изображение в специальном формате (base64 в массиве content), а код пытался прочитать только текст.

### Проблема 3: Отсутствие поддержки image output
Модель может возвращать изображение, но код не обрабатывал этот случай и не отправлял изображение в Telegram.

### Проблема 4: AI-классификатор ошибался
**Gemma 3 27** (logicModel), которая определяла тип обработки, часто возвращала `needsDraw: false` даже для явных запросов на редактирование.

---

## Решение

### 1. Установлен OpenRouter SDK

```bash
npm install @openrouter/sdk --save
```

### 2. Обновлён `src/services/ai.js`

**A. Добавлена инициализация OpenRouter SDK:**
```javascript
const { OpenRouter } = require('@openrouter/sdk');

// В конструкторе:
this.openrouter = config.aiKey ? new OpenRouter({
    apiKey: config.aiKey,
    defaultHeaders: {
      "HTTP-Referer": "https://github.com/Veta-one/sych-bot",
      "X-Title": "Malysh Bot"
    }
}) : null;
```

**B. Улучшен метод `checkDrawNeeded()` — ПРЯМАЯ ПРОВЕРКА ПО КЛЮЧЕВЫМ СЛОВАМ:**
```javascript
async checkDrawNeeded(userMessage, hasImage) {
    // === ПРОВЕРКА ПО КЛЮЧЕВЫМ СЛОВАМ (приоритет) ===
    const drawKeywords = [
        'нарисуй', 'рисовать', 'рисуй',
        'покажи стрелкой', 'покажи линией', 'покажи на графике',
        'отметь', 'отметь на графике', 'отметь на скрине',
        'укажи', 'укажи на графике', 'укажи стрелкой',
        'добавь', 'добавь на график', 'добавь на скрин',
        'проведи', 'проведи линию', 'проведи канал',
        'обведи', 'выдели', 'закрась',
        'отредактируй', 'исправь', 'дополни',
        'стрелка', 'стрелочку', 'линию', 'канал',
        'точку входа', 'точку продажи', 'где продать', 'где купить'
    ];

    const textLower = userMessage.toLowerCase();
    for (const keyword of drawKeywords) {
        if (textLower.includes(keyword)) {
            return {
                needsDraw: true,
                model: "drawModel",
                drawPrompt: `Нарисовать на изображении: ${userMessage}`,
                reason: `Ключевое слово "${keyword}" в запросе`
            };
        }
    }

    // === AI ПРОВЕРКА (если по ключевым словам не ясно) ===
    // ...вызов runLogicModel()
}
```

**Ключевое изменение:** Теперь сначала проверяется наличие ключевых слов в запросе, и только если их нет — используется AI для классификации.

**C. Обновлён метод `handleImageDraw()`:**
- Вызов через `this.openrouter.chat.send()` вместо `openai.chat.completions.create()`
- Добавлен параметр `modalities: ["text", "image"]` для запроса изображения
- Добавлена поддержка параметра `max_completion_tokens: 400000`
- Реализована обработка ответа с изображением:
  - Проверка `message.content` на наличие частей типа `image`
  - Проверка `message.output` для Responses API формата
  - Извлечение base64 из URL формата `data:image/...;base64,...`
  - Возврат объекта `{ type: 'image', image: Buffer, caption: string }`

**D. Добавлено подробное логирование в `getResponse()`:**
```javascript
if (hasImage) {
    console.log(`[DEBUG DRAW] Изображение есть, проверяем тип обработки...`);
    console.log(`[DEBUG DRAW] Текст запроса: "${currentMessage.text}"`);
}

const drawDecision = hasImage ? await this.checkDrawNeeded(...) : {...};

if (hasImage) {
    console.log(`[DEBUG DRAW] Решение AI: needsDraw=${drawDecision.needsDraw}, model=${drawDecision.model}`);
}

if (drawDecision.needsDraw && drawDecision.model === "drawModel") {
    console.log(`[DEBUG DRAW] ✅ Передаем запрос в handleImageDraw (GPT-5 Image Mini)`);
    return this.handleImageDraw(...);
} else if (hasImage) {
    console.log(`[DEBUG DRAW] ❌ Запрос ушел на анализ в visionModel (Qwen)`);
}
```

**E. Добавлен fallback метод `analyzeImageWithDescription()`:**
- Использует `visionModel` (Qwen) если GPT-5 Image Mini не сработала
- Возвращает текстовое описание того, что нужно сделать с изображением

### 3. Обновлён `src/core/logic.js`

**Добавлена обработка изображения в ответе:**
```javascript
// Проверяем, не вернулось ли изображение (результат редактирования)
if (aiResponse && typeof aiResponse === 'object' && aiResponse.type === 'image') {
    // Это изображение от GPT-5 Image Mini
    console.log(`[DRAW] Отправляем отредактированное изображение`);
    
    try {
        stopTyping();
        
        // Отправляем изображение
        await bot.sendPhoto(chatId, aiResponse.image, {
            caption: aiResponse.caption || '',
            parse_mode: 'Markdown',
            ...getReplyOptions(msg)
        });
        
        addToHistory(chatId, "Малыш", aiResponse.caption || '[Отредактированное изображение]');
        return; // Выходим, не отправляем текст
        
    } catch (e) {
        console.error(`[DRAW SEND ERROR] ${e.message}`);
        // Если не удалось отправить изображение, пробуем текстовый fallback
        aiResponse = aiResponse.caption || "Извините, не удалось отправить изображение.";
    }
}
```

### 4. Восстановлена модель в `src/config.js`

```javascript
// 5. РИСОВАЛЬНАЯ (Редактирование скриншотов) - GPT-5 Image Mini ($2.5/1M in, $2/1M out)
// Поддерживает нативное редактирование изображений через OpenRouter API
drawModel: 'openai/gpt-5-image-mini',
```

---

## Архитектура работы с изображениями

```
┌─────────────────────────────────────────────────────────────┐
│                    ЗАПРОС НА РЕДАКТИРОВАНИЕ                  │
│         Скрин + "Нарисуй канал и укажи точку входа"         │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              checkDrawNeeded() — ПРЯМАЯ ПРОВЕРКА            │
│  1. Проверка по ключевым словам (приоритет)                 │
│  2. Если найдено "нарисуй", "укажи" → needsDraw=true        │
│  3. Если не найдено → AI классификация (Gemma 3 27)         │
└─────────────────────────────────────────────────────────────┘
                            ↓
                    ┌───────────────┐
                    │ needsDraw?    │
                    └───────────────┘
                     ↓              ↓
                   ДА              НЕТ
                    ↓                ↓
    ┌───────────────────────┐  ┌──────────────────────────┐
    │ handleImageDraw()     │  │ getResponse() через      │
    │ GPT-5 Image Mini      │  │ visionModel (Qwen)       │
    │ OpenRouter SDK        │  │ (текстовый анализ)       │
    │ modalities: ["text",  │  └──────────────────────────┘
    │        "image"]       │
    └───────────────────────┘
                    ↓
    ┌───────────────────────────────────────────────────────┐
    │  Обработка ответа: message.content = [image, text]    │
    │  Извлечение base64 из data:image/...;base64,...       │
    │  Возврат { type: 'image', image: Buffer, caption }    │
    └───────────────────────────────────────────────────────┘
                    ↓
    ┌───────────────────────────────────────────────────────┐
    │          logic.js: обработка ответа                   │
    │  • Если aiResponse.type === 'image' → sendPhoto()     │
    │  • Иначе → sendMessage() с текстом                    │
    └───────────────────────────────────────────────────────┘
```

---

## Формат запроса к GPT-5 Image Mini

```javascript
const messages = [{
    role: "user",
    content: [
        { 
            type: "text", 
            text: "Нарисуй канал на графике и стрелкой укажи точку для продажи."
        },
        { 
            type: "image_url", 
            image_url: { 
                url: `data:image/png;base64,{BASE64_IMAGE}`,
                detail: "high"  // Максимальное качество анализа
            } 
        }
    ]
}];

const completion = await this.openrouter.chat.send({
    model: "openai/gpt-5-image-mini",
    messages: messages,
    max_tokens: 4000,
    max_completion_tokens: 400000,  // Важно для GPT-5 Image Mini
    temperature: 0.7,
    modalities: ["text", "image"],  // Запрашиваем изображение в ответе
});

// Обработка ответа
const message = completion.choices[0].message;
let imageResult = null;

if (Array.isArray(message.content)) {
    for (const part of message.content) {
        if (part.type === 'image') {
            imageResult = part.image_url?.url || part.image?.url;
        }
    }
}

if (imageResult) {
    // Извлекаем base64: data:image/png;base64,ABC123... → ABC123...
    const base64Match = imageResult.match(/data:image\/[a-z]+;base64,(.+)/);
    const cleanBase64 = base64Match ? base64Match[1] : imageResult;
    
    // Возвращаем Buffer для отправки в Telegram
    return {
        type: 'image',
        image: Buffer.from(cleanBase64, 'base64'),
        caption: "Готово!"
    };
}
```

---

## Ключевые слова для редактирования

Полный список ключевых слов, которые триггерят `drawModel`:

| Категория | Ключевые слова |
|-----------|----------------|
| Рисование | 'нарисуй', 'рисовать', 'рисуй' |
| Показать | 'покажи стрелкой', 'покажи линией', 'покажи на графике' |
| Отметить | 'отметь', 'отметь на графике', 'отметь на скрине' |
| Указать | 'укажи', 'укажи на графике', 'укажи стрелкой' |
| Добавить | 'добавь', 'добавь на график', 'добавь на скрин' |
| Провести | 'проведи', 'проведи линию', 'проведи канал' |
| Выделить | 'обведи', 'выдели', 'закрась' |
| Редактировать | 'отредактируй', 'исправь', 'дополни' |
| Элементы | 'стрелка', 'стрелочку', 'линию', 'канал' |
| Точки | 'точку входа', 'точку продажи', 'где продать', 'где купить' |

---

## Ожидаемые логи после исправления

**Для запроса "Нарисуй канал на графике и стрелкой укажи, где продать":**

```
[MEDIA] Фото скачано
[DEBUG AI] getResponse вызван.
[DEBUG DRAW] Изображение есть, проверяем тип обработки...
[DEBUG DRAW] Текст запроса: "Малыш, нарисуй канал на графике и стрелкой укажи, где продать можно."
[DRAW CHECK] Найдено ключевое слово "нарисуй" → drawModel
[DEBUG DRAW] Решение AI: needsDraw=true, model=drawModel, drawPrompt="Нарисовать на изображении: ..."
[DEBUG DRAW] ✅ Передаем запрос в handleImageDraw (GPT-5 Image Mini)
[DRAW HANDLER] Обработка запроса на редактирование: "..."
[DRAW HANDLER] Response structure: ["content", ...]
[DRAW HANDLER] Получено изображение от модели!
[DRAW] Отправляем отредактированное изображение
```

---

## Файлы изменены

| Файл | Изменения |
|------|-----------|
| `package.json` | Добавлен `@openrouter/sdk` |
| `src/services/ai.js` | Импорт OpenRouter, инициализация, checkDrawNeeded() с проверкой ключевых слов, handleImageDraw(), analyzeImageWithDescription(), логирование |
| `src/core/logic.js` | Обработка aiResponse.type === 'image', отправка через bot.sendPhoto() |
| `src/config.js` | Восстановлена модель `openai/gpt-5-image-mini` |

---

## Перезапуск бота

```bash
cd /home/ubuntu/1.2.2
pm2 restart malish
```

---

## Мониторинг

Следить за логами после исправления:
```bash
pm2 logs malish --lines 50 | grep -E "DRAW CHECK|DEBUG DRAW|DRAW HANDLER"
```

Ожидаемые логи при успешной обработке:
```
[DRAW CHECK] Найдено ключевое слово "нарисуй" → drawModel
[DEBUG DRAW] ✅ Передаем запрос в handleImageDraw (GPT-5 Image Mini)
[DRAW HANDLER] Получено изображение от модели!
[DRAW] Отправляем отредактированное изображение
```

---

## Примечания

1. **Прямая проверка ключевых слов** — приоритетный метод определения необходимости редактирования
2. **AI классификация** — используется только если ключевые слова не найдены
3. **OpenRouter SDK** обеспечивает правильную работу с мультимодальными моделями
4. **modalities: ["text", "image"]** критичен для получения изображения в ответе
5. **max_completion_tokens: 400000** требуется для GPT-5 Image Mini
6. **detail: "high"** улучшает качество анализа изображений
7. При неудаче используется fallback на `visionModel` (Qwen) с текстовым описанием

---

## Ссылки

- [OpenRouter API Reference](https://openrouter.ai/docs/api/reference/overview)
- [OpenRouter OpenAI SDK Guide](https://openrouter.ai/docs/guides/community/openai-sdk)
- [GPT-5 Image Mini на OpenRouter](https://openrouter.ai/openai/gpt-5-image-mini)
- [OpenAPI Specification](https://openrouter.ai/openapi.json)
