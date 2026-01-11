# P2P Secondary Market Chart Data API Documentation

## Overview

The P2P Chart Data API provides comprehensive candlestick chart data for secondary market trading activity. It returns **two distinct datasets** to give traders complete market visibility:

1. **Order Book Candles** (Speculative): Shows where traders WANT to trade based on order creation
2. **Trade Candles** (Actual): Shows where trades ACTUALLY executed

## Why Two Datasets?

- **Order Book Candles**: Represents market sentiment, liquidity intentions, and price discovery
- **Trade Candles**: Represents actual executed prices and real trading activity

These can diverge significantly:
- Orders might be placed at $10 but trades execute at $8
- Order book shows supply/demand levels
- Trade chart shows realized prices

## Endpoint

```
GET /marketplace/secondary/:assetId/chart?interval=2m
```

## Request Parameters

### Path Parameters
- `assetId` (required): The UUID of the asset to get chart data for

### Query Parameters
- `interval` (optional, default: `2m`): Time interval for candlestick aggregation

**Supported Intervals:**
- `2m` - 2 minutes (default)
- `5m` - 5 minutes
- `15m` - 15 minutes
- `30m` - 30 minutes
- `1h` - 1 hour
- `4h` - 4 hours
- `1d` - 1 day

## Response Format

```typescript
{
  interval: string;           // The interval used (e.g., "2m")
  intervalMs: number;         // Interval in milliseconds (e.g., 120000)
  orderBookCandles: Candle[]; // Speculative candles from orders
  tradeCandles: Candle[];     // Actual candles from trades
  metadata: {
    orderBookDescription: string;
    tradeDescription: string;
    note: string;
  }
}
```

### Candle Object Structure

#### Order Book Candle
```typescript
{
  time: number;        // Unix timestamp in seconds
  open: number;        // First order price in the time bucket (USD)
  high: number;        // Highest order price in the time bucket (USD)
  low: number;         // Lowest order price in the time bucket (USD)
  close: number;       // Last order price in the time bucket (USD)
  volume: number;      // Total token volume from orders (tokens)
  orderCount: number;  // Total number of orders in this bucket
  buyOrders: number;   // Number of buy orders
  sellOrders: number;  // Number of sell orders
}
```

#### Trade Candle
```typescript
{
  time: number;        // Unix timestamp in seconds
  open: number;        // First trade price in the time bucket (USD)
  high: number;        // Highest trade price in the time bucket (USD)
  low: number;         // Lowest trade price in the time bucket (USD)
  close: number;       // Last trade price in the time bucket (USD)
  volume: number;      // Total token volume traded (tokens)
  totalValue: number;  // Total USDC value of trades (USD)
  tradeCount: number;  // Number of trades in this bucket
}
```

## Example Response

```json
{
  "interval": "2m",
  "intervalMs": 120000,
  "orderBookCandles": [
    {
      "time": 1704729600,
      "open": 0.92,
      "high": 1.00,
      "low": 0.92,
      "close": 1.00,
      "volume": 800.00,
      "orderCount": 2,
      "buyOrders": 1,
      "sellOrders": 1
    },
    {
      "time": 1704729720,
      "open": 2.00,
      "high": 4.00,
      "low": 2.00,
      "close": 4.00,
      "volume": 800.00,
      "orderCount": 3,
      "buyOrders": 1,
      "sellOrders": 2
    }
  ],
  "tradeCandles": [
    {
      "time": 1704729600,
      "open": 1.00,
      "high": 2.00,
      "low": 1.00,
      "close": 2.00,
      "volume": 200.00,
      "totalValue": 300.00,
      "tradeCount": 2
    }
  ],
  "metadata": {
    "orderBookDescription": "Candlesticks based on order creation (market sentiment/liquidity)",
    "tradeDescription": "Candlesticks based on filled trades (actual executed prices)",
    "note": "Order book candles show where traders want to trade, trade candles show where they actually traded"
  }
}
```

## Usage Examples

