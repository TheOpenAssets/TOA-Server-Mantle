// import { useState, useEffect } from 'react';
// import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi';
// import { parseUnits, formatUnits } from 'viem';

// const API_BASE_URL = 'http://localhost:3000';
// const SECONDARY_MARKET = '0x69d2e2B05eDdB11774A132e2b61B9D10486bd33A';
// const USDC_ADDRESS = '0x9A54Bad93a00Bf1232D4e636f5e53055Dc0b8238'; // Update with your USDC address

// const ERC20_ABI = [
//     {
//         name: 'balanceOf',
//         type: 'function',
//         stateMutability: 'view',
//         inputs: [{ name: 'account', type: 'address' }],
//         outputs: [{ name: '', type: 'uint256' }],
//     },
//     {
//         name: 'allowance',
//         type: 'function',
//         stateMutability: 'view',
//         inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
//         outputs: [{ name: '', type: 'uint256' }],
//     },
//     {
//         name: 'approve',
//         type: 'function',
//         stateMutability: 'nonpayable',
//         inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
//         outputs: [{ name: '', type: 'bool' }],
//     },
// ] as const;

// interface Balance {
//     walletBalanceFormatted: string;
//     lockedInOrders: string;
//     inLeverageVault: string;
//     tradeableBalanceFormatted: string;
// }

// interface OrderDetail {
//     orderId: string;
//     maker: string;
//     amount: string;
//     amountFormatted: string;
//     priceFormatted: string;
//     timestamp: string;
//     txHash: string;
// }

// interface PriceLevel {
//     price: string;
//     priceFormatted: string;
//     amount: string;
//     amountFormatted: string;
//     orderCount: number;
//     orders: OrderDetail[];
// }

// interface Orderbook {
//     assetId: string;
//     bids: PriceLevel[];
//     asks: PriceLevel[];
//     summary: {
//         totalBidOrders: number;
//         totalAskOrders: number;
//         bestBid: string;
//         bestAsk: string;
//         spread: string;
//         lastUpdated: string;
//     };
// }

// interface Trade {
//     blockTimestamp: number;
//     buyer: string;
//     seller: string;
//     amount: string;
//     pricePerToken: string;
//     txHash: string;
// }

// export default function P2PTradingTest() {
//     const { address, isConnected } = useAccount();
//     const { writeContract, data: hash, isPending } = useWriteContract();
//     const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash });

//     const [jwt, setJwt] = useState('');
//     const [assetId, setAssetId] = useState('0950a194-fa8a-4875-ae62-38a5ce5cc34b');
//     const [tokenAddress, setTokenAddress] = useState('0xdACDE38885c0d3471fd4635B407410856556405A');
//     const [balance, setBalance] = useState<Balance | null>(null);
//     const [orderbook, setOrderbook] = useState<Orderbook | null>(null);
//     const [trades, setTrades] = useState<Trade[]>([]);
//     const [activeTab, setActiveTab] = useState<'balance' | 'create' | 'orderbook' | 'trades'>('balance');

//     const [orderAmount, setOrderAmount] = useState('');
//     const [orderPrice, setOrderPrice] = useState('');
//     const [orderType, setOrderType] = useState<'buy' | 'sell'>('sell');
//     const [approvalStatus, setApprovalStatus] = useState<'checking' | 'needed' | 'approved' | 'approving'>('checking');
//     const [usdcApprovalStatus, setUsdcApprovalStatus] = useState<'checking' | 'needed' | 'approved' | 'approving'>('checking');

//     // Status messages
//     const [statusMessage, setStatusMessage] = useState('');
//     const [isLoading, setIsLoading] = useState(false);

//     // Fill order state - track which order is being filled and its approval status
//     const [fillingOrderId, setFillingOrderId] = useState<string | null>(null);
//     const [fillApprovalStatus, setFillApprovalStatus] = useState<'checking' | 'needed' | 'approved' | 'approving'>('checking');

//     // Read contract balance
//     const { data: contractBalance, refetch: refetchContractBalance } = useReadContract({
//         address: tokenAddress as `0x${string}`,
//         abi: ERC20_ABI,
//         functionName: 'balanceOf',
//         args: address ? [address] : undefined,
//         query: {
//             enabled: !!tokenAddress && !!address,
//         },
//     });

//     // Read token allowance
//     const { data: allowance, refetch: refetchAllowance } = useReadContract({
//         address: tokenAddress as `0x${string}`,
//         abi: ERC20_ABI,
//         functionName: 'allowance',
//         args: address ? [address, SECONDARY_MARKET] : undefined,
//         query: {
//             enabled: !!tokenAddress && !!address,
//         },
//     });

