const WebSocket = require('ws');
const axios = require('axios');
const EventEmitter = require('events');
const backupService = require('./backupQuotesService');

/**
 * AllTick Service с автовыбором WebSocket / REST API / Backup
 * Приоритет: WebSocket → REST API → Backup
 */
class AllTickHybridService extends EventEmitter {
  constructor() {
    super();
    
    this.token = '6ad5b80cc89eac49b0e58c98e3506afe-c-app';
    this.restUrl = 'https://quote.alltick.io';
    this.wsUrl = 'wss://quote.alltick.co/quote-b-ws-api';
    
    // Кэш цен
    this.priceCache = new Map();
    this.cacheTimeout = 30000; // 30 секунд
    
    // WebSocket состояние
    this.ws = null;
    this.wsConnected = false;
    this.wsSymbols = new Set(); // Подписанные символы
    this.wsReconnectAttempts = 0;
    this.maxWsReconnectAttempts = 10;
    
    // REST API состояние
    this.restErrorCount = 0;
    
    // Инструменты для мониторинга
    this.symbols = ['GOLD', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD'];
    
    // Heartbeat интервал
    this.heartbeatInterval = null;
    this.wsHealthCheck = null;
  }

  /**
   * Запуск сервиса
   */
  connect() {
    console.log('🚀 AllTick Hybrid: запуск...');
    
    // 1. Пробуем WebSocket
    this.connectWebSocket();
    
    // 2. Запускаем REST API как резерв
    this.startRestUpdates();
    
    // 3. Проверка здоровья каждые 2 минуты
    this.startHealthCheck();
  }

  // ═══════════════════════════════════════════════════════
  // WEBSOCKET ПОДКЛЮЧЕНИЕ
  // ═══════════════════════════════════════════════════════

  connectWebSocket() {
    if (this.wsConnected) return;

    console.log('🔌 AllTick WebSocket: подключение...');
    
    try {
      this.ws = new WebSocket(`${this.wsUrl}?token=${this.token}`);

      this.ws.on('open', () => {
        console.log('✅ AllTick WebSocket: подключен');
        this.wsConnected = true;
        this.wsReconnectAttempts = 0;
        
        // Подписываемся на все символы
        this.subscribeToSymbols();
        
        // Запускаем heartbeat
        this.startHeartbeat();
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleWsMessage(message);
        } catch (error) {
          console.error('❌ AllTick WS: ошибка парсинга:', error.message);
        }
      });

      this.ws.on('close', (code, reason) => {
        console.log(`🔒 AllTick WebSocket: закрыт (${code})`);
        this.wsConnected = false;
        this.stopHeartbeat();
        this.reconnectWebSocket();
      });

      this.ws.on('error', (error) => {
        console.error('❌ AllTick WebSocket ошибка:', error.message);
      });

    } catch (error) {
      console.error('❌ AllTick WebSocket: ошибка подключения:', error.message);
      this.reconnectWebSocket();
    }
  }

  subscribeToSymbols() {
    const subscribeMsg = {
      cmd_id: 22004,
      seq_id: Date.now(),
      trace: `subscribe_${Date.now()}`,
      data: {
        symbol_list: this.symbols.map(code => ({ code }))
      }
    };

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(subscribeMsg));
      console.log(`📡 AllTick WS: подписка на ${this.symbols.join(', ')}`);
      
