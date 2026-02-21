// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../core/IdentityRegistry.sol";

/**
 * @title SecondaryMarket
 * @notice Trustless P2P Orderbook Exchange for RWA Tokens
 * @dev Supports Limit Orders (Maker) and Market Fills (Taker) with partial fills.
 */
contract SecondaryMarket is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    struct Order {
        uint256 id;
        address maker;
        address tokenAddress;
        uint256 amount;        // Remaining amount of RWA tokens to buy/sell
        uint256 pricePerToken; // USDC per 1e18 RWA tokens (1:1 ratio = 1e6 USDC)
        bool isBuy;            // true = Bid (Buy RWA), false = Ask (Sell RWA)
        bool isActive;
    }

    IERC20 public usdc;
    IdentityRegistry public identityRegistry;
    
    uint256 public nextOrderId;
    mapping(uint256 => Order) public orders;

    // Events optimized for Indexer
    event OrderCreated(
        uint256 indexed orderId,
        address indexed maker,
        address indexed tokenAddress,
        uint256 amount,
        uint256 pricePerToken,
        bool isBuy,
        uint256 timestamp
    );

    event OrderFilled(
        uint256 indexed orderId,
        address indexed taker,
        address indexed maker,
        address tokenAddress,
        uint256 amountFilled,
        uint256 totalCost,
        uint256 remainingAmount,
        uint256 timestamp
    );

    event OrderCancelled(
        uint256 indexed orderId,
        address indexed maker,
        uint256 timestamp
    );

    event OrderSettledForYield(
        uint256 indexed orderId,
        address indexed maker,
        uint256 settledAmount,
        bool isYieldClaim
    );

    constructor(address _usdc, address _identityRegistry) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
        identityRegistry = IdentityRegistry(_identityRegistry);
    }

    /**
     * @notice Create a Limit Order
     * @param tokenAddress The RWA token address
     * @param amount Amount of RWA tokens to trade (in wei)
     * @param pricePerToken Price in USDC (6 decimals) for 1e18 RWA tokens
     * @param isBuy True for Buy Limit (Bid), False for Sell Limit (Ask)
     */
    function createOrder(
        address tokenAddress,
        uint256 amount,
        uint256 pricePerToken,
        bool isBuy
    ) external nonReentrant {
        require(amount > 0, "Amount must be > 0");
        require(pricePerToken > 0, "Price must be > 0");
        require(identityRegistry.isVerified(msg.sender), "Maker not verified");

        if (isBuy) {
            // BUY ORDER: Maker locks USDC
            // Total USDC needed = (amount * pricePerToken) / 1e18
            uint256 totalUsdc = (amount * pricePerToken) / 1e18;
            require(totalUsdc > 0, "Total value too low");
            usdc.safeTransferFrom(msg.sender, address(this), totalUsdc);
        } else {
            // SELL ORDER: Maker locks RWA Token
            IERC20(tokenAddress).safeTransferFrom(msg.sender, address(this), amount);
        }

        uint256 orderId = nextOrderId++;
        orders[orderId] = Order({
            id: orderId,
            maker: msg.sender,
            tokenAddress: tokenAddress,
            amount: amount,
            pricePerToken: pricePerToken,
            isBuy: isBuy,
            isActive: true
        });

        emit OrderCreated(orderId, msg.sender, tokenAddress, amount, pricePerToken, isBuy, block.timestamp);
    }

    /**
     * @notice Fill an active order (Partial fills allowed)
     * @param orderId The ID of the order to fill
     * @param amountToFill Amount of RWA tokens to fill
     */
    function fillOrder(uint256 orderId, uint256 amountToFill) external nonReentrant {
        Order storage order = orders[orderId];
        require(order.isActive, "Order not active");
        require(amountToFill > 0, "Fill amount must be > 0");
        require(amountToFill <= order.amount, "Fill amount exceeds available");
        require(msg.sender != order.maker, "Cannot fill own order");
        require(identityRegistry.isVerified(msg.sender), "Taker not verified");

        // Calculate Cost in USDC
        // pricePerToken is USDC (6 decimals) per 1e18 RWA
        uint256 costInUsdc = (amountToFill * order.pricePerToken) / 1e18;
        require(costInUsdc > 0, "Trade value too low");

        if (order.isBuy) {
            // FILLING A BUY ORDER (Selling into a Bid)
            // Maker: Buyer (Locked USDC) | Taker: Seller (Sends RWA)
            
            // 1. Taker (Seller) sends RWA to Maker (Buyer)
            IERC20(order.tokenAddress).safeTransferFrom(msg.sender, order.maker, amountToFill);

            // 2. Contract releases USDC to Taker (Seller)
            usdc.safeTransfer(msg.sender, costInUsdc);

        } else {
            // FILLING A SELL ORDER (Buying from an Ask)
            // Maker: Seller (Locked RWA) | Taker: Buyer (Sends USDC)

            // 1. Taker (Buyer) sends USDC to Maker (Seller)
            usdc.safeTransferFrom(msg.sender, order.maker, costInUsdc);

            // 2. Contract releases RWA to Taker (Buyer)
            IERC20(order.tokenAddress).safeTransfer(msg.sender, amountToFill);
        }

        // Update State
        order.amount -= amountToFill;
        if (order.amount == 0) {
            order.isActive = false;
        }

        emit OrderFilled(
            orderId, 
            msg.sender, 
            order.maker, 
            order.tokenAddress, 
            amountToFill, 
            costInUsdc, 
            order.amount, 
            block.timestamp
        );
    }

    /**
     * @notice Cancel an active order
     * @param orderId The ID of the order to cancel
     */
    function cancelOrder(uint256 orderId) external nonReentrant {
        Order storage order = orders[orderId];
        require(order.maker == msg.sender, "Not maker");
        require(order.isActive, "Order not active");

        order.isActive = false;

        if (order.isBuy) {
            // Refund remaining USDC
            uint256 refundUsdc = (order.amount * order.pricePerToken) / 1e18;
            if (refundUsdc > 0) {
                usdc.safeTransfer(msg.sender, refundUsdc);
            }
        } else {
            // Refund remaining RWA
            if (order.amount > 0) {
                IERC20(order.tokenAddress).safeTransfer(msg.sender, order.amount);
            }
        }

        emit OrderCancelled(orderId, msg.sender, block.timestamp);
    }

    /**
     * @notice Admin function to settle orders during yield distribution
     * @param yieldVault Address of the YieldVault contract
     * @param tokenAddress Address of the RWA token
     * @param orderIds List of order IDs to settle
     */
    function settleYield(
        address yieldVault,
        address tokenAddress,
        uint256[] calldata orderIds
    ) external onlyOwner nonReentrant {
        require(yieldVault != address(0), "Invalid YieldVault");
        
        for (uint256 i = 0; i < orderIds.length; i++) {
            Order storage order = orders[orderIds[i]];
            
            // Skip if not active or token mismatch
            if (!order.isActive || order.tokenAddress != tokenAddress) {
                continue;
            }

            order.isActive = false;

            if (order.isBuy) {
                // BUY ORDER: Refund locked USDC
                uint256 refundUsdc = (order.amount * order.pricePerToken) / 1e18;
                if (refundUsdc > 0) {
                    usdc.safeTransfer(order.maker, refundUsdc);
                }
                
                emit OrderSettledForYield(order.id, order.maker, refundUsdc, false);
            } else {
                // SELL ORDER: Burn RWA for Yield (USDC)
                if (order.amount > 0) {
                    // Approve YieldVault
                    IERC20(tokenAddress).approve(yieldVault, order.amount);

                    // Record USDC balance before
                    uint256 balanceBefore = usdc.balanceOf(address(this));

                    // Call claimYield
                    (bool success, ) = yieldVault.call(
                        abi.encodeWithSignature("claimYield(address,uint256)", tokenAddress, order.amount)
                    );
                    require(success, "Yield claim failed");

                    // Calculate yield received
                    uint256 yieldReceived = usdc.balanceOf(address(this)) - balanceBefore;

                    // Transfer yield to maker
                    if (yieldReceived > 0) {
                        usdc.safeTransfer(order.maker, yieldReceived);
                    }
                    
                    emit OrderSettledForYield(order.id, order.maker, yieldReceived, true);
                }
            }
        }
    }
}