//     // Read USDC balance
//     const { data: usdcBalance, refetch: refetchUsdcBalance } = useReadContract({
//         address: USDC_ADDRESS as `0x${string}`,
//         abi: ERC20_ABI,
//         functionName: 'balanceOf',
//         args: address ? [address] : undefined,
//         query: {
//             enabled: !!address,
//         },
//     });

//     // Read USDC allowance
//     const { data: usdcAllowance, refetch: refetchUsdcAllowance } = useReadContract({
//         address: USDC_ADDRESS as `0x${string}`,
//         abi: ERC20_ABI,
//         functionName: 'allowance',
//         args: address ? [address, SECONDARY_MARKET] : undefined,
//         query: {
//             enabled: !!address,
//         },
//     });

//     // Check approval status for creating orders
//     useEffect(() => {
//         if (orderType === 'sell') {
//             // Selling tokens - need asset token approval
//             if (tokenAddress && orderAmount) {
//                 try {
//                     const needed = parseUnits(orderAmount, 18);
//                     if (allowance === undefined) {
//                         setApprovalStatus('checking');
//                     } else if (allowance < needed) {
//                         setApprovalStatus('needed');
//                     } else {
//                         setApprovalStatus('approved');
//                     }
//                 } catch {
//                     setApprovalStatus('checking');
//                 }
//             } else {
//                 setApprovalStatus('approved');
//             }
//         } else {
//             // Not a sell order, no asset token approval needed
//             setApprovalStatus('approved');
//         }
//     }, [allowance, orderAmount, orderType, tokenAddress]);

//     // Check USDC approval status for creating buy orders
//     useEffect(() => {
//         if (orderType === 'buy') {
//             // Buying tokens - need USDC approval
//             if (orderAmount && orderPrice) {
//                 try {
//                     const price = parseUnits(orderPrice, 6);
//                     const amount = parseUnits(orderAmount, 18);
//                     const totalCost = (price * amount) / parseUnits('1', 18);

//                     if (usdcAllowance === undefined) {
//                         setUsdcApprovalStatus('checking');
//                     } else if (usdcAllowance < totalCost) {
//                         setUsdcApprovalStatus('needed');
//                     } else {
//                         setUsdcApprovalStatus('approved');
//                     }
//                 } catch {
//                     setUsdcApprovalStatus('checking');
//                 }
//             } else {
//                 setUsdcApprovalStatus('approved');
//             }
//         } else {
//             // Not a buy order, no USDC approval needed
//             setUsdcApprovalStatus('approved');
//         }
//     }, [usdcAllowance, orderAmount, orderPrice, orderType]);

//     // Show status message helper
//     const showStatus = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
//         const emoji = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
//         setStatusMessage(`${emoji} ${message}`);
//         setTimeout(() => setStatusMessage(''), 5000);
//     };

//     const fetchBalance = async () => {
//         if (!jwt || !assetId) {
//             showStatus('Please enter JWT and Asset ID', 'error');
//             return;
//         }
//         try {
//             setIsLoading(true);
//             showStatus('Fetching balance...', 'info');
//             const res = await fetch(`${API_BASE_URL}/marketplace/secondary/${assetId}/my-balance`, {
//                 headers: { Authorization: `Bearer ${jwt}` },
//             });
//             if (!res.ok) throw new Error('Failed to fetch balance');
//             const data = await res.json();
//             setBalance(data);
//             showStatus('Balance updated', 'success');
//         } catch (error: any) {
//             showStatus(`Error: ${error.message}`, 'error');
//             console.error('Error fetching balance:', error);
//         } finally {
//             setIsLoading(false);
//         }
//     };

//     const fetchOrderbook = async () => {
//         if (!assetId) {
//             showStatus('Please enter Asset ID', 'error');
//             return;
//         }
//         try {
//             setIsLoading(true);
//             showStatus('Fetching orderbook...', 'info');
//             const res = await fetch(`${API_BASE_URL}/marketplace/secondary/${assetId}/orderbook`);
//             if (!res.ok) throw new Error('Failed to fetch orderbook');
//             const data = await res.json();
//             setOrderbook(data);
//             showStatus(`Orderbook updated: ${data.summary?.totalBidOrders || 0} bids, ${data.summary?.totalAskOrders || 0} asks`, 'success');
//         } catch (error: any) {
//             showStatus(`Error: ${error.message}`, 'error');
//             console.error('Error fetching orderbook:', error);
//         } finally {
//             setIsLoading(false);
//         }
//     };

//     const fetchTrades = async () => {
//         if (!assetId) {
//             showStatus('Please enter Asset ID', 'error');
//             return;
//         }
//         try {
//             setIsLoading(true);
//             showStatus('Fetching trades...', 'info');
//             const res = await fetch(`${API_BASE_URL}/marketplace/secondary/${assetId}/trades`);
//             if (!res.ok) throw new Error('Failed to fetch trades');
//             const data = await res.json();
//             setTrades(data);
//             showStatus(`${data.length} trades loaded`, 'success');
//         } catch (error: any) {
//             showStatus(`Error: ${error.message}`, 'error');
//             console.error('Error fetching trades:', error);
//         } finally {
//             setIsLoading(false);
//         }
//     };

