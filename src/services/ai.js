const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");
const config = require('../config');
const prompts = require('../core/prompts');
const axios = require('axios');
const OpenAI = require('openai');
const { tavily } = require('@tavily/core'); // Клиент Tavily
const storage = require('./storage');
const quotesService = require('./quotesService');

class AiService {
  constructor() {
    // 1. Инициализация OpenAI-совместимого клиента (OpenRouter / Mistral / DeepSeek)
    this.openai = config.aiKey ? new OpenAI({
        baseURL: config.aiBaseUrl,
        apiKey: config.aiKey,
        defaultHeaders: {
          "HTTP-Referer": "https://github.com/Veta-one/sych-bot",
          "X-Title": "Malysh Bot"
        }
    }) : null;

    // 2. Инициализация Tavily
    this.tavilyClient = config.tavilyKey ? tavily({ apiKey: config.tavilyKey }) : null;

    // 3. Google Native (Fallback)
    this.keyIndex = 0;
    this.keys = config.geminiKeys;
    this.usingFallback = false;
    this.bot = null;

    // === СТАТИСТИКА (теперь персистентная через storage) ===
    storage.initGoogleStats(this.keys.length);

    if (this.keys.length === 0) console.warn("WARNING: Нет ключей Gemini в .env! Fallback не сработает.");
    this.initNativeModel();
  }

  setBot(botInstance) {
    this.bot = botInstance;
  }

  notifyAdmin(message) {
    if (this.bot && config.adminId) {
        this.bot.sendMessage(config.adminId, message, { parse_mode: 'Markdown' }).catch(() => {});
    }
  }

  // Сброс статистики в полночь (проверка через storage)
  resetStatsIfNeeded() {
    const wasReset = storage.resetStatsIfNeeded();
    if (wasReset && this.usingFallback) {
      this.usingFallback = false;
      this.keyIndex = 0;
      this.initNativeModel();
      this.notifyAdmin("🌙 **Новый день!**\nЛимиты сброшены. Возврат в основной режим.");
    }
  }

  getStatsReport() {
    this.resetStatsIfNeeded();
    const { today, week, month, allTime } = storage.getFullStats();
    const mode = this.usingFallback ? "⚠️ FALLBACK" : "⚡️ API";

    // Форматирование даты (31.01)
    const dateStr = today.date ? today.date.split('-').reverse().slice(0, 2).join('.') : '--';

    // Сегодня — подробно
    const googleRows = (today.google || []).map((s, i) =>
      `${i + 1}: ${s.status ? "🟢" : "🔴"} ${s.count}`
    ).join('\n');

    const todaySection = [
      `Сегодня ${dateStr}:`,
      `Режим: ${mode}`,
      ``,
      `• API`,
      `Smart: ${today.smart}`,
      `Logic: ${today.logic}`,
      `Search: ${today.search}`,
      `Voice: ${today.voice}`,
      ``,
      `• Google Native:`,
      googleRows
    ].join('\n');

    // Неделя, месяц, всё время — кратко
    const weekSection = `Неделя: API ${week.smart + week.logic} | Google ${week.google} | Поиск ${week.search} | Voice ${week.voice}`;
    const monthSection = `Месяц: API ${month.smart + month.logic} | Google ${month.google} | Поиск ${month.search} | Voice ${month.voice}`;

    const allTimeTotal = allTime.smart + allTime.logic + allTime.search + allTime.voice + allTime.google;
    const allTimeSection = `Всего: ${this._formatNumber(allTimeTotal)} запросов`;

    return `${todaySection}\n\n${weekSection}\n${monthSection}\n${allTimeSection}`;
  }

