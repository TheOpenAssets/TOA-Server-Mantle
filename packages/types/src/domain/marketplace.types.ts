export enum OrderStatus {
  OPEN = 'OPEN',
  FILLED = 'FILLED',
  CANCELLED = 'CANCELLED',
}

export enum ListingType {
  STATIC = 'STATIC',
  AUCTION = 'AUCTION',
}

export enum BidStatus {
  PENDING = 'PENDING',
  PLACED = 'PLACED',
  FINALIZED = 'FINALIZED',
  WON = 'WON',
  LOST = 'LOST',
  SETTLED = 'SETTLED',
  REFUNDED = 'REFUNDED',
}
