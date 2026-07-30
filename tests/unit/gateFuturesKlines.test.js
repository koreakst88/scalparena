const axios = require('axios');
const { BybitDataProvider } = require('../../src/data/bybitProvider');

console.log('Gate Futures Klines Test\n');

const originalGet = axios.get;
const nowSeconds = Math.floor(Date.now() / 1000);
axios.get = async (_url, options) => ({
  data: [
    {
      t: nowSeconds - 7200,
      o: '10',
      h: '12',
      l: '9',
      c: '11',
      v: '100',
      sum: '1100',
    },
  ],
  requestOptions: options,
});

const provider = new BybitDataProvider();

provider.getGateFuturesKlines('DEXEUSDT', '60', 200)
  .then((candles) => {
    const candle = candles[0];
    const checks = [
      {
        name: 'Gate response is normalized to common candle shape',
        pass: candles.length === 1 &&
          candle.open === 10 &&
          candle.high === 12 &&
          candle.low === 9 &&
          candle.close === 11 &&
          candle.turnover === 1100,
      },
      {
        name: 'Gate timestamp is converted from seconds to milliseconds',
        pass: candle.timestamp === (nowSeconds - 7200) * 1000,
      },
      {
        name: 'Gate timeframe conversion supports hourly structure data',
        pass: provider._toGateInterval('60') === '1h' &&
          provider._toGateInterval('240') === '4h',
      },
    ];

    checks.forEach((check) => console.log(`   ${check.pass ? 'PASS' : 'FAIL'} ${check.name}`));
    const allPassed = checks.every((check) => check.pass);
    axios.get = originalGet;
    console.log(`\n${allPassed ? 'ALL PASSED' : 'SOME FAILED'}\n`);
    process.exit(allPassed ? 0 : 1);
  })
  .catch((error) => {
    axios.get = originalGet;
    console.error(error);
    process.exit(1);
  });
