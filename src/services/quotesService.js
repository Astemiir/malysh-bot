const alltickHybrid = require('./alltickHybridService');
const backupService = require('./backupQuotesService');
const EventEmitter = require('events');

/**
 * Quotes Service с поддержкой:
 * 1. AllTick WebSocket (основной)
 * 2. AllTick REST API (резерв)
 * 3. Backup API (Alpha Vantage, CoinGecko)
 */
class QuotesService extends EventEmitter {
  constructor() {
    super();
    
    // Кэш цен в памяти
    this.priceCache = new Map();
    
    // Инструменты для мониторинга
    this.symbols = [
      'GOLD',    // 🥇 Золото
      'EURUSD',  // 💶 Евро/Доллар
      'GBPUSD',  // 💷 Фунт/Доллар
      'USDJPY',  // 💴 Доллар/Иена
      'AUDUSD',  // 🇦🇺 Австр/Доллар
      'BTCUSD',  // ₿ Биткоин
      'SILVER',  // 🥈 Серебро
      'WTI'      // 🛢️ Нефть
    ];
    
    // Максимальная свежесть данных (60 сек)
    this.maxAgeMs = 60000;
    
    // Интервал проверки резервных API (60 сек)
    this.backupInterval = null;
  }

  /**
   * Запуск сервиса
   */
  connect() {
    console.log('🚀 Quotes Service: запуск...');
    
    // 1. Запускаем AllTick Hybrid (WebSocket + REST)
    alltickHybrid.connect();
    
    // Подписываемся на события AllTick
    alltickHybrid.on('price_update', (data) => {
      this.priceCache.set(data.code, {
        data,
        timestamp: Date.now()
      });
      this.emit('price_update', data);
    });
    
    // 2. Запускаем обновление резервных API для BTC и других
    this.startBackupUpdates();
    
    console.log('✅ Quotes Service: запущен');
  }

  /**
   * Обновление резервных API
   */
  startBackupUpdates() {
    // BTC обновляется из CoinGecko
    this.backupInterval = setInterval(() => {
      this.updateBackupPrices();
    }, 60000);
    
    // Немедленное обновление
    this.updateBackupPrices();
  }

  async updateBackupPrices() {
    // BTC из CoinGecko
    const btc = await backupService.getBTCUSD();
    if (btc) {
      this.priceCache.set('BTCUSD', {
        data: btc,
        timestamp: Date.now()
      });
      this.emit('price_update', btc);
    }
  }

  /**
   * Получить цену с проверкой актуальности
   */
  getPrice(symbol) {
    const cached = this.priceCache.get(symbol);
    
    if (!cached) {
      return { 
        error: 'no_data', 
        message: `Нет данных по ${symbol}. Попробуйте через пару секунд.` 
      };
    }
    
    const age = Date.now() - cached.timestamp;
    const isStale = age > this.maxAgeMs;
    
    return {
      symbol: cached.data.code || cached.data.symbol,
      price: parseFloat(cached.data.price),
      high: parseFloat(cached.data.high || cached.data.price),
      low: parseFloat(cached.data.low || cached.data.price),
      open: parseFloat(cached.data.open || cached.data.price),
      time: cached.data.time,
      age: age,
      isStale: isStale,
      source: cached.data.source,
      formatted: `$${parseFloat(cached.data.price).toLocaleString('ru-RU', { minimumFractionDigits: 2 })}`
    };
  }

  /**
   * Получить все цены из кэша
   */
  getAllPrices() {
    const result = {};
    for (const [symbol, cached] of this.priceCache.entries()) {
      result[symbol] = this.getPrice(symbol);
    }
    return result;
  }

  /**
   * Детектор инструмента из текста
   */
  detectSymbol(text) {
    if (!text) return null;
    const lower = text.toLowerCase();
    
    const patterns = [
      { pattern: /золот|gold/i, symbol: 'GOLD' },
      { pattern: /евро.*долл|eurusd|евродоллар/i, symbol: 'EURUSD' },
      { pattern: /фунт.*долл|gbpusd|фунтдоллар/i, symbol: 'GBPUSD' },
      { pattern: /доллар.*иен|usdjpy|доллариена/i, symbol: 'USDJPY' },
      { pattern: /австр.*долл|audusd|австрдоллар/i, symbol: 'AUDUSD' },
      { pattern: /серебр|silver/i, symbol: 'SILVER' },
      { pattern: /нефть|oil|wti/i, symbol: 'WTI' },
      { pattern: /биткоин|bitcoin|btc/i, symbol: 'BTCUSD' }
    ];
    
    for (const { pattern, symbol } of patterns) {
      if (pattern.test(lower)) {
        return symbol;
      }
    }
    
    return null;
  }

  /**
   * Получить список доступных инструментов
   */
  getAvailableSymbols() {
    return [
      { code: 'GOLD', name: 'Золото', emoji: '🥇' },
      { code: 'EURUSD', name: 'Евро/Доллар', emoji: '💶' },
      { code: 'GBPUSD', name: 'Фунт/Доллар', emoji: '💷' },
      { code: 'USDJPY', name: 'Доллар/Иена', emoji: '💴' },
      { code: 'AUDUSD', name: 'Австр/Доллар', emoji: '🇦🇺' },
      { code: 'SILVER', name: 'Серебро', emoji: '🥈' },
      { code: 'WTI', name: 'Нефть WTI', emoji: '🛢️' },
      { code: 'BTCUSD', name: 'Биткоин', emoji: '₿' }
    ];
  }

  /**
   * Получить статус сервиса
   */
  getStatus() {
    const alltickStatus = alltickHybrid.getStatus();
    return {
      alltick: alltickStatus,
      cacheSize: this.priceCache.size,
      symbols: this.symbols
    };
  }

  /**
   * Корректное закрытие
   */
  disconnect() {
    console.log('🛑 Quotes Service: остановка...');
    
    if (this.backupInterval) {
      clearInterval(this.backupInterval);
      this.backupInterval = null;
    }
    
    alltickHybrid.disconnect();
    this.priceCache.clear();
  }
}

module.exports = new QuotesService();
