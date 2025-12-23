// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract AttestationRegistry {
    using ECDSA for bytes32;

    struct AssetRecord {
        bytes32 assetId;
        bytes32 attestationHash;
        bytes32 blobId;
        address attestor;
        uint48 timestamp;
        bool revoked;
    }

    mapping(bytes32 => AssetRecord) public assets;
    mapping(address => bool) public trustedAttestors;
    address public owner;

    event AssetRegistered(bytes32 indexed assetId, bytes32 blobId, bytes32 attestationHash, address attestor);
    event AssetRevoked(bytes32 indexed assetId, string reason, uint256 timestamp);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor() {
        owner = msg.sender;
        trustedAttestors[msg.sender] = true;
    }

    function addTrustedAttestor(address attestor) external onlyOwner {
        trustedAttestors[attestor] = true;
    }

    function registerAsset(
        bytes32 assetId,
        bytes32 attestationHash,
        bytes32 blobId,
        bytes calldata payload,
        bytes calldata signature
    ) external {
        require(assets[assetId].timestamp == 0, "Asset already registered");
        require(keccak256(payload) == attestationHash, "Payload hash mismatch");

        // Recover signer from hash
        bytes32 ethSignedHash = MessageHashUtils.toEthSignedMessageHash(attestationHash);
        address recovered = ECDSA.recover(ethSignedHash, signature);
        
        require(trustedAttestors[recovered], "Invalid attestor signature");

        assets[assetId] = AssetRecord({
            assetId: assetId,
            attestationHash: attestationHash,
            blobId: blobId,
            attestor: recovered,
            timestamp: uint48(block.timestamp),
            revoked: false
        });

        emit AssetRegistered(assetId, blobId, attestationHash, recovered);
    }

    function revokeAsset(bytes32 assetId, string calldata reason) external onlyOwner {
        require(assets[assetId].timestamp > 0, "Asset not found");
        assets[assetId].revoked = true;
        emit AssetRevoked(assetId, reason, block.timestamp);
    }

    function isAssetValid(bytes32 assetId) external view returns (bool) {
        return assets[assetId].timestamp > 0 && !assets[assetId].revoked;
    }
}
