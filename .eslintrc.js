module.exports = {
  env: {
    browser: true,
    es2021: true,
    node: true,
  },
  plugins: ['@typescript-eslint', 'simple-import-sort', 'unused-imports'],
  extends: [
    'eslint:recommended',
    'next',
    'next/core-web-vitals',
    'plugin:@typescript-eslint/recommended',
    'prettier',
  ],
  rules: {
    'no-unused-vars': 'off',
    'no-console': 'warn',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    'react/no-unescaped-entities': 'off',

    'react/display-name': 'off',
    'react/jsx-curly-brace-presence': [
      'warn',
      { props: 'never', children: 'never' },
    ],

    //#region  //*=========== Unused Import ===========
    '@typescript-eslint/no-unused-vars': 'off',
    'unused-imports/no-unused-imports': 'warn',
    'unused-imports/no-unused-vars': [
      'warn',
      {
        vars: 'all',
        varsIgnorePattern: '^_',
        args: 'after-used',
        argsIgnorePattern: '^_',
      },
    ],
    //#endregion  //*======== Unused Import ===========

    //#region  //*=========== Import Sort ===========
    'simple-import-sort/exports': 'warn',
    'simple-import-sort/imports': [
      'warn',
      {
        groups: [
          // ext library & side effect imports
          ['^@?\\w', '^\\u0000'],
          // {s}css files
          ['^.+\\.s?css$'],
          // Lib and hooks
          ['^@/lib', '^@/hooks'],
          // static data
          ['^@/data'],
          // components
          ['^@/components', '^@/container'],
          // zustand store
          ['^@/store'],
          // Other imports
          ['^@/'],
          // relative paths up until 3 level
          [
            '^\\./?$',
            '^\\.(?!/?$)',
            '^\\.\\./?$',
            '^\\.\\.(?!/?$)',
            '^\\.\\./\\.\\./?$',
            '^\\.\\./\\.\\.(?!/?$)',
            '^\\.\\./\\.\\./\\.\\./?$',
            '^\\.\\./\\.\\./\\.\\.(?!/?$)',
          ],
          ['^@/types'],
          // other that didnt fit in
          ['^'],
        ],
      },
    ],
    //#endregion  //*======== Import Sort ===========
  },
  globals: {
    React: true,
    JSX: true,
  },
  overrides: [
    {
      files: ['src/app/play/page.tsx'],
      rules: {
        // Keep the media identity check and MMS reconnect binding before any loader side effects.
        'no-restricted-syntax': [
          'error',
          {
            selector: [
              "Property:matches([key.name='m3u8'], [key.value='m3u8'])",
              ':not(:has(> :function',
              "[params.1.name='url'][params.2.name='art']",
              "[body.body.0.type='IfStatement']",
              "[body.body.0.test.operator='||']",
              "[body.body.0.test.right.operator='!==']",
              "[body.body.0.test.right.left.name='url']",
              "[body.body.0.test.right.right.object.name='videoUrlRef']",
              "[body.body.0.test.right.right.property.name='current']",
              "[body.body.0.consequent.type='ReturnStatement']",
              '[body.body.0.consequent.argument=null]',
              "[body.body.1.expression.operator='=']",
              "[body.body.1.expression.left.object.object.name='art']",
              "[body.body.1.expression.left.object.property.name='option']",
              "[body.body.1.expression.left.property.name='url']",
              "[body.body.1.expression.right.name='url']",
              '))',
            ].join(''),
            message:
              '播放身份保护：m3u8 加载入口必须先拒绝 url !== videoUrlRef.current，再同步 art.option.url = url，之后才能创建或销毁 HLS。',
          },
        ],
      },
    },
  ],
};
