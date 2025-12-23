// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./TrustedIssuersRegistry.sol";

contract IdentityRegistry {
    struct Identity {
        bool exists;
        bool isVerified;
        uint256 kycTimestamp;
        address wallet;
    }

    mapping(address => Identity) public identities;
    TrustedIssuersRegistry public trustedIssuersRegistry;
    address public owner;

    event IdentityRegistered(address indexed wallet, uint256 timestamp);
    event IdentityRemoved(address indexed wallet, uint256 timestamp);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyTrustedIssuer() {
        require(trustedIssuersRegistry.isTrustedIssuer(msg.sender) || msg.sender == owner, "Only trusted issuer");
        _;
    }

    constructor(address _trustedIssuersRegistry) {
        owner = msg.sender;
        trustedIssuersRegistry = TrustedIssuersRegistry(_trustedIssuersRegistry);
    }

    function updateTrustedIssuersRegistry(address _newRegistry) external onlyOwner {
        trustedIssuersRegistry = TrustedIssuersRegistry(_newRegistry);
    }

    function registerIdentity(address wallet) external onlyTrustedIssuer {
        identities[wallet] = Identity({
            exists: true,
            isVerified: true,
            kycTimestamp: block.timestamp,
            wallet: wallet
        });
        emit IdentityRegistered(wallet, block.timestamp);
    }

    function removeIdentity(address wallet) external onlyTrustedIssuer {
        require(identities[wallet].exists, "Identity does not exist");
        identities[wallet].isVerified = false;
        emit IdentityRemoved(wallet, block.timestamp);
    }

    function batchRegisterIdentity(address[] calldata wallets) external onlyTrustedIssuer {
        for (uint256 i = 0; i < wallets.length; i++) {
            identities[wallets[i]] = Identity({
                exists: true,
                isVerified: true,
                kycTimestamp: block.timestamp,
                wallet: wallets[i]
            });
            emit IdentityRegistered(wallets[i], block.timestamp);
        }
    }

    function isVerified(address wallet) external view returns (bool) {
        return identities[wallet].isVerified;
    }

    function getIdentity(address wallet) external view returns (Identity memory) {
        return identities[wallet];
    }
}
