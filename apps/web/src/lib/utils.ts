import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import type { KeyboardEvent } from "react"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** True while an IME composition is in flight (e.g. Enter confirming a Chinese candidate). */
export function isImeComposition(event: KeyboardEvent): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229
}