### Basic Request
```bash
curl -X GET "https://api.example.com/marketplace/secondary/a1594800-9b50-48d7-8a2b-c3c60181b85d/chart?interval=2m"
```

### JavaScript/TypeScript
```typescript
const assetId = 'a1594800-9b50-48d7-8a2b-c3c60181b85d';
const interval = '5m';

const response = await fetch(
  `/marketplace/secondary/${assetId}/chart?interval=${interval}`
);
const chartData = await response.json();

// Use order book candles for speculative view
const orderBookCandles = chartData.orderBookCandles;

// Use trade candles for actual executed prices
const tradeCandles = chartData.tradeCandles;
```

## Frontend Integration Guide

### With Lightweight Charts (TradingView)

```typescript
import { createChart } from 'lightweight-charts';

// 1. Fetch chart data
const response = await fetch(`/marketplace/secondary/${assetId}/chart?interval=2m`);
const data = await response.json();

// 2. Create chart
const chart = createChart(document.getElementById('chart-container'), {
  width: 800,
  height: 400,
});

// 3. Create candlestick series for trades (actual prices)
const tradeSeries = chart.addCandlestickSeries({
  upColor: '#26a69a',
  downColor: '#ef5350',
  borderVisible: false,
  wickUpColor: '#26a69a',
  wickDownColor: '#ef5350',
});

// 4. Set trade data (READY TO USE - NO TRANSFORMATIONS NEEDED)
tradeSeries.setData(data.tradeCandles);

// 5. (Optional) Add order book overlay
const orderBookSeries = chart.addCandlestickSeries({
  upColor: 'rgba(38, 166, 154, 0.3)',
  downColor: 'rgba(239, 83, 80, 0.3)',
  borderVisible: false,
  wickUpColor: 'rgba(38, 166, 154, 0.3)',
  wickDownColor: 'rgba(239, 83, 80, 0.3)',
});

// Set order book data (ALSO READY TO USE)
orderBookSeries.setData(data.orderBookCandles);

// 6. Add volume histogram (optional)
const volumeSeries = chart.addHistogramSeries({
  color: '#26a69a',
  priceFormat: {
    type: 'volume',
  },
  priceScaleId: '',
  scaleMargins: {
    top: 0.8,
    bottom: 0,
  },
});

// Map volume data from trade candles
volumeSeries.setData(
  data.tradeCandles.map(candle => ({
    time: candle.time,
    value: candle.volume,
    color: candle.close >= candle.open ? '#26a69a' : '#ef5350'
  }))
);
```

### With Chart.js

```typescript
import { Chart } from 'chart.js';

const response = await fetch(`/marketplace/secondary/${assetId}/chart?interval=5m`);
const data = await response.json();

// Transform for Chart.js candlestick plugin
const chartjsData = data.tradeCandles.map(candle => ({
  x: new Date(candle.time * 1000), // Convert to Date
  o: candle.open,
  h: candle.high,
  l: candle.low,
  c: candle.close,
}));

const ctx = document.getElementById('myChart');
new Chart(ctx, {
  type: 'candlestick',
  data: {
    datasets: [{
      label: 'Trade Prices',
      data: chartjsData,
    }]
  },
  options: {
    // Chart options
  }
});
```

### With Recharts (React)

```tsx
import { CandlestickChart, Candlestick, XAxis, YAxis, Tooltip } from 'recharts';

function TradingChart({ assetId }) {
  const [chartData, setChartData] = useState(null);

  useEffect(() => {
    fetch(`/marketplace/secondary/${assetId}/chart?interval=15m`)
      .then(res => res.json())
      .then(setChartData);
  }, [assetId]);

  if (!chartData) return <Loading />;

  return (
    <CandlestickChart width={800} height={400} data={chartData.tradeCandles}>
      <XAxis 
        dataKey="time" 
        tickFormatter={(time) => new Date(time * 1000).toLocaleTimeString()}
      />
      <YAxis />
      <Tooltip />
      <Candlestick 
        dataKey="tradeCandles" 
        fill="#8884d8"
        openKey="open"
        closeKey="close"
        highKey="high"
        lowKey="low"
      />
    </CandlestickChart>
  );
}
```

