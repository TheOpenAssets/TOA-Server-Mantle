#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, BytesN};

mod attestation {
    soroban_sdk::contractimport!(
        file = "../../target/wasm32-unknown-unknown/release/attestation_registry.wasm"
    );
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AssetMetadata {
    pub asset_id_offchain: String,
    pub total_supply: i64,
    pub attestation_hash: BytesN<32>,
    pub blob_id: BytesN<32>,
    pub is_valid: bool,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    AttestationRegistry,
    Asset(String), // asset_code (e.g., "RWA-INV001") -> Metadata
}

#[contract]
pub struct AssetRegistry;

#[contractimpl]
impl AssetRegistry {
    pub fn init(env: Env, admin: Address, attestation_registry: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::AttestationRegistry, &attestation_registry);
    }

    pub fn register_asset(
        env: Env,
        admin: Address,
        asset_code: String,
        asset_id_offchain: String,
        total_supply: i64,
        attestation_hash: BytesN<32>,
        blob_id: BytesN<32>,
    ) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != stored_admin {
            panic!("only admin can register assets");
        }

        let attestation_registry_addr: Address = env.storage().instance().get(&DataKey::AttestationRegistry).unwrap();
        let client = attestation::Client::new(&env, &attestation_registry_addr);
        
        if !client.is_asset_valid(&asset_id_offchain) {
            panic!("asset not attested or invalid");
        }

        let metadata = AssetMetadata {
            asset_id_offchain,
            total_supply,
            attestation_hash,
            blob_id,
            is_valid: true,
        };

        env.storage().persistent().set(&DataKey::Asset(asset_code), &metadata);
    }

    pub fn get_asset_metadata(env: Env, asset_code: String) -> Option<AssetMetadata> {
        env.storage().persistent().get(&DataKey::Asset(asset_code))
    }

    pub fn is_asset_valid(env: Env, asset_code: String) -> bool {
        let metadata_opt: Option<AssetMetadata> = env.storage().persistent().get(&DataKey::Asset(asset_code));
        match metadata_opt {
            Some(m) => m.is_valid,
            None => false,
        }
    }

    pub fn revoke_asset(env: Env, admin: Address, asset_code: String) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != stored_admin {
            panic!("only admin can revoke assets");
        }

        let mut metadata: AssetMetadata = env.storage().persistent().get(&DataKey::Asset(asset_code.clone())).expect("asset not found");
        metadata.is_valid = false;
        env.storage().persistent().set(&DataKey::Asset(asset_code), &metadata);
    }
}