//     // Remove auto-refresh - only fetch when user clicks refresh
//     useEffect(() => {
//         if (isConfirmed) {
//             showStatus('Transaction confirmed! Refreshing data...', 'success');
//             // Reset fill order state
//             setFillingOrderId(null);
//             setFillApprovalStatus('checking');
//             setTimeout(() => {
//                 fetchBalance();
//                 fetchOrderbook();
//                 fetchTrades();
//                 refetchContractBalance();
//                 refetchAllowance();
//                 refetchUsdcBalance();
//                 refetchUsdcAllowance();
//             }, 2000);
//         }
//     }, [isConfirmed]);

//     const approveTokens = async () => {
//         if (!tokenAddress) {
//             showStatus('Please enter token address', 'error');
//             return;
//         }

//         try {
//             setApprovalStatus('approving');
//             showStatus('Approving tokens...', 'info');
//             const amount = parseUnits(orderAmount, 18);

//             writeContract({
//                 address: tokenAddress as `0x${string}`,
//                 abi: ERC20_ABI,
//                 functionName: 'approve',
//                 args: [SECONDARY_MARKET, amount],
//             });
//         } catch (error: any) {
//             console.error('Approval error:', error);
//             showStatus(`Approval failed: ${error.message}`, 'error');
//             setApprovalStatus('needed');
//         }
//     };

//     const approveUSDCForBuyOrder = async () => {
//         if (!orderAmount || !orderPrice) {
//             showStatus('Please enter amount and price', 'error');
//             return;
//         }

//         try {
//             setUsdcApprovalStatus('approving');
//             showStatus('Approving USDC for buy order...', 'info');

//             const price = parseUnits(orderPrice, 6);
//             const amount = parseUnits(orderAmount, 18);
//             const totalCost = (price * amount) / parseUnits('1', 18);

//             writeContract({
//                 address: USDC_ADDRESS as `0x${string}`,
//                 abi: ERC20_ABI,
//                 functionName: 'approve',
//                 args: [SECONDARY_MARKET, totalCost],
//             });
//         } catch (error: any) {
//             console.error('USDC approval error:', error);
//             showStatus(`USDC approval failed: ${error.message}`, 'error');
//             setUsdcApprovalStatus('needed');
//         }
//     };

//     const approveUSDCForFillOrder = async (amount: bigint) => {
//         try {
//             setFillApprovalStatus('approving');
//             showStatus('Approving USDC for order fill...', 'info');

//             writeContract({
//                 address: USDC_ADDRESS as `0x${string}`,
//                 abi: ERC20_ABI,
//                 functionName: 'approve',
//                 args: [SECONDARY_MARKET, amount],
//             });
//         } catch (error: any) {
//             console.error('USDC approval error:', error);
//             showStatus(`USDC approval failed: ${error.message}`, 'error');
//             setFillApprovalStatus('needed');
//         }
//     };

//     const approveTokensForFillOrder = async (amount: bigint) => {
//         if (!tokenAddress) {
//             showStatus('Token address not set', 'error');
//             return;
//         }

//         try {
//             setFillApprovalStatus('approving');
//             showStatus('Approving tokens for order fill...', 'info');

//             writeContract({
//                 address: tokenAddress as `0x${string}`,
//                 abi: ERC20_ABI,
//                 functionName: 'approve',
//                 args: [SECONDARY_MARKET, amount],
//             });
//         } catch (error: any) {
//             console.error('Token approval error:', error);
//             showStatus(`Token approval failed: ${error.message}`, 'error');
//             setFillApprovalStatus('needed');
//         }
//     };

//     const createOrder = async () => {
//         if (!jwt || !tokenAddress || !orderAmount || !orderPrice) {
//             showStatus('Please fill all fields', 'error');
//             return;
//         }

//         // Check approval based on order type
//         if (orderType === 'sell' && approvalStatus !== 'approved') {
//             showStatus('Please approve asset tokens first', 'error');
//             return;
//         }

//         if (orderType === 'buy' && usdcApprovalStatus !== 'approved') {
//             showStatus('Please approve USDC first', 'error');
//             return;
//         }

//         try {
//             showStatus('Creating order...', 'info');
//             const res = await fetch(`${API_BASE_URL}/marketplace/secondary/tx/create-order`, {
//                 method: 'POST',
//                 headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
//                 body: JSON.stringify({
//                     tokenAddress,
//                     amount: parseUnits(orderAmount, 18).toString(),
//                     pricePerToken: parseUnits(orderPrice, 6).toString(),
//                     isBuy: orderType === 'buy',
//                 }),
//             });

