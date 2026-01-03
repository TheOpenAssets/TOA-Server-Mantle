export function toISTISOString(date: Date): string {
  const istTime = new Date(date.getTime() + (5.5 * 60 * 60 * 1000));
  return istTime.toISOString().replace('Z', '+05:30');
}