## Data Characteristics

### Time Bucketing
- Orders/trades are grouped into time buckets based on their `blockTimestamp`
- Only buckets with activity are included (no empty candles)
- Timestamps are aligned to bucket boundaries (e.g., 00:00, 00:02, 00:04 for 2m intervals)

### OHLC Calculation
**Open**: First order/trade price in the time bucket
**High**: Maximum order/trade price in the time bucket
**Low**: Minimum order/trade price in the time bucket
**Close**: Last order/trade price in the time bucket

### Volume Calculation
- **Order Book**: Sum of all order `initialAmount` values (tokens being offered)
- **Trades**: Sum of all trade `amount` values (tokens actually traded)

### Data Completeness
- **Order Book Candles**: Includes ALL orders (OPEN, FILLED, CANCELLED)
- **Trade Candles**: Only includes filled trades
- Time gaps mean no activity in that period

## Use Cases

### 1. Price Discovery Chart
Use **orderBookCandles** to show where traders are placing bids/asks
```typescript
// Show order book sentiment
displayChart(chartData.orderBookCandles, {
  title: 'Order Book Activity',
  subtitle: 'Where traders want to trade'
});
```

### 2. Execution Price Chart
Use **tradeCandles** to show actual trade prices
```typescript
// Show actual execution prices
displayChart(chartData.tradeCandles, {
  title: 'Trade Execution Prices',
  subtitle: 'Actual filled trades'
});
```

### 3. Dual Chart View
Show both for complete market view
```typescript
// Overlay both charts
displayDualChart({
  primary: chartData.tradeCandles,
  secondary: chartData.orderBookCandles,
  primaryLabel: 'Trades (Actual)',
  secondaryLabel: 'Orders (Intent)'
});
```

### 4. Market Depth Analysis
Use order book data for depth analysis
```typescript
const latestCandle = chartData.orderBookCandles[chartData.orderBookCandles.length - 1];
const buyPressure = latestCandle.buyOrders / latestCandle.orderCount;
const sellPressure = latestCandle.sellOrders / latestCandle.orderCount;
```

## Performance Notes

- Data is computed on-demand (not cached)
- Larger intervals = fewer candles = faster response
- Consider limiting time range for historical data
- Maximum recommended: 1000 candles per request

## Error Responses

```json
{
  "statusCode": 404,
  "message": "Asset not found",
  "error": "Not Found"
}
```

## Best Practices

1. **Choose Appropriate Intervals**: Match interval to your chart time range
   - Real-time trading: 2m or 5m
   - Day trading: 15m or 30m
   - Long-term analysis: 1h, 4h, or 1d

2. **Handle Empty Data**: Check array lengths before rendering
   ```typescript
   if (chartData.tradeCandles.length === 0) {
     showMessage('No trading activity yet');
   }
   ```

3. **Use Trade Candles for Price**: Always use `tradeCandles` for current price display
   ```typescript
   const lastTrade = chartData.tradeCandles[chartData.tradeCandles.length - 1];
   const currentPrice = lastTrade?.close || 0;
   ```

4. **Combine Both Charts**: Show both for maximum insight
   - Primary: Trade candles (actual prices)
   - Overlay: Order book candles (market intent, semi-transparent)

5. **Add Loading States**: Chart data computation can take time for large datasets

## Summary

The P2P Chart Data API provides production-ready candlestick data that can be directly consumed by charting libraries without any transformations. The dual-dataset approach gives traders both speculative (order book) and actual (trade) views of market activity, enabling sophisticated market analysis and trading decisions.

**Key Benefits:**
✅ Zero transformation needed - ready for charting libraries
✅ Dual datasets for complete market visibility
✅ Flexible time intervals (2m to 1d)
✅ Professional OHLCV format
✅ Includes volume and trade/order counts
✅ Sparse data (only active time periods)
