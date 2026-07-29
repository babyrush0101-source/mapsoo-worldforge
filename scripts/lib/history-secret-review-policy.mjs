export function historySecretFindingKey(rule, path, objectId) {
  return `${rule}\0${path}\0${objectId}`;
}

export const REVIEWED_FINDINGS = new Map([
  [
    historySecretFindingKey(
      'password-assignment',
      'src/components/auth/AuthCard.tsx',
      '1234f683712dc0ed7f6c7bde871065c09996117a',
    ),
    'Multilingual UI labels named "password"; the three matched values are translations, not credentials.',
  ],
  [
    historySecretFindingKey(
      'password-assignment',
      'node_modules/@jsr/supabase__supabase-js/test/deno/integration.test.ts',
      '91078935c5a55c7b74918ca3dbd9beed4805629d',
    ),
    'Vendored Supabase integration-test source; matches are static test inputs, not project credentials.',
  ],
  [
    historySecretFindingKey(
      'password-assignment',
      'node_modules/@jsr/supabase__supabase-js/test/integration.test.ts',
      'aae98bbd5b7157d74e6f16dabaa1731b80e877bd',
    ),
    'Vendored Supabase integration-test source; matches are static test inputs, not project credentials.',
  ],
  [
    historySecretFindingKey(
      'password-assignment',
      'node_modules/@jsr/supabase__supabase-js/test/integration/bun/integration.test.ts',
      'd7d1479e70cbd488b69efe2a70c9d6facbf2ca01',
    ),
    'Vendored Supabase integration-test source; matches are static test inputs, not project credentials.',
  ],
  [
    historySecretFindingKey(
      'password-assignment',
      'node_modules/@types/node/crypto.d.ts',
      '036cf8c434eddc7cd9d633212962d10f5f47f178',
    ),
    'Vendored Node.js type declaration; matches occur only inside public API documentation examples.',
  ],
  [
    historySecretFindingKey(
      'password-assignment',
      'node_modules/hono/dist/types/middleware/basic-auth/index.d.ts',
      '80cb793826f48ee239f74556586260514eb6ba2b',
    ),
    'Vendored Hono type declaration; the match occurs inside a public API documentation example.',
  ],
  [
    historySecretFindingKey(
      'password-assignment',
      'node_modules/openai/node_modules/@types/node/crypto.d.ts',
      '4c7f3a7ba046fb798267d8db49ad24f010585539',
    ),
    'Vendored Node.js type declaration; matches occur only inside public API documentation examples.',
  ],
  [
    historySecretFindingKey(
      'password-assignment',
      'src/components/auth/AuthCard.tsx',
      '62e6796583eb51f079a5d861c88448ead07d0f78',
    ),
    'Multilingual UI labels named "password"; all matches equal the already reviewed translation strings.',
  ],
]);