//             if (!res.ok) {
//                 const error = await res.json();
//                 throw new Error(error.message || 'Failed to create order');
//             }

//             const txData = await res.json();
//             showStatus('Sending transaction...', 'info');
//             writeContract({
//                 address: txData.to,
//                 abi: txData.abi,
//                 functionName: txData.functionName,
//                 args: txData.args,
//             });
//         } catch (error: any) {
//             showStatus(`Error: ${error.message}`, 'error');
//         }
//     };

//     const checkFillOrderApproval = (order: OrderDetail, isBuyOrder: boolean): boolean => {
//         // For buy orders (we're selling tokens to the buyer), check token approval
//         if (isBuyOrder) {
//             const amountNeeded = BigInt(order.amount);
//             if (!allowance || allowance < amountNeeded) {
//                 return false; // Approval needed
//             }
//         } else {
//             // For sell orders (we're buying tokens from the seller), check USDC approval
//             const price = parseUnits(order.priceFormatted, 6);
//             const amount = parseUnits(order.amountFormatted, 18);
//             const totalCost = (price * amount) / parseUnits('1', 18);

//             if (!usdcAllowance || usdcAllowance < totalCost) {
//                 return false; // Approval needed
//             }
//         }
//         return true; // Approved
//     };

//     const fillOrderClick = async (order: OrderDetail, isBuyOrder: boolean) => {
//         if (!jwt) {
//             showStatus('Please enter JWT token', 'error');
//             return;
//         }

//         // Check if we're already processing this order's approval
//         if (fillingOrderId === order.orderId && fillApprovalStatus === 'approving') {
//             showStatus('Approval in progress...', 'info');
//             return;
//         }

//         // Check approval status
//         const isApproved = checkFillOrderApproval(order, isBuyOrder);

//         if (!isApproved) {
//             // Need approval first
//             setFillingOrderId(order.orderId);
//             setFillApprovalStatus('needed');

//             if (isBuyOrder) {
//                 // Filling a buy order - we're selling tokens, need token approval
//                 const amountNeeded = BigInt(order.amount);
//                 showStatus('Token approval needed. Click approve button.', 'info');
//                 await approveTokensForFillOrder(amountNeeded);
//             } else {
//                 // Filling a sell order - we're buying tokens, need USDC approval
//                 const price = parseUnits(order.priceFormatted, 6);
//                 const amount = parseUnits(order.amountFormatted, 18);
//                 const totalCost = (price * amount) / parseUnits('1', 18);
//                 showStatus('USDC approval needed. Click approve button.', 'info');
//                 await approveUSDCForFillOrder(totalCost);
//             }
//             return;
//         }

//         // Approval is good, proceed with filling order
//         try {
//             setFillingOrderId(order.orderId);
//             showStatus(`Filling order #${order.orderId}...`, 'info');
//             const res = await fetch(`${API_BASE_URL}/marketplace/secondary/tx/fill-order`, {
//                 method: 'POST',
//                 headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
//                 body: JSON.stringify({
//                     orderId: order.orderId,
//                     amountToFill: order.amount,
//                 }),
//             });

//             if (!res.ok) {
//                 const error = await res.json();
//                 throw new Error(error.message || 'Failed to fill order');
//             }

//             const txData = await res.json();
//             showStatus('Sending transaction...', 'info');
//             writeContract({
//                 address: txData.to,
//                 abi: txData.abi,
//                 functionName: txData.functionName,
//                 args: txData.args,
//             });
//         } catch (error: any) {
//             showStatus(`Error: ${error.message}`, 'error');
//             setFillingOrderId(null);
//         }
//     };

//     if (!isConnected) {
//         return (
//             <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
//                 <div className="text-center">
//                     <h1 className="text-3xl font-bold mb-4">P2P Trading Test</h1>
//                     <p className="text-gray-400">Please connect your wallet</p>
//                 </div>
//             </div>
//         );
//     }

//     return (
//         <div className="min-h-screen bg-gray-900 text-white p-6">
//             <div className="max-w-6xl mx-auto">
//                 <div className="mb-8">
//                     <h1 className="text-3xl font-bold mb-2">P2P Trading Test</h1>
//                     <p className="text-gray-400 text-sm">Connected: {address}</p>
//                 </div>

//                 {/* Status Message */}
//                 {statusMessage && (
//                     <div className="mb-4 p-4 bg-gray-800 border-l-4 border-blue-500 rounded-lg animate-pulse">
//                         <p className="text-sm">{statusMessage}</p>
//                     </div>
//                 )}

