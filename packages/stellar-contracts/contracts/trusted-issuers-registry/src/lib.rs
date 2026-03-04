#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, BytesN};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Issuer(Address),
    AttestorPubkey(BytesN<32>),
}

#[contract]
pub struct TrustedIssuersRegistry;

#[contractimpl]
impl TrustedIssuersRegistry {
    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    pub fn add_issuer(env: Env, issuer: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        env.storage().instance().set(&DataKey::Issuer(issuer), &true);
    }

    pub fn remove_issuer(env: Env, issuer: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        env.storage().instance().remove(&DataKey::Issuer(issuer));
    }

    pub fn is_trusted_issuer(env: Env, issuer: Address) -> bool {
        env.storage().instance().get(&DataKey::Issuer(issuer)).unwrap_or(false)
    }

    pub fn add_attestor_pubkey(env: Env, pubkey: BytesN<32>) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        env.storage().instance().set(&DataKey::AttestorPubkey(pubkey), &true);
    }

    pub fn remove_attestor_pubkey(env: Env, pubkey: BytesN<32>) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        env.storage().instance().remove(&DataKey::AttestorPubkey(pubkey));
    }

    pub fn is_trusted_attestor_pubkey(env: Env, pubkey: BytesN<32>) -> bool {
        env.storage().instance().get(&DataKey::AttestorPubkey(pubkey)).unwrap_or(false)
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }
}
