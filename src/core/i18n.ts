// The interface is English-only. useT() is kept as a single hook for UI labels so a
// translation can be plugged in later without touching every module.
export function useT() {
  return (s: string) => s;
}