//                 {/* Setup */}
//                 <div className="bg-gray-800 rounded-lg p-6 mb-6">
//                     <h2 className="text-xl font-semibold mb-4">Setup</h2>
//                     <div className="space-y-3">
//                         <input
//                             type="text"
//                             placeholder="JWT Token"
//                             value={jwt}
//                             onChange={(e) => setJwt(e.target.value)}
//                             className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
//                         />
//                         <input
//                             type="text"
//                             placeholder="Asset ID"
//                             value={assetId}
//                             onChange={(e) => setAssetId(e.target.value)}
//                             className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
//                         />
//                         <input
//                             type="text"
//                             placeholder="Token Address"
//                             value={tokenAddress}
//                             onChange={(e) => setTokenAddress(e.target.value)}
//                             className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
//                         />
//                     </div>
//                 </div>

//                 {/* Tabs */}
//                 <div className="flex space-x-2 mb-6 border-b border-gray-700">
//                     {(['balance', 'create', 'orderbook', 'trades'] as const).map((tab) => (
//                         <button
//                             key={tab}
//                             onClick={() => setActiveTab(tab)}
//                             className={`px-6 py-3 font-medium capitalize transition-colors ${activeTab === tab
//                                 ? 'text-white border-b-2 border-green-500'
//                                 : 'text-gray-400 hover:text-white'
//                                 }`}
//                         >
//                             {tab}
//                         </button>
//                     ))}
//                 </div>

//                 {/* Balance Tab */}
//                 {activeTab === 'balance' && (
//                     <div className="bg-gray-800 rounded-lg p-6">
//                         <h2 className="text-xl font-semibold mb-4">Your Balance</h2>

//                         {/* Backend Balance */}
//                         {balance && (
//                             <div className="mb-4">
//                                 <h3 className="text-sm text-gray-400 mb-2">Backend (Database)</h3>
//                                 <div className="bg-gray-700 rounded-lg p-4 space-y-2">
//                                     <p><span className="text-gray-400">Wallet:</span> <span className="font-mono">{balance.walletBalanceFormatted}</span></p>
//                                     <p><span className="text-gray-400">Locked:</span> <span className="font-mono">{balance.lockedInOrders}</span></p>
//                                     <p><span className="text-gray-400">Leverage:</span> <span className="font-mono">{balance.inLeverageVault}</span></p>
//                                     <p className="text-green-400 text-lg font-semibold">
//                                         <span className="text-gray-400">Tradeable:</span> {balance.tradeableBalanceFormatted}
//                                     </p>
//                                 </div>
//                             </div>
//                         )}

//                         {/* Contract Balances */}
//                         <div className="mb-4">
//                             <h3 className="text-sm text-gray-400 mb-2">On-Chain (Contract)</h3>
//                             <div className="bg-gray-700 rounded-lg p-4 space-y-2">
//                                 {tokenAddress && (
//                                     <>
//                                         <p>
//                                             <span className="text-gray-400">RWA Token:</span>{' '}
//                                             <span className="font-mono text-blue-400">
//                                                 {contractBalance ? formatUnits(contractBalance, 18) : '...'} tokens
//                                             </span>
//                                         </p>
//                                         <p>
//                                             <span className="text-gray-400">RWA Allowance:</span>{' '}
//                                             <span className="font-mono text-yellow-400">
//                                                 {allowance ? formatUnits(allowance, 18) : '...'} tokens
//                                             </span>
//                                         </p>
//                                     </>
//                                 )}
//                                 <p>
//                                     <span className="text-gray-400">USDC Balance:</span>{' '}
//                                     <span className="font-mono text-green-400">
//                                         {usdcBalance ? formatUnits(usdcBalance, 6) : '...'} USDC
//                                     </span>
//                                 </p>
//                                 <p>
//                                     <span className="text-gray-400">USDC Allowance:</span>{' '}
//                                     <span className="font-mono text-purple-400">
//                                         {usdcAllowance ? formatUnits(usdcAllowance, 6) : '...'} USDC
//                                     </span>
//                                 </p>
//                             </div>
//                         </div>

//                         <div className="flex gap-2">
//                             <button
//                                 onClick={fetchBalance}
//                                 disabled={isLoading}
//                                 className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded-lg transition-colors"
//                             >
//                                 {isLoading ? 'Loading...' : 'Refresh Backend'}
//                             </button>
//                             <button
//                                 onClick={() => {
//                                     refetchContractBalance();
//                                     refetchAllowance();
//                                     refetchUsdcBalance();
//                                     refetchUsdcAllowance();
//                                     showStatus('Contract data refreshed', 'success');
//                                 }}
//                                 className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
//                             >
//                                 Refresh Contract
//                             </button>
//                         </div>
//                     </div>
//                 )}

//                 {/* Create Order Tab */}
//                 {activeTab === 'create' && (
//                     <div className="bg-gray-800 rounded-lg p-6">
//                         <h2 className="text-xl font-semibold mb-4">Create Order</h2>

