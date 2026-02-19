#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Symbol, token};

mod asset_registry {
    soroban_sdk::contractimport!(
        file = "../../target/wasm32-unknown-unknown/release/asset_registry.wasm"
    );
}

// Circle USDC on Stellar Testnet (official)
// Classic Asset: USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
// This compiles to the SAC address: CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
const USDC_SAC_ADDRESS: &str = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

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
    pub usdc_contract: Option<Address>, // USDC SAC address for auction bids
    pub clearing_price: Option<i64>, // Set when auction is cleared
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Bid {
    pub bidder: Address,
    pub token_amount: i64,
    pub limit_price: i64,
    pub usdc_deposited: i64,
    pub settled: bool,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    AssetRegistry,
    PlatformTreasury,
    Listing(String), // asset_code -> Listing
    BidCounter(String), // asset_code -> u64 (bid count)
    Bid(String, u64), // (asset_code, bid_index) -> Bid
}

#[contract]
pub struct PrimaryMarket;

#[contractimpl]
impl PrimaryMarket {
    pub fn init(env: Env, admin: Address, asset_registry: Address, platform_treasury: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::AssetRegistry, &asset_registry);
        env.storage().instance().set(&DataKey::PlatformTreasury, &platform_treasury);
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
        usdc_contract: Option<Address>,
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

        // Validate auction-specific requirements
        if matches!(listing_type, ListingType::Auction) {
            if min_price.is_none() {
                panic!("auction requires min_price");
            }
        }

