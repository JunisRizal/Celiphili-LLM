const fetch = require('node-fetch');

class TrustLogiQ {
  constructor() {
    this.apiKey = 'a321dcf29f8e456d9ec932738c4c4954';
    this.baseUrl = 'https://open-api.coinglass.com/public/v2';
    this.confidenceThreshold = 0.75;
    this.minTradeConfidence = 0.6;
    this.penaltyDecay = 0.95;
    this.adaptationRate = 0.02;
    this.penaltyPoints = {
      liquidations: 0,
      fundingRate: 0,
      longShortRatio: 0,
      openInterest: 0
    };
  }

  async fetchCoinglass(endpoint, params = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'CG-API-KEY': this.apiKey,
      'Content-Type': 'application/json'
    };
    
    try {
      const response = await fetch(url, { headers });
      return await response.json();
    } catch (error) {
      console.error(`API Error: ${error}`);
      return null;
    }
  }

  async getMarketData(symbol) {
    const [liquidations, funding, ratio, oi] = await Promise.all([
      this.fetchCoinglass('/liquidation/chart', { symbol, time: '1h' }),
      this.fetchCoinglass('/funding_rate', { symbol }),
      this.fetchCoinglass('/global_long_short', { symbol }),
      this.fetchCoinglass('/open_interest/chart', { symbol, time: '4h' })
    ]);

    return {
      liquidations: this.parseLiquidations(liquidations),
      fundingRate: funding?.data?.[0]?.rate || 0,
      longShortRatio: ratio?.data?.longShortRatio || 1,
      openInterest: this.calculateOIChange(oi)
    };
  }

  parseLiquidations(data) {
    if (!data?.data) return 0;
    const recent = data.data.slice(-1)[0];
    return (recent?.buyVol || 0) - (recent?.sellVol || 0);
  }

  calculateOIChange(data) {
    if (!data?.data || data.data.length < 2) return 0;
    const current = data.data[data.data.length - 1]?.value || 0;
    const previous = data.data[data.data.length - 2]?.value || 1;
    return ((current - previous) / previous) * 100;
  }

  normalizeToSignal(value, key) {
    const thresholds = {
      liquidations: { bull: 50000000, bear: -50000000 },
      fundingRate: { bull: -0.03, bear: 0.05 },
      longShortRatio: { bull: 0.85, bear: 1.15 },
      openInterest: { bull: 10, bear: -10 }
    };

    const t = thresholds[key];
    if (!t) return 0;

    switch(key) {
      case 'liquidations':
        return value > t.bull ? 1 : value < t.bear ? -1 : value / t.bull;
      case 'fundingRate':
        return value < t.bull ? 1 : value > t.bear ? -1 : -value / t.bear;
      case 'longShortRatio':
        return value < t.bull ? 1 : value > t.bear ? -1 : (1 - value) * 5;
      case 'openInterest':
        return value > t.bull ? 1 : value < t.bear ? -1 : value / t.bull;
      default:
        return 0;
    }
  }

  calculateConfidence(inputs) {
    let weightedScore = 0;
    let totalWeight = 0;
    
    Object.entries(inputs).forEach(([key, value]) => {
      const weight = Math.max(0.1, 1 - this.penaltyPoints[key]);
      const signal = this.normalizeToSignal(value, key);
      weightedScore += signal * weight;
      totalWeight += weight;
    });
    
    return totalWeight > 0 ? weightedScore / totalWeight : 0;
  }

  getRecommendation(confidence) {
    if (Math.abs(confidence) >= this.confidenceThreshold) {
      return { action: confidence > 0 ? "LONG" : "SHORT", execute: true };
    }
    if (Math.abs(confidence) >= this.minTradeConfidence) {
      return { action: confidence > 0 ? "LONG" : "SHORT", execute: false };
    }
    return { action: "HOLD", execute: false };
  }

  adaptSystem(correct, inputs) {
    Object.keys(inputs).forEach(key => {
      if (correct) {
        this.penaltyPoints[key] *= this.penaltyDecay;
      } else {
        this.penaltyPoints[key] += 0.05;
      }
    });
  }

  async analyze(symbol) {
    const marketData = await this.getMarketData(symbol);
    const confidence = this.calculateConfidence(marketData);
    const recommendation = this.getRecommendation(confidence);
    
    return {
      symbol,
      confidence,
      recommendation,
      data: marketData,
      timestamp: new Date().toISOString()
    };
  }
}

class AlertSystem {
  constructor(botToken, chatId) {
    this.botToken = botToken || process.env.TELEGRAM_BOT_TOKEN;
    this.chatId = chatId || process.env.TELEGRAM_CHAT_ID;
    this.telegramUrl = `https://api.telegram.org/bot${this.botToken}`;
  }

  async sendAlert(message) {
    console.log(`ALERT: ${message}`);
    // Telegram integration will be added later
  }
}

class TradingBot {
  constructor() {
    this.trustlogiq = new TrustLogiQ();
    this.symbols = ['BTC', 'ETH', 'SOL'];
    this.alerts = new AlertSystem();
    this.tradeHistory = [];
  }

  async run() {
    console.log(`[${new Date().toISOString()}] Running analysis...`);
    
    for (const symbol of this.symbols) {
      try {
        const analysis = await this.trustlogiq.analyze(symbol);
        
        if (analysis.recommendation.execute) {
          const alert = `🚨 ${symbol} SIGNAL
Action: ${analysis.recommendation.action}
Confidence: ${(analysis.confidence * 100).toFixed(1)}%
Liquidations: $${(analysis.data.liquidations / 1e6).toFixed(2)}M
Funding: ${(analysis.data.fundingRate * 100).toFixed(3)}%
L/S Ratio: ${analysis.data.longShortRatio.toFixed(3)}
OI Change: ${analysis.data.openInterest.toFixed(2)}%`;
          
          await this.alerts.sendAlert(alert);
          this.tradeHistory.push(analysis);
        }
        
        console.log(`${symbol}: ${analysis.recommendation.action} (${(analysis.confidence * 100).toFixed(1)}%)`);
      } catch (error) {
        console.error(`Error analyzing ${symbol}:`, error);
      }
    }
  }
}

module.exports = { TrustLogiQ, TradingBot };
