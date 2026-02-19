#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, symbol_short, token::TokenClient, Address, Env, String,
};

const LEDGER_THRESHOLD_SHARED: u32 = 5110400; // 30 days in ledgers
const LEDGER_BUMP_SHARED: u32 = 15724800; // 90 days in ledgers (3 years / 12)

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Settlement {
    pub asset_code: String,
    pub asset_issuer: Address,
    pub total_settlement_usdc: i128, // In stroops (7 decimals)
    pub total_supply_snapshot: i128, // Token supply at settlement time
    pub claimed_tokens: i128,        // Cumulative tokens burned
    pub claimed_usdc: i128,          // Cumulative USDC claimed
    pub settled_at: u64,             // Unix timestamp
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SettlementInfo {
    pub total_settlement: i128,
    pub supply_snapshot: i128,
    pub claimed_tokens: i128,
    pub claimed_usdc: i128,
    pub remaining_usdc: i128,
    pub yield_per_token: i128,
    pub settled_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Platform,                         // Platform admin address
    UsdcAsset,                        // USDC Stellar Asset Contract address
    Settlement(String),               // asset_code -> Settlement
    UserLastClaim((String, Address)), // (asset_code, user) -> timestamp
}

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    SettlementExists = 4,
    SettlementNotFound = 5,
    InvalidAmount = 6,
    ZeroSupply = 7,
    InsufficientVault = 8,
    Overflow = 9,
}

#[contract]
pub struct YieldVault;

