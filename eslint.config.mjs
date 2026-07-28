// @ts-check
import withNuxt from './.nuxt-dev/eslint.config.mjs'

/**
 * Correctness-first Nuxt flat config.
 *
 * The application predates the lint gate, so stylistic and high-churn migration
 * rules are deliberately disabled. New warnings remain visible without turning
 * APC into an unrelated formatting rewrite.
 */
export default withNuxt(
  {
    name: 'rotom/ignores',
    ignores: [
      '**/.nuxt*/**',
      '**/.output/**',
      '**/node_modules/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/coverage/**',
      '**/.playwright-cli/**',
      '**/campaigns/**',
      '**/backups/**',
      '**/logs/**',
      '**/run/**',
      'data/reference/**/*.json',
      'data/*Manifest.json',
      'data/ability-automation/**/*.json',
      'data/move-automation/**/*.json',
      'tests/fixtures/**/*.json',
      'ptu-data/data/**',
      'trainer_sizes/sprites/**',
    ],
  },
  {
    name: 'rotom/correctness',
    rules: {
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-async-promise-executor': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-duplicate-case': 'error',
      'no-promise-executor-return': 'error',
      'no-self-compare': 'error',
      'no-unreachable': 'error',
      'no-unreachable-loop': 'error',
      'no-unsafe-finally': 'error',
      'no-useless-catch': 'error',
      'prefer-promise-reject-errors': 'error',

      // Visible migration debt, but not a reason to rewrite established runtime
      // and fixture code in the platform/contract initiative.
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      '@typescript-eslint/unified-signatures': 'off',
      '@typescript-eslint/no-invalid-void-type': 'off',
      '@typescript-eslint/no-dynamic-delete': 'off',
      '@typescript-eslint/no-import-type-side-effects': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      'import/first': 'off',
      'import/no-duplicates': 'off',
      'no-control-regex': 'off',
      'no-useless-escape': 'off',
      'no-useless-assignment': 'off',
      'prefer-const': 'off',
      'preserve-caught-error': 'off',
      'require-yield': 'off',
      'nuxt/prefer-import-meta': 'off',
      'vue/attribute-hyphenation': 'off',
      'vue/attributes-order': 'off',
      'vue/html-self-closing': 'off',
      'vue/no-multiple-template-root': 'off',
      'vue/no-mutating-props': 'off',
      'vue/no-required-prop-with-default': 'off',
      'vue/valid-template-root': 'off',
      'vue/require-default-prop': 'off',
    },
  },
  {
    name: 'rotom/strict-new-contract',
    files: [
      'shared/encounterPresentation/**/*.ts',
      'server/domain/encounterPresentation/**/*.ts',
      'src/utils/encounterPresentation/**/*.ts',
    ],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
)
