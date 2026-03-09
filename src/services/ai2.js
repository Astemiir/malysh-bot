const axios = require('axios');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const config = require('../config');
const storage = require('./storage');
const prompts = require('../core/prompts');
const quotesService = require('./quotesService');

class AiService {
  constructor() {
    this.keys = config.geminiKeys || [];
    this.keyIndex = 0;
    this.nativeModel = null;
    this.usingFallback = false;
    this.initNativeModel();
  }

  setBot(bot) {
    this.bot = bot;
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
    const modelName = this.usingFallback ? config.fallbackModelName : config.googleNativeModel;
    this.nativeModel = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: prompts.system(),
      safetySettings: safetySettings,
      tools: [{ googleSearch: {} }]
    });
  }

  async getResponse(history, currentMessage, imageBuffer = null, mimeType = null, instruction = "", userProfile = {}, isSpontaneous = false, chatProfile = {}) {
    const userMessage = currentMessage.text || "";
    const senderName = currentMessage.sender || "User";
    const replyText = currentMessage.replyText || "";

    if (imageBuffer) {
      const drawDecision = await this.checkDrawNeeded(userMessage, true);
      console.log(`[DRAW DECISION] needsDraw: ${drawDecision.needsDraw}, model: ${drawDecision.model}`);
      
      if (drawDecision.needsDraw && drawDecision.model === 'drawModel') {
        return await this.handleImageDraw(userMessage, imageBuffer, mimeType, drawDecision.drawPrompt);
      }
    }

    // Обычная логика ответов (Gemini)...
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.aiKey}`,
          'Content-Type': 'application/json',
          'X-Title': 'Malysh Bot'
        },
        body: JSON.stringify({
          model: config.textModel,
          messages: [
            { role: 'system', content: prompts.system() },
            { 
              role: 'user', 
              content: prompts.mainChat({
                time: new Date().toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow' }),
                chatContext: chatProfile,
                isSpontaneous: isSpontaneous,
                senderName: senderName,
                userMessage: userMessage,
                replyContext: replyText ? `В ответ на: "${replyText}"` : "",
                history: history.map(h => `${h.role}: ${h.text}`).join('\n'),
                personalInfo: userProfile.facts ? `Твое досье на него: ${userProfile.facts}` : ""
              }) 
            }
          ]
        })
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error.message || "OpenRouter Error");
      return data.choices[0].message.content;
    } catch (e) {
      console.error("[AI GETRESPONSE ERROR]", e.message);
      throw e;
    }
  }

  async handleImageDraw(userMessage, imageBuffer, mimeType, drawPrompt = null) {
    console.log('[DRAW] Edit start with GPT-5 Image Mini');
    try {
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
        return { 
            type: 'image', 
            image: buffer, 
            caption: textResult && textResult.length < 1000 ? textResult : "Готово, нарисовал!" 
        };
      }

      console.warn('[DRAW] No image found in AI response, returning text');
      return textResult || 'Модель прислала ответ, но я не нашел там картинки. Возможно, она просто описала, что нужно сделать.';
    } catch (e) {
      console.error('[DRAW CRITICAL ERROR]', e);
      return 'Ошибка при рисовании: ' + e.message;
    }
  }

  async checkDrawNeeded(userMessage, hasImage) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${config.aiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.logicModel,
          messages: [{ role: 'user', content: prompts.shouldDraw(userMessage, hasImage) }],
          response_format: { type: 'json_object' }
        })
      });
      const data = await response.json();
      const result = JSON.parse(data.choices[0].message.content || '{}');
      return {
        needsDraw: result.needsDraw === true,
        model: result.model || 'visionModel',
        drawPrompt: result.drawPrompt || null
      };
    } catch (e) {
      return { needsDraw: false, model: 'visionModel', drawPrompt: null };
    }
  }

  async transcribeAudio(buffer, userName, mimeType) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.aiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: config.voiceModel,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompts.transcription(userName) },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${buffer.toString('base64')}` } }
            ]
          }]
        })
      });
      const data = await response.json();
      return JSON.parse(data.choices[0].message.content || '{}');
    } catch (e) {
      console.error("[VOICE ERROR]", e.message);
      return null;
    }
  }

  async analyzeUserImmediate(context, currentProfile) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${config.aiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.logicModel,
          messages: [{ role: 'user', content: prompts.analyzeImmediate(currentProfile, context) }],
          response_format: { type: 'json_object' }
        })
      });
      const data = await response.json();
      return JSON.parse(data.choices[0].message.content || '{}');
    } catch (e) {
      return null;
    }
  }

  async analyzeBatch(messages, currentProfiles) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${config.aiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.logicModel,
          messages: [{ role: 'user', content: prompts.analyzeBatch(JSON.stringify(currentProfiles), JSON.stringify(messages)) }],
          response_format: { type: 'json_object' }
        })
      });
      const data = await response.json();
      return JSON.parse(data.choices[0].message.content || '{}');
    } catch (e) {
      return null;
    }
  }

  async analyzeChatProfile(messages, currentProfile) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${config.aiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.logicModel,
          messages: [{ role: 'user', content: prompts.analyzeChatProfile(currentProfile, JSON.stringify(messages)) }],
          response_format: { type: 'json_object' }
        })
      });
      const data = await response.json();
      return JSON.parse(data.choices[0].message.content || '{}');
    } catch (e) {
      return null;
    }
  }

  async processManualChatDescription(description, currentProfile) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${config.aiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.logicModel,
          messages: [{ role: 'user', content: prompts.processManualChatDescription(description, currentProfile) }],
          response_format: { type: 'json_object' }
        })
      });
      const data = await response.json();
      return JSON.parse(data.choices[0].message.content || '{}');
    } catch (e) {
      return null;
    }
  }

  async generateProfileDescription(data, name) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${config.aiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.textModel,
          messages: [{ role: 'user', content: prompts.profileDescription(name, data) }]
        })
      });
      const dataRes = await response.json();
      return dataRes.choices[0].message.content;
    } catch (e) {
      return "Не удалось составить досье.";
    }
  }

  async generateFlavorText(task, result) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${config.aiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.textModel,
          messages: [{ role: 'user', content: prompts.flavor(task, result) }]
        })
      });
      const dataRes = await response.json();
      return dataRes.choices[0].message.content;
    } catch (e) {
      return `Результат: ${result}`;
    }
  }

  async determineReaction(context) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${config.aiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.logicModel,
          messages: [{ role: 'user', content: prompts.reaction(context, "👍,👎,😂,😮,😡,🤔,🔥,🤡,👀") }]
        })
      });
      const data = await response.json();
      const emoji = data.choices[0].message.content.trim();
      return emoji === 'NULL' ? null : emoji;
    } catch (e) {
      return null;
    }
  }

  async parseReminder(text, context) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${config.aiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.logicModel,
          messages: [{ role: 'user', content: prompts.parseReminder(new Date().toISOString(), text, context) }],
          response_format: { type: 'json_object' }
        })
      });
      const data = await response.json();
      return JSON.parse(data.choices[0].message.content || '{}');
    } catch (e) {
      return null;
    }
  }

  getStatsReport() {
    const stats = storage.getStats();
    return `📊 **Статистика за сегодня:**\n` +
           `🧠 Logic: \`${stats.logic || 0}\` токенов\n` +
           `📝 Text: \`${stats.text || 0}\` токенов\n` +
           `🖼 Vision: \`${stats.vision || 0}\` токенов\n` +
           `🎙 Voice: \`${stats.voice || 0}\` токенов\n` +
           `🎨 Draw: \`${stats.draw || 0}\` токенов`;
  }

  async getPrice(symbol) {
    const data = quotesService.getPrice(symbol);
    if (data.error) return { error: true, message: data.message };
    const timeStr = data.time.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' });
    return { text: `💰 *${symbol}*\n💵 Цена: *${data.formatted}*\n⏱ Время: ${timeStr}`, source: 'alltick', data: data };
  }
}

module.exports = new AiService();
