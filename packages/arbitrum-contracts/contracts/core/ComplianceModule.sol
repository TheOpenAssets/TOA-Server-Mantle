// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IdentityRegistry.sol";
import "./AttestationRegistry.sol";

contract ComplianceModule {
    IdentityRegistry public identityRegistry;
    AttestationRegistry public attestationRegistry;
    bytes32 public assetId;
    address public owner;

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor(
        address _identityRegistry,
        address _attestationRegistry,
        bytes32 _assetId
    ) {
        owner = msg.sender;
        identityRegistry = IdentityRegistry(_identityRegistry);
        attestationRegistry = AttestationRegistry(_attestationRegistry);
        assetId = _assetId;
    }

    function canTransfer(address from, address to, uint256 /* amount */) external view returns (bool) {
        // 1. Check Sender KYC (unless minting/burning)
        if (from != address(0)) {
            if (!identityRegistry.isVerified(from)) return false;
        }

        // 2. Check Receiver KYC (unless burning)
        if (to != address(0)) {
            if (!identityRegistry.isVerified(to)) return false;
        }

        // 3. Check Asset Validity
        if (!attestationRegistry.isAssetValid(assetId)) return false;

        return true;
    }

    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        identityRegistry = IdentityRegistry(_identityRegistry);
    }

    function setAttestationRegistry(address _attestationRegistry) external onlyOwner {
        attestationRegistry = AttestationRegistry(_attestationRegistry);
    }
}
