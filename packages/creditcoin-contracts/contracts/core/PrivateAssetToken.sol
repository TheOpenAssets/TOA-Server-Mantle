// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./RWAToken.sol";

/**
 * @title PrivateAssetToken
 * @notice ERC-20 token representing physical/private assets (deeds, bonds, invoices, equipment)
 * @dev Extends RWAToken with additional metadata for private asset tracking
 *
 * Features:
 * - Inherits compliance and KYC from RWAToken
 * - Additional metadata: asset type, location, valuation, documents
 * - Platform mints 1 token = 1 physical asset
 * - Admin can update valuation with timestamp
 * - Document hash for off-chain verification (IPFS)
 */
contract PrivateAssetToken is RWAToken {
    // Asset metadata
    struct AssetMetadata {
        string assetType;        // "DEED", "BOND", "INVOICE", "EQUIPMENT", etc.
        string location;         // Physical location/jurisdiction
        uint256 valuation;       // USD value (6 decimals, e.g., 50000000000 = $50k)
        uint256 valuationDate;   // Timestamp of last valuation
        string documentHash;     // IPFS hash for legal documents
        bool isActive;           // Asset status
    }

    AssetMetadata public metadata;

    // Valuation history
    struct ValuationRecord {
        uint256 valuation;
        uint256 timestamp;
        address updatedBy;
    }

    ValuationRecord[] public valuationHistory;

    // Events
    event MetadataUpdated(
        string assetType,
        string location,
        string documentHash
    );
    event ValuationUpdated(
        uint256 oldValuation,
        uint256 newValuation,
        uint256 timestamp,
        address updatedBy
    );
    event AssetStatusChanged(bool isActive);

    /**
     * @notice Deploy PrivateAssetToken
     * @param _assetId Unique asset identifier (bytes32)
     * @param _compliance ComplianceModule address
     * @param _identityRegistry IdentityRegistry address
     * @param _totalSupply Total token supply (usually 1e18 for whole asset)
     * @param _platformCustody Platform custody address
     * @param _name Token name (e.g., "Property Deed #123")
     * @param _symbol Token symbol (e.g., "DEED123")
     * @param _issuer Issuer address
     * @param _assetType Asset type string
     * @param _location Physical location
     * @param _valuation Initial USD valuation (6 decimals)
     * @param _documentHash IPFS hash
     */
    constructor(
        bytes32 _assetId,
        address _compliance,
        address _identityRegistry,
        uint256 _totalSupply,
        address _platformCustody,
        string memory _name,
        string memory _symbol,
        address _issuer,
        string memory _assetType,
        string memory _location,
        uint256 _valuation,
        string memory _documentHash
    ) RWAToken(
        _assetId,
        _compliance,
        _identityRegistry,
        _totalSupply,
        _platformCustody,
        _name,
        _symbol,
        _issuer
    ) {
        require(_valuation > 0, "Valuation must be > 0");

        metadata = AssetMetadata({
            assetType: _assetType,
            location: _location,
            valuation: _valuation,
            valuationDate: block.timestamp,
            documentHash: _documentHash,
            isActive: true
        });

        // Record initial valuation
        valuationHistory.push(ValuationRecord({
            valuation: _valuation,
            timestamp: block.timestamp,
            updatedBy: msg.sender
        }));

        emit MetadataUpdated(_assetType, _location, _documentHash);
        emit ValuationUpdated(0, _valuation, block.timestamp, msg.sender);
    }

    /**
     * @notice Update asset metadata
     * @param _assetType New asset type
     * @param _location New location
     * @param _documentHash New document hash
     */
    function updateMetadata(
        string memory _assetType,
        string memory _location,
        string memory _documentHash
    ) external onlyOwner {
        metadata.assetType = _assetType;
        metadata.location = _location;
        metadata.documentHash = _documentHash;

        emit MetadataUpdated(_assetType, _location, _documentHash);
    }

    /**
     * @notice Update asset valuation
     * @param _newValuation New USD valuation (6 decimals)
     */
    function updateValuation(uint256 _newValuation) external onlyOwner {
        require(_newValuation > 0, "Valuation must be > 0");

        uint256 oldValuation = metadata.valuation;
        metadata.valuation = _newValuation;
        metadata.valuationDate = block.timestamp;

        // Record in history
        valuationHistory.push(ValuationRecord({
            valuation: _newValuation,
            timestamp: block.timestamp,
            updatedBy: msg.sender
        }));

        emit ValuationUpdated(oldValuation, _newValuation, block.timestamp, msg.sender);
    }

    /**
     * @notice Set asset active status
     * @param _isActive New status
     */
    function setActive(bool _isActive) external onlyOwner {
        metadata.isActive = _isActive;
        emit AssetStatusChanged(_isActive);
    }

    /**
     * @notice Get current valuation
     * @return Valuation in USD (6 decimals)
     */
    function getValuation() external view returns (uint256) {
        return metadata.valuation;
    }

    /**
     * @notice Get valuation history count
     * @return Number of valuation updates
     */
    function getValuationHistoryCount() external view returns (uint256) {
        return valuationHistory.length;
    }

    /**
     * @notice Get valuation record by index
     * @param index History index
     * @return ValuationRecord struct
     */
    function getValuationRecord(uint256 index) external view returns (ValuationRecord memory) {
        require(index < valuationHistory.length, "Index out of bounds");
        return valuationHistory[index];
    }

    /**
     * @notice Get complete asset metadata
     * @return AssetMetadata struct
     */
    function getMetadata() external view returns (AssetMetadata memory) {
        return metadata;
    }
}
