export interface PurchaseHistoryItem {
  buyer: string;
  tokenAmount: string;
  price: string;
  totalPayment: string;
  timestamp: Date;
  transactionHash: string;
  type: 'PURCHASE' | 'BID'; // Whether from direct purchase or auction bid
}

export interface ChartDataPoint {
  timestamp: Date;
  tokensPurchased: string; // Tokens in this transaction
  cumulativeTokens: string; // Running total
  price: string; // Price per token
}

export interface PurchaseHistoryResponse {
  assetId: string;
  assetType: 'STATIC' | 'AUCTION';
  purchases: PurchaseHistoryItem[];
  chartData: ChartDataPoint[];
  totalTokensSold: string;
  totalUSDCRaised: string;
  totalTransactions: number;
  metadata: {
    totalSupply: string;
    percentageSold: number;
    averagePrice: string;
    firstPurchaseAt?: Date;
    lastPurchaseAt?: Date;
  };
}
