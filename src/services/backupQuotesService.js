const axios = require('axios');

/**
 * Резервные API для котировок
 * FMP → Alpha Vantage → CoinGecko
 */
class BackupQuotesService {
  constructor() {
    // Financial Modeling Prep
    this.fmpKey = process.env.FMP_API_KEY || 'demo';
    this.fmpUrl = 'https://financialmodelingprep.com/api/v3';
    
    // Alpha Vantage
    this.alphaKey = process.env.ALPHA_VANTAGE_KEY || 'demo';
    this.alphaUrl = 'https://www.alphavantage.co/query';
    
    // CoinGecko (без ключа)
    this.coinGeckoUrl = 'https://api.coingecko.com/api/v3';
    
    // Кэш
    this.cache = new Map();
    this.cacheTimeout = 60000; // 1 минута
  }

  /**
   * Получить цену золота (Alpha Vantage Commodities)
   */
  async getGoldPrice() {
    const cached = this.cache.get('GOLD');
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    // Alpha Vantage Commodities (правильная функция)
    try {
      const response = await axios.get(
        `${this.alphaUrl}?function=GOLD&apikey=${this.alphaKey}`,
        { timeout: 5000 }
      );

      if (response.data['Realtime Currency Exchange Rate']) {
        const rate = response.data['Realtime Currency Exchange Rate'];
        const data = {
          symbol: 'GOLD',
          price: parseFloat(rate['5. Exchange Rate']),
          time: new Date(),
          source: 'alpha_vantage'
        };
        
        this.cache.set('GOLD', { data, timestamp: Date.now() });
        console.log(`[BACKUP] GOLD из Alpha Vantage: ${data.price}`);
        return data;
      }
    } catch (e) {
      console.log('[BACKUP] Alpha Vantage GOLD failed:', e.message);
    }

    return null;
  }

  /**
   * Получить цену серебра (Alpha Vantage Commodities)
   */
  async getSilverPrice() {
    const cached = this.cache.get('SILVER');
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    try {
      const response = await axios.get(
        `${this.alphaUrl}?function=SILVER&apikey=${this.alphaKey}`,
        { timeout: 5000 }
      );

      if (response.data['Realtime Currency Exchange Rate']) {
        const rate = response.data['Realtime Currency Exchange Rate'];
        const data = {
          symbol: 'SILVER',
          price: parseFloat(rate['5. Exchange Rate']),
          time: new Date(),
          source: 'alpha_vantage'
        };
        
        this.cache.set('SILVER', { data, timestamp: Date.now() });
        console.log(`[BACKUP] SILVER из Alpha Vantage: ${data.price}`);
        return data;
      }
    } catch (e) {
      console.log('[BACKUP] Alpha Vantage SILVER failed:', e.message);
    }

    return null;
  }

  /**
   * Получить цену нефти WTI (Alpha Vantage Commodities)
   */
  async getWTIPrice() {
    const cached = this.cache.get('WTI');
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    try {
      const response = await axios.get(
        `${this.alphaUrl}?function=WTI&apikey=${this.alphaKey}`,
        { timeout: 5000 }
      );

      if (response.data['Realtime Currency Exchange Rate']) {
        const rate = response.data['Realtime Currency Exchange Rate'];
        const data = {
          symbol: 'WTI',
          price: parseFloat(rate['5. Exchange Rate']),
          time: new Date(),
          source: 'alpha_vantage'
        };
        
        this.cache.set('WTI', { data, timestamp: Date.now() });
        console.log(`[BACKUP] WTI из Alpha Vantage: ${data.price}`);
        return data;
      }
    } catch (e) {
      console.log('[BACKUP] Alpha Vantage WTI failed:', e.message);
    }

    return null;
  }

  /**
   * Получить EUR/USD
   */
  async getEURUSD() {
    const cached = this.cache.get('EURUSD');
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    // Alpha Vantage
    try {
      const response = await axios.get(
        `${this.alphaUrl}?function=CURRENCY_EXCHANGE_RATE&from_currency=EUR&to_currency=USD&apikey=${this.alphaKey}`,
        { timeout: 5000 }
      );
      
      if (response.data['Realtime Currency Exchange Rate']) {
        const rate = response.data['Realtime Currency Exchange Rate'];
        const data = {
          symbol: 'EURUSD',
          price: parseFloat(rate['5. Exchange Rate']),
          time: new Date(),
          source: 'alpha_vantage'
        };
        
        this.cache.set('EURUSD', { data, timestamp: Date.now() });
        console.log(`[BACKUP] EURUSD из Alpha Vantage: ${data.price}`);
        return data;
      }
    } catch (e) {
      console.log('[BACKUP] Alpha Vantage EURUSD failed:', e.message);
    }

    return null;
  }