//                         <div className="flex space-x-4 mb-4">
//                             <label className="flex items-center space-x-2 cursor-pointer">
//                                 <input
//                                     type="radio"
//                                     value="sell"
//                                     checked={orderType === 'sell'}
//                                     onChange={(e) => setOrderType(e.target.value as 'sell')}
//                                     className="w-4 h-4"
//                                 />
//                                 <span>Sell (Ask)</span>
//                             </label>
//                             <label className="flex items-center space-x-2 cursor-pointer">
//                                 <input
//                                     type="radio"
//                                     value="buy"
//                                     checked={orderType === 'buy'}
//                                     onChange={(e) => setOrderType(e.target.value as 'buy')}
//                                     className="w-4 h-4"
//                                 />
//                                 <span>Buy (Bid)</span>
//                             </label>
//                         </div>

//                         {/* Approval Status */}
//                         {orderType === 'sell' && tokenAddress && (
//                             <div className="mb-4 p-3 bg-gray-700 rounded-lg">
//                                 <div className="flex justify-between items-center">
//                                     <span className="text-sm text-gray-400">Asset Token Approval:</span>
//                                     <span
//                                         className={`text-sm font-semibold ${approvalStatus === 'approved'
//                                             ? 'text-green-400'
//                                             : approvalStatus === 'needed'
//                                                 ? 'text-red-400'
//                                                 : approvalStatus === 'approving'
//                                                     ? 'text-yellow-400'
//                                                     : 'text-gray-400'
//                                             }`}
//                                     >
//                                         {approvalStatus === 'approved' && '✅ Approved'}
//                                         {approvalStatus === 'needed' && '❌ Approval Needed'}
//                                         {approvalStatus === 'approving' && '⏳ Approving...'}
//                                         {approvalStatus === 'checking' && '🔍 Checking...'}
//                                     </span>
//                                 </div>
//                                 {allowance !== undefined && (
//                                     <p className="text-xs text-gray-500 mt-1">
//                                         Current: {formatUnits(allowance, 18)} | Needed: {orderAmount || '0'}
//                                     </p>
//                                 )}
//                             </div>
//                         )}

//                         {orderType === 'buy' && (
//                             <div className="mb-4 p-3 bg-gray-700 rounded-lg">
//                                 <div className="flex justify-between items-center">
//                                     <span className="text-sm text-gray-400">USDC Approval:</span>
//                                     <span
//                                         className={`text-sm font-semibold ${usdcApprovalStatus === 'approved'
//                                             ? 'text-green-400'
//                                             : usdcApprovalStatus === 'needed'
//                                                 ? 'text-red-400'
//                                                 : usdcApprovalStatus === 'approving'
//                                                     ? 'text-yellow-400'
//                                                     : 'text-gray-400'
//                                             }`}
//                                     >
//                                         {usdcApprovalStatus === 'approved' && '✅ Approved'}
//                                         {usdcApprovalStatus === 'needed' && '❌ Approval Needed'}
//                                         {usdcApprovalStatus === 'approving' && '⏳ Approving...'}
//                                         {usdcApprovalStatus === 'checking' && '🔍 Checking...'}
//                                     </span>
//                                 </div>
//                                 {usdcAllowance !== undefined && orderAmount && orderPrice && (
//                                     <p className="text-xs text-gray-500 mt-1">
//                                         Current: {formatUnits(usdcAllowance, 6)} USDC | Needed: {(parseFloat(orderAmount) * parseFloat(orderPrice)).toFixed(2)} USDC
//                                     </p>
//                                 )}
//                             </div>
//                         )}

//                         <div className="space-y-3 mb-4">
//                             <input
//                                 type="text"
//                                 placeholder="Amount (tokens)"
//                                 value={orderAmount}
//                                 onChange={(e) => setOrderAmount(e.target.value)}
//                                 className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
//                             />
//                             <input
//                                 type="text"
//                                 placeholder="Price (USDC per token)"
//                                 value={orderPrice}
//                                 onChange={(e) => setOrderPrice(e.target.value)}
//                                 className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
//                             />
//                         </div>

//                         {/* Approval Buttons */}
//                         {orderType === 'sell' && approvalStatus === 'needed' && (
//                             <button
//                                 onClick={approveTokens}
//                                 disabled={isPending}
//                                 className="w-full px-4 py-3 mb-3 bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-600 rounded-lg font-semibold transition-colors"
//                             >
//                                 {isPending ? 'Approving...' : '🔓 Approve Asset Tokens'}
//                             </button>
//                         )}

//                         {orderType === 'buy' && usdcApprovalStatus === 'needed' && (
//                             <button
//                                 onClick={approveUSDCForBuyOrder}
//                                 disabled={isPending}
//                                 className="w-full px-4 py-3 mb-3 bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-600 rounded-lg font-semibold transition-colors"
//                             >
//                                 {isPending ? 'Approving...' : '🔓 Approve USDC'}
//                             </button>
//                         )}

