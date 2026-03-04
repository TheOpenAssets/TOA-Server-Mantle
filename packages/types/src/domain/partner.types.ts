export enum PartnerLoanStatus {
  ACTIVE = 'ACTIVE',
  REPAID = 'REPAID',
  DEFAULTED = 'DEFAULTED',
  LIQUIDATED = 'LIQUIDATED',
}

export enum RepaymentSource {
  USER = 'USER',
  PARTNER = 'PARTNER',
  LIQUIDATION = 'LIQUIDATION',
}

export enum PartnerStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  INACTIVE = 'INACTIVE',
}

export enum PartnerTier {
  BASIC = 'BASIC',
  PREMIUM = 'PREMIUM',
  ENTERPRISE = 'ENTERPRISE',
}
