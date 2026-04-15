  import { ethers } from "hardhat";                                                   
                                                                                      
  async function main() {                                                                        
    const [deployer] = await ethers.getSigners();
    if (!deployer) {
      throw new Error("No deployer found. Check your .env file and ensure you are running from the packages/contracts directory.");
    }
    console.log(`Using deployer: ${deployer.address}`);

    const PM_ADDRESS = "0x5DA2DB688A19d8ca174D1555FE6796d65F820BF5";                             
    const CORRECT_VAULT = "0x77f1C34Da561Dd38252277a8f1aEb8E14583b398";

    // Asset IDs that were listed with wrong IssuerVault — add all affected ones      
    const assetIds = [                                                                           
      "47b2197f-0b2e-4fcc-b8d8-9c937e47a0be",  // G M Finance             
      "53b2a7cf-5709-43d3-bc28-3c84319dd1ce",  // R K Ventures                                   
      // add more as needed                                                           
    ];                                                                                
                                                                                                 
    const pm = await ethers.getContractAt("PrimaryMarket", PM_ADDRESS, deployer);     
                                                                                                 
    for (const id of assetIds) {                                                   
      const bytes32 = "0x" + id.replace(/-/g, "").padEnd(64, "0");                    
      console.log(`Updating vault for ${id} to ${CORRECT_VAULT}...`);                                     
      // Update to correct IssuerVault address
      const tx = await (pm as any).registerIssuerVault(bytes32, CORRECT_VAULT);             
      await tx.wait();                                                                           
      console.log(`✔ Updated: ${tx.hash}`);                                                      
    }                                                                                            
  }                                                                                              
                                                                                                 
  main().catch(console.error);  