  _formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return String(num);
  }

  initNativeModel() {
    if (this.keys.length === 0) return;
    const currentKey = this.keys[this.keyIndex];
    const genAI = new GoogleGenerativeAI(currentKey);
    
    const safetySettings = [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    ];

    // Используем Fallback модель или стандартную Flash (она доступна в нативе)
    const modelName = this.usingFallback ? config.fallbackModelName : config.googleNativeModel;
    console.log(`[AI INIT] Native Key #${this.keyIndex + 1} | Model: ${modelName}`);

    this.nativeModel = genAI.getGenerativeModel({ 
        model: modelName,
        systemInstruction: prompts.system(),
        safetySettings: safetySettings,
        // Включаем нативный поиск Google (Tools)
        tools: [{ googleSearch: {} }] 
    });
  }

  rotateNativeKey() {
    storage.markGoogleKeyExhausted(this.keyIndex);

    console.log(`[AI WARNING] Native Key #${this.keyIndex + 1} исчерпан.`);
    this.keyIndex++;

    if (this.keyIndex >= this.keys.length) {
        this.keyIndex = 0;
        console.error("☠️ Все нативные ключи исчерпаны.");
        this.notifyAdmin("⚠️ **Внимание!** Все Google ключи исчерпаны.");
    }
    this.initNativeModel();
  }

  async executeNativeWithRetry(apiCallFn) {
    const maxAttempts = this.keys.length * 2;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            storage.incrementGoogleStat(this.keyIndex);
            return await apiCallFn();
        } catch (error) {
            const isQuotaError = error.message.includes('429') || error.message.includes('Quota') || error.message.includes('403');
            if (isQuotaError) {
                this.rotateNativeKey();
                continue;
            } else {
                throw error;
            }
        }
    }
    throw new Error("Все ключи Google Native исчерпаны!");
  }

  getCurrentTime() {
    const time = new Date().toLocaleString("ru-RU", {
      timeZone: "Europe/Moscow",
      weekday: 'short', // Сократим до Пт, Пн (экономим токены)
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    // Явно указываем базу для расчетов
    return `${time} (UTC+3)`;
  }

// === УНИВЕРСАЛЬНЫЙ ПОИСК ===
async performSearch(query) {
  this.resetStatsIfNeeded();

  // 1. TAVILY
  if (config.searchProvider === 'tavily' && this.tavilyClient) {
      try {
          console.log(`[SEARCH] Tavily ищет: ${query}`);
          const response = await this.tavilyClient.search(query, {
              search_depth: "advanced",
              max_results: 3,
              include_answer: true 
          });
          storage.incrementStat('search');
          
          let resultText = "";
          if (response.answer) resultText += `Краткий ответ Tavily: ${response.answer}\n\n`;
          response.results.forEach((res, i) => {
              resultText += `[${i+1}] ${res.title} (${res.url}):\n${res.content}\n\n`;
          });
          return resultText;
      } catch (e) {
          console.error(`[TAVILY FAIL] ${e.message}`);
          return null;
      }
  }

  // 2. PERPLEXITY
  if (config.searchProvider === 'perplexity' && this.openai) {
      try {
          console.log(`[SEARCH] Perplexity ищет: ${query}`);
          const completion = await this.openai.chat.completions.create({
              model: config.perplexityModel,
              messages: [
                  { role: "system", content: `Date: ${this.getCurrentTime()}. Search engine mode. Provide facts with URLs.` },
                  { role: "user", content: query }
              ],
              temperature: 0.1
          });
          storage.incrementStat('search');
          return completion.choices[0].message.content;
      } catch (e) {
          console.error(`[PERPLEXITY FAIL] ${e.message}`);
          return null;
      }
  }
  
  return null;
}
  
// === ОСНОВНОЙ ОТВЕТ ===
  // 2. ТЕКСТОВАЯ (Ответы текстом на текстовые вопросы) - textModel
  // 3. ВИЗУАЛЬНАЯ (Ответы текстом на вопросы со скриншотами) - visionModel
  // 4. ГОЛОСОВАЯ (Ответы текстом на голосовые вопросы + транскрибация) - voiceModel
  // 5. РИСОВАЛЬНАЯ (Редактирование скриншотов) - drawModel
  async getResponse(history, currentMessage, imageBuffer = null, mimeType = "image/jpeg", userInstruction = "", userProfile = null, isSpontaneous = false, chatProfile = null) {
  this.resetStatsIfNeeded();
  console.log(`[DEBUG AI] getResponse вызван.`);

  // 0. ПРОВЕРКА: НУЖНО ЛИ РЕДАКТИРОВАНИЕ ИЗОБРАЖЕНИЯ (drawModel vs visionModel)
  const hasImage = imageBuffer !== null;
  const drawDecision = hasImage ? await this.checkDrawNeeded(currentMessage.text, hasImage) : { needsDraw: false, model: "visionModel", drawPrompt: null };

  // Если нужно редактирование — используем drawModel
  if (drawDecision.needsDraw && drawDecision.model === "drawModel") {
      return this.handleImageDraw(currentMessage.text, imageBuffer, mimeType, drawDecision.drawPrompt);
  }

  // 1. AI ОПРЕДЕЛЯЕТ НУЖЕН ЛИ ПОИСК
  const recentHistory = history.slice(-5).map(m => `${m.role}: ${m.text}`).join('\n');
  const searchDecision = await this.checkSearchNeeded(
      currentMessage.text,
      recentHistory,
      chatProfile?.topic || null
  );

  let searchResultText = "";

  if (searchDecision.needsSearch && searchDecision.searchQuery) {
      // 2. ПОИСК ЧЕРЕЗ TAVILY / PERPLEXITY
      if (config.searchProvider !== 'google') {
          searchResultText = await this.performSearch(searchDecision.searchQuery);
      }

      // 3. FALLBACK НА GOOGLE NATIVE SEARCH
      // Если Tavily/Perplexity недоступен или провайдер = google
      if (!searchResultText && this.keys.length > 0) {
          console.log(`[ROUTER] Переключаюсь на Google Native Search.`);
          return this.generateViaNative(history, currentMessage, imageBuffer, mimeType, userInstruction, userProfile, isSpontaneous, chatProfile);
      }
  }

  // 2. СБОРКА ПРОМПТА
  const relevantHistory = history.slice(-20);
  const contextStr = relevantHistory.map(m => `${m.role}: ${m.text}`).join('\n');
  let personalInfo = "";
  let replyContext = "";

  if (currentMessage.replyText) replyContext = `!!! ПОЛЬЗОВАТЕЛЬ ОТВЕТИЛ НА СООБЩЕНИЕ:\n"${currentMessage.replyText}"`;
  if (userInstruction) personalInfo += `\n!!! СПЕЦ-ИНСТРУКЦИЯ !!!\n${userInstruction}\n`;

  if (searchResultText) {
      personalInfo += `\n!!! ДАННЫЕ ИЗ ПОИСКА (${config.searchProvider.toUpperCase()}) !!!\n${searchResultText}\nИНСТРУКЦИЯ: Ответь, используя эти факты. ДОБАВЬ ССЫЛКИ ТОЛЬКО ПО ЗАПРОСУ ПОЛЬЗОВАТЕЛЯ.\n`;
  }

  if (userProfile) {
      const score = userProfile.relationship || 50;
      let relationText = score <= 20 ? "СТАТУС: ВРАГ." : score >= 80 ? "СТАТУС: БРАТАН." : "СТАТУС: НЕЙТРАЛЬНО.";
      personalInfo += `\n--- ДОСЬЕ ---\nФакты: ${userProfile.facts || "Нет"}\n`;
      if (userProfile.location) personalInfo += `📍 Локация: ${userProfile.location}\n`;
      personalInfo += `${relationText}\n-----------------\n`;
  }

  const fullPromptText = prompts.mainChat({
      time: this.getCurrentTime(),
      isSpontaneous: isSpontaneous,
      userMessage: currentMessage.text,
      replyContext: replyContext,
      history: contextStr,
      personalInfo: personalInfo,
      senderName: currentMessage.sender,
      chatContext: chatProfile
  });

  // 3. ЗАПРОС К МОДЕЛИ (API)
  if (this.openai) {
      try {
          // Выбираем модель: visionModel для изображений, textModel для текста
          const selectedModel = imageBuffer ? config.visionModel : config.textModel;

          const messages = [{ role: "system", content: prompts.system() }, { role: "user", content: [] }];
          messages[1].content.push({ type: "text", text: fullPromptText });
          if (imageBuffer) {
              messages[1].content.push({
                  type: "image_url",
                  image_url: { url: `data:${mimeType};base64,${imageBuffer.toString('base64')}` }
              });
          }

          const completion = await this.openai.chat.completions.create({
              model: selectedModel,
              messages: messages,
              max_tokens: 2500,
              temperature: 0.9,
          });

          storage.incrementStat('smart');
          return completion.choices[0].message.content.replace(/^thought[\s\S]*?\n\n/i, '');
      } catch (e) {
          // Пробрасываем ошибку дальше, чтобы logic.js обработал её красиво
          throw e;
      }
  }

  // 4. FALLBACK (Если API ключа нет — используем Google Native)
  // Это происходит только если this.openai === null (нет API ключа в .env)
  return this.generateViaNative(history, currentMessage, imageBuffer, mimeType, userInstruction, userProfile, isSpontaneous, chatProfile);
}

// Helper для Native вызова (чтобы не дублировать код)
async generateViaNative(history, currentMessage, imageBuffer, mimeType, userInstruction, userProfile, isSpontaneous, chatProfile = null) {
    const relevantHistory = history.slice(-20);
    const contextStr = relevantHistory.map(m => `${m.role}: ${m.text}`).join('\n');

    // Собираем полную информацию о пользователе (как в основном методе)
    let personalInfo = "";
    let replyContext = "";

    if (currentMessage.replyText) {
        replyContext = `!!! ПОЛЬЗОВАТЕЛЬ ОТВЕТИЛ НА СООБЩЕНИЕ:\n"${currentMessage.replyText}"`;
    }

    if (userInstruction) {
        personalInfo += `\n!!! СПЕЦ-ИНСТРУКЦИЯ !!!\n${userInstruction}\n`;
    }

    if (userProfile) {
        const score = userProfile.relationship || 50;
        let relationText = score <= 20 ? "СТАТУС: ВРАГ." : score >= 80 ? "СТАТУС: БРАТАН." : "СТАТУС: НЕЙТРАЛЬНО.";
        personalInfo += `\n--- ДОСЬЕ ---\nФакты: ${userProfile.facts || "Нет"}\n`;
        if (userProfile.location) personalInfo += `📍 Локация: ${userProfile.location}\n`;
        personalInfo += `${relationText}\n-----------------\n`;
    }

    const fullPromptText = prompts.mainChat({
        time: this.getCurrentTime(),
        isSpontaneous: isSpontaneous,
        userMessage: currentMessage.text,
        replyContext: replyContext,
        history: contextStr,
        personalInfo: personalInfo,
        senderName: currentMessage.sender,
        chatContext: chatProfile
    });

    return this.executeNativeWithRetry(async () => {
      let promptParts = [];
      if (imageBuffer) promptParts.push({ inlineData: { mimeType: mimeType, data: imageBuffer.toString("base64") } });
      promptParts.push({ text: fullPromptText });

      const result = await this.nativeModel.generateContent({
          contents: [{ role: 'user', parts: promptParts }],
          generationConfig: { maxOutputTokens: 2500, temperature: 0.9 }
      });
      
      let text = result.response.text();
      if (result.response.candidates[0].groundingMetadata?.groundingChunks) {
           const links = result.response.candidates[0].groundingMetadata.groundingChunks
              .filter(c => c.web?.uri).map(c => `[${c.web.title || "Источник"}](${c.web.uri})`);
           const unique = [...new Set(links)].slice(0, 3);
     
           // Проверяем, просил ли пользователь предоставить ссылки
           const userRequestedLinks = currentMessage.text.toLowerCase().includes('дай ссылку') ||
                                     currentMessage.text.toLowerCase().includes('ссылки') ||
                                     currentMessage.text.toLowerCase().includes('источник');
     
           if (unique.length > 0 && userRequestedLinks) {
               text += "\n\nНашел тут: " + unique.join(" • ");
           }
      }
      return text;
    });
}

// === ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ===

  // 1. ЛОГИКА (Анализ, реакции, проверки) - logicModel
  // Универсальный метод для JSON-ответов
  async runLogicModel(promptJson) {
    if (this.openai) {
        try {
            const completion = await this.openai.chat.completions.create({
                model: config.logicModel,
                messages: [{ role: "user", content: promptJson }],
                response_format: { type: "json_object" }
            });
            storage.incrementStat('logic');
            return JSON.parse(completion.choices[0].message.content);
        } catch (e) {
            // Пробрасываем ошибку дальше
            throw e;
        }
    }
    // Fallback Native — только если нет API ключа
    try {
        return await this.executeNativeWithRetry(async () => {
           const result = await this.nativeModel.generateContent(promptJson);
           let text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
           const first = text.indexOf('{'), last = text.lastIndexOf('}');
           if (first !== -1 && last !== -1) text = text.substring(first, last + 1);
           return JSON.parse(text);
        });
    } catch (e) { return null; }
}

// Простой текстовый ответ (для реакций и ShouldAnswer)
async runLogicText(promptText) {
    if (this.openai) {
        try {
          const completion = await this.openai.chat.completions.create({
              model: config.logicModel,
              messages: [{ role: "user", content: promptText }]
          });
          storage.incrementStat('logic');
          return completion.choices[0].message.content;
        } catch (e) {
            // Пробрасываем ошибку дальше
            throw e;
        }
    }
    return null;
}

async analyzeUserImmediate(lastMessages, currentProfile) {
    return this.runLogicModel(prompts.analyzeImmediate(currentProfile, lastMessages));
}

// Определение необходимости поиска (AI-решение вместо regex)
async checkSearchNeeded(userMessage, recentHistory, chatTopic) {
    const prompt = prompts.shouldSearch(
        this.getCurrentTime(),
        userMessage,
        recentHistory,
        chatTopic
    );

    try {
        const result = await this.runLogicModel(prompt);
        if (result && typeof result.needsSearch === 'boolean') {
            console.log(`[SEARCH CHECK] needsSearch=${result.needsSearch}, query="${result.searchQuery}", reason="${result.reason}"`);
            return result;
        }
    } catch (e) {
        console.error(`[SEARCH CHECK ERROR] ${e.message}`);
    }

    // Fallback: не искать если AI не ответил
    return { needsSearch: false, searchQuery: null, reason: "fallback" };
}

// Определение необходимости редактирования изображения (AI-решение)
async checkDrawNeeded(userMessage, hasImage) {
    if (!hasImage) {
        return { needsDraw: false, model: "visionModel", drawPrompt: null, reason: "нет изображения" };
    }

    const prompt = prompts.shouldDraw(userMessage, hasImage);

    try {
        const result = await this.runLogicModel(prompt);
        if (result && typeof result.needsDraw === 'boolean') {
            console.log(`[DRAW CHECK] needsDraw=${result.needsDraw}, model=${result.model}, prompt="${result.drawPrompt}", reason="${result.reason}"`);
            return result;
        }
    } catch (e) {
        console.error(`[DRAW CHECK ERROR] ${e.message}`);
    }

    // Fallback: visionModel если AI не ответил
    return { needsDraw: false, model: "visionModel", drawPrompt: null, reason: "fallback" };
}

async analyzeBatch(messagesBatch, currentProfiles) {
    const chatLog = messagesBatch.map(m => `[ID:${m.userId}] ${m.name}: ${m.text}`).join('\n');
    const knownInfo = Object.entries(currentProfiles).map(([uid, p]) => `ID:${uid} -> ${p.realName}, ${p.facts}, ${p.attitude}`).join('\n');
    return this.runLogicModel(prompts.analyzeBatch(knownInfo, chatLog));
}

// Анализ профиля чата (каждые 50 сообщений)
async analyzeChatProfile(messagesBatch, currentProfile) {
    const messagesText = messagesBatch.map(m => `${m.name}: ${m.text}`).join('\n');
    return this.runLogicModel(prompts.analyzeChatProfile(currentProfile, messagesText));
}

// Обработка ручного описания чата (команда "Малыш, этот чат про...")
async processManualChatDescription(description, currentProfile) {
    return this.runLogicModel(prompts.processManualChatDescription(description, currentProfile));
}

async determineReaction(contextText) {
  const allowed = ["👍", "👎", "❤", "🔥", "🥰", "👏", "😁", "🤔", "🤯", "😱", "🤬", "😢", "🎉", "🤩", "🤮", "💩", "🙏", "👌", "🕊", "🤡", "🥱", "🥴", "😍", "🐳", "❤‍🔥", "🌚", "🌭", "💯", "🤣", "⚡", "🍌", "🏆", "💔", "🤨", "😐", "🍓", "🍾", "💋", "🖕", "😈", "😴", "😭", "🤓", "👻", "👨‍💻", "👀", "🎃", "🙈", "😇", "😨", "🤝", "✍", "🤗", "🫡", "🎅", "🎄", "☃", "💅", "🤪", "🗿", "🆒", "💘", "🙉", "🦄", "😘", "💊", "🙊", "😎", "👾", "🤷‍♂", "🤷", "🤷‍♀", "😡"];
  const text = await this.runLogicText(prompts.reaction(contextText, allowed.join(" ")));
  if (!text) return null;
  const match = text.match(/(\p{Emoji_Presentation}|\p{Extended_Pictographic})/u);
  return (match && allowed.includes(match[0])) ? match[0] : null;
}

// 2. ТЕКСТОВАЯ (textModel) - генерация описания профиля
async generateProfileDescription(profileData, targetName) {
    if (this.openai) {
      try {
          const completion = await this.openai.chat.completions.create({ model: config.textModel, messages: [{ role: "user", content: prompts.profileDescription(targetName, profileData) }] });
          storage.incrementStat('smart'); return completion.choices[0].message.content;
      } catch(e) {}
    }
    return "Не знаю такого.";
}

// 2. ТЕКСТОВАЯ (textModel) - генерация финального текста задачи
async generateFlavorText(task, result) {
  if (this.openai) {
      try {
          const completion = await this.openai.chat.completions.create({ model: config.textModel, messages: [{ role: "user", content: prompts.flavor(task, result) }] });
          storage.incrementStat('smart'); return completion.choices[0].message.content.trim().replace(/^["']|["']$/g, '');
      } catch(e) {}
  }
  return `${result}`;
}

  // === ТРАНСКРИБАЦИЯ ===
  // 4. ГОЛОСОВАЯ (Ответы текстом на голосовые вопросы + транскрибация) - voiceModel
  async transcribeAudio(audioBuffer, userName, mimeType) {
    // 1. Пробуем через API (voiceModel) — Gemini 2.0 Flash с поддержкой аудио
    if (this.openai) {
        try {
            // Кодируем аудио в base64
            const base64Audio = audioBuffer.toString('base64');

            const messages = [{
                role: "user",
                content: [
                    { type: "text", text: prompts.transcription(userName) },
                    { type: "input_audio", input_audio: { data: base64Audio, format: mimeType.replace('audio/', '') } }
                ]
            }];

            const completion = await this.openai.chat.completions.create({
                model: config.voiceModel,
                messages: messages,
            });

            storage.incrementStat('voice');
            let text = completion.choices[0].message.content;
            
            // Парсим JSON из ответа (как в Native)
            text = text.replace(/```json/g, '').replace(/```/g, '').trim();
            const first = text.indexOf('{'), last = text.lastIndexOf('}');
            if (first !== -1 && last !== -1) text = text.substring(first, last + 1);
            
            const parsed = JSON.parse(text);
            return { text: parsed.text || text, summary: parsed.summary || `${userName} сказал(а)` };
        } catch (e) {
            console.error(`[VOICE API FAIL] ${e.message}. Fallback to Native...`);
        }
    }

    // 2. Fallback: Google Native (если нет API ключа или API упал)
    if (!this.keys || this.keys.length === 0) {
        console.warn("[AI WARN] Получено голосовое, но нет ключей Google для расшифровки. Пропускаю.");
        return null;
    }

    try {
        return await this.executeNativeWithRetry(async () => {
          const parts = [
              { inlineData: { mimeType: mimeType, data: audioBuffer.toString("base64") } },
              { text: prompts.transcription(userName) }
          ];
          const result = await this.nativeModel.generateContent(parts);
          let text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
          const first = text.indexOf('{'), last = text.lastIndexOf('}');
          if (first !== -1 && last !== -1) text = text.substring(first, last + 1);
          return JSON.parse(text);
        });
    } catch (e) {
        console.error(`[TRANSCRIPTION FAIL] ${e.message}`);
        return null;
    }
  }

  // === ПАРСИНГ НАПОМИНАНИЯ (С КОНТЕКСТОМ) ===
  async parseReminder(userText, contextText = "") {
    const now = this.getCurrentTime();
    const prompt = prompts.parseReminder(now, userText, contextText);
    return this.runLogicModel(prompt);
  }

  // === РИСОВАНИЕ ===
  // 5. РИСОВАЛЬНАЯ (Ответы текст + изображение - с редактированием скриншотов, когда просят - нарисуй, покажи) - drawModel
  async generateImage(promptText, imageUrl = null) {
    if (!this.openai) {
        console.warn("[AI WARN] Нет API ключа для генерации изображений.");
        return null;
    }

    try {
        const messages = [];

        if (imageUrl) {
            // Если есть референс — используем его
            messages.push({
                role: "user",
                content: [
                    { type: "text", text: promptText },
                    { type: "image_url", image_url: { url: imageUrl } }
                ]
            });
        } else {
            messages.push({ role: "user", content: promptText });
        }

        const completion = await this.openai.chat.completions.create({
            model: config.drawModel,
            messages: messages,
            max_tokens: 2500,
        });

        storage.incrementStat('smart');
        return completion.choices[0].message.content;
    } catch (e) {
        console.error(`[DRAW FAIL] ${e.message}`);
        return null;
    }
  }

  // Обработка запроса на редактирование изображения (drawModel)
  async handleImageDraw(userMessage, imageBuffer, mimeType, drawPrompt = null) {
    console.log(`[DRAW HANDLER] Обработка запроса на редактирование: "${drawPrompt || userMessage}"`);

    if (!this.openai) {
        console.warn("[AI WARN] Нет API ключа для drawModel. Использую fallback на visionModel.");
        // Fallback: просто анализируем изображение через visionModel
        return this.generateViaNative([], { text: userMessage }, imageBuffer, mimeType, "", null, false, null);
    }

    try {
        // Кодируем изображение в base64
        const base64Image = imageBuffer.toString('base64');
        
        // GPT-5 Image Mini / GPT-4o Image Edit style request
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.aiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: config.drawModel, // openai/gpt-5-image-mini
                messages: [{
                    role: 'user',
                    content: [
                        { 
                            type: 'text', 
                            text: `You are an image editing assistant. I am providing an image and an instruction. 
                            Your task is to edit the image according to the instruction and return ONLY the edited image.
                            Instruction: ${drawPrompt || userMessage}
                            Do not provide a text explanation of what you did. Just provide the edited image based on the input.` 
                        },
                        { 
                            type: 'image_url', 
                            image_url: { 
                                url: `data:${mimeType};base64,${base64Image}` 
                            } 
                        }
                    ]
                }]
            })
        });

        const data = await response.json();
        
        if (data.error) {
            console.error('[DRAW ERROR] OpenRouter API Error:', data.error);
            return `Ошибка API: ${data.error.message}`;
        }

        const message = data.choices[0]?.message;
        console.log('[DRAW DEBUG] Message received:', JSON.stringify(message).substring(0, 200) + '...');

        let imageResult = null;
        let textResult = null;

        // Обработка разных форматов ответа (OpenRouter/OpenAI)
        if (message?.content && Array.isArray(message.content)) {
            for (const p of message.content) {
                if (p.type === 'image_url') imageResult = p.image_url?.url;
                if (p.type === 'image') imageResult = p.image?.url || p.image;
                if (p.type === 'text') textResult = p.text;
            }
        } else if (message?.images?.[0]) {
            imageResult = message.images[0];
            textResult = message.content;
        } else if (typeof message?.content === 'string') {
            textResult = message.content;
        }

        if (imageResult) {
            console.log('[DRAW] Found image in response');
            let buffer;
            if (typeof imageResult === 'string' && imageResult.startsWith('http')) {
                const r = await axios.get(imageResult, { responseType: 'arraybuffer' });
                buffer = Buffer.from(r.data);
            } else {
                // Гарантируем, что работаем со строкой base64
                const b64String = typeof imageResult === 'string' ? imageResult : (imageResult?.url || JSON.stringify(imageResult));
                const b64 = b64String.includes('base64,') ? b64String.split('base64,')[1] : b64String;
                buffer = Buffer.from(b64, 'base64');
            }
            storage.incrementStat('smart');
            return { 
                type: 'image', 
                image: buffer, 
                caption: textResult && textResult.length < 1000 ? textResult : "Готово, нарисовал!" 
            };
        }

        console.warn('[DRAW] No image found in AI response, returning text');
        return textResult || 'Модель прислала ответ, но я не нашел там картинки. Возможно, она просто описала, что нужно сделать.';
    } catch (e) {
        console.error(`[DRAW HANDLER ERROR] ${e.message}. Fallback к visionModel...`);
        // Fallback: анализируем через visionModel
        return this.generateViaNative([], { text: userMessage }, imageBuffer, mimeType, "", null, false, null);
    }
  }

  /**
   * Получить цену инструмента из кэша AllTick
   */
  async getPrice(symbol) {
    const data = quotesService.getPrice(symbol);
    
    if (data.error) {
      return {
        error: true,
        message: data.message
      };
    }
    
    // Форматируем время (МСК, UTC+3)
    const timeStr = data.time.toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      day: '2-digit',
      month: '2-digit'
    });
    
    const emoji = {
      'GOLD': '🥇',
      'EURUSD': '💶',
      'GBPUSD': '💷',
      'USDJPY': '💴',
      'AUDUSD': '🇦🇺',
      'SILVER': '🥈',
      'WTI': '🛢️',
      'BTCUSD': '₿'
    };
    
    // Источник данных
    const sourceNames = {
      'alltick_ws': 'AllTick WebSocket',
      'alltick_rest': 'AllTick REST',
      'alpha_vantage': 'Alpha Vantage',
      'coingecko': 'CoinGecko',
      'backup': 'Backup API'
    };
    
    let response = `${emoji[symbol] || '💰'} *${symbol}*\n\n`;
    response += `💵 Цена: *${data.formatted}*\n`;
    
    if (data.source) {
      response += `📡 Источник: ${sourceNames[data.source] || data.source}\n`;
    }
    
    if (data.volume) {
      response += `📊 Объём: ${data.volume.toLocaleString()}\n`;
    }
    
    response += `⏱ Время: ${timeStr} (МСК)\n`;
    
    if (data.isStale) {
      response += `\n⚠️ Данные устарели (${Math.floor(data.age / 1000)} сек)`;
    } else {
      response += `\n✅ Актуально: ${Math.floor(data.age / 1000)} сек назад`;
    }
    
    return {
      text: response,
      source: 'alltick',
      data: data
    };
  }
}

module.exports = new AiService();