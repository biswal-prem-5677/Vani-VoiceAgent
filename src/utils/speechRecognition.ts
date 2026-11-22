export type RecognitionErrorCode =
  | 'no-speech'
  | 'aborted'
  | 'audio-capture'
  | 'network'
  | 'not-allowed'
  | 'service-not-allowed'
  | 'bad-grammar'
  | 'language-not-supported'
  | string;

export interface RecognitionRestartContext {
  callActive: boolean;
  isMuted: boolean;
  isSpeakingTts: boolean;
  isUnmounted: boolean;
  fatalError: boolean;
  consecutiveErrors: number;
  maxConsecutiveErrors?: number;
}

export function isFatalRecognitionError(error: RecognitionErrorCode): boolean {
  return error === 'not-allowed' || error === 'service-not-allowed';
}

export function isBenignRecognitionError(error: RecognitionErrorCode): boolean {
  return error === 'no-speech' || error === 'aborted';
}

export function shouldRestartRecognition(ctx: RecognitionRestartContext): boolean {
  const maxErrors = ctx.maxConsecutiveErrors ?? 5;
  return (
    ctx.callActive &&
    !ctx.isMuted &&
    !ctx.isSpeakingTts &&
    !ctx.isUnmounted &&
    !ctx.fatalError &&
    ctx.consecutiveErrors < maxErrors
  );
}

export function getRecognitionRestartDelayMs(consecutiveErrors: number): number {
  if (consecutiveErrors <= 0) return 150;
  return Math.min(3000, 200 * Math.pow(2, consecutiveErrors - 1));
}