  /**
   * Получить GBP/USD
   */
  async getGBPUSD() {
    const cached = this.cache.get('GBPUSD');
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    try {
      const response = await axios.get(
        `${this.alphaUrl}?function=CURRENCY_EXCHANGE_RATE&from_currency=GBP&to_currency=USD&apikey=${this.alphaKey}`,
        { timeout: 5000 }
      );
      
      if (response.data['Realtime Currency Exchange Rate']) {
        const rate = response.data['Realtime Currency Exchange Rate'];
        const data = {
          symbol: 'GBPUSD',
          price: parseFloat(rate['5. Exchange Rate']),
          time: new Date(),
          source: 'alpha_vantage'
        };
        
        this.cache.set('GBPUSD', { data, timestamp: Date.now() });
        console.log(`[BACKUP] GBPUSD из Alpha Vantage: ${data.price}`);
        return data;
      }
    } catch (e) {
      console.log('[BACKUP] Alpha Vantage GBPUSD failed:', e.message);
    }

    return null;
  }

  /**
   * Получить USD/JPY
   */
  async getUSDJPY() {
    const cached = this.cache.get('USDJPY');
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    try {
      const response = await axios.get(
        `${this.alphaUrl}?function=CURRENCY_EXCHANGE_RATE&from_currency=USD&to_currency=JPY&apikey=${this.alphaKey}`,
        { timeout: 5000 }
      );
      
      if (response.data['Realtime Currency Exchange Rate']) {
        const rate = response.data['Realtime Currency Exchange Rate'];
        const data = {
          symbol: 'USDJPY',
          price: parseFloat(rate['5. Exchange Rate']),
          time: new Date(),
          source: 'alpha_vantage'
        };
        
        this.cache.set('USDJPY', { data, timestamp: Date.now() });
        console.log(`[BACKUP] USDJPY из Alpha Vantage: ${data.price}`);
        return data;
      }
    } catch (e) {
      console.log('[BACKUP] Alpha Vantage USDJPY failed:', e.message);
    }

    return null;
  }

  /**
   * Получить AUD/USD
   */
  async getAUDUSD() {
    const cached = this.cache.get('AUDUSD');
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    try {
      const response = await axios.get(
        `${this.alphaUrl}?function=CURRENCY_EXCHANGE_RATE&from_currency=AUD&to_currency=USD&apikey=${this.alphaKey}`,
        { timeout: 5000 }
      );
      
      if (response.data['Realtime Currency Exchange Rate']) {
        const rate = response.data['Realtime Currency Exchange Rate'];
        const data = {
          symbol: 'AUDUSD',
          price: parseFloat(rate['5. Exchange Rate']),
          time: new Date(),
          source: 'alpha_vantage'
        };
        
        this.cache.set('AUDUSD', { data, timestamp: Date.now() });
        console.log(`[BACKUP] AUDUSD из Alpha Vantage: ${data.price}`);
        return data;
      }
    } catch (e) {
      console.log('[BACKUP] Alpha Vantage AUDUSD failed:', e.message);
    }

    return null;
  }

  /**
   * Получить BTC/USD (CoinGecko)
   */
  async getBTCUSD() {
    const cached = this.cache.get('BTCUSD');
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    try {
      const response = await axios.get(
        `${this.coinGeckoUrl}/simple/price?ids=bitcoin&vs_currencies=usd`,
        { timeout: 5000 }
      );

      if (response.data.bitcoin && response.data.bitcoin.usd) {
        const data = {
          symbol: 'BTCUSD',
          price: response.data.bitcoin.usd,
          time: new Date(),
          source: 'coingecko'
        };

        this.cache.set('BTCUSD', { data, timestamp: Date.now() });
        console.log(`[BACKUP] BTCUSD из CoinGecko: ${data.price}`);
        return data;
      }
    } catch (e) {
      console.log('[BACKUP] CoinGecko BTCUSD failed:', e.message);
    }

    return null;
  }

  /**
   * Получить все доступные цены
   */
  async getAllPrices() {
    const results = {};
    const symbols = ['GOLD', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'BTCUSD', 'SILVER', 'WTI'];
    
    for (const symbol of symbols) {
      switch (symbol) {
        case 'GOLD': results[symbol] = await this.getGoldPrice(); break;
        case 'EURUSD': results[symbol] = await this.getEURUSD(); break;
        case 'GBPUSD': results[symbol] = await this.getGBPUSD(); break;
        case 'USDJPY': results[symbol] = await this.getUSDJPY(); break;
        case 'AUDUSD': results[symbol] = await this.getAUDUSD(); break;
        case 'BTCUSD': results[symbol] = await this.getBTCUSD(); break;
        case 'SILVER': results[symbol] = await this.getSilverPrice(); break;
        case 'WTI': results[symbol] = await this.getWTIPrice(); break;
      }
    }
    
    return results;
  }

  /**
   * Очистить кэш
   */
  clearCache() {
    this.cache.clear();
  }
}

module.exports = new BackupQuotesService();
