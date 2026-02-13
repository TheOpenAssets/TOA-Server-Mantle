#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Vec, Map, symbol_short, Symbol};

mod asset_registry {
    soroban_sdk::contractimport!(
        file = "../../target/wasm32-unknown-unknown/release/asset_registry.wasm"
    );
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ListingType {
    Static,
    Auction,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Listing {
    pub asset_code: String,
    pub asset_issuer: Address, // This is the SAC address for the native asset
    pub listing_type: ListingType,
    pub price_or_reserve: i64,
    pub min_price: Option<i64>,
    pub duration: u64,
    pub start_time: u64,
    pub total_supply: i64,
    pub sold_amount: i64,
    pub active: bool,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    AssetRegistry,
    Listing(String), // asset_code -> Listing
}

#[contract]
pub struct PrimaryMarket;

#[contractimpl]
impl PrimaryMarket {
    pub fn init(env: Env, admin: Address, asset_registry: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::AssetRegistry, &asset_registry);
    }

    pub fn list_asset(
        env: Env,
        admin: Address,
        asset_code: String,
        asset_issuer: Address,
        listing_type: ListingType,
        price_or_reserve: i64,
        min_price: Option<i64>,
        duration: u64,
        total_supply: i64,
    ) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != stored_admin {
            panic!("only admin can list assets");
        }

        let asset_registry_addr: Address = env.storage().instance().get(&DataKey::AssetRegistry).unwrap();
        let client = asset_registry::Client::new(&env, &asset_registry_addr);
        
        if !client.is_asset_valid(&asset_code) {
            panic!("asset not registered or invalid");
        }

        let listing = Listing {
            asset_code: asset_code.clone(),
            asset_issuer,
            listing_type,
            price_or_reserve,
            min_price,
            duration,
            start_time: env.ledger().timestamp(),
            total_supply,
            sold_amount: 0,
            active: true,
        };

        env.storage().persistent().set(&DataKey::Listing(asset_code), &listing);
    }

    pub fn get_listing(env: Env, asset_code: String) -> Option<Listing> {
        env.storage().persistent().get(&DataKey::Listing(asset_code))
    }

    pub fn deactivate_listing(env: Env, admin: Address, asset_code: String) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != stored_admin {
            panic!("only admin can deactivate");
        }

        let mut listing: Listing = env.storage().persistent().get(&DataKey::Listing(asset_code.clone())).expect("listing not found");
        listing.active = false;
        env.storage().persistent().set(&DataKey::Listing(asset_code), &listing);
    }
}
