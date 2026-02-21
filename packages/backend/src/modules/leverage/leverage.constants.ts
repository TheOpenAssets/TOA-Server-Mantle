/**
 * Injection token for DEX service
 * This allows network-agnostic injection of either FluxionDEXService or ArbitrumDEXService
 */
export const DEX_SERVICE = Symbol('DEX_SERVICE');

/**
 * Injection token for price service
 * This allows network-agnostic injection of either MethPriceService or StArbPriceService
 */
export const PRICE_SERVICE = Symbol('PRICE_SERVICE');
