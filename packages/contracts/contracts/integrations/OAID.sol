// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title OAID (On-chain Asset ID)
 * @notice Issues credit lines backed by private asset tokens locked in SolvencyVault
 * @dev External protocols can verify credit lines and extend credit based on collateral
 *
 * Flow:
 * 1. User completes KYC → registerUser() creates OAID profile
 * 2. User deposits collateral → SolvencyVault calls issueCreditLine()
 * 3. External protocols query credit availability
 * 4. When SolvencyVault position is liquidated, credit line is revoked
 */
contract OAID is Ownable, ReentrancyGuard {
    // Credit line structure
    struct CreditLine {
        address user;                   // Borrower address
        address collateralToken;        // Token backing the credit
        uint256 collateralAmount;       // Token amount (18 decimals)
        uint256 creditLimit;            // Max credit in USD (6 decimals)
        uint256 creditUsed;             // Credit utilized externally (6 decimals)
        uint256 solvencyPositionId;     // Reference to SolvencyVault position
        uint256 issuedAt;               // Creation timestamp
        bool active;                    // Credit line status
    }

    // Authorized vaults
    address public solvencyVault;

    // User registration
    mapping(address => bool) public registeredUsers;
    mapping(address => uint256) public userRegistrationTime;

    // Credit line management
    mapping(uint256 => CreditLine) public creditLines;
    uint256 public nextCreditLineId;

    // User credit lines
    mapping(address => uint256[]) public userCreditLines;

    // Events
    event UserRegistered(
        address indexed user,
        uint256 timestamp
    );
    event CreditLineIssued(
        uint256 indexed creditLineId,
        address indexed user,
        address collateralToken,
        uint256 collateralAmount,
        uint256 creditLimit,
        uint256 solvencyPositionId
    );
    event CreditLineUpdated(
        uint256 indexed creditLineId,
        uint256 oldCreditLimit,
        uint256 newCreditLimit
    );
    event CreditUsed(
        uint256 indexed creditLineId,
        uint256 amount,
        uint256 totalUsed
    );
    event CreditRepaid(
        uint256 indexed creditLineId,
        uint256 amount,
        uint256 remainingUsed
    );
    event CreditLineRevoked(
        uint256 indexed creditLineId,
        string reason
    );

    modifier onlySolvencyVault() {
        require(msg.sender == solvencyVault, "Only SolvencyVault");
        _;
    }

    /**
     * @notice Initialize OAID
     */
    constructor() Ownable(msg.sender) {
        nextCreditLineId = 1;
    }

    /**
     * @notice Set SolvencyVault address (one-time)
     * @param _solvencyVault SolvencyVault contract address
     */
    function setSolvencyVault(address _solvencyVault) external onlyOwner {
        require(solvencyVault == address(0), "SolvencyVault already set");
        require(_solvencyVault != address(0), "Invalid address");
        solvencyVault = _solvencyVault;
    }

    /**
     * @notice Register user (called after KYC verification)
     * @param user User address to register
     */
    function registerUser(address user) external onlyOwner {
        require(user != address(0), "Invalid user address");
        require(!registeredUsers[user], "User already registered");

        registeredUsers[user] = true;
        userRegistrationTime[user] = block.timestamp;

        emit UserRegistered(user, block.timestamp);
    }

    /**
     * @notice Check if user is registered
     * @param user User address
     * @return bool Registration status
     */
    function isUserRegistered(address user) external view returns (bool) {
        return registeredUsers[user];
    }

    /**
     * @notice Issue credit line backed by collateral (only for registered users)
     * @param user Borrower address
     * @param collateralToken Token address
     * @param collateralAmount Token amount (18 decimals)
     * @param valueUSD Collateral value in USD (6 decimals)
     * @param solvencyPositionId SolvencyVault position ID
     * @return creditLineId Created credit line ID
     */
    function issueCreditLine(
        address user,
        address collateralToken,
        uint256 collateralAmount,
        uint256 valueUSD,
        uint256 solvencyPositionId
    ) external onlySolvencyVault nonReentrant returns (uint256 creditLineId) {
        require(registeredUsers[user], "User not registered");
        require(collateralToken != address(0), "Invalid token");
        require(collateralAmount > 0, "Amount must be > 0");
        require(valueUSD > 0, "Value must be > 0");

        // Calculate credit limit (70% of collateral value)
        uint256 creditLimit = (valueUSD * 7000) / 10000;

        creditLineId = _createCreditLine(
            user,
            collateralToken,
            collateralAmount,
            creditLimit,
            solvencyPositionId
        );
    }

    /**
     * @notice Update existing credit line when collateral value changes
     * @param creditLineId Credit line ID to update
     * @param newValueUSD New collateral value in USD (6 decimals)
     */
    function updateCreditLine(
        uint256 creditLineId,
        uint256 newValueUSD
    ) external onlySolvencyVault nonReentrant {
        CreditLine storage creditLine = creditLines[creditLineId];
        require(creditLine.active, "Credit line not active");
        require(newValueUSD > 0, "Value must be > 0");

        uint256 oldCreditLimit = creditLine.creditLimit;
        uint256 newCreditLimit = (newValueUSD * 7000) / 10000;

        creditLine.creditLimit = newCreditLimit;

        emit CreditLineUpdated(creditLineId, oldCreditLimit, newCreditLimit);
    }

    /**
     * @notice Internal function to create credit line
     */
    function _createCreditLine(
        address user,
        address collateralToken,
        uint256 collateralAmount,
        uint256 creditLimit,
        uint256 solvencyPositionId
    ) internal returns (uint256 creditLineId) {
        // Create credit line
        creditLineId = nextCreditLineId++;
        creditLines[creditLineId] = CreditLine({
            user: user,
            collateralToken: collateralToken,
            collateralAmount: collateralAmount,
            creditLimit: creditLimit,
            creditUsed: 0,
            solvencyPositionId: solvencyPositionId,
            issuedAt: block.timestamp,
            active: true
        });

        // Track user's credit lines
        userCreditLines[user].push(creditLineId);

        emit CreditLineIssued(
            creditLineId,
            user,
            collateralToken,
            collateralAmount,
            creditLimit,
            solvencyPositionId
        );
    }

    /**
     * @notice Record credit usage (called by external protocols)
     * @param creditLineId Credit line ID
     * @param amount Amount of credit used (6 decimals)
     */
    function recordCreditUsage(
        uint256 creditLineId,
        uint256 amount
    ) external onlyOwner nonReentrant {
        CreditLine storage creditLine = creditLines[creditLineId];
        require(creditLine.active, "Credit line not active");
        require(amount > 0, "Amount must be > 0");

        uint256 availableCredit = creditLine.creditLimit - creditLine.creditUsed;
        require(amount <= availableCredit, "Exceeds available credit");

        creditLine.creditUsed += amount;

        emit CreditUsed(creditLineId, amount, creditLine.creditUsed);
    }

    /**
     * @notice Record credit repayment (called by external protocols)
     * @param creditLineId Credit line ID
     * @param amount Amount repaid (6 decimals)
     */
    function recordCreditRepayment(
        uint256 creditLineId,
        uint256 amount
    ) external onlyOwner nonReentrant {
        CreditLine storage creditLine = creditLines[creditLineId];
        require(creditLine.active, "Credit line not active");
        require(amount > 0, "Amount must be > 0");
        require(amount <= creditLine.creditUsed, "Amount exceeds debt");

        creditLine.creditUsed -= amount;

        emit CreditRepaid(creditLineId, amount, creditLine.creditUsed);
    }

    /**
     * @notice Revoke credit line (called by SolvencyVault on liquidation)
     * @param creditLineId Credit line ID
     * @param reason Revocation reason
     */
    function revokeCreditLine(
        uint256 creditLineId,
        string memory reason
    ) external onlySolvencyVault nonReentrant {
        CreditLine storage creditLine = creditLines[creditLineId];
        require(creditLine.active, "Already revoked");

        creditLine.active = false;

        emit CreditLineRevoked(creditLineId, reason);
    }

    /**
     * @notice Get available credit for credit line
     * @param creditLineId Credit line ID
     * @return Available credit in USD (6 decimals)
     */
    function getAvailableCredit(uint256 creditLineId) external view returns (uint256) {
        CreditLine memory creditLine = creditLines[creditLineId];
        if (!creditLine.active) return 0;

        return creditLine.creditLimit - creditLine.creditUsed;
    }

    /**
     * @notice Get all credit lines for user
     * @param user User address
     * @return Array of credit line IDs
     */
    function getUserCreditLines(address user) external view returns (uint256[] memory) {
        return userCreditLines[user];
    }

    /**
     * @notice Get credit line details
     * @param creditLineId Credit line ID
     * @return CreditLine struct
     */
    function getCreditLine(uint256 creditLineId) external view returns (CreditLine memory) {
        return creditLines[creditLineId];
    }

    /**
     * @notice Get total credit limit for user (across all active lines)
     * @param user User address
     * @return Total credit limit in USD (6 decimals)
     */
    function getTotalCreditLimit(address user) external view returns (uint256) {
        uint256 totalLimit = 0;
        uint256[] memory lineIds = userCreditLines[user];

        for (uint256 i = 0; i < lineIds.length; i++) {
            CreditLine memory line = creditLines[lineIds[i]];
            if (line.active) {
                totalLimit += line.creditLimit;
            }
        }

        return totalLimit;
    }

    /**
     * @notice Get total available credit for user
     * @param user User address
     * @return Total available credit in USD (6 decimals)
     */
    function getTotalAvailableCredit(address user) external view returns (uint256) {
        uint256 totalAvailable = 0;
        uint256[] memory lineIds = userCreditLines[user];

        for (uint256 i = 0; i < lineIds.length; i++) {
            CreditLine memory line = creditLines[lineIds[i]];
            if (line.active) {
                totalAvailable += (line.creditLimit - line.creditUsed);
            }
        }

        return totalAvailable;
    }
}
