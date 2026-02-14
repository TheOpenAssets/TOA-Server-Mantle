export interface IAuthVerificationAdapter {
  verify(address: string, message: string, signature: string): Promise<boolean>;
}

export const IAuthVerificationAdapter = Symbol('IAuthVerificationAdapter');
