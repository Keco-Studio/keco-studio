import 'server-only';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isKecoAdminUser(
  userId: string,
  configuredId: string | undefined = process.env.KECO_ADMIN_USER_ID,
): boolean {
  return Boolean(
    configuredId &&
      UUID_PATTERN.test(configuredId) &&
      userId === configuredId,
  );
}
