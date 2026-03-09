const axios = require('axios');
const backupService = require('./backupQuotesService');

class AllTickService {
  constructor() {
    this.token = '6ad5b80cc89eac49b0e58c98e3506afe-c-app';
    this.baseUrl = 'https://quote.alltick.io';
    
    // Кэш для хранения последних цен
    this.priceCache = new Map();
    this.cacheTimeout = 30000; // 30 секунд
    
    // Счётчик ошибок для переключения на резерв
    this.errorCount = 0;
    this.useBackup = false;
  }

  /**
   * Получить цену инструмента (REST API) с резервом
   * @param {string} code - код инструмента (GOLD, EURUSD и т.д.)
   */
  async getPrice(code) {
    // Если AllTick не работает - используем резерв
    if (this.useBackup) {
      return await this.getBackupPrice(code);
    }

    try {
      // Проверяем кэш
      const cached = this.priceCache.get(code);
      if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
        console.log(`[ALLTICK] ${code}: из кэша`);
        return cached.data;
      }

      // Формируем запрос
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
      const url = `${this.baseUrl}/quote-b-api/kline?token=${this.token}&query=${encodedQuery}`;

      const response = await axios.get(url, { timeout: 5000 });

      if (response.data.ret === 200 && response.data.data?.kline_list?.length > 0) {
        const kline = response.data.data.kline_list[0];
        
        const data = {
          price: kline.close_price,
          high: kline.high_price,
          low: kline.low_price,
          open: kline.open_price,
          time: new Date(kline.timestamp * 1000),
          code: code,
          source: 'alltick'
        };

        // Сохраняем в кэш
        this.priceCache.set(code, {
          data,
          timestamp: Date.now()
        });

        // Сбрасываем счётчик ошибок при успехе
        this.errorCount = 0;
        this.useBackup = false;

        console.log(`[ALLTICK] ${code}: ${data.price}`);
        return data;
      } else {
        // Ошибка от API
        console.error(`[ALLTICK ERROR] ${code}:`, response.data);
        this.errorCount++;
        this.checkFallback();
        return await this.getBackupPrice(code);
      }
    } catch (error) {
      console.error(`[ALLTICK ERROR] ${code}:`, error.message);
      this.errorCount++;
      this.checkFallback();
      return await this.getBackupPrice(code);
    }
  }

  /**
   * Проверить是否需要 переключиться на резерв
   */
  checkFallback() {
    if (this.errorCount >= 3) {
      console.warn('⚠️ AllTick не работает, переключаюсь на резервные API');
      this.useBackup = true;
    }
  }

  /**
   * Получить цену из резервного API
   */
  async getBackupPrice(code) {
    console.log(`[BACKUP] Запрос ${code} из резервного API`);
    
    try {
      let data = null;

      switch (code) {
        case 'GOLD':
          data = await backupService.getGoldPrice();
          break;
        case 'EURUSD':
          data = await backupService.getEURUSD();
          break;
        case 'BTCUSD':
          data = await backupService.getBTCUSD();
          break;
        case 'SILVER':
          data = await backupService.getSilverPrice();
          break;
        case 'WTI':
          data = await backupService.getWTIPrice();
          break;
        default:
          console.log(`[BACKUP] Нет данных для ${code}`);
      }

      if (data) {
        data.source = data.source || 'backup';
        
        // Сохраняем в кэш
        this.priceCache.set(code, {
          data,
          timestamp: Date.now()
        });

        return data;
      }

      return null;
    } catch (error) {
      console.error(`[BACKUP ERROR] ${code}:`, error.message);
      return null;
    }
  }

  /**
   * Получить цены нескольких инструментов
   */
  async getPrices(codes) {
    const results = {};
    for (const code of codes) {
      results[code] = await this.getPrice(code);
    }
    return results;
  }

  /**
   * Проверить статус API
   */
  getStatus() {
    return {
      alltick: !this.useBackup,
      backup: this.useBackup,
      errorCount: this.errorCount
    };
  }

  /**
   * Сбросить кэш и попробовать AllTick снова
   */
  reset() {
    this.errorCount = 0;
    this.useBackup = false;
    this.priceCache.clear();
    console.log('[ALLTICK] Сброс: попытка подключения к AllTick');
  }

  /**
   * Очистить кэш
   */
  clearCache() {
    this.priceCache.clear();
  }
}

module.exports = new AllTickService();