        // Note: USDC payments use the official Circle USDC SAC (hardcoded constant)
        // No need to pass usdc_contract parameter

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
            usdc_contract,
            clearing_price: None,
        };

        env.storage().persistent().set(&DataKey::Listing(asset_code.clone()), &listing);
        
        // Initialize bid counter for auctions
        if matches!(listing.listing_type, ListingType::Auction) {
            env.storage().persistent().set(&DataKey::BidCounter(asset_code), &0u64);
        }
    }

    pub fn buy_tokens(env: Env, buyer: Address, asset_code: String, amount: i128) {
        buyer.require_auth();

        let mut listing: Listing = env.storage().persistent().get(&DataKey::Listing(asset_code.clone())).expect("listing not found");

        if !listing.active {
            panic!("listing inactive");
        }

        // Only allow purchases for Static listings
        if !matches!(listing.listing_type, ListingType::Static) {
            panic!("use submit_bid for auction listings");
        }

        let amount_i64 = amount as i64;

        if listing.sold_amount + amount_i64 > listing.total_supply {
            panic!("insufficient supply");
        }

        // Calculate payment
        let price = listing.price_or_reserve;
        let total_payment = price * amount_i64;

        // Collect USDC payment from buyer if price > 0
        if price > 0 {
            // Use official Circle USDC SAC
            let usdc_address = Address::from_string(&String::from_str(&env, USDC_SAC_ADDRESS));
            let treasury: Address = env.storage().instance().get(&DataKey::PlatformTreasury).unwrap();
            let usdc_token = token::Client::new(&env, &usdc_address);

            // Transfer USDC from buyer to platform treasury
            usdc_token.transfer(&buyer, &treasury, &(total_payment as i128));
        }

        // Transfer RWA tokens from contract to buyer
        let token_client = token::Client::new(&env, &listing.asset_issuer);
        let contract_address = env.current_contract_address();
        token_client.transfer(&contract_address, &buyer, &amount);

        // Update sold amount
        listing.sold_amount += amount_i64;
        env.storage().persistent().set(&DataKey::Listing(asset_code.clone()), &listing);

        // Emit event for backend tracker
        // Topics: ["TokensPurchased"]
        // Data: [asset_code, buyer, amount, price, total_payment]
        env.events().publish(
            (Symbol::new(&env, "TokensPurchased"),),
            (asset_code, buyer, amount, price, total_payment)
        );
    }

    pub fn enable_asset(env: Env, asset: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        
        let token_client = token::Client::new(&env, &asset);
        // Querying balance forces an interaction with the token contract,
        // which can help initialize the balance entry for this contract address.
        let _ = token_client.balance(&env.current_contract_address());
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
        
        // Prevent deactivating auctions via this path - they must use clear_auction
        if matches!(listing.listing_type, ListingType::Auction) {
            panic!("use clear_auction to end auction listings");
        }
        
        listing.active = false;
        env.storage().persistent().set(&DataKey::Listing(asset_code), &listing);
    }

    pub fn submit_bid(
        env: Env,
        bidder: Address,
        asset_code: String,
        token_amount: i64,
        limit_price: i64,
    ) {
        bidder.require_auth();

        let listing: Listing = env.storage().persistent()
            .get(&DataKey::Listing(asset_code.clone()))
            .expect("listing not found");

        if !listing.active {
            panic!("listing not active");
        }
        if !matches!(listing.listing_type, ListingType::Auction) {
            panic!("not an auction listing");
        }
        if listing.clearing_price.is_some() {
            panic!("auction already cleared");
        }
        if env.ledger().timestamp() >= listing.start_time + listing.duration {
            panic!("auction ended");
        }
        if limit_price < listing.min_price.unwrap_or(0) {
            panic!("price below minimum");
        }
        if token_amount < 0 {
            panic!("invalid token amount");
        }

        let usdc_deposit = (limit_price * token_amount) / 10_000_000i64;
        
        if usdc_deposit <= 0 {
            panic!("usdc deposit must be positive");
        }

        // Use official Circle USDC SAC
        let usdc_address = Address::from_string(&String::from_str(&env, USDC_SAC_ADDRESS));
        let usdc_token = token::Client::new(&env, &usdc_address);
        let contract_address = env.current_contract_address();
        usdc_token.transfer(&bidder, &contract_address, &(usdc_deposit as i128));

        let bid_counter: u64 = env.storage().persistent()
            .get(&DataKey::BidCounter(asset_code.clone()))
            .unwrap_or(0);
        let bid_index = bid_counter;
        env.storage().persistent().set(&DataKey::BidCounter(asset_code.clone()), &(bid_counter + 1));

        let bid = Bid {
            bidder: bidder.clone(),
            token_amount,
            limit_price,
            usdc_deposited: usdc_deposit,
            settled: false,
        };
        env.storage().persistent().set(&DataKey::Bid(asset_code.clone(), bid_index), &bid);

        env.events().publish(
            (Symbol::new(&env, "BidSubmitted"),),
            (asset_code, bidder, token_amount, limit_price, bid_index)
        );
    }

    pub fn clear_auction(
        env: Env,
        admin: Address,
        asset_code: String,
        clearing_price: i64,
    ) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != stored_admin {
            panic!("only admin can clear auction");
        }

        let mut listing: Listing = env.storage().persistent()
            .get(&DataKey::Listing(asset_code.clone()))
            .expect("listing not found");

        if !matches!(listing.listing_type, ListingType::Auction) {
            panic!("not an auction listing");
        }
        if listing.clearing_price.is_some() {
            panic!("auction already cleared");
        }

        let token_client = token::Client::new(&env, &listing.asset_issuer);
        let contract_balance = token_client.balance(&env.current_contract_address());
        if contract_balance < (listing.total_supply as i128) {
            panic!("insufficient token balance for settlement");
        }

        listing.clearing_price = Some(clearing_price);
        listing.active = false;
        env.storage().persistent().set(&DataKey::Listing(asset_code.clone()), &listing);

        env.events().publish(
            (Symbol::new(&env, "AuctionCleared"),),
            (asset_code, clearing_price)
        );
    }

    pub fn settle_bid(
        env: Env,
        caller: Address,
        asset_code: String,
        bid_index: u64,
    ) {
        caller.require_auth();

        let mut listing: Listing = env.storage().persistent()
            .get(&DataKey::Listing(asset_code.clone()))
            .expect("listing not found");

        let clearing_price = listing.clearing_price.expect("auction not cleared yet");

        let mut bid: Bid = env.storage().persistent()
            .get(&DataKey::Bid(asset_code.clone(), bid_index))
            .expect("bid not found");

        if bid.settled {
            panic!("bid already settled");
        }
        bid.settled = true;
        env.storage().persistent().set(&DataKey::Bid(asset_code.clone(), bid_index), &bid);

        let contract_address = env.current_contract_address();
        let treasury: Address = env.storage().instance().get(&DataKey::PlatformTreasury).unwrap();

        // Use official Circle USDC SAC
        let usdc_address = Address::from_string(&String::from_str(&env, USDC_SAC_ADDRESS));
        let usdc_token = token::Client::new(&env, &usdc_address);
        let rwa_token = token::Client::new(&env, &listing.asset_issuer);

        let wins_price = bid.limit_price >= clearing_price;
        let remaining_supply = listing.total_supply - listing.sold_amount;
        let wins_supply = remaining_supply >= bid.token_amount;

        let mut tokens_received: i64 = 0;
        let mut cost: i64 = 0;
        let mut refund: i64 = bid.usdc_deposited;

        if wins_price && wins_supply {
            tokens_received = bid.token_amount;
            cost = (clearing_price * tokens_received) / 10_000_000i64;
            refund = bid.usdc_deposited - cost;

            rwa_token.transfer(&contract_address, &bid.bidder, &(tokens_received as i128));
            
            if cost > 0 {
                usdc_token.transfer(&contract_address, &treasury, &(cost as i128));
            }
            
            if refund > 0 {
                usdc_token.transfer(&contract_address, &bid.bidder, &(refund as i128));
            }

            listing.sold_amount += tokens_received;
            env.storage().persistent().set(&DataKey::Listing(asset_code.clone()), &listing);
        } else {
            tokens_received = 0;
            cost = 0;
            refund = bid.usdc_deposited;
            
            usdc_token.transfer(&contract_address, &bid.bidder, &(refund as i128));
        }

        env.events().publish(
            (Symbol::new(&env, "BidSettled"),),
            (asset_code, bid.bidder, tokens_received, cost, refund)
        );
    }

    pub fn get_bid(env: Env, asset_code: String, bid_index: u64) -> Option<Bid> {
        env.storage().persistent().get(&DataKey::Bid(asset_code, bid_index))
    }

    pub fn get_bid_count(env: Env, asset_code: String) -> u64 {
        env.storage().persistent().get(&DataKey::BidCounter(asset_code)).unwrap_or(0)
    }

    pub fn enable_usdc(env: Env, usdc_contract: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        
        let usdc_token = token::Client::new(&env, &usdc_contract);
        let _ = usdc_token.balance(&env.current_contract_address());
    }
}