//                         <button
//                             onClick={createOrder}
//                             disabled={isPending || (orderType === 'sell' && approvalStatus !== 'approved') || (orderType === 'buy' && usdcApprovalStatus !== 'approved')}
//                             className="w-full px-4 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 rounded-lg font-semibold transition-colors"
//                         >
//                             {isPending ? 'Creating...' : 'Create Order'}
//                         </button>

//                         {isConfirming && <p className="mt-4 text-yellow-400">Waiting for confirmation...</p>}
//                         {isConfirmed && <p className="mt-4 text-green-400">✅ Transaction confirmed!</p>}
//                     </div>
//                 )}

//                 {/* Orderbook Tab */}
//                 {activeTab === 'orderbook' && (
//                     <div className="bg-gray-800 rounded-lg p-6">
//                         <div className="flex justify-between items-center mb-4">
//                             <h2 className="text-xl font-semibold">Orderbook</h2>
//                             <button
//                                 onClick={fetchOrderbook}
//                                 disabled={isLoading}
//                                 className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded-lg transition-colors text-sm"
//                             >
//                                 {isLoading ? 'Loading...' : '🔄 Refresh'}
//                             </button>
//                         </div>

//                         {/* Summary Stats */}
//                         {orderbook?.summary && (
//                             <div className="mb-4 grid grid-cols-4 gap-3">
//                                 <div className="bg-gray-700 p-3 rounded-lg">
//                                     <p className="text-xs text-gray-400">Best Bid</p>
//                                     <p className="text-lg font-semibold text-green-400">{orderbook.summary.bestBid || '-'}</p>
//                                 </div>
//                                 <div className="bg-gray-700 p-3 rounded-lg">
//                                     <p className="text-xs text-gray-400">Best Ask</p>
//                                     <p className="text-lg font-semibold text-red-400">{orderbook.summary.bestAsk || '-'}</p>
//                                 </div>
//                                 <div className="bg-gray-700 p-3 rounded-lg">
//                                     <p className="text-xs text-gray-400">Spread</p>
//                                     <p className="text-lg font-semibold">{orderbook.summary.spread || '-'}</p>
//                                 </div>
//                                 <div className="bg-gray-700 p-3 rounded-lg">
//                                     <p className="text-xs text-gray-400">Total Orders</p>
//                                     <p className="text-lg font-semibold">{orderbook.summary.totalBidOrders + orderbook.summary.totalAskOrders}</p>
//                                 </div>
//                             </div>
//                         )}

//                         <div className="grid grid-cols-2 gap-4">
//                             {/* Bids */}
//                             <div>
//                                 <h3 className="text-green-400 font-semibold mb-3">🟢 Bids (Buy Orders)</h3>
//                                 {!orderbook || orderbook.bids.length === 0 ? (
//                                     <p className="text-gray-500 text-sm">No buy orders</p>
//                                 ) : (
//                                     <div className="space-y-3">
//                                         {orderbook.bids.map((level, i) => (
//                                             <div key={i} className="bg-gray-700 rounded-lg p-3">
//                                                 <div className="flex justify-between items-center mb-2 border-b border-gray-600 pb-2">
//                                                     <span className="font-semibold text-green-400">${level.priceFormatted}</span>
//                                                     <span className="text-sm text-gray-400">{level.orderCount} order{level.orderCount > 1 ? 's' : ''}</span>
//                                                 </div>
//                                                 <div className="space-y-2">
//                                                     {level.orders.map((order) => (
//                                                         <div key={order.orderId} className="bg-gray-800 p-2 rounded flex justify-between items-center">
//                                                             <div className="flex-1">
//                                                                 <p className="text-xs text-gray-400">Order #{order.orderId}</p>
//                                                                 <p className="text-sm font-mono">{order.amountFormatted} tokens</p>
//                                                                 <p className="text-xs text-gray-500">{order.maker.slice(0, 6)}...{order.maker.slice(-4)}</p>
//                                                             </div>
//                                                             <button
//                                                                 onClick={() => fillOrderClick(order, true)}
//                                                                 disabled={isPending || !jwt}
//                                                                 className="ml-2 px-3 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 rounded text-sm font-semibold transition-colors"
//                                                             >
//                                                                 Sell to Bid
//                                                             </button>
//                                                         </div>
//                                                     ))}
//                                                 </div>
//                                             </div>
//                                         ))}
//                                     </div>
//                                 )}
//                             </div>

