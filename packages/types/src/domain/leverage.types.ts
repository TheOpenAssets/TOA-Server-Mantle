export enum LeveragePositionStatus {
  ACTIVE = 'ACTIVE',
  LIQUIDATED = 'LIQUIDATED',
  SETTLED = 'SETTLED',
  CLOSED = 'CLOSED',
}

export enum LeveragePositionHealth {
  HEALTHY = 'HEALTHY',
  WARNING = 'WARNING',
  CRITICAL = 'CRITICAL',
  LIQUIDATABLE = 'LIQUIDATABLE',
}
