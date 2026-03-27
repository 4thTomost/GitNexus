/**
 * Dart Language Provider
 *
 * Dart traits:
 *   - importSemantics: 'wildcard' (Dart imports bring everything public into scope)
 *   - exportChecker: public if no leading underscore
 *   - Dart SDK imports (dart:*) and external packages are skipped
 *   - enclosingFunctionFinder: Dart's tree-sitter grammar places function_body
 *     as a sibling of function_signature/method_signature (not as a child).
 *     The hook resolves the enclosing function by inspecting the previous sibling.
 */

import type { SyntaxNode } from '../utils/ast-helpers.js';
import type { NodeLabel } from '../../graph/types.js';
import type { CaptureMap } from '../language-provider.js';
import { FUNCTION_NODE_TYPES, extractFunctionName } from '../utils/ast-helpers.js';
import { SupportedLanguages } from '../../../config/supported-languages.js';
import { defineLanguage } from '../language-provider.js';
import { typeConfig as dartConfig } from '../type-extractors/dart.js';
import { dartExportChecker } from '../export-detection.js';
import { resolveDartImport } from '../import-resolvers/dart.js';
import { DART_QUERIES } from '../tree-sitter-queries.js';
import { createFieldExtractor } from '../field-extractors/generic.js';
import { dartConfig as dartFieldConfig } from '../field-extractors/configs/dart.js';

/**
 * Resolve the enclosing function from a `function_body` node by looking at its
 * previous sibling.  In Dart's tree-sitter grammar, function_signature and
 * function_body are siblings under program or class_body, unlike most languages
 * where the function declaration wraps both.
 *
 * Delegates name extraction to the shared `extractFunctionName` which already
 * handles Dart's function_signature and method_signature node types.
 */
const dartEnclosingFunctionFinder = (node: SyntaxNode): { funcName: string; label: NodeLabel } | null => {
  if (node.type !== 'function_body') return null;
  const prev = node.previousSibling;
  if (!prev || !FUNCTION_NODE_TYPES.has(prev.type)) return null;
  const { funcName, label } = extractFunctionName(prev);
  return funcName ? { funcName, label } : null;
};

/**
 * Extract semantic descriptions for Dart definitions that use architecture-specific
 * patterns: GetIt DI registrations, attempt() error handling, cache strategies,
 * REST API annotations, HTTP interceptors.
 */
const dartDescriptionExtractor = (
  nodeLabel: NodeLabel,
  nodeName: string,
  captureMap: CaptureMap,
): string | undefined => {
  // Get the full definition text (first ~500 chars) for pattern matching
  const defNode = captureMap['definition.method']
    ?? captureMap['definition.function']
    ?? captureMap['definition.class'];
  const text = defNode?.text?.slice(0, 500);
  if (!text) return undefined;

  const descriptions: string[] = [];

  // Detect GetIt DI registration patterns
  const diMatch = text.match(/register(?:Singleton|LazySingleton|SingletonAsync)<(\w+)>/);
  if (diMatch) {
    descriptions.push(`DI: registers ${diMatch[1]}`);
  }

  // Detect attempt() error handling wrapper
  if (text.includes('attempt(')) {
    descriptions.push('Error-handled (attempt → Either<Failure, T>)');
  }

  // Detect cache strategy selection
  const cacheMatch = text.match(/CacheStrategies\.(\w+)\(\)/);
  if (cacheMatch) {
    descriptions.push(`Cache strategy: ${cacheMatch[1]}`);
  }

  // Detect @RestApi annotation on class definitions
  if (nodeLabel === 'Class' && text.includes('@RestApi')) {
    descriptions.push('REST API interface (code-generated)');
  }

  // Detect HttpInterceptor implementation
  if (nodeLabel === 'Class' && text.includes('HttpInterceptor')) {
    descriptions.push('HTTP interceptor');
  }

  // Detect ValueNotifier reactive state
  if (text.includes('ValueNotifier<')) {
    descriptions.push('Reactive state (ValueNotifier)');
  }

  return descriptions.length > 0 ? descriptions.join('; ') : undefined;
};

const BUILT_INS: ReadonlySet<string> = new Set([
  'setState', 'mounted', 'debugPrint',
  'runApp', 'showDialog', 'showModalBottomSheet',
  'Navigator', 'push', 'pushNamed', 'pushReplacement', 'pop', 'maybePop',
  'ScaffoldMessenger', 'showSnackBar',
  'deactivate', 'reassemble', 'debugDumpApp', 'debugDumpRenderTree',
  'then', 'catchError', 'whenComplete', 'listen',
]);

export const dartProvider = defineLanguage({
  id: SupportedLanguages.Dart,
  extensions: ['.dart'],
  treeSitterQueries: DART_QUERIES,
  typeConfig: dartConfig,
  exportChecker: dartExportChecker,
  importResolver: resolveDartImport,
  importSemantics: 'wildcard',
  fieldExtractor: createFieldExtractor(dartFieldConfig),
  enclosingFunctionFinder: dartEnclosingFunctionFinder,
  descriptionExtractor: dartDescriptionExtractor,
  builtInNames: BUILT_INS,
});
