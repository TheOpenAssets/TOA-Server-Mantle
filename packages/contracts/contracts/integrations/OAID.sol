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
    // Payment history entry
    struct PaymentRecord {
        uint256 timestamp;          // Payment time
        uint256 amount;             // Amount paid (6 decimals)
        bool onTime;                // Whether payment was on time
        uint256 daysLate;           // Days late (0 if on time)
    }

    // Credit line structure
    struct CreditLine {
        address user;                   // Borrower address
        address collateralToken;        // Token backing the credit
        uint256 collateralAmount;       // Token amount (18 decimals)
        uint256 creditLimit;            // Max credit in USD (6 decimals)
        uint256 creditUsed;             // Credit utilized externally (6 decimals)
        uint256 solvencyPositionId;     // Reference to SolvencyVault position
        uint256 issuedAt;               // Creation timestamp
        uint256 totalPayments;          // Total number of payments made
        uint256 onTimePayments;         // Number of on-time payments
        uint256 latePayments;           // Number of late payments
        uint256 totalAmountRepaid;      // Total amount repaid (6 decimals)
        bool liquidated;                // Whether position was liquidated
        uint256 liquidatedAt;           // Liquidation timestamp (0 if not liquidated)
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

    // Payment history
    mapping(uint256 => PaymentRecord[]) public paymentHistory; // creditLineId => payments

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
    event PaymentRecorded(
        uint256 indexed creditLineId,
        address indexed user,
        uint256 amount,
        bool onTime,
        uint256 daysLate
    );
    event PositionLiquidated(
        uint256 indexed creditLineId,
        address indexed user,
        uint256 timestamp
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
            totalPayments: 0,
            onTimePayments: 0,
            latePayments: 0,
            totalAmountRepaid: 0,
            liquidated: false,
            liquidatedAt: 0,
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

        // Mark as liquidated if reason contains "liquidat"
        if (bytes(reason).length > 0 && _contains(reason, "liquidat")) {
            creditLine.liquidated = true;
            creditLine.liquidatedAt = block.timestamp;
            emit PositionLiquidated(creditLineId, creditLine.user, block.timestamp);
        }

        emit CreditLineRevoked(creditLineId, reason);
    }

    /**
     * @notice Record a payment made by user (called by SolvencyVault)
     * @param creditLineId Credit line ID
     * @param amount Amount paid (6 decimals)
     * @param onTime Whether payment was made on time
     * @param daysLate Number of days late (0 if on time)
     */
    function recordPayment(
        uint256 creditLineId,
        uint256 amount,
        bool onTime,
        uint256 daysLate
    ) external onlySolvencyVault nonReentrant {
        CreditLine storage creditLine = creditLines[creditLineId];
        require(creditLine.active, "Credit line not active");
        require(amount > 0, "Amount must be > 0");

        // Update payment statistics
        creditLine.totalPayments++;
        creditLine.totalAmountRepaid += amount;
        
        if (onTime) {
            creditLine.onTimePayments++;
        } else {
            creditLine.latePayments++;
        }

        // Store payment record
        paymentHistory[creditLineId].push(PaymentRecord({
            timestamp: block.timestamp,
            amount: amount,
            onTime: onTime,
            daysLate: daysLate
        }));

        emit PaymentRecorded(creditLineId, creditLine.user, amount, onTime, daysLate);
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

    /**
     * @notice Get payment history for a credit line
     * @param creditLineId Credit line ID
     * @return Array of payment records
     */
    function getPaymentHistory(uint256 creditLineId) external view returns (PaymentRecord[] memory) {
        return paymentHistory[creditLineId];
    }

    /**
     * @notice Calculate credit score for user (0-1000)
     * @param user User address
     * @return Credit score based on payment history
     */
    function getCreditScore(address user) external view returns (uint256) {
        uint256[] memory lineIds = userCreditLines[user];
        if (lineIds.length == 0) return 0;

        uint256 totalPayments = 0;
        uint256 totalOnTime = 0;
        uint256 totalLiquidations = 0;

        for (uint256 i = 0; i < lineIds.length; i++) {
            CreditLine memory line = creditLines[lineIds[i]];
            totalPayments += line.totalPayments;
            totalOnTime += line.onTimePayments;
            if (line.liquidated) {
                totalLiquidations++;
            }
        }

        // No payment history = neutral score of 500
        if (totalPayments == 0) return 500;

        // Base score from payment ratio (0-800 points)
        uint256 paymentScore = (totalOnTime * 800) / totalPayments;

        // Penalty for liquidations (-200 points per liquidation, max -400)
        uint256 liquidationPenalty = totalLiquidations * 200;
        if (liquidationPenalty > 400) liquidationPenalty = 400;

        // Bonus for high number of on-time payments (up to +200 points)
        uint256 volumeBonus = totalOnTime > 10 ? 200 : (totalOnTime * 20);

        // Calculate final score (0-1000)
        uint256 score = paymentScore + volumeBonus;
        if (score > liquidationPenalty) {
            score -= liquidationPenalty;
        } else {
            score = 0;
        }

        if (score > 1000) score = 1000;

        return score;
    }

    /**
     * @notice Get credit profile summary for user
     * @param user User address
     * @return activeCreditLines Number of active credit lines
     * @return totalCreditLimit Total credit limit
     * @return totalPayments Total payments made
     * @return onTimePayments On-time payments
     * @return latePayments Late payments
     * @return liquidations Number of liquidated positions
     * @return creditScore Credit score (0-1000)
     */
    function getCreditProfile(address user) external view returns (
        uint256 activeCreditLines,
        uint256 totalCreditLimit,
        uint256 totalPayments,
        uint256 onTimePayments,
        uint256 latePayments,
        uint256 liquidations,
        uint256 creditScore
    ) {
        uint256[] memory lineIds = userCreditLines[user];
        
        for (uint256 i = 0; i < lineIds.length; i++) {
            CreditLine memory line = creditLines[lineIds[i]];
            if (line.active) {
                activeCreditLines++;
                totalCreditLimit += line.creditLimit;
            }
            totalPayments += line.totalPayments;
            onTimePayments += line.onTimePayments;
            latePayments += line.latePayments;
            if (line.liquidated) {
                liquidations++;
            }
        }

        // Calculate credit score
        creditScore = this.getCreditScore(user);
    }

    /**
     * @notice Helper function to check if string contains substring
     * @param str String to search in
     * @param substr Substring to search for
     * @return bool Whether substring is found
     */
    function _contains(string memory str, string memory substr) internal pure returns (bool) {
        bytes memory strBytes = bytes(str);
        bytes memory substrBytes = bytes(substr);
        
        if (substrBytes.length > strBytes.length) return false;
        if (substrBytes.length == 0) return false;
        
        for (uint256 i = 0; i <= strBytes.length - substrBytes.length; i++) {
            bool found = true;
            for (uint256 j = 0; j < substrBytes.length; j++) {
                if (strBytes[i + j] != substrBytes[j]) {
                    found = false;
                    break;
                }
            }
            if (found) return true;
        }
        
        return false;
    }
}