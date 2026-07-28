import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

const repositoryRoot = resolve(import.meta.dirname, '..');
const sourceRoot = resolve(repositoryRoot, 'src');
const supportedExtensions = new Set(['.ts', '.tsx']);

const allowedLayerDependencies = Object.freeze({
  core: new Set(['core']),
  providers: new Set(['core', 'providers', 'adapters']),
  adapters: new Set(['core', 'adapters']),
  integrations: new Set(['core', 'adapters', 'integrations']),
  app: new Set(['core', 'providers', 'adapters', 'integrations', 'app']),
  features: new Set(['core', 'providers', 'adapters', 'integrations', 'app', 'features']),
});

const compatibilityExceptions = new Set([
  'core/generation-provider.ts -> providers/procedural-pixel-provider',
  'core/generation-provider.ts -> providers/procedural-terrain-provider',
  'core/playable-terrain-export-policy.ts -> providers/procedural-terrain-provider',
  'adapters/import-external-host-asset-request.ts -> integrations/external-host/asset-request',
  'adapters/world-delivery-workspace.ts -> app/world-delivery-workspace',
  'app/App.tsx -> features/world-creation-dialogue/WorldCreationDialogue',
  'app/App.tsx -> features/world-gallery/WorldGallery',
  'app/App.tsx -> features/world-preview/WorldPreview',
  'app/App.tsx -> features/reference-world-generator/ReferenceWorldGenerator',
]);

function portable(value) {
  return value.split(sep).join('/');
}

async function sourceFiles(directory) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await sourceFiles(path));
    } else if (
      entry.isFile()
      && supportedExtensions.has(extname(entry.name))
      && !entry.name.includes('.test.')
      && !entry.name.includes('.spec.')
    ) {
      files.push(path);
    }
  }
  return files;
}

function layerOf(relativePath) {
  const [layer] = relativePath.split('/');
  return Object.hasOwn(allowedLayerDependencies, layer) ? layer : undefined;
}

function targetPath(importerPath, specifier) {
  if (!specifier.startsWith('.')) return undefined;
  const absolute = resolve(dirname(importerPath), specifier);
  const fromSource = portable(relative(sourceRoot, absolute));
  if (fromSource === '..' || fromSource.startsWith('../')) return undefined;
  return fromSource.replace(/\.(?:tsx?|jsx?)$/u, '');
}

function importSpecifiers(sourceFile) {
  const specifiers = [];
  function visit(statement) {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))
      && statement.moduleSpecifier
      && ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      specifiers.push(statement.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(statement)
      && statement.arguments.length === 1
      && ts.isStringLiteral(statement.arguments[0])
      && (
        statement.expression.kind === ts.SyntaxKind.ImportKeyword
        || (
          ts.isIdentifier(statement.expression)
          && statement.expression.text === 'require'
        )
      )
    ) {
      specifiers.push(statement.arguments[0].text);
    }
    ts.forEachChild(statement, visit);
  }
  visit(sourceFile);
  return specifiers;
}

const violations = [];
for (const absolutePath of await sourceFiles(sourceRoot)) {
  const importer = portable(relative(sourceRoot, absolutePath));
  const importerLayer = layerOf(importer);
  if (!importerLayer) continue;
  const sourceText = await readFile(absolutePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    absolutePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    extname(absolutePath) === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  if (
    importerLayer === 'core'
    && /\b(?:openai|spritecook)\b/iu.test(sourceText)
  ) {
    violations.push(`${importer}: core contains a provider-specific name.`);
  }

  for (const specifier of importSpecifiers(sourceFile)) {
    const target = targetPath(absolutePath, specifier);
    if (!target) continue;
    const targetLayer = layerOf(target);
    if (!targetLayer) continue;
    const edge = `${importer} -> ${target}`;
    if (compatibilityExceptions.has(edge)) continue;

    if (!allowedLayerDependencies[importerLayer].has(targetLayer)) {
      violations.push(
        `${edge}: ${importerLayer} cannot depend on ${targetLayer}.`,
      );
      continue;
    }

    if (
      importerLayer === 'providers'
      && targetLayer === 'adapters'
      && !target.startsWith('adapters/canvas/')
    ) {
      violations.push(
        `${edge}: built-in providers may reuse only provider-neutral canvas primitives.`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error('Architecture boundary verification failed:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(
    `Architecture boundaries verified: ${Object.keys(allowedLayerDependencies).length} layers, `
    + `${compatibilityExceptions.size} frozen compatibility edges.`,
  );
}