      this.symbols.forEach(s => this.wsSymbols.add(s));
    }
  }

  handleWsMessage(message) {
    // Ответ на подписку
    if (message.cmd_id === 22005) {
      if (message.ret === 200) {
        console.log('✅ AllTick WS: подписка подтверждена');
      } else {
        console.error(`❌ AllTick WS: ошибка подписки: ${message.msg}`);
      }
      return;
    }

    // Пуш с котировкой
    if (message.cmd_id === 22998 && message.data) {
      const tick = message.data;
      this.updateCache(tick.code, {
        price: tick.price,
        high: tick.price, // Для WS берём price как high/low
        low: tick.price,
        open: tick.price,
        time: new Date(tick.tick_time * 1000),
        code: tick.code,
        source: 'alltick_ws'
      });
      
      console.log(`📊 AllTick WS: ${tick.code} = ${tick.price}`);
    }
  }

  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.wsConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ 
          cmd_id: 22000,
          seq_id: Date.now(),
          data: {} 
        }));
      }
    }, 10000);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  reconnectWebSocket() {
    if (this.wsReconnectAttempts >= this.maxWsReconnectAttempts) {
      console.warn('⚠️ AllTick WebSocket: превышено число попыток, используем REST API');
      return;
    }

    this.wsReconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.wsReconnectAttempts - 1), 30000);
    
    console.log(`🔄 AllTick WebSocket: переподключение через ${delay}мс (попытка ${this.wsReconnectAttempts})`);
    
    setTimeout(() => {
      this.connectWebSocket();
    }, delay);
  }

  // ═══════════════════════════════════════════════════════
  // REST API ОБНОВЛЕНИЕ
  // ═══════════════════════════════════════════════════════

  startRestUpdates() {
    console.log('📡 AllTick REST: запуск обновлений...');
    
    // Немедленное обновление
    this.updateRestPrices();
    
    // Периодическое обновление каждые 30 секунд
    setInterval(() => {
      this.updateRestPrices();
    }, 30000);
  }

  async updateRestPrices() {
    for (const code of this.symbols) {
      // Не обновляем через REST если есть свежая цена из WebSocket
      const cached = this.priceCache.get(code);
      if (cached && Date.now() - cached.timestamp < 25000 && cached.data.source === 'alltick_ws') {
        continue;
      }

      const success = await this.fetchRestPrice(code);
      
      // Если REST не сработал (429) - пробуем Backup
      if (!success && code !== 'GOLD') {  // GOLD ждём от AllTick
        await this.fetchBackupPrice(code);
      }
    }
  }

  async fetchRestPrice(code) {
    try {
      const query = {
        data: {
          code: code,
          kline_type: 1,
          kline_timestamp_end: 0,
          query_kline_num: 1,
          adjust_type: 0
        }
      };

      const encodedQuery = encodeURIComponent(JSON.stringify(query));
      const url = `${this.restUrl}/quote-b-api/kline?token=${this.token}&query=${encodedQuery}`;

      const response = await axios.get(url, { timeout: 5000 });

      if (response.data.ret === 200 && response.data.data?.kline_list?.length > 0) {
        const kline = response.data.data.kline_list[0];
        
        this.updateCache(code, {
          price: kline.close_price,
          high: kline.high_price,
          low: kline.low_price,
          open: kline.open_price,
          time: new Date(kline.timestamp * 1000),
          code: code,
          source: 'alltick_rest'
        });

        this.restErrorCount = 0;
        console.log(`📊 AllTick REST: ${code} = ${kline.close_price}`);
        return true;
      } else {
        console.error(`❌ AllTick REST: ${code} - ${response.data.msg || 'error'}`);
        this.restErrorCount++;
        return false;
      }
    } catch (error) {
      console.error(`❌ AllTick REST: ${code} - ${error.message}`);
      this.restErrorCount++;
      return false;
    }
  }

  /**
   * Получить цену из Backup API
   */
  async fetchBackupPrice(code) {
    console.log(`🔄 Backup API: запрос ${code}`);
    
    let data = null;
    
    switch (code) {
      case 'GOLD': data = await backupService.getGoldPrice(); break;
      case 'EURUSD': data = await backupService.getEURUSD(); break;
      case 'GBPUSD': data = await backupService.getGBPUSD(); break;
      case 'USDJPY': data = await backupService.getUSDJPY(); break;
      case 'AUDUSD': data = await backupService.getAUDUSD(); break;
      case 'BTCUSD': data = await backupService.getBTCUSD(); break;
      case 'SILVER': data = await backupService.getSilverPrice(); break;
      case 'WTI': data = await backupService.getWTIPrice(); break;
    }
    
    if (data) {
      this.updateCache(code, {
        price: data.price,
        high: data.price,
        low: data.price,
        open: data.price,
        time: data.time,
        code: data.code || data.symbol,
        source: data.source
      });
      console.log(`✅ Backup API: ${code} = ${data.price} (${data.source})`);
      return true;
    }
    
    console.log(`❌ Backup API: ${code} - нет данных`);
    return false;
  }

  // ═══════════════════════════════════════════════════════
  // ОБЩИЙ КЭШ И МЕТОДЫ
  // ═══════════════════════════════════════════════════════

  updateCache(code, data) {
    const oldData = this.priceCache.get(code);
    
    // Не обновляем если данные старше текущих в кэше
    if (oldData && data.source !== 'alltick_ws' && oldData.data.source === 'alltick_ws') {
      return;
    }

    this.priceCache.set(code, {
      data,
      timestamp: Date.now()
    });

    this.emit('price_update', data);
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
    const isStale = age > this.cacheTimeout;
    
    return {
      symbol: cached.data.code,
      price: parseFloat(cached.data.price),
      high: parseFloat(cached.data.high),
      low: parseFloat(cached.data.low),
      open: parseFloat(cached.data.open),
      time: cached.data.time,
      age: age,
      isStale: isStale,
      source: cached.data.source,
      formatted: `$${parseFloat(cached.data.price).toLocaleString('ru-RU', { minimumFractionDigits: 2 })}`
    };
  }

  /**
   * Получить статус сервиса
   */
  getStatus() {
    return {
      websocket: this.wsConnected,
      rest: this.restErrorCount < 5,
      cacheSize: this.priceCache.size,
      restErrors: this.restErrorCount,
      wsReconnects: this.wsReconnectAttempts
    };
  }

  /**
   * Проверка здоровья (каждые 2 минуты)
   */
  startHealthCheck() {
    this.wsHealthCheck = setInterval(() => {
      const status = this.getStatus();
      console.log(`[HEALTH] WS: ${status.websocket ? '✅' : '❌'}, REST: ${status.rest ? '✅' : '❌'}, Cache: ${status.cacheSize}`);
      
      // Если WebSocket не работает после 5 попыток - пробуем сбросить
      if (!status.websocket && this.wsReconnectAttempts >= 5) {
        console.log('🔄 Сброс WebSocket...');
        this.wsReconnectAttempts = 0;
        this.connectWebSocket();
      }
    }, 120000);
  }

  /**
   * Закрыть соединение
   */
  disconnect() {
    console.log('🛑 AllTick Hybrid: остановка...');
    
    this.stopHeartbeat();
    
    if (this.wsHealthCheck) {
      clearInterval(this.wsHealthCheck);
      this.wsHealthCheck = null;
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.wsConnected = false;
    this.priceCache.clear();
  }
}

module.exports = new AllTickHybridService();
