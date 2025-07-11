const { TrustLogiQ, TradingBot } = require('./trustlogiq-system');

exports.handler = async (event, context) => {
  const bot = new TradingBot();
  
  try {
    await bot.run();
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Analysis complete' })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