//                             {/* Asks */}
//                             <div>
//                                 <h3 className="text-red-400 font-semibold mb-3">🔴 Asks (Sell Orders)</h3>
//                                 {!orderbook || orderbook.asks.length === 0 ? (
//                                     <p className="text-gray-500 text-sm">No sell orders</p>
//                                 ) : (
//                                     <div className="space-y-3">
//                                         {orderbook.asks.map((level, i) => (
//                                             <div key={i} className="bg-gray-700 rounded-lg p-3">
//                                                 <div className="flex justify-between items-center mb-2 border-b border-gray-600 pb-2">
//                                                     <span className="font-semibold text-red-400">${level.priceFormatted}</span>
//                                                     <span className="text-sm text-gray-400">{level.orderCount} order{level.orderCount > 1 ? 's' : ''}</span>
//                                                 </div>
//                                                 <div className="space-y-2">
//                                                     {level.orders.map((order) => (
//                                                         <div key={order.orderId} className="bg-gray-800 p-2 rounded flex justify-between items-center">
//                                                             <div className="flex-1">
//                                                                 <p className="text-xs text-gray-400">Order #{order.orderId}</p>
//                                                                 <p className="text-sm font-mono">{order.amountFormatted} tokens</p>
//                                                                 <p className="text-xs text-gray-500">{order.maker.slice(0, 6)}...{order.maker.slice(-4)}</p>
//                                                             </div>
//                                                             <button
//                                                                 onClick={() => fillOrderClick(order, false)}
//                                                                 disabled={isPending || !jwt}
//                                                                 className="ml-2 px-3 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 rounded text-sm font-semibold transition-colors"
//                                                             >
//                                                                 Buy from Ask
//                                                             </button>
//                                                         </div>
//                                                     ))}
//                                                 </div>
//                                             </div>
//                                         ))}
//                                     </div>
//                                 )}
//                             </div>
//                         </div>
//                     </div>
//                 )}

//                 {/* Trade History Tab */}
//                 {activeTab === 'trades' && (
//                     <div className="bg-gray-800 rounded-lg p-6">
//                         <div className="flex justify-between items-center mb-4">
//                             <h2 className="text-xl font-semibold">Trade History</h2>
//                             <button
//                                 onClick={fetchTrades}
//                                 disabled={isLoading}
//                                 className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded-lg transition-colors text-sm"
//                             >
//                                 {isLoading ? 'Loading...' : '🔄 Refresh'}
//                             </button>
//                         </div>
//                         {trades.length === 0 ? (
//                             <p className="text-gray-500">No trades yet</p>
//                         ) : (
//                             <div className="overflow-x-auto">
//                                 <table className="w-full text-sm">
//                                     <thead className="text-left border-b border-gray-700">
//                                         <tr>
//                                             <th className="pb-2">Time</th>
//                                             <th className="pb-2">Buyer</th>
//                                             <th className="pb-2">Seller</th>
//                                             <th className="pb-2">Amount</th>
//                                             <th className="pb-2">Price</th>
//                                             <th className="pb-2">Tx</th>
//                                         </tr>
//                                     </thead>
//                                     <tbody>
//                                         {trades.map((trade, i) => (
//                                             <tr key={i} className="border-b border-gray-700">
//                                                 <td className="py-2">{new Date(trade.blockTimestamp).toLocaleTimeString()}</td>
//                                                 <td className="py-2 font-mono text-xs">{trade.buyer.slice(0, 6)}...{trade.buyer.slice(-4)}</td>
//                                                 <td className="py-2 font-mono text-xs">{trade.seller.slice(0, 6)}...{trade.seller.slice(-4)}</td>
//                                                 <td className="py-2">{formatUnits(BigInt(trade.amount), 18)}</td>
//                                                 <td className="py-2">{formatUnits(BigInt(trade.pricePerToken), 6)}</td>
//                                                 <td className="py-2">
//                                                     <a
//                                                         href={`https://sepolia.mantlescan.xyz/tx/${trade.txHash}`}
//                                                         target="_blank"
//                                                         rel="noopener noreferrer"
//                                                         className="text-blue-400 hover:underline"
//                                                     >
//                                                         View
//                                                     </a>
//                                                 </td>
//                                             </tr>
//                                         ))}
//                                     </tbody>
//                                 </table>
//                             </div>
//                         )}
//                     </div>
//                 )}

//                 {/* Transaction Status */}
//                 {hash && (
//                     <div className="mt-6 bg-gray-800 rounded-lg p-4">
//                         <p className="text-sm text-gray-400 mb-1">Transaction Hash:</p>
//                         <p className="font-mono text-xs mb-2 break-all">{hash}</p>
//                         <a
//                             href={`https://sepolia.mantlescan.xyz/tx/${hash}`}
//                             target="_blank"
//                             rel="noopener noreferrer"
//                             className="text-blue-400 hover:underline text-sm"
//                         >
//                             View on Explorer →
//                         </a>
//                     </div>
//                 )}
//             </div>
//         </div>
//     );
// }
