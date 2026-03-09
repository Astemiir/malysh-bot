const packageInfo = require('../package.json');
require('dotenv').config();

// Собираем ключи для Native Google (Fallback или Search)
const geminiKeys = [];
if (process.env.GOOGLE_GEMINI_API_KEY) geminiKeys.push(process.env.GOOGLE_GEMINI_API_KEY);
let i = 2;
while (process.env[`GOOGLE_GEMINI_API_KEY_${i}`]) {
    geminiKeys.push(process.env[`GOOGLE_GEMINI_API_KEY_${i}`]);
    i++;
}

console.log(`[CONFIG] Загружено ключей Gemini (Native): ${geminiKeys.length}`);

module.exports = {
  // === TELEGRAM ===
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  version: packageInfo.version,
  botId: parseInt(process.env.TELEGRAM_BOT_TOKEN.split(':')[0], 10),
  adminId: parseInt(process.env.ADMIN_USER_ID, 10),
  
  // === OPENROUTER / API (Основной канал) ===
  aiBaseUrl: process.env.AI_BASE_URL || "https://openrouter.ai/api/v1",
  aiKey: process.env.OPENROUTER_API_KEY || process.env.AI_API_KEY, 

  // === АКТУАЛЬНЫЕ МОДЕЛИ (МАРТ 2026) ===
  // Примечание: Бесплатные модели (:free) имеют общий лимит — используем платные версии

  // 1. ЛОГИКА (Анализ, реакции, проверки) - Gemma 3 27B ($0.07/1M in, $0.24/1M out)
  logicModel: 'google/gemma-3-27b-it',

  // 2. ТЕКСТОВАЯ (Ответы на текстовые вопросы) - Gemini 3 Flash Preview ($0.50/1M in, $3.10/1M out, $1.00/1M audio)
  textModel: 'google/gemini-3-flash-preview',

  // 3. ВИЗУАЛЬНАЯ (Ответы текстом на вопросы со скриншотами) - Qwen3 VL 30B A3B Thinking (free) 
  visionModel: 'qwen/qwen3-vl-30b-a3b-thinking',

  // 4. ГОЛОСОВАЯ (Ответы на голосовые вопросы + транскрибация) - Gemini 2.0 Flash ($0.10/1M in, $0.40/1M out, $0.70/1M audio) 
  voiceModel: 'google/gemini-2.0-flash-001',

  // 5. РИСОВАЛЬНАЯ (Ответы с редактированием скриншотов) - GPT-5 Image Mini ($1.99/1M in, $6.33/1M out + image)
  // Поддерживает нативное редактирование изображений через OpenRouter API
  drawModel: 'openai/gpt-5-image-mini',

  // === ПОИСК (RAG или NATIVE) ===
  // Варианты: 
  // 'tavily'     -> Использует Tavily API (RAG). Лучший вариант для сторонних моделей.
  // 'perplexity' -> Использует модель Sonar через OpenRouter (RAG).
  // 'google'     -> Переключается на нативный Google API с встроенным поиском (Tools).
  //  Если в .env не задано, по умолчанию используем 'tavily'
  searchProvider: process.env.SEARCH_PROVIDER || 'tavily',  
  
  // Настройки провайдеров
  tavilyKey: process.env.TAVILY_API_KEY,
  perplexityModel: 'perplexity/sonar', // Актуальный алиас

  // === GEMINI NATIVE (FALLBACK / SEARCH) ===
  geminiKeys: geminiKeys,
  googleNativeModel: 'gemini-2.5-flash-lite',
  fallbackModelName: 'gemini-2.5-flash-lite',
  contextSize: 30,
  triggerRegex: /(?<![а-яёa-z])(малыш|malysh)(?![а-яёa-z])/i,

  // === ALLTICK WEBSOCKET (Котировки) ===
  alltickKey: process.env.ALLTICK_TOKEN,
};