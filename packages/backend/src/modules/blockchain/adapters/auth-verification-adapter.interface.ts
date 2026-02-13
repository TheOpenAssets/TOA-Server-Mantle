export interface AuthVerificationAdapter {
  verifySignatureAndExtractAddress(
    nonce: string,
    signature: string,
    claimedAddress: string
  ): Promise<string>;
}
