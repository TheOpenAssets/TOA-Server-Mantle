import { expect } from "chai";
import { ethers } from "hardhat";
import { AttestationRegistry } from "../typechain-types";

describe("AttestationRegistry", function () {
  let attestationRegistry: AttestationRegistry;
  let owner: any;
  let attestor: any;
  let otherAccount: any;

  beforeEach(async function () {
    [owner, attestor, otherAccount] = await ethers.getSigners();

    const AttestationRegistryFactory = await ethers.getContractFactory("AttestationRegistry");
    attestationRegistry = (await AttestationRegistryFactory.deploy()) as AttestationRegistry;
    await attestationRegistry.waitForDeployment();

    // Add attestor to trusted list
    await attestationRegistry.addTrustedAttestor(attestor.address);
  });

  it("Should register an asset with valid signature", async function () {
    const assetId = ethers.id("asset-1");
    const payload = ethers.toUtf8Bytes("valid-payload");
    const attestationHash = ethers.keccak256(payload);
    const blobId = ethers.id("blob-1");

    // Sign the hash (ethers.Wallet.signMessage adds the prefix automatically)
    // We need to sign the binary data of the hash to match logic usually, 
    // but the contract expects `attestationHash` (bytes32) to be the message.
    // ethers.getBytes(attestationHash) turns the hex string into a Uint8Array.
    const signature = await attestor.signMessage(ethers.getBytes(attestationHash));

    await expect(attestationRegistry.registerAsset(assetId, attestationHash, blobId, payload, signature))
      .to.emit(attestationRegistry, "AssetRegistered")
      .withArgs(assetId, blobId, attestationHash, attestor.address);

    expect(await attestationRegistry.isAssetValid(assetId)).to.be.true;
  });

  it("Should fail registration with invalid signature", async function () {
    const assetId = ethers.id("asset-2");
    const payload = ethers.toUtf8Bytes("payload");
    const attestationHash = ethers.keccak256(payload);
    const blobId = ethers.id("blob-2");

    // Sign with non-trusted account
    const signature = await otherAccount.signMessage(ethers.getBytes(attestationHash));

    await expect(
      attestationRegistry.registerAsset(assetId, attestationHash, blobId, payload, signature)
    ).to.be.revertedWith("Invalid attestor signature");
  });

  it("Should fail if payload hash mismatch", async function () {
    const assetId = ethers.id("asset-3");
    const payload = ethers.toUtf8Bytes("payload");
    const fakePayload = ethers.toUtf8Bytes("fake");
    const attestationHash = ethers.keccak256(payload);
    const blobId = ethers.id("blob-3");

    const signature = await attestor.signMessage(ethers.getBytes(attestationHash));

    await expect(
      attestationRegistry.registerAsset(assetId, attestationHash, blobId, fakePayload, signature)
    ).to.be.revertedWith("Payload hash mismatch");
  });

  it("Should revoke an asset", async function () {
    const assetId = ethers.id("asset-4");
    const payload = ethers.toUtf8Bytes("payload");
    const attestationHash = ethers.keccak256(payload);
    const blobId = ethers.id("blob-4");
    const signature = await attestor.signMessage(ethers.getBytes(attestationHash));

    await attestationRegistry.registerAsset(assetId, attestationHash, blobId, payload, signature);
    expect(await attestationRegistry.isAssetValid(assetId)).to.be.true;

    await expect(attestationRegistry.revokeAsset(assetId, "Violation"))
      .to.emit(attestationRegistry, "AssetRevoked")
      .withArgs(assetId, "Violation", (val: any) => val > 0); // timestamp check

    expect(await attestationRegistry.isAssetValid(assetId)).to.be.false;
  });
});
