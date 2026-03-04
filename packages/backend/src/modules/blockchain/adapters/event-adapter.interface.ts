export interface EventAdapter {
  startListening(): Promise<void>;
  stopListening(): Promise<void>;
}
