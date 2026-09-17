export function storageQuotaMessage(isOwner: boolean): string {
  return isOwner
    ? 'Your storage is full. Clean up space or upgrade your plan.'
    : 'This project storage is full. Contact the project owner to clean up space or upgrade the plan.';
}

export function isStorageQuotaResponse(response: Response, payload: { error?: unknown }): boolean {
  return response.status === 409 && payload.error === 'Storage quota exceeded';
}