#[contractimpl]
impl YieldVault {
    /// Initialize the YieldVault contract
    ///
    /// # Arguments
    /// * `platform` - Platform admin address (only account that can deposit settlements)
    /// * `usdc_asset` - USDC Stellar Asset Contract address
    pub fn init(env: Env, platform: Address, usdc_asset: Address) {
        if env.storage().instance().has(&DataKey::Platform) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Platform, &platform);
        env.storage().instance().set(&DataKey::UsdcAsset, &usdc_asset);
    }

    /// Deposit settlement for an asset
    ///
    /// Only callable by platform admin. Snapshots the current total supply of the asset,
    /// transfers USDC from platform to this contract, and records the settlement.
    ///
    /// # Arguments
    /// * `asset_code` - The asset code (e.g., "RWA-INV001")
    /// * `asset_issuer` - The issuer address of the RWA token (for reference)
    /// * `settlement_amount` - Amount of USDC to distribute (in stroops)
    /// * `total_supply` - Current total supply of the token (for snapshot)
    pub fn deposit_settlement(
        env: Env,
        platform: Address,
        asset_code: String,
        asset_issuer: Address,
        settlement_amount: i128,
        total_supply: i128,
    ) {
        platform.require_auth();

        let stored_platform: Address = env
            .storage()
            .instance()
            .get(&DataKey::Platform)
            .expect("not initialized");

        if platform != stored_platform {
            panic!("only platform can deposit settlements");
        }

        // Check settlement doesn't already exist
        if env
            .storage()
            .persistent()
            .has(&DataKey::Settlement(asset_code.clone()))
        {
            panic!("settlement already exists for this asset");
        }

        // Validate settlement amount
        if settlement_amount <= 0 {
            panic!("settlement amount must be positive");
        }

        // Validate total supply
        if total_supply <= 0 {
            panic!("token supply must be positive");
        }

        // Transfer USDC from platform to this contract
        let usdc_asset: Address = env
            .storage()
            .instance()
            .get(&DataKey::UsdcAsset)
            .expect("usdc not configured");

        let usdc_client = TokenClient::new(&env, &usdc_asset);
        usdc_client.transfer(&platform, &env.current_contract_address(), &settlement_amount);

        // Create settlement record
        let settlement = Settlement {
            asset_code: asset_code.clone(),
            asset_issuer: asset_issuer.clone(),
            total_settlement_usdc: settlement_amount,
            total_supply_snapshot: total_supply,
            claimed_tokens: 0,
            claimed_usdc: 0,
            settled_at: env.ledger().timestamp(),
        };

        // Store settlement
        env.storage()
            .persistent()
            .set(&DataKey::Settlement(asset_code.clone()), &settlement);

        // Extend TTL for settlement record (30 days threshold, 90 days bump)
        env.storage().persistent().extend_ttl(
            &DataKey::Settlement(asset_code.clone()),
            LEDGER_THRESHOLD_SHARED,
            LEDGER_BUMP_SHARED,
        );

        // Emit settlement deposited event
        env.events().publish(
            (symbol_short!("deposit"),),
            (asset_code, settlement_amount, total_supply, env.ledger().timestamp()),
        );
    }

    /// Claim yield by burning tokens
    ///
    /// Investors burn their RWA tokens to receive their proportional share of the settlement USDC.
    /// Formula: usdc_amount = (tokens_to_burn * total_settlement) / supply_snapshot
    ///
    /// # Arguments
    /// * `asset_code` - The asset code
    /// * `asset_issuer` - The issuer address of the RWA token
    /// * `token_amount` - Number of tokens to burn
    /// * `claimer` - Address of the investor claiming yield
    ///
    /// # Returns
    /// Amount of USDC transferred to the claimer
    pub fn claim_yield(
        env: Env,
        asset_code: String,
        asset_issuer: Address,
        token_amount: i128,
        claimer: Address,
    ) -> i128 {
        claimer.require_auth();

        // Validate token amount
        if token_amount <= 0 {
            panic!("token amount must be positive");
        }

        // Get settlement record
        let mut settlement: Settlement = env
            .storage()
            .persistent()
            .get(&DataKey::Settlement(asset_code.clone()))
            .expect("settlement not found");

        // Calculate pro-rata USDC amount with checked arithmetic
        // usdc_amount = (token_amount * total_settlement) / supply_snapshot
        let numerator = settlement
            .total_settlement_usdc
            .checked_mul(token_amount)
            .expect("overflow in calculation");

        let usdc_amount = numerator
            .checked_div(settlement.total_supply_snapshot)
            .expect("division by zero");

        if usdc_amount <= 0 {
            panic!("claim amount too small");
        }

        // Verify sufficient USDC remaining in vault
        let remaining = settlement.total_settlement_usdc - settlement.claimed_usdc;
        if usdc_amount > remaining {
            panic!("insufficient vault balance");
        }

        // Burn tokens: transfer to issuer (Stellar's native burn pattern)
        let token_client = TokenClient::new(&env, &asset_issuer);
        token_client.transfer(&claimer, &asset_issuer, &token_amount);

        // Transfer USDC to claimer
        let usdc_asset: Address = env
            .storage()
            .instance()
            .get(&DataKey::UsdcAsset)
            .expect("usdc not configured");

        let usdc_client = TokenClient::new(&env, &usdc_asset);
        usdc_client.transfer(&env.current_contract_address(), &claimer, &usdc_amount);

        // Update settlement claimed amounts
        settlement.claimed_tokens = settlement
            .claimed_tokens
            .checked_add(token_amount)
            .expect("overflow updating claimed tokens");

        settlement.claimed_usdc = settlement
            .claimed_usdc
            .checked_add(usdc_amount)
            .expect("overflow updating claimed usdc");

        env.storage()
            .persistent()
            .set(&DataKey::Settlement(asset_code.clone()), &settlement);

        // Extend TTL for settlement record
        env.storage().persistent().extend_ttl(
            &DataKey::Settlement(asset_code.clone()),
            LEDGER_THRESHOLD_SHARED,
            LEDGER_BUMP_SHARED,
        );

        // Update user last claim timestamp
        let user_claim_key = DataKey::UserLastClaim((asset_code.clone(), claimer.clone()));
        env.storage()
            .persistent()
            .set(&user_claim_key, &env.ledger().timestamp());

        // Extend TTL for user claim record (shorter than settlement)
        env.storage().persistent().extend_ttl(
            &user_claim_key,
            LEDGER_THRESHOLD_SHARED / 2,
            LEDGER_BUMP_SHARED / 2,
        );

        // Emit yield claimed event
        env.events().publish(
            (symbol_short!("claim"),),
            (claimer, asset_code, token_amount, usdc_amount),
        );

        usdc_amount
    }

    /// Get claimable USDC amount for a given token amount (read-only preview)
    ///
    /// # Arguments
    /// * `asset_code` - The asset code
    /// * `token_amount` - Number of tokens that would be burned
    ///
    /// # Returns
    /// Amount of USDC that would be received
    pub fn get_claimable_amount(env: Env, asset_code: String, token_amount: i128) -> i128 {
        let settlement: Settlement = env
            .storage()
            .persistent()
            .get(&DataKey::Settlement(asset_code))
            .expect("settlement not found");

        if token_amount <= 0 {
            return 0;
        }

        // Calculate pro-rata amount
        let numerator = settlement
            .total_settlement_usdc
            .checked_mul(token_amount)
            .unwrap_or(0);

        if numerator == 0 {
            return 0;
        }

        numerator
            .checked_div(settlement.total_supply_snapshot)
            .unwrap_or(0)
    }

    /// Get complete settlement information
    ///
    /// # Arguments
    /// * `asset_code` - The asset code
    ///
    /// # Returns
    /// Complete settlement status including claimed amounts and remaining USDC
    pub fn get_settlement_info(env: Env, asset_code: String) -> Option<SettlementInfo> {
        let settlement_opt: Option<Settlement> =
            env.storage().persistent().get(&DataKey::Settlement(asset_code));

        settlement_opt.map(|s| {
            let remaining = s.total_settlement_usdc - s.claimed_usdc;
            let yield_per_token = if s.total_supply_snapshot > 0 {
                s.total_settlement_usdc
                    .checked_div(s.total_supply_snapshot)
                    .unwrap_or(0)
            } else {
                0
            };

            SettlementInfo {
                total_settlement: s.total_settlement_usdc,
                supply_snapshot: s.total_supply_snapshot,
                claimed_tokens: s.claimed_tokens,
                claimed_usdc: s.claimed_usdc,
                remaining_usdc: remaining,
                yield_per_token,
                settled_at: s.settled_at,
            }
        })
    }

    /// Check if settlement exists for an asset
    ///
    /// # Arguments
    /// * `asset_code` - The asset code
    ///
    /// # Returns
    /// true if settlement exists, false otherwise
    pub fn is_settled(env: Env, asset_code: String) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Settlement(asset_code))
    }

    /// Get user's last claim timestamp
    ///
    /// # Arguments
    /// * `asset_code` - The asset code
    /// * `user` - User address
    ///
    /// # Returns
    /// Timestamp of last claim, or None if user hasn't claimed
    pub fn get_user_last_claim(env: Env, asset_code: String, user: Address) -> Option<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::UserLastClaim((asset_code, user)))
    }

    /// Get platform admin address
    pub fn get_platform(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Platform)
            .expect("not initialized")
    }

    /// Get USDC asset address
    pub fn get_usdc_asset(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::UsdcAsset)
            .expect("not initialized")
    }
}
