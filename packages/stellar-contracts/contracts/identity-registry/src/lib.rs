#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Vec};

mod trusted_issuers {
    soroban_sdk::contractimport!(
        file = "../../target/wasm32-unknown-unknown/release/trusted_issuers_registry.wasm"
    );
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Identity {
    pub is_verified: bool,
    pub registered_at: u64,
    pub expires_at: Option<u64>,
    pub kyc_tier: u32,
    pub country_code: String,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    TrustedIssuers,
    Identity(Address),
}

const DAY_IN_SECONDS: u64 = 86400;
const THREE_MONTHS_IN_LEDGERS: u32 = 432000; // Approx if 6s per ledger

#[contract]
pub struct IdentityRegistry;

#[contractimpl]
impl IdentityRegistry {
    pub fn init(env: Env, trusted_issuers: Address) {
        if env.storage().instance().has(&DataKey::TrustedIssuers) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::TrustedIssuers, &trusted_issuers);
    }

    pub fn register_identity(
        env: Env,
        issuer: Address,
        wallet: Address,
        expiry_days: Option<u32>,
        tier: u32,
        country: String,
    ) {
        issuer.require_auth();

        let trusted_issuers_addr: Address = env.storage().instance().get(&DataKey::TrustedIssuers).unwrap();
        let client = trusted_issuers::Client::new(&env, &trusted_issuers_addr);
        
        if !client.is_trusted_issuer(&issuer) {
            panic!("not a trusted issuer");
        }

        let expires_at = expiry_days.map(|days| {
            env.ledger().timestamp() + (days as u64 * DAY_IN_SECONDS)
        });

        let identity = Identity {
            is_verified: true,
            registered_at: env.ledger().timestamp(),
            expires_at,
            kyc_tier: tier,
            country_code: country,
        };

        env.storage().persistent().set(&DataKey::Identity(wallet.clone()), &identity);
        
        // Extend TTL for KYC records
        env.storage().persistent().extend_ttl(&DataKey::Identity(wallet), THREE_MONTHS_IN_LEDGERS, THREE_MONTHS_IN_LEDGERS);
    }

    pub fn is_verified(env: Env, wallet: Address) -> bool {
        let identity_opt: Option<Identity> = env.storage().persistent().get(&DataKey::Identity(wallet));
        
        match identity_opt {
            Some(id) => {
                if !id.is_verified {
                    return false;
                }
                if let Some(expires) = id.expires_at {
                    if env.ledger().timestamp() > expires {
                        return false;
                    }
                }
                true
            }
            None => false,
        }
    }

    pub fn get_identity(env: Env, wallet: Address) -> Option<Identity> {
        env.storage().persistent().get(&DataKey::Identity(wallet))
    }

    pub fn batch_register(
        env: Env,
        issuer: Address,
        wallets: Vec<Address>,
        expiry_days: Option<u32>,
        tier: u32,
        country: String,
    ) {
        for wallet in wallets {
            Self::register_identity(env.clone(), issuer.clone(), wallet, expiry_days, tier, country.clone());
        }
    }
}
