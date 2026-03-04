#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, BytesN, xdr::ToXdr};

mod trusted_issuers {
    soroban_sdk::contractimport!(
        file = "../../target/wasm32-unknown-unknown/release/trusted_issuers_registry.wasm"
    );
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Attestor {
    Address(Address),
    Pubkey(BytesN<32>),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AssetAttestation {
    pub asset_id_offchain: String,
    pub attestation_hash: BytesN<32>,
    pub eigen_da_blob_id: BytesN<32>,
    pub timestamp: u64,
    pub attestor: Attestor,
    pub is_valid: bool,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    TrustedIssuers,
    Attestation(String), // asset_id_offchain -> Attestation
}

#[contract]
pub struct AttestationRegistry;

#[contractimpl]
impl AttestationRegistry {
    pub fn init(env: Env, trusted_issuers: Address) {
        if env.storage().instance().has(&DataKey::TrustedIssuers) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::TrustedIssuers, &trusted_issuers);
    }

    pub fn register_asset_direct(
        env: Env,
        attestor: Address,
        asset_id: String,
        attestation_hash: BytesN<32>,
        blob_id: BytesN<32>,
    ) {
        attestor.require_auth();

        let trusted_issuers_addr: Address = env.storage().instance().get(&DataKey::TrustedIssuers).unwrap();
        let client = trusted_issuers::Client::new(&env, &trusted_issuers_addr);
        
        if !client.is_trusted_issuer(&attestor) {
            panic!("not a trusted issuer/attestor");
        }

        let attestation = AssetAttestation {
            asset_id_offchain: asset_id.clone(),
            attestation_hash,
            eigen_da_blob_id: blob_id,
            timestamp: env.ledger().timestamp(),
            attestor: Attestor::Address(attestor),
            is_valid: true,
        };

        env.storage().persistent().set(&DataKey::Attestation(asset_id), &attestation);
    }

    pub fn register_asset_with_signature(
        env: Env,
        asset_id: String,
        attestation_hash: BytesN<32>,
        blob_id: BytesN<32>,
        attestor_pubkey: BytesN<32>,
        signature: BytesN<64>,
    ) {
        let trusted_issuers_addr: Address = env.storage().instance().get(&DataKey::TrustedIssuers).unwrap();
        let client = trusted_issuers::Client::new(&env, &trusted_issuers_addr);
        
        if !client.is_trusted_attestor_pubkey(&attestor_pubkey) {
            panic!("not a trusted attestor pubkey");
        }

        // Construct the message to verify
        let mut message = asset_id.clone().to_xdr(&env);
        message.append(&attestation_hash.clone().to_xdr(&env));
        message.append(&blob_id.clone().to_xdr(&env));

        env.crypto().ed25519_verify(&attestor_pubkey, &message, &signature);

        let attestation = AssetAttestation {
            asset_id_offchain: asset_id.clone(),
            attestation_hash,
            eigen_da_blob_id: blob_id,
            timestamp: env.ledger().timestamp(),
            attestor: Attestor::Pubkey(attestor_pubkey),
            is_valid: true,
        };

        env.storage().persistent().set(&DataKey::Attestation(asset_id), &attestation);
    }

    pub fn is_asset_valid(env: Env, asset_id: String) -> bool {
        let attestation_opt: Option<AssetAttestation> = env.storage().persistent().get(&DataKey::Attestation(asset_id));
        match attestation_opt {
            Some(a) => a.is_valid,
            None => false,
        }
    }

    pub fn revoke_asset(env: Env, admin: Address, asset_id: String) {
        admin.require_auth();
        let trusted_issuers_addr: Address = env.storage().instance().get(&DataKey::TrustedIssuers).unwrap();
        let client = trusted_issuers::Client::new(&env, &trusted_issuers_addr);
        
        if admin != client.get_admin() {
            panic!("only admin can revoke");
        }

        let mut attestation: AssetAttestation = env.storage().persistent().get(&DataKey::Attestation(asset_id.clone())).expect("attestation not found");
        attestation.is_valid = false;
        env.storage().persistent().set(&DataKey::Attestation(asset_id), &attestation);
    }

    pub fn get_attestation(env: Env, asset_id: String) -> Option<AssetAttestation> {
        env.storage().persistent().get(&DataKey::Attestation(asset_id))
    }
}
